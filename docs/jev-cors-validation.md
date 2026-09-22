# rc.10 跨域连接修复与验证

基于远程 main `f524886f4b790ceaec364f922034e89c52d26332`（rc.9）修改。

## 原因与修改

rc.9 的 TypeSafe/OpenAI 远程连接在面板 iframe 内直接 fetch。上游不允许 CORS 时，拉取模型、测试及战斗决策均失败；原来的通用网络错误也不能独立证明一定是 CORS。

- 新增统一请求通道：自动、酒馆宿主转发、自建转发、浏览器直连。rc.9 原协议、地址和模型保留；未设置请求通道时使用自动。旧 bridge 默认保持直连。
- SillyTavern 调用拥有面板的同源父窗口 `/proxy/`，保留宿主会话与 CSRF。代理未启用时明确提示 `enableCorsProxy: true` 并重启，CSRF 过期另作提示。
- TauriTavern 的 OpenAI 兼容协议使用其 custom 后端，通过 `reverse_proxy` + `proxy_password` 传入地址与本次 Key，`custom_url` 留空，避免读取宿主已有 CUSTOM 密钥。非流式推理为 quiet 请求；模型、JSON 输出格式和消息通过请求体传递。没有修改宿主模型设置。
- TauriTavern 无通用 TypeSafe `/proxy/`；自动模式仍允许已支持 CORS 的服务直连。失败后明确引导启动附带的本机转发，不声称仅更新插件就能赋予宿主不存在的网络能力。
- `scripts/jev-cors-relay.mjs` 使用 Node 内置模块，默认只监听回环地址；固定一个上游、限制 Origin 和端点、不跟随重定向、不转发 Cookie/CSRF，不记录密钥和请求正文。原生安装包也包含此文件。
- 模型拉取、连接测试、TypeSafe/OpenAI 决策、上下文选择、正文目标提取和旧 bridge 都使用同一传输入口。推理失败不自动换通道重发，取消信号透传，超时独立提示。

## 核对的宿主接口

- [SillyTavern CORS proxy](https://github.com/SillyTavern/SillyTavern/blob/release/src/middleware/corsProxy.js) 与 [注册开关](https://github.com/SillyTavern/SillyTavern/blob/release/src/server-main.js)。
- TauriTavern 源码快照 `a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375`：[fetch 拦截器](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src/tauri/main/interceptors.js)、[模型后端路由](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src/tauri/main/routes/ai-routes.js)、[地址与密钥选择](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src-tauri/crates/tt-application/src/services/chat_completion_service/config.rs)。

## 验证范围

- `npm run test:extension`：125 项通过，包括 16 项新传输回归。
- `npm run test:jev-relay`：5 项通过，使用真实 Node HTTP 上游和转发服务器，覆盖 CORS 预检、GET/POST、请求头隔离、Origin/目标限制、401 状态和重定向拒绝。
- `npm run typecheck`：通过。
- `npm run build:extension`：通过。内置 JEV 核心来源校验通过，可安装 dist 与版本已同步至 rc.10；原生包包含转发脚本和说明。
- 浏览器测试未执行：环境中没有 Chromium，Playwright 的浏览器下载返回无效/截断压缩包，无法启动。因此上述模拟宿主测试不等同于真实 Tauri WebView 或 Android 实测。
- 未使用真实 API Key 调用 TypeSafe 或第三方服务；未操作用户聊天、存档或宿主配置。没有重复全量战斗平衡性测试。

用户操作见 [连接与转发设置](jev-integration.md#跨域连接rc10)。SillyTavern 宿主代理需要宿主配置开关；TauriTavern TypeSafe 跨域需要运行本机转发进程。不同版本的 TauriTavern 后端差异仍需在实际安装环境确认。
