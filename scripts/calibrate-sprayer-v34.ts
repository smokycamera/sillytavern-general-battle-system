import { generateUnit, prepareCombatModel, prepareArmsModel, V33_OVERFLOW_D20, V34_OVERFLOW_D20,
  previewAttack, standardConditionMap, traitRegistry, memberHealth, type Combatant, type RulePack } from '../engine/src/index.js';
const conditions = standardConditionMap(), registry = traitRegistry();
function unit(mechanism: string, level: number, armor: number, grid: boolean, side: 'ally' | 'enemy', hero: boolean, rules: RulePack): Combatant {
  const u = generateUnit({ name: mechanism, side, scale: hero ? 'hero' : 'company', ...(hero ? {} : { hpMax: 50 }),
    rulesVersion: 'v2', damageModel: 'wounds-v2', numericModel: 'graded-v1', level, weaponClass: mechanism, weaponLevel: level,
    armorTier: armor, armorLevel: level, traits: [] }, { seed: `${mechanism}:${level}`, noVariance: true }).unit;
  prepareCombatModel(u, rules); prepareArmsModel(u, rules);
  if (grid) u.pos = side === 'ally' ? 20 : 21;
  return u;
}
for (const hero of [true, false]) for (const grid of [true, false]) for (const level of [3, 5, 8]) for (const armor of [0, 1, 3]) {
  const values: number[] = [];
  for (const [mechanism, rules] of [['sprayer', V33_OVERFLOW_D20], ['sprayer', V34_OVERFLOW_D20], ['rifle', V34_OVERFLOW_D20]] as const) {
    const a = unit(mechanism, level, 0, grid, 'ally', hero, rules), d = unit('sword', level, armor, grid, 'enemy', hero, rules);
    values.push(Number((previewAttack({ attacker: a, defender: d, rules, conditionDefs: conditions, traitRegistry: registry, ranged: true, distance: 1 }).expectedDamage / memberHealth(d) * 100).toFixed(2)));
  }
  console.log(JSON.stringify({ hero, grid, level, armor, oldSprayPct: values[0], newSprayPct: values[1], riflePct: values[2] }));
}
