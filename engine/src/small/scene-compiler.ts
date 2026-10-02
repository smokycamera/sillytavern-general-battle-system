import type { BattlefieldPlan, LandmarkPlan, GatePlan } from './battlefield-plan.js';
import { BattlefieldPlanError } from './battlefield-error.js';
import { WORLD_ANCHORS, SCENE_ARCHETYPE_NAMES, type SceneIntent, type SceneEntity, type WorldAnchor, type SceneArchetype } from './scene-intent.js';
import { SCENE_ARCHETYPES, normalizeSceneIntent } from './scene-intent.js';
import { groundBlocked, intactStructure } from './layers.js';
import { gridDistance, neighbors, findGridPath, gridCostsToGoals, unitLineOfSight, type BattlefieldSpec } from './spatial.js';
import { worldAnchorCell } from './landmark-placement.js';
import type { Combatant } from '../types.js';
import { surfaceHeightAt } from './height-map.js';
import { clipRelationZone } from './force-deployment.js';
export interface SceneRegion {
    id: string;
    kind: string;
    label: string;
    cells: number[];
    access: number[];
    basis?: 'explicit' | 'inferred';
    sources?: string[];
}
export interface DeploymentZone {
    side: 'ally' | 'enemy';
    unitId?: string;
    cells: number[];
    landmarkId?: string;
    relation?: string;
    platform?: boolean;
}
export interface SceneRecord {
    version: 1;
    archetype?: SceneArchetype;
    regions: SceneRegion[];
    intent?: SceneIntent;
    unitBindings?: Record<string, string>;
    fulfilled: string[];
    objectiveRegion?: {
        id: string;
        relation: 'targets' | 'exits_at';
        side: 'ally' | 'enemy';
        unitId?: string;
    };
}
const directionRelations: Partial<Record<string, WorldAnchor>> = { north_of: 'north', south_of: 'south', east_of: 'east', west_of: 'west' };
export function entityAnchors(intent: SceneIntent): Map<string, WorldAnchor> {
    const anchors = new Map(intent.entities.filter(e => e.anchor).map(e => [e.id, e.anchor!]));
    for (const r of intent.relations)
        if (directionRelations[r.relation] && !anchors.has(r.subject))
            anchors.set(r.subject, directionRelations[r.relation]!);
    for (let pass = 0; pass < intent.entities.length; pass++)
        for (const r of intent.relations) {
            if (['inside', 'near', 'connected_to'].includes(r.relation) && !anchors.has(r.subject) && anchors.has(r.object))
                anchors.set(r.subject, anchors.get(r.object)!);
        }
    return anchors;
}
/** Translate narrative entities into the bounded existing construction vocabulary before generation. */
export function compileScenePlan(plan: BattlefieldPlan | undefined): BattlefieldPlan | undefined {
    if (!plan?.intent)
        return plan;
    const result = structuredClone(plan), intent = result.intent!, anchors = entityAnchors(intent);
    const cities = intent.entities.filter(e => e.kind === 'city'), rivers = intent.entities.filter(e => e.kind === 'river');
    if (cities.length > 1 || rivers.length > 1)
        throw new BattlefieldPlanError('本次战区最多一座城市和一条主河，请选择局部战区');
    if (intent.archetype)
        result.archetype = intent.archetype;
    if (cities[0])
        result.cityPosition = anchors.get(cities[0].id) ?? result.cityPosition ?? 'north';
    if (rivers[0]) {
        const riverAnchor = anchors.get(rivers[0].id) ?? 'center';
        if (result.water !== 'ford' && result.water !== 'moat') result.water = 'river';
        result.waterPosition = riverAnchor;
        result.waterAxis = riverAnchor.includes('east') || riverAnchor.includes('west') ? 'vertical' : result.waterAxis ?? 'horizontal';
    }
    const bridges = intent.entities.filter(e => e.kind === 'bridge'), gates = intent.entities.filter(e => e.kind === 'gate');
    if (rivers[0] && !plan.waterAxis && (anchors.get(rivers[0].id) ?? 'center') === 'center' && bridges.some(e => (anchors.get(e.id) ?? '').includes('north') || (anchors.get(e.id) ?? '').includes('south')))
        result.waterAxis = 'vertical';
    for (const constraint of intent.constraints) {
        const actual = constraint.kind === 'crossing_count' ? bridges.length : gates.length;
        if (actual && actual !== constraint.value)
            throw new BattlefieldPlanError(`正文${constraint.kind === 'crossing_count' ? '桥梁' : '城门'}数量与实体列表不一致`);
    }
    const crossing = intent.constraints.find(c => c.kind === 'crossing_count');
    if (bridges.length || crossing) {
        if (!rivers.length && (!result.water || result.water === 'none'))
            throw new BattlefieldPlanError('桥梁需要对应的真实水系');
        result.bridgePlan = Array.from({ length: crossing?.value ?? bridges.length }, (_, i) => {
            const bridge = bridges[i];
            return { id: bridge?.id ?? `bridge_${i + 1}`, anchor: bridge ? anchors.get(bridge.id) ?? 'center' : (['west', 'east', 'north', 'south'] as const)[i]!,
                state: bridge?.state === 'destroyed' ? 'destroyed' : 'intact', width: bridge?.width ?? 1 };
        });
    }
    const gateCount = intent.constraints.find(c => c.kind === 'gate_count');
    if (gates.length || gateCount)
        result.gatePlan = Array.from({ length: gateCount?.value ?? gates.length }, (_, i) => {
            const gate = gates[i], anchor = gate ? anchors.get(gate.id) : undefined;
            const sector: GatePlan['sector'] = anchor?.includes('east') ? 'east' : anchor?.includes('west') ? 'west' : anchor?.includes('north') ? 'north' : anchor?.includes('south') ? 'south' : (['front_center', 'front_left', 'front_right', 'rear'] as const)[i]!;
            return { ...(gate ? { id: gate.id } : {}), sector, state: gate?.state === 'open' ? 'open' : gate?.state === 'destroyed' ? 'destroyed' : 'closed' };
        });
    const marked = intent.entities.filter(e => !['city', 'river', 'gate', 'bridge'].includes(e.kind));
    // A place that is near another one and has no stated anchor is laid out beside it, on the stated side if any.
    const nearby = (e: SceneEntity): LandmarkPlan['near'] => {
        const near = e.anchor ? undefined : intent.relations.find(r => r.subject === e.id && r.relation === 'near' && intent.entities.some(x => x.id === r.object));
        const side = near && intent.relations.find(r => r.subject === e.id && r.object === near.object && directionRelations[r.relation]);
        return near && { id: near.object, ...(side ? { side: directionRelations[side.relation] as 'north' | 'south' | 'east' | 'west' } : {}) };
    };
    result.landmarks = marked.map(e => ({ id: e.id, kind: e.kind as LandmarkPlan['kind'], anchor: anchors.get(e.id) ?? 'center',
        scale: intent.relations.some(r => r.object === e.id && r.relation === 'exits_at') ? 'minor' : e.scale ?? 'minor', ...(e.state === 'destroyed' ? { state: 'destroyed' as const } : {}), ...(e.label ? { label: e.label } : {}), ...(e.height !== undefined ? { height: e.height } : {}), ...(intent.relations.some(r => r.object === e.id && r.relation === 'exits_at') ? { edge: true } : {}),
        ...(nearby(e) ? { near: nearby(e) } : {}) }));
    // Lay out a referenced landmark before the one placed beside it.
    for (let pass = 0; pass < result.landmarks.length; pass++) {
        const i = result.landmarks.findIndex((m, n) => m.near && result.landmarks!.findIndex(o => o.id === m.near!.id) > n);
        if (i < 0) break;
        result.landmarks.push(...result.landmarks.splice(i, 1));
    }
    return result;
}
export function sceneRegion(field: BattlefieldSpec, id: string): SceneRegion | undefined { return field.scene?.regions.find(r => r.id === id); }
function regionCenter(field: BattlefieldSpec, region: SceneRegion): [
    number,
    number
] {
    const cells = region.cells.length ? region.cells : region.access;
    return [cells.reduce((s, p) => s + p % field.width, 0) / Math.max(1, cells.length), cells.reduce((s, p) => s + Math.floor(p / field.width), 0) / Math.max(1, cells.length)];
}
function regionObservers(field: BattlefieldSpec, region: SceneRegion): Combatant[] {
    const platforms = region.cells.filter(p => intactStructure(field, p)?.top);
    return [...platforms.map(pos => ({ pos, elevation: 1, rulesVersion: 'v2' } as Combatant)),
        ...region.access.map(pos => ({ pos, rulesVersion: 'v2' } as Combatant))];
}
/** Regions point to actual terrain/structures. Labels never grant mechanics. */
export function finishSceneRegions(field: BattlefieldSpec, plan: BattlefieldPlan | undefined, unitBindings: Record<string, string> = {}, roster: readonly Combatant[] = []): void {
    field.scene ??= { version: 1, regions: [], fulfilled: [] };
    field.scene.archetype = plan?.archetype;
    field.scene.intent = plan?.intent;
    field.scene.unitBindings = { ...unitBindings };
    const intent = plan?.intent;
    const add = (entity: SceneEntity, cells: number[]) => {
        if (field.scene!.regions.some(r => r.id === entity.id))
            return;
        const access = [...new Set(cells.flatMap(p => groundBlocked(field, p) ? neighbors(field, p) : [p]))].filter(p => !groundBlocked(field, p));
        if (!cells.length)
            throw new BattlefieldPlanError(`正文地点${entity.label ?? entity.id}未能落实到实际战区`);
        const labels: Record<string, string> = { city: '城区', river: '水系', bridge: '渡河桥', gate: '城门', hill: '制高地', forest: '林地', square: '广场', tower: '塔楼', ruins: '废墟', fortification: '阵地', building: '建筑', room: '房间', cover: '掩体', position: '战术要点' };
        field.scene!.regions.push({ id: entity.id, kind: entity.kind, label: entity.label ?? labels[entity.kind]!, cells: [...new Set(cells)], access, basis: entity.basis, sources: entity.sources });
        if (['bridge', 'gate'].includes(entity.kind) && entity.label && field.landmarks!.length < 5)
            field.landmarks!.push({ id: entity.id, kind: entity.kind, label: entity.label, cells: [...new Set(cells)], scale: entity.scale ?? 'minor' });
    };
    if (intent)
        for (const e of intent.entities) {
            if (e.kind === 'city')
                add(e, field.city ? [...field.city.inside, ...field.city.frontline] : []);
            else if (e.kind === 'river')
                add(e, field.tiles.flatMap((t, p) => ['deep_water', 'shallow_water'].includes(t) ? [p] : []));
            else if (e.kind === 'gate') {
                const bound = field.structures?.findIndex(s => s?.kind === 'gate' && s.entityId === e.id) ?? -1;
                if (bound >= 0) {
                    add(e, [bound]);
                    continue;
                }
                const unused = (field.city?.gates ?? field.structures?.flatMap((s, p) => s?.kind === 'gate' ? [p] : []) ?? []).filter(p => !field.scene!.regions.some(r => r.kind === 'gate' && r.cells.includes(p)));
                const desired = worldAnchorCell(field, entityAnchors(intent).get(e.id) ?? 'center');
                const p = unused.sort((a, b) => gridDistance(field, a, desired) - gridDistance(field, b, desired) || a - b)[0];
                add(e, p === undefined ? [] : [p]);
            }
            else if (e.kind === 'bridge')
                add(e, field.structures?.flatMap((s, p) => s?.entityId === e.id ? [p] : []) ?? []);
            else
                add(e, field.landmarks?.find(m => m.id === e.id)?.cells ?? []);
        }
    for (const mark of field.landmarks ?? [])
        if (!field.scene.regions.some(r => r.id === mark.id)) {
            const id = mark.id ?? `landmark_${field.scene.regions.length + 1}`;
            field.scene.regions.push({ id, kind: mark.kind, label: mark.label, cells: [...mark.cells], access: [...new Set(mark.cells.flatMap(p => groundBlocked(field, p) ? neighbors(field, p) : [p]))].filter(p => !groundBlocked(field, p)) });
        }
    for (const r of intent?.relations ?? []) {
        if (!['ally', 'enemy'].includes(r.subject) && !unitBindings[r.subject])
            continue;
        if (r.relation === 'targets' || r.relation === 'exits_at') {
            const unitId = unitBindings[r.subject], side = unitId ? roster.find(u => u.id === unitId)?.side : r.subject;
            if (side !== 'ally' && side !== 'enemy')
                throw new BattlefieldPlanError('任务地点引用了非法部队');
            if (field.scene.objectiveRegion && field.scene.objectiveRegion.id !== r.object)
                throw new BattlefieldPlanError('本场只支持一个任务目标区域');
            field.scene.objectiveRegion = { id: r.object, relation: r.relation, side, ...(unitId ? { unitId } : {}) };
            continue;
        }
        if (!['guards', 'occupies', 'approaches_from', 'inside', 'near'].includes(r.relation))
            throw new BattlefieldPlanError('部队关系须为驻守、占据或接近地点');
        const region = sceneRegion(field, r.object)!;
        const unitId = unitBindings[r.subject], side = unitId ? undefined : r.subject as 'ally' | 'enemy';
        // Each cell holds two ordinary units or one large unit.
        const actors = roster.filter(u => unitId ? u.id === unitId : u.side === side), large = actors.filter(u => u.body && u.body !== 'human' || u.mount).length;
        const required = large + Math.ceil((actors.length - large) / 2);
        const distance = (p: number) => Math.min(...region.cells.map(q => gridDistance(field, p, q)));
        const holds = r.relation === 'occupies' || r.relation === 'inside';
        let cells = [...region.access], platform = holds && region.cells.every(p => intactStructure(field, p)?.top);
        if (platform)
            cells = [...region.cells];
        else if (holds) {
            // A solid building or gate is held from its doorways rather than from inside its wall cells.
            const walkable = region.cells.filter(p => !groundBlocked(field, p));
            cells = walkable.length ? walkable : [...region.access];
        }
        if (holds && cells.length < required) {
            // A small place cannot hold the whole force: the rest hold the nearest ground around it.
            platform = false;
            const ground = field.tiles.map((_, p) => p).filter(p => !groundBlocked(field, p)).sort((a, b) => distance(a) - distance(b) || a - b);
            const radius = ground.length ? distance(ground[Math.min(required - 1, ground.length - 1)]!) : 0;
            cells = [...new Set([...cells.filter(p => !groundBlocked(field, p)), ...ground.filter(p => distance(p) <= radius)])];
            field.generation!.notes = [...(field.generation!.notes ?? []), `为部署完整部队，${region.label}占据范围延伸至${radius}格`];
        }
        if (!holds) {
            cells = field.tiles.map((_, p) => p).filter(p => !groundBlocked(field, p));
            if (field.city?.defender && side && side !== field.city.defender && region.kind === 'gate')
                cells = cells.filter(p => !field.city!.inside.includes(p));
            if (r.relation === 'guards') {
                const reachable = gridCostsToGoals(field, region.access, n => !groundBlocked(field, n));
                cells = cells.filter(p => reachable.has(p));
            }
        }
        if (r.region) {
            const [x, y] = regionCenter(field, region);
            cells = cells.filter(p => r.region === 'north_bank' ? Math.floor(p / field.width) < y : r.region === 'south_bank' ? Math.floor(p / field.width) > y : r.region === 'east_bank' ? p % field.width > x : p % field.width < x);
        }
        let extended: string | undefined;
        if (!holds) {
            const baseRadius = r.relation === 'approaches_from' ? 3 : 2;
            const ranked = [...cells].sort((a, b) => distance(a) - distance(b) || a - b);
            const radius = Math.max(baseRadius, required ? distance(ranked[Math.min(required - 1, ranked.length - 1)] ?? ranked[0] ?? 0) : baseRadius);
            cells = cells.filter(p => distance(p) <= radius);
            if (radius > baseRadius)
                extended = `为部署完整部队，${region.label}防区延伸至${radius}格`;
        }
        const zoneSide = side ?? roster.find(u => u.id === unitId)?.side;
        if (zoneSide !== 'ally' && zoneSide !== 'enemy')
            throw new BattlefieldPlanError('指定正文部队没有合法阵营');
        // Siege roles outrank the relation's wording: attackers start outside the walls, defenders of the city inside.
        const clipped = clipRelationZone(field, zoneSide, unitId, r.relation, region, cells, required);
        if (clipped.cells !== cells)
            platform = platform && clipped.cells.every(p => region.cells.includes(p));
        cells = clipped.cells;
        const note = clipped.note ?? extended;
        if (note)
            field.generation!.notes = [...(field.generation!.notes ?? []), note];
        if (!cells.length)
            throw new BattlefieldPlanError(`地点${region.label}没有符合正文关系的部署位置`);
        field.deploymentZones ??= [];
        field.deploymentZones.push({ side: zoneSide, ...(unitId ? { unitId } : {}), cells, landmarkId: r.object, relation: r.relation, ...(platform ? { platform: true } : {}) });
    }
}
export function deriveRetreatEdges(field: BattlefieldSpec): void {
    if (!field.deploymentZones?.length)
        return;
    field.retreatEdges = {};
    for (const side of ['ally', 'enemy'] as const) {
        const cells = field.deploymentZones.filter(z => z.side === side).flatMap(z => z.cells);
        if (!cells.length)
            continue;
        const x = cells.reduce((n, p) => n + p % field.width, 0) / cells.length, y = cells.reduce((n, p) => n + Math.floor(p / field.width), 0) / cells.length;
        const nearest = [{ d: x, axis: 'west' }, { d: field.width - 1 - x, axis: 'east' }, { d: y, axis: 'north' }, { d: field.height - 1 - y, axis: 'south' }].sort((a, b) => a.d - b.d)[0]!.axis;
        field.retreatEdges[side] = Array.from({ length: nearest === 'west' || nearest === 'east' ? field.height : field.width }, (_, n) => nearest === 'west' ? n * field.width : nearest === 'east' ? n * field.width + field.width - 1 : nearest === 'north' ? n : (field.height - 1) * field.width + n);
    }
}
export function validateSceneFacts(field: BattlefieldSpec, units: readonly Combatant[] = []): void {
    const intent = field.scene?.intent;
    if (!intent)
        return;
    const fulfilled: string[] = [];
    for (const e of intent.entities) if (e.state === 'destroyed' || e.state === 'intact') {
        const region=sceneRegion(field,e.id);
        const structures=region?.cells.map(p=>field.structures?.[p]).filter(s=>!!s)??[];
        if (structures.some(s=>e.state==='destroyed'?s!.hp>0:s!.hp<=0)) throw new BattlefieldPlanError(`地点${region!.label}没有保留正文指定状态${e.state}`);
    }
    for (const e of intent.entities)
        if (e.height !== undefined && e.basis === 'explicit') {
            const region = sceneRegion(field, e.id);
            if (region?.cells.some(p => field.groundHeight?.[p] !== e.height))
                throw new BattlefieldPlanError(`地点${region.label}没有保留正文指定高度`);
        }
    for (const e of intent.entities)
        if (e.anchor && e.basis === 'explicit') {
            const actual = sceneRegion(field, e.id);
            if (!actual)
                continue;
            const [x, y] = regionCenter(field, actual);
            const center: [
                number,
                number
            ] = e.kind === 'gate' && field.city ? regionCenter(field, { id: 'city', kind: 'city', label: '城区', cells: field.city.inside, access: [] }) : [(field.width - 1) / 2, (field.height - 1) / 2];
            const [cx, cy] = center;
            if (e.anchor.includes('west') && x >= cx || e.anchor.includes('east') && x <= cx || e.anchor.includes('north') && y >= cy || e.anchor.includes('south') && y <= cy)
                throw new BattlefieldPlanError(`地点${actual.label}未落在正文指定的${e.anchor}区域`);
        }
    for (const r of intent.relations) {
        const a = sceneRegion(field, r.subject), b = sceneRegion(field, r.object)!;
        if (!b)
            throw new BattlefieldPlanError(`正文关系引用的地点${r.object}没有生成`);
        let ok = true;
        if (a) {
            const [ax, ay] = regionCenter(field, a), [bx, by] = regionCenter(field, b);
            if (r.relation === 'north_of')
                ok = ay < by;
            else if (r.relation === 'south_of')
                ok = ay > by;
            else if (r.relation === 'east_of')
                ok = ax > bx;
            else if (r.relation === 'west_of')
                ok = ax < bx;
            else if (r.relation === 'inside')
                ok = a.cells.every(p => b.cells.includes(p));
            else if (r.relation === 'near')
                ok = a.cells.some(p => b.cells.some(q => gridDistance(field, p, q) <= 3));
            else if (r.relation === 'crosses')
                ok = a.kind === 'bridge' && a.cells.some(p => b.cells.includes(p));
            else if (r.relation === 'higher_than') {
                const height = (region: SceneRegion) => Math.max(...region.cells.map(pos => surfaceHeightAt(field, pos, intactStructure(field, pos)?.top ? { pos, elevation: 1 } as Combatant : undefined)));
                ok = height(a) > height(b);
            }
            else if (r.relation === 'overlooks')
                ok = regionObservers(field, a).some(observer => regionObservers(field, b).some(target => unitLineOfSight(field, observer, target)));
            else if (r.relation === 'connected_to')
                ok = a.access.some(p => b.access.some(q => !!findGridPath(field, p, q, n => !groundBlocked(field, n))));
            else
                ok = false;
        }
        else if (units.length && !['targets', 'exits_at'].includes(r.relation)) {
            const id = field.scene?.unitBindings?.[r.subject];
            const side = units.filter(u => id ? u.id === id : u.side === r.subject);
            // A unit with its own relation deploys in its own zone (gridDeploymentCells), not the side's.
            const actors = id ? side : side.filter(u => !field.deploymentZones?.some(z => z.unitId === u.id));
            const zones = field.deploymentZones?.filter(z => z.landmarkId === r.object && (id ? z.unitId === id : !z.unitId && z.side === r.subject)) ?? [];
            ok = side.length > 0 && actors.every(u => u.pos !== undefined && zones.some(z => z.cells.includes(u.pos!) && (!z.platform || u.elevation === 1)));
        }
        if (!ok && r.basis === 'explicit')
            throw new BattlefieldPlanError(`无法满足正文关系：${r.subject} ${r.relation} ${r.object}`);
        const relations: Record<string, string> = { near: '靠近', inside: '位于内部', north_of: '位于北侧', south_of: '位于南侧', east_of: '位于东侧', west_of: '位于西侧', higher_than: '高于', overlooks: '可俯瞰', crosses: '跨越', connected_to: '连通', guards: '驻守', occupies: '占据', approaches_from: '从此接近', targets: '任务目标', exits_at: '撤出地点' };
        if (ok)
            fulfilled.push(`${a?.label ?? (r.subject === 'ally' ? '我方' : r.subject === 'enemy' ? '敌方' : r.subject)} · ${relations[r.relation]} · ${b.label}`);
    }
    for (const c of intent.constraints) {
        const count = c.kind === 'crossing_count' ? new Set(field.structures?.filter(s => s?.kind === 'bridge').map(s => s!.entityId)).size : field.city?.gates.length ?? 0;
        if (count !== c.value)
            throw new BattlefieldPlanError(`正文要求${c.value}${c.kind === 'crossing_count' ? '座桥' : '处城门'}，实际生成${count}`);
        fulfilled.push(`${c.kind === 'crossing_count' ? '桥梁' : '城门'}数量 ${count}`);
    }
    field.scene!.fulfilled = fulfilled;
}
export function sceneSummary(field: BattlefieldSpec): string {
    const name = field.scene?.archetype ? SCENE_ARCHETYPE_NAMES[field.scene.archetype] : '';
    return [name, ...field.scene?.fulfilled ?? []].filter(Boolean).join('；');
}
export function validateSceneRecord(field: BattlefieldSpec): void {
    const legal = (p: unknown) => Number.isInteger(p) && Number(p) >= 0 && Number(p) < field.tiles.length;
    const cellList = (v: unknown) => Array.isArray(v) && v.length <= field.tiles.length && v.every(legal) && new Set(v).size === v.length;
    if (field.deploymentZones !== undefined && (!Array.isArray(field.deploymentZones) || field.deploymentZones.length > 26
        || field.deploymentZones.some(z => !z || !['ally', 'enemy'].includes(z.side) || !cellList(z.cells) || !z.cells.length
            || z.unitId !== undefined && (typeof z.unitId !== 'string' || z.unitId.length > 200) || z.platform !== undefined && typeof z.platform !== 'boolean')))
        throw Error('场景部署区损坏');
    if (field.retreatEdges !== undefined && (!field.retreatEdges || typeof field.retreatEdges !== 'object' || Object.entries(field.retreatEdges).some(([side, cells]) => !['ally', 'enemy'].includes(side) || !cellList(cells)
        || (cells as number[]).some(p => p % field.width !== 0 && p % field.width !== field.width - 1 && Math.floor(p / field.width) !== 0 && Math.floor(p / field.width) !== field.height - 1))))
        throw Error('撤离边缘损坏');
    if (field.initialDeployment !== undefined && (!field.initialDeployment || typeof field.initialDeployment !== 'object' || Array.isArray(field.initialDeployment)
        || Object.entries(field.initialDeployment).length > 32 || Object.values(field.initialDeployment).some(p => !p || !legal(p.pos) || p.elevation !== undefined && p.elevation !== 1 || p.airborne !== undefined && typeof p.airborne !== 'boolean')))
        throw Error('初始部署记录损坏');
    if (!field.scene)
        return;
    if (field.scene.archetype !== undefined && !(SCENE_ARCHETYPES as readonly unknown[]).includes(field.scene.archetype))
        throw Error('场景原型记录损坏');
    if (field.scene.unitBindings !== undefined && (!field.scene.unitBindings || typeof field.scene.unitBindings !== 'object' || Array.isArray(field.scene.unitBindings)
        || Object.entries(field.scene.unitBindings).length > 32 || Object.entries(field.scene.unitBindings).some(([id, value]) => !/^u\d+$/.test(id) || typeof value !== 'string' || value.length > 200)))
        throw Error('正文单位映射损坏');
    if (field.scene.intent !== undefined)
        normalizeSceneIntent(field.scene.intent);
    if (field.scene.version !== 1 || !Array.isArray(field.scene.regions) || field.scene.regions.length > 20
        || field.scene.regions.some(r => !r || typeof r.id !== 'string' || r.id.length > 64 || typeof r.kind !== 'string' || typeof r.label !== 'string' || r.label.length > 64
            || !cellList(r.cells) || !r.cells.length || !cellList(r.access)) || new Set(field.scene.regions.map(r => r.id)).size !== field.scene.regions.length
        || !Array.isArray(field.scene.fulfilled) || field.scene.fulfilled.length > 32 || field.scene.fulfilled.some(s => typeof s !== 'string' || s.length > 200))
        throw Error('场景区域记录损坏');
    const objective = field.scene.objectiveRegion;
    if (objective !== undefined && (!objective || !['targets', 'exits_at'].includes(objective.relation)
        || !['ally', 'enemy'].includes(objective.side) || !field.scene.regions.some(r => r.id === objective.id)
        || objective.unitId !== undefined && (typeof objective.unitId !== 'string' || objective.unitId.length > 200)))
        throw Error('正文任务区域记录损坏');
}
