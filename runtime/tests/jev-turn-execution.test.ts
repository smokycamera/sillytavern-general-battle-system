import { afterEach, expect, it } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { generateUnit, SmallBattle, standardField, V4_OVERFLOW_D20, traitRegistry } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import { JevCommandController, defaultJevSettings, type JevBattleState } from '../../panel/src/jev-command.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));

it('saves JEV enemy turns and restores movement and actions on the next allied activation', async () => {
  const f = nativeFixture(); cleanups.push(() => f.service.dispose()); await f.service.start();
  const registry = traitRegistry();
  const units = ['ally', 'enemy'].map((side, i) => {
    const unit = generateUnit({ rulesVersion: 'v2', name: side, side: side as 'ally' | 'enemy', scale: 'hero', level: 3, weaponClass: 'sword', traits: [] }, { seed: side }).unit;
    unit.id = 'u' + i; unit.morale = unit.base.moraleMax = 100; return unit;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, seed: 'jev-turn-save', rules: V4_OVERFLOW_D20, traitRegistry: registry });
  b.start(); b.turnOrder = ['u0', 'u1']; b.turnIndex = 0;
  b.byId('u0').pos = 79; b.byId('u1').pos = 9;
  b.movementSpent.set('u0', 2); b.actedThisTurn.add('u0');
  const settings = { ...defaultJevSettings(), mode: 'jev' as const };
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(unit => unitRecordFromCombatant(unit)), rosterIds: units.map(unit => unit.id), jevSettings: settings, battle: { kind: 'small', snap: b.toSnapshot() } }));
  const controller = new JevCommandController(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ model: 'fixture', confidence: .9, scores: Object.fromEntries(request.candidates.map((c: {id: string}) => [c.id, .5])) }));
  });
  for (let turn = 0; turn < 3; turn++) {
    const before = f.service.snapshot();
    const live = SmallBattle.fromSnapshot(structuredClone(before.battle!.snap), { traitRegistry: registry });
    live.endTurn();
    const result = await controller.prepare(live, before.jevBattle as JevBattleState | undefined, settings, {url:'http://127.0.0.1:4317', token:'fixture'}, { battleId:'fixture', namespace:'a', valid: () => f.service.canWrite() });
    Object.assign(live, result.battle);
    const receipt = await f.service.persistPanel({...before, battle: {kind:'small', snap:live.toSnapshot()}, jevBattle:result.state}, before.factRevision ?? 0);
    expect(receipt.status, receipt.error).toBe('confirmed');
    const restored = SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
    expect(restored.active?.id).toBe('u0');
    expect(restored.round).toBe(turn + 2);
    expect(restored.actedThisTurn.has('u0')).toBe(false);
    expect(restored.movementSpent.has('u0')).toBe(false);
    expect(restored.log.some(e => e.kind === 'move' && e.participants?.includes('u1'))).toBe(true);
  }
});
