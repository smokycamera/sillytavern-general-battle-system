import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, previewAttack, resolveAttack, SeededRng,
  standardConditionMap, traitRegistry, V33_OVERFLOW_D20, V34_OVERFLOW_D20, SmallBattle, standardField, createStructure,
  type Combatant, type RulePack } from '../src/index.js';
import { anchoredWeaponLabel } from '../src/power-anchors.js';
import { sprayerFuel } from '../src/arms.js';
const conditions = standardConditionMap(), registry = traitRegistry();
function unit(mechanism: string, hero: boolean, rules: RulePack, count = 50): Combatant {
  const u = generateUnit({ name: mechanism, side: mechanism === 'sprayer' ? 'ally' : 'enemy', scale: hero ? 'hero' : 'company',
    ...(hero ? {} : { hpMax: count }), rulesVersion: 'v2', damageModel: 'wounds-v2', numericModel: 'graded-v1', level: 5,
    weaponClass: mechanism, weaponLevel: 5, armorTier: 1, armorLevel: 5, traits: [] }, { seed: mechanism, noVariance: true }).unit;
  prepareCombatModel(u, rules); prepareArmsModel(u, rules); return u;
}
describe('V34 fueled spray', () => {
  it.each([true, false])('raises preview and actual damage for hero=%s while preserving physical equipment and old rules', hero => {
    const a = unit('sprayer', hero, V34_OVERFLOW_D20), d = unit('sword', hero, V34_OVERFLOW_D20), before = JSON.stringify(a.weapon);
    for (const grid of [true, false]) {
      if (grid) { a.pos = 20; d.pos = 21; } else { delete a.pos; delete d.pos; }
      const input = { attacker: a, defender: d, conditionDefs: conditions, traitRegistry: registry, ranged: true, distance: 1 };
      const old = previewAttack({ ...input, rules: V33_OVERFLOW_D20 }), next = previewAttack({ ...input, rules: V34_OVERFLOW_D20 });
      expect(next.expectedDamage).toBeGreaterThan(old.expectedDamage * 1.4);
      const oldHit = resolveAttack({ ...input, defender: structuredClone(d), rules: V33_OVERFLOW_D20, rng: new SeededRng('spray-actual') });
      const newHit = resolveAttack({ ...input, defender: structuredClone(d), rules: V34_OVERFLOW_D20, rng: new SeededRng('spray-actual') });
      expect(newHit.dmgMult).toBe(oldHit.dmgMult * (hero ? 2 : 2.5)); expect(newHit.finalDamage).toBeGreaterThan(oldHit.finalDamage);
    }
    expect(JSON.stringify(a.weapon)).toBe(before);
    expect(anchoredWeaponLabel(a.weapon, a.damageModel, a.artilleryModel, a.sprayerDamageMultiplier)).not.toBe(anchoredWeaponLabel(a.weapon, a.damageModel, a.artilleryModel));
  });
  it('gives a group bonus only while more than one member remains', () => {
    const a = unit('sprayer', true, V34_OVERFLOW_D20), d = unit('sword', false, V34_OVERFLOW_D20);
    const input = { attacker: a, defender: d, rules: V34_OVERFLOW_D20, conditionDefs: conditions, traitRegistry: registry, ranged: true, distance: 1 };
    const hit = (target: Combatant) => resolveAttack({ ...input, defender: structuredClone(target), rng: { seed: 'group-bonus', next: () => .5, d: sides => sides === 20 ? 18 : 3 } });
    expect(hit(d).dmgMult).toBeCloseTo(hit(unit('sword', false, V34_OVERFLOW_D20, 1)).dmgMult * 1.25, 10);
    expect(anchoredWeaponLabel(a.weapon, a.damageModel, a.artilleryModel, a.sprayerDamageMultiplier, a.sprayerGroupDamageMultiplier)).toContain('对多人编队伤害+25%');
  });
  it('keeps grid cones and formation spread in separate preview cache entries', () => {
    const a = unit('sprayer', false, V34_OVERFLOW_D20), d = unit('sword', false, V34_OVERFLOW_D20);
    const input = { attacker: a, defender: d, rules: V34_OVERFLOW_D20, conditionDefs: conditions, traitRegistry: registry, ranged: true, distance: 1 };
    a.pos = 20; d.pos = 21; const grid = previewAttack(input);
    delete a.pos; delete d.pos; const mass = previewAttack(input);
    expect(mass.expectedDamage).toBeGreaterThan(grid.expectedDamage);
    a.pos = 20; d.pos = 21; expect(previewAttack(input)).toEqual(grid);
  });
  it('does not multiply tank ruptures, and keeps the saved rule boundary', () => {
    const a = unit('sprayer', true, V34_OVERFLOW_D20), d = unit('sword', true, V34_OVERFLOW_D20);
    const input = { attacker: a, defender: d, conditionDefs: conditions, traitRegistry: registry, ranged: true, distance: 1, autoHit: true };
    const hit = (rules: RulePack) => resolveAttack({ ...input, defender: structuredClone(d), rules, rng: new SeededRng('tank') });
    expect(hit(V34_OVERFLOW_D20).finalDamage).toBe(hit(V33_OVERFLOW_D20).finalDamage);
    const f = standardField(); f.tiles.fill('open');
    for (const rules of [V33_OVERFLOW_D20, V34_OVERFLOW_D20]) {
      const b = new SmallBattle({ combatants: [structuredClone(a), structuredClone(d)], battlefield: f, rules, seed: 'spray-snapshot' }); b.start();
      const saved = b.toSnapshot(), restored = SmallBattle.fromSnapshot(structuredClone(saved));
      expect(restored.rules.sprayerDamageMultiplier).toBe(rules.sprayerDamageMultiplier);
      expect(restored.byId(a.id).sprayerDamageMultiplier).toBe(rules.sprayerDamageMultiplier);
    }
  });
  it('structure attacks consume the same three fuel charges and cannot bypass an empty tank', () => {
    const a = unit('sprayer', true, V34_OVERFLOW_D20), d = unit('sword', true, V34_OVERFLOW_D20), f = standardField();
    a.id = 'a'; d.id = 'd'; f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null);
    f.structures[45] = createStructure('wall', 10);
    const b = new SmallBattle({ combatants: [a, d], battlefield: f, rules: V34_OVERFLOW_D20, seed: 'spray-fuel' }); b.start();
    b.turnOrder = ['a', 'd']; b.turnIndex = 0; a.pos = 44; d.pos = 3;
    for (let fuel = 2; fuel >= 0; fuel--) {
      b.attackStructure(a.id, 45); expect(sprayerFuel(a, a.weapon!)).toBe(fuel);
      b.endTurn(); b.endTurn();
    }
    expect(b.structurePreview(a.id, 45).reason).toContain('燃料耗尽');
    expect(() => b.attackStructure(a.id, 45)).toThrow('燃料耗尽');
  });
});
