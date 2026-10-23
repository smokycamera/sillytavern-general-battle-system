# 副 API 绑定当前角色卡世界书

在设置的“发送给副 API 的世界书”中，读取模式可以选择“手动选择”或“绑定当前角色卡（共用激活条目）”。旧配置默认继续使用手动选择，切换模式保留原来的勾选。

绑定模式复用酒馆主 API 本轮实际激活的世界书条目，包括当前角色卡、聊天和全局等来源经过酒馆扫描后纳入的内容。蓝灯常驻、绿灯关键词触发、递归、概率、粘滞、冷却和预算由酒馆负责；副 API 不重新扫描或再次抽取概率，也不推进这些状态。每次副 API 请求沿用现有的世界书 JSON 消息格式，发送激活条目的书名、ID、标题和正文。

扩展启动时就监听激活事件，关闭或重新打开战阵面板不会丢失已取得的结果。结果只留在内存，不写入战斗存档或角色卡。切换角色、聊天或分支后不复用旧结果；编辑、切换或删除消息后需要重新生成正文。刷新页面后也需要先让角色卡生成一次正文，才能取得当前聊天的激活结果。尚未取得结果或酒馆未提供激活接口时显示具体原因，不悄悄改发整本世界书。

手动模式保持原来的行为：选择整本或指定条目，每次请求发送勾选的内容，不受关键词触发限制。两种模式互斥，绑定时不叠加手动选择。

实现依据：SillyTavern 与 TauriTavern 的 `getWorldInfoPrompt()` 都在非 dry-run 的扫描结果非空时，通过 `WORLD_INFO_ACTIVATED` 发出本轮激活条目；空结果不发此事件，因此在真实的 `GENERATION_STARTED` 时先清空上轮结果。扫描试运行不会覆盖已取得的真实结果；TauriTavern 从 agent 检查点继续时保留原有激活结果，若宿主发出新激活事件则随之更新。兼容 `eventTypes` / `event_types` 以及 `off` / `removeListener`。相关接口见 [SillyTavern world-info.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/world-info.js)、[SillyTavern script.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js)、[TauriTavern world-info.js](https://github.com/Darkatse/TauriTavern/blob/main/src/scripts/world-info.js) 与 [TauriTavern script.js](https://github.com/Darkatse/TauriTavern/blob/main/src/script.js)。
