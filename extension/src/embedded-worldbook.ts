import worldbook from '../../assets/worldbook/!通用战斗系统约束.json';
import type { WorldbookEditorState, WorldbookEditorUpdate } from '../../panel/src/panel-runtime.js';

interface SourceEntry {
  [key: string]: unknown;
  content: string;
  comment?: string;
  position: number;
  depth: number;
  role: number;
  order: number;
  disable?: boolean;
}

export interface EmbeddedWorldbookSettings {
  enabled?: boolean;
  entries?: Record<string, string>;
}

export interface EmbeddedPrompt {
  id: string;
  content: string;
  position: 1;
  depth: number;
  scan: false;
  role: number;
}

const AT_DEPTH = 4;
const IN_CHAT = 1;
const sourceEntries = Object.entries(worldbook.entries as Record<string, SourceEntry>)
  .filter(([, entry]) => !entry.disable)
  .sort(([, a], [, b]) => a.order - b.order);

export const EMBEDDED_WORLD_NAME = 'tavern-battle-native:worldbook';
export type WorldbookInstallation = (() => void) & { mode: 'native' | 'depth' };

/** Feed the original metadata to the same pipeline used by global World Info.
 * Separate extension prompts cannot preserve ordering with other depth entries,
 * WI regex processing, or the host's token-budget behavior.
 */
export function embeddedWorldbookEntries(value?: EmbeddedWorldbookSettings) {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  if (!settings.enabled) return [];
  return sourceEntries.map(([id, entry]) => ({
    ...structuredClone(entry),
    world: EMBEDDED_WORLD_NAME,
    constant: true,
    key: [],
    keysecondary: [],
    selective: false,
    content: Object.prototype.hasOwnProperty.call(settings.entries, id) ? settings.entries[id]! : entry.content,
  }));
}

export function normalizeEmbeddedWorldbookSettings(value?: EmbeddedWorldbookSettings): { enabled: boolean; entries: Record<string, string> } {
  const known = new Set(sourceEntries.map(([id]) => id));
  const entries = Object.fromEntries(Object.entries(value?.entries ?? {}).filter(([id, content]) => known.has(id) && typeof content === 'string'));
  return { enabled: value?.enabled !== false, entries };
}

export function embeddedWorldbookSettingsView(value?: EmbeddedWorldbookSettings): WorldbookEditorState {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  return {
    enabled: settings.enabled,
    items: sourceEntries.map(([id, entry]) => ({
      id,
      title: entry.comment || `条目 ${id}`,
      content: Object.prototype.hasOwnProperty.call(settings.entries, id) ? settings.entries[id]! : entry.content,
      defaultContent: entry.content,
      depth: entry.depth,
      role: entry.role,
      order: entry.order,
    })),
  };
}

export function updateEmbeddedWorldbookSettings(value: EmbeddedWorldbookSettings | undefined, update: WorldbookEditorUpdate): { enabled: boolean; entries: Record<string, string> } {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  if (typeof update.enabled === 'boolean') settings.enabled = update.enabled;
  if (update.entry) {
    if (!sourceEntries.some(([id]) => id === update.entry!.id)) throw Error('未知的内置世界书条目');
    if (update.entry.content === undefined) delete settings.entries[update.entry.id];
    else settings.entries[update.entry.id] = update.entry.content;
  }
  return settings;
}

export function buildEmbeddedWorldbook(value?: EmbeddedWorldbookSettings): EmbeddedPrompt[] {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  if (!settings.enabled) return [];

  const groups = new Map<string, { depth: number; role: number; contents: string[] }>();
  for (const [id, entry] of sourceEntries) {
    if (entry.position !== AT_DEPTH) throw Error('内置世界书包含非深度注入条目，无法保证位置等价');
    const key = `${entry.depth}:${entry.role}`;
    const group = groups.get(key) ?? { depth: entry.depth, role: entry.role, contents: [] };
    group.contents.push(Object.prototype.hasOwnProperty.call(settings.entries, id) ? settings.entries[id]! : entry.content);
    groups.set(key, group);
  }

  return [...groups.values()].map<EmbeddedPrompt>(group => ({
    id: `tavern-battle-native:worldbook:depth-${group.depth}:role-${group.role}`,
    content: group.contents.filter(Boolean).join('\n'),
    position: IN_CHAT,
    depth: group.depth,
    scan: false,
    role: group.role,
  })).filter(prompt => !!prompt.content);
}

export function installEmbeddedWorldbook(host: {
  inject(id: string, content: string, options?: { position?: number; depth?: number; scan?: boolean; role?: number }): boolean;
  clearInjection(id: string): void;
  subscribe?(kind: string, callback: (...args: unknown[]) => void): { available: boolean; stop(): void };
  hasLegacyRuntime?(): boolean;
}, value?: EmbeddedWorldbookSettings): WorldbookInstallation {
  const native = host.subscribe?.('WORLDINFO_ENTRIES_LOADED', payload => {
    if (host.hasLegacyRuntime?.() || !payload || typeof payload !== 'object') return;
    const { globalLore } = payload as { globalLore?: unknown };
    // Append only our ephemeral entries. External books remain user-managed.
    if (Array.isArray(globalLore)) globalLore.push(...embeddedWorldbookEntries(value));
  });
  if (native?.available) return Object.assign(() => native.stop(), { mode: 'native' as const });

  // Older hosts without the native hook retain depth/role and internal order.
  // The settings UI explicitly identifies this reduced-compatibility mode.
  const installed: string[] = [];
  for (const prompt of buildEmbeddedWorldbook(value)) {
    if (host.inject(prompt.id, prompt.content, prompt)) installed.push(prompt.id);
  }
  return Object.assign(() => { for (const id of installed) host.clearInjection(id); }, { mode: 'depth' as const });
}
