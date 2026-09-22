# SillyTavern 通用战斗系统

[English](README.md) | **简体中文**

当前版本：**0.2.0-rc.11**。

面向 SillyTavern / TauriTavern 的原生前端战斗扩展。包含小型战斗与会战、单位档案、装备与库存、技能效果、战果成长、战报归档，以及聊天正文事件的预览和确认。

## 安装

1. 在酒馆的“扩展 → 安装扩展”中填写 `https://github.com/smokycamera/sillytavern-general-battle-system`，安装后刷新页面。
2. 在酒馆世界书中导入并启用 [!通用战斗系统约束.json](assets/worldbook/!通用战斗系统约束.json)。

rc.8 可在一次开战判定中，根据最近正文选择敌方指挥能力、风格、战场与任务；支持手动覆盖。rc.9 新增 TypeSafe/JEV 与 OpenAI 兼容接口直连、拉取模型和下拉选择，默认地址为 `https://api.typesafe.ai/v1`。旧本地桥接仍兼容（服务 0.2.3）。rc.10 新增酒馆宿主转发、TauriTavern 的 OpenAI 原生后端通道，以及供 TypeSafe 使用的本机转发程序，rc.11 增加失败后间隔 1 秒、自动重试 10 次，移除 30 秒冷却，并提供实际推理测试及具体错误提示。见[跨域连接设置](docs/jev-integration.md#跨域连接rc10)。

原有自动 AI 默认保留。可在设置页配置 JEV 服务，并在战场工具栏选择“JEV 指挥”；详见 [接入与使用说明](docs/jev-integration.md)。

第三方依赖遵循各自原许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。问题反馈请使用本仓库 Issues，并附宿主版本、扩展版本和复现步骤。
