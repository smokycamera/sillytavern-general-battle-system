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
type CitySide = 'north' | 'south' | 'east' | 'west';
/** Tie order for a city's facing, toward the usual attack edges first. */
const CITY_SIDES: readonly CitySide[] = ['south', 'north', 'west', 'east'];
/**
 * How a besieged city is walled. A front city continues past the map edges behind and beside it, so only its sides
 * toward the battlefield are walled; a ring city stands clear of the edges with walls all round. Two layers put an
 * inner wall two cells behind the outer one, with a passage between them. An unstated layout is drawn from the seed.
 */
export function siegeWallLayout(plan: Pick<BattlefieldPlan, 'shape' | 'wallLayers'>, position: WorldAnchor, seed: string): { ring: boolean; layers: 1 | 2 } {
    if (plan.shape === undefined && plan.wallLayers === undefined) {
        const roll = new SeededRng('city-walls-v1:' + seed).next();
        return { ring: position === 'center' || roll >= .45 && roll < .8, layers: position !== 'center' && roll >= .8 ? 2 : 1 };
    }
    return { ring: position === 'center' || (plan.shape ?? 'front') !== 'front', layers: plan.wallLayers ?? 1 };
}
/** The walled side an assault faces: where the attackers are said to start, else the widest open ground. */
function siegeFacing(field: BattlefieldSpec, position: WorldAnchor, walled: Record<CitySide, boolean>, [l, r, t, b]: number[], attackers: readonly WorldAnchor[], attackEdge: CitySide): CitySide {
    const space: Record<CitySide, number> = { north: t!, south: field.height - 1 - b!, west: l!, east: field.width - 1 - r! };
    const toward = (s: CitySide) => attackers.filter(a => a.includes(s)).length;
    return CITY_SIDES.filter(s => walled[s] && !position.includes(s))
        .sort((a, c) => toward(c) - toward(a) || space[c] - space[a] || Number(c === attackEdge) - Number(a === attackEdge) || CITY_SIDES.indexOf(a) - CITY_SIDES.indexOf(c))[0] ?? attackEdge;
}
/** A city footprint is a region in the battlefield, independent of which faction attacks. */
export function buildPlannedCity(field: BattlefieldSpec, plan: BattlefieldPlan, seed: string, scene: BattlefieldScene, attackingSide: 'ally' | 'enemy'): void {
    const rng = new SeededRng('city-parcels-v2:' + seed), w = field.width, h = field.height, defender = attackingSide === 'ally' ? 'enemy' : 'ally';
    const siege = scene === 'city_siege', outside = scene === 'field', position = plan.cityPosition ?? (defender === 'enemy' ? 'north' : 'south');
    let [l, r, t, b] = bounds(field, position, outside);
    const layout = siege ? siegeWallLayout(plan, position, seed) : undefined;
    if (layout && !layout.ring) {
        // A front city continues past the battlefield: it reaches every map edge except the ones it faces.
        const alongX = !/east|west/.test(position), alongY = !/north|south/.test(position);
        if (position.includes('north') || alongY)
            t = 0;
        if (position.includes('south') || alongY)
            b = h - 1;
        if (position.includes('west') || alongX)
            l = 0;
        if (position.includes('east') || alongX)
            r = w - 1;
    }
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
    // A besieged city is walled on every side that does not run off the map; depth counts cells in from those walls.
    const walled: Record<CitySide, boolean> = { north: t > 0, south: b < h - 1, west: l > 0, east: r < w - 1 };
    const depthAt = (x: number, y: number) => Math.min(walled.west ? x - l : Infinity, walled.east ? r - x : Infinity, walled.north ? y - t : Infinity, walled.south ? b - y : Infinity);
    const townBox = (n: number) => siege ? [l + (walled.west ? n : 0), r - (walled.east ? n : 0), t + (walled.north ? n : 0), b - (walled.south ? n : 0)] : [l + 1, r - 1, t + 1, b - 1];
    let layers = layout?.layers ?? 1;
    // Two walls need the passage between them and a town at least three cells across behind both.
    if (layers === 2 && (([x0, x1, y0, y1]) => x1! - x0! < 2 || y1! - y0! < 2)(townBox(3))) {
        layers = 1;
        field.generation!.notes = [...(field.generation!.notes ?? []), '战区放不下两重城墙，改为一道城墙'];
    }
    const [bl, br, bt, bb] = townBox(2 * layers - 1) as [number, number, number, number];
    const facing: CitySide = siege ? siegeFacing(field, position, walled, [l, r, t, b], plan.deployments?.find(d => d.subject === attackingSide)?.at ?? [], attackingSide === 'ally' ? 'south' : 'north')
        : position.includes('west') ? 'east' : position.includes('east') ? 'west' : position.includes('south') ? 'north' : 'south';
    field.structures!.forEach((s, p) => { if (s?.kind === 'building') {
        field.structures![p] = null;
        if (field.tiles[p] === 'street')
            field.tiles[p] = 'open';
    } });
    // town: the streets behind every wall; terrace: the passage between two walls.
    const at = (x: number, y: number) => y * w + x, all: number[] = [], inside: number[] = [], perimeter: number[] = [], frontage: number[] = [];
    const town: number[] = [], terrace: number[] = [], outerWall: number[] = [], innerWall = new Set<number>();
    for (let y = t; y <= b; y++)
        for (let x = l; x <= r; x++) {
            const p = at(x, y), edge = x === l || x === r || y === t || y === b, depth = siege ? depthAt(x, y) : edge ? 0 : 1;
            all.push(p);
            field.tiles[p] = 'street';
            field.structures![p] = null;
            delete field.overlays![p];
            if (edge)
                perimeter.push(p);
            if (depth === 0)
                outerWall.push(p);
            else if (layers === 2 && depth === 2)
                innerWall.add(p);
            else
                inside.push(p);
            if (layers === 2 && depth === 1)
                terrace.push(p);
            if (depth >= 2 * layers - 1)
                town.push(p);
            if ((!siege || depth === 0) && (facing === 'east' && x === r || facing === 'west' && x === l || facing === 'north' && y === t || facing === 'south' && y === b))
                frontage.push(p);
        }
    const fortified = siege || outside && (plan.gatePlan !== undefined || plan.shape !== undefined);
    const shape = plan.shape ?? (position === 'center' ? 'enclosure' : 'front'), rim = siege ? outerWall : perimeter;
    const wallCells = siege ? [...outerWall, ...innerWall] : fortified ? (shape === 'front' ? frontage : perimeter) : [];
    const coreCell = at(Math.floor((bl + br) / 2), Math.floor((bt + bb) / 2)), core = [coreCell, ...neighbors(field, coreCell)].filter(p => town.includes(p));
    const roads = new Set(core), scratch: BattlefieldSpec = { version: 2, width: br - bl + 1, height: bb - bt + 1, tiles: Array((br - bl + 1) * (bb - bt + 1)).fill('street'), objective: { kind: 'annihilation', cell: 0, limit: 60 } };
    const graph = buildRouteGraph(scratch, rng, { ...field.generation!.design, ...(plan.topology ? { topology: plan.topology } : {}) });
    const project = (p: number) => at(bl + p % scratch.width, bt + Math.floor(p / scratch.width));
    field.generation!.routes = { ...graph, nodes: graph.nodes.map(n => ({ ...n, cell: project(n.cell) })), edges: graph.edges.map(e => ({ ...e, cells: e.cells.map(project) })) };
    for (const e of graph.edges)
        for (const p of e.cells)
            roads.add(project(p));
    const frontCenter = gateTarget(field, { sector: 'front_center', state: 'closed' }, frontage, rim);
    const approach = findGridPath(field, frontCenter, coreCell, p => all.includes(p), () => 1);
    for (const p of approach?.cells ?? [])
        roads.add(p);
    if (kind === 'market')
        for (const p of town)
            if (gridDistance(field, p, coreCell) <= 2)
                roads.add(p);
    const parcels = new Set<number>(), density = { sparse: .35, balanced: .65, dense: .85 }[plan.obstacles ?? plan.density ?? 'balanced'];
    for (let y = bt; y <= bb; y++)
        for (let x = bl; x <= br; x++) {
            const p = at(x, y);
            if (roads.has(p) || parcels.has(p))
                continue;
            const cells = [p], maxW = kind === 'warehouse' ? 3 : kind === 'old_town' ? 1 : 2, maxH = kind === 'warehouse' ? 3 : 2;
            for (let dy = 0; dy < maxH && y + dy <= bb; dy++)
                for (let dx = 0; dx < maxW && x + dx <= br; dx++) {
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
    const gates: number[] = [], innerGates: number[] = [];
    const pave = (path?: { cells: number[] }) => { for (const q of path?.cells ?? []) {
        if (field.structures![q]?.kind === 'building')
            field.structures![q] = null;
        roads.add(q);
    } };
    if (fortified)
        for (const spec of specs) {
            const desired = gateTarget(field, spec, frontage, rim), candidates = wallCells.filter(p => !gates.includes(p) && !innerWall.has(p) && neighbors(field, p).some(q => inside.includes(q)) && neighbors(field, p).some(q => !all.includes(q)));
            // A gate named for a side opens through the wall on that side when the city has one there.
            const opensTo = (p: number) => ({ [p - w]: 'north', [p + w]: 'south', [p - 1]: 'west', [p + 1]: 'east' } as Record<number, string>)[neighbors(field, p).find(q => !all.includes(q))!];
            const sided = candidates.filter(p => opensTo(p) === spec.sector);
            const p = (sided.length ? sided : candidates).sort((a, b) => gridDistance(field, a, desired) - gridDistance(field, b, desired) || a - b)[0];
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
            const outer = neighbors(field, p).find(q => !all.includes(q));
            if (layers === 2 && outer !== undefined) {
                // An outer gate leads across the passage to its own gate in the inner wall, which holds even when the outer one fell.
                const [px, py] = [p % w, Math.floor(p / w)], ideal = at(3 * px - 2 * (outer % w), 3 * py - 2 * Math.floor(outer / w));
                const into = [...innerWall].filter(q => !innerGates.includes(q) && neighbors(field, q).some(n => terrace.includes(n)) && neighbors(field, q).some(n => town.includes(n)))
                    .sort((a, c) => gridDistance(field, a, ideal) - gridDistance(field, c, ideal) || a - c)[0];
                if (into === undefined)
                    throw new BattlefieldPlanError('城门部署容量不足，无法保留请求数量');
                field.structures![into] = createStructure('gate', level, { owner: defender, top: true, gateState: spec.state === 'open' ? 'open' : 'closed' });
                innerGates.push(into);
                for (const q of neighbors(field, into))
                    if (field.structures![q]?.kind === 'building')
                        field.structures![q] = null;
                pave(findGridPath(field, p, into, q => q === into || terrace.includes(q), () => 1));
                pave(findGridPath(field, into, coreCell, q => town.includes(q), q => field.structures![q]?.kind === 'building' ? 100 : 1));
            }
            else
                pave(findGridPath(field, p, coreCell, q => all.includes(q) && (!wallCells.includes(q) || q === p), q => field.structures![q]?.kind === 'building' ? 100 : 1));
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
    // Stairs climb each wall from the side it shields: the outer of two walls from the passage, the inner one from the town.
    for (const p of wallCells)
        field.structures![p]!.access = neighbors(field, p).filter(q => (innerWall.has(p) ? town : layers === 2 ? terrace : inside).includes(q) && !groundBlocked(field, q));
    // The passage between two walls stays open ground for the garrison and for an assault that took the outer wall.
    for (const p of terrace)
        roads.add(p);
    for (const p of roads)
        if (!field.structures![p])
            field.overlays![p] = ['road'];
    // Preserve parcels while connecting all usable courtyards to the main street.
    for (const p of town.filter(p => !groundBlocked(field, p)))
        if (!findGridPath(field, p, coreCell, q => town.includes(q) && !groundBlocked(field, q))) {
            const path = findGridPath(field, p, coreCell, q => town.includes(q), q => field.structures![q]?.kind === 'building' ? 100 : 1);
            for (const q of path?.cells ?? [])
                if (field.structures![q]?.kind === 'building') {
                    field.structures![q] = null;
                    field.overlays![q] = ['road'];
                }
        }
    const reserve = town.filter(p => !groundBlocked(field, p) && !core.includes(p) && gridDistance(field, p, coreCell) <= 3);
    const walls = layout?.ring ? plan.shape && plan.shape !== 'front' ? plan.shape : 'enclosure' : 'front';
    field.city = { shape: siege ? walls : 'district', inside: siege ? inside : all, frontline: wallCells, gates, core, reserve: reserve.slice(0, Math.max(2, w)), facing, frontage, ...(siege ? { defender } : {}), ...(terrace.length ? { terrace } : {}) };
    if (siege) {
        const breaches = carveInitialBreaches(field, wallCells, inside, plan.breaches ?? { count: 0 }, defender, rng);
        field.city.breaches = breaches.groups;
        field.generation!.notes = [...(field.generation!.notes ?? []), ...breaches.notes];
    }
    // An open-field reference cell left under new walls or houses moves to the nearest open ground outside the town.
    const outsideCell = (cell: number) => !groundBlocked(field, cell) ? cell
        : field.tiles.map((_, p) => p).filter(p => !all.includes(p) && !groundBlocked(field, p)).sort((a, b) => gridDistance(field, a, cell) - gridDistance(field, b, cell) || a - b)[0] ?? cell;
    field.objective = siege ? { kind: 'control', cell: coreCell, cells: core, attackingSide, rounds: 2, limit: field.objective.limit } : { kind: 'annihilation', cell: outside ? outsideCell(field.objective.cell) : coreCell, limit: field.objective.limit };
    if (siege) {
        const band = field.tiles.map((_, p) => p).filter(p => !all.includes(p) && !groundBlocked(field, p) && (facing === 'east' ? p % w >= w - 3 : facing === 'west' ? p % w <= 2 : facing === 'north' ? Math.floor(p / w) <= 2 : Math.floor(p / w) >= h - 3));
        // On a narrow map the approach band can touch the walls; keep a cell clear when the band still has room.
        const clear = band.filter(p => wallCells.every(q => gridDistance(field, p, q) > 1));
        field.deploymentZones = [{ side: defender, cells: inside.filter(p => !groundBlocked(field, p)) }, { side: attackingSide, cells: clear.length >= Math.max(4, band.length / 2) ? clear : band }];
    }
}
/** Build a continuous water boundary and exactly the declared logical bridge entities. */
export function buildPlannedWater(field: BattlefieldSpec, plan: BattlefieldPlan, seed: string): void {
    if (!plan.water || plan.water === 'none')
        return;
    if (field.generation?.scene === 'interior')
        throw new BattlefieldPlanError('室内场景不能铺设室外河流');
    const w = field.width, h = field.height, anchor = plan.waterPosition ?? 'center', moat = plan.water === 'moat';
    // A moat keeps one cell of footing below the walls; a river leaves room for a bank road.
    const gap = moat ? 2 : 3;
    let axis = plan.waterAxis ?? 'horizontal';
    const cityCells = field.city ? [...field.city.inside, ...field.city.frontline] : [];
    let line = axis === 'horizontal' ? Math.floor(worldAnchorCell(field, anchor) / w) : worldAnchorCell(field, anchor) % w;
    if (cityCells.length && (plan.intent?.entities.some(e => e.kind === 'river') || plan.waterPosition)) {
        if (axis === 'vertical' && anchor.includes('east'))
            line = Math.min(w - 2, Math.max(...cityCells.map(p => p % w)) + gap);
        if (axis === 'vertical' && anchor.includes('west'))
            line = Math.max(1, Math.min(...cityCells.map(p => p % w)) - gap);
        if (axis === 'horizontal' && anchor.includes('north'))
            line = Math.max(1, Math.min(...cityCells.map(p => Math.floor(p / w))) - gap);
        if (axis === 'horizontal' && anchor.includes('south'))
            line = Math.min(h - 2, Math.max(...cityCells.map(p => Math.floor(p / w))) + gap);
    }
    const lineCells = (n: number, along = axis) => Array.from({ length: along === 'horizontal' ? w : h }, (_, i) => along === 'horizontal' ? n * w + i : i * w + n);
    let cells = lineCells(line);
    // A planned city is a placed region, so an unplaced river keeps clear of its streets as well as its walls.
    const avoided = new Set(field.city?.facing ? cityCells : field.city?.frontline ?? []);
    if (cityCells.length && anchor === 'center' && cells.some(p => avoided.has(p))) {
        // A river with no stated side cannot cut through the city: it runs along the city's open side,
        // across the other axis when the city spans this one.
        for (const along of [axis, axis === 'horizontal' ? 'vertical' as const : 'horizontal' as const]) {
            const span = cityCells.map(p => along === 'horizontal' ? Math.floor(p / w) : p % w), size = along === 'horizontal' ? h : w;
            const open = size - 1 - Math.max(...span) >= Math.min(...span) ? Math.min(size - 2, Math.max(...span) + gap) : Math.max(1, Math.min(...span) - gap);
            if (lineCells(open, along).some(p => avoided.has(p))) continue;
            axis = along; line = open; cells = lineCells(open, along);
            break;
        }
    }
    if (cells.some(p => field.city?.frontline.includes(p)))
        throw new BattlefieldPlanError('河流与完整城墙重叠，请调整城市或河流方位');
    const target = field.objective.cell;
    for (const p of cells) {
        field.tiles[p] = plan.water === 'ford' ? 'shallow_water' : 'deep_water';
        field.structures![p] = null;
        delete field.overlays![p];
    }
    const replacement = cells.includes(target) ? neighbors(field, target).filter(p => !cells.includes(p) && !groundBlocked(field, p)).sort((a, b) => a - b)[0] : undefined;
    // A ford stays walkable, so the objective may remain in it when no bank cell is free.
    if (cells.includes(target) && replacement === undefined && plan.water !== 'ford')
        throw new BattlefieldPlanError('水域覆盖任务目标且没有合法岸上目标');
    if (replacement !== undefined) {
        field.objective.cell = replacement;
        if (field.objective.kind === 'control')
            field.objective.cells = (field.objective.cells ?? [target]).filter(p => !cells.includes(p));
        if (field.objective.kind === 'control' && !field.objective.cells!.includes(replacement))
            field.objective.cells!.push(replacement);
        if (field.city)
            field.city.core = field.city.core.filter(p => !cells.includes(p));
    }
    // The water straight out from a cell, such as a gate a moat's bridge serves.
    const gates = field.city?.gates ?? [], before = (cell: number) => axis === 'horizontal' ? line * w + cell % w : Math.floor(cell / w) * w + line;
    const specs = plan.bridgePlan ?? (plan.water === 'ford' ? [] : moat && gates.length ? gates.map(() => ({ anchor: 'center', state: 'intact', width: 1 }))
        : [{ anchor: axis === 'horizontal' ? 'west' : 'north', state: 'intact', width: 1 }, { anchor: axis === 'horizontal' ? 'east' : 'south', state: 'intact', width: 1 }]) as NonNullable<BattlefieldPlan['bridgePlan']>;
    const used = new Set<number>();
    for (const [i, spec] of specs.entries()) {
        // A moat bridge without a stated place spans the moat in front of its gate.
        const desired = moat && spec.anchor === 'center' && gates[i] !== undefined ? before(gates[i]!) : worldAnchorCell(field, spec.anchor), width = spec.width ?? 1;
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
    const notes = [`水系${axis === 'horizontal' ? '横向' : '纵向'}布置，${specs.length}座桥`];
    // Deep water across the whole battlefield with no standing bridge would split the battle for good: one stretch,
    // in front of the gate or in line with the objective, stays fordable. No bridge is added.
    if (plan.water !== 'ford' && ![...used].some(p => (field.structures![p]?.hp ?? 0) > 0)) {
        const step = axis === 'horizontal' ? 1 : w, ahead = before(moat && gates[0] !== undefined ? gates[0] : field.objective.cell);
        const ford = cells.filter(p => cells.includes(p + step) && !used.has(p) && !used.has(p + step))
            .sort((a, b) => gridDistance(field, a, ahead) - gridDistance(field, b, ahead) || a - b)[0];
        if (ford !== undefined) {
            field.tiles[ford] = field.tiles[ford + step] = 'shallow_water';
            notes.push('水面没有完好的桥，留出一处可涉水的浅滩');
        }
    }
    field.generation!.notes = [...(field.generation!.notes ?? []), ...notes];
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
