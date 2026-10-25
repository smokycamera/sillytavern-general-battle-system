# Tavern Battle

**English** | [简体中文](README.zh-CN.md)

Current version: **3.0.16**. Start with the [current release and workspace guide](docs/current-release.md) and the [documentation index](docs/README.md).

A native turn-based battle extension for SillyTavern / TauriTavern, with small battles, larger engagements, three-way skirmishes, maps and fortifications, unit records, equipment and items, skills and traits, progression and archived battle reports.

## Installation

1. In Extensions → Install Extension, enter https://github.com/smokycamera/sillytavern-general-battle-system .
2. Use main for stable or test for integration builds; refresh the page after updating.
3. Enable one installation at a time. Built-in lorebook entries are enabled by default and editable in settings; disable an external duplicate yourself.

The current installation entry is root manifest.json plus dist/. Old ZIPs, panel/dist and historical resident scripts are not the current distribution. package.json supplies the product version; each saved battle retains its own rules version.

## This release

3.0.9 fixes inner-wall stairs and independent gate pairing in regional cities, and makes connected diagonal wall tops traversable by players and AI. It preserves ground movement, real breaches and the approved map prompt, without adding bridges. See the [current release](docs/current-release.md).

## Documentation

- [Built-in lorebook](docs/embedded-worldbook.md) and [chat event display](docs/native-event-display.md)
- [Battle preparation](docs/secondary-api-two-step-20261002.md) and [battlefield implementation](docs/battlefield-refactor-implementation.md)
- [Battle persistence](docs/battle-save-policy-20261016.md) and [MCP player bridge](docs/mcp-player-bridge.md)
- [Worn-item anchoring](docs/worn-anchoring-20261020.md) and [trait/item stacking](docs/traits-items-stacking-revision-20261019.md)

## Development and publishing

Run npm ci, npm run typecheck, npm run build:extension and npm run verify:dist. Merge feature work into test, verify it, then promote the same build into main. See [release channels](docs/release-channels.md) and [AGENTS.md](AGENTS.md).

The maintained implementation is in engine/src, panel/src, host/src, runtime/src and extension/src. docs/history contains past reports and superseded proposals. release/baselines/user-20260918 is an immutable compatibility fixture, not the current version.

License: **GPL-3.0-only**. Commercial use, modification and distribution are permitted under GPL version 3, including its corresponding-source obligations. See [LICENSE](LICENSE), [license notes](LICENSE-NOTES.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
