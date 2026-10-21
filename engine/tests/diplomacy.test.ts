import { describe, expect, it } from 'vitest';
import { applyDiplomacy, generateUnit, incomingDiplomacy, MassBattle, observedLog, SmallBattle, standardField, V24_OVERFLOW_D20, V24_OVERFLOW_TW, type Side } from '../src/index.js';
import { decideMorale } from '../src/morale.js';

function fixture(three = false, mass = false) {
  const units = (three ? ['ally', 'enemy', 'neutral'] : ['ally', 'enemy']).map((side, i) => {
    const u = generateUnit({ name: side, side: side as Side, scale: 'hero', rulesVersion: 'v2', level: 4, hpMax: 200,
      weaponClass: 'sword', traits: ['steadfast'] }, { seed: 'diplomacy-' + i, noVariance: true }).unit;
    u.id = side; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = mass ? new MassBattle({ combatants: units, formationSlots: 3, rules: V24_OVERFLOW_TW, seed: 'diplomacy-mass' })
    : new SmallBattle({ combatants: units, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'diplomacy-small' });
  b.start(); units.forEach((u, i) => { u.pos = 35 + i * 2; }); return b;
}
describe('bilateral surrender and withdrawal', () => {
  it.each([false, true])('rejects without ending combat, preserves exact reply and rejects duplicate responses (mass=%s)', mass => {
    const b = fixture(false, mass), before = b.combatants.map(u => [u.hp, u.status]);
    applyDiplomacy(b, 'enemy', { mode: 'surrender', target: 'ally', text: '请接受投降。' });
    const saved = mass ? MassBattle.fromSnapshot(structuredClone(b.toSnapshot())) : SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    expect(incomingDiplomacy(saved, 'ally')).toHaveLength(1);
    applyDiplomacy(saved, 'ally', { mode: 'reject', id: 1, text: '守住桥再谈，“我方”二字原样保留。' });
    expect(saved.isOver()).toBe(false); expect(saved.combatants.map(u => [u.hp, u.status])).toEqual(before);
    expect(saved.log.at(-1)?.text).toContain('我方拒绝了敌方的投降请求：“守住桥再谈，“我方”二字原样保留。”');
    const count = saved.log.length;
    expect(() => applyDiplomacy(saved, 'ally', { mode: 'accept', id: 1 })).toThrow(); expect(saved.log).toHaveLength(count);
  });
  it.each([false, true])('ends two-faction surrender as the accepting faction victory (mass=%s)', mass => {
    const b = fixture(false, mass), hp = b.combatants.map(u => u.hp);
    applyDiplomacy(b, 'enemy', { mode: 'surrender', target: 'ally' });
    applyDiplomacy(b, 'ally', { mode: 'accept', id: 1 });
    expect(b.isOver()).toBe(true); expect(b.winner()).toBe('ally'); expect(b.combatants.map(u => u.hp)).toEqual(hp);
    expect(b.log.at(-1)?.text).toContain('敌方投降');
  });
  it('ends two-faction withdrawal as a draw without routing allied units', () => {
    const b = fixture(); applyDiplomacy(b, 'enemy', { mode: 'withdraw', target: 'ally' });
    applyDiplomacy(b, 'ally', { mode: 'accept', id: 1 });
    expect([b.isOver(), b.winner(), b.byId('ally').status]).toEqual([true, 'draw', 'ready']);
  });
  it('routes only the surrendering AI in a three-faction battle, overrides steadfast and never rallies after load', () => {
    const b = fixture(true); applyDiplomacy(b, 'enemy', { mode: 'surrender', target: 'neutral' });
    expect(observedLog(b.log, 'ally').some(e => e.text.includes('提出投降'))).toBe(false);
    applyDiplomacy(b, 'neutral', { mode: 'accept', id: 1 });
    const loaded = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())), u = loaded.byId('enemy');
    expect([loaded.isOver(), u.status, loaded.byId('ally').status, loaded.byId('neutral').status]).toEqual([false, 'routing', 'ready', 'ready']);
    for (let round = 2; round <= 4; round++) {
      const decision = decideMorale({ units: loaded.combatants, mode: 'small', fieldTags: [] }, u, round, loaded.rng, loaded.rules.morale.breakAt, loaded.traitRegistry);
      expect(decision.kind).toBe(round === 4 ? 'fled' : 'failed');
      u.moraleState = decision.state; if (decision.kind === 'fled') u.status = 'fled';
    }
    expect(u.traits).toContain('steadfast');
  });
  it('a bilateral AI-player withdrawal never routes any allied unit while the third faction keeps fighting', () => {
    const b = fixture(true), ally = b.byId('ally'), snapshot = JSON.stringify(ally);
    applyDiplomacy(b, 'enemy', { mode: 'withdraw', target: 'ally' }); applyDiplomacy(b, 'ally', { mode: 'accept', id: 1 });
    expect(JSON.stringify(ally)).toBe(snapshot); expect(b.byId('enemy').status).toBe('routing');
    expect(b.byId('neutral').status).toBe('ready'); expect(b.isOver()).toBe(false);
    expect(b.log.at(-1)?.text).toContain('我方保持原状态');
  });
  it('routes both AI participants in a bilateral withdrawal with a third party present, not the allied faction', () => {
    const b = fixture(true); applyDiplomacy(b, 'enemy', { mode: 'withdraw', target: 'neutral' });
    applyDiplomacy(b, 'neutral', { mode: 'accept', id: 1 });
    expect(b.combatants.map(u => u.status)).toEqual(['ready', 'routing', 'routing']); expect(b.isOver()).toBe(false);
    expect(() => applyDiplomacy(b, 'ally', { mode: 'withdraw', target: 'all' as Side })).toThrow();
  });
});
