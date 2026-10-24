import { describe, expect, it } from 'vitest';
import {
  generateUnit, prepareCombatModel, prepareSkillModel, prepareArmsModel, upgradeCombatSkills,
  skillDefinitionId, skillAttack, previewAttack, resolveAttack, traitRegistry, standardConditionMap,
  SmallBattle, MassBattle, standardField, V30_OVERFLOW_D20, V30_OVERFLOW_TW,
  V31_OVERFLOW_D20, V31_OVERFLOW_TW, rulesById,
  type Combatant, type GenerateInput, type SkillModel, type RulePack, type AttackOpts, type AttackResolution,
} from '../src/index.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
const fixed = () => ({ seed: 'v31-hit', next: () => 0, d: (sides: number) => sides === 20 ? 18 : 3 });
function unit(id: string, extra: Partial<GenerateInput> = {}, formula?: SkillModel): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', damageModel: 'wounds-v2',
    numericModel: 'graded-v1', loadModel: 'capacity-v2', scale: 'hero', level: 5,
    weaponClass: 'sword', weaponLevel: 5, armorTier: 2, armorLevel: 5, traits: [], ...extra },
    { seed: id, noVariance: true, registry, skillModel: formula }).unit;
  u.id = id; u.pos = id === 'a' ? 0 : 1;
  prepareCombatModel(u, V31_OVERFLOW_D20); prepareArmsModel(u, V31_OVERFLOW_D20);
  prepareSkillModel(u, { skillModel: formula }); upgradeCombatSkills(u);
  return u;
}
function attacker(definition = '物理单体近战', formula: SkillModel | undefined = 'skills-v4', points = 0, extra: Partial<GenerateInput> = {}) {
  const abilityBlueprints = [{ id: skillDefinitionId(definition)!, level: 5, bonuses: { damage: points } }];
  return unit('a', { abilityBlueprints, ...extra }, formula);
}
function options(a: Combatant, d: Combatant, rules: RulePack, index = 0): Omit<AttackOpts, 'rng'> {
  const ability = a.abilities[index], effect = ability?.effects.find(e => e.op === 'damage');
  const skill = ability && effect?.op === 'damage' ? skillAttack({ mode: 'small', units: [a, d], fieldTags: [] }, a, d, ability, effect, rules) : {};
  return { attacker: a, defender: d, rules, traitRegistry: registry, conditionDefs, distance: 1, ...skill };
}

describe('V31 single weapon skill calibration', () => {
  it('covers every generated wound formula once while preserving signed bonuses and effect discounts', () => {
    for (const formula of [undefined, 'skills-v1', 'skills-v2', 'skills-v3', 'skills-v4'] as const) {
      for (const definition of ['物理单体近战', '物理单体近战中毒']) for (const points of [-2, 2]) {
        const abilityBlueprints = [{ id: skillDefinitionId(definition)!, level: 5, bonuses: { damage: points } }];
        const a = unit('a', { abilityBlueprints }, formula), d = unit('d');
        const old = options(a, d, V30_OVERFLOW_D20), next = options(a, d, V31_OVERFLOW_D20);
        const ratio = formula ? 1.5 / 2.2 : 1;
        expect(next.abilityDamage!.damageScale).toBeCloseTo(old.abilityDamage!.damageScale! * ratio, 10);
        const p = previewAttack(old), q = previewAttack(next);
        expect(q.normalHitDamage).toBeCloseTo(p.normalHitDamage! * ratio, 7);
        expect([q.hitChance, q.penetrationFactor, q.participants]).toEqual([p.hitChance, p.penetrationFactor, p.participants]);
        const r = resolveAttack({ ...old, defender: structuredClone(d), rng: fixed() });
        const s = resolveAttack({ ...next, defender: structuredClone(d), rng: fixed() });
        expect(s.dmgMult).toBeCloseTo(r.dmgMult * ratio, 10);
      }
    }
  });

  it('keeps normal attacks, independent projectiles/spells, bursts and custom/fixed techniques unchanged', () => {
    for (const definition of ['魔法单体', '物理单体投射', '物理范围近战']) {
      const a = attacker(definition), d = unit('d');
      expect(previewAttack(options(a, d, V31_OVERFLOW_D20))).toEqual(previewAttack(options(a, d, V30_OVERFLOW_D20)));
    }
    const a = attacker(), d = unit('d');
    a.abilities = [];
    expect(previewAttack(options(a, d, V31_OVERFLOW_D20))).toEqual(previewAttack(options(a, d, V30_OVERFLOW_D20)));
    for (const flag of ['customized', 'fixedPower'] as const) {
      const actor = attacker(); actor.abilities[0]![flag] = true;
      expect(previewAttack(options(actor, d, V31_OVERFLOW_D20))).toEqual(previewAttack(options(actor, d, V30_OVERFLOW_D20)));
    }
  });

  it('does not rewrite skill instances or refresh resource/cooldown ledgers on repeated previews', () => {
    const a = attacker(), d = unit('d');
    a.resources.SP = 1;
    a.abilityState = [{ abilityId: a.abilities[0]!.cooldownGroup!, cdLeft: 2, used: 3 }];
    const before = structuredClone(a);
    for (let i = 0; i < 3; i++) previewAttack(options(a, d, V31_OVERFLOW_D20));
    upgradeCombatSkills(a);
    expect(a).toEqual(before);
  });

  it('restores old/new saved rules in both battle modes and uses the same scaling in actual casts', () => {
    for (const mass of [false, true]) {
      const damages: number[] = [];
      for (const rules of mass ? [V30_OVERFLOW_TW, V31_OVERFLOW_TW] : [V30_OVERFLOW_D20, V31_OVERFLOW_D20]) {
        const extra: Partial<GenerateInput> = mass ? { scale: 'company', hpMax: 1, hp: 1 } : {};
        const a = attacker('物理单体近战', 'skills-v4', 0, extra), d = unit('d', extra);
        delete a.pos; delete d.pos;
        const field = standardField(); field.tiles.fill('open');
        const b = mass
          ? new MassBattle({ combatants: [a, d], rules, rng: fixed(), traitRegistry: registry })
          : new SmallBattle({ combatants: [a, d], rules, rng: fixed(), traitRegistry: registry, battlefield: field });
        b.start();
        if (b instanceof SmallBattle) { a.pos = 31; d.pos = 24; b.turnOrder = ['a', 'd']; b.turnIndex = 0; }
        const snap = b.toSnapshot();
        const loaded = b instanceof SmallBattle ? SmallBattle.fromSnapshot(structuredClone(snap), { traitRegistry: registry }) : MassBattle.fromSnapshot(structuredClone(snap), { traitRegistry: registry });
        expect(loaded.rules.id).toBe(rules.id); expect(loaded.toSnapshot()).toEqual(snap);
        const p = b instanceof SmallBattle
          ? b.getActionOptions(a.id).find(o => o.id === a.abilities[0]!.id)!.targets!.find(t => t.targetId === d.id)!.preview!
          : b.orderPreview({ unitId: a.id, type: 'ability', abilityId: a.abilities[0]!.id, targetId: d.id }).preview!;
        expect(p.normalHitDamage).toBeGreaterThan(0);
        let result: AttackResolution;
        if (b instanceof SmallBattle) {
          const used = b.useAbility(a.id, a.abilities[0]!.id, d.id); expect(used.ok).toBe(true); result = used.resolutions[0]!;
        } else {
          expect(b.useAbility(a.id, a.abilities[0]!.id, d.id).ok).toBe(true);
          b.issue({ unitId: d.id, type: 'hold' }); b.resolveRound();
          result = b.log.find(l => l.resolution?.attackerId === a.id)!.resolution!;
        }
        expect(result.hit).toBe(true); expect(result.crit).toBe(false);
        damages.push(result.dmgMult);
      }
      expect(damages[1]).toBeCloseTo(damages[0]! * 1.5 / 2.2, 10);
    }
    expect(rulesById('v31-overflow-d20')).toBe(V31_OVERFLOW_D20);
    expect(rulesById('v31-overflow-tw')).toBe(V31_OVERFLOW_TW);
  });
});
