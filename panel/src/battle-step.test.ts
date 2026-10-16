import { expect, it } from 'vitest';
import { generateUnit, MassBattle, SmallBattle, standardField, traitRegistry, V16_OVERFLOW_D20, V16_OVERFLOW_TW } from '../../engine/src/index.js';
import { computeBattleStep, applyBattleStep, seededReinforcement, type BattleStepRequest } from './battle-step.js';
import { executeMassPlan } from './battle-execution.js';
import { previewScopeEpoch } from '../../engine/src/damage.js';

function units(count = 4) {
  return Array.from({ length: count }, (_, i) => {
    const unit = generateUnit({ name: 'unit' + i, side: i < count / 2 ? 'ally' : 'enemy', scale: 'company', hpMax: 20,
      rulesVersion: 'v2', level: 4, weaponClass: 'rifle', weaponLevel: 4, armorTier: 1, traits: [],
      abilityBlueprints: ['bp-arcane-bolt', 'bp-mending', 'bp-iron-guard'].map(id => ({ id, level: 4 })) }, { seed: 'worker:' + i, noVariance: true }).unit;
    unit.id = 'u' + i; return unit;
  });
}
function request(battle: SmallBattle | MassBattle): BattleStepRequest {
  return structuredClone({ kind: battle instanceof SmallBattle ? 'small' : 'mass', snap: battle.toSnapshot(), rules: battle.rules,
    traits: battle.traitRegistry, conditions: battle.conditions.all(), summons: !!battle.summonUnit,
    actorId: battle instanceof SmallBattle ? battle.active?.id : undefined, expectedRound: battle.round });
}
it('background small activations preserve snapshots, RNG, references, and control changes made in flight', () => {
  const field = standardField(7, 13); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null);
  const battle = new SmallBattle({ combatants: units(), battlefield: field, rules: V16_OVERFLOW_D20, seed: 'worker-small' }); battle.start();
  battle.turnOrder = battle.combatants.map(u => u.id); battle.turnIndex = 0;
  battle.combatants.forEach((u, i) => { u.pos = i < 2 ? 71 + i : 43 + i; });
  battle.conditions.register({ id: 'worker-defense', name: '临时防御', mods: [{ source: 'condition', name: '临时防御', kind: 'def', type: 'flat', value: 1 }] });
  battle.combatants[2]!.conditions.push({ id: 'worker-defense', dur: 3 });
  const rng = battle.rng, array = battle.combatants, first = array[0];
  for (let i = 0; i < 3 && !battle.isOver(); i++) {
    const input = request(battle), before = JSON.stringify(battle.toSnapshot());
    const expected = SmallBattle.fromSnapshot(structuredClone(input.snap), { traitRegistry: input.traits });
    input.conditions.forEach(c => expected.conditions.register(c)); expected.autoAction(expected.active!.id);
    const result = computeBattleStep(input);
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    battle.allyAiControl.set('u0', i % 2 === 0);
    applyBattleStep(battle, result);
    expected.allyAiControl = new Map(battle.allyAiControl);
    expect(battle.toSnapshot()).toEqual(expected.toSnapshot());
    expect(battle.rng).toBe(rng); expect(battle.combatants).toBe(array); expect(battle.combatants[0]).toBe(first);
  }
});
it('background mass rounds preserve automatic orders, damage, reports and RNG; read-only scopes always release', () => {
  const registry = traitRegistry(), summonUnit = (id: string, side: 'ally' | 'enemy' | 'neutral', seed?: string) => seed ? seededReinforcement(id, side, seed, registry) : null;
  const battle = new MassBattle({ combatants: units(), rules: V16_OVERFLOW_TW, seed: 'worker-mass', commanderId: 'u0', traitRegistry: registry, summonUnit }); battle.start();
  for (let i = 0; i < 2 && !battle.isOver(); i++) {
    const input = request(battle), expected = MassBattle.fromSnapshot(structuredClone(input.snap), { traitRegistry: registry, summonUnit });
    executeMassPlan(expected, {}, false, expected.round);
    const result = computeBattleStep(input); applyBattleStep(battle, result);
    expect(battle.toSnapshot()).toEqual(expected.toSnapshot()); expect(battle.damageTaken).toEqual(expected.damageTaken);
    expect(previewScopeEpoch()).toBeUndefined();
  }
  expect(() => battle.withReadOnlyQueries(() => { throw Error('query failed'); })).toThrow('query failed');
  expect(previewScopeEpoch()).toBeUndefined();
});
it('invalid background plans cannot alter the source battle', () => {
  const battle = new MassBattle({ combatants: units(), rules: V16_OVERFLOW_TW, seed: 'worker-invalid', commanderId: 'u0' }); battle.start();
  const before = structuredClone(battle.toSnapshot()), input = request(battle);
  input.drafts = { u2: { type: 'hold' } };
  expect(() => computeBattleStep(input)).toThrow('草案包含不属于我方的编队');
  expect(battle.toSnapshot()).toEqual(before);
});
