import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryJev, JevRetriesExhausted, JevRequestTimeoutError } from './jev-retry.js';

afterEach(() => vi.useRealTimers());
describe('cancellable model retries', () => {
  it('bounds hung transports, ignores late answers and completes all ten retries', async () => {
    vi.useFakeTimers();
    const starts: number[] = [], signals: AbortSignal[] = [];
    let late!: (value: string) => void;
    const request = vi.fn(async (signal: AbortSignal) => {
      starts.push(Date.now()); signals.push(signal);
      return new Promise<string>(resolve => { late = resolve; });
    });
    const result = retryJev(request, { signal: new AbortController().signal, check: () => {}, onRetry: () => {} })
      .catch(error => error);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toBeInstanceOf(JevRetriesExhausted);
    expect(error.cause).toBeInstanceOf(JevRequestTimeoutError);
    expect(request).toHaveBeenCalledTimes(11);
    expect(starts.slice(1).map((at, i) => at - starts[i]!)).toEqual(Array(10).fill(31000));
    expect(signals.every(s => s.aborted)).toBe(true);
    late('too late');
    expect(await result).toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts a retry wait immediately without another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn(async () => { throw Error('offline'); });
    const result = retryJev(request, { signal: controller.signal, check: () => {}, onRetry: () => {} }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(Error('paused'));
    expect((await result).message).toBe('paused');
    await vi.runAllTimersAsync();
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('checks that the battle is still current before retrying', async () => {
    vi.useFakeTimers();
    let valid = true;
    const request = vi.fn(async () => { throw Error('offline'); });
    const result = retryJev(request, {
      signal: new AbortController().signal,
      check: () => { if (!valid) throw Error('stale battle'); }, onRetry: () => {},
    }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    valid = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).message).toBe('stale battle');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
