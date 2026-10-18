import { afterEach, expect, it, vi } from 'vitest';
import { BattleWorker } from './battle-worker.js';
import type { BattleStepRequest } from './battle-step.js';

const made: any[] = [];
vi.mock('./battle-step.worker?worker&inline', () => ({ default: class {
  onmessage?: (event: unknown) => void; onerror?: (event: unknown) => void; onmessageerror?: () => void;
  terminate = vi.fn(); postMessage = vi.fn(); constructor() { made.push(this); }
} }));
afterEach(() => { vi.unstubAllGlobals(); made.length = 0; });
it('worker replies match requests; engine failures reject while unavailable workers fall back without committing', async () => {
  vi.stubGlobal('Worker', class {});
  const client = new BattleWorker(), request = {} as BattleStepRequest;
  const first = client.run(request), worker = made[0], second = client.run(request);
  const [a, b] = worker.postMessage.mock.calls.map((call: any[]) => call[0].id);
  const result = { snap: {}, conditions: [] };
  worker.onmessage({ data: { id: b, result } }); expect(await second).toEqual(result);
  worker.onmessage({ data: { id: a, error: 'invalid plan' } }); await expect(first).rejects.toThrow('invalid plan');
  const pending = client.run(request); worker.onerror({ preventDefault: vi.fn() });
  expect(await pending).toBeUndefined(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(await client.run(request)).toBeUndefined(); expect(made).toHaveLength(1);
});
it('disposing releases an in-flight calculation and ignores its late reply', async () => {
  vi.stubGlobal('Worker', class {});
  const client = new BattleWorker(), pending = client.run({} as BattleStepRequest), worker = made[0];
  client.dispose(); expect(await pending).toBeUndefined();
  worker.onmessage({ data: { id: 1, result: { snap: { round: 99 }, conditions: [] } } });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
