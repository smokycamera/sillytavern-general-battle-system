# 动能/热能/奥术抵抗 执行计划（2026-10-18）

> 2026-10-19 更新：抗穿方案已被V23新通道减伤替代。以 `traits-items-stacking-revision-20261019.md` 为准；本文件旧抗穿说明仅保留历史记录。

给执行 AI：本文所有设计都已定好，照步骤做，不要自行调整数值、文案或范围。

## 0. 执行须知

- 遵守 `docs/executor-rules.md`：只在信任边界校验，不写防御性代码，只测第 4 节“必测”，全量测试只跑一次；结果写回本文第 8 节，不超过 30 行；本文自相矛盾或期望值对不上时，停下来报告，不要改期望值去迁就代码。
- 工作目录：已建好的 worktree `C:/Users/TC/.codex/worktrees/resist-traits/gbs`，分支 `feat/resist-traits`，基于 origin/test `cb4240f`，node_modules 已链接。**不要在 `D:\gbs` 里改代码**，那里有别的 AI 未提交的内容。本文已放在 worktree 的 `docs/` 下，随实现一起提交。
- 要改的文件都是 LF 换行。用编辑工具做局部替换，不要用 Python 文本模式整文件重写，也不要用 `sed -i`。
- 不改 `dist/`（CI 生成）。不要运行 `npm run verify:worldbook-scope`，那是别的 PR 留下的过期守卫，本来就不通过。
- 只提交到 `feat/resist-traits`，不推送；推不推 test 由用户决定。

## 1. 设计（已定）

三个新的分级特质，L1–L10，归入“防护”组：

| id | 名称 | 通道 | 正文别名 |
| --- | --- | --- | --- |
| `kinetic-resist` | 动能抵抗 | kinetic | 物理抗性、动能抗性、刀枪不入 |
| `thermal-resist` | 热能抵抗 | thermal | 火焰抗性、热能抗性、抗火、耐火、抗寒、耐寒 |
| `arcane-resist` | 奥术抵抗 | arcane | 魔法抗性、法术抗性、奥术抗性、抗魔、魔抗 |

规则：

- **单通道总加成**：对应通道的防护（抗穿）在“护甲 / 身体结构 / 护甲与佩戴品修正”全部算完之后，再加上抵抗值。它与护甲相加，不是取强。
- **数值**：抵抗值为 `2 × woundRatio[L]`。

  | L | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 防护加成 | +0.5 | +1 | +1.5 | +1.75 | +2 | +2.25 | +2.625 | +3 | +3.5 | +4 |

  依据：`woundRatio` 是条目 8 的 V6 单体创伤预算 8…64 ÷ 32，V20 佩戴修正、淬毒、再生用的也是这一组。护甲每高一级，防护多 2，所以 L5 的 +2 正好是同通道高一级护甲，也等于现有单通道防护修正的上限（+10 点 = +2）。L10 的 +4 相当于高两级，没有超出“同级修正不能代替跨代”。
- 抵抗不占护甲、盾、佩戴品防护修正的 ±2 上限，单独相加。
- 防御规格（跨代压制）不另设下限。防护提高后，现有的 `protectionPower` 换算会自然跟着提高，例如中甲 L5 加热能抵抗 L5：热能防护 9→11，热能防御规格 5→6。
- 来源：本体 traits、bless/技能、佩戴道具、旧饰品。同一抵抗有多个来源时取最高一级，不叠加。这是现有机制，不用改。
- 生效范围：特质分级第二阶段规则（`traitLevelModel === 'traits-levels-v2'`，V17 起）；V16 及以前不生效。现有单位都没有这三个 id，所以已有战斗结果不变。
- 只改对应通道的防护。不影响盾牌自身的防护、屏障、守护减伤、毒、治疗、士气和控制。

效果示意：中甲 L5 的热能防护是 9，L5 能量武器的热能穿透是 11。

| 防御方 | 热能防护 | 通过率 |
| --- | --- | --- |
| 无抵抗 | 9 | 100% |
| 热能抵抗 L5 | 11 | 55% |
| 热能抵抗 L10 | 13 | 12% |

裸身单位只加抵抗，防护仍很低（热能抵抗 L10 也只有 4）。所以世界书要提示：天生不怕某类伤害的生物，照写 armor（可配天生护甲）作为基础防护，再加抵抗。

## 2. 边界决策

| 情况 | 结果 |
| --- | --- |
| 有护甲 | 护甲该通道防护 + 抵抗 |
| 大型/巨型身体自带防护 | 身体与护甲照旧先取强，再加抵抗 |
| 护甲直接写了通道防护值（protectionOverride） | 在写定的值上再加抵抗 |
| 护甲/佩戴品有 +N 单通道防护修正 | 修正照旧，抵抗另加，不受 ±2 上限 |
| 同一抵抗来自本体 L3 和 bless L7 | 按 L7 |
| 三种抵抗同时具有 | 各加各的通道，互不影响 |
| 持盾 | 盾的覆盖与盾防护照旧；抵抗只作用于身体这一层 |
| 区域效果 | 火焰区按热能、其他伤害区按动能，抵抗生效；毒区不受影响 |
| 写“热能抵抗”不带 L | L1（现有规则） |
| 写 L11 以上 | 夹到 L10（现有规则） |
| 护甲“强度”的乘方 | 仍只看护甲本身是否主导，不把抵抗算进主导判断 |

## 3. 改动步骤

### 3.1 `engine/src/trait-parameters.ts`

在 `P2_GRADED_TRAITS` 数组末尾（`'recon'` 之后）加入 `'kinetic-resist', 'thermal-resist', 'arcane-resist'`。物品定价、技能 buff、等级解析和门控会因此自动按第二阶段特质处理。

### 3.2 `engine/src/data/traits.ts`

(a) 在 `natural-armor`（天生护甲）条目结束的 `},` 之后、`indomitable` 条目之前插入：

```ts
  {
    id: 'kinetic-resist', name: '动能抵抗', desc: '动能防护按等级额外增加，与护甲相加',
    v2SourceReady: true,
    v2Desc: '刀剑、箭矢、子弹、冲击等动能伤害的抗性（岩石之躯、魔像、刀枪不入）：动能防护+0.5至+4（L5为+2，约等于高一级护甲），与护甲、身体结构相加；不影响热能、奥术',
    effects: [{ kind: 'flag', flag: 'kinetic-resist' }],
  },
  {
    id: 'thermal-resist', name: '热能抵抗', desc: '热能防护按等级额外增加，与护甲相加',
    v2SourceReady: true,
    v2Desc: '火焰、冰霜、能量束等热能伤害的抗性（火元素、耐火体质、抗火药剂）：热能防护+0.5至+4（L5为+2，约等于高一级护甲），与护甲、身体结构相加；不影响动能、奥术',
    effects: [{ kind: 'flag', flag: 'thermal-resist' }],
  },
  {
    id: 'arcane-resist', name: '奥术抵抗', desc: '奥术防护按等级额外增加，与护甲相加',
    v2SourceReady: true,
    v2Desc: '法术与奥术伤害的抗性（抗魔体质、反魔法甲壳、神佑之躯）：奥术防护+0.5至+4（L5为+2，约等于高一级护甲），与护甲、身体结构相加；不影响动能、热能',
    effects: [{ kind: 'flag', flag: 'arcane-resist' }],
  },
```

(b) 在 `TRAIT_ALIASES` 里，`'炼体': 'natural-armor', ...` 那一行之后插入：

```ts
  '物理抗性': 'kinetic-resist', '动能抗性': 'kinetic-resist', '刀枪不入': 'kinetic-resist',
  '火焰抗性': 'thermal-resist', '热能抗性': 'thermal-resist', '抗火': 'thermal-resist', '耐火': 'thermal-resist', '抗寒': 'thermal-resist', '耐寒': 'thermal-resist',
  '魔法抗性': 'arcane-resist', '法术抗性': 'arcane-resist', '奥术抗性': 'arcane-resist', '抗魔': 'arcane-resist', '魔抗': 'arcane-resist',
```

这些词已核对，与现有特质名和别名都不冲突。

### 3.3 `engine/src/gen/generator.ts`

在 `TRAIT_GROUPS.防护` 数组里的 `'natural-armor'` 之后插入 `'kinetic-resist', 'thermal-resist', 'arcane-resist'`。面板选择器靠它显示新特质，`gen.test.ts` 也会检查目录覆盖全部可选特质。

### 3.4 `engine/src/power-anchors.ts`

(a) 在第 2 行 `import { effectiveTraitLevel } from './trait-sources.js';` 之后加一行：

```ts
import { traitParameter } from './trait-parameters.js';
```

(b) 把 `export function anchoredProtection(...)` 的**函数头这一行**替换成下面整段。原函数体一个字都不改，它从此属于 `equipmentProtection`：

```ts
const RESIST_TRAITS = { kinetic: 'kinetic-resist', thermal: 'thermal-resist', arcane: 'arcane-resist' } as const;
type ResistSources = Partial<Pick<Combatant,'rulesVersion'|'traitLevelModel'|'traits'|'traitLevels'|'traitSources'|'gear'|'accessories'>>;
/** 动能/热能/奥术抵抗：该通道防护再加 2×woundRatio[L]（L5 为 +2，相当同通道高一级护甲），不占修正的 ±2 上限。
 * 抵抗只来自本体、bless/技能、佩戴品与旧饰品，身体和装备不会自动派生；先查原始来源，避免每次都归集全部特质。 */
export function resistProtection(unit:ResistSources,channel:DamageChannel):number {
  const id=RESIST_TRAITS[channel];
  if(!phase2Traits(unit)||!(unit.traits?.includes(id)||unit.traitSources?.some(s=>s.traitIds.includes(id))
    ||unit.gear?.some(item=>item.passive?.traits.some(grant=>grant.id===id))||Object.values(unit.accessories??{}).some(item=>item?.traitId===id)))return 0;
  const level=effectiveTraitLevel(unit as Combatant,id);
  return level?2*traitParameter('woundRatio',level):0;
}
/** 实际通道抗穿 = 护甲/身体/修正得到的防护 + 对应抵抗。 */
export function anchoredProtection(unit:ShieldBearer & Pick<Combatant,'armor'|'body'|'shield'|'damageModel'|'armsModel'>&Partial<Pick<Combatant,'gear'|'itemModel'>>&ResistSources,channel:DamageChannel):number {
  return equipmentProtection(unit,channel)+resistProtection(unit,channel);
}
function equipmentProtection(unit:ShieldBearer & Pick<Combatant,'armor'|'body'|'shield'|'damageModel'|'armsModel'>&Partial<Pick<Combatant,'gear'|'itemModel'>>,channel:DamageChannel):number {
```

(c) 子串 `anchoredProtection({...unit,body:'human'},channel)` 在这个文件里恰好出现 2 次，分别在 `armorTransmission` 和 `protectionPower` 里。把两处都替换成 `equipmentProtection({...unit,body:'human'},channel)`。这两处判断的是“护甲是否主导”，不能把抵抗算进去。其余调用 `anchoredProtection` 的地方不改，它们本来就应当包含抵抗。

没有抵抗时，结果是 `原值 + 0`，与改动前逐位相同。

### 3.5 `engine/src/trait-levels.ts`

在 `traitLadderSummary` 里，`    else if (id === 'recon') ...` 这一行之后、`    else return '';` 之前插入：

```ts
    else if (id === 'kinetic-resist' || id === 'thermal-resist' || id === 'arcane-resist') parts.push(`${id === 'kinetic-resist' ? '动能' : id === 'thermal-resist' ? '热能' : '奥术'}防护+${2 * traitParameter('woundRatio', L)}，与护甲同通道相加`);
```

### 3.6 世界书与说明文件

(a) 在 worktree 根目录新建 `tmp-resist-worldbook.cjs`，内容如下，用 `node tmp-resist-worldbook.cjs` 运行，然后删除这个文件：

```js
const fs = require('fs');
const p = 'assets/worldbook/!通用战斗系统约束.json';
const book = JSON.parse(fs.readFileSync(p, 'utf8'));
const entry = Object.values(book.entries).find(e => e.content.includes('防护：守护、再生、坚韧、身法、工事、盾墙、拒马、散兵'));
entry.content = entry.content
  .replace('防护：守护、再生、坚韧、身法、工事、盾墙、拒马、散兵', '防护：守护、再生、坚韧、身法、工事、盾墙、拒马、散兵、动能抵抗、热能抵抗、奥术抵抗')
  .replace('- 不能分级traits:', '- 动能/热能/奥术抵抗：该类伤害的防护在护甲之上再加，L5约等于该通道护甲高一级；天生不怕某类伤害的生物仍照写armor（可配天生护甲）作基础防护\n- 不能分级traits:');
fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
```

然后运行 `npm run build:worldbook`，它会同步重写 `docs/worldbook-xml-markdown.md`。运行 `git diff --stat assets/worldbook`，世界书 JSON 应当只有 1 行改动；如果多于 1 行，停下来报告。

(b) 在 `assets/worldbook/lorebook system explain.md` 的“#### 防护”表格里，`| 天生护甲 |` 那一行之后插入：

```md
| 动能抵抗 | 刀剑、箭矢、子弹、冲击等动能伤害的额外防护：L1–L10 依次+0.5/1/1.5/1.75/2/2.25/2.625/3/3.5/4，加在护甲与身体的动能防护上（L5 约等于高一级护甲），多来源取最高一级 |
| 热能抵抗 | 火焰、冰霜、能量束等热能伤害的额外防护，数值同动能抵抗，只加热能防护 |
| 奥术抵抗 | 法术与奥术伤害的额外防护，数值同动能抵抗，只加奥术防护 |
```

## 4. 必测

新建 `engine/tests/resist-traits.test.ts`，内容如下。只测这些，不要另加矩阵：

```ts
import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareTraitModel, prepareItemModel, prepareTraitLevelModel, grantTraitSource, narrativeTraitLevel, traitLadderSummary,
  V20_OVERFLOW_D20, type Combatant } from '../src/index.js';
import { anchoredProtection, defensePower } from '../src/power-anchors.js';
import { penetrationContext } from '../src/damage.js';

function unit(id: string, armorTier: 0 | 2, traits: Record<string, number> = {}, weaponClass = 'rifle'): Combatant {
  const u = generateUnit({ name: id, side: id === 'e' ? 'enemy' : 'ally', scale: 'company', level: 5, hpMax: 50, rulesVersion: 'v2', damageModel: 'wounds-v2',
    traits: Object.keys(traits), traitLevels: traits, weaponClass, weaponLevel: 5, armorTier, armorLevel: 5 }, { seed: id, noVariance: true }).unit;
  u.id = id;
  prepareCombatModel(u, V20_OVERFLOW_D20); prepareTraitModel(u, V20_OVERFLOW_D20); prepareItemModel(u, V20_OVERFLOW_D20); prepareTraitLevelModel(u, V20_OVERFLOW_D20);
  return u;
}
const protection = (u: Combatant) => (['kinetic', 'thermal', 'arcane'] as const).map(c => anchoredProtection(u, c));

describe('动能/热能/奥术抵抗', () => {
  it.each([
    [0, {}, [0, 0, 0]],
    [0, { 'thermal-resist': 1 }, [0, 0.5, 0]],
    [0, { 'thermal-resist': 10 }, [0, 4, 0]],
    [2, {}, [10, 9, 8]],
    [2, { 'kinetic-resist': 5 }, [12, 9, 8]],
    [2, { 'arcane-resist': 7 }, [10, 9, 10.625]],
    [2, { 'kinetic-resist': 3, 'thermal-resist': 4, 'arcane-resist': 6 }, [11.5, 10.75, 10.25]],
  ] as const)('护甲档%s %j：防护与护甲相加', (tier, traits, expected) => {
    expect(protection(unit('d', tier, { ...traits }))).toEqual(expected);
  });
  it('防御规格只随提高后的防护按现有换算变化', () => {
    expect(defensePower(unit('d', 2, { 'thermal-resist': 5 }), 'thermal')).toBe(6);
    expect(defensePower(unit('d', 2, { 'thermal-resist': 5 }), 'kinetic')).toBe(5);
    expect(defensePower(unit('d', 0, { 'thermal-resist': 10 }), 'thermal')).toBe(5);
  });
  it('伤害管线读到抵抗：L5能量武器打中甲L5', () => {
    const attacker = unit('e', 2, {}, 'energy');
    const pass = (traits: Record<string, number>) => penetrationContext({ attacker, defender: unit('d', 2, traits), ranged: true, rules: V20_OVERFLOW_D20 });
    const none = pass({}), l5 = pass({ 'thermal-resist': 5 }), l10 = pass({ 'thermal-resist': 10 });
    expect([none.resistance, l5.resistance, l10.resistance]).toEqual([9, 11, 13]);
    expect(none.factor).toBeGreaterThan(l5.factor);
    expect(l5.factor).toBeGreaterThan(l10.factor);
  });
  it('bless与佩戴品来源取最高一级，不叠加', () => {
    const d = unit('d', 2, { 'thermal-resist': 3 });
    grantTraitSource(d, { id: 's1', name: '抗火祝福', kind: 'blessing', traitIds: ['thermal-resist'], traitLevels: { 'thermal-resist': 7 }, duration: { kind: 'permanent' } });
    expect(anchoredProtection(d, 'thermal')).toBe(11.625);
    const g = unit('g', 2);
    g.gear = [{ id: 'g1', name: '抗魔护符', passive: { traits: [{ id: 'arcane-resist', level: 4 }] } } as never];
    expect(anchoredProtection(g, 'arcane')).toBe(9.75);
  });
  it('没有第二阶段特质规则时不生效', () => {
    const d = unit('d', 2, { 'thermal-resist': 10 });
    delete d.traitLevelModel;
    expect(anchoredProtection(d, 'thermal')).toBe(9);
  });
  it('正文写法、别名与等级说明', () => {
    expect(narrativeTraitLevel('热能抵抗L6')).toMatchObject({ kind: 'trait', id: 'thermal-resist', level: 6 });
    expect(narrativeTraitLevel('抗魔')).toMatchObject({ kind: 'trait', id: 'arcane-resist', level: 1 });
    expect(narrativeTraitLevel('刀枪不入L12')).toMatchObject({ kind: 'trait', id: 'kinetic-resist', level: 10 });
    expect(traitLadderSummary('thermal-resist', 7)).toBe('L7：热能防护+2.625，与护甲同通道相加');
  });
});
```

已核对的基线（来自 origin/test 实测）：中甲 L5 的防护为 10/9/8，无甲为 0/0/0，中甲 L5 的防御规格为 5，L5 能量武器的热能穿透为 11。

## 5. 验证

1. `npx tsc --noEmit`，必须没有错误。
2. 运行 `npx vitest run engine/tests/resist-traits.test.ts engine/tests/gen.test.ts engine/tests/generic-skills.test.ts engine/tests/traits-phase2-a.test.ts engine/tests/traits-phase2-b.test.ts engine/tests/traits-phase2-c.test.ts engine/tests/trait-levels-v16.test.ts`，必须全部通过。`generic-skills.test.ts` 会自动把三个新特质当作 `buff+特质X` 编译，不用改它。
3. 运行一次全量 `npx vitest run`。仓库里本来就有已知失败，所以对每个失败的测试文件，都在干净的 origin/test 上重跑同一个文件：

   ```bash
   git worktree add C:/Users/TC/.codex/worktrees/resist-base/gbs origin/test
   ```

   PowerShell 里给它建 node_modules 链接：

   ```powershell
   New-Item -ItemType Junction -Path "C:\Users\TC\.codex\worktrees\resist-base\gbs\node_modules" -Target "C:\Users\TC\.codex\worktrees\arms-v2\gbs\node_modules"
   ```

   基线上也失败的属于已知失败。只在新分支上失败的就是回归：写进第 8 节并停下，不要改旧测试的期望值。
4. 自动战斗审计不要和全量测试同时跑，否则会出现假的集成测试超时。

## 6. 提交

```bash
git add -A
git commit -m "feat(traits): 动能/热能/奥术抵抗 L1–L10 单通道防护加成"
```

提交前确认 `git status` 里没有 `tmp-resist-worldbook.cjs` 和 `dist/` 改动。不推送。

## 7. 不做

- 百分比减伤、与护甲取强、给抵抗另设防御规格下限。
- 毒、屏障、治疗、士气、控制方面的抵抗；盾牌自身防护不加抵抗。
- 面板物品预设名（`panel/src/item-spec.ts` 里的“守护护符”一类）、新的 UI 控件、新的规则版本号。
- 根据单位名称或身体自动推断抵抗（如火元素自动获得热能抵抗）。
- 改 `dist/`；跑 `verify:worldbook-scope`。

## 8. 执行结果（执行者填写，≤30 行）

- 状态：已完成并验证（本次抵抗功能及两项测试修复）；全量仍有 6 个已复现的基线失败文件，没有新增失败。
- 改动文件：`engine/src/{trait-parameters.ts,data/traits.ts,gen/generator.ts,power-anchors.ts,trait-levels.ts}`、`engine/tests/{resist-traits,traits-v13}.test.ts`、`panel/src/narrative-tools.integration.test.ts`、两份世界书源文件、`docs/worldbook-xml-markdown.md`、本文。
- 世界书：按用户后续要求删除内置世界书新增的抵抗使用说明，仅在 traits 防护列表增加三个名称；`npm run build:worldbook` 通过并同步可读版，JSON 相对基线仅替换 1 行，临时脚本已删除，`dist/` 由 CI 生成。
- tsc：修复后 `npx tsc --noEmit` 通过，无错误。
- 第 5 节第 2 步：6 文件通过，`engine/tests/gen.test.ts` 加载失败；已执行的 52 个用例全部通过，其中新增抵抗测试 12 个全部通过，新增测试期望值无需改动。
- 全量测试：首轮 8 文件失败；获后续修复授权后追加一次 `npx vitest run`，最终 6 文件失败、225 文件通过；7 用例失败、2158 用例通过，另有 4 个套件加载失败，均与基线一致。
- 基线：干净 `origin/test`（`cb4240f`），worktree 为 `C:/Users/TC/.codex/worktrees/resist-base/gbs`；复跑全部 8 个失败文件，6 失败、2 通过。
- 基线同样失败：`engine/tests/{gen,layered-review,systems,vehicle-armor-v2}.test.ts` 均在 `health-limits.ts:7` 报 `Cannot convert undefined or null to object`；`engine/tests/unified-replay.test.ts` 同样 5 个回放轮数不匹配；`panel/src/life-limit-state.test.ts` 同样 2 个生命上限断言失败。
- 后续修复①：`engine/tests/traits-v13.test.ts:41` 的当前特质目录断言补入“动能抵抗、热能抵抗、奥术抵抗”，与第 3.3 节新增目录保持一致；未调整抵抗数值或新增测试期望值。
- 后续修复②：`panel/src/narrative-tools.integration.test.ts:41` 在草稿变为 `pending` 后等待 `aria-busy` 清除再审批，避免保存尚未结束时点击被忙碌门控忽略；保留入库长度必须为 2 的断言，未改业务代码。
- 修复验证：`npx vitest run engine/tests/traits-v13.test.ts panel/src/narrative-tools.integration.test.ts` 两文件及 25 个用例全部通过；两文件在修复后的全量测试中也全部通过。
- 基线复现：在上述基线目录执行 `npx vitest run engine/tests/gen.test.ts engine/tests/layered-review.test.ts engine/tests/systems.test.ts engine/tests/vehicle-armor-v2.test.ts engine/tests/traits-v13.test.ts engine/tests/unified-replay.test.ts panel/src/life-limit-state.test.ts panel/src/narrative-tools.integration.test.ts`。
- 与本计划不符之处：经用户后续授权，同步旧目录期望值、修复集成测试同步时机并追加全量复测；按用户要求删除内置世界书附加使用说明；规格之外的 6 个基线失败文件未修改。
- 提交与发布：`feat/resist-traits` 本提交包含实现、测试与本文；按用户后续授权更新远端 `test`，`dist/` 由 test-channel CI 生成。
