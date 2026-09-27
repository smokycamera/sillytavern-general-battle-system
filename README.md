# 通用战斗系统v1.0

**English** | [简体中文](README.zh-CN.md)

Current version: **1.2.1**.

Human carrying capacity is now 14, and large bodies carry 18. Humans at load 12 or above lose 1 movement and 2 initiative. Non-vehicle units may equip and fire autocannons and artillery; vehicle stabilization still requires a vehicle. Load penalties appear in equipment previews and unit details.

New battles use V6 unified life and combat pacing: the 16T+4 life curve, giant melee strength, shared frontage, skill budgets and bounded area coverage. Signed modifiers, level growth, editing and save validation share the same limits. Archive upgrades show a preview and retain a full backup; ongoing old battles retain their rules. Reimport the bundled lorebook. See [formulas, migration and validation](docs/unified-balance-v6.md).

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
