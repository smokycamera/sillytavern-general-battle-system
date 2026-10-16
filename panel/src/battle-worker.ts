import BattleStepWorker from './battle-step.worker?worker&inline';
import type { BattleStepRequest, BattleStepResult } from './battle-step.js';

/** One reusable worker keeps AI sample caches warm. Unsupported hosts use the existing synchronous path. */
export class BattleWorker {
  private worker?: Worker;
  private unavailable = false;
  private sequence = 0;
  private pending = new Map<number, { resolve: (result: BattleStepResult | undefined) => void; reject: (error: Error) => void }>();
  async run(request: BattleStepRequest): Promise<BattleStepResult | undefined> {
    if (this.unavailable || typeof Worker === 'undefined') return undefined;
    if (!this.worker) {
      try {
        const worker = this.worker = new BattleStepWorker();
        worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: BattleStepResult; error?: string }>) => {
          const pending = this.pending.get(data.id);
          if (!pending) return;
          this.pending.delete(data.id);
          if (data.error !== undefined) pending.reject(Error(data.error)); else pending.resolve(data.result);
        };
        worker.onerror = event => { event.preventDefault(); this.unavailable = true; this.dispose(); };
        worker.onmessageerror = () => { this.unavailable = true; this.dispose(); };
      } catch { this.unavailable = true; return undefined; }
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence; this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, request }); }
      catch { this.unavailable = true; this.dispose(); }
    });
  }
  dispose(): void {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) pending.resolve(undefined);
    this.pending.clear();
  }
}
