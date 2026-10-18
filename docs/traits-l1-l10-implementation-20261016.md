# 特质 L1–L10：P0/P1 工程交付（2026-10-16）

范围依据：`traits-l1-l10-sol-handoff-20261016.md` 和 `traits-l1-l10-design-20261016.md`。本批接通 P0 和 P1，不发布、不更新 dist。数值仍是策划候选，机械对照不等于完整战场平衡验收。

**后续用户指令覆盖原稿的一点：新输入不写特质等级，默认 L1。** 历史已保存的省略编码继续按原 L5 读取，原五项专精的旧战斗门控保持原行为。L5 仍是普通旧效果锚点，L8 仍保留已经实现的旧强版本锚点。显式 L5 必须在解析/导出时保留，不能被当成新缺省而丢弃。

## 实际完成范围

原五项专精保留；新增以下 11 类的真实分级执行器、来源解析、累计说明和新输入：

| 特质 | 参数名（统一在 `engine/src/trait-parameters.ts`） | 实际执行入口 |
| --- | --- | --- |
| 守护 | `guardianReduction` | `bonus.ts::traitRuntimeMods`，与其他守护同组取强 |
| 吸血 | `lifestealRatio` | `recovery.ts::lifestealAmount/lifestealRecovery`，战斗执行器传入真实生命损失 |
| 偷袭 | `sneakMultiplier` | `situational-traits.ts::situationalTraitMods`，潜伏/夹击及魔法例外保留 |
| 耐力训练 | `fatigueMultiplier` | `tactics.ts::fatigueAfter`，实际疲劳与 AI 疲劳预测共用 |
| 践踏 | `trampleMultiplier` | `bonus.ts::traitRuntimeMods` 的合法近战冲锋及身体大小分支 |
| 盾墙 | `shieldReduction` | `tactics.ts::defensivePostureMods`，盾牌、姿态、行动能力、正面远程前提保留 |
| 破甲 | `penetrationBudget` | `trait-sources.ts::traitPenetrationBonus` → `damage.ts::penetrationContext`，动能及 floor(基础穿透/3) 上限保留 |
| 克制步兵 | `counterAttack/counterMultiplier` | `bonus.ts::traitRuntimeMods` → `actualTargetTag`，按实际身体/骑乘/空中状态识别 |
| 克制大型 | 同上 | 同上，与对空同组取强；旧屠兽者投影为 L8 |
| 顽固 | `resilience` | `trait-sources.ts::traitStatContributions/traitStatAdjustments/normalizeBakedTraitStats`、`morale.ts::moraleProfile` |
| 统率 | `command` | `morale.ts::moraleProfile`，小战3格/会战1阵位，视线、可见性、来源状态和同组取强不变 |

大守护→守护 L8，破甲大师→破甲 L8，屠兽者→克制大型 L8。旧 id 仍在注册表和历史实例中，新的可选目录只列规范名。恐怖暂不合并。

## 数据流与执行器清单

| 环节 | 具体函数和关键分支 |
| --- | --- |
| 正文名称/等级 | `data/traits.ts::narrativeTraitLevel/narrativeTraitList/traitLevelToken`；别名先投影，重复规范名取最高，新输入未标为L1，历史省略导出为显式L5 |
| 正文事件 | `panel/protocol.ts::parseProtocol` 规范化；`tags.ts` 的 bless 分支保留显式L5并去重；`narrative-state.ts::spawnInput/applyUnitEffect`；`unit-set.ts::applyUnitSet` 的绝对赋值分支 |
| 生成/编辑 | `gen/mechanism.ts::generateMechanismUnit` 保存新输入的默认L1；`unit-builder.ts::buildUnit/editUnitBuild`；`unit-form.ts::captureUnitDraft` 保留所选等级 |
| 来源归集 | `trait-sources.ts::activeTraitIds/traitLevelSources/effectiveTraitLevel`；覆盖本体、有效祝福/技能、当前装备来源、佩戴、旧配件、身体及装备自动来源；最高级失效后重新取最高 |
| 生命周期 | `grantTraitSource` 保留 sourceId 幂等；`traitSourceActive` 检查期限、撤销及装备依赖；`expireTraitSources/revokeTraitSource` 不覆盖本体；新V16来源未标等级写入L1，历史来源重放保留其旧编码 |
| 自动散兵 | `autoLooseFormation/equipmentTraitIds`；自动来源明确为 L5。本批不开放散兵等级输入或新执行机制 |
| 永久属性 | `bakedTraitStats` 的旧审计回退按历史常量读取；运行时以当前贡献减已烘焙贡献；`normalizeBakedTraitStats` 只烘焙本体；`xp.ts::recomputeFromCurve` 先重建历史基值再做等级净修正，临时高等级不能混入升级基础 |
| 规则版本 | 新增 `V16_OVERFLOW_D20/TW` 和 `traitLevelModel: traits-levels-v1`；`prepareTraitLevelModel` 由战斗规则投影或移除。无此标记时P1仍走旧逻辑，五项专精继续只看V15 itemModel |
| 战斗/快照 | `SmallBattle/MassBattle` 构造、`toSnapshot/fromSnapshot`、V2召唤入场投影；新遭遇默认V16，恢复旧快照继续使用原 rulesId |
| 伤害/预览 | `damage.ts::attackContext/penetrationContext/previewAttack/resolveAttack` 走同一加成栈；小战/会战 `environmentContext` 注入统一偷袭、心理等条件效果。抽样预览键保留等级、来源状态和规则标记 |
| 技能授予 | `skill-effects.ts::skillTraitGrant/skillTraitReason/applySkillTrait/skillEffectLines`；新规则比较整个未来持续区间，接受本体L3→临时L8及短L8→长L6；工事重建单独保留，同一次施放重放不重复重建 |
| AI | `skillEffectValue` 用与执行相同的授予等级，按旧来源到期分段评分；`skill-tactics.ts::actionPotential/tacticalStateValue` 接入统一伤害、偷袭/心理及吸血参数；同上下文的等级/来源变化使相关缓存失效 |
| 面板/正文事实 | `main.ts` 的特质详情显示累计效果、来源等级、被高等级覆盖及前提失效；破甲显示当前实际穿透加值，盾墙说明固守条件；`narrative-controller.ts` 输出当前等级效果和来源；`item-description.ts` 识别新旧别名覆盖 |
| 佩戴预算 | `items.ts::traitPoints/passiveCost/normalizeTraitGrants/compileItemValue/validateItemValue`；新配方写 `traitBudgetModel`，旧无标记配方按历史预算和布尔授予校验，不读档重编译 |
| 保存/恢复/导出 | `unit-state.ts::combatantFromUnknown/unitRecordFromCombatant/materializeUnitRecord/unitRecordToGenerateInput` 校验标记并保存等级/来源；历史输入再生成时显式补回原L5；表单读取旧记录也显示原L5 |
| 说明同步 | `scripts/sync-trait-level-docs.ts` 读取执行器同一参数源，生成世界书说明中的P1累计效果；`scripts/build-worldbook.ts` 同步阅读版。没有运行dist构建 |

纯参数与别名在 `trait-parameters.ts`；规则门控在 `trait-level-model.ts`；来源解析在 `trait-sources.ts`；`trait-levels.ts` 提供调用端入口和累计说明。参数模块不反向依赖来源层。

## 预算兼容与有意保留的差异

- 新佩戴配方按分段锚点插值向上取整。P1普通 L5=3 点；守护/破甲 L8=6 点，L10=8 点。原五项专精仍 ceil(L/2)。再生尚未分级，仍6点。
- **屠兽者实际旧价是3点**：它原本不在 `STRONG_TRAITS`。因此克制大型 C8=3，C10=5；没有根据“强版名称”猜成6点。它在L5到L8的效果上升但价格保持3点，是保留旧配方锚点后的实质结果，建议策划下一轮单独判断。
- 旧配方保持冻结编译效果和旧预算，不因新价格变动读档失败；原技能“守护”替换到守护状态的路径未改成直接授予 guardian。
- 新输入不标等级现在为L1（用户后续要求）；历史缺省仍L5，明确L5导出不省略。旧强名称仍固定投影L8；其他等级用规范名表达。
- 同一规范特质取最高，不相加；只对原来同组的效果取强，不新增全局增伤/减伤上限。
- AI分段评分解决授予等级和期限错配；它仍是有限视野启发式，不能视为完整多轮最优解。吸血估值以预计生命伤害估计恢复，实际恢复仍按每次真实生命损失及合法伤口/伤兵上限结算。

## 验证与机械对照

新增 `engine/tests/trait-levels-v16.test.ts` 与 `panel/src/trait-levels-v16.integration.test.ts` 验证真实跨模块链路：

- 来源升级/回退、撤装备/祝福、别名去重及保留期限、自动散兵L5。
- 本体L3+临时L8，短高长低接续，同id事件重放与工事独立重建。
- 小战/会战快照、单位JSON保存恢复、旧rulesId移除新门控、历史省略L5与新输入默认L1、显式L5往返。
- 真实伤害/预览/AI的等级变化、同上下文缓存失效、实际盾牌/方向/动能/身体前提。
- 顽固净修正、反复烘焙及带临时高等级升级时不永久复制收益。
- 旧佩戴配方合法性、旧价锚点、表单选择→建档→导出→恢复→编辑。

最终验证：26个测试文件、279项测试全部通过，0失败；`npm run typecheck`通过；`npx vite-node scripts/sync-trait-level-docs.ts --check`、`npx vite-node scripts/build-worldbook.ts --check`、`git diff --check`通过。机器可读结果保存在 `.diagnostics/traits-l1-l10-20261016/tests.json`，包含每个测试文件和用例。相对任务开始时基线，dist新增改动为0。

现有的特质、道具、士气、恢复、XP、正文、表单、技能AI、屏障预览缓存、主面板、战斗控件与单位编辑回归均纳入上述检查。没有逐次数字修改重跑全仓大型仿真。

对照脚本：`scripts/calibrate-trait-levels.ts`；完整结果：`traits-l1-l10-calibration-20261016.md`。4类场景×2种规模×3个等级，每行48个配对种子，总计1152次有界机械对局。固定交替行动，最多30轮，记录首个完整武器行动（含连发）的预览/实测伤害、近似95%区间、累计生命伤害、恢复、轮数、胜负与永久伤亡。它不运行完整地图或军令AI。

代表结果（L1/L5/L10）：

- 个体克制步兵的预览首击为19.96 / 25.40 / 34.31；实测21.60 / 27.35 / 35.29，差异处于本批首击采样波动范围。
- 个体守护防御的攻击方预览首击为16.68 / 13.17 / 9.66；防御等级上升确实减少生命损失。
- 个体“守护+吸血+克制步兵”的先手方胜率为64.58% / 91.67% / 100%，平均恢复0.67 / 5.63 / 7.42；这是建议继续检查的高等级组合。
- 会战同组合的胜率三档均100%，已经饱和。应看累计受损1137.44 / 694.71 / 320.65、平均轮数11.79 / 8.83 / 6.23等指标，不能据此声称三档效果相同。
- 会战同组合平均恢复91.98 / 408.08 / 290.46。L10杀得更快、受伤更少，因此总恢复下降；恢复上限和机会不同，并不代表吸血比例升级变弱。

## 未完成项目和具体设计冲突

这些项目继续保留现有布尔行为，未开放新的L1–L10输入选择；不是“能输入L10就算完成”。

| 项目 | 当前冲突 | 下一轮可比较的设计选项 |
| --- | --- | --- |
| 再生 | `regenerationAmount/applyRecovery` 会取整；1.5/2.5等候选量需要可保存的小数余量；满血、失能、来源切换及结算边界尚未定 | 单位级周期余量并在满血时清零，或按来源记账；须明确切源是否清零、暂停是否保留及旧档编码 |
| 医护 | `woundedFromLoss` 当前余量是旧2/4人数分组编码，不能直接当百分比分母余量 | 为新规则增加独立百分比记账编码，旧规则继续原分组；需要明确历史余量首次切换的转换/封存策略 |
| 淬毒 | 已有状态强度和旧实际伤害分支/AI去重，需要命中时冻结等级效力及固定3轮 | 统一毒状态快照强度，并同时改实际DOT与poisonValue；先明确技能毒/武器毒同源与续期规则 |
| 恐惧/恐怖 | 只给压力数组还不足以保留攻击惩罚、残余压力抵消和按本体限次惊退 | 补完整逐级心理表，再投影恐怖；保留旧id及terrorSeen历史，不提前合并 |
| 工事/拒马/散兵/游击 | 同时含收益、副作用和状态门槛，尚无完整组合表 | 补命中/防御/减伤/展开/机动的组合阶梯，比较同一编队有无特质；本批只修复工事授予重建判定 |
| 坚韧/身法/工兵 | 推拉免疫、地形全免和无视工事是离散能力，没有阈值表 | 明确低级部分减免和L5全能力门槛，再给L6–10相关收益 |
| 潜伏/侦察 | 缺少两种战场的等级×距离确定性判定表 | 补小战/会战表及地形专精“视同潜伏L5”的交互，维持夜视/视线/接敌暴露前提 |
| 射击专家/冲锋强化/狂暴/近战特化/对空 | 整数命中不能直接消费小数；对空射程损耗门槛缺表 | 补离散档位和相关条件收益，狂暴代价不能随等级同比加重；不修改全局命中公式来填阶梯 |

P2记账与机制表及P3完整组合/空间AI验收仍待后续批次。本批未触碰这些特质的强度常数。

## 工作区边界

开始时工作区已有大量未提交改动。基线保存于 `.diagnostics/traits-l1-l10-20261016/before.patch` 和 `before-status.txt`；用独立临时索引重建基线并检查本批增量，dist不在本批增量中。没有还原既有修改，没有提交或发布整个工作区。

本批文件主要为上述执行器、规则/参数/来源、输入/面板/保存链路、世界书说明、两份测试和两个同步/校准脚本。`implementation.patch` 用于查看相对开始时工作区的已跟踪文件增量；新增文件另列在git状态中。
