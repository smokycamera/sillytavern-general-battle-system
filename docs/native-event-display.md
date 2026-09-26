# 战阵事件自动折叠显示

从 1.0.2 起，原生扩展自动显示 AI 正文中的完整 `<tb>...</tb>` 块，不需要导入正则。默认收起为“📋 战阵事件 · N项”，点击展开可查看、选择和复制标签原文。数字只表示显示的事件标签数量，不表示已经入账；事件确认仍在战阵面板完成。

- 只改变显示，不修改 `message.mes`、消息 ID、swipe、存档或模型上下文，也不因展开而扫描、执行或确认事件。
- 保留正文、状态栏和 iframe 实例。显示修复不会重绘整条消息，也不会触发保存。
- 只处理 AI 消息的完整事件块。用户消息、系统消息、思考内容、注释、代码示例和已有有效折叠保持原样。流式回复中的不完整块等闭合后再折叠。
- 当前聊天里已显示的历史楼层，以及后来加载、编辑或切换 swipe 的楼层，均会补全显示。
- 如果装过专门处理 `<tb>` 的隐藏/折叠正则，可停用旧规则并刷新，避免两套规则相互改变显示。扩展不会自动修改用户的正则配置。

## 宿主兼容与实现

SillyTavern 提供 `getContext().messageFormatter` 时，扩展在 `AFTER_REGEX` 阶段取出完整事件块，用只存在于当次显示副本的占位符跨过 Markdown、`encode_tags` 和代码实体还原，在 `AFTER_MARKDOWN` 阶段还原为转义后的 `<details><pre><code>`，再交给宿主 DOMPurify 净化。这样属性里的 `&quot;`、`&amp;` 等仍能原样查看和复制。卸载时清空临时内容并禁用钩子；反复初始化不会重复注册。

TauriTavern 当前公开上下文未提供同一钩子。无钩子的宿主使用兼容显示：读取当前消息原文，在已有消息 DOM 中局部放入纯文本事件框。能找到原位置时原位折叠；标签已被 HTML 处理吞掉时，在该条消息末尾显示。通过消息事件与限域 DOM 观察处理更新，不重绘正文和内嵌界面。

核对依据：

- [SillyTavern 格式化接口源码](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/message-formatter.js)
- [SillyTavern 消息格式化管线](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js)
- [TauriTavern 公开上下文](https://github.com/Darkatse/TauriTavern/blob/main/src/scripts/st-context.js)

验证覆盖：HTML 转义与实体保留、事件扫描不变、宿主接口有无两条路径、完整流式块、历史消息、编辑、swipe、聊天切换、重复渲染、代码/思考保护、卸载与重装、正文和 iframe 身份保持。另用 SillyTavern release 的实际 `messageFormatting` 函数、Showdown 2.1.0 和 DOMPurify 3.2.6 验证 6 组管线场景，覆盖 `encode_tags` 开/关、属性实体与 HTML 注入文本，均通过。DOM 测试使用 happy-dom 和模拟宿主上下文；不等同于用户设备上的实机验收。
