# 通用战斗系统

Optional **MCP player controls** connect ChatGPT, Dots and compatible clients to the existing player UI, including battle buttons, loadouts, commander styles and map design. Disabled by default; the battle engine and save format are unchanged. See the [MCP setup guide](mcp/README.md).

**English** | [简体中文](README.zh-CN.md)

Current candidate: **1.6.1-rc.3**. Narrative spatial relationships now guide city and outside-city layouts, landmarks and deployment. New maps use actual elevation and explicit bridge/gate counts, positions and states. Secondary API prompts are shorter and explicitly identify ford as shallow water. See [implementation and validation](docs/battlefield-refactor-implementation.md). This is a prerelease; do not enable both stable and test installations at once.

The loadout header now includes **技能选择** beside **新增物品**. Choose a unit, select up to five learned skills, and save; preparation retains skill effects, cooldowns, resources, and equipment.

All four entries are constant, with keywords removed and the user-provided text retained. Supported ST / TT hosts process them through the global World Info pipeline with the original position, depth, role, and order. Use **＋新建条目** to add custom entries with constant or keyword activation, depth, message role, insertion order, and individual enable/delete controls. See [embedded lorebook notes](docs/embedded-worldbook.md).

Human carrying capacity is now 14, and large bodies carry 18. Humans at load 12 or above lose 1 movement and 2 initiative. Non-vehicle units may equip and fire autocannons and artillery; vehicle stabilization still requires a vehicle. Load penalties appear in equipment previews and unit details.

New battles use V8 burst tuning (6% training damage per level and 1.5× single weapon skills), retaining cross-grade damage, overflow and the V6 life baseline: the 16T+4 life curve, giant melee strength, shared frontage, skill budgets and bounded area coverage. Signed modifiers, level growth, editing and save validation share the same limits. Archive upgrades show a preview and retain a full backup; ongoing old battles retain their rules. See [V8 burst tuning and pacing checks](docs/burst-balance-v8.md), [V7 overmatch, overflow and validation](docs/overmatch-v7.md) and [V6 life formulas](docs/unified-balance-v6.md).

Export a save before upgrading if you may need to downgrade. The complete 1.0.6 build is preserved on a dedicated rollback branch; see [version rollback](docs/version-rollback.md).

License: **GPL-3.0-only**. Commercial use, modification and distribution are permitted under GPL version 3, including its corresponding-source obligations when conveying covered software. See [LICENSE](LICENSE) and [license notes](LICENSE-NOTES.md).

A native frontend battle extension for SillyTavern / TauriTavern. It supports small-scale battles and larger engagements, unit profiles, equipment and inventory, skill effects, post-battle progression, battle-report archives, and preview/confirmation of battle events extracted from chat content.

## Installation

1. **Stable**: in SillyTavern, open **Extensions → Install Extension**, enter `https://github.com/smokycamera/sillytavern-general-battle-system`, keep the default `main` branch, install it, and refresh the page.
2. **Test**: use the same repository URL and select the `test` branch during installation. New changes land there first and are promoted with `test → main` after acceptance. Do not enable stable and test copies at the same time.
3. The four lorebook entries are built in and enabled by default. Open **Battle panel → Settings → 内置世界书** to add custom entries, toggle, edit individual texts, or restore built-in defaults. These settings persist across chats and characters.
4. Disable the external copy yourself to avoid duplicate context. The plugin does not modify or disable external lorebooks.

See [release channels](docs/release-channels.md) for the development and promotion workflow.

Complete `<tb>` blocks in assistant replies are automatically escaped and shown in a collapsible event panel. No separate display regex is required. Expand it to read or copy the original event text; saved messages, scanning and model context remain unchanged. Disable any old `<tb>` hiding/folding regex and refresh after updating. See [display notes](docs/native-event-display.md).

An ordinary OpenAI-compatible LLM can read the selected number of recent messages before battle to choose commander profiles and the supported battle/scene setup. API URL, key, model list and selection persist independently of chats and characters. Native model backends are selected automatically for ST and TT; no relay URL or CORS proxy configuration is required. See the [usage guide](docs/jev-integration.md).

JEV Command controls are withdrawn. Settings retain a disabled unfinished-feature notice; automatic turns use the built-in AI.

Third-party dependencies remain under their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please report issues through this repository's Issues page and include the host version, extension version, and reproduction steps.
