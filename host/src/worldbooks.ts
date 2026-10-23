import { withAbort } from './browser-compat.js';
import type { HostContext } from './sillytavern.js';
import { trackActivatedWorldbooks } from './activated-worldbooks.js';

export interface WorldbookEntry { id: string; title: string; content: string }
export interface WorldbookContent { name: string; entries: WorldbookEntry[] }
export interface WorldbookSource {
  list(signal?: AbortSignal): Promise<string[]>;
  read(name: string, signal?: AbortSignal): Promise<WorldbookEntry[]>;
  active?(signal?: AbortSignal): Promise<WorldbookContent[]>;
  dispose?(): void;
}
/** Read-only host endpoints, shared by SillyTavern and TauriTavern. */
export function createWorldbookSource(context: () => HostContext, request: typeof fetch = (url, init) => fetch(url, init)): WorldbookSource {
  const activated = trackActivatedWorldbooks(context);
  const post = (path: string, body: unknown, signal?: AbortSignal) => withAbort({ timeout: 10000, signals: signal ? [signal] : [] }, async combined => {
    const headers = context().getRequestHeaders?.();
    if (!headers) throw Error('当前酒馆未提供世界书读取接口');
    const response = await request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: combined, cache: 'no-store' });
    if (!response.ok) throw Error(`世界书读取失败（HTTP ${response.status}）`);
    return response.json();
  });
  return {
    active: activated.read,
    dispose: activated.dispose,
    async list(signal) {
      const data = await post('/api/settings/get', {}, signal);
      if (!Array.isArray(data?.world_names)) throw Error('酒馆未返回世界书列表');
      return [...new Set<string>(data.world_names.filter((name: unknown): name is string => typeof name === 'string' && !!name.trim()))];
    },
    async read(name, signal) {
      const data = await post('/api/worldinfo/get', { name }, signal);
      if (!data?.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw Error('世界书条目格式无法识别');
      return Object.entries(data.entries).flatMap(([id, raw]) => {
        if (!raw || typeof raw !== 'object' || typeof (raw as { content?: unknown }).content !== 'string') return [];
        const entry = raw as { comment?: string; key?: unknown[]; content: string };
        return [{ id, title: typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment
          : Array.isArray(entry.key) && entry.key.length ? entry.key.filter(k => typeof k === 'string').join('、') || `条目 ${id}` : `条目 ${id}`, content: entry.content }];
      });
    },
  };
}
