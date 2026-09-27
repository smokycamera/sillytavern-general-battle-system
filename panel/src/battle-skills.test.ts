import { expect, it } from 'vitest';
import { SmallBattle, MassBattle, traitRegistry, standardField, V7_OVERFLOW_D20, V7_OVERFLOW_TW, type Combatant } from '../../engine/src/index.js';
import { buildUnit, newUnitDraft } from './unit-builder.js';
import { commitBattleOutcome, unitRecordFromCombatant } from './unit-state.js';
import { battleSkillChangeReason, setBattlePreparedSkills } from './battle-skills.js';

const registry = traitRegistry();
function unit(id: string, company = false) {
  const u = buildUnit({ ...newUnitDraft(), name: id, side: id === 'enemy' ? 'enemy' : 'ally', scale: company ? 'company' : 'hero',
    hpMax: '100', skills: Array.from({ length: 6 }, (_, i) => ({ id: 'generic:magic-single', name: id + i, power: '1', prepared: i < 5 })) }, registry, id);
  u.id = id; return u;
}
function small() {
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ rules: V7_OVERFLOW_D20, combatants: [unit('a'), unit('b'), unit('enemy')], battlefield: field, seed: 'switch-skills' });
  b.start(); b.turnOrder = ['a', 'b', 'enemy']; b.turnIndex = 0;
  b.byId('a').pos = 73; b.byId('b').pos = 79; b.byId('enemy').pos = 52;
  return b;
}

it('swapping and swapping back preserve cooldowns, uses, effects and all turn ledgers through reload and settlement', () => {
  const b = small(), actor = b.byId('a'), records = b.combatants.map(u => unitRecordFromCombatant(u));
  actor.resources.SP = 1;
  actor.abilityState = [{ abilityId: actor.abilities[0]!.cooldownGroup!, cdLeft: 2, used: 1 }];
  actor.conditions.push({ id: 'hasted', dur: 3 }); actor.barrier = { remaining: 10, duration: 3 };
  b.movementSpent.set('a', 2); b.hasteSpent.set('a', 1); b.reactionSpent.add('a');
  const before = b.toSnapshot(), selected = actor.abilities.slice(1).map(a => a.id), first = actor.preparedAbilityIds!;
  setBattlePreparedSkills(b, 'a', selected);
  const expected = structuredClone(before); (expected.combatants as Combatant[])[0]!.preparedAbilityIds = selected;
  expect(b.toSnapshot()).toEqual(expected);
  const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
  expect(restored.byId('a').preparedAbilityIds).toEqual(selected);
  expect(restored.getActionOptions('a').find(o => o.id === selected[4])!.enabled).toBe(false);
  setBattlePreparedSkills(restored, 'a', first);
  expect(restored.byId('a').abilityState).toEqual(actor.abilityState);
  expect(restored.getActionOptions('a').find(o => o.id === first[0])!.enabled).toBe(false);
  const outcome = commitBattleOutcome({ battleId: 'small:switch-skills', committedIds: [], records, roster: b.combatants,
    combatants: b.combatants, awards: [], registry });
  expect(outcome.records.find(r => r.id === 'a')!.preparedAbilityIds).toEqual(selected);
});

it('rejects illegal skill lists, other turns, spent main actions and enemies without changing the battle', () => {
  const b = small(), a = b.byId('a'), skills = a.abilities.map(s => s.id);
  a.abilities.push({ ...a.abilities[0]!, id: 'gear', equipmentSourceId: 'item' });
  for (const selected of [skills, [skills[0]!, skills[0]!], ['unknown'], ['gear']]) {
    const before = b.toSnapshot(); expect(() => setBattlePreparedSkills(b, 'a', selected)).toThrow(); expect(b.toSnapshot()).toEqual(before);
  }
  expect(battleSkillChangeReason(b, 'b')).toContain('轮到');
  expect(battleSkillChangeReason(b, 'enemy')).toContain('我方');
  b.actedThisTurn.add('a'); const spent = b.toSnapshot();
  expect(() => setBattlePreparedSkills(b, 'a', [])).toThrow(/主行动/); expect(b.toSnapshot()).toEqual(spent);
});

it('changing an attached hero cancels only orders using their removed skill and preserves the company and other orders', () => {
  const host = unit('host', true), other = unit('other', true), hero = unit('hero'), foe = unit('enemy', true);
  const b = new MassBattle({ rules: V7_OVERFLOW_TW, combatants: [host, other, hero, foe], seed: 'mass-switch' }); b.start();
  expect(b.isAttached(hero.id)).toBe(true);
  const hostId = [...b.attached].find(([, id]) => id === hero.id)![0];
  const otherId = [host.id, other.id].find(id => id !== hostId)!;
  expect(b.issue({ unitId: hostId, type: 'ability', abilityActorId: hero.id, abilityId: hero.abilities[0]!.id, targetId: foe.id }).ok).toBe(true);
  expect(b.issue({ unitId: otherId, type: 'brace' }).ok).toBe(true);
  const before = b.toSnapshot();
  setBattlePreparedSkills(b, hero.id, hero.abilities.slice(1).map(a => a.id));
  expect(b.orders.get(hostId)).toEqual({ unitId: hostId, type: 'hold' });
  expect(b.orders.get(otherId)).toEqual({ unitId: otherId, type: 'brace' });
  const expected = structuredClone(before); (expected.combatants as Combatant[]).find(u => u.id === hero.id)!.preparedAbilityIds = hero.preparedAbilityIds;
  expected.orders = [...b.orders.values()];
  expect(b.toSnapshot()).toEqual(expected);
});
