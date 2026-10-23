import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { generateUnit, SmallBattle, V25_OVERFLOW_D20 } from '../../engine/src/index.js';
import { prepareInventoryState } from '../../panel/src/inventory-state.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import type { NarrativeSave } from '../../panel/src/narrative-state.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
function oldSave(): NarrativeSave {
  const unit = generateUnit({ name: '旧炮兵', side: 'ally', scale: 'company', level: 4, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [], weaponClass: 'cannon', armorTier: 3 }, { seed: 'native-old-load' }).unit;
  return prepareInventoryState({ schemaVersion: 2, storage: [unitRecordFromCombatant(unit)], rosterIds: [unit.id], factRevision: 3 });
}
async function seed(save: NarrativeSave) {
  const f = nativeFixture(); cleanups.push(() => f.service.dispose());
  await f.store.load(); expect((await f.store.commit(0, () => save)).status).toBe('confirmed'); return f;
}
it('原生读档自动持久化一次，重新载入不重复写入', async () => {
  const f = await seed(oldSave()), saves = vi.fn(f.context.saveMetadata!);
  f.context.saveMetadata = saves;
  await f.service.start();
  expect(f.service.status().phase).toBe('ready');
  expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(12);
  expect(f.service.snapshot().factRevision).toBe(4);
  const writes = saves.mock.calls.length; expect(writes).toBe(1);
  await f.service.load(); expect(saves).toHaveBeenCalledTimes(writes);
  expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(12);
});
it('保存失败时仍发布原数值，重试提交同一迁移且只加一次版本', async () => {
  const before = oldSave(), f = await seed(before); f.setSave(async () => {});
  await f.service.start(); expect(f.service.status().phase).toBe('pending');
  expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(6);
  f.setSave(f.saveNormally); expect((await f.service.retry()).status).toBe('confirmed');
  expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(12); expect(f.service.snapshot().factRevision).toBe(4);
  await f.service.load(); expect(f.service.snapshot().factRevision).toBe(4);
});
it('原生读档不动在战旧档，提交结算时自动更新档案且保留结束快照', async () => {
  const before = oldSave(), unit = before.storage![0]!.snapshot!;
  const enemy = generateUnit({ name: '敌', side: 'enemy', scale: 'company', level: 4, rulesVersion: 'v2', traits: [] }, { seed: 'native-enemy' }).unit;
  const battle = new SmallBattle({ combatants: [unit, enemy], seed: 'native-frozen', rules: V25_OVERFLOW_D20 }); battle.start();
  before.battle = { kind: 'small', snap: battle.toSnapshot() };
  const f = await seed(before); await f.service.start();
  expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(6);
  battle.finishBattle('ceasefire'); const ended = { kind: 'small' as const, snap: battle.toSnapshot() };
  const candidate = { ...f.service.snapshot(), battle: ended, committedOutcomeIds: ['small:native-frozen'] };
  const result = await f.service.persistPanel(candidate, candidate.factRevision!);
  expect(result.status).toBe('confirmed');
  expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(12);
  expect(f.service.snapshot().battle).toEqual(ended);
  expect(f.service.snapshot().battle!.snap.rulesId).toBe(V25_OVERFLOW_D20.id);
});
