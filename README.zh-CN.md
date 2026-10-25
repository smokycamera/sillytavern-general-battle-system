# 通用战斗系统

[English](README.md) | **简体中文**

当前版本：**3.0.17**。当前实现、版本与构建入口见 [当前发布说明](docs/current-release.md)，专题资料见 [文档索引](docs/README.md)。

面向 SillyTavern / TauriTavern 的原生前端回合制战斗扩展，支持小规模战斗、军团会战、三方小战、地图与城防、单位档案、装备和道具、技能与特质、战果成长及战报归档。

## 安装与更新

1. 在酒馆的“扩展 → 安装扩展”中填写 https://github.com/smokycamera/sillytavern-general-battle-system 。
2. 正式版使用 main 分支，测试版使用 test 分支；更新扩展后刷新页面。
3. 同一环境只启用一个分支的扩展。内置世界书默认启用，设置中可编辑与管理；外部重复世界书请自行停用。

当前安装入口是根目录 manifest.json 和 dist/，不是旧 ZIP、panel/dist 或历史脚本。产品版本以 package.json 为准，战斗规则版本由各场战斗的快照保存。

## 本次更新

3.0.17 修复范围技能在施法射程边缘遗漏相邻波及单位的问题，并将指挥通行反馈从逐轮战报中移除。范围预览、实际结算与战报使用同一组波及目标；普通近战范围与环形保留各自的既有圆心。新战斗使用V37，旧战斗保留保存的规则。详见 [当前发布说明](docs/current-release.md)。

## 使用资料

- [内置世界书](docs/embedded-worldbook.md)、[正文事件显示](docs/native-event-display.md)
- [开战两步布置](docs/secondary-api-two-step-20261002.md)、[地图实现](docs/battlefield-refactor-implementation.md)
- [战斗保存](docs/battle-save-policy-20261016.md)、[MCP 玩家接口](docs/mcp-player-bridge.md)
- [佩戴道具锚定](docs/worn-anchoring-20261020.md)、[特质与道具组合](docs/traits-items-stacking-revision-20261019.md)

## 开发与发布

执行 npm ci、npm run typecheck、npm run build:extension、npm run verify:dist。功能先合入 test，验证后将同一构建晋级到 main，详见 [发布流程](docs/release-channels.md)。

当前源码位于 engine/src、panel/src、host/src、runtime/src、extension/src。历史报告与旧方案位于 docs/history，冻结回放夹具位于 release/baselines/user-20260918；它们用于兼容检查，不代表当前版本。

许可证：**GPL-3.0-only**。允许依 GPL-3.0 商业使用、修改和分发；分发时须遵守对应源代码提供等要求。见 [LICENSE](LICENSE)、[许可说明](LICENSE-NOTES.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。
