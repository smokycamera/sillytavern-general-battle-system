import { throwIfAborted } from './browser-compat.js';
import type { HostContext } from './sillytavern.js';
import type { WorldbookContent } from './worldbooks.js';
import { WorldbookReadError } from './worldbook-error.js';

function scope(context: HostContext): string | undefined {
  if (context.groupId !== undefined && context.groupId !== null && context.groupId !== false && context.groupId !== '') return;
  const character = context.characters?.[Number(context.characterId)];
  const chat = context.chatId ?? character?.chat;
  if (context.characterId === undefined || !character?.avatar || !chat) return;
  return JSON.stringify([character.avatar, chat, context.branchId ?? chat]);
}

function contents(raw: unknown): WorldbookContent[] {
  if (!Array.isArray(raw)) return [];
  const books = new Map<string, WorldbookContent>();
  for (const entry of raw) {
    if (!entry || typeof entry.content !== 'string' || entry.disable || !entry.content.trim()) continue;
    const name = typeof entry.world === 'string' && entry.world ? entry.world : '当前角色卡';
    const book: WorldbookContent = books.get(name) ?? { name, entries: [] };
    const id = String(entry.uid ?? book.entries.length);
    const title = typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment : `条目 ${id}`;
    // Copy only the approved request fields. Host entries may be mutated by later scans.
    book.entries.push({ id, title, content: entry.content });
    books.set(name, book);
  }
  return [...books.values()];
}

/** Share the primary API's actual activation, without another probability roll or timed-effect update. */
export function trackActivatedWorldbooks(context: () => HostContext, hasWorldbooks?: (signal?: AbortSignal) => Promise<boolean | undefined>): {
  read(signal?: AbortSignal): Promise<WorldbookContent[]>;
  dispose(): void;
} {
  const initial = context(), events = { ...initial.event_types, ...initial.eventTypes }, source = initial.eventSource;
  const stops: (() => void)[] = [];
  let snapshot: { scope: string; books: WorldbookContent[] } | undefined;
  let generationScope: string | undefined;
  let dryRun = false, disposed = false;
  const on = (kind: string, callback: (...args: unknown[]) => void) => {
    const event = events[kind];
    if (!source || !event) return;
    const guarded = (...args: unknown[]) => { if (!disposed) callback(...args); };
    source.on(event, guarded);
    stops.push(() => { if (source.off) source.off(event, guarded); else source.removeListener?.(event, guarded); });
  };
  on('GENERATION_STARTED', (_type, options, dry) => {
    dryRun = dry === true;
    if (dryRun) return;
    generationScope = scope(context());
    // TauriTavern resumes an agent checkpoint with its existing prompt/activation batch.
    if (options && typeof options === 'object' && (options as { agentResume?: boolean }).agentResume && snapshot?.scope === generationScope) return;
    // The host emits no activation event for an empty result. Clear the previous round now.
    snapshot = generationScope ? { scope: generationScope, books: [] } : undefined;
  });
  on('WORLD_INFO_ACTIVATED', entries => {
    if (dryRun || !generationScope || generationScope !== scope(context())) return;
    snapshot = { scope: generationScope, books: contents(entries) };
  });
  for (const kind of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(kind, () => { generationScope = undefined; dryRun = false; });
  on('CHAT_CHANGED', () => {
    snapshot = undefined; generationScope = undefined;
  });
  // Regeneration deletes the old answer after GENERATION_STARTED; retain that generation's scope.
  for (const kind of ['MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) on(kind, () => {
    snapshot = generationScope && generationScope === scope(context()) ? { scope: generationScope, books: [] } : undefined;
  });
  return {
    async read(signal) {
      throwIfAborted(signal);
      if (disposed) throw new WorldbookReadError('activation-unsupported');
      const current = scope(context());
      if (!current) throw new WorldbookReadError(!source || !events.WORLD_INFO_ACTIVATED || !events.GENERATION_STARTED ? 'activation-unsupported' : 'chat-required');
      if (!snapshot || snapshot.scope !== current) {
        const configured = await hasWorldbooks?.(signal);
        throwIfAborted(signal);
        if (disposed || scope(context()) !== current) throw new WorldbookReadError('scope-changed');
        // A missing activation is harmless only when the host confirms that every source is unbound.
        if ((!snapshot || snapshot.scope !== current) && configured === false) return [];
      }
      if (!source || !events.WORLD_INFO_ACTIVATED || !events.GENERATION_STARTED)
        throw new WorldbookReadError('activation-unsupported');
      if (!snapshot || snapshot.scope !== current)
        throw new WorldbookReadError('activation-missing');
      return snapshot.books.map(book => ({ name: book.name, entries: book.entries.map(entry => ({ ...entry })) }));
    },
    dispose() { disposed = true; stops.forEach(stop => stop()); snapshot = undefined; generationScope = undefined; },
  };
}
