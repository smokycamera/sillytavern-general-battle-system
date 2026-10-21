import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20, gridDistance, createStructure, attachCarriedItems, compileItem, applyCombatDamage, memberHealth, type UnitIntent } from '../src/index.js';
function fixture() {
  const field = standardField(7, 13); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null);
  const combatants = ['ally','ally','enemy','enemy'].map((side, i) => {
    const u = generateUnit({ name: '队'+i, side: side as 'ally'|'enemy', scale: 'company', hpMax: 40, rulesVersion: 'v2', level: 4,
      weaponClass: 'rifle', weaponLevel: 4, armorTier: 1, traits: [] }, { seed: 'intent-unit-'+i, noVariance: true }).unit;
    u.id = 'u'+i; return u;
  });
  const b = new SmallBattle({ combatants, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'intent-baseline' }); b.start();
  combatants.forEach((u,i) => u.pos = [77,79,14,16][i]); return b;
}
function navigationFixture() {
  const b = fixture(); b.combatants.splice(1, 1); // one opponent and two friendly units
  const f = b.battlefield!; f.objective = { kind: 'control', cell: 10, rounds: 10, limit: 60 };
  b.turnOrder = ['u2', 'u3', 'u0']; b.turnIndex = 0; b.byId('u2').pos = 17; b.byId('u3').pos = 3; b.byId('u0').pos = 86;
  return b;
}
function nextActor(b: SmallBattle) { while (b.active?.id !== 'u2' && !b.isOver()) b.endTurn(); }
describe('unit intents', () => {
  it('T1 preserves the pre-change three-round replay', () => {
    const b = fixture(); let guard = 0;
    while (!b.isOver() && b.round <= 3 && guard++ < 100) b.autoAction(b.active!.id);
    expect(createHash('sha256').update(JSON.stringify(b.toSnapshot())).digest('hex')).toBe('2da788e414e6d04e0fd6cf91c25c8da19ab5c8e5671d0e7d11b71bdde5e6db65');
  }, 120_000);
  it.each<UnitIntent>([{ mode: 'advance', cell: 45 }, { mode: 'hold', cell: 15 }, { mode: 'withdraw', cell: 1 }, { mode: 'support', supportId: 'u3' }, { mode: 'attack', targetId: 'u1' }])('T2 executes $mode through grid AI', intent => {
    const b = fixture(); b.turnOrder = ['u2','u3','u0','u1']; b.turnIndex = 0;
    b.byId('u0').pos = 43; b.byId('u1').pos = 45; b.byId('u3').pos = 29;
    const actor = b.byId('u2'), before = actor.pos!, distance = (a: number, z: number) => gridDistance(b.battlefield!, a, z);
    const logs = b.log.length;
    if (intent.mode === 'advance') { const visible = b.visibleCombatants.bind(b); vi.spyOn(b, 'visibleCombatants').mockImplementation(side => visible(side).filter(u => u.side === side)); }
    b.autoAction(actor.id, intent);
    const nearest = (cell: number) => Math.min(...['u0','u1'].map(id => distance(cell, b.byId(id).pos!)));
    const ok = intent.mode === 'advance' ? distance(actor.pos!, intent.cell!) < distance(before, intent.cell!)
      : intent.mode === 'hold' ? distance(actor.pos!, intent.cell!) <= 5
      : intent.mode === 'withdraw' ? nearest(actor.pos!) >= nearest(before)
      : intent.mode === 'support' ? distance(actor.pos!, b.byId('u3').pos!) <= distance(before, b.byId('u3').pos!)
      : b.log.slice(logs).some(e => e.kind === 'attack' && e.resolution?.attackerId === actor.id && e.resolution.defenderId === 'u1');
    expect(ok).toBe(true);
  });
  it.each<UnitIntent>([{ mode: 'attack', targetId: 'absent' }, { mode: 'advance', cell: 9999 }])('T3 ignores invalid $mode intents', intent => {
    const a = fixture(), b = fixture(); a.autoAction(a.active!.id); b.autoAction(b.active!.id, intent);
    expect(b.toSnapshot()).toEqual(a.toSnapshot());
  });
  it('obeys a sortie across a closed friendly gate and stays at the assigned location', () => {
    const b = navigationFixture(), f = b.battlefield!, actor = b.byId('u2');
    for (let p = 21; p < 28; p++) f.structures![p] = createStructure('wall', 10);
    f.structures![24] = createStructure('gate', 3, { owner: 'enemy', gateState: 'closed' });
    f.city = { shape: 'front', inside: Array.from({ length: 21 }, (_, i) => i), frontline: [21,22,23,24,25,26,27], gates: [24], core: [10], reserve: [17], defender: 'enemy' };
    const start = b.log.length; b.autoAction(actor.id, { mode: 'advance', cell: 38 });
    expect([actor.pos, f.structures![24]!.gateState]).toEqual([38, 'open']);
    expect(b.log.slice(start).some(e => e.resolution?.attackerId === actor.id)).toBe(false);
    nextActor(b); b.autoAction(actor.id, { mode: 'hold', cell: 38 }); expect(actor.pos).toBe(38);
    b.combatants.push({ ...structuredClone(b.byId('u0')), id: 'retired-target', hp: 0, status: 'dead' });
    nextActor(b); b.autoAction(actor.id, { mode: 'attack', targetId: 'retired-target' }); expect(actor.pos).toBe(38);
  });
  it.each(['wall', 'tower'] as const)('routes up and down a %s without changing the destination', kind => {
    const b = navigationFixture(), f = b.battlefield!, actor = b.byId('u2'); actor.pos = 16;
    f.structures![14] = createStructure(kind, 3, { owner: 'enemy', top: true, access: [15] });
    b.autoAction(actor.id, { mode: 'advance', cell: 14 }); expect([actor.pos, actor.elevation]).toEqual([14, 1]);
    nextActor(b); b.autoAction(actor.id, { mode: 'withdraw', cell: 16 }); expect([actor.pos, actor.elevation]).toEqual([16, undefined]);
  });
  it('opens and closes a specified gate idempotently and respects a contested gate', () => {
    const b = navigationFixture(), f = b.battlefield!, actor = b.byId('u2');
    f.structures![24] = createStructure('gate', 3, { owner: 'enemy', gateState: 'closed' });
    b.autoAction(actor.id, { mode: 'open_gate', cell: 24 }); expect(f.structures![24]!.gateState).toBe('open');
    nextActor(b); b.autoAction(actor.id, { mode: 'close_gate', cell: 24 }); expect(f.structures![24]!.gateState).toBe('closed');
    nextActor(b); const start = b.log.length; b.autoAction(actor.id, { mode: 'close_gate', cell: 24 });
    expect(b.log.slice(start).filter(e => e.gate)).toHaveLength(0); expect(actor.pos).toBe(17);
    nextActor(b); f.structures![24]!.gateState = 'open'; actor.pos = 24;
    b.autoAction(actor.id, { mode: 'close_gate', cell: 24 }); expect(actor.pos).not.toBe(24); expect(f.structures![24]!.gateState).toBe('closed');
    nextActor(b); b.byId('u0').pos = 31; vi.spyOn(b, 'visibleCombatants').mockImplementation(() => b.combatants);
    b.autoAction(actor.id, { mode: 'open_gate', cell: 24 }); expect(f.structures![24]!.gateState).toBe('closed');
  });
  it('treats a legal priority target as a constraint, including beside another tempting opponent', () => {
    const b = fixture(); b.turnOrder = ['u2','u3','u0','u1']; b.turnIndex = 0;
    b.byId('u0').pos = 43; b.byId('u1').pos = 45; const actor = b.byId('u2'), start = b.log.length;
    b.autoAction(actor.id, { mode: 'hold', cell: 15, targetId: 'u1' });
    expect(actor.pos).toBe(15);
    const attacks = b.log.slice(start).flatMap(e => e.resolution?.attackerId === actor.id ? [e.resolution.defenderId] : []);
    expect(attacks.length).toBeGreaterThan(0); expect(new Set(attacks)).toEqual(new Set(['u1']));
  });
  it('moves into skill range, buffs the requested friend, and keeps cooldown and item accounting', () => {
    const b = navigationFixture(), actor = b.byId('u2'), friend = b.byId('u3'); friend.pos = 38;
    actor.abilities.push({ id: 'ward', name: '守护', target: 'ally', delivery: 'magic', range: { min: 0, max: 2, metric: 'grid' },
      cost: { resource: 'MP', amount: 2 }, cooldown: 3, effects: [{ op: 'condition', conditionId: 'blessed', dur: 3 }] }); actor.preparedAbilityIds = ['ward']; actor.resources.MP = 8;
    b.autoAction(actor.id, { mode: 'use_ability', abilityId: 'ward', targetId: friend.id });
    expect(friend.conditions.some(c => c.id === 'blessed'), JSON.stringify(b.log.slice(-6))).toBe(true); expect(actor.resources.MP).toBe(6); expect(actor.pos).toBe(24);
    nextActor(b); b.autoAction(actor.id, { mode: 'use_ability', abilityId: 'ward', targetId: friend.id }); expect(actor.resources.MP).toBe(6);
    Object.assign(actor, attachCarriedItems(actor, [{ id: 'dose', name: '急救剂', quantity: 80, revision: 1,
      mechanics: compileItem({ kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, { id: 'dose', seed: 'dose' }) }]));
    applyCombatDamage(actor, 25, 1);
    nextActor(b); const before = actor.resources['item:dose'], health = memberHealth(actor);
    b.autoAction(actor.id, { mode: 'use_ability', abilityId: 'item:dose', targetId: actor.id });
    expect(actor.resources['item:dose']).toBeLessThan(before!); expect(memberHealth(actor)).toBeGreaterThan(health);
    nextActor(b); actor.resources['item:dose'] = 0; const after = memberHealth(actor);
    b.autoAction(actor.id, { mode: 'use_ability', abilityId: 'item:dose', targetId: actor.id });
    expect([actor.resources['item:dose'], memberHealth(actor)]).toEqual([0, after]);
  });
});
