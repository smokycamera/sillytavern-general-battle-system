import worldbook from '../../assets/worldbook/!通用战斗系统约束.json';
import type { CustomWorldbookEntry, WorldbookEditorState, WorldbookEditorUpdate } from '../../panel/src/panel-runtime.js';

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
  customEntries?: CustomWorldbookEntry[];
  nextCustomId?: number;
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
export const CUSTOM_WORLD_NAME = 'tavern-battle-native:custom-worldbook';
export type WorldbookInstallation = (() => void) & { mode: 'native' | 'depth' };

/** Feed the original metadata to the same pipeline used by global World Info.
 * Separate extension prompts cannot preserve ordering with other depth entries,
 * WI regex processing, or the host's token-budget behavior.
 */
export function embeddedWorldbookEntries(value?: EmbeddedWorldbookSettings) {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  if (!settings.enabled) return [];
  const builtIn = sourceEntries.map(([id, entry]) => ({
    ...structuredClone(entry),
    world: EMBEDDED_WORLD_NAME,
    constant: true,
    key: [],
    keysecondary: [],
    selective: false,
    content: Object.prototype.hasOwnProperty.call(settings.entries, id) ? settings.entries[id]! : entry.content,
  }));
  const custom = settings.customEntries.filter(entry => entry.enabled && entry.content.trim()).map(entry => ({
    ...structuredClone(sourceEntries[0]![1]),
    world: CUSTOM_WORLD_NAME,
    uid: Number(entry.id.slice(7)),
    comment: entry.title,
    content: entry.content,
    constant: entry.constant,
    key: [...entry.keys],
    keysecondary: [],
    selective: false,
    disable: false,
    position: AT_DEPTH,
    depth: entry.depth,
    role: entry.role,
    order: entry.order,
    displayIndex: Number(entry.id.slice(7)),
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    excludeRecursion: false,
    preventRecursion: false,
    ignoreBudget: false,
  }));
  return [...builtIn, ...custom];
}

function integer(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : fallback;
}

function normalizeCustomEntry(raw: Partial<CustomWorldbookEntry> & Pick<CustomWorldbookEntry, 'id'>): CustomWorldbookEntry {
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '新建条目',
    content: typeof raw.content === 'string' ? raw.content : '',
    enabled: raw.enabled !== false,
    constant: raw.constant !== false,
    keys: Array.isArray(raw.keys) ? [...new Set(raw.keys.filter((key): key is string => typeof key === 'string').map(key => key.trim()).filter(Boolean))] : [],
    depth: integer(raw.depth, 1, 1000),
    role: integer(raw.role, 0, 2),
    order: integer(raw.order, 100, 99999),
  };
}

export function normalizeEmbeddedWorldbookSettings(value?: EmbeddedWorldbookSettings) {
  const known = new Set(sourceEntries.map(([id]) => id));
  const entries = Object.fromEntries(Object.entries(value?.entries ?? {}).filter(([id, content]) => known.has(id) && typeof content === 'string'));
  const seen = new Set<string>();
  const customEntries: CustomWorldbookEntry[] = [];
  for (const raw of Array.isArray(value?.customEntries) ? value.customEntries : []) {
    if (!raw || typeof raw.id !== 'string' || !/^custom-[1-9]\d*$/.test(raw.id) || seen.has(raw.id)) continue;
    const uid = Number(raw.id.slice(7));
    if (!Number.isSafeInteger(uid) || uid >= Number.MAX_SAFE_INTEGER - 1) continue;
    seen.add(raw.id); customEntries.push(normalizeCustomEntry(raw));
  }
  const nextCustomId = customEntries.reduce((next, entry) => Math.max(next, Number(entry.id.slice(7)) + 1),
    Math.max(1, integer(value?.nextCustomId, 1, Number.MAX_SAFE_INTEGER - 1)));
  return { enabled: value?.enabled !== false, entries, customEntries, nextCustomId };
}

export function embeddedWorldbookSettingsView(value?: EmbeddedWorldbookSettings): WorldbookEditorState {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  return {
    enabled: settings.enabled,
    items: [...sourceEntries.map(([id, entry]) => ({
      id,
      title: entry.comment || `条目 ${id}`,
      content: Object.prototype.hasOwnProperty.call(settings.entries, id) ? settings.entries[id]! : entry.content,
      defaultContent: entry.content,
      depth: entry.depth,
      role: entry.role,
      order: entry.order,
    })), ...settings.customEntries.map(entry => ({ ...entry, defaultContent: '', custom: entry }))],
  };
}

export function updateEmbeddedWorldbookSettings(value: EmbeddedWorldbookSettings | undefined, update: WorldbookEditorUpdate) {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  if (typeof update.enabled === 'boolean') settings.enabled = update.enabled;
  if (update.entry) {
    if (!sourceEntries.some(([id]) => id === update.entry!.id)) throw Error('未知的内置世界书条目');
    if (update.entry.content === undefined) delete settings.entries[update.entry.id];
    else settings.entries[update.entry.id] = update.entry.content;
  }
  if (update.create) {
    if (settings.nextCustomId >= Number.MAX_SAFE_INTEGER - 1) throw Error('无法创建更多条目');
    settings.customEntries.push(normalizeCustomEntry({ id: `custom-${settings.nextCustomId++}` }));
  }
  if (update.custom) {
    const index = settings.customEntries.findIndex(entry => entry.id === update.custom!.id);
    if (index < 0) throw Error('条目不存在');
    if (update.custom.delete) settings.customEntries.splice(index, 1);
    else {
      const patch = update.custom.patch ?? {};
      for (const [key, max] of [['depth', 1000], ['role', 2], ['order', 99999]] as const) {
        if (key in patch && integer(patch[key], -1, max) === -1) throw Error(`${key === 'depth' ? '深度' : key === 'role' ? '提示词类型' : '顺序'}填写无效`);
      }
      const entry = normalizeCustomEntry({ ...settings.customEntries[index]!, ...patch, id: update.custom.id });
      if (!entry.constant && !entry.keys.length) throw Error('请填写触发关键词');
      settings.customEntries[index] = entry;
    }
  }
  return settings;
}

export function buildEmbeddedWorldbook(value?: EmbeddedWorldbookSettings): EmbeddedPrompt[] {
  const settings = normalizeEmbeddedWorldbookSettings(value);
  if (!settings.enabled) return [];

  const groups = new Map<string, { depth: number; role: number; contents: string[] }>();
  for (const entry of embeddedWorldbookEntries(settings).filter(entry => entry.constant).sort((a, b) => a.order - b.order)) {
    if (entry.position !== AT_DEPTH) throw Error('内置世界书包含非深度注入条目，无法保证位置等价');
    const key = `${entry.depth}:${entry.role}`;
    const group = groups.get(key) ?? { depth: entry.depth, role: entry.role, contents: [] };
    group.contents.push(entry.content);
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
    if (Array.isArray(globalLore)) {
      for (let i = globalLore.length - 1; i >= 0; i--) {
        if ([EMBEDDED_WORLD_NAME, CUSTOM_WORLD_NAME].includes(globalLore[i]?.world)) globalLore.splice(i, 1);
      }
      globalLore.push(...embeddedWorldbookEntries(value));
    }
  });
  if (native?.available) return Object.assign(() => native.stop(), { mode: 'native' as const });

  // Older hosts without the native hook retain depth/role and internal order.
  // Keyword entries stay native-only; the editor disables that option on old hosts.
  const installed: string[] = [];
  for (const prompt of buildEmbeddedWorldbook(value)) {
    if (host.inject(prompt.id, prompt.content, prompt)) installed.push(prompt.id);
  }
  return Object.assign(() => { for (const id of installed) host.clearInjection(id); }, { mode: 'depth' as const });
}
