import type { WorldbookSource } from '../../host/src/worldbooks.js';
import { WorldbookReadError, worldbookReadError } from '../../host/src/worldbook-error.js';
import { throwIfAborted } from '../../host/src/browser-compat.js';

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
export async function characterWorldbookMessages(signal: AbortSignal): Promise<{ role: 'user'; content: string }[]> {
  if (!source?.active) throw new WorldbookReadError('activation-unsupported');
  let worldbooks;
  try { worldbooks = await source.active(signal); }
  catch (error) {
    throwIfAborted(signal);
    throw worldbookReadError(error) ?? new WorldbookReadError('activation-read-failed');
  }
  return worldbooks.length ? [{ role: 'user', content: JSON.stringify({ worldbooks }) }] : [];
}
/** Resolve only explicit selections. No host activation scan and no content stored in a battle save. */
export async function selectedWorldbookMessages(selection: WorldbookSelection[], signal: AbortSignal): Promise<{ role: 'user'; content: string }[]> {
  if (!selection.length) return [];
  if (!source) throw new WorldbookReadError('selected-unavailable');
  const current = source;
  const worldbooks = await Promise.all(selection.map(async book => {
    let all;
    try { all = await current.read(book.name, signal); }
    catch (error) {
      throwIfAborted(signal);
      throw worldbookReadError(error) ?? new WorldbookReadError('selected-read-failed');
    }
    const entries = book.entries === 'all' ? all : all.filter(entry => book.entries.includes(entry.id));
    if (book.entries !== 'all' && entries.length !== book.entries.length) throw new WorldbookReadError('selection-missing');
    return { name: book.name, entries };
  }));
  return [{ role: 'user', content: JSON.stringify({ worldbooks }) }];
}
