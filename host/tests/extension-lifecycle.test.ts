// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeRuntime } from '../../extension/src/panel-runtime.js';
import type { HostContext } from '../src/sillytavern.js';

vi.mock('../../runtime/src/recovery-journal.js', async importOriginal => {
  const source = await importOriginal<typeof import('../../runtime/src/recovery-journal.js')>();
  return { ...source, IndexedDbJournal: source.MemoryJournal };
});
vi.mock('../../runtime/src/legacy-import.js', async importOriginal => {
  const source = await importOriginal<typeof import('../../runtime/src/legacy-import.js')>();
  return { ...source, IndexedDbSourceBackups: source.MemorySourceBackups };
});
const hostWindow = window as unknown as { SillyTavern?: { getContext(): HostContext }; __tavernBattleNative?: NativeRuntime };
// happy-dom's PageTransitionEvent does not implement the persisted init option.
function cachedEvent(type: string) { const event = new Event(type); Object.defineProperty(event, 'persisted', { value: true }); return event; }
beforeEach(() => { vi.resetModules(); vi.stubGlobal('navigator', {}); });
afterEach(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); delete hostWindow.SillyTavern; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('recovers one failed startup, preserves the cached runtime and disposes only on a real exit', async () => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  let metadata: Record<string, unknown> = {}, failures = 1;
  const context: HostContext = {
    characterId: 0, characters: [{ avatar: 'test.png', name: 'Test' }], chatId: 'a', chat: [], chatMetadata: {}, extensionSettings: {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }), setExtensionPrompt: vi.fn(),
    saveMetadata: async () => { metadata = structuredClone(context.chatMetadata!); },
    eventTypes: { CHAT_CHANGED: 'chat' },
    eventSource: { on(key, fn) { const set = handlers.get(key) ?? new Set(); set.add(fn); handlers.set(key, set); }, off(key, fn) { handlers.get(key)?.delete(fn); } },
  };
  hostWindow.SillyTavern = { getContext: () => context };
  const request = vi.fn(async (url: RequestInfo | URL) => {
    if (url === '/api/users/me') { if (failures-- > 0) throw Error('offline'); return new Response(JSON.stringify({ handle: 'tester' })); }
    return new Response(JSON.stringify([{ chat_metadata: metadata }]));
  }); vi.stubGlobal('fetch', request);
  await import('../../extension/src/index.js');
  await vi.waitFor(() => expect(document.body.textContent).toContain('重新初始化'));
  expect(hostWindow.__tavernBattleNative).toBeUndefined();
  const retry = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重新初始化')!;
  retry.click(); retry.click();
  await vi.waitFor(() => expect(hostWindow.__tavernBattleNative?.service.status().phase).toBe('ready'));
  expect(request.mock.calls.filter(([url]) => url === '/api/users/me')).toHaveLength(2);
  const runtime = hostWindow.__tavernBattleNative!, panel = document.getElementById('tavern-battle-native-panel');
  const count = handlers.get('chat')!.size;
  window.dispatchEvent(cachedEvent('pagehide'));
  expect(hostWindow.__tavernBattleNative).toBe(runtime); expect(panel?.isConnected).toBe(true);
  window.dispatchEvent(cachedEvent('pageshow'));
  await vi.waitFor(() => expect(runtime.service.status().phase).toBe('ready'));
  expect(document.getElementById('tavern-battle-native-panel')).toBe(panel);
  expect(handlers.get('chat')!.size).toBe(count); expect(document.querySelectorAll('#tavern-battle-native-entry')).toHaveLength(1);
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  expect(hostWindow.__tavernBattleNative).toBeUndefined(); expect(panel?.isConnected).toBe(false); expect(handlers.get('chat')!.size).toBe(0);
});
