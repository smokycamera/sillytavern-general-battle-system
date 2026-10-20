import { expect, it } from 'vitest';
import { compactSaveHistory, operationFingerprint } from './save-history.js';
import { createInventoryItem, prepareInventoryTransaction } from './inventory-state.js';
import { archiveStateStamp } from './archive-stamp.js';

it('精简数百条旧改造副本及战报/备份中的副本，当前状态和战报正文保持原值', () => {
  const item = createInventoryItem('sword', '旧剑', { kind: 'weapon', mechanism: 'sword', power: 4 }, 'fixed');
  item.history = Array.from({ length: 300 }, (_, revision) => ({ revision, name: '旧剑', mechanics: structuredClone(item.mechanics!), sourceId: String(revision) }));
  const unit = { id: 'u', revision: 5, hp: 37, xp: 80, history: Array.from({ length: 400 }, (_, revision) => ({ revision, hp: revision })) };
  const before = { storage: [unit], inventory: [item] };
  const save = { ...before, reports: [{ id: 'battle', summary: '保留逐轮战报', start: { before } }], migrationBackups: [{ source: before }],
    inventoryOperations: [{ id: 'old', fingerprint: JSON.stringify({ kind: 'reforge', spec: item.mechanics }) }] };
  const next = compactSaveHistory(save);
  expect(next.storage[0]).toEqual({ id: 'u', revision: 5, hp: 37, xp: 80 });
  expect(next.inventory[0]!.history).toBeUndefined(); expect(next.inventory[0]!.mechanics).toBe(item.mechanics);
  expect(next.reports[0]!.start.before.storage[0]!.history).toBeUndefined();
  expect(next.migrationBackups[0]!.source.inventory[0]!.history).toBeUndefined();
  expect(next.reports[0]!.summary).toBe('保留逐轮战报');
  expect(next.inventoryOperations[0]!.fingerprint).toMatch(/^receipt-v1:[0-9a-f]{32}$/);
  expect(compactSaveHistory(next)).toBe(next); expect(item.history).toHaveLength(300);
  expect(JSON.stringify(next).length).toBeLessThan(JSON.stringify(save).length / 20);
});

it('数百次改造只保留当前实物；短回执仍拒绝最早操作的重复或篡改', () => {
  const original = createInventoryItem('sword', '剑', { kind: 'weapon', mechanism: 'sword', power: 4 }, 'fixed');
  let save = { inventory: [original], factRevision: 0 };
  const intent = (index: number) => ({ id: 'edit-' + index, expectedRevision: index, kind: 'reforge' as const, itemId: 'sword',
    spec: { kind: 'weapon' as const, mechanism: 'sword', power: index % 5 + 1 } });
  for (let i = 0; i < 150; i++) save = prepareInventoryTransaction(save, intent(i)) as typeof save;
  expect(save.inventory[0]!.history).toBeUndefined(); expect(save.inventory[0]!.revision).toBe(151);
  expect(prepareInventoryTransaction(save, intent(0))).toEqual(save);
  expect(() => prepareInventoryTransaction(save, { ...intent(0), name: '不同内容' })).toThrow('不同内容');
  expect(operationFingerprint('abc')).not.toBe(operationFingerprint('abd'));
});

it('清理历史时更新仍有效的重战守卫，不把已经过期的战报重新解锁', () => {
  const storage = [{ id: 'u', hp: 12, history: [{ hp: 10 }] }], inventory: unknown[] = [];
  const stamp = archiveStateStamp(storage, inventory);
  const save = { storage, inventory, reports: [{ id: 'valid', afterArchiveStamp: stamp }, { id: 'stale', afterArchiveStamp: 'old-stamp' }],
    deletedReport: { report: { id: 'deleted', afterArchiveStamp: stamp }, index: 0 } };
  const next = compactSaveHistory(save), nextStamp = archiveStateStamp(next.storage, next.inventory);
  expect(next.reports.map(report => report.afterArchiveStamp)).toEqual([nextStamp, 'old-stamp']);
  expect(next.deletedReport.report.afterArchiveStamp).toBe(nextStamp);
  expect(save.reports[0]!.afterArchiveStamp).toBe(stamp);
});
