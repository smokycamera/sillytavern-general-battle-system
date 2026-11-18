import { describe, expect, it } from 'vitest';
import { LITE_D20, V41_OVERFLOW_D20, V42_LITE_D20, V42_OVERFLOW_D20 } from '../src/rules.js';
import { SeededRng, type Rng } from '../src/rng.js';
import { SmallBattle, makeCombatant } from '../src/small/battle.js';
import type { RulePack } from '../src/types.js';
import { buildEncounter } from '../../panel/src/game-encounter.js';

const ids = ['a1', 'a2', 'b1', 'b2'];
const units = (order: string[]) => order.map(id => makeCombatant({
  id, name: id, side: id.startsWith('a') ? 'ally' : 'enemy',
  base: { atk: 4, def: 12, spd: 0, hpMax: 20 },
}));
const tied: Rng = { seed: 'forced-tie', d: () => 10, next: () => 0.5 };

function opening(order: string[], rules: RulePack, seed: string, rng?: Rng) {
  const battle = new SmallBattle({ combatants: units(order), rules, seed, rng });
  battle.start();
  return battle;
}

describe.each([V42_OVERFLOW_D20, V42_LITE_D20])('small initiative $id', rules => {
  it('assigns the same d20 totals and order after a roster reordering and spends one combat die per unit', () => {
    const seed = 'mixed rolls';
    const a = opening(ids, rules, seed), b = opening([...ids].reverse(), rules, seed);
    expect(a.log.find(e => e.kind === 'initiative')!.text).toBe(b.log.find(e => e.kind === 'initiative')!.text);
    expect(a.turnOrder).toEqual(b.turnOrder);
    const rng = new SeededRng(seed);
    for (const _id of ids) rng.d(20);
    expect(a.rng.next()).toBe(rng.next());
  });

  it('breaks exact ties independently of the roster, and allows consecutive allies', () => {
    const leaders = new Set<string>();
    let consecutiveAllies = false;
    for (let i = 0; i < 24; i++) {
      const seed = String(i);
      const a = opening(ids, rules, seed, tied);
      const b = opening(['b1', 'a2', 'b2', 'a1'], rules, seed, tied);
      expect(a.turnOrder).toEqual(b.turnOrder);
      leaders.add(a.turnOrder[0]!);
      consecutiveAllies ||= a.turnOrder[0]!.startsWith('a') && a.turnOrder[1]!.startsWith('a');
    }
    expect(leaders).toEqual(new Set(ids));
    expect(consecutiveAllies).toBe(true);
  });

  it('orders by total and then by natural die before applying the lottery', () => {
    const seed = 'score before lottery';
    const tieOrder = opening(ids, rules, seed, tied).turnOrder;
    const roster = units(ids);
    // Lottery order gets totals 10, 10, 30, 1. The second unit wins the tied total on its higher d20.
    roster.find(u => u.id === tieOrder[0])!.base.spd = 8;
    roster.find(u => u.id === tieOrder[2])!.base.spd = 25;
    const dice = [2, 10, 5, 1];
    const battle = new SmallBattle({ combatants: roster, rules, seed, rng: { ...tied, d: () => dice.shift()! } });
    battle.start();
    expect(battle.turnOrder).toEqual([tieOrder[2], tieOrder[1], tieOrder[0], tieOrder[3]]);
  });
});

it.each([LITE_D20, V41_OVERFLOW_D20, V42_OVERFLOW_D20, V42_LITE_D20])('resumes the saved $id queue and active unit', rules => {
  const battle = opening([...ids].reverse(), rules, 'resume', tied);
  if (!rules.initiativeModel) expect(battle.turnOrder).toEqual([...ids].reverse());
  battle.endTurn();
  const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
  restored.start();
  expect(restored.rules.id).toBe(rules.id);
  expect(restored.turnOrder).toEqual(battle.turnOrder);
  expect(restored.active?.id).toBe(battle.active?.id);
});

it('uses the supplied encounter seed for new lightweight small battles', () => {
  function start(order: string[]) {
    const battle = buildEncounter({ roster: units(order), seed: 'lite encounter', nonLethal: false, registry: new Map(),
      setup: { mode: 'small', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' },
      summonUnit: () => null });
    if (!(battle instanceof SmallBattle)) throw Error('Expected a small battle');
    expect(battle.rules.id).toBe(V42_LITE_D20.id);
    expect(battle.seed).toBe('lite encounter');
    return battle.turnOrder;
  }
  expect(start(ids)).toEqual(start([...ids].reverse()));
});
