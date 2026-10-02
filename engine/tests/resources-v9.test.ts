import { describe, expect, it } from 'vitest';
import { SmallBattle, MassBattle, V8_OVERFLOW_D20, V8_OVERFLOW_TW, V9_OVERFLOW_D20, V9_OVERFLOW_TW,
  generateUnit, traitRegistry, standardField, compileGenericSkill, spCapacity, casterReserve, abilityCost,
  prepareResourceModel, spRecovery, recoverSp, fatigueAfter, settleFatigue, skillExertion, abilityUsabilityReason,
  validateTacticalEffort, compileSkill, fatigueLimit, fatiguePenalty, movementPoints, collectMods, standardConditionMap, type Combatant, type Ability } from '../src/index.js';
import { compileWeapon } from '../src/gen/equipment.js';
import { applyUnitSet } from '../../panel/src/unit-set.js';
import { renderTacticalBattle } from '../../panel/src/tactical-view.js';
import { renderFormationBattle } from '../../panel/src/formation-view.js';
import { combatantFromUnknown, unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
const fixed = { seed: 'resources', next: () => 0.5, d: (n: number) => n === 20 ? 15 : 3 };
function make(id: string, level = 5, skill?: string, scale: 'hero' | 'company' = 'hero') {
  const u = generateUnit({ rulesVersion: 'v2', damageModel: 'wounds-v2', name: id, side: id === 'e' ? 'enemy' : 'ally', scale,
    level, hpMax: scale === 'hero' ? 100000 : 100, weaponClass: 'sword', weaponLevel: 1, armorTier: 0, traits: [] }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.base.atk = 100; u.morale = u.base.moraleMax = 100;
  if (skill) { const a = compileGenericSkill(skill, level, u.id); u.abilities = [a]; u.preparedAbilityIds = [a.id]; u.resources.SP = spCapacity(u); }
  return u;
}
function small(level = 5, skill?: string, legacy = false) {
  const a = make('a', level, skill), e = make('e', level), field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, e], rules: legacy ? V8_OVERFLOW_D20 : V9_OVERFLOW_D20, battlefield: field, rng: fixed, traitRegistry: registry });
  b.start(); b.turnOrder = ['a', 'e']; b.turnIndex = 0; a.pos = 31; e.pos = 24;
  return { a, e, b };
}
function mass(level = 5, skill?: string, legacy = false) {
  const a = make('a', level, skill, 'company'), e = make('e', level, undefined, 'company');
  const b = new MassBattle({ combatants: [a, e], rules: legacy ? V8_OVERFLOW_TW : V9_OVERFLOW_TW, rng: fixed, traitRegistry: registry });
  b.start(); a.formationPosition = 'ally:中军:front'; e.formationPosition = 'enemy:中军:front';
  return { a, e, b };
}

describe('V9 reserve, costs and endurance', () => {
  it.each([1, 3, 5, 7, 10])('L%i has independent training reserve, grade-priced skills and slow recovery', level => {
    const a = make('a', level); prepareResourceModel(a, V9_OVERFLOW_D20);
    expect(spCapacity(a)).toBe(6 + level * 2);
    const spell = compileGenericSkill('generic:magic-single', level, a.id);
    a.abilities = [spell]; a.preparedAbilityIds = [spell.id];
    expect(spCapacity(a)).toBe(10 + level * 3);
    expect(abilityCost(a, spell)?.amount).toBe(2 + Math.ceil(level / 2));
    a.resources.SP = 0; expect(spRecovery(a)).toBe(Math.round((0.5 + (level - 1) / 18) * 100) / 100);
    expect(spRecovery(a, true)).toBe(Math.round((0.5 + (level - 1) / 18) * 3 * 100) / 100);
    const lower = compileGenericSkill('generic:magic-single', 1, a.id);
    expect(abilityCost(a, lower)?.amount).toBe(3); expect(lower.power).toBe(1);
  });
  it('caster reserve reads actual primary/sidearm or prepared learned magic, not names, robes or items', () => {
    const u = make('法神', 5), spell = compileGenericSkill('generic:buff:ward', 5, 'a'); prepareResourceModel(u, V9_OVERFLOW_D20);
    expect(casterReserve(u)).toBe(false); u.abilities = [spell]; expect(casterReserve(u)).toBe(false);
    u.preparedAbilityIds = [spell.id]; expect(casterReserve(u)).toBe(true);
    spell.itemSourceId = 'potion'; expect(casterReserve(u)).toBe(false); delete spell.itemSourceId;
    spell.equipmentSourceId = 'ring'; expect(casterReserve(u)).toBe(false);
    u.sidearm = compileWeapon({ mechanism: 'magic', power: 1 }, { id: 'wand', seed: 'wand' }); expect(casterReserve(u)).toBe(true);
  });
  it('migration preserves depleted and explicit SP, reload and repeated loadout changes never refill', () => {
    const u = make('a', 5); u.resources.SP = 0; prepareResourceModel(u, V9_OVERFLOW_D20); expect(u.resources.SP).toBe(0);
    u.resources.SP = 3.25;
    const spell = compileGenericSkill('generic:buff:ward', 5, u.id); u.abilities = [spell];
    for (let i = 0; i < 5; i++) { u.preparedAbilityIds = i % 2 ? [spell.id] : []; prepareResourceModel(u, V9_OVERFLOW_D20); }
    expect(u.resources.SP).toBe(3.25);
    const explicit = make('explicit', 5); explicit.storyState = { resources: true }; const before = explicit.resources.SP;
    prepareResourceModel(explicit, V9_OVERFLOW_D20); expect(explicit.resources.SP).toBe(before);
  });
  it('custom skills, equipment, consumables and non-SP payments retain explicit costs', () => {
    const u = make('a'); prepareResourceModel(u, V9_OVERFLOW_D20);
    for (const flags of [{ customized: true }, { itemSourceId: 'p' }, { equipmentSourceId: 'ring' }, { fixedPower: true }]) {
      const spell = { ...compileGenericSkill('generic:magic-single', 10, u.id), ...flags, cost: { resource: 'SP', amount: 1 } };
      expect(abilityCost(u, spell)).toEqual(spell.cost);
    }
    const spell = compileGenericSkill('generic:magic-single', 10, u.id); spell.cost = { resource: 'reserve', amount: 1 };
    expect(abilityCost(u, spell)).toEqual(spell.cost);
  });
  it('area has no surcharge; control, combinations and summoning retain premiums; transfer cannot manufacture SP on itself', () => {
    const u = make('a'); prepareResourceModel(u, V9_OVERFLOW_D20);
    const cost = (id: string) => abilityCost(u, compileGenericSkill(id, 5, u.id))!.amount;
    expect(cost('generic:magic-area')).toBe(5); expect(cost('generic:magic-single:stun')).toBeGreaterThan(cost('generic:magic-single'));
    expect(cost('generic:buff:summon-single')).toBe(7);
    const transfer = compileGenericSkill('generic:buff:restore', 5, u.id);
    expect(abilityCost(u, transfer)!.amount).toBeGreaterThanOrEqual(transfer.effects.find(e => e.op === 'resource')!.amount);
  });
  it('training reduces fatigue, trained endurance stacks, overcasting adds strain, thresholds use 0–8 without doubling exertion', () => {
    const low = make('a', 1), high = make('a', 10); for (const u of [low, high]) prepareResourceModel(u, V9_OVERFLOW_D20);
    expect(fatigueAfter(low, 1)).toBe(0.5); expect(fatigueAfter(high, 1)).toBe(0.26);
    high.traits.push('fatigue-trained'); expect(fatigueAfter(high, 1)).toBe(0.13);
    const spell = compileGenericSkill('generic:magic-area', 10, low.id);
    expect(skillExertion(low, spell)).toBe(2.6); expect(skillExertion(high, spell)).toBe(1.25);
    low.fatigue = 8; expect(fatigueAfter(low, 0, true)).toBe(6); expect(fatigueAfter(low, 0)).toBe(7);
    high.fatigue = 8; expect(fatigueAfter(high, 0, true)).toBe(5.1);
    for (let i = 0; i < 100; i++) settleFatigue(low, 2); expect(low.fatigue).toBe(8);
  });
  it('regeneration is bounded, fatigue-sensitive and unavailable to incapacitated or non-ready units', () => {
    const u = make('a'); prepareResourceModel(u, V9_OVERFLOW_D20); u.resources.SP = 0;
    expect(spRecovery(u)).toBe(0.72); u.fatigue = 4; expect(spRecovery(u)).toBe(0.36);
    u.fatigue = 8; expect(spRecovery(u)).toBe(0.18); expect(spRecovery(u, true, true)).toBe(0);
    for (const status of ['dead', 'dying', 'fled', 'routing'] as const) { u.status = status; expect(recoverSp(u, true)).toBe(0); expect(u.resources.SP).toBe(0); }
    u.status = 'ready'; u.fatigue = 0; u.resources.SP = spCapacity(u) - 0.01;
    recoverSp(u, true); expect(u.resources.SP).toBe(spCapacity(u));
    u.resources.SP += 3; recoverSp(u, true); expect(u.resources.SP).toBe(spCapacity(u) + 3);
  });
  it('small preview, affordability and payment share the same quote; actions recover only at turn end', () => {
    const { a, b } = small(5, 'generic:magic-single'); const ability = a.abilities[0]!;
    const saved = JSON.stringify(b.toSnapshot());
    expect(b.getActionOptions('a').find(o => o.id === ability.id)!.preview!.resource!.cost).toBe(5);
    expect(JSON.stringify(b.toSnapshot())).toBe(saved);
    a.resources.SP = 4.99; expect(abilityUsabilityReason(a, ability)).toContain('不足'); expect(b.useAbility('a', ability.id, 'e').ok).toBe(false);
    a.resources.SP = 5; expect(b.useAbility('a', ability.id, 'e').ok).toBe(true); expect(a.resources.SP).toBe(0);
    b.endTurn(); expect(a.resources.SP).toBe(0.72); expect(a.fatigue).toBe(0.36);
  });
  it('small rest is distinct from brace and movement; fractional state survives the panel and battle parser', () => {
    const { a, b } = small(); a.resources.SP = 0; a.fatigue = 2;
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(restored.byId('a').resources.SP).toBe(0); restored.endTurn();
    expect(restored.byId('a').resources.SP).toBe(2.17); expect(restored.byId('a').fatigue).toBe(0);
    const other = small(); other.a.resources.SP = 0; other.b.brace('a'); other.b.endTurn(); expect(other.a.resources.SP).toBe(0.72);
    const moving = small(); moving.a.resources.SP = 0; moving.b.moveTo('a', 32); moving.b.endTurn(); expect(moving.a.resources.SP).toBe(0.72);
    const u = restored.byId('a'); u.tacticalEffort = 1.25;
    expect(combatantFromUnknown(JSON.parse(JSON.stringify(u))).tacticalEffort).toBe(1.25);
    expect(() => validateTacticalEffort(1.25)).toThrow(); expect(() => validateTacticalEffort(NaN, 'endurance-v1')).toThrow();
  });
  it('small full movement plus attack is more tiring than standing attack; haste is not free endurance', () => {
    const { a, b } = small(); a.conditions.push({ id: 'hasted', dur: 5, magnitude: 1 }); a.resources.SP = 0;
    b.attack('a', 'e'); b.attack('a', 'e'); expect(a.tacticalEffort).toBe(2);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry }); restored.endTurn();
    expect(restored.byId('a').fatigue).toBe(0.71); expect(restored.byId('a').resources.SP).toBe(0.72);
    const move = small(); move.e.pos = 9; move.b.moveTo('a', 10); move.b.attack('a', 'e'); move.b.endTurn();
    expect(move.a.fatigue).toBe(0.71);
  });
  it('using only an extra defensive action still forfeits full rest, including after reload', () => {
    const { a, b } = small(); a.conditions.push({ id: 'hasted', dur: 5, magnitude: 1 }); a.resources.SP = 0; a.fatigue = 1;
    b.selectHaste('a', true); b.brace('a'); expect(b.actedThisTurn.has('a')).toBe(false);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry }); restored.endTurn();
    expect(restored.byId('a').resources.SP).toBe(0.72); expect(restored.byId('a').fatigue).toBe(0);
  });
  it('mass support pays exactly once and recovers exactly once; replaying a round cannot farm SP', () => {
    const { a, b } = mass(5, 'generic:buff:ward'), ability = a.abilities[0]!; a.resources.SP = 5;
    expect(b.issue({ unitId: 'a', type: 'ability', abilityId: ability.id, targetId: 'a' }).ok).toBe(true);
    b.issue({ unitId: 'e', type: 'hold' }); b.resolveRound(1);
    expect(a.resources.SP).toBe(0.72); expect(a.fatigue).toBe(0.36);
    const restored = MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(restored.byId('a').resources.SP).toBe(0.72); expect(() => restored.resolveRound(1)).toThrow(); expect(restored.byId('a').resources.SP).toBe(0.72);
  });
  it('mass haste adds to main exertion but never doubles regeneration', () => {
    const { a, b } = mass(); a.conditions.push({ id: 'hasted', dur: 5, magnitude: 1 }); a.resources.SP = 0;
    b.issue({ unitId: 'a', type: 'attack', targetId: 'e' }); b.issue({ unitId: 'e', type: 'hold' });
    b.setHasteOrder({ unitId: 'a', type: 'attack', targetId: 'e' }, 'a'); b.resolveRound(1);
    expect(a.fatigue).toBe(0.71); expect(a.resources.SP).toBe(0.72);
  });
  it('mass genuine hold rests, brace does not, and stun is not treated as rest', () => {
    for (const mode of ['hold', 'brace', 'stun'] as const) {
      const { a, b } = mass(); a.resources.SP = 0;
      b.issue({ unitId: 'a', type: mode === 'brace' ? 'brace' : 'hold' }); b.issue({ unitId: 'e', type: 'hold' });
      if (mode === 'stun') a.conditions.push({ id: 'stunned', dur: 1 });
      b.resolveRound(1); expect(a.resources.SP).toBe(mode === 'hold' ? 2.17 : mode === 'brace' ? 0.72 : 0);
    }
  });
  it.each(['small', 'mass'] as const)('%s V8 keeps old reserve, costs, fatigue and no passive regeneration', mode => {
    const { a, b } = mode === 'small' ? small(5, 'generic:buff:ward', true) : mass(5, 'generic:buff:ward', true);
    expect(a.resourceModel).toBeUndefined(); expect(spCapacity(a)).toBe(22);
    const ability = a.abilities[0]!, before = a.resources.SP!;
    expect(abilityCost(a, ability)).toEqual(ability.cost);
    if (b instanceof SmallBattle) { b.useAbility('a', ability.id, 'a'); b.endTurn(); }
    else { b.issue({ unitId: 'a', type: 'ability', abilityId: ability.id, targetId: 'a' }); b.issue({ unitId: 'e', type: 'hold' }); b.resolveRound(); }
    expect(a.resources.SP).toBe(before - ability.cost!.amount); expect(a.fatigue).toBe(0.5);
  });
  it.each(['small', 'mass'] as const)('%s V9 keeps generated summon owner labels and waits until the next round', mode => {
    const { a, b } = mode === 'small' ? small(5, 'generic:buff:summon-single') : mass(5, 'generic:buff:summon-single');
    const ability = a.abilities[0]!;
    if (b instanceof SmallBattle) expect(b.useAbility('a', ability.id, 'a').ok).toBe(true);
    else { expect(b.issue({ unitId: 'a', type: 'ability', abilityId: ability.id, targetId: 'a' }).ok).toBe(true); b.issue({ unitId: 'e', type: 'hold' }); b.resolveRound(); }
    const born = b.combatants.find(u => u.summonerId === a.id)!;
    expect(born.name).toBe('a的召唤个体'); expect(born.resourceModel).toBe('endurance-v1'); expect(born.bornRound).toBe(1);
  });
  it('V9 still logs lethal skill before death and suppresses zero-loss falling; ended battles cannot recover', () => {
    const { a, e, b } = small(); e.traits.push('flying'); e.airborne = true; e.hp = 1;
    const spell: Ability = { id: 'lethal', name: '斩落', target: 'enemy', range: { min: 0, max: 5, metric: 'grid' }, effects: [{ op: 'damage', baseDice: '100d100' }] };
    a.abilities = [spell]; a.preparedAbilityIds = [spell.id]; a.resources.SP = 0;
    expect(b.useAbility('a', spell.id, 'e').ok).toBe(true);
    const skillAt = b.log.findIndex(e => e.kind === 'ability'), deathAt = b.log.findIndex(e => e.kind === 'death');
    expect(deathAt).toBeGreaterThan(skillAt); expect(b.log.some(e => e.text.includes('坠落损失0'))).toBe(false);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(restored.log.findIndex(e => e.kind === 'death')).toBeGreaterThan(restored.log.findIndex(e => e.kind === 'ability'));
    b.endTurn(); b.endTurn(); expect(a.resources.SP).toBe(0);
  });
  it('named blueprint skills use the same grade cost, while reinforcement reserve stays fixed', () => {
    const u = make('a'); prepareResourceModel(u, V9_OVERFLOW_D20);
    expect(abilityCost(u, compileSkill('bp-arcane-bolt', 10, u.id))?.amount).toBe(7);
    const reserve = compileSkill('bp-call-reinforce', 10, u.id);
    expect(abilityCost(u, reserve)).toEqual(reserve.cost);
  });
  it('the saved battle rules are authoritative even when adding a unit built by a newer release', () => {
    const u = make('a'); prepareResourceModel(u, V9_OVERFLOW_D20); expect(u.resourceModel).toBe('endurance-v1');
    prepareResourceModel(u, V8_OVERFLOW_D20); expect(u.resourceModel).toBeUndefined(); expect(u.resources.SP).toBe(spCapacity(u));
    expect(spRecovery(u)).toBe(0);
  });
  it('new snapshots reject corrupted fractional exertion instead of producing NaN fatigue', () => {
    const { b } = small(), snap = JSON.parse(JSON.stringify(b.toSnapshot()));
    snap.combatants[0].tacticalEffort = '1.5';
    expect(() => SmallBattle.fromSnapshot(snap, { traitRegistry: registry })).toThrow('疲劳');
  });
  it.each([['small',1],['small',5],['small',10],['mass',1],['mass',5],['mass',10]] as const)('%s L%i AI advances without negative SP, unbounded fatigue or repeated recovery', (mode, level) => {
    const { b } = mode === 'small' ? small(level, 'generic:magic-single') : mass(level, 'generic:magic-single');
    const start = b.round;
    for (let i = 0; i < 24 && !b.isOver(); i++) {
      if (b instanceof SmallBattle) b.autoAction(b.active!.id); else b.resolveRound();
      for (const u of b.combatants) {
        expect(Number.isFinite(u.resources.SP)).toBe(true); expect(u.resources.SP).toBeGreaterThanOrEqual(0);
        expect(u.resources.SP).toBeLessThanOrEqual(spCapacity(u)); expect(u.fatigue).toBeGreaterThanOrEqual(0); expect(u.fatigue).toBeLessThanOrEqual(8);
      }
    }
    expect(b.round).toBeGreaterThan(start);
  });

});


describe('V9 resource tuning: equal area cost and 8-point fatigue', () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('L%i single and area quotes match, including inherited buff/control floors', level => {
    const u = make('a', level); prepareResourceModel(u, V9_OVERFLOW_D20);
    const pairs = [
      ['physical-single', 'physical-area'], ['magic-single', 'magic-area'],
      ['magic-single:stun', 'magic-area:stun'], ['magic-single:burn+slow', 'magic-area:burn+slow'],
      ['buff:heal', 'buff:area:heal'], ['buff:ward', 'buff:area:ward'],
      ['buff:attack+defense', 'buff:area:attack+defense'], ['buff:trait-flying', 'buff:area:trait-flying'],
      ['debuff:stun', 'debuff:area:stun'], ['debuff:root', 'debuff:area:root'],
      ['debuff:poison+slow', 'debuff:area:poison+slow'], ['buff:summon-single', 'buff:area:summon-single'],
    ];
    for (const [singleId, areaId] of pairs) {
      const single = compileGenericSkill('generic:' + singleId, level, u.id);
      const area = compileGenericSkill('generic:' + areaId, level, u.id);
      const saved = JSON.stringify([single, area]);
      expect(abilityCost(u, area), areaId).toEqual(abilityCost(u, single));
      expect(JSON.stringify([single, area])).toBe(saved);
      expect(skillExertion(u, area) - skillExertion(u, single)).toBeCloseTo(0.25);
    }
    for (const geometry of ['cone', 'line', 'ring', 'chain']) {
      const spell = compileGenericSkill('generic:magic-single:' + geometry, level, u.id);
      expect(abilityCost(u, spell)?.amount).toBe(2 + Math.ceil(level / 2));
    }
    const restore = compileGenericSkill('generic:buff:area:restore', level, u.id);
    const effect = restore.effects.find(e => e.op === 'resource')!;
    expect(abilityCost(u, restore)!.amount).toBeGreaterThanOrEqual(effect.amount * 2);
  });
  it.each([1, 3, 5, 7, 10])('L%i restoration is linear before rounding and full rest scales from unrounded base', level => {
    const u = make('a', level); prepareResourceModel(u, V9_OVERFLOW_D20); u.resources.SP = 0;
    const base = 0.5 + (level - 1) / 18;
    for (const [fatigue, factor] of [[0, 1], [3.99, 1], [4, 0.5], [7.99, 0.5], [8, 0.25]] as const) {
      u.fatigue = fatigue;
      expect(spRecovery(u)).toBe(Math.round((level + 8) * factor / 18 * 100) / 100);
      expect(spRecovery(u, true)).toBe(Math.round((level + 8) * factor * 3 / 18 * 100) / 100);
    }
    u.fatigue = 0;
    for (let i = 0; i < 100; i++) recoverSp(u, true);
    expect(u.resources.SP).toBe(spCapacity(u));
  });
  it.each([false, true])('fatigue attack and movement penalties use the correct saved scale (legacy=%s)', legacy => {
    const u = make('a'); prepareResourceModel(u, legacy ? V8_OVERFLOW_D20 : V9_OVERFLOW_D20);
    const limit = legacy ? 4 : 8;
    expect(fatigueLimit(u)).toBe(limit);
    for (const [fatigue, penalty] of [[0, 0], [limit / 2 - 0.01, 0], [limit / 2, 1], [limit - 0.01, 1], [limit, 2]] as const) {
      u.fatigue = fatigue;
      expect(fatiguePenalty(u)).toBe(penalty);
      expect(movementPoints(u)).toBe(3 - penalty);
      const attack = collectMods(u, {}, standardConditionMap(), [], registry).find(m => m.sourceId === 'fatigue:atk');
      expect(attack?.value ?? 0).toBe(penalty ? -penalty : 0);
    }
  });
  it.each([false, true])('small and mass charge reject only at their own fatigue threshold (legacy=%s)', legacy => {
    const sb = small(5, undefined, legacy); sb.a.archetype = 'mobile'; sb.a.pos = 38; sb.e.pos = 24;
    const mb = mass(5, undefined, legacy); mb.a.archetype = 'mobile'; mb.a.formationPosition = 'ally:中军:rear';
    const threshold = legacy ? 2 : 4;
    for (const fatigue of [threshold - 0.01, threshold]) {
      sb.a.fatigue = mb.a.fatigue = fatigue;
      const charge = sb.b.getActionOptions('a').find(o => o.id === 'charge')!;
      const target = charge.targets!.find(t => t.targetId === 'e')!;
      expect(target.enabled).toBe(fatigue < threshold);
      const result = mb.b.orderPreview({ unitId: 'a', type: 'charge', targetId: 'e' });
      if (fatigue < threshold) expect(result.reason).toBeUndefined();
      else expect(result.reason).toContain('疲劳必须低于' + threshold);
    }
  });
  it('fatigue scale migration is proportional and idempotent in both directions', () => {
    const u = make('a'); u.fatigue = 3;
    prepareResourceModel(u, V9_OVERFLOW_D20); expect(u.fatigue).toBe(6);
    prepareResourceModel(u, V9_OVERFLOW_D20); expect(u.fatigue).toBe(6);
    prepareResourceModel(u, V8_OVERFLOW_D20); expect(u.fatigue).toBe(3);
    prepareResourceModel(u, V8_OVERFLOW_D20); expect(u.fatigue).toBe(3);
  });
  it('V9 persists fatigue above four and fractional unit_set edits without allowing overflow', () => {
    const u = make('a'); prepareResourceModel(u, V9_OVERFLOW_D20); u.fatigue = 6.25;
    const save = { storage: [unitRecordFromCombatant(u)], rosterIds: ['a'] };
    const next = applyUnitSet(save, 'a', { fatigue: 7.5 }, 'fatigue-tuning');
    const after = materializeUnitRecord(next.storage![0]!, registry);
    expect(after.fatigue).toBe(7.5); expect(u.fatigue).toBe(6.25);
    expect(combatantFromUnknown(JSON.parse(JSON.stringify(after))).fatigue).toBe(7.5);
    for (const fatigue of [-0.01, 8.01, NaN]) expect(() => applyUnitSet(save, 'a', { fatigue }, 'invalid')).toThrow();
    const old = make('a'), legacy = { storage: [unitRecordFromCombatant(old)], rosterIds: ['a'] };
    expect(() => applyUnitSet(legacy, 'a', { fatigue: 5 }, 'old')).toThrow();
  });
  it.each([false, true])('small and mass displays use the saved fatigue limit without changing state (legacy=%s)', legacy => {
    const sb = small(5, undefined, legacy), mb = mass(5, undefined, legacy);
    sb.a.fatigue = mb.a.fatigue = legacy ? 3 : 6.25;
    const before = JSON.stringify([sb.b.toSnapshot(), mb.b.toSnapshot()]);
    const expected = legacy ? '疲劳3/4' : '疲劳≈6.2/8';
    expect(renderTacticalBattle(sb.b, { selectedId: 'a', mode: 'weapon' })).toContain(expected);
    expect(renderFormationBattle(mb.b, { selectedId: 'a' }, {}, false, () => '', () => '')).toContain(expected);
    expect(JSON.stringify([sb.b.toSnapshot(), mb.b.toSnapshot()])).toBe(before);
  });
  it('area preview, affordability and actual payment all use the reduced quote', () => {
    const { a, b } = small(1, 'generic:magic-area'), ability = a.abilities[0]!;
    a.resources.SP = 2.99;
    expect(b.useAbility('a', ability.id, 'e').ok).toBe(false);
    a.resources.SP = 3;
    const preview = b.getActionOptions('a').find(o => o.id === ability.id)!.preview!;
    expect(preview.resource!.cost).toBe(3);
    expect(b.useAbility('a', ability.id, 'e').ok).toBe(true); expect(a.resources.SP).toBe(0);
    b.endTurn(); expect(a.resources.SP).toBe(0.5); expect(a.fatigue).toBe(0.63);
  });
  it('mass area buffs pay once even when benefiting multiple units', () => {
    const a = make('a', 1, 'generic:buff:area:ward', 'company'), friend = make('friend', 1, undefined, 'company'), e = make('e', 1, undefined, 'company');
    const b = new MassBattle({ combatants: [a, friend, e], rules: V9_OVERFLOW_TW, rng: fixed, traitRegistry: registry });
    b.start(); a.formationPosition = 'ally:中军:front'; friend.formationPosition = 'ally:左翼:front'; e.formationPosition = 'enemy:中军:front';
    const ability = a.abilities[0]!; a.resources.SP = 3;
    expect(b.orderPreview({ unitId: 'a', type: 'ability', abilityId: ability.id, targetId: 'a' }).areaTargetIds).toHaveLength(2);
    expect(b.issue({ unitId: 'a', type: 'ability', abilityId: ability.id, targetId: 'a' }).ok).toBe(true);
    b.issue({ unitId: 'e', type: 'hold' }); b.resolveRound(1);
    expect(a.resources.SP).toBe(0.5); expect(a.fatigue).toBe(0.63);
  });
  it.each([1, 10])('L%i actually reaches the new fatigue threshold after sustained attacks and rests out of it', level => {
    const u = make('a', level); prepareResourceModel(u, V9_OVERFLOW_D20);
    let attacks = 0;
    while (fatiguePenalty(u) === 0) { settleFatigue(u, 1); attacks++; }
    expect(attacks).toBe(level === 1 ? 8 : 16);
    for (let i = 0; i < 100; i++) settleFatigue(u, 2);
    expect(u.fatigue).toBe(8);
    settleFatigue(u, 0, true); expect(u.fatigue).toBe(level === 1 ? 6 : 5.1);
    settleFatigue(u, 0, true); expect(u.fatigue).toBe(level === 1 ? 4 : 2.2);
    settleFatigue(u, 0, true); expect(fatiguePenalty(u)).toBe(0);
  });
});
