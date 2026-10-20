import type { HostSession } from './contracts.js';

export interface HostSaveState { readonly isChatSaving: boolean }
export interface ReplySaveWindow {
  /** The message listener waits only until our candidate is staged, never for disk. */
  ready: Promise<void>;
  prepared(): void;
  waitForHost(): Promise<boolean>;
}

/** Observe the host's exported save flag without wrapping or cancelling any host/plugin save. */
export function replySaveWindow(state: HostSaveState, session: HostSession, current: () => HostSession | undefined): ReplySaveWindow {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return {
    ready, prepared: release,
    async waitForHost() {
      // Yield out of MESSAGE_RECEIVED so the host can finish other listeners (including MVU).
      const start = Date.now();
      let observed = false;
      do {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        if (current()?.scope.key !== session.scope.key) return false;
        if (state.isChatSaving) observed = true;
        else if (observed) return true;
        // A delayed MVU request or a host path without an automatic save uses our normal saver.
      } while (Date.now() - start < (observed ? 30_000 : 600));
      return false;
    },
  };
}
