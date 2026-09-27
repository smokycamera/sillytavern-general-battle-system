import { afterEach, expect, it, vi } from 'vitest';
import { IndexedDbJournal } from '../src/recovery-journal.js';
import { IndexedDbSourceBackups } from '../src/legacy-import.js';
afterEach(() => vi.unstubAllGlobals());

it('reports unavailable recovery storage without switching to a volatile save', async () => {
  vi.stubGlobal('indexedDB', undefined);
  await expect(new IndexedDbJournal().get('chat')).rejects.toThrow('未写入存档');
  await expect(new IndexedDbSourceBackups().get('chat')).rejects.toThrow('未写入存档');
});

it('can retry a synchronously rejected IndexedDB open without caching the failure forever', async () => {
  const open = vi.fn(() => { throw new DOMException('blocked', 'SecurityError'); });
  const journal = new IndexedDbJournal({ open } as unknown as IDBFactory);
  await expect(journal.get('chat')).rejects.toThrow('存储暂不可用');
  await expect(journal.get('chat')).rejects.toThrow('存储暂不可用');
  expect(open).toHaveBeenCalledTimes(2);
});
