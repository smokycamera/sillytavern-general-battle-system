import { resolveBattlefieldScene, buildSpecialScene, placePlannedGates } from './scene-layouts.js';
import { carveInitialBreaches } from './city-breaches.js';
import { MAX_SMALL_UNITS } from '../battle-limits.js';
import { buildRouteGraph } from './route-graph.js';
import { SeededRng } from '../rng.js';
import { environmentTags } from '../environment.js';
import type { Combatant } from '../types.js';
import { generatedField, type FieldGenerationOptions } from './field-generator.js';
import { normalizeBattlefieldPlan, type BattlefieldPlan, type LandmarkPlan, CITY_SHAPES, BattlefieldPlanError } from './battlefield-plan.js';
import { createStructure, groundBlocked, type CityShape, type FieldLandmark } from './layers.js';
import { validateField, neighbors, findGridPath, gridDistance, prepareGridDeployment, footprint, type BattlefieldSpec, type Terrain } from './spatial.js';
import { safeLandmarkLabel, type BattlefieldScene } from './map-design.js';
import { landmarkAnchorCell, landmarkCandidates } from './landmark-placement.js';
import { compileScenePlan, finishSceneRegions, validateSceneFacts,deriveRetreatEdges } from './scene-compiler.js';
import { buildPlannedCity, buildPlannedWater, applySceneArchetype, selectSceneArchetype } from './scene-layout-v2.js';
import { initializeHeightMap } from './height-map.js';
import { applyPlannedDeployments, withCitySides } from './force-deployment.js';

export interface LayeredGenerationOptions extends FieldGenerationOptions { plan?: BattlefieldPlan; scene?: BattlefieldScene; unitBindings?: Record<string,string> }
export function recommendedCitySize(roster: readonly Combatant[] = [], size?: BattlefieldPlan['size']): [number, number] {
  if (size === 'large' || !size && roster.length > 20) return [13, 19];
  if (size === 'compact' || !size && roster.length > 0 && roster.length <= 6) return [9, 15];
  return [11, 17];
}
/** Bounded local safety pass: grow instead of dropping cards, changing traits or opening intact walls. */
export function generatedLayeredField(seed: string, width = 7, height = 13, tags: string[] = [], options: LayeredGenerationOptions = {}): BattlefieldSpec {
  const roster = options.roster ?? [], plan = compileScenePlan(normalizeBattlefieldPlan(options.plan).plan);
  const active = roster.filter(u => u.hp > 0 && u.status === 'ready');
  if (active.length > MAX_SMALL_UNITS) throw Error('小战最多32张单位卡，33—64张应采用会战');
  const scene = options.scene ?? resolveBattlefieldScene(plan, environmentTags(tags), width);
  const city = ['city_siege', 'city_streets', 'building_siege'].includes(scene)||!!plan?.intent?.entities.some(e=>e.kind==='city');
  if (plan?.gatePlan?.length && !['city_siege','building_siege','interior'].includes(scene)&&!plan.intent?.entities.some(e=>e.kind==='city'))
    throw new BattlefieldPlanError('此场景不含门墙；门设计请配合city_siege、building_siege或interior');
  let initial: [number, number] = city && width <= 7 ? recommendedCitySize(active, plan?.size)
    : scene === 'interior' && width === 7 ? plan?.size === 'large' ? [9,15] : plan?.size === 'standard' ? [7,13] : [5,7] : [width, height];
  if (!city && scene !== 'interior' && width === 7 && plan?.size) initial = plan.size === 'large' ? [11,17] : plan.size === 'compact' ? [7,9] : [7,13];
  if ((plan?.landmarks?.length ?? 0)>4 && initial[0]<9 && !roster.some(u=>u.pos!==undefined)) initial=[9,15];
  const sizes: [number,number][] = [[5,7], [7,13], [9,15], [11,17], [13,19]];
  // Conservative ground-space floor; actual layers/air/platforms are then checked below.
  const neededWidth = Math.ceil(Math.max(0, ...(['ally', 'enemy'] as const).map(side => active.filter(u => u.side === side).reduce((n,u) => n + footprint(u), 0))) / 6);
  if (initial[0] < neededWidth && !roster.some(u => u.pos !== undefined)) initial = sizes.find(([w]) => w >= neededWidth) ?? sizes.at(-1)!;
  const candidates: [number,number][] = [initial, ...sizes.filter(([w]) => w > initial[0])];
  const fixed = roster.some(u => u.pos !== undefined);
  let lastError: unknown;
  for (const [w,h] of candidates) for(let attempt=0;attempt<(plan?.intent?6:1);attempt++) {
    try {
      const candidateSeed=attempt===0?seed:`${seed}:scene-candidate-${attempt}`;
      const field = generateLayeredCandidate(candidateSeed, w, h, tags, { ...options, plan, scene });
      if(attempt)field.generation!.notes=[...(field.generation!.notes??[]),`为满足正文关系采用第${attempt+1}个本地布局候选`];
      if (active.length) {
        const prepared=prepareGridDeployment(field,active,seed);validateSceneFacts(field,prepared);
        field.initialDeployment=Object.fromEntries(prepared.map(u=>[u.id,{pos:u.pos!,...(u.elevation?{elevation:u.elevation}:{}),...(u.airborne!==undefined?{airborne:u.airborne}:{})}]));
      }
      const wanted = plan?.breaches?.count ?? 0;
      if (!fixed && field.city?.defender && (field.city.breaches?.length ?? 0) < wanted && w < 13) break;
      if (w !== width || h !== height) {
        const requested = city && width === 7 ? recommendedCitySize(active, plan?.size) : [width,height];
        if (w !== requested[0] || h !== requested[1]) field.generation!.notes = [...(field.generation!.notes ?? []), `为容纳完整部署/破口，地图调整为${w}×${h}`];
      }
      return field;
    } catch (error) {
      const relational=!!plan?.intent&&error instanceof Error&&/正文关系|正文指定|合法位置|部署|容量不足/.test(error.message);
      if (!(error instanceof Error)||!relational&&(fixed||!/部署|容量不足/.test(error.message))) throw error;
      lastError = error;
      if (error.message.startsWith('城市与水岸部署容量不足')) break;
      if(!relational)break;
    }
  }
  throw lastError ?? Error('无法为完整名单生成合法部署');
}

/** New preparation only; never call this on a loaded snapshot. No model or combat RNG is involved. */
function generateLayeredCandidate(seed: string, width = 7, height = 13, tags: string[] = [], options: LayeredGenerationOptions = {}): BattlefieldSpec {
  let plan = compileScenePlan(normalizeBattlefieldPlan(options.plan).plan);
  const environment = environmentTags(tags), scene = options.scene ?? resolveBattlefieldScene(plan, environment, width);
  const siege = scene === 'city_siege', city = siege || scene === 'city_streets';
  if (city && width === 7) [width, height] = recommendedCitySize(options.roster, plan?.size);
  const random = new SeededRng('layered-field-v1:' + seed);
  const int = (min: number, max: number) => min + Math.floor(random.next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)]!;
  const supplied=options.plan!==undefined;
  if(!supplied) {
    const archetype=selectSceneArchetype(scene,environment.includes('forest')?'forest':environment.includes('mountain')?'mountain':'plains',seed);
    plan={archetype,...(city?{cityPosition:(options.attackingSide??'ally')==='ally'?'north':'south'}:{}),
      ...(siege?{shape:archetype==='riverside'?'riverside':archetype==='hilltown'?'hillside':'front'}:{}),
      ...(['river_crossing','forest_stream','riverside'].includes(archetype)?{water:'river',bridgePlan:[{anchor:'center',state:'intact',width:1}],...(archetype==='riverside'?{waterPosition:'east',waterAxis:'vertical'}:{})}:{})};
  }
  // Preserve route-builder variety; it remains useful for streets and ordinary outdoor terrain.
  let field = generatedField(seed, width, height, tags, options);
  if (plan) field = generatedField(seed, width, height, tags, { ...options,
    design: { ...field.generation!.design, feature: 'none', ...(plan.layout ? { layout: plan.layout } : {}), ...(plan.topology ? { topology: plan.topology } : {}),
      ...(plan.density ? { obstacles: plan.density, cover: plan.density } : {}),
      ...Object.fromEntries((['orientation', 'relief', 'cover', 'obstacles', 'breadth'] as const).filter(k => plan[k] !== undefined).map(k => [k, plan[k]])) } });
  field.layerVersion = 1; field.terrainRevision = 0;
  field.structures = field.tiles.map((t, p) => {
    if (t === 'cover') { field.tiles[p] = 'open'; return createStructure('cover', plan?.fortLevel ?? 2); }
    if (t === 'wall') {
      field.tiles[p] = ['urban', 'siege', 'indoor'].includes(field.generation!.family) ? 'street' : 'cliff';
      return field.tiles[p] === 'street' ? createStructure('building', plan?.fortLevel ?? 3) : null;
    }
    return null;
  });
  field.overlays = {}; field.landmarks = [];
  field.generation!.version = 6; field.generation!.scene = scene;
  if (scene === 'interior') field.generation!.family = 'indoor';
  else if (scene === 'city_siege' || scene === 'building_siege') field.generation!.family = 'siege';
  else if (scene === 'city_streets') field.generation!.family = 'urban';
  field.generation!.source = supplied || options.design ? 'context' : 'random';
  delete field.generation!.landmark;
  if (!siege) field.objective = {kind:'annihilation',cell:field.objective.cell,limit:field.objective.limit};
  const attack = options.attackingSide ?? 'ally', defender = attack === 'ally' ? 'enemy' : 'ally';
  const at = (x: number, depth: number) => (defender === 'enemy' ? depth : height - 1 - depth) * width + x;
  const depthOf = (p: number) => defender === 'enemy' ? Math.floor(p / width) : height - 1 - Math.floor(p / width);
  const wallLevel = plan?.fortLevel ?? 3;
  let inner: number[] = [], frontline: number[] = [], gates: number[] = [], core: number[] = [], reserve: number[] = [];
  let frontDepth = Math.floor(height * .53), left = 0, right = width - 1;
  const plannedCity=!!plan&&(!!plan.cityPosition||!!plan.intent?.entities.some(e=>e.kind==='city'));
  if(plannedCity) {
    buildPlannedCity(field,plan!,seed,scene,attack);
    inner=field.city!.inside;frontline=field.city!.frontline;gates=field.city!.gates;core=field.city!.core;reserve=field.city!.reserve;
    frontDepth=frontline.length?Math.max(...frontline.map(depthOf)):Math.floor(height*.53);
    left=Math.min(...inner.map(p=>p%width));right=Math.max(...inner.map(p=>p%width));
  }
  if (city && !plannedCity) {
    field.tiles.fill('open'); field.structures.fill(null);
    const shape: CityShape | 'district' = siege ? plan?.shape ?? pick(CITY_SHAPES.filter(s => s !== 'broken')) : 'district';
    frontDepth = siege ? int(Math.floor(height * .48), Math.floor(height * .60)) : height - 4;
    if (shape === 'enclosure' || shape === 'broken') { left = int(1, 2); right = width - 2; }
    const insideMin = siege ? shape === 'enclosure' || shape === 'broken' ? 2 : 0 : 2;
    const road = new Set<number>();
    const mainX = int(left + 2, right - 2), secondaryX = mainX < width / 2 ? right - 1 : left + 1;
    for (let d = insideMin; d < frontDepth; d++) for (let x = left; x <= right; x++) {
      const p = at(x, d); field.tiles[p] = 'street'; inner.push(p);
    }
    const layout = field.generation!.design.layout;
    const streetWidth = right - left - 1, streetHeight = frontDepth - insideMin;
    const scratch: BattlefieldSpec = { version: 2, width: streetWidth, height: streetHeight, tiles: Array(streetWidth * streetHeight).fill('street'), objective: { kind: 'annihilation', cell: 0, limit: 60 } };
    const streets = buildRouteGraph(scratch, random, { ...field.generation!.design, ...(plan?.topology ? { topology: plan.topology } : {}) });
    const project = (p: number) => at(left + 1 + p % streetWidth, insideMin + Math.floor(p / streetWidth));
    field.generation!.routes = { ...streets, nodes: streets.nodes.map(n => ({ ...n, cell: project(n.cell) })), edges: streets.edges.map(e => ({ ...e, cells: e.cells.map(project) })) };
    for (const edge of streets.edges) for (const p of edge.cells) {
      const cell = project(p); road.add(cell);
      if (edge.role === 'main' && field.generation!.design.breadth === 'broad' && cell % width + 1 < right) road.add(cell + 1);
    }
    // One local gate approach and an inner lateral relief street, not two guaranteed full-map lanes.
    for (const x of [mainX, mainX + 1]) for (let d = Math.max(insideMin, frontDepth - 3); d < frontDepth; d++) road.add(at(x, d));
    for (let x = left + 1; x < right; x++) road.add(at(x, frontDepth - 1));
    const coreX = mainX <= (left + right) / 2 ? Math.max(left + 2, right - 2) : left + 2;
    const coreCell = at(coreX, siege ? 3 : Math.floor(height / 2));
    core = [coreCell, ...neighbors(field, coreCell)].filter(p => inner.includes(p));
    reserve = [at(mainX, Math.max(insideMin + 1, frontDepth - 3)), at(mainX + 1, Math.max(insideMin + 1, frontDepth - 3))];
    for (const p of [...core, ...reserve]) road.add(p);
    // Sample coherent rectangular parcels once, never sprinkle individual building pixels.
    const density = { sparse: .55, balanced: .78, dense: .94 }[plan?.obstacles ?? plan?.density ?? field.generation!.design.obstacles];
    const allocated = new Set<number>();
    for (let d = Math.max(insideMin + 1, 2); d < frontDepth - 1; d++) for (let x = left + 1; x < right; x++) {
      const clear = (xx: number, dd: number) => xx < right && dd < frontDepth - 1 && !road.has(at(xx,dd)) && !allocated.has(at(xx,dd));
      if (!clear(x,d)) continue;
      let rw = 1, rh = 1;
      const maxW = int(2,3), maxH = layout === 'lanes' ? 4 : int(2,3);
      while (rw < maxW && clear(x+rw,d)) rw++;
      while (rh < maxH && Array.from({length:rw},(_,i)=>i).every(i=>clear(x+i,d+rh))) rh++;
      const parcel = Array.from({length:rw*rh},(_,i)=>at(x+i%rw,d+Math.floor(i/rw)));
      parcel.forEach(p=>allocated.add(p));
      if (parcel.length < 2) continue;
      const built = random.next() < density;
      const ruined = !built && random.next() < { sparse: .08, balanced: .22, dense: .5 }[plan?.relief ?? 'balanced'];
      for (const p of parcel) {
        if (built) field.structures[p] = createStructure('building', wallLevel);
        else if (ruined) field.overlays[p] = ['rubble'];
      }
    }
    // Lay natural boundaries before selecting breaches so a hole cannot lead into deep water/cliff.
    if (shape === 'riverside' && plan?.water !== 'none') for (let d = 0; d < height; d++) for (const x of [0]) {
      const p = at(x, d); if (!frontline.includes(p) && !core.includes(p)) { field.tiles[p] = 'deep_water'; field.structures[p] = null; }
    }
    if (shape === 'hillside') for (let d = 2; d < frontDepth; d++) {
      const p = at(0, d); if (!frontline.includes(p) && !core.includes(p)) { field.tiles[p] = 'cliff'; field.structures[p] = null; }
    }
    if (siege) {
      const putWall = (p: number) => {
        const access = neighbors(field, p).filter(n => inner.includes(n) && !field.structures![n]);
        field.structures![p] = createStructure('wall', wallLevel, { top: true, owner: defender, access });
        field.tiles[p] = 'street'; frontline.push(p);
      };
      for (let x = left; x <= right; x++) putWall(at(x, frontDepth));
      if (left > 0) {
        for (let d = 1; d < frontDepth; d++) { putWall(at(left, d)); putWall(at(right, d)); }
        for (let x = left + 1; x < right; x++) putWall(at(x, 1));
        inner = inner.filter(p => p % width > left && p % width < right);
      }
      const gate = (p: number) => {
        field.structures![p] = createStructure('gate', wallLevel, { top: true, owner: defender, access: neighbors(field, p).filter(n => inner.includes(n) && !field.structures![n]) });
        gates.push(p);
      };
      const gateMode = plan?.gatePlan ? 'none' : plan?.gates ?? pick(['single', 'side', 'double']);
      if (gateMode !== 'none') gate(at(mainX, frontDepth));
      if (gateMode === 'side' || gateMode === 'double') {
        const second = gateMode === 'side' && left > 0 ? at(right, Math.max(3, frontDepth - 2)) : at(secondaryX, frontDepth);
        if (!gates.includes(second)) gate(second);
      }
      for (const p of gates) {
        if (plan?.gateState === 'open') field.structures[p]!.gateState = 'open';
        if (plan?.gateState === 'destroyed') {
          field.structures[p]!.hp = 0; field.structures[p]!.gateState = 'destroyed'; field.overlays[p] = ['rubble'];
        }
      }
      if (plan?.gatePlan) {
        const candidates = frontline.filter(p => neighbors(field,p).some(n => inner.includes(n) && !frontline.includes(n))
          && neighbors(field,p).some(n => !inner.includes(n) && !frontline.includes(n) && !groundBlocked(field,n)));
        gates = placePlannedGates(field,candidates,plan.gatePlan,defender,wallLevel,inner);
      }
      for (const x of [left + 1, right - 1]) {
        const p = at(x, frontDepth - 1);
        if (!core.includes(p) && !gates.some(g => gridDistance(field, g, p) === 1)) field.structures[p] = createStructure('fortification', wallLevel);
      }
      field.objective = { kind: 'control', cell: coreCell, cells: core, attackingSide: attack, rounds: 2, limit: field.objective.limit };
    }
    // Optional cover is independent of buildings; never blocks primary streets, core or wall access.
    const coverDensity = plan?.cover ?? plan?.density;
    if (coverDensity) for (const p of inner) {
      if (field.structures[p] || road.has(p) || frontline.includes(p) || core.includes(p) || reserve.includes(p)) continue;
      if (random.next() < { sparse: .05, balanced: .15, dense: .3 }[coverDensity]) field.structures[p] = createStructure('cover', wallLevel);
    }
    for (const p of road) if (!field.structures[p]) field.overlays[p] = ['road'];
    field.city = { shape, inside: inner, frontline: [...new Set(frontline)], gates, core, reserve, ...(siege ? { defender } : {}) };
    if (siege) {
      const breachPlan = plan?.breaches ?? { count: shape === 'broken' ? 1 : !plan && random.next() < .2 ? 1 : 0 };
      const breached = carveInitialBreaches(field, frontline, inner, breachPlan, defender, random);
      field.city.breaches = breached.groups;
      if (breached.notes.length) field.generation!.notes = [...(field.generation!.notes ?? []), ...breached.notes];
    }
    // Connect pockets by opening ordinary parcel walls only. Never cut a city perimeter or gate.
    for (const p of inner.filter(p => !groundBlocked(field, p))) {
      const goal = core[0]!;
      if (findGridPath(field, p, goal, n => inner.includes(n) && !groundBlocked(field, n))) continue;
      const path = findGridPath(field, p, goal, n => inner.includes(n) && (!field.structures![n] || field.structures![n]?.kind === 'building'), n => field.structures![n] ? field.tiles.length : 1);
      for (const n of path?.cells ?? []) if (field.structures[n]?.kind === 'building') { field.structures[n] = null; field.overlays[n] = ['road']; }
    }
    // Keep the projected inner street graph as provenance; perimeter reachability is capability-based.
    if (!siege) field.objective.cell = core[0]!;
  }
  if (['interior','building_siege','trenches'].includes(scene)) {
    buildSpecialScene(field,scene,plan?{...plan,...(plan.archetype==='fortress'?{layout:'strongpoint'}:plan.archetype==='great_hall'?{breadth:'broad'}:{})}:plan,random,attack);
    inner=field.city?.inside ?? []; frontline=field.city?.frontline ?? []; gates=field.city?.gates ?? [];
    core=field.city?.core ?? []; reserve=field.city?.reserve ?? [];
    if (field.city) {
      frontDepth=Math.max(...frontline.map(depthOf));
      left=Math.min(...frontline.map(p=>p%width)); right=Math.max(...frontline.map(p=>p%width));
      const breached=carveInitialBreaches(field,frontline,inner,plan?.breaches??{count:0},defender,random);
      field.city.breaches=breached.groups;
      if (breached.notes.length) field.generation!.notes=[...(field.generation!.notes??[]),...breached.notes];
    }
  }
  // Water changes routes. Bridges are real structures; no trait is granted to the roster.
  const water = scene === 'interior' ? 'none' : plan?.water ?? (scene !== 'field' ? 'none' : pick(['none', 'none', 'none', 'ford', 'river'] as const));
  if(plan&&(plan.bridgePlan!==undefined||plan.waterAxis||plan.intent?.entities.some(e=>e.kind==='river'))) {
    buildPlannedWater(field,{...plan,water},seed);
  } else if (water !== 'none' && width > 5) {
    const d = city ? Math.min(height - 4, frontDepth + 2) : Math.floor(height / 2);
    // Keep the actual approach paths when laying water over existing terrain.
    // Random bridge columns alone can land behind cliffs and disconnect the goal.
    const crossings = new Set<number>();
    if (!city && water !== 'ford') for (const origin of [at(Math.floor(width / 2), 1), at(Math.floor(width / 2), height - 2)]) {
      const approach = findGridPath(field, origin, field.objective.cell, p => !groundBlocked(field, p));
      for (const p of approach?.cells ?? []) if (depthOf(p) === d) crossings.add(p);
    }
    for (let x = 0; x < width; x++) {
      const p = at(x, d); if (p === field.objective.cell || core.includes(p) || field.structures[p]?.kind === 'wall' || field.structures[p]?.kind === 'gate') continue;
      field.tiles[p] = water === 'ford' ? 'shallow_water' : 'deep_water'; field.structures[p] = null; delete field.overlays[p];
    }
    if (water !== 'ford') for (const x of [int(1, Math.floor(width / 2) - 1), int(Math.floor(width / 2) + 1, width - 2)]) {
      crossings.add(at(x, d));
    }
    for (const p of crossings) if (field.tiles[p] === 'deep_water') {
      field.structures[p] = createStructure('bridge', wallLevel); field.overlays[p] = ['road'];
    }
  }
  if(plan?.archetype)applySceneArchetype(field,plan.archetype,seed);
  // Marshes are passable but expensive and do not blanket a primary approach.
  if (scene === 'field' && width > 5 && random.next() < .45) {
    const p = at(pick([0, width - 1]), int(3, height - 4));
    if (!field.structures[p] && !['cliff', 'deep_water', 'shallow_water'].includes(field.tiles[p]!) && p !== field.objective.cell) field.tiles[p] = 'swamp';
  }
  // Explicit roster cells are honored only within legitimate deployment regions at battle start.
  for (const u of options.roster ?? []) if (Number.isInteger(u.pos) && u.pos! >= 0 && u.pos! < field.tiles.length && !frontline.includes(u.pos!)) {
    if (field.structures[u.pos!]?.kind === 'building') field.structures[u.pos!] = null;
  }
  const defaults: LandmarkPlan[] = scene === 'interior' ? [{kind:'room',anchor:'center',label:'主厅'}]
    : scene === 'building_siege' ? [{kind:'building',anchor:'core',label:'目标建筑'}]
    : scene === 'trenches' ? [{kind:'fortification',anchor:'front_left',label:'前沿阵地'}]
    : city ? [{kind:'square',anchor:'core'}, {kind:'building',anchor:'inside_left'}]
    : random.next() < .2 ? [] : [{kind:pick(['hill','forest','fortification'] as const),anchor:pick(['center','front_left','front_right'] as const)}];
  const labels = { square:'城区广场', tower:'瞭望塔', ruins:'残垣废墟', fortification:'防御阵地', hill:'制高地', forest:'林间据点', bridge:'渡河桥', building:'地标建筑', room:'房间', cover:'掩体群', position:'战术要点' };
  const marked = new Set<number>();
  const protectedCells = new Set([...core, field.objective.cell, ...gates, ...(options.roster??[]).flatMap(u=>u.pos!==undefined?[u.pos]:[]), ...(field.city?.frontline ?? []),
    ...field.structures.flatMap((s,p)=>s?.kind==='gate'?[p]:[])]);
  // Cell beside an already built entity (landmark, bridge, gate, city or river), two cells toward the stated side.
  const besideCell = (near: NonNullable<LandmarkPlan['near']>): number | undefined => {
    const kind = plan?.intent?.entities.find(e => e.id === near.id)?.kind;
    const cells = field.landmarks!.find(l => l.id === near.id)?.cells
      ?? (kind === 'city' ? field.city?.inside : kind === 'river' ? field.tiles.flatMap((t, n) => t === 'deep_water' || t === 'shallow_water' ? [n] : [])
        : field.structures!.flatMap((s, n) => s?.entityId === near.id ? [n] : []));
    if (!cells?.length) return undefined;
    const x = Math.round(cells.reduce((s, n) => s + n % field.width, 0) / cells.length) + (near.side === 'east' ? 2 : near.side === 'west' ? -2 : 0);
    const y = Math.round(cells.reduce((s, n) => s + Math.floor(n / field.width), 0) / cells.length) + (near.side === 'south' ? 2 : near.side === 'north' ? -2 : 0);
    return Math.max(0, Math.min(field.height - 1, y)) * field.width + Math.max(0, Math.min(field.width - 1, x));
  };
  // A supplied plan never inherits random fallback landmarks, including an omitted/empty list.
  for (const mark of (supplied ? plan?.landmarks ?? [] : defaults).slice(0, plan?.intent ? 12 : 5)) {
    if (scene === 'interior' && ['hill','forest','bridge','tower','square','building'].includes(mark.kind))
      throw new BattlefieldPlanError('室内地标与场景不匹配，请使用room、cover、position、ruins或fortification');
    if (mark.kind === 'room' && !['interior','building_siege'].includes(scene))
      throw new BattlefieldPlanError('房间地标需要室内或建筑围攻场景');
    const semanticCore = ['square','position','room'].includes(mark.kind) || scene === 'building_siege' && mark.kind === 'building';
    let anchor=(mark.near && besideCell(mark.near)) ?? landmarkAnchorCell(field,mark.anchor,defender,frontDepth,left,right);
    if(mark.edge){const x=anchor%width,y=Math.floor(anchor/width);anchor=mark.anchor.includes('west')?y*width:mark.anchor.includes('east')?y*width+width-1:mark.anchor.includes('north')?x:mark.anchor.includes('south')?(height-1)*width+x:anchor;}
    let p = anchor;
    if (mark.anchor==='riverbank') p=landmarkCandidates(field,mark,anchor,n=>!protectedCells.has(n)&&!marked.has(n))[0]??-1;
    if(p<0) { if(plan) throw new BattlefieldPlanError('河岸地标没有合法水岸位置'); else continue; }
    if (semanticCore && mark.anchor === 'core' && core.length) p = core[0]!;
    if (mark.kind === 'fortification' && scene === 'trenches') {
      const trench=field.structures.flatMap((s,n)=>s?.kind==='fortification'&&!marked.has(n)?[n]:[]);
      p=trench.sort((a,b)=>gridDistance(field,a,p)-gridDistance(field,b,p)||a-b)[0] ?? p;
    } else if (mark.kind === 'building' && scene !== 'building_siege') {
      let plots=landmarkCandidates(field,mark,anchor,n=>field.structures![n]?.kind==='building'&&!marked.has(n)&&!protectedCells.has(n));
      // Outdoors a named building with no parcel nearby, such as a mill outside the walls, is built on open ground.
      if (!plots.length && scene !== 'interior') {
        plots = landmarkCandidates(field, mark, anchor, n => !marked.has(n) && !protectedCells.has(n) && !groundBlocked(field,n) && !field.overlays![n]?.includes('road') && !['deep_water','shallow_water'].includes(field.tiles[n]!));
        if (plots[0] !== undefined) field.structures[plots[0]] = createStructure('building', mark.level ?? wallLevel);
      }
      if (!plots.length) { if (plan) throw new BattlefieldPlanError('建筑地标部署容量不足，请调整布局或地标'); else continue; }
      p=plots.sort((a,b)=>gridDistance(field,a,p)-gridDistance(field,b,p)||a-b)[0]!;
    } else if (mark.kind === 'building' && scene === 'building_siege') {
      p=inner.filter(n=>!marked.has(n)&&!groundBlocked(field,n)).sort((a,b)=>gridDistance(field,a,p)-gridDistance(field,b,p)||a-b)[0] ?? p;
    } else if (mark.kind === 'bridge') {
      const waters = field.tiles.flatMap((t, n) => (plan?.bridgePlan!==undefined?field.structures![n]?.kind==='bridge':t === 'deep_water' || t === 'shallow_water') ? [n] : []);
      if (!waters.length) { if (plan) throw new BattlefieldPlanError('桥梁地标需要水域，请在同一设计中选择river、ford或moat'); else continue; }
      p = waters.sort((a, b) => gridDistance(field, a, p) - gridDistance(field, b, p) || a - b)[0]!;
    } else if (protectedCells.has(p) && !(semanticCore && core.includes(p)) || marked.has(p) || groundBlocked(field,p)||['deep_water','shallow_water'].includes(field.tiles[p]!)
      || mark.kind === 'tower' && !!field.overlays[p]?.includes('road')) {
      // A tower never stands on a road; relocate it within the requested area instead of failing.
      const candidate = landmarkCandidates(field,mark,anchor,n=>!marked.has(n)&&(!protectedCells.has(n)||semanticCore&&n===field.objective.cell)&&!groundBlocked(field,n)&&!['deep_water','shallow_water'].includes(field.tiles[n]!)
        &&!(mark.kind === 'tower' && field.overlays![n]?.includes('road')))[0];
      if (candidate === undefined) { if(plan) throw new BattlefieldPlanError(`地标${mark.label??mark.kind}在指定区域部署容量不足`); else continue; } p = candidate;
    }
    if (mark.kind === 'tower' && (city || plannedCity) && inner.includes(p)) {
      // Replace an already closed parcel; never sever an existing alley for a tower.
      const plots = landmarkCandidates(field,mark,anchor,n=>inner.includes(n)&&field.structures![n]?.kind==='building'&&!marked.has(n)&&!protectedCells.has(n));
      // With no parcel to replace, the tower stands on open ground just outside the town instead.
      const outside = plots.length ? [] : landmarkCandidates(field,mark,anchor,n=>!inner.includes(n)&&!(field.city?.frontline??[]).includes(n)&&!marked.has(n)&&!protectedCells.has(n)
        &&!groundBlocked(field,n)&&!field.overlays![n]?.includes('road')&&!['deep_water','shallow_water'].includes(field.tiles[n]!));
      if (!plots.length && !outside.length) { if (plan) throw new BattlefieldPlanError('塔楼地标部署容量不足，请调整布局或地标'); else continue; }
      p = plots.length ? plots.sort((a, b) => gridDistance(field, a, p) - gridDistance(field, b, p) || a - b)[0]! : outside[0]!;
    }
    const cells = [p];
    if (mark.kind==='building' && scene==='building_siege' && mark.state==='destroyed') cells.push(...(field.city?.frontline??[]));
    if(mark.kind==='building'&&field.structures[p]?.entityId)cells.push(...field.structures.flatMap((s,n)=>n!==p&&s?.entityId===field.structures![p]!.entityId?[n]:[]));
    if (mark.scale === 'major' && mark.kind !== 'tower' && mark.kind !== 'bridge' && mark.kind !== 'building') {
      const size=Math.max(3,Math.min(10,Math.ceil(field.tiles.length*.04)));
      for(let i=0;i<cells.length&&cells.length<size;i++)for(const n of neighbors(field,cells[i]!)) {
        if(cells.length>=size)break;
        if(!cells.includes(n)&&!protectedCells.has(n)&&!marked.has(n)&&!groundBlocked(field,n)&&!['deep_water','shallow_water'].includes(field.tiles[n]!))cells.push(n);
      }
    }
    for (const n of cells) {
      if (core.includes(n) && !semanticCore) continue;
      if (mark.kind === 'ruins') field.overlays[n] = [...new Set([...(field.overlays[n] ?? []), 'rubble' as const])];
      else if (mark.kind === 'fortification') field.structures[n] = createStructure('fortification', mark.level ?? wallLevel);
      else if (mark.kind === 'cover') field.structures[n] = createStructure('cover', mark.level ?? wallLevel);
      else if (mark.kind === 'bridge'&&plan?.bridgePlan===undefined) field.structures[n] = createStructure('bridge', mark.level ?? wallLevel,{entityId:mark.id??`bridge_${n}`});
      else if (mark.kind === 'tower') {
        // A tower stands beside circulation, never replaces a gate or the objective.
        if (field.overlays[n]?.includes('road') || protectedCells.has(n)) continue;
        field.structures[n] = createStructure('tower', mark.level ?? wallLevel, { top: true, access: neighbors(field, n).filter(q => !groundBlocked(field, q)) });
      } else if (mark.kind === 'square') { field.structures[n] = null; if (!city) field.tiles[n] = 'open'; }
      else if (mark.kind === 'hill' || mark.kind === 'forest') field.tiles[n] = mark.kind; // Explicit parks/high ground are the only natural-terrain exceptions to street parcels.
    }
    const actual = cells.filter(n => !marked.has(n) && !(core.includes(n) && !semanticCore)
      && (mark.kind !== 'tower' || field.structures![n]?.kind === 'tower'));
    if (mark.state === 'destroyed') for (const n of actual) {
      const structure = field.structures[n];
      if (structure) structure.hp = 0;
      // A ruined compound takes its gate with it; a gate at zero durability is a destroyed gate.
      if (structure?.kind === 'gate') structure.gateState = 'destroyed';
      field.overlays[n] = [...new Set([...(field.overlays[n] ?? []), 'rubble' as const])];
    }
    if (!actual.length) {if(supplied)throw new BattlefieldPlanError(`地标${mark.label??mark.kind}没有合法位置，部署容量不足`);else continue;}
    actual.forEach(n => marked.add(n));
    field.landmarks.push({ ...(mark.id?{id:mark.id}:{}), kind: mark.kind, label: safeLandmarkLabel(mark.label) ?? labels[mark.kind], cells: actual, scale: mark.scale ?? 'minor' });
    if(p!==anchor && mark.anchor!=='riverbank' && !mark.near) field.generation!.notes=[...(field.generation!.notes??[]),`地标${mark.label??labels[mark.kind]}在指定区域内调整${gridDistance(field,p,anchor)}格`];
  }
  if (plan?.landmarks?.length && !field.landmarks.length) throw new BattlefieldPlanError('请求的地标无法落到合法位置，未使用随机地标；请调整设计');
  finishSceneRegions(field,plan,options.unitBindings,options.roster);
  applyPlannedDeployments(field,plannedCity&&!field.city?.defender?withCitySides(field,plan!):plan,options.roster,options.unitBindings);
  initializeHeightMap(field,plan);
  deriveRetreatEdges(field);
  validateSceneFacts(field);
  validateField(field);
  return field;
}
