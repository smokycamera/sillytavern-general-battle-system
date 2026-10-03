import { afterEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { randomId, sha256, throwIfAborted, withAbort } from '../src/browser-compat.js';
import { serialized } from '../src/json.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const httpCrypto = () => vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });

it('uses native UUIDs when available, and secure v4 identifiers without randomUUID on HTTP', () => {
  const native = vi.fn(() => 'native-id'); vi.stubGlobal('crypto', { randomUUID: native });
  expect(randomId()).toBe('native-id'); expect(native).toHaveBeenCalledOnce();
  httpCrypto(); const ids = Array.from({ length: 32 }, randomId);
  expect(new Set(ids).size).toBe(32);
  ids.forEach(id => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
});

it.each(['', 'abc', '战阵⚔️存档\u0000', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(1000000)])('keeps fallback SHA-256 identical to native hashing (%#)', async text => {
  const bytes = new TextEncoder().encode(text), expected = createHash('sha256').update(bytes).digest('hex');
  vi.stubGlobal('crypto', webcrypto); expect(await sha256(bytes)).toBe(expected);
  httpCrypto(); expect(await sha256(bytes)).toBe(expected);
});

it('loads native archives, saves on HTTP and still rejects corrupted persisted data', async () => {
  const f = nativeFixture(); await f.store.load();
  expect((await f.store.commit(0, () => ({ factRevision: 3 }))).status).toBe('confirmed');
  const id = f.store.envelope()!.documentId;
  httpCrypto(); await f.store.load();
  expect((await f.store.commit(1, before => ({ ...before, factRevision: 4 }))).status).toBe('confirmed');
  const envelope = f.store.envelope()!;
  expect(envelope.documentId).toBe(id);
  expect(envelope.payloadHash).toBe(createHash('sha256').update(serialized(envelope.payload)).digest('hex'));
  vi.stubGlobal('crypto', webcrypto); await f.store.load(); expect(f.store.snapshot().factRevision).toBe(4);
  (f.disk.get('a')!.tavernBattle as typeof envelope).payload = { factRevision: 999 };
  httpCrypto(); await expect(f.store.load()).rejects.toThrow('没有通过完整性检查');
});

it('cancels without modern AbortSignal methods and cleans listeners/timers on success and timeout', async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw Error('unsupported'); });
  vi.spyOn(AbortSignal, 'any').mockImplementation(() => { throw Error('unsupported'); });
  vi.spyOn(AbortSignal.prototype, 'throwIfAborted').mockImplementation(() => { throw Error('unsupported'); });
  const parent = new AbortController(), remove = vi.spyOn(parent.signal, 'removeEventListener');
  expect(await withAbort({ signals: [parent.signal], timeout: 5000 }, async signal => { throwIfAborted(signal); return 'ok'; })).toBe('ok');
  expect(remove).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  const operation = vi.fn(async () => new Promise<never>(() => {}));
  const result = withAbort({ signals: [parent.signal], timeout: 25 }, operation).catch(error => error);
  await vi.advanceTimersByTimeAsync(25); expect((await result).name).toBe('TimeoutError');
  expect(vi.getTimerCount()).toBe(0);
  const cancelled = withAbort({ signals: [parent.signal] }, operation).catch(error => error);
  parent.abort(Error('paused')); expect((await cancelled).message).toBe('paused');
  const never = vi.fn(async () => 'unexpected');
  await expect(withAbort({ signals: [parent.signal] }, never)).rejects.toThrow('paused');
  expect(never).not.toHaveBeenCalled();
});
