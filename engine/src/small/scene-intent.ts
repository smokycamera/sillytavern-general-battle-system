import { safeLandmarkLabel } from './map-label.js';
export const SCENE_ARCHETYPES = ['old_town', 'market', 'warehouse', 'riverside', 'hilltown', 'gate_front', 'outskirts',
    'farmland', 'river_crossing', 'rolling_hills', 'forest_path', 'forest_stream', 'forest_edge', 'mountain_pass',
    'ridge_valley', 'terraces', 'residence', 'great_hall', 'fortress', 'trench_line', 'trench_depth'] as const;
export type SceneArchetype = typeof SCENE_ARCHETYPES[number];
export const WORLD_ANCHORS = ['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west', 'center'] as const;
export type WorldAnchor = typeof WORLD_ANCHORS[number];
export const SCENE_ENTITY_KINDS = ['city', 'river', 'bridge', 'gate', 'hill', 'forest', 'square', 'tower', 'ruins', 'fortification', 'building', 'room', 'cover', 'position'] as const;
export const SCENE_RELATIONS = ['near', 'inside', 'north_of', 'south_of', 'east_of', 'west_of', 'higher_than', 'overlooks', 'crosses',
    'connected_to', 'guards', 'occupies', 'approaches_from', 'targets', 'exits_at'] as const;
export interface SceneEvidence {
    basis: 'explicit' | 'inferred';
    sources: string[];
}
export interface SceneEntity extends SceneEvidence {
    id: string;
    kind: typeof SCENE_ENTITY_KINDS[number];
    label?: string;
    anchor?: WorldAnchor;
    scale?: 'minor' | 'major';
    height?: number;
    state?: 'intact' | 'open' | 'closed' | 'destroyed';
    width?: 1 | 2;
}
export interface SceneRelation extends SceneEvidence {
    subject: string;
    relation: typeof SCENE_RELATIONS[number];
    object: string;
    region?: 'north_bank' | 'south_bank' | 'east_bank' | 'west_bank';
}
export interface SceneConstraint extends SceneEvidence {
    kind: 'crossing_count' | 'gate_count';
    entity: string;
    value: number;
}
export interface SceneIntent {
    schema: 'scene-intent-v1';
    archetype?: SceneArchetype;
    entities: SceneEntity[];
    relations: SceneRelation[];
    constraints: SceneConstraint[];
}
export interface NarrativeSource {
    id: string;
    text: string;
}
export const SCENE_ARCHETYPE_NAMES: Record<SceneArchetype, string> = {
    old_town: '老城街巷', market: '市场街区', warehouse: '仓储街区', riverside: '滨河战区', hilltown: '山城台地',
    gate_front: '城门前沿', outskirts: '城外郊野', farmland: '农田道路', river_crossing: '河谷渡口', rolling_hills: '缓丘地带',
    forest_path: '林间道路', forest_stream: '溪流密林', forest_edge: '林缘空地', mountain_pass: '山口关隘',
    ridge_valley: '双岭谷地', terraces: '台地斜坡', residence: '住宅院落', great_hall: '仓库大厅', fortress: '堡垒内部',
    trench_line: '前沿壕线', trench_depth: '纵深堑壕',
};
const obj = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
const includes = (xs: readonly string[], v: unknown): v is string => typeof v === 'string' && xs.includes(v);
function evidence(v: Record<string, unknown>): SceneEvidence {
    v = { sources: [], basis: 'inferred', ...v };
    if (!['explicit', 'inferred'].includes(String(v.basis)))
        throw Error('场景事实须标明explicit或inferred');
    if (!Array.isArray(v.sources) || v.sources.length > 4 || v.sources.some(s => typeof s !== 'string' || !/^m\d+\.p\d+$/.test(s)))
        throw Error('场景事实的正文引用无效');
    if (v.basis === 'explicit' && !v.sources.length)
        throw Error('正文明确事实须附来源段落');
    return { basis: v.basis as SceneEvidence['basis'], sources: [...new Set(v.sources)] as string[] };
}
/** The director supplies bounded relationships; all geometry and unit abilities remain local. */
export function normalizeSceneIntent(value: unknown): SceneIntent | undefined {
    if (value === undefined)
        return;
    const raw = obj(value);
    const v: Record<string, unknown> | undefined = raw && { schema: 'scene-intent-v1', entities: [], relations: [], constraints: [], ...raw };
    if (!v || v.schema !== 'scene-intent-v1')
        throw Error('场景意图版本无效');
    if (!Array.isArray(v.entities) || v.entities.length > 12 || !Array.isArray(v.relations) || v.relations.length > 24
        || !Array.isArray(v.constraints) || v.constraints.length > 8)
        throw Error('场景实体最多12项、关系最多24项、数量约束最多8项');
    const result: SceneIntent = { schema: 'scene-intent-v1', entities: [], relations: [], constraints: [] };
    if (v.archetype !== undefined) {
        if (!includes(SCENE_ARCHETYPES, v.archetype))
            throw Error('场景原型无效');
        result.archetype = v.archetype as SceneArchetype;
    }
    for (const raw of v.entities) {
        const e = obj(raw);
        if (!e || !id(e.id) || !includes(SCENE_ENTITY_KINDS, e.kind) || ['ally', 'enemy', 'neutral'].includes(e.id))
            throw Error('场景实体ID或类型无效');
        if (result.entities.some(x => x.id === e.id))
            throw Error('场景实体ID重复');
        const entity: SceneEntity = { id: e.id, kind: e.kind as SceneEntity['kind'], ...evidence(e) };
        if (e.label !== undefined) {
            const label = safeLandmarkLabel(e.label);
            if (!label)
                throw Error('场景名称无效');
            entity.label = label;
        }
        if (e.anchor !== undefined) {
            if (!includes(WORLD_ANCHORS, e.anchor))
                throw Error('场景绝对方位无效');
            entity.anchor = e.anchor as WorldAnchor;
        }
        if (e.scale === 'minor' || e.scale === 'major')
            entity.scale = e.scale;
        if (e.height !== undefined) {
            if (!Number.isInteger(e.height) || Number(e.height) < 0 || Number(e.height) > 3)
                throw Error('地表高度须为0—3');
            entity.height = Number(e.height);
        }
        if (e.state !== undefined) {
            if (!includes(['intact', 'open', 'closed', 'destroyed'], e.state))
                throw Error('场景实体状态无效');
            entity.state = e.state as SceneEntity['state'];
            if (entity.kind !== 'gate' && (entity.state === 'open' || entity.state === 'closed')
                || !['gate','bridge','building','tower','fortification','cover','ruins'].includes(entity.kind) && entity.state !== 'intact')
                throw Error('open/closed仅用于gate；destroyed用于桥、建筑、塔楼、工事或掩体');
        }
        if (e.width === 1 || e.width === 2)
            entity.width = e.width;
        result.entities.push(entity);
    }
    const entityIds = new Set(result.entities.map(e => e.id));
    for (const raw of v.relations) {
        const r = obj(raw);
        if (!r || !id(r.subject) || !id(r.object) || !includes(SCENE_RELATIONS, r.relation) || r.subject === r.object
            || !entityIds.has(r.object))
            throw Error('场景关系或引用的实体无效');
        // Unit handles are resolved against the active roster at the panel boundary.
        if (!entityIds.has(r.subject) && !['ally', 'enemy'].includes(r.subject) && !/^u\d+$/.test(r.subject))
            throw Error('场景关系的主体无效');
        const relation: SceneRelation = { subject: r.subject, object: r.object, relation: r.relation as SceneRelation['relation'], ...evidence(r) };
        if (r.region !== undefined) {
            if (!includes(['north_bank', 'south_bank', 'east_bank', 'west_bank'], r.region))
                throw Error('部署岸区无效');
            relation.region = r.region as SceneRelation['region'];
        }
        result.relations.push(relation);
    }
    for (const raw of v.constraints) {
        const c = obj(raw);
        if (!c || !includes(['crossing_count', 'gate_count'], c.kind) || !entityIds.has(String(c.entity))
            || !Number.isInteger(c.value) || Number(c.value) < 0 || Number(c.value) > 4)
            throw Error('桥门数量约束须为0—4且引用合法实体');
        const entity = result.entities.find(e => e.id === c.entity)!;
        if (c.kind === 'crossing_count' && entity.kind !== 'river' || c.kind === 'gate_count' && entity.kind !== 'city')
            throw Error('桥门数量约束的对象类型不匹配');
        result.constraints.push({ kind: c.kind as SceneConstraint['kind'], entity: String(c.entity), value: Number(c.value), ...evidence(c) });
    }
    return result;
}
export function validateSceneIntentEvidence(intent: SceneIntent, sources: readonly NarrativeSource[], unitIds: readonly string[]): void {
    const sourceIds = new Set(sources.map(s => s.id)), knownUnits = new Set(unitIds);
    for (const item of [...intent.entities, ...intent.relations, ...intent.constraints]) {
        if (item.sources.some(ref => !sourceIds.has(ref)))
            throw Error('场景设计引用了未发送的正文段落');
    }
    for (const r of intent.relations)
        if (/^u\d+$/.test(r.subject) && !knownUnits.has(r.subject))
            throw Error('场景部署引用了未参战单位');
}
export const SCENE_INTENT_PROMPT = `intent:{entities:[],relations:[],constraints:[]}；schema可省略。三类数组省略时为空。可选archetype=${SCENE_ARCHETYPES.join('|')}，按场所用途选择。
entities总计≤12：{id:短英文ID,kind:${SCENE_ENTITY_KINDS.join('|')},label?:名称,anchor?:${WORLD_ANCHORS.join('|')},scale?:minor|major,height?:0..3,state?:intact|destroyed,width?:1|2,basis?:explicit|inferred,sources?:["m1.p1"]}。gate另可state=open|closed。默认minor；仅主要地形用major。最多一座city、一条river、四座bridge、四处gate；其他实体共享剩余名额。普通同类设施可合并成一个有名称的地标。
正文明确事实用basis=explicit及narrativeSources中的段落ID；补全用inferred，sources可省略。采用最新实际状态，区分否定、回忆、假设和计划。
relations≤24：{subject:实体ID|ally|enemy|现有u短ID,relation:${SCENE_RELATIONS.join('|')},object:实体ID,region?:north_bank|south_bank|east_bank|west_bank,basis?,sources?}。部队仅用guards/occupies/approaches_from/inside/near/targets/exits_at；地点用方位/inside/near/connected_to/higher_than/overlooks，桥用crosses。方位为地图绝对方向。只写影响布阵、任务或地形的关系。
constraints≤8：{kind:crossing_count|gate_count,entity:river或city的ID,value:0..4,basis?,sources?}。只用于明确数量；与桥门实体数一致。唯一过河点保留深水和指定桥。entities已含全部设施，不再重复写landmarks/bridgePlan/gatePlan。正文空旷可为空数组。`;
