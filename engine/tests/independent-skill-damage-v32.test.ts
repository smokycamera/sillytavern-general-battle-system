import { describe, expect, it } from 'vitest';
import {
  generateUnit, prepareCombatModel, prepareArmsModel, prepareSkillModel, upgradeCombatSkills,
  skillDefinitionId, skillAttack, previewAttack, resolveAttack, traitRegistry, standardConditionMap,
  SmallBattle, MassBattle, standardField, createStructure, V31_OVERFLOW_D20, V31_OVERFLOW_TW, V32_OVERFLOW_D20, V32_OVERFLOW_TW,
  V36_OVERFLOW_D20, V36_OVERFLOW_TW,
  type Combatant, type GenerateInput, type RulePack, type AttackOpts, type AttackResolution,
} from '../src/index.js';
import { buildEncounter } from '../../panel/src/game-encounter.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
const fixed = () => ({ seed: 'v32-hit', next: () => 0, d: (sides: number) => sides === 20 ? 18 : 3 });
function unit(id: string, definition?: string, extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', damageModel: 'wounds-v2',
    numericModel: 'graded-v1', loadModel: 'capacity-v2', scale: 'hero', level: 5, weaponClass: 'sword', weaponLevel: 5,
    armorTier: 2, armorLevel: 5, traits: [], abilityBlueprints: definition ? [{ id: skillDefinitionId(definition)!, level: 5 }] : [], ...extra },
    { seed: id, registry, noVariance: true, skillModel: 'skills-v4' }).unit;
  u.id = id; u.pos = id === 'a' ? 0 : 1;
  prepareCombatModel(u, V32_OVERFLOW_D20); prepareArmsModel(u, V32_OVERFLOW_D20);
  prepareSkillModel(u, V32_OVERFLOW_D20); upgradeCombatSkills(u); return u;
}
function options(a: Combatant, d: Combatant, rules: RulePack): Omit<AttackOpts, 'rng'> {
  const ability = a.abilities[0]!, effect = ability.effects.find(e => e.op === 'damage');
  if (effect?.op !== 'damage') throw Error('Missing damage');
  return { attacker: a, defender: d, rules, conditionDefs, traitRegistry: registry, distance: 1,
    ...skillAttack({ mode: 'small', units: [a, d], fieldTags: [] }, a, d, ability, effect, rules) };
}

describe('V32 independent direct damage at 55%', () => {
  it('scales single/area spells and single kinetic projectiles once while keeping hit, penetration and secondary effects', () => {
    for (const definition of ['魔法单体奥术', '魔法范围奥术', '魔法单体热能', '魔法范围热能', '物理单体投射', '魔法单体热能灼烧']) {
      const a = unit('a', definition), d = unit('d'), before = structuredClone(a);
      const old = options(a, d, V31_OVERFLOW_D20), next = options(a, d, V32_OVERFLOW_D20);
      expect(next.abilityDamage!.damageScale).toBeCloseTo(old.abilityDamage!.damageScale! * .55, 10);
      const p = previewAttack(old), q = previewAttack(next);
      expect(q.normalHitDamage).toBeCloseTo(p.normalHitDamage! * .55, 7);
      expect([q.hitChance, q.penetrationFactor, q.participants]).toEqual([p.hitChance, p.penetrationFactor, p.participants]);
      const r = resolveAttack({ ...old, defender: structuredClone(d), rng: fixed() });
      const s = resolveAttack({ ...next, defender: structuredClone(d), rng: fixed() });
      expect(s.dmgMult).toBeCloseTo(r.dmgMult * .55, 10);
      expect(a).toEqual(before);
    }
  });

  it('preserves weapon/enchanted techniques, area projectiles, debuff damage and frozen/custom/item sources', () => {
    for (const definition of ['物理单体近战', '物理范围近战', '物理范围投射', '减益灼烧']) {
      const a = unit('a', definition, { weaponEnchantment: 'thermal' }), d = unit('d');
      expect(previewAttack(options(a, d, V32_OVERFLOW_D20))).toEqual(previewAttack(options(a, d, V31_OVERFLOW_D20)));
    }
    for (const patch of [{ customized: true }, { fixedPower: true }, { itemSourceId: 'frozen-item' }, { equipmentSourceId: 'frozen-equipment' }, { definitionId: undefined }, { effectVersion: 'skill-v2.3' as const }]) {
      const a = unit('a', '魔法单体'), d = unit('d'); Object.assign(a.abilities[0]!, patch);
      expect(options(a, d, V32_OVERFLOW_D20).abilityDamage).toEqual(options(a, d, V31_OVERFLOW_D20).abilityDamage);
    }
  });

  it('keeps signed enhancement and paid skill ledgers unchanged across repeated previews and loads', () => {
    const specs = [{ id: skillDefinitionId('魔法单体')!, level: 5, bonuses: { damage: -2, arcaneDamage: 2 } }];
    const a = unit('a', undefined, { abilityBlueprints: specs }), d = unit('d');
    a.resources.SP = 1; a.abilityState = [{ abilityId: a.abilities[0]!.cooldownGroup!, cdLeft: 2, used: 3 }];
    const before = structuredClone(a);
    for (let i = 0; i < 3; i++) previewAttack(options(a, d, V32_OVERFLOW_D20));
    upgradeCombatSkills(a); expect(a).toEqual(before);
    expect(options(a, d, V32_OVERFLOW_D20).abilityDamage!.damageScale).toBeCloseTo(options(a, d, V31_OVERFLOW_D20).abilityDamage!.damageScale! * .55, 10);
  });

  it('preserves V31 snapshots and applies 55% in actual small/mass casts with the saved rule', () => {
    for (const mass of [false, true]) {
      const multipliers: number[] = [];
      for (const rules of mass ? [V31_OVERFLOW_TW, V32_OVERFLOW_TW] : [V31_OVERFLOW_D20, V32_OVERFLOW_D20]) {
        const extra: Partial<GenerateInput> = mass ? { scale: 'company', hpMax: 1, hp: 1 } : {};
        const a = unit('a', '魔法单体', extra), d = unit('d', undefined, extra); delete a.pos; delete d.pos;
        const field = standardField(); field.tiles.fill('open');
        const b = mass ? new MassBattle({ combatants: [a, d], rules, rng: fixed(), traitRegistry: registry })
          : new SmallBattle({ combatants: [a, d], rules, rng: fixed(), traitRegistry: registry, battlefield: field });
        b.start();
        if (b instanceof SmallBattle) { a.pos = 31; d.pos = 24; b.turnOrder = ['a', 'd']; b.turnIndex = 0; }
        const snapshot = b.toSnapshot();
        const loaded = b instanceof SmallBattle ? SmallBattle.fromSnapshot(structuredClone(snapshot), { traitRegistry: registry }) : MassBattle.fromSnapshot(structuredClone(snapshot), { traitRegistry: registry });
        expect(loaded.rules.id).toBe(rules.id); expect(loaded.toSnapshot()).toEqual(snapshot);
        let result: AttackResolution;
        if (b instanceof SmallBattle) {
          const preview = b.getActionOptions(a.id).find(o => o.id === a.abilities[0]!.id)!.targets!.find(t => t.targetId === d.id)!.preview!;
          expect(preview.normalHitDamage).toBeCloseTo(rules === V32_OVERFLOW_D20 ? 32.736 : 59.52, 6);
          const cast = b.useAbility(a.id, a.abilities[0]!.id, d.id); expect(cast.ok).toBe(true); result = cast.resolutions[0]!;
        } else {
          expect(b.useAbility(a.id, a.abilities[0]!.id, d.id).ok).toBe(true);
          b.issue({ unitId: d.id, type: 'hold' }); b.resolveRound(); result = b.log.find(l => l.resolution?.attackerId === a.id)!.resolution!;
        }
        expect(result.hit).toBe(true); multipliers.push(result.dmgMult);
      }
      expect(multipliers[1]).toBeCloseTo(multipliers[0]! * .55, 10);
    }
  });

  it('starts both encounter modes on V36 while retaining V32 damage calibration through the shared UI/MCP constructor', () => {
    for (const mode of ['small', 'mass'] as const) {
      const extra: Partial<GenerateInput> = mode === 'mass' ? { scale: 'company', hpMax: 1, hp: 1 } : {};
      const roster = [unit('a', '魔法单体', extra), unit('d', undefined, extra)];
      for (const u of roster) delete u.pos;
      const battle = buildEncounter({ roster,
        setup: { mode, field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' },
        nonLethal: false, seed: 'v32-encounter', registry, preparedField: standardField(), summonUnit: () => { throw Error('No summon'); } });
      expect(battle.rules.id).toBe(mode === 'small' ? V36_OVERFLOW_D20.id : V36_OVERFLOW_TW.id);
      expect(battle.rules.independentSkillDamageMultiplier).toBe(.55);
    }
  });

  it('keeps structure preview and actual spell breach on the same 55% calibration', () => {
    const damage: number[] = [];
    for (const rules of [V31_OVERFLOW_D20, V32_OVERFLOW_D20]) {
      const a = unit('a', '魔法单体'), d = unit('d'); delete a.pos; delete d.pos;
      const field = standardField(); field.tiles.fill('open'); field.layerVersion = 1;
      field.structures = field.tiles.map(() => null); field.overlays = {}; field.landmarks = [];
      const b = new SmallBattle({ combatants: [a, d], rules, rng: fixed(), traitRegistry: registry, battlefield: field });
      b.start(); a.pos = 31; d.pos = 3; b.turnOrder = ['a', 'd']; b.turnIndex = 0;
      b.battlefield!.structures![24] = createStructure('wall', 5);
      const mode = 'ability:' + a.abilities[0]!.id, preview = b.structurePreview(a.id, 24, mode);
      expect(preview.reason).toBeUndefined();
      const before = b.battlefield!.structures![24]!.hp;
      b.attackStructure(a.id, 24, mode);
      expect(before - b.battlefield!.structures![24]!.hp).toBe(preview.damage);
      damage.push(preview.damage);
    }
    expect(Math.abs(damage[1]! - damage[0]! * .55)).toBeLessThanOrEqual(1);
  });
});
