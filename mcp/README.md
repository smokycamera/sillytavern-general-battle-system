# 通用战斗系统 MCP

**手机 TT + VPS：** 请使用独立的 [tavern-battle-mcp 仓库](https://github.com/smokycamera/tavern-battle-mcp) 的 Docker/HTTPS 部署流程；该仓库也提供连接同一 VPS 实例的 stdio 代理。手机填写 VPS 的 HTTPS 地址。以下本机示例用于酒馆与服务在同一台电脑的情况。

独立、可选的玩家操作桥接。ST / TauriTavern 运行游戏本体；ChatGPT、Dots 或其他 MCP 客户端通过桥接操作同一个界面。支持 **Streamable HTTP** 与 **stdio**。引擎、随机数、伤害、视野及存档事务仍由本体负责。

## 本地启动

需要 Node.js 20 或以上版本。首次在仓库根目录运行：

```powershell
npm ci --prefix mcp
npm run mcp
```

Windows 也可运行 `mcp/start.ps1`，它会在缺少依赖时安装并启动服务。默认监听 `127.0.0.1:8766`，终端显示本次随机配对密钥。

更新插件后，在战阵面板选择 **设置 → MCP 玩家操作**：桥接地址填 `http://127.0.0.1:8766`，密钥填终端显示的本次密钥，点击 **连接 MCP**。

连接只在当前页面生效。默认关闭，不自动配对或恢复连接，不写入聊天存档。断开、刷新或服务中断后需要重新连接。手动操作与自动战斗继续使用原流程。

如果酒馆使用其他地址，先把它的 **origin（协议、主机、端口，不含路径）** 配入允许列表：

```powershell
$env:TB_MCP_ORIGINS = 'http://localhost:8000,http://192.168.1.10:8000,http://tauri.localhost,tauri://localhost'
npm run mcp
```

TT 使用其实际 origin。浏览器首次请求本地网络时，按提示允许连接。远程设备中的 `127.0.0.1` 指向该设备；如 TT 不在同一台电脑，需要可访问的服务地址，并相应设置 `TB_MCP_HOST`、允许的 origin 和 HTTPS。

## 本地 MCP 客户端

**HTTP**：URL 为 `http://127.0.0.1:8766/mcp`，请求头为 `Authorization: Bearer <配对密钥>`。酒馆桥接地址不带 `/mcp`，MCP 客户端地址带 `/mcp`。

**stdio**：由客户端启动以下进程，不必另开同端口的 HTTP 服务：

```json
{
  "mcpServers": {
    "tavern-battle": {
      "command": "node",
      "args": ["D:/gbs/mcp/server.mjs", "--stdio"],
      "env": {
        "TB_MCP_TOKEN": "替换为自己生成的至少24字符随机密钥",
        "TB_MCP_PORT": "8766",
        "TB_MCP_ORIGINS": "http://localhost:8000,http://127.0.0.1:8000,http://tauri.localhost,tauri://localhost"
      }
    }
  }
}
```

将绝对路径改成实际位置，并在酒馆填写同一密钥。stdio 的 stdout 只包含 MCP 协议；状态输出到 stderr。HTTP 和 stdio 是两种启动方式，不要在同一端口同时启动。

## ChatGPT 与 Dots

Dots 在云端运行，能够使用账户已安装且启用的受支持插件；它的云端浏览器与本地电脑是不同环境，不能假定能直接访问电脑上的 `localhost`。[Dots 官方说明](https://learn.chatgpt.com/docs/dots/computers-and-apps)。

推荐使用 **Secure MCP Tunnel** 把本地 stdio 服务接入个人 ChatGPT 插件：

1. 从 [Secure MCP Tunnel 文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 进入 Platform tunnel settings，创建隧道并关联目标 ChatGPT 工作区。
2. 按该文档安装 `tunnel-client`、设置运行密钥。MCP command 使用 `node D:/gbs/mcp/server.mjs --stdio`；先安装 MCP 依赖。
3. 在启动隧道的环境中设置 `TB_MCP_TOKEN` 和 `TB_MCP_ORIGINS`。服务启动后，在酒馆填写同一配对密钥并连接。
4. ChatGPT 开发者模式中进入 **Plugins → ＋ → Connection → Tunnel**，选择隧道并发现工具。安装并启用个人插件后，让 Dots 使用它。[官方连接步骤](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

也可把 HTTP `/mcp` 放在经过身份验证的 HTTPS 接入后。受信任隧道/网关已验证访问者时，可在仅监听 loopback 的进程中显式设置 `TB_MCP_AUTHENTICATED_TUNNEL=1`，由网关代管 MCP 鉴权；浏览器 `/bridge/*` 始终需要配对密钥。默认 HTTP 需要 Bearer；项目不内置公共多用户 OAuth 服务。

账号需具备对应的 Dots、开发者模式、插件与隧道权限。仓库测试验证标准 MCP 和浏览器中的 ST/TT 兼容宿主；这不等同于已在特定 Dots 账户完成安装或验证。酒馆页面、桥接服务和隧道需要保持运行。

## 工具与流程

| 工具 | 用途 |
| --- | --- |
| `battle_sessions` | 列出主动配对面板，明确选择 sessionId |
| `battle_observe` | 读取可见文字、控件、选项、禁用状态和保存反馈；支持分页 |
| `battle_click` | 点击按钮、地图格、单位、标签页或展开项 |
| `battle_fill` | 填文本/数字、选择选项、勾选开关；多选用字符串数组 |
| `battle_key` | Enter、空格、Escape、Tab、方向/Home/End；遵循现有界面语义 |
| `battle_upload` | 将用户提供的 JSON 放入文件选择框；继续用本体导入预览、备份和确认 |
| `battle_help` | 获取指挥与地图格式、战前公开单位代号、当前正文依据 |
| `battle_prepare` | 校验下一场指挥与地图草稿，不直接开战 |

先 `battle_sessions`，再 `battle_observe`。操作须带最近返回的 `viewId` 和目标 `controlId`；准备只需 `viewId`。每次操作后使用新界面。聊天、存档修订、按钮或表单变化后旧 viewId 失效。折叠项先展开，不能凭空调用未显示的按钮。

`dispatched: true` 只表示动作已发出，不保证业务成功。检查 `feedback`、`saveStatus`、`busy` 和新界面；保存失败仍走原插件核实/重试流程。超时操作不会自动重放，先重新观察。

**游戏入口**：战场移动/攻击/技能/结束回合、会战军令、自动战斗/暂停、投降/结算、队伍/主控/指挥、单位编辑、配装/技能选择、战报、世界书和普通设置都从可见界面操作。原生面板的存档管理、导入预览和确认也可访问。导出仍下载到玩家浏览器，不向模型返回可能含隐藏信息的原始存档。API Key、配对密钥和含密钥的配置备份由玩家本地管理。

## 指挥与地图

先在任务设置选择地形、光照与目标，然后向 `battle_prepare` 提交：

```json
{
  "sessionId": "从 battle_sessions 获取",
  "viewId": "从 battle_observe 获取",
  "commanders": {
    "ally": { "ability": "skilled", "style": "flanking", "preferences": { "risk": 3, "reserve": 1 } },
    "enemy": { "ability": "regular", "style": "cautious" }
  },
  "battlefield": {
    "scene": "field",
    "layout": "lanes",
    "landmarks": [{ "kind": "hill", "anchor": "center_left", "label": "西侧高地" }]
  }
}
```

准备后点击“开始交战”。本场优先使用这份配置，不额外调用副 API。没有自定义准备时，原有流程不变；`clear:true` 清除准备。草稿只驻留面板内存，聊天、队伍或任务改变时失效；进行中战斗不能重设。详细格子地图用于小战，会战保留阵位规则。

玩家也可在“战场 → 指挥风格与地图设计”填写同样 JSON，两种入口共用校验。部署、通路、桥门、地标及正文关系仍受现有规则限制。只提供 commanders 时沿用本地场景地图生成。

## 边界与验证

- 引擎代码、存档格式、旧战斗规则未修改。SDK 仅安装在 `mcp/node_modules`，不打入浏览器。
- 观察只序列化可见文字和控件；不提供执行 JavaScript、读取原始存档或修改快照/随机数的工具。
- 未连接时没有 MCP 轮询。断开后停发命令；已开始的本体操作仍由本体完成。
- 单面板一次执行一条指令，过期、取消、超时队列不会自动重放。玩家可在本地随时暂停或断开。

```powershell
npm run test:mcp
npm run typecheck
npm run build:extension
npm run smoke:mcp
```

冒烟测试使用独立合成宿主和存档，不连接玩家酒馆。默认使用已安装 Edge/Chrome，也可用 `TB_BROWSER` 指定 Chromium 路径。
