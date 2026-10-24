import { withAbort, throwIfAborted } from './browser-compat.js';
import type { HostContext } from './sillytavern.js';
import { trackActivatedWorldbooks } from './activated-worldbooks.js';
import { WorldbookReadError } from './worldbook-error.js';

export interface WorldbookEntry { id: string; title: string; content: string }
export interface WorldbookContent { name: string; entries: WorldbookEntry[] }
export interface WorldbookSource {
  list(signal?: AbortSignal): Promise<string[]>;
  read(name: string, signal?: AbortSignal): Promise<WorldbookEntry[]>;
  active?(signal?: AbortSignal): Promise<WorldbookContent[]>;
  dispose?(): void;
}
/** Read-only host endpoints, shared by SillyTavern and TauriTavern. */
export interface HostWorldbookBindings {
  world_info?: { charLore?: { name: string; extraBooks: string[] }[] };
  selected_world_info?: string[];
}
const loadHostBindings = (): Promise<HostWorldbookBindings> => import(/* @vite-ignore */ new URL('/scripts/world-info.js', globalThis.location.href).href);
export function createWorldbookSource(context: () => HostContext, request: typeof fetch = (url, init) => fetch(url, init), loadBindings: () => Promise<HostWorldbookBindings> = loadHostBindings): WorldbookSource {
  const hasWorldbooks = async (signal?: AbortSignal): Promise<boolean | undefined> => {
    let bindings: HostWorldbookBindings;
    try { bindings = await loadBindings(); } catch { throwIfAborted(signal); return; }
    throwIfAborted(signal);
    // Unavailable host metadata is unknown, never evidence that no lorebooks are configured.
    if (!bindings?.world_info || typeof bindings.world_info !== 'object' || Array.isArray(bindings.world_info)
      || !Array.isArray(bindings.selected_world_info)) return;
    const current = context(), character = current.characters?.[Number(current.characterId)];
    const fileName = character?.avatar?.replace(/\.[^.]+$/, '');
    const auxiliary = bindings.world_info.charLore;
    if (auxiliary !== undefined && (!Array.isArray(auxiliary) || auxiliary.some(book => !book || typeof book.name !== 'string'
      || book.extraBooks !== undefined && !Array.isArray(book.extraBooks)))) return;
    return bindings.selected_world_info.length > 0 || !!character?.data?.extensions?.world
      || !!current.chatMetadata?.world_info || !!current.powerUserSettings?.persona_description_lorebook
      || !!auxiliary?.some(book => book.name === fileName && book.extraBooks?.length);
  };
  const activated = trackActivatedWorldbooks(context, hasWorldbooks);
  const post = (path: string, body: unknown, signal?: AbortSignal) => withAbort({ timeout: 10000, signals: signal ? [signal] : [] }, async combined => {
    const headers = context().getRequestHeaders?.();
    if (!headers) throw new WorldbookReadError('headers-unavailable');
    const response = await request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: combined, cache: 'no-store' });
    if (!response.ok) throw new WorldbookReadError('http', response.status);
    try { return await response.json(); }
    catch { throw new WorldbookReadError('invalid-json'); }
  });
  return {
    active: activated.read,
    dispose: activated.dispose,
    async list(signal) {
      const data = await post('/api/settings/get', {}, signal);
      if (!Array.isArray(data?.world_names)) throw new WorldbookReadError('catalog-invalid');
      return [...new Set<string>(data.world_names.filter((name: unknown): name is string => typeof name === 'string' && !!name.trim()))];
    },
    async read(name, signal) {
      const data = await post('/api/worldinfo/get', { name }, signal);
      if (!data?.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw new WorldbookReadError('entries-invalid');
      return Object.entries(data.entries).flatMap(([id, raw]) => {
        if (!raw || typeof raw !== 'object' || typeof (raw as { content?: unknown }).content !== 'string') return [];
        const entry = raw as { comment?: string; key?: unknown[]; content: string };
        return [{ id, title: typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment
          : Array.isArray(entry.key) && entry.key.length ? entry.key.filter(k => typeof k === 'string').join('、') || `条目 ${id}` : `条目 ${id}`, content: entry.content }];
      });
    },
  };
}
