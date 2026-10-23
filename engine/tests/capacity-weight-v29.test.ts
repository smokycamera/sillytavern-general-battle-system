import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, prepareTraitModel, prepareTraitLevelModel,
  V28_OVERFLOW_D20, V28_OVERFLOW_TW, V29_OVERFLOW_D20, V29_OVERFLOW_TW, LOAD_MODEL,
  SmallBattle, MassBattle, standardField, compileItem, movementPoints, bodyMovement, traitRegistry,
  type Combatant, type GenerateInput, type RulePack, type ItemSpecification } from '../src/index.js';
import { equipmentLoad, equipmentCapacity, equipmentBurden, loadMovementScale } from '../src/equipment-load.js';
import { ENHANCEMENT_STATS, parseEnhancementSuffix, validateEnhancements } from '../src/enhancements.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';

const registry = traitRegistry();
function unit(patch: Partial<GenerateInput> = {}, rules: RulePack = V29_OVERFLOW_D20): Combatant {
  const u = generateUnit({ name: 'carrier', side: 'ally', scale: 'hero', rulesVersion: 'v2',
    damageModel: 'wounds-v2', numericModel: 'graded-v1', loadModel: rules.loadModel,
    body: 'human', level: 5, weaponClass: 'sword', weaponLevel: 5, armorTier: 0, traits: [], ...patch },
  { registry, noVariance: true, seed: patch.name ?? 'carrier' }).unit;
  prepareCombatModel(u, rules); prepareArmsModel(u, rules); prepareTraitModel(u, rules); prepareTraitLevelModel(u, rules);
  return u;
}

describe('V29 capacity and equipment weight', () => {
  it('anchors human heavy melee, large autocannons, giant cannons and graded vehicle chassis below 80%', () => {
    for (const [body, weaponClass] of [['human', 'heavy-polearm'], ['human', 'greatsword'],
      ['large', 'autocannon'], ['giant', 'cannon'], ['vehicle', 'cannon']] as const) {
      for (const [level, armorTier] of [[4, 3], [5, 4]] as const) {
        const u = unit({ body, weaponClass, level, armorTier });
        expect(equipmentLoad(u), `${body} L${level}`).toBeLessThanOrEqual(.8 * equipmentCapacity(u));
        expect(equipmentBurden(u)).toBe(0);
        expect(loadMovementScale(u)).toBe(1);
      }
    }
    const lower = unit({ body: 'vehicle', level: 3, armorTier: 3, weaponClass: 'cannon' });
    expect(equipmentLoad(lower)).toBe(18); expect(equipmentCapacity(lower)).toBe(20);
    expect(movementPoints(lower)).toBeCloseTo(2.55);
    const human = unit({ level: 10 }), large = unit({ level: 10, body: 'large' }), giant = unit({ level: 10, body: 'giant' });
    expect(equipmentCapacity(human)).toBe(24); expect(equipmentCapacity(large)).toBe(36); expect(equipmentCapacity(giant)).toBe(48);
    for (const body of ['human', 'large', 'giant', 'vehicle'] as const) {
      let previous = 0;
      for (let level = 1; level <= 10; level++) {
        const current = equipmentCapacity(unit({ body, level })); expect(current).toBeGreaterThan(previous); previous = current;
      }
    }
    expect(equipmentCapacity(unit({ body: 'vehicle', level: 1 }))).toBe(12);
    expect(equipmentCapacity(unit({ body: 'vehicle', level: 10 }))).toBe(60);
  });

  it('changes only physical artillery loads; damage and old compiled equipment remain intact', () => {
    for (const [weaponClass, load] of [['autocannon', 8], ['cannon', 12], ['indirect-cannon', 12], ['rocket', 3]] as const) {
      const current = unit({ weaponClass }), old = unit({ weaponClass }, V28_OVERFLOW_D20);
      expect(current.weapon!.load).toBe(load); expect(old.weapon!.load).toBe(weaponClass === 'rocket' ? 2 : 6);
      for (const key of ['baseDice', 'apDice', 'penetration', 'range', 'attacks', 'reload'] as const) expect(current.weapon![key]).toEqual(old.weapon![key]);
      const frozen = structuredClone(old.weapon);
      prepareCombatModel(old, V29_OVERFLOW_D20); prepareArmsModel(old, V29_OVERFLOW_D20);
      expect(old.weapon).toEqual(frozen);
    }
  });

  it('lets L2 light-armored human artillery share existing crews while solo heroes bear the whole weapon', () => {
    const gun = unit({ scale: 'company', level: 2, armorTier: 1, weaponClass: 'cannon' });
    const auto = unit({ scale: 'company', level: 2, armorTier: 1, weaponClass: 'autocannon' });
    expect(equipmentLoad(gun)).toBe(5); expect(equipmentLoad(auto)).toBe(6);
    expect(movementPoints(gun)).toBe(3); expect(movementPoints(auto)).toBe(3);
    expect(equipmentLoad(unit({ level: 2, armorTier: 1, weaponClass: 'cannon' }))).toBe(14);
    const rocket = unit({ scale: 'company', level: 2, armorTier: 1, weaponClass: 'rocket', sidearmClass: 'autocannon', sidearmLevel: 2 });
    expect(equipmentLoad(rocket)).toBe(1.5 + 4 + 2);
    expect(equipmentLoad(unit({ scale: 'company', level: 2, armorTier: 1, weaponClass: 'cannon' }, V28_OVERFLOW_D20))).toBe(8);
    expect(equipmentLoad(unit({ scale: 'company', body: 'vehicle', level: 2, armorTier: 1, weaponClass: 'cannon' }))).toBe(14);
  });

  it('each signed weight point changes actual weapon, armor and shield load independently of L and power', () => {
    for (const kind of ['weapon', 'armor', 'shield'] as const) {
      let previous = -1;
      for (let weight = -10; weight <= 10; weight++) {
        const base = { power: 5, bonuses: { weight } };
        const spec: ItemSpecification = kind === 'weapon' ? { ...base, kind, mechanism: 'cannon' }
          : kind === 'armor' ? { ...base, kind, tier: 3 } : { ...base, kind, mechanism: 'shield' };
        const current = compileItem(spec, { id: 'physical', seed: 'physical', loadModel: LOAD_MODEL, numericModel: 'graded-v1' });
        if (current.kind === 'item') throw Error('unexpected consumable');
        const load = current.value.load!;
        expect(load).toBeGreaterThan(0); expect(load).toBeGreaterThan(previous);
        if (previous > 0) expect(load / previous).toBeCloseTo(1.1, 9);
        previous = load;
        const higher = compileItem({ ...spec, power: 10, bonuses: { weight, power: 10 } }, { id: 'physical', seed: 'physical', loadModel: LOAD_MODEL, numericModel: 'graded-v1' });
        if (higher.kind === 'item') throw Error('unexpected consumable');
        expect(higher.value.load).toBe(load);
      }
    }
    const a = unit({ shield: true, shieldClass: 'shield', shieldBonuses: { weight: -2 },
      armorTier: 3, armorBonuses: { weight: -1 }, weaponClass: 'cannon', weaponBonuses: { weight: 1 } });
    expect(a.weapon!.load).toBeCloseTo(13.2); expect(a.armor!.load).toBeCloseTo(6 / 1.1);
    expect(a.shield!.load).toBeCloseTo(1.5 / 1.1 ** 2);
    expect(equipmentLoad(a)).toBeCloseTo(13.2 + 6 / 1.1 + 1.5 / 1.1 ** 2);
    expect(unit({ weaponClass: 'natural', weaponBonuses: { weight: 10 } }).weapon!.load).toBe(0);
  });

  it('does not impose a modifier-count cap; duplicate directions and invalid ranges stay rejected', () => {
    const text = 'L5' + ENHANCEMENT_STATS.weapon.map(stat => '+1' + stat).join('');
    const parsed = parseEnhancementSuffix(text, 'weapon');
    expect(Object.keys(parsed.bonuses!)).toHaveLength(ENHANCEMENT_STATS.weapon.length);
    expect(parsed.bonuses!.weight).toBe(1);
    expect(() => validateEnhancements(parsed.bonuses, 'weapon')).not.toThrow();
    expect(() => parseEnhancementSuffix('L5-10重量+1重量', 'weapon')).toThrow();
    expect(() => parseEnhancementSuffix('L5+11重量', 'weapon')).toThrow();
    expect(() => parseEnhancementSuffix('L5-1重量', 'unit')).toThrow();
    expect(parseEnhancementSuffix('L5-10负重', 'armor').bonuses).toEqual({ weight: -10 });
  });

  it('uses load ratio for new vehicle movement and keeps old fixed weapon penalties frozen', () => {
    const current = unit({ body: 'vehicle', level: 5, armorTier: 4, weaponClass: 'cannon' });
    const old = unit({ body: 'vehicle', level: 5, armorTier: 4, weaponClass: 'cannon' }, V28_OVERFLOW_D20);
    expect(equipmentLoad(current)).toBe(20); expect(movementPoints(current)).toBe(3);
    expect(bodyMovement(old)).toBe(2); expect(equipmentLoad(old)).toBe(11);
    current.armor = undefined; current.weapon!.load = equipmentCapacity(current) * .8;
    expect(movementPoints(current)).toBe(3);
    current.weapon!.load += .001; expect(movementPoints(current)).toBeLessThan(3);
    current.weapon!.load = equipmentCapacity(current) * 2;
    expect(loadMovementScale(current)).toBeCloseTo(.175);
  });

  it('round-trips both battle modes and rejects unknown load models without upgrading old snapshots', () => {
    for (const old of [true, false]) for (const mass of [true, false]) {
      const rules = old ? mass ? V28_OVERFLOW_TW : V28_OVERFLOW_D20 : mass ? V29_OVERFLOW_TW : V29_OVERFLOW_D20;
      const a = unit({ name: 'a', body: 'vehicle', level: 10, weaponClass: 'cannon', weaponBonuses: old ? {} : { weight: 3 }, scale: mass ? 'company' : 'hero' }, rules);
      const d = unit({ name: 'd', side: 'enemy', scale: mass ? 'company' : 'hero' }, rules);
      const field = standardField(); field.tiles.fill('open');
      const opts = { combatants: [a, d], rules, seed: 'load-snapshot', traitRegistry: registry };
      const battle = mass ? new MassBattle(opts) : new SmallBattle({ ...opts, battlefield: field });
      battle.start(); const snapshot = battle.toSnapshot();
      const restored = mass ? MassBattle.fromSnapshot(structuredClone(snapshot), { traitRegistry: registry }) : SmallBattle.fromSnapshot(structuredClone(snapshot), { traitRegistry: registry });
      expect(restored.toSnapshot()).toEqual(snapshot);
      expect(equipmentCapacity(a)).toBe(old ? 24 : 60);
      expect(combatantFromUnknown(JSON.parse(JSON.stringify(a))).loadModel).toBe(old ? undefined : LOAD_MODEL);
    }
    const bad = unit(); (bad as { loadModel?: string }).loadModel = 'unknown';
    expect(() => combatantFromUnknown(bad)).toThrow();
  });
});
