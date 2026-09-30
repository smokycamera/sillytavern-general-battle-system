import { SeededRng } from '../rng.js';
import { BattlefieldPlanError, type BattlefieldPlan, type GatePlan } from './battlefield-plan.js';
import { createStructure, groundBlocked } from './layers.js';
import { buildRouteGraph } from './route-graph.js';
import { carveInitialBreaches } from './city-breaches.js';
import { gridDistance, neighbors, findGridPath, type BattlefieldSpec } from './spatial.js';
import { worldAnchorCell } from './landmark-placement.js';
import { SCENE_ARCHETYPE_NAMES, type SceneArchetype, type WorldAnchor } from './scene-intent.js';
import type { BattlefieldScene } from './map-design.js';
export function selectSceneArchetype(scene: BattlefieldScene, family: string, seed: string): SceneArchetype {
    const rng = new SeededRng('scene-archetype-v1:' + seed);
    const pool: SceneArchetype[] = scene === 'interior' ? ['residence', 'great_hall', 'fortress'] : scene === 'trenches' ? ['trench_line', 'trench_depth']
        : scene === 'building_siege' ? ['warehouse', 'fortress'] : scene === 'city_siege' ? ['gate_front', 'riverside', 'hilltown']
            : scene === 'city_streets' ? ['old_town', 'market', 'warehouse', 'riverside']
                : family === 'forest' ? ['forest_path', 'forest_stream', 'forest_edge'] : family === 'mountain' ? ['mountain_pass', 'ridge_valley', 'terraces']
                    : ['farmland', 'river_crossing', 'rolling_hills'];
    return pool[Math.floor(rng.next() * pool.length)]!;
}
function bounds(field: BattlefieldSpec, position: WorldAnchor, outside: boolean): [
    number,
    number,
    number,
    number
] {
    const { width: w, height: h } = field;
    let l = 1, r = w - 2, t = 1, b = h - 2;
    if (position.includes('west'))
        r = Math.max(4, Math.floor(w * (outside ? .38 : .56)));
    if (position.includes('east'))
        l = Math.min(w - 5, Math.floor(w * (outside ? .62 : .44)));
    if (position.includes('north'))
        b = Math.max(5, Math.floor(h * (outside ? .33 : .56)));
    if (position.includes('south'))
        t = Math.min(h - 6, Math.floor(h * (outside ? .67 : .44)));
    if (position === 'center') {
        l = Math.max(1, Math.floor(w * .18));
        r = w - 1 - l;
        t = Math.max(2, Math.floor(h * .25));
        b = h - 1 - t;
    }
    return [l, r, t, b];
}
function gateTarget(field: BattlefieldSpec, gate: GatePlan, frontage: number[], perimeter: number[]): number {
    if (['north', 'south', 'east', 'west'].includes(gate.sector))
        return worldAnchorCell(field, gate.sector as WorldAnchor);
    const ordered = [...frontage].sort((a, b) => a - b);
    if (gate.sector === 'front_left' || gate.sector === 'left')
        return ordered[0]!;
    if (gate.sector === 'front_right' || gate.sector === 'right')
        return ordered.at(-1)!;
    if (gate.sector === 'rear')
        return perimeter.reduce((best, p) => Math.min(...frontage.map(f => gridDistance(field, p, f))) > Math.min(...frontage.map(f => gridDistance(field, best, f))) ? p : best, perimeter[0]!);
    return ordered[Math.floor(ordered.length / 2)]!;
}
/** A city footprint is a region in the battlefield, independent of which faction attacks. */
export function buildPlannedCity(field: BattlefieldSpec, plan: BattlefieldPlan, seed: string, scene: BattlefieldScene, attackingSide: 'ally' | 'enemy'): void {
    const rng = new SeededRng('city-parcels-v2:' + seed), w = field.width, h = field.height, defender = attackingSide === 'ally' ? 'enemy' : 'ally';
    const siege = scene === 'city_siege', outside = scene === 'field', position = plan.cityPosition ?? (defender === 'enemy' ? 'north' : 'south');
    let [l, r, t, b] = bounds(field, position, outside);
    if (plan.intent?.entities.some(e => e.kind === 'river') || plan.waterPosition) {
        const water = plan.waterPosition ?? 'center';
        if (water.includes('east'))
            r = Math.min(r, w - 7);
        if (water.includes('west'))
            l = Math.max(l, 6);
        if (water.includes('north'))
            t = Math.max(t, 6);
        if (water.includes('south'))
            b = Math.min(b, h - 7);
    }
    if (r - l < 3 || b - t < 3)
        throw new BattlefieldPlanError('城市与水岸部署容量不足，请扩大战区');
    const kind = plan.archetype ?? 'old_town', level = plan.fortLevel ?? 3;
    const facing: 'north' | 'south' | 'east' | 'west' = position.includes('west') ? 'east' : position.includes('east') ? 'west' : position.includes('south') ? 'north' : 'south';
    field.structures!.forEach((s, p) => { if (s?.kind === 'building') {
        field.structures![p] = null;
        if (field.tiles[p] === 'street')
            field.tiles[p] = 'open';
    } });
    const at = (x: number, y: number) => y * w + x, all: number[] = [], inside: number[] = [], perimeter: number[] = [], frontage: number[] = [];
    for (let y = t; y <= b; y++)
        for (let x = l; x <= r; x++) {
            const p = at(x, y), edge = x === l || x === r || y === t || y === b;
            all.push(p);
            field.tiles[p] = 'street';
            field.structures![p] = null;
            delete field.overlays![p];
            if (edge)
                perimeter.push(p);
            else
                inside.push(p);
            if (facing === 'east' && x === r || facing === 'west' && x === l || facing === 'north' && y === t || facing === 'south' && y === b)
                frontage.push(p);
        }
    const fortified = siege || outside && (plan.gatePlan !== undefined || plan.shape !== undefined);
    const shape = plan.shape ?? (position === 'center' ? 'enclosure' : 'front'), wallCells = fortified ? (shape === 'front' ? frontage : perimeter) : [];
    const coreCell = at(Math.floor((l + r) / 2), Math.floor((t + b) / 2)), core = [coreCell, ...neighbors(field, coreCell)].filter(p => inside.includes(p));
    const roads = new Set(core), scratch: BattlefieldSpec = { version: 2, width: r - l - 1, height: b - t - 1, tiles: Array((r - l - 1) * (b - t - 1)).fill('street'), objective: { kind: 'annihilation', cell: 0, limit: 60 } };
    const graph = buildRouteGraph(scratch, rng, { ...field.generation!.design, ...(plan.topology ? { topology: plan.topology } : {}) });
    const project = (p: number) => at(l + 1 + p % scratch.width, t + 1 + Math.floor(p / scratch.width));
    field.generation!.routes = { ...graph, nodes: graph.nodes.map(n => ({ ...n, cell: project(n.cell) })), edges: graph.edges.map(e => ({ ...e, cells: e.cells.map(project) })) };
    for (const e of graph.edges)
        for (const p of e.cells)
            roads.add(project(p));
    const frontCenter = gateTarget(field, { sector: 'front_center', state: 'closed' }, frontage, perimeter);
    const approach = findGridPath(field, frontCenter, coreCell, p => all.includes(p), () => 1);
    for (const p of approach?.cells ?? [])
        roads.add(p);
    if (kind === 'market')
        for (const p of inside)
            if (gridDistance(field, p, coreCell) <= 2)
                roads.add(p);
    const parcels = new Set<number>(), density = { sparse: .35, balanced: .65, dense: .85 }[plan.obstacles ?? plan.density ?? 'balanced'];
    for (let y = t + 1; y < b; y++)
        for (let x = l + 1; x < r; x++) {
            const p = at(x, y);
            if (roads.has(p) || parcels.has(p))
                continue;
            const cells = [p], maxW = kind === 'warehouse' ? 3 : kind === 'old_town' ? 1 : 2, maxH = kind === 'warehouse' ? 3 : 2;
            for (let dy = 0; dy < maxH && y + dy < b; dy++)
                for (let dx = 0; dx < maxW && x + dx < r; dx++) {
                    const q = at(x + dx, y + dy);
                    if (!roads.has(q) && !parcels.has(q) && !cells.includes(q))
                        cells.push(q);
                }
            cells.forEach(q => parcels.add(q));
            if (cells.length >= 2 && rng.next() < density)
                for (const q of cells)
                    field.structures![q] = createStructure('building', level, { entityId: `parcel_${p}` });
            else if (kind === 'market')
                for (const q of cells.slice(0, 1))
                    field.structures![q] = createStructure('cover', level);
            else if (rng.next() < .25)
                for (const q of cells)
                    field.overlays![q] = ['rubble'];
        }
    for (const p of wallCells)
        field.structures![p] = createStructure('wall', level, { owner: defender, top: true });
    const specs = plan.gatePlan ?? (plan.gates === 'none' ? [] : plan.gates === 'double' || plan.gates === 'side' ? [{ sector: 'front_left', state: plan.gateState ?? 'closed' }, { sector: 'front_right', state: plan.gateState ?? 'closed' }] : [{ sector: 'front_center', state: plan.gateState ?? 'closed' }]) as GatePlan[];
    const gates: number[] = [];
    if (fortified)
        for (const spec of specs) {
            const desired = gateTarget(field, spec, frontage, perimeter), candidates = wallCells.filter(p => !gates.includes(p) && neighbors(field, p).some(q => inside.includes(q)) && neighbors(field, p).some(q => !all.includes(q)));
            const p = candidates.sort((a, b) => gridDistance(field, a, desired) - gridDistance(field, b, desired) || a - b)[0];
            if (p === undefined)
                throw new BattlefieldPlanError('城门部署容量不足，无法保留请求数量');
            const gate = createStructure('gate', level, { owner: defender, top: true, gateState: spec.state, ...(spec.id ? { entityId: spec.id } : {}) });
            if (spec.state === 'destroyed') {
                gate.hp = 0;
                field.overlays![p] = ['rubble'];
            }
            field.structures![p] = gate;
            gates.push(p);
            for (const q of neighbors(field, p))
                if (field.structures![q]?.kind === 'building')
                    field.structures![q] = null;
            const path = findGridPath(field, p, coreCell, q => all.includes(q) && (!wallCells.includes(q) || q === p), q => field.structures![q]?.kind === 'building' ? 100 : 1);
            for (const q of path?.cells ?? []) {
                if (field.structures![q]?.kind === 'building')
                    field.structures![q] = null;
                roads.add(q);
            }
            const outer = neighbors(field, p).find(q => !all.includes(q));
            if (outer !== undefined) {
                const edge = facing === 'east' ? Math.floor(outer / w) * w + w - 1 : facing === 'west' ? Math.floor(outer / w) * w : facing === 'north' ? outer % w : (h - 1) * w + outer % w;
                const path = findGridPath(field, outer, edge, q => !all.includes(q), () => 1);
                for (const q of path?.cells ?? []) {
                    if (field.structures![q]?.kind === 'building')
                        field.structures![q] = null;
                    field.overlays![q] = ['road'];
                }
            }
        }
    for (const p of wallCells)
        field.structures![p]!.access = neighbors(field, p).filter(q => inside.includes(q) && !groundBlocked(field, q));
    for (const p of roads)
        if (!field.structures![p])
            field.overlays![p] = ['road'];
    // Preserve parcels while connecting all usable courtyards to the main street.
    for (const p of inside.filter(p => !groundBlocked(field, p)))
        if (!findGridPath(field, p, coreCell, q => inside.includes(q) && !groundBlocked(field, q))) {
            const path = findGridPath(field, p, coreCell, q => inside.includes(q), q => field.structures![q]?.kind === 'building' ? 100 : 1);
            for (const q of path?.cells ?? [])
                if (field.structures![q]?.kind === 'building') {
                    field.structures![q] = null;
                    field.overlays![q] = ['road'];
                }
        }
    const reserve = inside.filter(p => !groundBlocked(field, p) && !core.includes(p) && gridDistance(field, p, coreCell) <= 3);
    field.city = { shape: siege ? shape : 'district', inside: siege ? inside : all, frontline: wallCells, gates, core, reserve: reserve.slice(0, Math.max(2, w)), facing, frontage, ...(siege ? { defender } : {}) };
    if (siege) {
        const breaches = carveInitialBreaches(field, wallCells, inside, plan.breaches ?? { count: 0 }, defender, rng);
        field.city.breaches = breaches.groups;
        field.generation!.notes = [...(field.generation!.notes ?? []), ...breaches.notes];
    }
    field.objective = siege ? { kind: 'control', cell: coreCell, cells: core, attackingSide, rounds: 2, limit: field.objective.limit } : { kind: 'annihilation', cell: outside ? field.objective.cell : coreCell, limit: field.objective.limit };
    if (siege) {
        const attackers = field.tiles.map((_, p) => p).filter(p => !all.includes(p) && !groundBlocked(field, p) && (facing === 'east' ? p % w >= w - 3 : facing === 'west' ? p % w <= 2 : facing === 'north' ? Math.floor(p / w) <= 2 : Math.floor(p / w) >= h - 3));
        field.deploymentZones = [{ side: defender, cells: inside.filter(p => !groundBlocked(field, p)) }, { side: attackingSide, cells: attackers }];
    }
}
/** Build a continuous water boundary and exactly the declared logical bridge entities. */
export function buildPlannedWater(field: BattlefieldSpec, plan: BattlefieldPlan, seed: string): void {
    if (!plan.water || plan.water === 'none')
        return;
    if (field.generation?.scene === 'interior')
        throw new BattlefieldPlanError('室内场景不能铺设室外河流');
    const w = field.width, h = field.height, axis = plan.waterAxis ?? 'horizontal', anchor = plan.waterPosition ?? 'center';
    const cityCells = field.city ? [...field.city.inside, ...field.city.frontline] : [];
    let line = axis === 'horizontal' ? Math.floor(worldAnchorCell(field, anchor) / w) : worldAnchorCell(field, anchor) % w;
    if (cityCells.length && (plan.intent?.entities.some(e => e.kind === 'river') || plan.waterPosition)) {
        if (axis === 'vertical' && anchor.includes('east'))
            line = Math.min(w - 2, Math.max(...cityCells.map(p => p % w)) + 3);
        if (axis === 'vertical' && anchor.includes('west'))
            line = Math.max(1, Math.min(...cityCells.map(p => p % w)) - 3);
        if (axis === 'horizontal' && anchor.includes('north'))
            line = Math.max(1, Math.min(...cityCells.map(p => Math.floor(p / w))) - 3);
        if (axis === 'horizontal' && anchor.includes('south'))
            line = Math.min(h - 2, Math.max(...cityCells.map(p => Math.floor(p / w))) + 3);
    }
    const cells = Array.from({ length: axis === 'horizontal' ? w : h }, (_, i) => axis === 'horizontal' ? line * w + i : i * w + line);
    if (cells.some(p => field.city?.frontline.includes(p)))
        throw new BattlefieldPlanError('河流与完整城墙重叠，请调整城市或河流方位');
    const target = field.objective.cell;
    for (const p of cells) {
        field.tiles[p] = plan.water === 'ford' ? 'shallow_water' : 'deep_water';
        field.structures![p] = null;
        delete field.overlays![p];
    }
    if (cells.includes(target)) {
        const replacement = neighbors(field, target).filter(p => !cells.includes(p) && !groundBlocked(field, p)).sort((a, b) => a - b)[0];
        if (replacement === undefined)
            throw new BattlefieldPlanError('水域覆盖任务目标且没有合法岸上目标');
        field.objective.cell = replacement;
        if (field.objective.kind === 'control')
            field.objective.cells = (field.objective.cells ?? [target]).filter(p => !cells.includes(p));
        if (field.objective.kind === 'control' && !field.objective.cells!.includes(replacement))
            field.objective.cells!.push(replacement);
        if (field.city)
            field.city.core = field.city.core.filter(p => !cells.includes(p));
    }
    const specs = plan.bridgePlan ?? (plan.water === 'ford' ? [] : [{ anchor: axis === 'horizontal' ? 'west' : 'north', state: 'intact', width: 1 }, { anchor: axis === 'horizontal' ? 'east' : 'south', state: 'intact', width: 1 }]) as NonNullable<BattlefieldPlan['bridgePlan']>;
    const used = new Set<number>();
    for (const [i, spec] of specs.entries()) {
        const desired = worldAnchorCell(field, spec.anchor), width = spec.width ?? 1;
        const options = cells.filter(p => !used.has(p)).sort((a, b) => gridDistance(field, a, desired) - gridDistance(field, b, desired) || a - b);
        let crossing: number[] | undefined;
        for (const p of options) {
            const run = Array.from({ length: width }, (_, n) => p + (axis === 'horizontal' ? n : n * w));
            if (run.some(q => !cells.includes(q) || used.has(q)))
                continue;
            if (run.some(q => [q - (axis === 'horizontal' ? w : 1), q + (axis === 'horizontal' ? w : 1)].some(n => n < 0 || n >= field.tiles.length || field.city?.frontline.includes(n))))
                continue;
            if (run.some(q => [...used].some(n => gridDistance(field, n, q) <= 1)))
                continue;
            crossing = run;
            break;
        }
        if (!crossing)
            throw new BattlefieldPlanError('桥梁部署容量不足，无法保留数量、宽度和位置');
        const id = spec.id ?? `bridge_${i + 1}`;
        for (const p of crossing) {
            used.add(p);
            const bridge = createStructure('bridge', plan.fortLevel ?? 3, { entityId: id });
            if (spec.state === 'destroyed')
                bridge.hp = 0;
            field.structures![p] = bridge;
            field.overlays![p] = spec.state === 'destroyed' ? ['rubble'] : ['road'];
            for (const q of [p - (axis === 'horizontal' ? w : 1), p + (axis === 'horizontal' ? w : 1)]) {
                if (field.structures![q]?.kind === 'building')
                    field.structures![q] = null;
                if (field.tiles[q] === 'cliff')
                    field.tiles[q] = 'rough';
                if (!groundBlocked(field, q))
                    field.overlays![q] = ['road'];
            }
        }
    }
    // Join each bank entrance to its own side's public road network without adding crossings.
    for (const p of used)
        for (const q of [p - (axis === 'horizontal' ? w : 1), p + (axis === 'horizontal' ? w : 1)]) {
            const bank = q < p ? -1 : 1;
            const edge = axis === 'horizontal' ? (bank < 0 ? q % w : (h - 1) * w + q % w) : (bank < 0 ? Math.floor(q / w) * w : Math.floor(q / w) * w + w - 1);
            const path = findGridPath(field, q, edge, n => !cells.includes(n) && !field.city?.frontline.includes(n), n => groundBlocked(field, n) ? 100 : 1);
            for (const n of path?.cells ?? [])
                if (!field.city?.frontline.includes(n)) {
                    if (field.structures![n]?.kind === 'building')
                        field.structures![n] = null;
                    if (field.tiles[n] === 'cliff')
                        field.tiles[n] = 'rough';
                    if (!groundBlocked(field, n))
                        field.overlays![n] = ['road'];
                }
        }
    field.generation!.notes = [...(field.generation!.notes ?? []), `水系${axis === 'horizontal' ? '横向' : '纵向'}布置，${specs.length}座桥`];
}
export function applySceneArchetype(field: BattlefieldSpec, archetype: SceneArchetype, seed: string): void {
    const w = field.width, h = field.height, rng = new SeededRng('scene-detail-v1:' + seed);
    if (field.city) {
        const outside = field.tiles.map((_, p) => p).filter(p => !field.city!.inside.includes(p) && !field.city!.frontline.includes(p));
        for (const p of outside)
            if (!field.structures![p] && !['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[p]!) && !field.overlays![p]?.includes('road')) {
                if (archetype === 'riverside' && rng.next() < .1)
                    field.tiles[p] = 'forest';
                else if (archetype === 'hilltown' && p % w <= 1)
                    field.tiles[p] = 'hill';
                else if ((archetype === 'gate_front' || archetype === 'outskirts') && Math.floor(p / w) % 4 === 0 && rng.next() < .65)
                    field.tiles[p] = 'rough';
            }
    }
    else if (['farmland', 'forest_path', 'forest_edge', 'mountain_pass', 'ridge_valley', 'terraces', 'rolling_hills'].includes(archetype)) {
        for (let y = 3; y < h - 3; y++)
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                if (field.structures![p] || p === field.objective.cell || ['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[p]!))
                    continue;
                if (archetype === 'farmland' && y % 4 === 0 && x !== Math.floor(w / 2))
                    field.tiles[p] = 'rough';
                if (archetype === 'forest_path') {
                    if (Math.abs(x - Math.floor(w / 2)) <= 0) {
                        field.tiles[p] = 'open';
                        field.overlays![p] = ['road'];
                    }
                    else if (rng.next() < .65)
                        field.tiles[p] = 'forest';
                }
                if (archetype === 'forest_edge' && x < w / 2)
                    field.tiles[p] = 'forest';
                if ((archetype === 'mountain_pass' || archetype === 'ridge_valley') && (x <= 1 || x >= w - 2))
                    field.tiles[p] = 'hill';
                if (archetype === 'mountain_pass' && x === Math.floor(w / 2)) {
                    field.tiles[p] = 'open';
                    field.overlays![p] = ['road'];
                }
                if (archetype === 'rolling_hills' && ((x - 1) ** 2 + (y - h * .4) ** 2 <= 4 || (x - w + 2) ** 2 + (y - h * .65) ** 2 <= 4))
                    field.tiles[p] = 'hill';
                if (archetype === 'terraces' && y >= h / 3 && y < 2 * h / 3)
                    field.tiles[p] = 'hill';
            }
    }
    if (archetype === 'great_hall' && field.generation?.scene === 'interior') {
        for (let y = 2; y < h - 2; y++)
            for (let x = Math.floor(w / 3); x <= Math.ceil(w * 2 / 3); x++) {
                const p = y * w + x;
                if (field.structures![p]?.kind === 'building')
                    field.structures![p] = null;
                field.overlays![p] = ['road'];
            }
    }
    if (archetype === 'trench_depth' && field.generation?.scene === 'trenches')
        for (const y of [Math.max(2, Math.floor(h * .3) - 2), Math.min(h - 3, Math.floor(h * .7) + 2)]) {
            for (let x = 1; x < w - 1; x++) {
                const p = y * w + x;
                if (p !== field.objective.cell && !field.structures![p] && !['deep_water', 'cliff'].includes(field.tiles[p]!))
                    field.structures![p] = createStructure('fortification', 3);
            }
        }
    field.generation!.notes = [...(field.generation!.notes ?? []), SCENE_ARCHETYPE_NAMES[archetype]];
}
