# 高楼层存读档：第二轮优化

上一版仅停止解析兼容 `/api/chats/get` 响应中的聊天正文。TauriTavern 的兼容 transport 可以在返回 Response 前就读入并转换完整聊天，因此仍有随楼层增长的后端处理与桥接开销。

本次调整：

- 检测 `__TAURITAVERN__.api.chat.open` 和句柄的 `metadata.get()`，优先直接读取已落盘的聊天元数据。使用操作捕获的头像文件身份（去掉 `.png`）及聊天文件名，不跟随操作期间的当前聊天切换。无该能力时继续使用流式文件头读取。
- 专用接口返回异常或损坏数据时直接报错，不使用内存中的未保存状态替代磁盘核验，也不缓存核验结果。
- 涉及消息来源标记的保存，将保存后的存档头、消息标记及兼容交接核验合并到同一次读回。普通带标记提交从三次聊天读取降至两次（保存前检查一次，保存后合并检查一次）。重复消息身份和来源正文变化仍会被拒绝。
- 批量消息标记核验改为一次遍历建立匹配表，避免每个标记都过滤整段聊天。

宿主依据：

- [TauriTavern Chat API](https://github.com/Darkatse/TauriTavern/blob/main/docs/API/Chat.md)：`open(ref)` 与 `metadata.get()`。
- [API 实现](https://github.com/Darkatse/TauriTavern/blob/main/src/tauri/main/api/chat.js)：读取指定角色/聊天的持久元数据。
- [存储实现](https://github.com/Darkatse/TauriTavern/blob/main/src-tauri/crates/tt-adapter-storage-core/src/repositories/file_chat_repository/chat_metadata.rs)：只读取 JSONL 首行；元数据写入仍需复制原聊天文件正文。

验证：宿主相关测试及 runtime 测试共 109 项通过；覆盖聊天切换、专用接口错误、无接口兼容路径、保存失败被宿主吞掉、重复来源标记、来源内容变化和部分落盘恢复。专用接口模拟测试确认普通载入及保存不调用完整聊天 fetch，带标记保存只进行一次保存后完整读回。

限制：尚未测量用户实际酒馆端到端耗时。完整消息保存、消息来源核验及宿主文件写入仍可能受聊天长度和磁盘速度影响。
