# SillyTavern 通用战斗系统

[English](README.md) | **简体中文**

当前版本：**0.2.0-rc.8**。

面向 SillyTavern / TauriTavern 的原生前端战斗扩展。包含小型战斗与会战、单位档案、装备与库存、技能效果、战果成长、战报归档，以及聊天正文事件的预览和确认。

## 安装

1. 在酒馆的“扩展 → 安装扩展”中填写 `https://github.com/smokycamera/sillytavern-general-battle-system`，安装后刷新页面。
2. 在酒馆世界书中导入并启用 [!通用战斗系统约束.json](assets/worldbook/!通用战斗系统约束.json)。

rc.8 可在一次开战判定中，根据最近正文选择敌方指挥能力、风格、战场与任务；支持手动覆盖。配套 JEV 服务请一并更新至 0.2.3。

原有自动 AI 默认保留。可在设置页配置 JEV 服务，并在战场工具栏选择“JEV 指挥”；详见 [接入与使用说明](docs/jev-integration.md)。

第三方依赖遵循各自原许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。问题反馈请使用本仓库 Issues，并附宿主版本、扩展版本和复现步骤。
