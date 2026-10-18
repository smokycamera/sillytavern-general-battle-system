import { describe, expect, it } from 'vitest';
import { generateUnit, generatedLayeredField, SmallBattle, standardField, V20_OVERFLOW_D20, type Side } from '../src/index.js';

const sides: Side[] = ['ally', 'enemy', 'neutral'];
function unit(side: Side) {
  const u = generateUnit({ name: side, side, scale: 'hero', level: 3, rulesVersion: 'v2', weaponClass: 'sword', traits: [] }, { seed: side, noVariance: true }).unit;
  u.id = side; u.morale = u.base.moraleMax = 100; return u;
}
function battle(participants = sides, control = false): SmallBattle {
  const combatants = participants.map(unit);
  const field = standardField(9, 15); field.tiles.fill('open');
  if (control) field.objective = { kind: 'control', cell: 58, rounds: 2, limit: 60 };
  const b = new SmallBattle({ combatants, battlefield: field, rules: V20_OVERFLOW_D20, seed: 'three-way' });
  b.start(); return b;
}
function roundEnd(b: SmallBattle): void { b.turnIndex = b.turnOrder.length - 1; b.endTurn(); }

describe('small three-way battles', () => {
  it.each([
    { participants: sides, left: ['enemy', 'neutral'], winner: undefined },
    { participants: sides, left: ['ally', 'neutral'], winner: undefined },
    { participants: sides, left: ['ally', 'enemy'], winner: undefined },
    ...sides.map(side => ({ participants: sides, left: [side], winner: side })),
    { participants: sides, left: [], winner: 'draw' },
    { participants: ['ally', 'enemy'] as Side[], left: ['ally', 'enemy'], winner: undefined },
    { participants: ['ally', 'enemy'] as Side[], left: ['ally'], winner: 'ally' },
    { participants: ['ally', 'enemy'] as Side[], left: ['enemy'], winner: 'enemy' },
    { participants: ['ally', 'enemy'] as Side[], left: [], winner: 'draw' },
  ])('annihilation: $participants remaining $left => $winner', ({ participants, left, winner }) => {
    const b = battle(participants);
    b.combatants.forEach(u => { if (!left.includes(u.side)) u.status = 'fled'; });
    expect([b.isOver(), b.winner()]).toEqual([winner !== undefined, winner]);
  });

  it('counts routing by real side and lets the remaining AI sides act after the player exits', () => {
    const b = battle(); b.byId('ally').status = 'fled'; b.byId('enemy').status = 'routing';
    expect(b.isOver()).toBe(false);
    b.byId('enemy').status = 'ready'; b.byId('enemy').pos = 28; b.byId('neutral').pos = 27;
    b.turnOrder = ['neutral', 'enemy', 'ally']; b.turnIndex = 0;
    const n = b.byId('neutral'); n.base.atk = 100; n.weapon!.baseDice = '100d6'; n.weapon!.apDice = '100d6'; n.weapon!.penetration = 100;
    b.autoAction(n.id);
    expect([b.byId('enemy').status, b.winner()]).toEqual(['dead', 'neutral']);
  });

  it.each(['ally', 'enemy'] as const)('interrupts a third-party hold when %s contests, then awards two full rounds alone', side => {
    const b = battle(sides, true);
    b.byId('neutral').pos = 58; b.byId('ally').pos = 100; b.byId('enemy').pos = 1;
    roundEnd(b); roundEnd(b);
    expect(b.controlRounds.neutral).toBe(1);
    b.byId(side).pos = 59; roundEnd(b);
    expect([b.controlRounds.neutral, b.controlHold]).toEqual([0, undefined]);
    b.byId(side).pos = side === 'ally' ? 100 : 1;
    roundEnd(b); roundEnd(b); roundEnd(b);
    expect([b.winner(), b.controlRounds.neutral]).toEqual(['neutral', 2]);
  });

  it('restores deployment, hold, command profile and RNG before the same next local action', () => {
    const combatants = sides.map(unit);
    const field = generatedLayeredField('three-way-save', 7, 13, [], { roster: combatants });
    field.objective = { kind: 'control', cell: field.initialDeployment!.neutral!.pos, rounds: 2, limit: 60 };
    const b = new SmallBattle({ combatants, battlefield: field, rules: V20_OVERFLOW_D20, seed: 'three-way-save' }); b.start();
    b.commanderProfiles = { enemy: { ability: 'novice', style: 'aggressive' }, neutral: { ability: 'master', style: 'balanced', scoring: 'tactical-v2' } };
    roundEnd(b); roundEnd(b);
    b.turnOrder = ['neutral', 'enemy', 'ally']; b.turnIndex = 0;
    const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    expect(restored.controlHold?.side).toBe('neutral');
    b.autoAction('neutral'); restored.autoAction('neutral');
    expect(restored.toSnapshot()).toEqual(b.toSnapshot());
    b.byId('ally').status = b.byId('enemy').status = 'fled';
    expect(SmallBattle.fromSnapshot(b.toSnapshot()).winner()).toBe('neutral');
  });
});
