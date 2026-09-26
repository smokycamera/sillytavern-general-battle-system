# SillyTavern General Battle System

**English** | [简体中文](README.zh-CN.md)

Current version: **0.2.0-rc.13**.

A native frontend battle extension for SillyTavern / TauriTavern. It supports small-scale battles and larger engagements, unit profiles, equipment and inventory, skill effects, post-battle progression, battle-report archives, and preview/confirmation of battle events extracted from chat content.

## Installation

1. In SillyTavern, open **Extensions → Install Extension**, enter `https://github.com/smokycamera/sillytavern-general-battle-system`, install it, and refresh the page.
2. Import and enable [!通用战斗系统约束.json](assets/worldbook/!通用战斗系统约束.json) in your World Info / lorebook.

An ordinary OpenAI-compatible LLM can read the selected number of recent messages before battle to choose commander profiles and the supported battle/scene setup. API URL, key, model list and selection persist independently of chats and characters. No relay URL or route selection is required. See the [usage guide](docs/jev-integration.md).

JEV Command controls are withdrawn. Settings retain a disabled unfinished-feature notice; automatic turns use the built-in AI.

Third-party dependencies remain under their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please report issues through this repository's Issues page and include the host version, extension version, and reproduction steps.
