import worldbook from '../../assets/worldbook/!通用战斗系统约束.json';

interface SourceEntry {
  content: string;
  position: number;
  depth: number;
  role: number;
  order: number;
  disable?: boolean;
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

export function buildEmbeddedWorldbook(): EmbeddedPrompt[] {
  const entries = (Object.values(worldbook.entries) as SourceEntry[])
    .filter(entry => !entry.disable)
    .sort((a, b) => a.order - b.order);

  const groups = new Map<string, { depth: number; role: number; contents: string[] }>();
  for (const entry of entries) {
    if (entry.position !== AT_DEPTH) throw Error('内置世界书包含非深度注入条目，无法保证位置等价');
    const key = `${entry.depth}:${entry.role}`;
    const group = groups.get(key) ?? { depth: entry.depth, role: entry.role, contents: [] };
    group.contents.push(entry.content);
    groups.set(key, group);
  }

  return [...groups.values()].map(group => ({
    id: `tavern-battle-native:worldbook:depth-${group.depth}:role-${group.role}`,
    content: group.contents.join('\n'),
    position: IN_CHAT,
    depth: group.depth,
    scan: false,
    role: group.role,
  }));
}

export const EMBEDDED_WORLDBOOK = buildEmbeddedWorldbook();

export function installEmbeddedWorldbook(host: {
  inject(id: string, content: string, options?: { position?: number; depth?: number; scan?: boolean; role?: number }): boolean;
  clearInjection(id: string): void;
}): () => void {
  const installed: string[] = [];
  for (const prompt of EMBEDDED_WORLDBOOK) {
    if (host.inject(prompt.id, prompt.content, prompt)) installed.push(prompt.id);
  }
  return () => { for (const id of installed) host.clearInjection(id); };
}
