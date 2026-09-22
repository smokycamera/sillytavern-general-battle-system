# SillyTavern General Battle System

**English** | [简体中文](README.zh-CN.md)

Current version: **0.2.0-rc.10**.

A native frontend battle extension for SillyTavern / TauriTavern. It supports small-scale battles and larger engagements, unit profiles, equipment and inventory, skill effects, post-battle progression, battle-report archives, and preview/confirmation of battle events extracted from chat content.

## Installation

1. In SillyTavern, open **Extensions → Install Extension**, enter `https://github.com/smokycamera/sillytavern-general-battle-system`, install it, and refresh the page.
2. Import and enable [!通用战斗系统约束.json](assets/worldbook/!通用战斗系统约束.json) in your World Info / lorebook.

rc.8 can select enemy command capability/style and the supported battlefield/mission setup from recent completed narrative in one JEV batch, with manual overrides. rc.9 adds direct TypeSafe/JEV and OpenAI-compatible API connections with model discovery and selection; the default API base is `https://api.typesafe.ai/v1`. Existing local bridge connections remain supported (service 0.2.3). rc.10 adds host-side transport for SillyTavern and TauriTavern OpenAI APIs, plus a bundled local relay for TypeSafe on TauriTavern. See [CORS setup](docs/jev-integration.md#跨域连接rc10).

The existing automatic AI remains available as the default. You can configure a JEV service in the settings page and select **JEV Command** from the battlefield toolbar. See the [JEV integration and usage guide](docs/jev-integration.md) for details.

Third-party dependencies remain under their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please report issues through this repository's Issues page and include the host version, extension version, and reproduction steps.
