# MCP 玩家桥接

> 当前版本已隐藏全部 MCP 入口：设置页不显示配对区，准备页不显示“指挥风格与地图设计”草稿，面板不安装桥接监听。代码保留，将 `panel/src/mcp-flag.ts` 的 `MCP_ENABLED` 改为 `true` 并重新构建即可恢复；`npm run smoke:mcp` 也需要恢复后的构建。

可选 MCP 桥接通过独立 Node.js 服务和面板主动配对，让 ChatGPT、Dots 及其他客户端操作 ST / TauriTavern 中的同一个战阵界面。

安装、Dots 接入、工具和示例见 [MCP 使用说明](../mcp/README.md)。

0.2.0 保留原来的 8 个界面工具，新增 8 个游戏工具；用法见 [连续行动、固定预览与隔离试战](../mcp/GAMEPLAY.md)。只连接一个面板时新工具可省略 sessionId。

- `mcp/`：官方 MCP SDK 的 stdio / Streamable HTTP 服务、鉴权、队列与协议测试。
- `panel/src/mcp-bridge.ts`：默认关闭的配对/轮询，密钥只在页面内存中。
- `panel/src/mcp-ui.ts`：玩家可见界面读取和控件操作，不访问游戏状态。
- `panel/src/player-preparation.ts`：本地玩家与 MCP 共用的战前指挥/地图草稿，复用现有生成器和部署校验。
- `panel/src/mcp-game.ts`：玩家可见的游戏状态、行动链、状态校验与有界去重回执；与界面共用引擎和保存入口。
- `panel/src/game-encounter.ts`：界面开战与 MCP 预览共用的开局构造；预览确认不重新生成地图/部署。
- `panel/src/mcp-sandbox.ts`：隔离试战，独立本地存储、完整开局重开与最近 20 场战报，没有正式档案的写入入口。
- `panel/src/post-battle-recovery.ts`：按可恢复伤情恢复档案；英雄编辑到正生命时同步解除濒死。
- `panel/src/main.ts`：设置、原生面板可见性和开战流程接线。

引擎与存档格式不变。聊天、页面或存档修订改变后，旧操作会被拒绝并要求重新观察。存档导入保留预览/备份/确认，导出交给浏览器下载。
