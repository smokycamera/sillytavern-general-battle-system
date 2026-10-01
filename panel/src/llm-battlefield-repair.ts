import { GATE_SECTORS } from '../../engine/src/small/battlefield-plan.js';
import { safeLandmarkLabel } from '../../engine/src/small/map-label.js';
import { SCENE_ARCHETYPES, SCENE_ENTITY_KINDS, SCENE_RELATIONS, WORLD_ANCHORS, type NarrativeSource } from '../../engine/src/small/scene-intent.js';

type Json = Record<string, unknown>;
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const token = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
const has = (list: readonly string[], v: string) => list.includes(v);
const alias = <T extends string>(map: Record<string, T>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
const RESERVED_IDS = ['ally', 'enemy', 'neutral', 'constructor', 'prototype', '__proto__'];
const KIND_ALIASES: Record<string, string> = { town: 'city', village: 'city', castle: 'city', stream: 'river', creek: 'river', brook: 'river',
  woods: 'forest', wood: 'forest', jungle: 'forest', ridge: 'hill', mountain: 'hill', plaza: 'square', wall: 'fortification', trench: 'fortification',
  barricade: 'cover', house: 'building', ruin: 'ruins' };
const RELATION_ALIASES: Record<string, string> = { in: 'inside', within: 'inside', beside: 'near', next_to: 'near', adjacent_to: 'near',
  connects: 'connected_to', connects_to: 'connected_to', leads_to: 'connected_to', spans: 'crosses', cross: 'crosses', defends: 'guards', guard: 'guards',
  holds: 'occupies', occupy: 'occupies', approach_from: 'approaches_from', comes_from: 'approaches_from', advances_from: 'approaches_from',
  target: 'targets', exit_at: 'exits_at', escapes_to: 'exits_at' };
const STATE_ALIASES: Record<string, string> = { ruined: 'destroyed', broken: 'destroyed', collapsed: 'destroyed', opened: 'open', shut: 'closed', locked: 'closed' };
const FORCE_ALIASES: Record<string, 'ally' | 'enemy'> = { ally: 'ally', allies: 'ally', player: 'ally', '我方': 'ally', '友军': 'ally', enemy: 'enemy', enemies: 'enemy', '敌方': 'enemy', '敌军': 'enemy' };
const FORCE_RELATIONS = ['guards', 'occupies', 'approaches_from', 'near', 'inside', 'targets', 'exits_at'];
const SIDE_REGIONS: Record<string, string> = { north_of: 'north_bank', south_of: 'south_bank', east_of: 'east_bank', west_of: 'west_bank' };
const DESTROYABLE = ['gate', 'bridge', 'building', 'tower', 'fortification', 'cover', 'ruins'];
const ENUM_FIELDS = ['scene', 'size', 'layout', 'shape', 'topology', 'density', 'water', 'gates', 'gateState', 'orientation', 'relief', 'cover', 'obstacles', 'breadth', 'archetype', 'cityPosition', 'waterAxis', 'waterPosition'];

export interface BattlefieldRepairContext {
  sources: readonly NarrativeSource[];
  /** Public unit handle (u1, u2…) to display name. */
  units: Record<string, string>;
}
function anchorOf(v: unknown): string | undefined {
  const t = token(v).replace(/^(north|south)_?(east|west)$/, '$1_$2');
  const value = alias({ centre: 'center', middle: 'center', central: 'center' }, t) ?? t;
  return has(WORLD_ANCHORS, value) ? value : undefined;
}
/** Display names keep their words; separators become a middle dot and other symbols are removed. */
function labelOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return;
  const text = v.replace(/[、/／|｜,，;；:：]+/g, '·').replace(/[^\p{L}\p{N} ·・—–\-()（）]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '');
  return safeLandmarkLabel([...text].slice(0, 32).join('').replace(/[\s·]+$/, ''));
}
function integer(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * Normalizes unambiguous formatting slips in a model's battlefield answer before strict validation:
 * citation punctuation, anchor spelling, unsafe labels, malformed IDs and relations that cannot be
 * expressed. Explicit facts without a valid citation are kept as inferred. Every change is reported.
 */
export function repairBattlefieldAnswer(answer: unknown, context: BattlefieldRepairContext): { battlefield: unknown; notes: string[] } {
  const notes = new Set<string>(), top = object(answer) ? answer : {};
  let battlefield: unknown = top.battlefield;
  if (typeof battlefield === 'string') { try { battlefield = JSON.parse(battlefield); } catch { /* reported by the strict parser */ } }
  if (battlefield === undefined && object(top.intent)) battlefield = {};
  if (!object(battlefield)) return { battlefield, notes: [] };
  const plan: Json = { ...battlefield };
  if (plan.intent === undefined && object(top.intent)) plan.intent = top.intent;
  if (plan.intent === undefined && ['entities', 'relations', 'constraints'].some(k => Array.isArray(plan[k]))) {
    plan.intent = { entities: plan.entities, relations: plan.relations, constraints: plan.constraints };
    delete plan.entities; delete plan.relations; delete plan.constraints;
  }
  for (const key of ENUM_FIELDS) if (typeof plan[key] === 'string') plan[key] = key === 'cityPosition' || key === 'waterPosition' ? anchorOf(plan[key]) ?? plan[key] : token(plan[key]);
  if (object(plan.intent)) {
    // Entities carry every structure, so a malformed legacy list is redundant rather than fatal.
    const bridges = plan.bridgePlan, gates = plan.gatePlan;
    if (bridges !== undefined && !(Array.isArray(bridges) && bridges.length <= 4 && bridges.every(b => object(b) && has(WORLD_ANCHORS, String(b.anchor)) && ['intact', 'destroyed'].includes(String(b.state))))) { delete plan.bridgePlan; notes.add('已忽略格式无效的bridgePlan'); }
    if (gates !== undefined && !(Array.isArray(gates) && gates.length <= 4 && gates.every(g => object(g) && has(GATE_SECTORS, String(g.sector)) && ['closed', 'open', 'destroyed'].includes(String(g.state))))) { delete plan.gatePlan; notes.add('已忽略格式无效的gatePlan'); }
    plan.intent = repairIntent(plan.intent, context, notes, typeof plan.scene === 'string' ? plan.scene : '');
  }
  return { battlefield: plan, notes: [...notes] };
}

/** Nearest kind the stated scene can build; undefined when the place cannot exist there. */
function sceneKind(kind: string, scene: string, city: boolean): string | undefined {
  if (scene === 'interior') return ['hill', 'forest', 'bridge', 'river', 'city'].includes(kind) ? undefined : ['building', 'square', 'tower'].includes(kind) ? 'room' : kind;
  if (kind === 'room' && scene && scene !== 'building_siege') return 'building';
  if (kind === 'gate' && ['field', 'city_streets', 'trenches'].includes(scene) && !city) return 'position';
  return kind;
}
function repairIntent(raw: Json, context: BattlefieldRepairContext, notes: Set<string>, scene: string): Json {
  const known = new Set(context.sources.map(s => s.id)), unitIds = new Set(Object.keys(context.units));
  const names = Object.entries(context.units).map(([id, name]) => [name.trim(), id] as const).filter(([name]) => name);
  // A unit name stands for its handle only when no other unit shares it.
  const unitNames = new Map(names.filter(([name]) => names.filter(([other]) => other === name).length === 1));
  let uncited = false;
  const evidence = (item: Json) => {
    const list = typeof item.sources === 'string' ? item.sources.split(/[\s,，;；、]+/) : Array.isArray(item.sources) ? item.sources : [];
    const sources = [...new Set(list.flatMap(s => typeof s === 'string' ? [s.trim().toLowerCase().replace(/^[[【(（]+|[\]】)）]+$/g, '')] : []))]
      .filter(s => /^m\d+\.p\d+$/.test(s) && known.has(s)).slice(0, 4);
    if (token(item.basis) === 'explicit' && sources.length) return { basis: 'explicit', sources };
    if (token(item.basis) === 'explicit') uncited = true;
    return { basis: 'inferred', ...(sources.length ? { sources } : {}) };
  };
  const intent: Json = { schema: 'scene-intent-v1', entities: [], relations: [], constraints: [] };
  const archetype = token(raw.archetype);
  if (has(SCENE_ARCHETYPES, archetype)) intent.archetype = archetype;
  else if (raw.archetype !== undefined) notes.add('场景原型无效，已省略');

  // Entities: invalid IDs get a fresh handle; references by old ID, then by label, follow it.
  const items = Array.isArray(raw.entities) ? raw.entities : [];
  const usable = (name: string) => ID.test(name) && !RESERVED_IDS.includes(name.toLowerCase()) && !/^u\d+$/i.test(name);
  const taken = new Set(items.flatMap(item => object(item) && typeof item.id === 'string' && usable(item.id.trim()) ? [item.id.trim()] : []));
  const refs = new Map<string, string>(), labels: [string, string][] = [], entities: Json[] = [], kinds = new Map<string, string>();
  const fresh = (kind: string) => { let n = 1; while (taken.has(kind + n) || kinds.has(kind + n)) n++; return kind + n; };
  const kindOf = (item: Json) => alias(KIND_ALIASES, token(item.kind)) ?? token(item.kind);
  const city = items.some(item => object(item) && kindOf(item) === 'city');
  for (const item of items) {
    if (!object(item)) { notes.add('无效地点未采用'); continue; }
    const stated = kindOf(item), kind = sceneKind(stated, scene, city) ?? '';
    const name = typeof item.id === 'string' ? item.id.trim() : '', label = labelOf(item.label);
    // Relations may name a place by its label exactly as written, before it was made displayable.
    const written = typeof item.label === 'string' ? item.label.trim() : '';
    if (!has(SCENE_ENTITY_KINDS, stated)) { notes.add(`地点${label ?? name}类型无效，未采用`); continue; }
    if (kind !== stated) notes.add('部分地点类型与所选场景不符，已改用相近类型或省略');
    if (!kind) continue;
    const single = kind === 'city' || kind === 'river' ? entities.find(e => e.kind === kind) : undefined;
    if (single) {
      // One city and one main river per battle: the duplicate becomes the same place.
      if (name && !refs.has(name)) refs.set(name, single.id as string);
      for (const text of new Set([written, label ?? ''])) if (text) labels.push([text, single.id as string]);
      notes.add(kind === 'city' ? '多个城市已合并为一座' : '多条河流已合并为一条主河'); continue;
    }
    if ((kind === 'bridge' || kind === 'gate') && entities.filter(e => e.kind === kind).length >= 4) { notes.add(`${kind === 'bridge' ? '桥梁' : '城门'}超过4处，超出项未采用`); continue; }
    const id = usable(name) && !kinds.has(name) ? name : fresh(kind);
    kinds.set(id, kind);
    if (name && !refs.has(name)) refs.set(name, id);
    const entity: Json = { id, kind, ...evidence(item) };
    for (const text of new Set([written, label ?? ''])) if (text) labels.push([text, id]);
    if (label) entity.label = label;
    else if (written) notes.add('部分地点名称无法显示，已省略');
    const anchor = anchorOf(item.anchor);
    if (anchor) entity.anchor = anchor;
    else if (item.anchor !== undefined && item.anchor !== null && item.anchor !== '') notes.add('部分地点方位无效，已改由关系或本地布局决定');
    if (token(item.scale) === 'minor' || token(item.scale) === 'major') entity.scale = token(item.scale);
    const height = integer(item.height);
    if (height !== undefined) { entity.height = Math.max(0, Math.min(3, height)); if (entity.height !== height) notes.add('地表高度超出0—3，已截取'); }
    const state = alias(STATE_ALIASES, token(item.state)) ?? token(item.state);
    if (state === 'intact' || state === 'destroyed' && has(DESTROYABLE, kind) || (state === 'open' || state === 'closed') && kind === 'gate') entity.state = state;
    else if (state) notes.add('部分地点状态不适用于该类型，已省略');
    const width = integer(item.width);
    if (width === 1 || width === 2) entity.width = width;
    entities.push(entity);
  }
  for (const [label, id] of labels) if (!refs.has(label)) refs.set(label, id);
  if (entities.length > 12) {
    // Keep structures and cited facts first; the original order is otherwise preserved.
    const rank = (e: Json) => (['city', 'river', 'bridge', 'gate'].includes(e.kind as string) ? 0 : 2) + (e.basis === 'explicit' ? 0 : 1);
    const kept = new Set([...entities].sort((a, b) => rank(a) - rank(b)).slice(0, 12));
    for (const e of entities) if (!kept.has(e)) kinds.delete(e.id as string);
    entities.splice(0, entities.length, ...entities.filter(e => kept.has(e)));
    notes.add('地点超过12项，已保留主要设施与正文明确地点');
  }
  intent.entities = entities;

  const resolve = (v: unknown): string => {
    if (typeof v !== 'string') return '';
    const text = v.trim();
    const mapped = refs.get(text); if (mapped && kinds.has(mapped)) return mapped;
    if (kinds.has(text)) return text;
    const force = alias(FORCE_ALIASES, text.toLowerCase()); if (force) return force;
    if (unitIds.has(text.toLowerCase())) return text.toLowerCase();
    return unitNames.get(text) ?? text;
  };
  const isForce = (s: string) => s === 'ally' || s === 'enemy' || unitIds.has(s);
  const relations: Json[] = [], seen = new Set<string>();
  let objective: string | undefined, dropped = 0;
  for (const item of Array.isArray(raw.relations) ? raw.relations : []) {
    if (!object(item)) { dropped++; continue; }
    let subject = resolve(item.subject), target = resolve(item.object), relation = alias(RELATION_ALIASES, token(item.relation)) ?? token(item.relation);
    let region = token(item.region).replace(/^(north|south|east|west)$/, '$1_bank');
    if (relation === 'near' && kinds.has(subject) && isForce(target)) [subject, target] = [target, subject];
    if (!has(SCENE_RELATIONS, relation) || !kinds.has(target) || subject === target) { dropped++; continue; }
    // A reinterpreted relation still guides layout, but only as an inference, never as a hard fact.
    let reinterpreted = false;
    if (isForce(subject)) {
      // A force on one side of a place is a nearby deployment on that side.
      const side = alias(SIDE_REGIONS, relation);
      if (side) { region ||= side; relation = 'near'; reinterpreted = true; }
      if (!FORCE_RELATIONS.includes(relation)) { dropped++; continue; }
    } else if (kinds.has(subject)) {
      if (relation === 'guards' || relation === 'occupies' || relation === 'crosses' && kinds.get(subject) !== 'bridge') { relation = 'near'; reinterpreted = true; }
      if (['approaches_from', 'targets', 'exits_at'].includes(relation)) { dropped++; continue; }
    } else { dropped++; continue; }
    if (relation === 'targets' || relation === 'exits_at') {
      if (objective !== undefined && objective !== target) { notes.add('任务地点只能有一处，已保留第一处'); continue; }
      objective = target;
    }
    const key = subject + '|' + relation + '|' + target;
    if (seen.has(key)) continue;
    seen.add(key);
    const proof = evidence(item);
    relations.push({ subject, relation, object: target, ...(['north_bank', 'south_bank', 'east_bank', 'west_bank'].includes(region) ? { region } : {}), ...proof, ...(reinterpreted ? { basis: 'inferred' } : {}) });
  }
  if (dropped) notes.add(`${dropped}条无法对应地点或部队的关系未采用`);
  if (relations.length > 24) notes.add('关系超过24条，超出项未采用');
  intent.relations = relations.slice(0, 24);

  const constraints: Json[] = [];
  for (const item of Array.isArray(raw.constraints) ? raw.constraints : []) {
    if (!object(item)) continue;
    const kind = alias({ bridge_count: 'crossing_count', bridges: 'crossing_count', crossings: 'crossing_count', gates: 'gate_count' }, token(item.kind)) ?? token(item.kind);
    const needed = kind === 'crossing_count' ? 'river' : kind === 'gate_count' ? 'city' : undefined;
    const value = integer(item.value);
    let entity = resolve(item.entity);
    if (needed && kinds.get(entity) !== needed) {
      const only = entities.filter(e => e.kind === needed);
      entity = only.length === 1 ? only[0]!.id as string : '';
    }
    if (!needed || !entity || value === undefined || value < 0 || value > 4 || constraints.some(c => c.kind === kind)) { notes.add('无效桥门数量约束未采用'); continue; }
    constraints.push({ kind, entity, value, ...evidence(item) });
  }
  intent.constraints = constraints.slice(0, 8);
  if (uncited) notes.add('部分正文事实缺少有效段落引用，按推断处理');
  return intent;
}
