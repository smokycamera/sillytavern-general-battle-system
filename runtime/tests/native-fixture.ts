import { vi } from 'vitest';
import { NativeHost, type HostContext, type HostMessage } from '../../host/src/sillytavern.js';
import { NativeStore } from '../src/native-store.js';
import { MemoryJournal } from '../src/recovery-journal.js';
import { BattleService } from '../src/battle-service.js';

export function nativeFixture() {
  const handlers = new Map<string, Set<(...args: unknown[]) => unknown>>();
  const context: HostContext = {
    characterId: '0', characters: [{ avatar: 'fixture.png', name: 'Fixture' }], chatId: 'a', chat: [], chatMetadata: {},
    eventTypes: Object.fromEntries(['GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_SENT', 'CHAT_CHANGED'].map(key => [key, key])),
    eventSource: {
      on(key, callback) { const callbacks = handlers.get(key) ?? new Set(); callbacks.add(callback); handlers.set(key, callbacks); },
      removeListener(key, callback) { handlers.get(key)?.delete(callback); },
      async emit(key, ...args) { for (const callback of handlers.get(key) ?? []) await callback(...args); },
    },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }), setExtensionPrompt: vi.fn(),
  };
  const disk = new Map<string, Record<string, unknown>>();
  const chats = new Map<string, HostMessage[]>();
  const local = new Map<string, string>();
  const storage = { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => { local.delete(key); } } as Storage;
  const saveNormally = async () => { disk.set(context.chatId!, structuredClone(context.chatMetadata!)); chats.set(context.chatId!, structuredClone(context.chat!)); };
  let save = saveNormally;
  context.saveMetadata = () => save();
  const host = new NativeHost({ SillyTavern: { getContext: () => context } }, 'fixture-user', async (_url, init) => {
    const request = JSON.parse(init!.body as string) as { file_name: string };
    return new Response(JSON.stringify([{ chat_metadata: disk.get(request.file_name) ?? {} }, ...(chats.get(request.file_name) ?? [])]));
  }, storage);
  const journal = new MemoryJournal(); const store = new NativeStore(host, journal); const service = new BattleService(host, store);
  return { host, store, journal, service, context, disk, chats, local, storage, handlers, saveNormally, setSave: (next: typeof save) => { save = next; },
    switchTo: (id: string) => { context.chatId = id; context.chatMetadata = structuredClone(disk.get(id) ?? {}); context.chat = structuredClone(chats.get(id) ?? []); },
    emit: async (key: string, ...args: unknown[]) => { await context.eventSource!.emit!(key, ...args); },
  };
}
