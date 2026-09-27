import worldbook from '../../assets/worldbook/!通用战斗系统约束.json';
import type { WorldbookEditorState, WorldbookEditorUpdate } from '../../panel/src/panel-runtime.js';

interface SourceEntry {
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

  return [...groups.values()].map(group => ({
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
}, value?: EmbeddedWorldbookSettings): () => void {
  const installed: string[] = [];
  for (const prompt of buildEmbeddedWorldbook(value)) {
    if (host.inject(prompt.id, prompt.content, prompt)) installed.push(prompt.id);
  }
  return () => { for (const id of installed) host.clearInjection(id); };
}
