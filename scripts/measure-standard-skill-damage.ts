/** Deterministic first-hit measurement; no AI games or repeated random sampling.
 * node node_modules/vite-node/vite-node.mjs scripts/measure-standard-skill-damage.ts
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  generateUnit, SmallBattle, standardField, traitRegistry, skillDefinitionId,
  V30_OVERFLOW_D20, V32_OVERFLOW_D20, diceAvg,
  type RulePack,
} from '../engine/src/index.js';

const registry = traitRegistry();
const definitions = [
  ['weapon-single', '单体剑技', '物理单体近战'],
  ['projectile-single', '单体动能投射', '物理单体投射'],
  ['arcane-single', '单体奥术', '魔法单体奥术'],
  ['thermal-single', '单体热能', '魔法单体热能'],
  ['weapon-area', '范围剑技', '物理范围近战'],
  ['projectile-area', '范围动能投射', '物理范围投射'],
  ['arcane-area', '范围奥术', '魔法范围奥术'],
  ['thermal-area', '范围热能', '魔法范围热能'],
] as const;
const n = (value: number) => Number(value.toFixed(4));
function fixedRng(critical: boolean) {
  let damageDie = 0;
  return { seed: critical ? 'standard-critical' : 'standard-normal', next: () => .5,
    d: (sides: number) => sides === 20 ? critical ? 20 : 18 : sides === 6 ? 3 + damageDie++ % 2 : Math.ceil((sides + 1) / 2) };
}

function cast(level: number, definition: string, tier: 1 | 2, critical: boolean, rules: RulePack) {
  const make = (id: string) => {
    const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', damageModel: 'wounds-v2',
      numericModel: 'graded-v1', loadModel: 'capacity-v2', body: 'human', scale: 'hero', archetype: 'infantry', level,
      weaponClass: 'sword', weaponLevel: level, armorTier: id === 'a' ? 0 : tier, armorLevel: level, traits: [],
      abilityBlueprints: id === 'a' ? [{ id: skillDefinitionId(definition)!, level }] : [] },
      { seed: 'standard:' + id, noVariance: true, registry, skillModel: rules.skillModel }).unit;
    u.id = id; return u;
  };
  const a = make('a'), d = make('d'), field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, d], rules, rng: fixedRng(critical), battlefield: field, traitRegistry: registry });
  b.start(); a.pos = 31; d.pos = 24; b.turnOrder = ['a', 'd']; b.turnIndex = 0;
  const ability = a.abilities[0]!;
  const shown = !critical ? b.getActionOptions(a.id).find(o => o.id === ability.id)?.targets?.find(t => t.targetId === d.id)?.preview : undefined;
  const result = b.useAbility(a.id, ability.id, d.id);
  if (!result.ok || result.resolutions.length !== 1) throw Error(`Cast failed: L${level} ${definition} armor${tier}: ${result.reason ?? result.log}`);
  const resolution = result.resolutions[0]!;
  if (!resolution.hit || resolution.crit !== critical || resolution.participants !== 1 || resolution.overmatchMultiplier !== 1) throw Error('Unexpected hit/critical/participants/overmatch');
  const damage = ability.effects.find(e => e.op === 'damage')!;
  if (damage.op !== 'damage') throw Error('Missing damage effect');
  // Every wound-model source is 8d6 (mean 28); weapon and independent skills share this die shape.
  // The actual resolution's multiplier includes weapon/skill scale, training and all protection layers.
  const nominal = diceAvg(damage.baseDice) * (critical ? 2 : 1) * resolution.dmgMult * (resolution.penetrationFactor ?? 1) * resolution.wardMult;
  if (shown?.normalHitDamage !== undefined && Math.abs(shown.normalHitDamage - nominal) > 1) throw Error('Preview and execution mean differ');
  return { hp: d.base.hpMax, nominal: n(nominal), percent: n(100 * nominal / d.base.hpMax),
    actualLoss: resolution.finalDamage, incoming: resolution.damagePlans?.[0]?.incomingDirect ?? resolution.damagePlans?.[0]?.direct,
    penetration: resolution.penetration, resistance: resolution.resistance, through: resolution.penetrationFactor,
    skillVersion: ability.effectVersion, weaponDamageMult: ability.weaponDamageMult, preview: shown,
    resolution, ability };
}

const rows = [];
for (let level = 1; level <= 10; level++) for (const [kind, label, definition] of definitions) for (const armor of [1, 2] as const) {
  const normal = cast(level, definition, armor, false, V32_OVERFLOW_D20), critical = cast(level, definition, armor, true, V32_OVERFLOW_D20);
  rows.push({ level, kind, label, definition, armor, ...normal, normal: normal.nominal, normalPercent: normal.percent,
    critical: critical.nominal, criticalPercent: critical.percent, criticalActualLoss: critical.actualLoss, criticalResolution: critical.resolution,
    ...(kind === 'weapon-single' ? { before: cast(level, definition, armor, false, V30_OVERFLOW_D20).nominal } : {}) });
}
const out = 'artifacts/standard-skill-damage-v32-20261023'; mkdirSync(out, { recursive: true });
const sourceHash = createHash('sha256');
for (const path of readdirSync('engine/src', { recursive: true }).filter((p): p is string => typeof p === 'string' && p.endsWith('.ts')).sort()) {
  sourceHash.update(path.replaceAll('\\', '/')); sourceHash.update(readFileSync('engine/src/' + path));
}
const metadata = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceSha256: sourceHash.digest('hex'), rules: V32_OVERFLOW_D20.id, configs: rows.length, actualCasts: rows.length * 2 + 20,
  method: 'Fixed mean damage dice and forced normal/critical hits in SmallBattle.useAbility; exact preview normal means checked within rounding; no hit-rate or AI simulation',
  reference: 'human hero infantry; unit/weapon/armor/skill all same level; quality 3; no variance, bonuses, traits, shield, barrier, fatigue or buffs; full HP; adjacent open ground' };
writeFileSync(out + '/results.json', JSON.stringify({ metadata, rows }, null, 2));

const display = (value: number) => value.toFixed(2).replace(/\.00$/, '');
const cell = (r: typeof rows[number], critical = false) => `${display(critical ? r.critical : r.normal)}（${display(critical ? r.criticalPercent : r.normalPercent)}%）`;
const get = (level: number, kind: string, armor: number) => rows.find(r => r.level === level && r.kind === kind && r.armor === armor)!;
function table(weapon: string, spell: string, critical = false) {
  return ['|等级|目标生命|物理→轻甲|物理→中甲|法术→轻甲|法术→中甲|', '|---|---:|---:|---:|---:|---:|',
    ...Array.from({ length: 10 }, (_, i) => { const level = i + 1; return `|L${level}|${get(level, weapon, 1).hp}|${cell(get(level, weapon, 1), critical)}|${cell(get(level, weapon, 2), critical)}|${cell(get(level, spell, 1), critical)}|${cell(get(level, spell, 2), critical)}|`; })];
}
const spellChannelsEqual = rows.filter(r => r.kind.startsWith('arcane')).every(r => r.normal === get(r.level, r.kind.replace('arcane', 'thermal'), r.armor).normal);
if (!spellChannelsEqual) throw Error('Spell channels differ: split the report table');
const lines = [
  '# 标准技能对同级轻甲、中甲伤害（2.10.5 / V32，2026-10-23）', '',
  '用户已选择55%并要求review后发布test、不查询或等待CI。V32将可信生成的直接单体/范围法术与独立单体投射伤害保留55%，同时继承V31的单体武技 ×1.5 校准。V31及以前保存战斗不变；技能实例、强化、附加效果折扣、冷却与资源账本不重写。对单位和结构使用同一校准函数。穿透、护甲、生命、特质与道具成长未调整。', '',
  '## 测量口径', '',
  '- 双方为 human hero / infantry；单位训练、武器、护甲和技能全部同级；品质 3，关闭个体随机浮动。无特质、正负修正、盾牌、屏障、饰品、疲劳或前置增益，目标满血，开阔地相邻。',
  '- 标准物理主表使用同级普通剑的近战单体技法；独立动能投射另列。法术实际分别验证奥术、热能，两通道在本表默认护甲下伤害相同。换用不同武器会改变武技伤害，本表不能代替所有武器。',
  '- 表内为护甲结算后、尚未按目标剩余生命截断的命中伤害均值；括号为占目标最大生命比例。非暴击与暴击分表，均不把未命中计为零。暴击均值超过 100% 表示具备秒杀风险，不表示每次暴击必定击杀。',
  `- 共 ${metadata.configs} 配置、${metadata.actualCasts} 次实际施法（普通命中、暴击，另含旧倍率对照）；以固定均值骰验证实际执行，并核对引擎精确预览的普通命中均值。没有运行 AI 对局或蒙特卡洛循环。`,
  '- 当前生命锚定已包含 graded-v1 的 ×1.5；默认 infantry 的 +4 基础生命一并计算。低等级、其他原型或历史手工生命档案可能不同。', '',
  '## 单体：非暴击', '', ...table('weapon-single', 'arcane-single'), '',
  '## 单体：暴击', '', ...table('weapon-single', 'arcane-single', true), '',
  '## 范围：单个 hero 目标，非暴击', '', ...table('weapon-area', 'arcane-area'), '',
  '范围表只描述一个 hero 在范围内受到的伤害；多人或编队覆盖总伤害不是这张表的乘法外推。本次范围法术同步保留55%，范围剑技与范围动能投射保留原伤害。', '',
  '## 独立动能投射：非暴击', '',
  '|等级|单体→轻甲|单体→中甲|范围→轻甲|范围→中甲|', '|---|---:|---:|---:|---:|',
  ...Array.from({ length: 10 }, (_, i) => { const l = i + 1; return `|L${l}|${cell(get(l, 'projectile-single', 1))}|${cell(get(l, 'projectile-single', 2))}|${cell(get(l, 'projectile-area', 1))}|${cell(get(l, 'projectile-area', 2))}|`; }), '',
  '独立动能投射不使用手持武器预算。单体投射与直接法术同步保留55%，默认同级轻/中甲下仍完全穿透。范围投射保留原伤害，且原穿透低2，轻甲与中甲已有实际减伤差异。', '',
  '## 修复前后与后续调参判断', '',
  '|等级|轻甲：修复前→后|中甲：修复前→后|', '|---|---:|---:|',
  ...[4, 5].map(l => `|L${l}|${display(get(l, 'weapon-single', 1).before!)} → ${display(get(l, 'weapon-single', 1).normal)}|${display(get(l, 'weapon-single', 2).before!)} → ${display(get(l, 'weapon-single', 2).normal)}|`), '',
  '1. 同级剑技在轻甲与中甲之间有实际减伤差异：穿透/防护差为 +0.5 / 0，通过率分别为 77.5% / 55%。当前单体法术穿透为 2L+2，默认轻甲与中甲的热能、奥术防护均被完全穿透，两类护甲的法术伤害相同。',
  '2. 在无增伤基准下，L4/L5单体法术约27.26/32.74，与同级标准剑技打中甲相当；法术仍保留高穿透，普通护甲与专门抗性的角色定位保持。',
  '3. 这张表隔离了增伤组合；狂暴、佩戴和其他强化仍会放大结果。55%校准基础技能，不保证所有进攻组合都无法秒杀薄防御目标。', '',
  '## 复现与验证', '',
  '命令：`node node_modules/vite-node/vite-node.mjs scripts/measure-standard-skill-damage.ts`。完整输入、技能实例、精确预览、普通/暴击实际结算与源码指纹见 `artifacts/standard-skill-damage-v32-20261023/results.json`。V31调整前基线保存在同目录的历史报告 `standard-skill-damage-v31-20261023.md`。', '',
  `测量基线提交：${metadata.head}；含本地调整的 engine/src 指纹：${metadata.sourceSha256}。`, '',
];
writeFileSync('docs/standard-skill-damage-v32-20261023.md', lines.join('\n'));
console.log(JSON.stringify(metadata, null, 2));
console.log(table('weapon-single', 'arcane-single').join('\n'));
