import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, V35_OVERFLOW_D20, gridDistance } from '../src/index.js';

function setup(start = 31, ranged = false, aerialTarget = false) {
  const unit = (id: string, flying: boolean, weaponClass: 'sword' | 'bow') => {
    const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', rulesVersion: 'v2',
      level: 5, hpMax: 500, weaponClass, armorTier: 0, traits: flying ? ['flying'] : [], traitLevels: flying ? { flying: 5 } : {} }, { seed: id, noVariance: true }).unit;
    u.id = id; return u;
  };
  const a = unit('a', true, ranged ? 'bow' : 'sword'), d = unit('d', aerialTarget, 'sword'), field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [a, d], battlefield: field, rules: V35_OVERFLOW_D20, seed: 'flight-unit-intent' }); battle.start();
  a.pos = start; d.pos = 17; battle.turnOrder = ['a', 'd']; battle.turnIndex = 0;
  return { a, d, battle };
}
const attacked = (battle: SmallBattle) => battle.log.some(e => e.resolution?.attackerId === 'a' && e.resolution.defenderId === 'd');

describe('flying units follow attack intents', () => {
  it.each([31, 17])('approaches a legal landing cell and attacks instead of hovering over the target from cell %i', start => {
    const { a, d, battle } = setup(start);
    battle.autoAction(a.id, { mode: 'attack', targetId: d.id });
    expect(attacked(battle)).toBe(true); expect(a.airborne).toBe(false);
    expect(a.pos).not.toBe(d.pos); expect(gridDistance(battle.battlefield!, a.pos!, d.pos!)).toBe(1);
    expect(battle.log.some(e => e.intentFailure && !e.intentFailure.temporary)).toBe(false);
  });

  it.each([[true, false], [false, true]] as const)('keeps flight for ranged=%s against aerial=%s targets', (ranged, aerialTarget) => {
    const { a, d, battle } = setup(31, ranged, aerialTarget);
    battle.autoAction(a.id, { mode: 'attack', targetId: d.id });
    expect(attacked(battle)).toBe(true); expect(a.airborne).toBe(true); expect(a.pos).not.toBe(d.pos);
  });

  it('leaves a blocked ground cell before landing to attack', () => {
    const { a, d, battle } = setup(24); battle.battlefield!.tiles[24] = 'wall';
    battle.autoAction(a.id, { mode: 'attack', targetId: d.id });
    expect(attacked(battle)).toBe(true); expect(a.airborne).toBe(false);
    expect(a.pos).not.toBe(24); expect(a.pos).not.toBe(d.pos);
  });

  it('continues after movement exhaustion and save/reload, paying for the landing before attacking', () => {
    const { a, d, battle } = setup(45);
    battle.movementSpent.set(a.id, battle.movementLeft(a.id) - 1);
    battle.autoAction(a.id, { mode: 'attack', targetId: d.id });
    expect(attacked(battle)).toBe(false); expect(a.airborne).toBe(true);
    const loaded = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    while (loaded.active?.id !== a.id && !loaded.isOver()) loaded.endTurn();
    loaded.autoAction(a.id, { mode: 'attack', targetId: d.id });
    expect(attacked(loaded)).toBe(true); expect(loaded.byId(a.id).airborne).toBe(false);
    expect(loaded.byId(a.id).pos).not.toBe(loaded.byId(d.id).pos);
    expect(loaded.log.some(e => e.kind === 'move' && e.text.includes('降落'))).toBe(true);
  });
});
