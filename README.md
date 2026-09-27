# 通用战斗系统v1.0

**English** | [简体中文](README.zh-CN.md)

Current version: **1.1.0**.

New battles use V5 channel protection: single-target damage grows independently of penetration and area, armor no longer grants level-scaled effective health, shields give bounded cover, and healing uses the new wound scale. Existing battles retain their rules. Reimport the bundled lorebook to refresh its instructions. See [design and validation](docs/armor-v5-design.md).

Export a save before upgrading if you may need to downgrade. The complete 1.0.6 build is preserved on a dedicated rollback branch; see [version rollback](docs/version-rollback.md).

License: **GPL-3.0-only**. Commercial use, modification and distribution are permitted under GPL version 3, including its corresponding-source obligations when conveying covered software. See [LICENSE](LICENSE) and [license notes](LICENSE-NOTES.md).

A native frontend battle extension for SillyTavern / TauriTavern. It supports small-scale battles and larger engagements, unit profiles, equipment and inventory, skill effects, post-battle progression, battle-report archives, and preview/confirmation of battle events extracted from chat content.

## Installation

1. In SillyTavern, open **Extensions → Install Extension**, enter `https://github.com/smokycamera/sillytavern-general-battle-system`, install it, and refresh the page.
2. Import and enable [!通用战斗系统约束.json](assets/worldbook/!通用战斗系统约束.json) in your World Info / lorebook.

Complete `<tb>` blocks in assistant replies are automatically escaped and shown in a collapsible event panel. No separate display regex is required. Expand it to read or copy the original event text; saved messages, scanning and model context remain unchanged. Disable any old `<tb>` hiding/folding regex and refresh after updating. See [display notes](docs/native-event-display.md).

An ordinary OpenAI-compatible LLM can read the selected number of recent messages before battle to choose commander profiles and the supported battle/scene setup. API URL, key, model list and selection persist independently of chats and characters. Native model backends are selected automatically for ST and TT; no relay URL or CORS proxy configuration is required. See the [usage guide](docs/jev-integration.md).

JEV Command controls are withdrawn. Settings retain a disabled unfinished-feature notice; automatic turns use the built-in AI.

Third-party dependencies remain under their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please report issues through this repository's Issues page and include the host version, extension version, and reproduction steps.
