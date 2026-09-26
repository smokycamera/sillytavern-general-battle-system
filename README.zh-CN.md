# SillyTavern 通用战斗系统

[English](README.md) | **简体中文**

当前版本：**0.2.0-rc.13**。

面向 SillyTavern / TauriTavern 的原生前端战斗扩展。包含小型战斗与会战、单位档案、装备与库存、技能效果、战果成长、战报归档，以及聊天正文事件的预览和确认。

## 安装

1. 在酒馆的“扩展 → 安装扩展”中填写 `https://github.com/smokycamera/sillytavern-general-battle-system`，安装后刷新页面。
2. 在酒馆世界书中导入并启用 [!通用战斗系统约束.json](assets/worldbook/!通用战斗系统约束.json)。

普通 LLM 可在开战前读取所选层数上下文，选择双方指挥能力、风格、战斗类型与战场。API URL、Key、模型列表及模型选择独立保存，不随聊天或角色卡改变；无需配置转发地址或途径。详见[使用说明](docs/jev-integration.md)。

JEV 指挥入口暂时撤下，设置只保留“jev指挥功能(未完成，勿选)”禁用提示；自动战斗由内置 AI 执行。

第三方依赖遵循各自原许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。问题反馈请使用本仓库 Issues，并附宿主版本、扩展版本和复现步骤。
