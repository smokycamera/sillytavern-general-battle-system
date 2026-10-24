# 3.0.2 绑定世界书开战修正

用户报告点击开战立即显示“上下文读取失败：模型请求或返回格式无效”，读取模式为绑定当前角色卡，并要求兼容角色卡没有世界书的情况。

## 复现与原因

以保存的威尼斯正文和15张单位卡，创建支持世界书激活事件、尚未取得结果的宿主，再调用当前开战控制器：11毫秒内报出相同通用错误，模型请求次数为0。问题发生在组装副API上下文时，尚未进入地图生成。

世界书来源抛出的普通Error没有被`llmFailure`列为可展示的错误，因此“尚未取得当前聊天的世界书激活结果”等原因被替换成通用模型格式错误。真实宿主的世界书来源位于父窗口，面板位于iframe，不能只依赖`instanceof`跨窗口判断错误类型。

## 修正

- 世界书读取使用受控错误码，面板根据已知码重建本地错误；显示缺少激活结果、宿主接口、HTTP状态等具体原因，不回显未知异常正文、请求或密钥。
- 缺少激活缓存时，只读宿主`world-info.js`的`selected_world_info`与`world_info.charLore`，结合当前角色卡`data.extensions.world`、聊天`world_info`和人设`persona_description_lorebook`确认是否完全没有配置世界书。只有确认全空才直接返回空结果；未知配置不当成无世界书。
- 该查询不扫描关键词、不调用主API、不读取整本书、不重抽概率。已经取得的实际激活结果仍优先复用，包含空激活结果；不把未触发或禁用条目发送给副API，不混入保留的手动选择。
- 异步检查期间取消或切换聊天时停止，空结果不缓存为其他角色卡的激活状态。保留手动选择、聊天隔离及既有正文修改失效规则。
- 不修改副API提示词、动态上下文格式或世界书正文。

宿主接口已核对[SillyTavern的上下文接口](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)、[世界书来源](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/world-info.js)，以及[TauriTavern的对应实现](https://github.com/Darkatse/TauriTavern/blob/main/src/scripts/world-info.js)。

## 验证

本轮5个定向测试文件42项通过：宿主激活6项、世界书消息5项、真实开战按钮场景1项、原主界面集成1项、LLM布置29项。

新增界面集成覆盖同一角色的三个阶段：有书但缺少激活结果时显示具体原因且0次模型请求；取消绑定后无需生成正文即可完成两步开战；取得激活结果后再次开战，只发送本轮命中条目，并完成存档恢复。另覆盖主书、附加书、聊天、全局、人设来源、未知配置、切换聊天，以及跨iframe错误码和未知异常不泄露。

修正后相同威尼斯探针14毫秒内显示“尚未取得当前聊天的世界书激活结果，请先让角色卡生成一次正文”，模型请求次数仍为0。复现数据保存在`artifacts/venice-map-audit/worldbook-start-before.json`与`worldbook-start-fixed.json`。

这些是本地源代码集成与保存回答验证，没有新增付费模型调用，也不代表已经在用户的真实SillyTavern/TauriTavern设备中复测。按已有授权完成review、构建和安装包校验后发布到test，不等待CI。
