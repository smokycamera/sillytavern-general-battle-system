# 2.1.1 AI 修正结果

日期：2026-10-17。起点：`origin/test` / `48fab1f`。分支：`fix/ai-2.1.1`。
工作目录：`C:/Users/TC/.codex/worktrees/ai-2-1-1/gbs`。
本地证据根目录：`artifacts/ai-fixes-2.1.1/`；测量脚本与结果不提交。

## 1. 总览

| 项目 | 状态 | 关键结果与证据 |
|---|---|---|
| F1 工事失联搜索 | 已完成并验证 | works-blind 20/20 接敌并结束；A0 首轮 52→38，至搜索目标距离 4→2；`final/works-blind.json`、`engine/tests/intel-memory.test.ts` |
| F2 推定敌人属性 | 已完成并验证 | 隐藏武器改强后推定武器及全部候选 finalScore 不变；重见、旧记录、损坏 seen、隐藏近战起飞必测通过；`engine/tests/intel-memory.test.ts` |
| F3 已承诺火力 | 已完成并验证 | mass-focus 20/20 首轮清场；mass6 胜场差 −2、生命均值保留 99.993%；`final/mass-focus.json`、`final/mass6.json`、`engine/tests/mass.test.ts` |
| F4 失败补令 | 已完成并验证 | 三个容量状态军令与结算快照哈希相同，结算重复估值均 20→0；CPU 变化见 §2；`final/capacity.json`、`engine/tests/mass.test.ts` |
| F5 默认地标 | 已完成并验证 | defend6/113 默认布局正常构造；显式建筑地标容量不足仍报原错；`final/construction/checks/construction-replay-defend6-113.json`、`engine/tests/scene-generation.test.ts` |
| F6 战果即时刷新 | 已完成并验证 | 结算回执后按钮与已入账状态立即刷新且不重复发奖；原样复制的 `panel/src/battle-settlement.integration.test.ts` 通过 |
| §6 AI 修订号 | 已完成并验证 | 两种快照均输出 aiRevision=1；旧档仅追加一条提示，当前档不重复；两种战斗存读档后逐步重放一致；`engine/tests/snapshot.test.ts` |

## 2. V1–V6

| 验收 | 状态 | 基线 → 修复后 | 证据 |
|---|---|---|---|
| V1 works-blind 100–119 | 已完成并验证 | 接敌 0/20→20/20；修复后 20/20 在 60 轮内结束 | `baseline/all.json`、`final/works-blind.json` |
| V2 works-one 100–119 | 已完成并验证 | 正常结束 20/20→20/20 | `baseline/all.json`、`final/works-one.json` |
| V3 mass-focus 200–219 | 已完成并验证 | 首轮清场 0/20→20/20；我方生命均值 720→720 | `baseline/all.json`、`final/mass-focus.json` |
| V4 mass6 100–159 | 已完成并验证 | 我方胜场 30→28；生命均值 499.083→499.050（99.993%） | `baseline/all.json`、`final/mass6.json` |
| V5 容量状态 round1 | 已完成并验证 | 军令、结算快照哈希均相同；重复估值 20→0；CPU 13031→13391 ms（+2.76%） | `baseline/capacity.json`、`final/capacity.json` |
| V5 容量状态 round2 | 已完成并验证 | 军令、结算快照哈希均相同；重复估值 20→0；CPU 13563→17249 ms（+27.18%） | 同上 |
| V5 容量状态 round3 | 已完成并验证 | 军令、结算快照哈希均相同；重复估值 20→0；CPU 13829→18438 ms（+33.33%） | 同上 |
| V6 defend6/113 | 已完成并验证 | constructor-exception→constructed（正常构造） | `baseline/construction/checks/construction-replay-defend6-113.json`、`final/construction/checks/construction-replay-defend6-113.json` |

V3/V4 在 S4 验收；V5 按 S5 在加入 §6 修订字段与迁移日志之前验收。
复现 V3/V4 使用 `1dbdf45`，V5 使用 `62c4c60`，产品代码为 `4a7ccb8`；旧测试对齐为 `16cdbc8`。
会战结束轮数按实际已结算轮数记录（引擎 round 已进入下一轮时减 1）。

## 3. §7.4 主动性对照

| 指标 | 状态 | 基线 | 修复后 |
|---|---|---|---|
| 平局数 | 已完成并验证 | 0/42 | 0/42 |
| 盲区移动接近真实敌人的比例 | 已完成并验证 | 80.247% | 80.247% |
| 无收益往返 | 已完成并验证 | 25 | 25 |
| 最长失联轮数 | 已完成并验证 | 11 | 11 |
| 平均回合数 | 已完成并验证 | 29.548 | 29.548 |

证据：`baseline/initiative.json`、`final/initiative.json`、`comparison.json`；两侧均为完整 42 场，按原工具指标汇总，不设门槛。

## 4. 全量检查

| 项目 | 状态 | 结果与证据 |
|---|---|---|
| typecheck | 已完成并验证 | `npm run typecheck` 通过 |
| 扩展构建 | 已完成并验证 | `npm run build:extension` 通过；生成的 dist 已还原，打包产物仅保留在忽略的 release 目录 |
| 全量失败项对照 | 已完成并验证 | 基线 8→最终 7，新增 0；最终保留名单内的七项，MCP 用例最终通过；`baseline/full-tests.json`、`final/full-tests.json` |
| 固定基线检查脚本 | 已完成并验证 | 最终报告通过 `scripts/check-layered-test-baseline.mjs`；基线漏列项见 §6 |
| smoke:extension / metadata-only | 已实现但未达标 | “命令处理中重复点击不会重复执行或保存”断言失败；48fab1f 同样复现；`baseline/smoke-metadata-only.json`、`final/smoke-metadata-only.json` |
| smoke:extension / legacy-full | 已实现但未达标 | 同一重复点击断言失败；`final/smoke-legacy-full.json` |

## 5. 未覆盖情况

- 旧构造探针把 base 成功命名为 `constructed`，仅对“去除默认地标”的反事实命名为 `legal-snapshot-constructed`；修复成功时反而退出 1。按实际构造成功验收 F5，未修改旧工具与旧证据。
- 主动性沿用现有 harness 的定义：接近比例按各阵营 moved 加权 closingShare（原工具保留两位小数）；最长失联取 lostContact 已记录的最大间隔。
- 旧 V13 工事断言改为 F1 的继续搜索；历史回放哈希仅排除新增 AI 升级提示，其内容与仅追加一次由 §6 必测验证，原数值夹具和结果未改。
- 基线与最终失败清单的唯一减少项是 MCP 集成用例；按指定脚本的“无新增失败”规则验收，未改该脚本或 MCP 测试。

## 6. 规格外发现、未达标项

- 两种浏览器冒烟在重复点击保存计数断言失败；基线 metadata-only 同样失败。复现命令见 §7；未修改规格外的命令执行或保存流程。
- 基线全量已有 `panel/src/mcp-game.integration.test.ts` 的 durable action chains 失败（第 78 行）；`scripts/check-layered-test-baseline.mjs` 的名单未包含它，因此脚本在基线即报错。
- 最终全量保留七项已有失败：`unified-replay.test.ts` 五项、`life-limit-state.test.ts` 两项；最终固定基线检查通过、无新增失败，完整名称见 `final/full-tests.json`。
- V5 消除了重复估值，但三个容量状态的总 CPU 合计 40423→49078 ms（+21.41%）；本规格仅要求报告 CPU，不另改公式或新增机制。

## 7. 复现命令

在对应 worktree 根目录执行；快照和本地工具按规格 §7.1 准备。

```powershell
node node_modules/vite-node/vite-node.mjs artifacts/ai-fixes-2.1.1/run.ts baseline all
node node_modules/vite-node/vite-node.mjs artifacts/ai-fixes-2.1.1/run.ts final works-blind
node node_modules/vite-node/vite-node.mjs artifacts/ai-fixes-2.1.1/run.ts final works-one
node node_modules/vite-node/vite-node.mjs artifacts/ai-fixes-2.1.1/run.ts final mass-focus
node node_modules/vite-node/vite-node.mjs artifacts/ai-fixes-2.1.1/run.ts final mass6
node node_modules/vite-node/vite-node.mjs artifacts/ai-fixes-2.1.1/run.ts final capacity
node node_modules/vite-node/vite-node.mjs scripts/audit-commander-ai.ts --construction-probe=defend6 --seed=113 --out=artifacts/ai-fixes-2.1.1/final/construction
$env:ROOT=(Get-Location).Path
node node_modules/vite-node/vite-node.mjs artifacts/ai-search/harness.ts artifacts/ai-fixes-2.1.1/final/initiative.json
npm run typecheck
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=2 --reporter=json --outputFile=artifacts/ai-fixes-2.1.1/final/full-tests.json
node scripts/check-layered-test-baseline.mjs artifacts/ai-fixes-2.1.1/final/full-tests.json
npm run build:extension
$env:TB_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:TB_METADATA_MODE='metadata-only'; npm run smoke:extension
$env:TB_METADATA_MODE='legacy-full'; npm run smoke:extension
node artifacts/ai-fixes-2.1.1/summarize.mjs
```

未推送 `test`；等待用户审阅结果文档和提交列表后决定。
