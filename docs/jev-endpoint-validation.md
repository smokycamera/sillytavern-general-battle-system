# rc.12 TypeSafe 协议检查与后端 404 诊断

基于合并 PR #11 后的 main `efbd811`。用户报告：

```
Failed to generate chat completion: Internal error: Custom OpenAI endpoint failed with status 404: {"detail":"Not Found"}
```

用户确认报错出现在插件测试／JEV 规划入口。这说明调用走到了宿主的 Custom OpenAI 后端，并收到上游 HTTP 404；不能将本次错误归因于浏览器 CORS 或 10 秒模型超时。用户尚未补充当前地址，因此不能仅凭此错误确认其现在仍使用最初截图中的 TypeSafe 官方域名。

## 复现与修改

- 原版允许保存 `api.typesafe.ai` + `openai`，且 GET 模型列表可能成功，POST 却会走 `/chat/completions`。官方 JEV 实际使用 typed questions 的 `/v1/systemone`。现在保存、模型列表及实际请求入口都会校验官方域名，提示改用 TypeSafe / JEV API；不自动修改第三方协议或根据模型名称猜测协议。
- Tauri 的 quiet 生成路由会把后端失败放入 `{error:{message:...}}`，外层 HTTP 502。原版只报外层状态，或者把 HTTP 200 错误包装笼统显示成宿主错误。现在从受限错误字段识别上游状态，保留 404 和当前端点类别，不回显远端正文、完整 URL 或解析片段。
- 原版新增的 5 项定向回归全部失败：误配仍返回模型列表、误配仍写入设置、200/500/502 包装中的 404 丢失。修复后全部通过。
- 地址末尾斜杠本来已由 `connectionUrl` 处理，没有将此项当成新发现或修改端点拼接规则。
- 1 秒间隔、10 次自动重试及候选事务行为不变。固定协议错误需更改设置，重试不会修复不存在的端点；TypeSafe 在 Tauri 上遇到 CORS 仍需已运行的自建转发。

## 验证

- `npm run test:extension`：16 个文件、149 项测试通过，包含第三方自定义前缀、TypeSafe/OpenAI/旧桥接、宿主转发、1 秒重试、取消和保存隔离。
- `npm run typecheck`：通过。
- `npm run build:extension`：执行安装包构建及 vendored JEV 来源校验，清单和 dist 同步 rc.12。
- 未取得用户的当前 API 地址或 Key，未在真实 Tauri WebView 调用其服务。此次修复已覆盖能由现有错误和源码验证的问题，不能声称已验证用户服务连接成功。

依据：[TypeSafe API](https://docs.typesafe.ai/api)、[Tauri 生成路由](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src/tauri/main/routes/ai-routes.js)、[Tauri 上游状态处理](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/mod.rs)。
