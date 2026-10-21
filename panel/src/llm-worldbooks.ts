import type { WorldbookSource } from '../../host/src/worldbooks.js';

export interface WorldbookSelection { name: string; entries: 'all' | string[] }
export function normalizeWorldbookSelection(raw: unknown): WorldbookSelection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap(value => {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || seen.has(value.name)) return [];
    const entries = value.entries === 'all' ? 'all' : Array.isArray(value.entries)
      ? [...new Set<string>(value.entries.filter((id: unknown): id is string => typeof id === 'string'))] : [];
    if (!entries.length) return [];
    seen.add(value.name); return [{ name: value.name, entries }];
  });
}
let source: WorldbookSource | undefined;
export function setLlmWorldbookSource(value: WorldbookSource | undefined): void { source = value; }
/** Resolve only explicit selections. No host activation scan and no content stored in a battle save. */
export async function selectedWorldbookMessages(selection: WorldbookSelection[], signal: AbortSignal): Promise<{ role: 'user'; content: string }[]> {
  if (!selection.length) return [];
  if (!source) throw Error('当前酒馆无法读取已选择的副 API 世界书');
  const current = source;
  const worldbooks = await Promise.all(selection.map(async book => {
    const all = await current.read(book.name, signal);
    const entries = book.entries === 'all' ? all : all.filter(entry => book.entries.includes(entry.id));
    if (book.entries !== 'all' && entries.length !== book.entries.length) throw Error(`世界书“${book.name}”的已选条目已变更，请重新选择`);
    return { name: book.name, entries };
  }));
  return [{ role: 'user', content: JSON.stringify({ worldbooks }) }];
}
