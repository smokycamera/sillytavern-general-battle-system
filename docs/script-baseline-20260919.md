# 用户新版脚本接收记录（2026-09-19）

> 此文保留最初接收时的历史状态。随后已完成源码对齐与原生扩展迁移，当前状态见 [README](../README.md) 和 [验收记录](native-extension-validation.md)。

当前交付为用户提供的「战阵 V4 · 全量审计修订 20260918 · 战报武器本名」。本次替换项目中的交付文件；没有操作已安装酒馆的脚本库、真实聊天或浏览器存储。

## 来源与一致性

- 输入：用户提供的 `tavern-battle-script.json`。
- 当前导入文件：`panel/dist/tavern-battle-script.json`，逐字节复制，2,471,657 bytes。
- SHA256：`05b8534c9f65725f38a000c04d25c8e6b9224505fd57ad9969fed39a075c0f57`。
- 固定脚本 ID：`a4c1f7d2-9b3e-4f6a-8d15-2e7c9b40a613`，与旧版一致。
- 保留原文件 `enabled: false`、`data: {}`、`export_with.data: false`。空导出数据不代表已清空其他聊天变量或本地镜像。
- `panel/dist/index.html` 从内嵌 JSON 字符串分片直接拼接还原；`controller.js` 从加载器前缀提取。提取只解析数据、检查语法，不执行输入脚本。
- 旧产物及本次修改前的项目说明、打包器、测试和交付索引保存在 `release/backups/before-user-script-20260919/`。仅备份本次会覆盖的项目文件，未恢复用户已清理的运行数据。

## 源码与成品的关系

工作区旧打包器仍使用「AI主动接战 20260916」名称；旧分发文件为 9 月 17 日构建。新 JSON 含 9 月 18 日修订和自带模块打包代码，工作区缺少其中引用的 `full-audit-20260918.md`、`feedback-20260918.md` 等配套说明。不能把现有 TypeScript 源码宣称为该成品的可重建源码。

`release/current-baseline.json` 将当前状态标为 `sourceStatus: artifact-only`。分发清单不再沿用旧版源码指纹；`release/latest-local-candidate.json` 指向新版脚本，并将旧 ZIP 标为被取代。

`npm run build:dist`、`npm run build:panel` 的前置检查及直接调用 `scripts/pack-loader.mjs` 会拒绝使用旧源码覆盖当前交付。已实际验证拒绝路径和产物哈希不变。不要绕过检查直接用 Vite 输出至 `panel/dist`。

恢复源码构建前，先取得或整理与新版一致的源代码，逐项对齐新版变更并验证，再将基线状态改为已对齐，更新版本元数据并构建。当前文件可直接作为酒馆助手导入文件；导入后的启用状态由用户在酒馆管理。

## 验证范围

- JSON 解析、加载器及提取控制器 JavaScript 语法检查通过；加载器无会截断内联脚本的 `</script` / `<!--` 序列。
- 桌面与 390px 手机的 T1–T7 载入器检查通过：启动、按钮、关闭记忆、重载、悬浮球拖动及位置保留、停用清理、手机全屏。
- 原全流程冒烟测试出现两项旧断言不匹配：库存断言未进入按需渲染的配装页；摘要断言要求已不使用的“叙述任务”标题。
- 单独复核库存：宿主中物品数量为 1；切到配装页后卡片显示，且未凭空生成使用效果。摘要调用链使用 `applySettlementPrompt` 替换旧标题为用户配置的短句。
- 测试已按当前行为修正，正文 T8–T11 复核通过，结果记录于 `artifacts/latest-baseline-check/workflow-smoke.log`，最终结果已同步到基线清单。
- 验证使用本地模拟宿主页和 Edge；不等同于真实 SillyTavern/TauriTavern 安装验收，也不代表对新版全部战斗规则进行了回归测试。旧源码单元测试不能证明新版二进制行为，因此未用它们冒充新版完整验收。

迁移分析见 [酒馆助手与原生扩展比较](extension-migration-assessment-20260919.md)。
