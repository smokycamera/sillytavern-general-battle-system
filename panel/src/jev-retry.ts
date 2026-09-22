export const JEV_RETRY_DELAY_MS = 1000;
export const JEV_MAX_RETRIES = 10;
export const JEV_ATTEMPT_TIMEOUT_MS = 30000;
// The core's deadline must cover all attempts, rather than aborting the retry loop.
export const JEV_REQUEST_BUDGET_MS =
  (JEV_MAX_RETRIES + 1) * JEV_ATTEMPT_TIMEOUT_MS + JEV_MAX_RETRIES * JEV_RETRY_DELAY_MS + 1000;

export class JevRequestTimeoutError extends Error {
  constructor() { super('模型请求超过 30 秒未完成，请检查网络、转发或模型服务'); }
}
export class JevRetriesExhausted extends Error {
  constructor(cause: unknown) { super(`自动重试 ${JEV_MAX_RETRIES} 次后仍未成功`, { cause }); }
}

export function waitForJev(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal.reason); };
    const timer = setTimeout(() => { finish(); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Bound even transports which ignore abort, and never accept a late response. */
async function attempt<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const limit = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(parent.reason); reject(parent.reason); };
    parent.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      const error = new JevRequestTimeoutError();
      // Settle the deadline first so fetch's AbortError cannot hide the timeout.
      reject(error);
      controller.abort(error);
    }, JEV_ATTEMPT_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([operation(controller.signal), limit]);
    parent.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer!);
    parent.removeEventListener('abort', abort!);
  }
}

/** Only model reads are retried. Battle actions and persistence run once afterwards. */
export async function retryJev<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { signal: AbortSignal; check(): void; onRetry(retry: number): void },
): Promise<T> {
  for (let retry = 0; ; retry++) {
    options.check();
    options.signal.throwIfAborted();
    try {
      const value = await attempt(operation, options.signal);
      options.check();
      return value;
    } catch (error) {
      options.check();
      options.signal.throwIfAborted();
      if (retry === JEV_MAX_RETRIES) throw new JevRetriesExhausted(error);
      options.onRetry(retry + 1);
      await waitForJev(JEV_RETRY_DELAY_MS, options.signal);
    }
  }
}
