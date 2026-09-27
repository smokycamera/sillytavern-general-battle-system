import { expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, traitRegistry, standardConditionMap, V7_OVERFLOW_D20, V7_OVERFLOW_TW,
  previewAttack, resolveAttack, type Combatant } from '../src/index.js';
import { compileWeapon } from '../src/gen/equipment.js';
import { parseEnhancementSuffix } from '../src/enhancements.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
function unit(id: string, side: 'ally' | 'enemy'): Combatant {
  const u = generateUnit({ name: id, side, rulesVersion: 'v2', damageModel: 'wounds-v2', scale: 'hero',
    level: 5, weaponClass: 'axe', weaponLevel: 5, armorTier: 0, traits: [], hpMax: 1000 },
  { registry, seed: id, noVariance: true }).unit;
  prepareCombatModel(u, V7_OVERFLOW_D20); return u;
}
const weapon = (mechanism: string, defense: number) => compileWeapon({ mechanism, power: 5, bonuses: { defense } },
  { id: mechanism, seed: mechanism, noVariance: true, damageModel: 'wounds-v2' });

it.each([V7_OVERFLOW_D20, V7_OVERFLOW_TW])('$id 武器正负防御改变命中，与预览一致且不改变抗穿防护', rules => {
  const attacker = unit('attacker', 'ally'), defender = unit('defender', 'enemy');
  const opts = { attacker, defender, rules, conditionDefs, traitRegistry: registry, ranged: true };
  const baseline = previewAttack(opts);
  for (const points of [-10, -6, -3, 0, 3, 6, 10]) {
    defender.weapon = weapon('axe', points);
    const preview = previewAttack(opts), delta = Math.sign(points) * Math.ceil(Math.abs(points) / 3);
    expect(preview.defenseScore).toBe(baseline.defenseScore! + delta);
    expect(preview.resistance).toBe(baseline.resistance);
    expect(preview.protectionPower).toBe(baseline.protectionPower);
    if (points > 0) expect(preview.hitChance).toBeLessThan(baseline.hitChance);
    if (points < 0) expect(preview.hitChance).toBeGreaterThan(baseline.hitChance);
    if (points) expect(preview.defenseModifiers).toContain('武器防御修正');
    const result = resolveAttack({ ...opts, defender: structuredClone(defender),
      rng: { seed: 'hit', next: () => 0, d: (s: number) => s === 20 ? 15 : 4 } });
    expect(result.targetDef).toBe(preview.defenseScore);
  }
});

it('副武器按近战切换生效，主副不叠加，缴械、失能与卸下不残留修正', () => {
  const attacker = unit('attacker', 'ally'), defender = unit('defender', 'enemy');
  const opts = { attacker, defender, rules: V7_OVERFLOW_D20, conditionDefs, traitRegistry: registry, ranged: true };
  defender.weapon = weapon('rifle', 3); defender.sidearm = weapon('axe', 9);
  const base = previewAttack({ ...opts, defender: { ...defender, weapon: undefined, sidearm: undefined } }).defenseScore!;
  expect(previewAttack(opts).defenseScore).toBe(base + 1);
  expect(previewAttack({ ...opts, ranged: false }).defenseScore).toBe(base + 3);
  for (const id of ['disarmed', 'stunned']) {
    defender.conditions = [{ id, dur: 2 }];
    expect(previewAttack(opts).defenseModifiers).not.toContain('武器防御修正');
  }
  defender.conditions = []; defender.status = 'dying';
  expect(previewAttack(opts).defenseModifiers).not.toContain('武器防御修正');
  defender.status = 'ready'; delete defender.weapon;
  expect(previewAttack(opts).defenseScore).toBe(base + 3);
  delete defender.sidearm;
  expect(previewAttack(opts).defenseScore).toBe(base);
});

it('所有武器机制接受有符号防御修正，保留剑术格挡且拒绝越界值', () => {
  for (const mechanism of ['sword', 'spear', 'rifle', 'magic', 'natural']) {
    expect(weapon(mechanism, -3).recipe!.bonuses).toEqual({ defense: -3 });
  }
  expect(parseEnhancementSuffix('剑L5+3防御', 'weapon').bonuses).toEqual({ defense: 3 });
  expect(() => parseEnhancementSuffix('剑L5+11防御', 'weapon')).toThrow();
  const attacker = unit('attacker', 'ally'), defender = unit('defender', 'enemy');
  defender.weapon = weapon('sword', 3);
  const preview = previewAttack({ attacker, defender, rules: V7_OVERFLOW_D20, conditionDefs, traitRegistry: registry, ranged: false });
  expect(preview.defenseModifiers).toContain('剑术格挡 +1');
  expect(preview.defenseModifiers).toContain('武器防御修正 +1');
});
