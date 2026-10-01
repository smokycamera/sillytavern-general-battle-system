# MCP 玩家桥接

可选 MCP 桥接通过独立 Node.js 服务和面板主动配对，让 ChatGPT、Dots 及其他客户端操作 ST / TauriTavern 中的同一个战阵界面。

安装、Dots 接入、工具和示例见 [MCP 使用说明](../mcp/README.md)。

- `mcp/`：官方 MCP SDK 的 stdio / Streamable HTTP 服务、鉴权、队列与协议测试。
- `panel/src/mcp-bridge.ts`：默认关闭的配对/轮询，密钥只在页面内存中。
- `panel/src/mcp-ui.ts`：玩家可见界面读取和控件操作，不访问游戏状态。
- `panel/src/player-preparation.ts`：本地玩家与 MCP 共用的战前指挥/地图草稿，复用现有生成器和部署校验。
- `panel/src/main.ts`：设置、原生面板可见性和开战流程接线。

引擎与存档格式不变。聊天、页面或存档修订改变后，旧操作会被拒绝并要求重新观察。存档导入保留预览/备份/确认，导出交给浏览器下载。
