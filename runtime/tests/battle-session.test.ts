import { expect, it, vi } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { attachCarriedItems, compileItem, generateUnit, SmallBattle, standardField, V2_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';

it('keeps multiple turns and item consumption in memory, then commits the cumulative result once', async () => {
  const f = nativeFixture(); await f.service.start();
  const units = ['a', 'enemy'].map(id => {
    const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', rulesVersion: 'v2', level: 3,
      hpMax: 40, hp: id === 'a' ? 10 : 40, weaponClass: 'sword', traits: [] }, { seed: id }).unit;
    u.id = id; return u;
  });
  const mechanics = compileItem({ kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, { id: 'dose', seed: 'dose' });
  units[0] = attachCarriedItems(units[0]!, [{ id: 'dose', name: '急救剂', quantity: 3, revision: 1, mechanics }]);
  const b = new SmallBattle({ rules: V2_D20, battlefield: standardField(), combatants: units, seed: 'session-items' }); b.start();
  b.turnOrder = ['a', 'enemy']; b.turnIndex = 0;
  const opening = { schemaVersion: 2, battle: { kind: 'small' as const, snap: b.toSnapshot() }, storage: units.map(u => unitRecordFromCombatant(u)),
    rosterIds: units.map(u => u.id), inventory: [{ id: 'dose', name: '急救剂', qty: 3, lootType: 'item' as const, revision: 1, assignedTo: 'a', mechanics }] };
  await f.service.transact(() => structuredClone(opening));
  const saved = f.store.envelope(), write = vi.spyOn(f.journal, 'put'), read = vi.spyOn(f.host, 'readPersisted');
  const accept = async (memoryOnly: boolean) => {
    const before = f.service.snapshot();
    return f.service.persistPanel({ ...before, battle: { kind: 'small', snap: b.toSnapshot() } }, before.factRevision ?? 0, { memoryOnly });
  };
  for (let i = 0; i < 2; i++) {
    const actor = b.byId('a'), ability = actor.abilities.find(a => a.itemSourceId === 'dose')!;
    expect(b.useAbility(actor.id, ability.id, actor.id).ok).toBe(true);
    expect(await accept(true)).toMatchObject({ status: 'confirmed', memoryOnly: true });
    expect(f.service.snapshot().inventory![0]!.qty).toBe(2 - i);
    b.endTurn(); b.endTurn();
  }
  await f.service.setPromptSettings({});
  expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(f.store.envelope()).toEqual(saved);
  f.service.beginGeneration(); expect(vi.mocked(f.host.context().setExtensionPrompt!).mock.calls.at(-1)![1]).toContain('第2/');
  b.finishBattle('ceasefire'); expect((await accept(false)).status).toBe('confirmed');
  expect(write).toHaveBeenCalledTimes(1); expect(f.store.snapshot().inventory![0]!.qty).toBe(1);
  expect(SmallBattle.fromSnapshot(f.store.snapshot().battle!.snap).isOver()).toBe(true);
  const beforeRepeat = f.service.snapshot();
  expect((await f.service.persistPanel(beforeRepeat, beforeRepeat.factRevision ?? 0)).status).toBe('confirmed');
  expect(write).toHaveBeenCalledTimes(1); expect(f.store.snapshot().inventory![0]!.qty).toBe(1);
  await f.service.load(); expect(f.service.snapshot()).toEqual(f.store.snapshot()); f.service.dispose();
});

it('reloading or switching chats drops session progress and reads the opening checkpoint', async () => {
  const f = nativeFixture(); await f.service.start();
  const start = { schemaVersion: 2, battle: { kind: 'small' as const, snap: { seed: 'opening', round: 1 } } };
  await f.service.transact(() => start);
  const snapshot = f.service.snapshot();
  expect((await f.service.persistPanel({ ...snapshot, battle: { kind: 'small', snap: { seed: 'opening', round: 4 } } }, 0, { memoryOnly: true })).memoryOnly).toBe(true);
  expect(f.service.snapshot().battle!.snap.round).toBe(4); expect(f.store.snapshot().battle!.snap.round).toBe(1);
  f.context.chatMetadata = structuredClone(f.context.chatMetadata);
  expect(f.service.canWrite()).toBe(true); expect(f.service.snapshot().battle!.snap.round).toBe(4);
  await f.service.load(); expect(f.service.snapshot().battle!.snap.round).toBe(1);
  const before = f.service.snapshot(); await f.service.persistPanel({ ...before, battle: { kind: 'small', snap: { seed: 'opening', round: 5 } } }, before.factRevision ?? 0, { memoryOnly: true });
  f.switchTo('b'); await f.service.load(); expect(f.service.snapshot().battle).toBeUndefined();
  f.switchTo('a'); await f.service.load(); expect(f.service.snapshot().battle!.snap.round).toBe(1); f.service.dispose();
});
