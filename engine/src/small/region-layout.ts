import { SeededRng } from '../rng.js';
import type { Combatant } from '../types.js';
import { BattlefieldPlanError, type BattlefieldPlan, type GatePlan, type LandmarkPlan } from './battlefield-plan.js';
import { landmarkCandidates, worldAnchorCell } from './landmark-placement.js';
import { GRID_ANCHORS, gridBounds, gridPosition, type GridAnchor } from './grid-anchor.js';
import { createStructure, groundBlocked } from './layers.js';
import { neighbors, gridDistance, findGridPath, footprint, type BattlefieldSpec } from './spatial.js';
import { carveInitialBreaches } from './city-breaches.js';
/** Keep the union, including concavities. A disconnected town gets the shortest dry sector connection. */
export function connectedCitySectors(sectors: readonly GridAnchor[], water: readonly GridAnchor[] = []): GridAnchor[] {
    const joined = new Set<GridAnchor>(sectors), blocked = new Set(water.filter(a => !sectors.includes(a)));
    const adjacent = (a: GridAnchor) => { const [x, y] = gridPosition(a)!; return GRID_ANCHORS.filter(b => { const [xx, yy] = gridPosition(b)!; return Math.abs(x - xx) + Math.abs(y - yy) === 1; }); };
    const component = () => {
        const first=GRID_ANCHORS.find(a=>joined.has(a)), reached=new Set<GridAnchor>(first?[first]:[]), queue=[...reached];
        for(let i=0;i<queue.length;i++)for(const next of adjacent(queue[i]!))if(joined.has(next)&&!reached.has(next)){reached.add(next);queue.push(next);}
        return reached;
    };
    for (let reached=component();reached.size<joined.size;reached=component()) {
        const queue = GRID_ANCHORS.filter(a=>reached.has(a)), previous = new Map<GridAnchor, GridAnchor | undefined>(queue.map(a => [a, undefined]));
        let goal:GridAnchor|undefined;
        for (let i = 0; i < queue.length && !goal; i++)
            for (const next of adjacent(queue[i]!))
                if (!blocked.has(next) && !previous.has(next)) {
                    previous.set(next, queue[i]);
                    queue.push(next);
                    if(joined.has(next)&&!reached.has(next)){goal=next;break;}
                }
        if (!goal)
            throw new BattlefieldPlanError('城市分区被水域隔断，无法连接成同一城区；请调整城区或水域范围');
        for (let at: GridAnchor | undefined = goal; at !== undefined; at = previous.get(at))
            joined.add(at);
    }
    return GRID_ANCHORS.filter(a=>joined.has(a));
}
export function regionCells(field: Pick<BattlefieldSpec, 'width' | 'height'>, sectors: readonly GridAnchor[]): number[] {
    const cells = new Set<number>();
    for (const sector of sectors) {
        const [l, r, t, b] = gridBounds(sector, field.width, field.height)!;
        for (let y = t; y <= b; y++)
            for (let x = l; x <= r; x++)
                cells.add(y * field.width + x);
    }
    return [...cells].sort((a, b) => a - b);
}
/** Every numbered sector can grow: units and named buildings determine its required working space. */
export function buildingRadius(plan: BattlefieldPlan | undefined, mark: LandmarkPlan, roster: readonly Combatant[], bindings: Record<string,string> = {}): number {
    const subjects=new Set(plan?.intent?.relations.filter(r=>r.object===mark.id&&(r.relation==='inside'||r.relation==='occupies')).map(r=>bindings[r.subject]??r.subject)??[]);
    const actors=roster.filter(u=>u.hp>0&&u.status==='ready'&&(subjects.has(u.id)||subjects.has(u.side)));
    const required=Math.ceil(actors.reduce((n,u)=>n+footprint(u),0)/2);
    return Math.max(2,Math.ceil((Math.sqrt(required)+1)/2));
}
export function regionMapSize(plan: BattlefieldPlan | undefined, roster: readonly Combatant[], width: number, height: number, bindings: Record<string,string> = {}): [
    number,
    number
] {
    if (!plan?.citySectors?.length && !plan?.waterSectors?.length && !plan?.landmarks?.some(m=>m.kind==='building'&&buildingRadius(plan,m,roster,bindings)>2))
        return [width, height];
    // Adjacent city sectors share their boundary and interior. They do not each need a complete fortress.
    const demand = new Map<GridAnchor, number>(GRID_ANCHORS.map(a => [a, 0]));
    for (const mark of plan.landmarks ?? [])
        if (gridPosition(mark.anchor) && mark.kind === 'building' && buildingRadius(plan,mark,roster,bindings)>2) {
            const a = mark.anchor as GridAnchor;
            demand.set(a, demand.get(a)! + (2*buildingRadius(plan,mark,roster,bindings)+2)**2);
        }
    for (const deployment of plan.deployments ?? []) {
        const actors = roster.filter(u => u.hp > 0 && u.status === 'ready' && (u.id === deployment.subject || u.side === deployment.subject));
        const numbered = deployment.at.filter(a => !!gridPosition(a)) as GridAnchor[];
        for (const a of numbered)
            demand.set(a, demand.get(a)! + Math.ceil(actors.reduce((n, u) => n + footprint(u), 0) / Math.max(1, numbered.length) / 2));
    }
    const side = Math.ceil(Math.sqrt(Math.max(...demand.values())));
    return [Math.max(width, side * 4 + 1), Math.max(height, side * 4 + 1)];
}
/** One connected urban footprint, with shared streets rather than walls between numbered sectors. */
export function buildRegionCity(field: BattlefieldSpec, plan: BattlefieldPlan, seed: string, attackingSide: 'ally' | 'enemy'): void {
    const w = field.width, h = field.height, rng = new SeededRng('region-city-v1:' + seed), siege = field.generation!.scene === 'city_siege';
    const defender = attackingSide === 'ally' ? 'enemy' : 'ally', sectors = connectedCitySectors(plan.citySectors!, plan.waterSectors);
    // Discard the generic urban parcels before drawing the specified town; named suburbs are built later.
    field.structures!.forEach((s,p) => { if (s?.kind === 'building') { field.structures![p]=null; if(field.tiles[p]==='street')field.tiles[p]='open'; } });
    // "double" specifies depth, not enclosure. Edge-spanning numbered districts remain a wall segment.
    const front = plan.shape === 'front' || plan.shape === undefined && plan.wallLayers === 2
      && sectors.some(a=>{const [x,y]=gridPosition(a)!;return x===0||x===3||y===0||y===3;});
    const mask = new Set(regionCells(field, sectors).filter(p => front || p % w > 0 && p % w < w - 1 && p >= w && p < w * (h - 1)));
    const edge = (p: number) => p % w === 0 || p % w === w - 1 || p < w || p >= w * (h - 1);
    const mx=[...mask].reduce((s,p)=>s+p%w,0)/mask.size,my=[...mask].reduce((s,p)=>s+Math.floor(p/w),0)/mask.size;
    const approach = plan.deployments?.find(d => d.subject === attackingSide)?.at.map(a => worldAnchorCell(field, a)) ?? [];
    const dx = approach.length ? approach.reduce((n, p) => n + p % w, 0) / approach.length - mx : 0;
    const dy = approach.length ? approach.reduce((n, p) => n + Math.floor(p / w), 0) / approach.length - my : attackingSide === 'enemy' ? -h : h;
    const directions = ['north', 'south', 'west', 'east'] as const;
    const step = { north: -w, south: w, west: -1, east: 1 };
    const toward = { north: -dy, south: dy, west: -dx, east: dx };
    const boundary = [...mask].filter(p => neighbors(field, p).some(n => !mask.has(n)) || !front && edge(p));
    const exposed = directions.filter(side => boundary.some(p => neighbors(field, p).includes(p + step[side]) && !mask.has(p + step[side])));
    const facing = exposed.sort((a, b) => toward[b] - toward[a])[0] ?? (attackingSide === 'enemy' ? 'north' : 'south');
    const rearAxis=(p:number)=>facing==='north'?Math.floor(p/w):facing==='south'?-Math.floor(p/w):facing==='west'?p%w:-(p%w);
    const backEdge=Math.max(...[...mask].map(rearAxis));
    // A front wall may be an open connected defence inside the map. It need not close a box or touch an edge.
    const rim = front ? boundary.filter(p => rearAxis(p)!==backEdge) : boundary;
    if (!rim.length)
        throw new BattlefieldPlanError('城市占满战场，没有城外接近地带；请保留至少一个城外分区');
    const depth = new Map(rim.map(p => [p, 0])), queue = [...rim];
    for (let i = 0; i < queue.length; i++)
        for (const p of neighbors(field, queue[i]!))
            if (mask.has(p) && !depth.has(p)) {
                depth.set(p, depth.get(queue[i]!)! + 1);
                queue.push(p);
            }
    const layers = plan.wallLayers ?? 1, fortified = siege || plan.gatePlan !== undefined || plan.shape !== undefined;
    const innerWall = new Set(siege && layers === 2 ? [...mask].filter(p => depth.get(p) === 2) : []);
    const walls = fortified ? [...rim, ...innerWall] : [], wallSet = new Set(walls), inside = [...mask].filter(p => !wallSet.has(p));
    const town = new Set([...mask].filter(p => !fortified || (depth.get(p) ?? 0) >= 2 * layers - 1));
    if (!town.size)
        throw new BattlefieldPlanError('城市内部部署容量不足，需要扩大分区');
    const cx = [...town].reduce((s, p) => s + p % w, 0) / town.size, cy = [...town].reduce((s, p) => s + Math.floor(p / w), 0) / town.size;
    const coreCell = [...town].sort((a, b) => Math.abs(a % w - cx) + Math.abs(Math.floor(a / w) - cy) - Math.abs(b % w - cx) - Math.abs(Math.floor(b / w) - cy) || a - b)[0]!;
    const core = [coreCell, ...neighbors(field, coreCell).filter(p => town.has(p))], roads = new Set(core);
    for (const p of mask) {
        field.tiles[p] = 'street';
        field.structures![p] = null;
        delete field.overlays![p];
    }
    const pave = (cells: readonly number[]) => { for (const p of cells) {
        if (field.structures![p]?.kind === 'building')
            field.structures![p] = null;
        roads.add(p);
        if (!field.structures![p])
            field.overlays![p] = ['road'];
    } };
    for (const sector of sectors) {
        const cells = regionCells(field, [sector]).filter(p => town.has(p));
        if (!cells.length)
            continue;
        const hub = cells[Math.floor(cells.length / 2)]!;
        pave(findGridPath(field, hub, coreCell, p => town.has(p), () => 1)?.cells ?? []);
    }
    const density = { sparse: .22, balanced: .4, dense: .6 }[plan.obstacles ?? plan.density ?? 'balanced'];
    for (const p of town) {
        if (roads.has(p) || field.structures![p] || rng.next() > density)
            continue;
        const run = [p, p + 1, p + w, p + w + 1];
        if (run.every(q => town.has(q) && !roads.has(q) && !field.structures![q] && q % w >= p % w))
            for (const q of run)
                field.structures![q] = createStructure('building', plan.fortLevel ?? 3, { entityId: `parcel_${p}` });
    }
    for (const p of walls)
        field.structures![p] = createStructure('wall', plan.fortLevel ?? 3, { owner: defender, top: true });
    const axis = (p: number) => facing === 'north' ? Math.floor(p / w) : facing === 'south' ? -Math.floor(p / w) : facing === 'west' ? p % w : -(p % w);
    const frontAxis = Math.min(...rim.map(axis)), frontage = rim.filter(p => axis(p) === frontAxis), gates: number[] = [], terrace = inside.filter(p => layers === 2 && depth.get(p) === 1);
    const specs = plan.gatePlan ?? (plan.gates === 'none' ? [] : plan.gates === 'double' || plan.gates === 'side' ? [{ sector: 'front_left', state: plan.gateState ?? 'closed' }, { sector: 'front_right', state: plan.gateState ?? 'closed' }] : [{ sector: 'front_center', state: plan.gateState ?? 'closed' }]) as GatePlan[];
    for (const [index, spec] of (fortified ? specs : []).entries()) {
        const side = ['north', 'south', 'east', 'west'].includes(spec.sector) ? spec.sector : facing;
        const outward = (p: number) => neighbors(field, p).some(n => !mask.has(n) && (side === 'north' ? n === p - w : side === 'south' ? n === p + w : side === 'west' ? n === p - 1 : n === p + 1));
        let candidates = rim.filter(p => !gates.includes(p) && neighbors(field, p).some(n => inside.includes(n)) && outward(p));
        if (!candidates.length)
            candidates = rim.filter(p => !gates.includes(p) && neighbors(field, p).some(n => inside.includes(n)) && neighbors(field, p).some(n => !mask.has(n)));
        const along = (p: number) => side === 'north' || side === 'south' ? p % w : Math.floor(p / w);
        candidates.sort((a, b) => along(a) - along(b) || a - b);
        const rank = spec.sector.endsWith('left') ? 0 : spec.sector.endsWith('right') ? candidates.length - 1 : Math.floor((candidates.length - 1) * (index + 1) / (specs.length + 1));
        const p = candidates[Math.max(0, rank)];
        if (p === undefined)
            throw new BattlefieldPlanError('城门部署容量不足，无法保留请求数量');
        const gate = createStructure('gate', plan.fortLevel ?? 3, { owner: defender, top: true, gateState: spec.state, ...spec.id ? { entityId: spec.id } : {} });
        if (spec.state === 'destroyed') {
            gate.hp = 0;
            field.overlays![p] = ['rubble'];
        }
        field.structures![p] = gate;
        gates.push(p);
        const path = findGridPath(field, p, coreCell, n => mask.has(n), n => wallSet.has(n) ? 100 : field.structures![n]?.kind === 'building' ? 5 : 1);
        const inner = path?.cells.find(n => innerWall.has(n));
        if (layers === 2 && inner !== undefined) {
            field.structures![inner] = createStructure('gate', plan.fortLevel ?? 3, { owner: defender, top: true, gateState: spec.state === 'open' ? 'open' : 'closed' });
        }
        pave(path?.cells ?? []);
        const outer = neighbors(field, p).find(n => !mask.has(n));
        if (outer !== undefined) {
            const end = side === 'north' ? outer % w : side === 'south' ? (h - 1) * w + outer % w : side === 'west' ? Math.floor(outer / w) * w : Math.floor(outer / w) * w + w - 1;
            const route = findGridPath(field, outer, end, n => !mask.has(n), () => 1);
            for (const q of route?.cells ?? []) {
                if (field.tiles[q] === 'cliff')
                    field.tiles[q] = 'open';
                field.structures![q] = null;
                field.overlays![q] = ['road'];
            }
        }
    }
    // Connect each remaining courtyard once, rather than searching once per floor cell.
    const reached = new Set<number>(), flood = (start: number) => { const open = [start]; reached.add(start); for (let i = 0; i < open.length; i++)
        for (const n of neighbors(field, open[i]!))
            if (town.has(n) && !groundBlocked(field, n) && !reached.has(n)) {
                reached.add(n);
                open.push(n);
            } };
    flood(coreCell);
    for (const p of town)
        if (!groundBlocked(field, p) && !reached.has(p)) {
            pave(findGridPath(field, p, coreCell, n => town.has(n), n => groundBlocked(field, n) ? 100 : 1)?.cells ?? []);
            flood(p);
        }
    for (const p of walls)
        field.structures![p]!.access = neighbors(field, p).filter(n => inside.includes(n) && !groundBlocked(field, n));
    const reserve = inside.filter(p => !core.includes(p) && !groundBlocked(field, p));
    field.city = { shape: siege ? front ? 'front' : 'enclosure' : 'district', inside: fortified ? inside : [...mask], frontline: walls, gates, core, reserve, facing, frontage, ...siege ? { defender } : {}, ...terrace.length ? { terrace } : {} };
    if (siege) {
        const breaches = carveInitialBreaches(field, walls, inside, plan.breaches ?? { count: 0 }, defender, rng);
        field.city.breaches = breaches.groups;
        field.generation!.notes = [...field.generation!.notes ?? [], ...breaches.notes];
    }
    field.objective = siege ? { kind: 'control', cell: coreCell, cells: core, attackingSide, rounds: 2, limit: field.objective.limit } : { kind: 'annihilation', cell: coreCell, limit: field.objective.limit };
    if (siege)
        field.deploymentZones = [{ side: defender, cells: reserve }, { side: attackingSide, cells: field.tiles.flatMap((_, p) => !mask.has(p) && !groundBlocked(field, p) ? [p] : []) }];
    delete field.generation!.routes;
}
/** Named outdoor buildings have actual floor cells; walls and doors keep their normal battle mechanics. */
export function buildEnterableBuilding(field: BattlefieldSpec, mark: LandmarkPlan, anchor: number, protectedCells: Set<number>, marked: Set<number>, radius=2): number[] {
    const w = field.width, h = field.height, city = new Set(field.city?.inside ?? []), inCity = city.has(anchor), core = new Set(field.city?.core ?? []);
    const candidates = landmarkCandidates(field, mark, anchor, p => !marked.has(p));
    for (const center of candidates) {
        const x = center % w, y = Math.floor(center / w);
        if (x < radius + 1 || x >= w - radius - 1 || y < radius + 1 || y >= h - radius - 1)
            continue;
        const cells: number[] = [], floor: number[] = [], rim: number[] = [];
        for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
                const p = (y + dy) * w + x + dx;
                cells.push(p);
                (Math.abs(dx) === radius || Math.abs(dy) === radius ? rim : floor).push(p);
            }
        const floorSet = new Set(floor);
        if (cells.some(p => marked.has(p) || protectedCells.has(p) && !(floorSet.has(p) && core.has(p))
            || inCity && !city.has(p) || ['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[p]!)
            || field.structures![p] && ['wall', 'gate', 'tower', 'fortification'].includes(field.structures![p]!.kind)))
            continue;
        const entrances = [(y - radius) * w + x, (y + radius) * w + x, y * w + x - radius, y * w + x + radius];
        const roads = field.tiles.flatMap((_, p) => !cells.includes(p) && field.overlays![p]?.includes('road') && !groundBlocked(field, p) ? [p] : []);
        const door = entrances.sort((a, b) => Math.min(...roads.map(p => gridDistance(field, a, p)), w + h) - Math.min(...roads.map(p => gridDistance(field, b, p)), w + h) || a - b)[0]!;
        const outside = neighbors(field, door).find(p => !cells.includes(p))!;
        let connection: ReturnType<typeof findGridPath>;
        for (const road of roads.map(p => ({ p, d: gridDistance(field, p, outside) })).sort((a, b) => a.d - b.d || a.p - b.p)) {
            connection = findGridPath(field, outside, road.p, p => !cells.includes(p) && !protectedCells.has(p) && !marked.has(p) && (!inCity || city.has(p)) && !['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[p]!) && (!field.structures![p] || field.structures![p]!.kind === 'building' || field.structures![p]!.kind === 'cover'), () => 1);
            if (connection)
                break;
        }
        if (roads.length && !connection)
            continue;
        for (const p of cells) {
            field.tiles[p] = 'street';
            field.structures![p] = null;
            delete field.overlays![p];
        }
        const level = mark.level ?? field.structures![field.city?.frontline[0] ?? -1]?.level ?? 3;
        for (const p of rim) {
            field.structures![p] = createStructure('wall', level, { top: false, ...mark.id ? { entityId: mark.id } : {} });
        }
        field.structures![door] = createStructure('gate', level, { top: false, gateState: 'open', ...mark.id ? { entityId: mark.id } : {} });
        for (const p of connection?.cells ?? []) {
            field.structures![p] = null;
            field.overlays![p] = ['road'];
        }
        // Leave a walkable apron around the footprint so a building does not plug a pre-existing street.
        for (const p of rim)
            for (const n of neighbors(field, p))
                if (!cells.includes(n) && !protectedCells.has(n) && !marked.has(n) && (!inCity || city.has(n))
                    && (!field.structures![n] || field.structures![n]!.kind === 'building' || field.structures![n]!.kind === 'cover') && !['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[n]!)) {
                    field.structures![n] = null;
                    field.overlays![n] = ['road'];
                }
        if (mark.state === 'destroyed')
            for (const p of rim) {
                field.structures![p]!.hp = 0;
                if (p === door)
                    field.structures![p]!.gateState = 'destroyed';
                field.overlays![p] = ['rubble'];
            }
        else {
            const furniture = floor.find(p => p !== center && !core.has(p) && !neighbors(field, door).includes(p));
            if (furniture !== undefined)
                field.structures![furniture] = createStructure('cover', level);
        }
        cells.forEach(p => marked.add(p));
        return floor;
    }
    throw new BattlefieldPlanError(`建筑${mark.label ?? ''}的内部部署容量不足，需要扩大分区或调整位置`);
}
