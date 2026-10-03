/**
 * unit_set 写了不存在的编号：同名已有档案就是要修改的那个；否则写全新单位字段（name、side、scale，编队含 hpMax）时
 * 按 spawn 规则新建入档、不改出场名单，该编号在同一事件块内指代这个新单位，未被占用的 u 编号沿用为正式编号。
 * spawn 写的 id 在解析时已丢弃，编号由插件分配。已有单位的编号永远不会被改指。
 */
import type { Suggestion } from './tags.js';
import type { NarrativeSave } from './narrative-state.js';
import { normalizeHandle, type narrativeIds } from './narrative-ids.js';
import { parseProtocol } from './protocol.js';
import { serializeEvent } from './protocol-syntax.js';

type Ids = ReturnType<typeof narrativeIds>;
type UnitSet = Extract<Suggestion, { kind: 'unit-set' }>;
export interface NewUnitPlan {
  events: Suggestion[];
  /** Real ids of the units created from unit_set. */
  created: Set<string>;
  /** Created unit → the free u-handle the reply wrote for it. */
  handles: Map<string, string>;
  /** Created unit → unit_set fields spawn cannot express (experience, note, shield spec, data…). */
  patches: Map<string, Record<string, unknown>>;
}

/** The engine identity of the n-th card created by the event at `index`. */
export const newUnitId = (proposalId: string, index: number, n = 0) => `unit-${proposalId}-${index}-${n}`;
const UNIT_REFERENCES = new Set<Suggestion['kind']>(['deploy', 'unit-update', 'unit-set', 'learn', 'bless', 'affect', 'unbless', 'unaffect']);
const unitReference = (event: Suggestion): event is Suggestion & { id: string } => UNIT_REFERENCES.has(event.kind) && 'id' in event && !!event.id;
const key = (id: string) => normalizeHandle(id.trim());
// unit_set field → spawn attribute; everything else is applied after creation.
const SPAWN_FIELDS: Record<string, string> = { name: 'name', side: 'side', scale: 'scale', archetype: 'archetype', level: 'level', hp: 'hp', hpMax: 'hpMax',
  body: 'body', mount: 'mount', speedTier: 'speed', weapon: 'weapon', sidearm: 'weapon2', armor: 'armor', skills: 'skills', traits: 'traits' };

function creatable(event: UnitSet): boolean {
  const data = event.data, base = data.base as { hpMax?: unknown } | undefined;
  return typeof data.name === 'string' && !!data.name.trim() && ['ally', 'enemy'].includes(String(data.side)) && ['hero', 'company'].includes(String(data.scale))
    && (data.scale === 'hero' || typeof data.hpMax === 'number' || typeof base?.hpMax === 'number');
}
function spawnFromUnitSet(event: UnitSet): { spawn: Suggestion; rest: Record<string, unknown> } {
  const attrs: Record<string, string> = {}, rest: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(event.data)) {
    const attr = SPAWN_FIELDS[field];
    const text = attr === undefined ? undefined : ['string', 'number', 'boolean'].includes(typeof value) ? String(value)
      : field === 'traits' && Array.isArray(value) && value.every(v => typeof v === 'string') ? value.join(',') : undefined;
    if (text === undefined) rest[field] = value; else attrs[attr!] = text;
  }
  const parsed = parseProtocol(serializeEvent('spawn', attrs), { diagnostics: false });
  if (parsed.errors.length || parsed.events[0]?.kind !== 'spawn') throw Error(`新单位「${attrs.name}」无法建档：${parsed.errors[0] ?? '字段无法解析'}`);
  return { spawn: { ...parsed.events[0], archiveOnly: true }, rest };
}

export function planNewUnits(save: NarrativeSave, proposalId: string, input: Suggestion[], ids: Ids): NewUnitPlan {
  const records = save.storage ?? [], existing = new Set(records.map(r => r.id));
  const events = [...input], created = new Set<string>(), handles = new Map<string, string>(), patches = new Map<string, Record<string, unknown>>();
  const aliases = new Map<string, number>();
  const named = (name: unknown): string[] => {
    if (typeof name !== 'string' || !name.trim()) return [];
    const hits = records.filter(r => r.name === name.trim()), active = hits.filter(r => !r.retired);
    return (active.length ? active : hits).map(r => r.id);
  };
  const unknown = new Map<string, number[]>();
  for (const [index, event] of events.entries()) {
    if (event.kind === 'unit-set' && !existing.has(event.id)) unknown.set(key(event.id), [...unknown.get(key(event.id)) ?? [], index]);
  }
  for (const [alias, indexes] of unknown) {
    const sets = indexes.map(i => events[i] as UnitSet), written = ids.publicId(sets[0]!.id);
    const matches = [...new Set(sets.flatMap(set => named(set.data.name)))];
    if (matches.length > 1) throw Error(`编号 ${written} 不是已有单位，同名档案有 ${matches.map(ids.publicId).join('、')}，请写明要修改哪一个`);
    if (matches.length === 1) { for (const i of indexes) events[i] = { ...events[i] as UnitSet, id: matches[0]! }; continue; }
    const creator = indexes.find(i => creatable(events[i] as UnitSet));
    if (creator === undefined) continue; // Left to the missing-record error.
    const { spawn, rest } = spawnFromUnitSet(events[creator] as UnitSet), id = newUnitId(proposalId, creator);
    events[creator] = spawn; created.add(id); aliases.set(alias, creator);
    if (Object.keys(rest).length) patches.set(id, rest);
    if (/^u[1-9]\d*$/.test(key(written)) && !ids.taken(key(written))) handles.set(id, key(written));
  }
  for (const [index, event] of events.entries()) {
    if (!unitReference(event)) continue;
    const creator = aliases.get(key(event.id));
    if (creator !== undefined) events[index] = { ...event, id: newUnitId(proposalId, creator) } as Suggestion;
    else if ((event.kind === 'deploy' || event.kind === 'unit-update') && !existing.has(event.id) && event.name) {
      const matches = named(event.name);
      if (matches.length === 1) events[index] = { ...event, id: matches[0]! };
    }
  }
  return { events, created, handles, patches };
}
