/** 有界机械对照：固定交替攻击序列，不使用完整战场AI，48个配对种子。 */
import { writeFileSync } from 'node:fs';
import { generateUnit, traitRegistry, standardConditionMap, V16_OVERFLOW_D20, V16_OVERFLOW_TW, prepareCombatModel, prepareTraitModel, prepareItemModel, prepareTraitLevelModel,
  resolveAttack, previewAttack, lifestealRecovery, memberHealth, SeededRng, bracePose, type Combatant, type RulePack } from '../engine/src/index.js';
const registry = traitRegistry(), defs = standardConditionMap(), seeds = 48, limit = 30;
const rows: Record<string, number | string>[] = [];
function make(id: string, scale: 'hero' | 'company', traits: string[], level: number, rules: RulePack, rifle = false): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale, rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4,
    hpMax: scale === 'company' ? 30 : undefined, traits, traitLevels: Object.fromEntries(traits.map(t => [t, level])), weaponClass: rifle ? 'rifle' : 'sword', weaponLevel: 5, armorTier: 1, armorLevel: 5, shield: traits.includes('shield-wall') }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, rules); prepareTraitModel(u, rules); prepareItemModel(u, rules); prepareTraitLevelModel(u, rules); return u;
}
for (const mode of ['small', 'mass'] as const) for (const scenario of ['守护防御', '克制步兵进攻', '守护+吸血+克制步兵', '盾墙+守护防御']) for (const level of [1, 5, 10]) {
  const scale = mode === 'small' ? 'hero' : 'company', rules = mode === 'small' ? V16_OVERFLOW_D20 : V16_OVERFLOW_TW;
  let wins = 0, draws = 0, rounds = 0, outgoing = 0, incoming = 0, healing = 0, permanent = 0, preview = 0;
  const first: number[] = [];
  for (let seed = 0; seed < seeds; seed++) {
    const attackTraits = scenario === '克制步兵进攻' ? ['anti-infantry'] : scenario === '守护+吸血+克制步兵' ? ['guardian', 'lifesteal', 'anti-infantry'] : [];
    const defenseTraits = scenario === '守护防御' ? ['guardian'] : scenario === '盾墙+守护防御' ? ['guardian', 'shield-wall'] : [];
    const a = make('a', scale, attackTraits, level, rules, scenario === '盾墙+守护防御'), e = make('e', scale, defenseTraits, level, rules);
    if (mode === 'small') { a.pos = 23; e.pos = 30; } else { a.formationPosition = 'ally:中军:front'; e.formationPosition = 'enemy:中军:front'; }
    if (defenseTraits.includes('shield-wall')) e.tacticalPose = bracePose(e, a, mode, mode === 'small' ? 7 : undefined);
    const rng = new SeededRng('p1:' + seed), opts = (source: Combatant, target: Combatant) => ({ attacker: source, defender: target, rules, conditionDefs: defs, traitRegistry: registry, ranged: source.id === 'a' && scenario === '盾墙+守护防御', distance: 1 });
    if (!seed) preview = previewAttack(opts(a, e)).expectedDamage;
    let round = 0;
    const volley = (source: Combatant, target: Combatant) => {
      let loss = 0;
      // previewAttack表示一次完整武器行动；resolveAttack表示单次连发，战斗执行器也在外层循环。
      for (let shot = 0; shot < (source.weapon?.attacks ?? 1) && target.hp > 0; shot++) {
        const r = resolveAttack({ ...opts(source, target), rng });
        loss += r.hpBefore - r.hpAfter; healing += lifestealRecovery(source, target, r.hpBefore - r.hpAfter);
      }
      return loss;
    };
    for (; round < limit && a.hp > 0 && e.hp > 0; round++) {
      const loss = volley(a, e); outgoing += loss;
      if (!round) first.push(loss);
      if (e.hp <= 0) break;
      incoming += volley(e, a);
    }
    rounds += Math.min(limit, round + 1); wins += Number(e.hp <= 0 && a.hp > 0); draws += Number(e.hp > 0 && a.hp > 0);
    permanent += scale === 'company' ? (a.base.hpMax - a.hp - (a.recoverableWounded ?? 0)) + (e.base.hpMax - e.hp - (e.recoverableWounded ?? 0)) : 0;
  }
  const mean = first.reduce((a, b) => a + b, 0) / seeds, sd = Math.sqrt(first.reduce((a, b) => a + (b - mean) ** 2, 0) / (seeds - 1));
  rows.push({ mode, scenario, level, samples: seeds, preview, firstMean: mean, first95HalfWidth: 1.96 * sd / Math.sqrt(seeds), winRate: wins / seeds, drawRate: draws / seeds,
    rounds: rounds / seeds, outgoing: outgoing / seeds, incoming: incoming / seeds, healing: healing / seeds, permanentCasualties: permanent / seeds });
}
writeFileSync('.diagnostics/traits-l1-l10-20261016/calibration.json', JSON.stringify(rows, null, 2) + '\n');
const n = (v: string | number) => typeof v === 'number' ? v.toFixed(2) : v;
writeFileSync('docs/traits-l1-l10-calibration-20261016.md', `# P1 特质机械对照（2026-10-16）\n\n脚本：\`scripts/calibrate-trait-levels.ts\`。每行48个配对种子，L1/L5/L10，同编成同配装，最多30轮固定双方交替攻击。小战为个体d20，会战为30人成员生命编队TW。直接调用实际伤害/恢复管线，未运行完整空间/军令AI，不能当作全游戏胜率校准。先手方为a；防御场景的等级属于e，进攻与组合场景属于a。相同种子控制初始随机源，分支变化后不保证逐次取样相同。\n\n首击均值附正态近似95%区间半宽，用于发现量级差异；每行仅48次首击样本，不作显著性或全局平衡保证。回合、累计生命伤害、恢复和永久伤亡为机械对照均值，受上限和先后手影响。\n\n|模式|场景|L|预览首击|实测首击 ±95%半宽|a胜率|平局率|轮数|a累计伤害|e累计伤害|总恢复|总永久伤亡|\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.map(r => `|${r.mode}|${r.scenario}|${r.level}|${n(r.preview!)}|${n(r.firstMean!)} ± ${n(r.first95HalfWidth!)}|${n(Number(r.winRate) * 100)}%|${n(Number(r.drawRate) * 100)}%|${n(r.rounds!)}|${n(r.outgoing!)}|${n(r.incoming!)}|${n(r.healing!)}|${n(r.permanentCasualties!)}|`).join('\n')}\n\n未覆盖：再生/医护/毒的P2记账；恐惧与侦察机制；完整地图、资源消耗、寻路、AI选技和多人堆叠。组合收益需要策划下一轮判断。\n`);
console.log(JSON.stringify(rows));
