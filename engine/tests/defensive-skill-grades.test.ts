import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, upgradeCombatSkills, compileSkill, parseSkillMechanism,
  V7_OVERFLOW_D20, V7_OVERFLOW_TW, V6_OVERFLOW_D20, standardConditionMap, traitRegistry,
  penetrationContext, previewAttack, resolveAttack, SmallBattle, MassBattle, standardField,
  type Combatant, type GenerateInput, type AttackOpts, type Ability } from '../src/index.js';
import { applySkillCondition, prepareCondition, applyDispel, conditionChance, skillEffectValue } from '../src/skill-effects.js';
import { grantBarrier, barrierDefensePower, decayBarrier } from '../src/barrier.js';
import { anchoredProtection, defensePower } from '../src/power-anchors.js';
import { applyDamagePlan } from '../src/recovery.js';
import { abilityTargetReason } from '../src/actions.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';
import { parseAbilitySpec } from '../../panel/src/tags.js';
import { placeZone, settleZones } from '../src/area-effects.js';
import { conditionMods } from '../src/bonus.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
const fixed = () => ({ seed: 'fixed', next: () => 0, d: (s: number) => s === 20 ? 18 : 1 });
function unit(id: string, extra: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'enemy' : 'ally', rulesVersion: 'v2', damageModel: 'wounds-v2',
    scale: 'hero', level: 1, hpMax: 10000, weaponClass: 'rifle', weaponLevel: 5, armorTier: 0, traits: [], ...extra },
    { seed: id, noVariance: true, registry }).unit;
  u.id = id; prepareCombatModel(u, V7_OVERFLOW_D20); u.base.atk = 100; u.base.def = 1;
  return u;
}
function options(a: Combatant, d: Combatant): Omit<AttackOpts, 'rng'> {
  return { attacker: a, defender: d, rules: V7_OVERFLOW_D20, conditionDefs, traitRegistry: registry, ranged: true, distance: 4 };
}
function learn(u: Combatant, kind: 'ward' | 'barrier', power: number, bonuses?: Ability['bonuses']): Ability {
  const skill = compileSkill({ id: 'generic:buff:' + kind, bonuses }, power, u.id);
  u.abilities = [skill]; u.preparedAbilityIds = [skill.id]; upgradeCombatSkills(u); return skill;
}
function ward(u: Combatant, power: number, dur = 4, magnitude = 1): void {
  applySkillCondition(u, { id: 'blessed', dur, magnitude, defensePower: power });
}

describe('defensive skill grades', () => {
  it('uses L rounds for positive buffs, barriers and temporary traits, retaining capacity and reduction', () => {
    for (let power = 1; power <= 10; power++) {
      const d = unit('d'); const shield = learn(d, 'barrier', power).effects[0]!;
      expect(shield).toMatchObject({ op: 'barrier', amount: 8 + 5 * power, dur: power });
      const effect = learn(d, 'ward', power).effects[0]!;
      expect(effect).toMatchObject({ op: 'condition', dur: power });
      if (effect.op !== 'condition') throw Error('missing ward');
      applySkillCondition(d, prepareCondition(d, d, effect, fixed()).condition);
      expect(conditionMods(d.conditions, conditionDefs, d)[0]!.value).toBeCloseTo(1 - (5 + power) / 50);
      for (const id of ['generic:buff:haste', 'generic:buff:trait-flying']) {
        d.abilities = [compileSkill(id, power, d.id)]; upgradeCombatSkills(d);
        expect(d.abilities[0]!.effects[0]).toMatchObject({ dur: power });
      }
    }
  });
  it('migrates saved buff recipes once without extending existing effects or hard control', () => {
    const d = unit('d'); const s = learn(d, 'ward', 9, { duration: 5 });
    s.effectVersion = 'skill-v6.0'; (s.effects[0] as { dur: number }).dur = 5;
    d.conditions = [{ id: 'blessed', dur: 2 }];
    d.abilityState = [{ abilityId: s.cooldownGroup!, cdLeft: 1, used: 2 }];
    upgradeCombatSkills(d); expect(s.effects[0]).toMatchObject({ dur: 10 });
    expect(d.conditions[0]!.dur).toBe(2); expect(d.abilityState[0]).toMatchObject({ cdLeft: 1, used: 2 });
    const saved = JSON.stringify(d); upgradeCombatSkills(d); expect(JSON.stringify(d)).toBe(saved);
    for (const name of ['stun', 'silence', 'disarm', 'root']) {
      d.abilities = [compileSkill({ id: 'generic:debuff:' + name, bonuses: { duration: 10 } }, 10, d.id)]; upgradeCombatSkills(d);
      expect(d.abilities[0]!.effects[0]).toMatchObject({ dur: 1 });
    }
    d.abilities = [compileSkill('generic:debuff:slow', 9, d.id)]; upgradeCombatSkills(d);
    expect(d.abilities[0]!.effects[0]).toMatchObject({ dur: 4 });
  });
  it('maps 护盾 and 防护 to the finite barrier while 减伤 and 守护 remain wards', () => {
    for (const word of ['护盾', '防护', '屏障']) {
      expect(parseSkillMechanism('buff+' + word)?.modifiers).toEqual(['barrier']);
      expect(parseAbilitySpec(`护盾术:buff+${word}L9`)[0]?.blueprintId).toBe('generic:buff:barrier');
    }
    for (const word of ['减伤', '守护']) expect(parseSkillMechanism('buff+' + word)?.modifiers).toEqual(['ward']);
  });
  it('uses the skill L independently of training and retains duration/strength modifiers', () => {
    const u = unit('d', { level: 1 });
    for (const kind of ['ward', 'barrier'] as const) {
      const s = learn(u, kind, 9, { power: 10, duration: 10 });
      expect(s.effects[0]).toMatchObject({ defensePower: 9, dur: 11 });
      const before = JSON.stringify(s); upgradeCombatSkills(u); expect(JSON.stringify(s)).toBe(before);
      delete (s.effects[0] as { defensePower?: number }).defensePower;
      upgradeCombatSkills(u); expect(s.effects[0]).toMatchObject({ defensePower: 9 });
    }
    const old = unit('old', { level: 10 });
    old.conditions.push({ id: 'blessed', dur: 4 }); grantBarrier(old, 100, 3);
    expect(defensePower(old, 'kinetic', true)).toBe(10);
  });
  it('suppresses cross-grade amplification without granting armor penetration immunity or stacking levels', () => {
    const a = unit('a'), d = unit('d'); ward(d, 9, 4, 1.4);
    const ctx = penetrationContext(options(a, d));
    expect(ctx.overmatchMultiplier).toBe(1); expect(ctx.protectionPower).toBe(9);
    expect(ctx.factor).toBe(1); expect(anchoredProtection(d, 'kinetic')).toBe(0);
    const hit = resolveAttack({ ...options(a, structuredClone(d)), rng: fixed() });
    expect(hit.finalDamage).toBeGreaterThan(0); expect(hit.wardMult).toBeCloseTo(.72);
    ward(d, 4, 8, 1); grantBarrier(d, 100, 3, 'd', 7);
    expect(defensePower(d, 'kinetic', true)).toBe(9);
    expect(resolveAttack({ ...options(a, structuredClone(d)), rng: fixed() }).wardMult).toBeCloseTo(.72);
    const legacy = { ...options(a, d), rules: V6_OVERFLOW_D20 };
    expect(penetrationContext(legacy).overmatchMultiplier).toBeUndefined();
  });
  it('lets a weaker-magnitude high-L ward apply and expires each grade independently', () => {
    const a = unit('a'), d = unit('d'); ward(d, 3, 9, 1.5);
    const effect = { op: 'condition' as const, conditionId: 'blessed', dur: 1, magnitude: .5, defensePower: 9 };
    expect(conditionChance(d, effect)).toBe(1);
    applySkillCondition(d, prepareCondition(a, d, effect, fixed()).condition);
    expect(defensePower(d, 'kinetic')).toBe(9);
    ward(d, 3, 9, 1.5);
    for (const c of d.conditions) c.dur--;
    expect(defensePower(d, 'kinetic')).toBe(3);
    applyDispel(d, [{ kind: 'condition', id: 'blessed', name: '祝福' }]);
    expect(defensePower(d, 'kinetic')).toBe(1);
  });
  it('does not extend a high-grade barrier with a longer low-grade refresh', () => {
    const d = unit('d'); grantBarrier(d, 30, 1, 'd', 9); grantBarrier(d, 20, 4, 'other', 3);
    expect(d.barrier?.remaining).toBe(30); expect(barrierDefensePower(d)).toBe(9);
    decayBarrier(d); expect(barrierDefensePower(d)).toBe(3);
    expect(d.barrier?.remaining).toBe(30);
    applyDispel(d, [{ kind: 'barrier', id: 'barrier', name: '屏障' }]);
    expect(barrierDefensePower(d)).toBe(0);
  });
  it('spends the protected part once and applies flesh amplification only to the remaining attack', () => {
    const d = unit('d'); grantBarrier(d, 40, 3, 'd', 9);
    const plan = { direct: 600, targets: 1, overmatch: { power: 5, channel: 'kinetic' as const, penetration: 11, area: false, canBlock: true, multiplier: 6 } };
    // 100 base damage: 40 absorbed at L9, 60 continues at the original x6.
    expect(applyDamagePlan(d, plan).direct).toBe(360); expect(d.barrier).toBeUndefined();
    expect(applyDamagePlan(d, plan).direct).toBe(600);
    const intact = unit('intact'); grantBarrier(intact, 110, 3, 'd', 9);
    expect(applyDamagePlan(intact, plan).direct).toBe(0); expect(intact.barrier?.remaining).toBe(10);
  });
  it('carries attack metadata through a plan when a graded shield is granted after planning', () => {
    const a = unit('a'), d = unit('d');
    const result = resolveAttack({ ...options(a, structuredClone(d)), rng: fixed() });
    expect(result.damagePlans![0]!.overmatch?.power).toBe(5);
    grantBarrier(d, 100, 3, 'd', 9);
    const loss = applyDamagePlan(d, JSON.parse(JSON.stringify(result.damagePlans![0])));
    expect(loss.direct).toBe(0); expect(d.barrier!.remaining).toBeGreaterThan(0);
    expect(d.barrier!.remaining).toBeLessThan(100);
  });
  it('does not transfer protected overkill to other formation members before the shield breaks', () => {
    const a = unit('a', { weaponLevel: 9 }), d = unit('d', { scale: 'company', hpMax: 20 });
    const plain = resolveAttack({ ...options(a, structuredClone(d)), rng: fixed() });
    const members = d.hp; grantBarrier(d, 1000, 3, 'd', 9);
    const hit = resolveAttack({ ...options(a, d), rng: fixed() });
    expect(plain.finalDamage).toBeGreaterThan(0); expect(hit.finalDamage).toBe(0); expect(d.hp).toBe(members);
  });
  it('keeps exact single-shot preview and sequential-shot preview consistent with shield depletion', () => {
    const a = unit('a'), d = unit('d');
    a.weapon = { id: 'fixed', name: 'fixed', powerModel: 'wounds-v2', customized: true, baseDice: '1d2+19', damageScale: 1, level: 5, channel: 'kinetic', penetration: 11, attacks: 1 };
    const rules = { ...V7_OVERFLOW_TW, tw: { ...V7_OVERFLOW_TW.tw, min: 1, max: 1 } };
    grantBarrier(d, 10, 3, 'd', 9);
    const opts = { ...options(a, d), rules }, before = JSON.stringify([a, d]);
    const preview = previewAttack(opts);
    let total = 0;
    for (const die of [1, 2]) for (let i = 0; i < 256; i++) total += resolveAttack({ ...opts, defender: structuredClone(d), rng: { seed: 'fixed', next: () => (i + .5) / 256, d: () => die } }).finalDamage;
    expect(preview.expectedDamage).toBeCloseTo(total / 512, 2);
    a.weapon.attacks = 3; grantBarrier(d, 30, 3, 'd', 9);
    const multiBefore = JSON.stringify([a, d]); const multi = previewAttack(opts);
    expect(multi.expectedDamage).toBeGreaterThan(preview.expectedDamage); expect(JSON.stringify([a, d])).toBe(multiBefore);
    expect(before).not.toBe(multiBefore);
  });
  it('allows upgrading the grade of an existing larger barrier and values the protection', () => {
    const a = unit('a'), d = unit('d'); a.pos = 0; d.pos = 4;
    grantBarrier(d, 70, 4, 'd', 1);
    const s = learn(d, 'barrier', 9);
    expect(abilityTargetReason({ actor: d, target: d, ability: s })).toBeUndefined();
    const field = standardField(); field.tiles.fill('open');
    expect(skillEffectValue({ units: [a, d], mode: 'small', fieldTags: [], rules: V7_OVERFLOW_D20, battlefield: field }, d, d, s)).toBeGreaterThan(0);
  });
  it.each(['small', 'mass'] as const)('%s casts retain grades through save/restore and dispelling', mode => {
    for (const kind of ['ward', 'barrier'] as const) {
      const d = unit('d', { body: mode === 'mass' ? 'vehicle' : 'human' }), a = unit('a', { body: mode === 'mass' ? 'vehicle' : 'human' });
      const s = learn(d, kind, 9); d.resources.SP = 30;
      const b = mode === 'small'
        ? new SmallBattle({ combatants: [d, a], rules: V7_OVERFLOW_D20, battlefield: standardField(), seed: 'defense' })
        : new MassBattle({ combatants: [d, a], rules: V7_OVERFLOW_TW, seed: 'defense' });
      b.start(); if (b instanceof SmallBattle) { b.turnOrder = ['d', 'a']; b.turnIndex = 0; }
      expect(b.useAbility(d.id, s.id, d.id).ok).toBe(true);
      if (b instanceof MassBattle) { b.issue({ unitId: a.id, type: 'hold' }); b.resolveRound(); }
      expect(defensePower(d, 'kinetic', true)).toBe(9);
      const saved = JSON.parse(JSON.stringify(b.toSnapshot()));
      const restored = b instanceof SmallBattle ? SmallBattle.fromSnapshot(saved) : MassBattle.fromSnapshot(saved);
      expect(defensePower(restored.byId('d'), 'kinetic', true)).toBe(9);
      const parsed = combatantFromUnknown(JSON.parse(JSON.stringify(d)));
      expect(parsed.conditions).toEqual(d.conditions); expect(parsed.barrier).toEqual(d.barrier);
    }
  });
  it('uses defense grades on zone damage and nested zone protection', () => {
    const a = unit('a'), d = unit('d'); a.pos = 7; d.pos = 8;
    const context = { units: [a, d], mode: 'small' as const, fieldTags: [], battlefield: standardField(), rules: V7_OVERFLOW_D20 };
    const zone = compileSkill('generic:buff:barrier+ward+zone-smoke', 9, d.id).effects.find(e => e.op === 'zone')!;
    expect(zone.op).toBe('zone'); if (zone.op !== 'zone') return;
    expect(zone.effects).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'barrier', defensePower: 9 }), expect.objectContaining({ op: 'condition', defensePower: 9 })]));
    grantBarrier(d, 100, 3, 'd', 9);
    placeZone(context, a, d, { op: 'zone', kind: 'fire', power: 5, radius: 0, dur: 3 }, 1, 'fire');
    expect(settleZones(context, 1)[0]!.damage).toBe(0); expect(d.barrier?.remaining).toBe(81);
  });
  it('rejects corrupt grade state and keeps legacy snapshots readable', () => {
    const d = unit('d'); expect(() => combatantFromUnknown(JSON.parse(JSON.stringify(d)))).not.toThrow();
    for (const power of [0, 11, 1.5, '9']) {
      expect(() => combatantFromUnknown({ ...d, conditions: [{ id: 'blessed', dur: 3, defensePower: power }] })).toThrow();
      expect(() => combatantFromUnknown({ ...d, barrier: { remaining: 10, duration: 3, defenses: [{ power, duration: 3 }] } })).toThrow();
    }
  });
});
