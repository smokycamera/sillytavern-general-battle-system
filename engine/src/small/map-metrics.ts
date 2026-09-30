import { findGridPath, gridCostsToGoals, lineOfSight, unitLineOfSight,neighbors, tileCost,TERRAIN_NAMES, type BattlefieldSpec, type Terrain } from './spatial.js';
import { landmarkCells } from './map-design.js';
import { groundBlocked,structureAt } from './layers.js';
import { heightStepCost } from './height-map.js';
import type { Combatant } from '../types.js';

export interface MapMetrics {
  terrainComponents: Record<Terrain, number>;
  routeBranches: number;
  lateralLinks: number;
  narrowRegions: number;
  criticalCuts: number;
  shortestContactSteps: number;
  shortestContactCost: number;
  alternativePaths: number;
  meanLOS: number;
  coverFraction: number;
  coverCentroid: [number, number] | null;
  terrainCentroid: [number, number] | null;
  objectiveDistances: { enemy: number; ally: number };
  landmarkDistances?: { enemy: number; ally: number };
  spatialProfile: number[];
  signature: string;
}
function components(field: BattlefieldSpec, cells: Set<number>): number {
  const remaining = new Set(cells); let count = 0;
  while (remaining.size) {
    count++; const queue = [remaining.values().next().value!]; remaining.delete(queue[0]!);
    for (let i = 0; i < queue.length; i++) for (const p of neighbors(field, queue[i]!)) if (remaining.delete(p)) queue.push(p);
  }
  return count;
}
function centroid(field: BattlefieldSpec, cells: number[]): [number, number] | null {
  if (!cells.length) return null;
  return [cells.reduce((s, p) => s + p % field.width / (field.width - 1), 0) / cells.length,
    cells.reduce((s, p) => s + Math.floor(p / field.width) / (field.height - 1), 0) / cells.length];
}
/** Exact vertex-capacity max flow from deployment edge to deployment edge, capped at width.
 * This measures alternative physical corridors, not RNG hashes or graph labels. */
function corridorCapacity(field: BattlefieldSpec,origins:number[],goals:number[]): number {
  const n = field.tiles.length, source = n * 2, sink = source + 1, size = sink + 1;
  const capacity = Array.from({ length: size }, () => new Int16Array(size));
  const adjacency: number[][] = Array.from({ length: size }, () => []);
  const add = (a: number, b: number, cap: number) => {
    if (!adjacency[a]!.includes(b)) { adjacency[a]!.push(b); adjacency[b]!.push(a); }
    capacity[a]![b] = cap;
  };
  for (let p = 0; p < n; p++) if (!groundBlocked(field,p)) {
    add(p * 2, p * 2 + 1, 1);
    if (origins.includes(p)) add(source, p * 2, 1);
    if (goals.includes(p)) add(p * 2 + 1, sink, 1);
    for (const next of neighbors(field, p)) if (!groundBlocked(field,next)&&Number.isFinite(heightStepCost(field,p,next))) add(p * 2 + 1, next * 2, field.width);
  }
  let flow = 0;
  while (flow < field.width) {
    const previous = new Int16Array(size).fill(-1), queue = [source]; previous[source] = source;
    for (let i = 0; i < queue.length && previous[sink] === -1; i++) for (const next of adjacency[queue[i]!]!) {
      if (previous[next] === -1 && capacity[queue[i]!]![next]! > 0) { previous[next] = queue[i]!; queue.push(next); }
    }
    if (previous[sink] === -1) break;
    for (let p = sink; p !== source; p = previous[p]!) { capacity[previous[p]!]![p]!--; capacity[p]![previous[p]!]!++; }
    flow++;
  }
  return flow;
}
export function tileSimilarity(a: BattlefieldSpec, b: BattlefieldSpec): number {
  if (a.width !== b.width || a.height !== b.height) throw Error('只比较相同尺寸的地图');
  return a.tiles.filter((t, p) => b.tiles[p] === t).length / a.tiles.length;
}
/** Offline audit only. No expensive pairwise/flow measurement is run during turns or rendering. */
export function measureMap(field: BattlefieldSpec,units:readonly Combatant[]=[]): MapMetrics {
  const walkable = new Set(field.tiles.flatMap((_, p) => groundBlocked(field,p) ? [] : [p]));
  const routes = new Set(field.generation?.routes?.edges.flatMap(e => e.cells).filter(p => walkable.has(p))
    ?? field.tiles.flatMap((t, p) => t === 'open' ? [p] : []));
  const degree = (p: number, cells: Set<number>) => neighbors(field, p).filter(n => cells.has(n)).length;
  const branches = new Set([...routes].filter(p => degree(p, routes) >= 3));
  const narrow = new Set([...walkable].filter(p => p >= field.width && p < field.tiles.length - field.width && degree(p, walkable) <= 2));
  let lateralLinks = 0, previousLateral = false;
  for (let y = 1; y < field.height - 1; y++) {
    let run = 0, longest = 0;
    for (let x = 0; x < field.width; x++) { run = routes.has(y * field.width + x) ? run + 1 : 0; longest = Math.max(longest, run); }
    const lateral = longest >= Math.ceil(field.width / 2);
    if (lateral && !previousLateral) lateralLinks++;
    previousLateral = lateral;
  }
  const starts=(side:'ally'|'enemy')=>{
    const deployed=units.filter(u=>u.side===side&&u.pos!==undefined&&!u.airborne&&!u.elevation).map(u=>u.pos!);
    const zones=field.deploymentZones?.filter(z=>z.side===side).flatMap(z=>z.cells);
    return [...new Set(deployed.length?deployed:zones?.length?zones:[...walkable].filter(p=>side==='enemy'?p<field.width:p>=field.tiles.length-field.width))].filter(p=>walkable.has(p));
  };
  const top=starts('enemy'),bottom=starts('ally');
  const allowed = (p: number) => walkable.has(p);
  const costs = gridCostsToGoals(field, bottom, allowed), steps = gridCostsToGoals(field, bottom, allowed, (p,from) => Number.isFinite(heightStepCost(field,from,p))?1:Infinity);
  const from = top.reduce((best, p) => (costs.get(p) ?? Infinity) < (costs.get(best) ?? Infinity) ? p : best, top[0]!);
  const fromCosts = gridCostsToGoals(field, [from], allowed);
  const path = findGridPath(field, from, bottom.reduce((best, p) =>
    (fromCosts.get(p) ?? Infinity) < (fromCosts.get(best) ?? Infinity) ? p : best, bottom[0]!), allowed);
  let criticalCuts = 0;
  for (const blocked of path?.cells.filter(p => p >= field.width && p < field.tiles.length - field.width) ?? []) {
    const reach = gridCostsToGoals(field, bottom, p => p !== blocked && allowed(p), (p,from) => Number.isFinite(heightStepCost(field,from,p))?1:Infinity);
    if (!top.some(p => reach.has(p))) criticalCuts++;
  }
  let rays = 0, lengths = 0;
  for (const p of walkable) for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    let length = 0;
    for (let step = 1; step < Math.max(field.width, field.height); step++) {
      const x = p % field.width + dx! * step, y = Math.floor(p / field.width) + dy! * step;
      const target=y*field.width+x;
      if (x < 0 || y < 0 || x >= field.width || y >= field.height || !(field.spatialRulesVersion===2?unitLineOfSight(field,{pos:p,rulesVersion:'v2'} as Combatant,{pos:target,rulesVersion:'v2'} as Combatant):lineOfSight(field, p, target))) break;
      length += Math.hypot(dx!, dy!);
    }
    rays++; lengths += length;
  }
  const terrainComponents = Object.fromEntries((Object.keys(TERRAIN_NAMES) as Terrain[])
    .map(t => [t, components(field, new Set(field.tiles.flatMap((v, p) => v === t ? [p] : [])))])) as Record<Terrain, number>;
  const covers = field.tiles.flatMap((t, p) => t === 'cover' || t === 'forest'||['cover','fortification'].includes(structureAt(field,p)?.kind??'') ? [p] : []);
  const distances = (goals: number[]) => {
    const map = gridCostsToGoals(field, goals.filter(allowed), allowed);
    return { enemy: Math.min(...top.map(p => map.get(p) ?? Infinity)), ally: Math.min(...bottom.map(p => map.get(p) ?? Infinity)) };
  };
  const spatialProfile: number[] = [];
  for (let by = 0; by < 3; by++) for (let bx = 0; bx < 3; bx++) {
    const cells = field.tiles.map((_, p) => p).filter(p => Math.min(2, Math.floor(p % field.width * 3 / field.width)) === bx
      && Math.min(2, Math.floor(Math.floor(p / field.width) * 3 / field.height)) === by);
    // Macro geometry includes blockers, movement resistance, cover and high ground separately.
    for (const test of [(p: number) => groundBlocked(field,p), (p: number) => tileCost(field, p) > 1,
      (p: number) => covers.includes(p), (p: number) => field.spatialRulesVersion===2?(field.groundHeight?.[p]??0)>0:field.tiles[p] === 'hill']) {
      spatialProfile.push(Math.round(cells.filter(test).length / cells.length * 4));
    }
  }
  const result: MapMetrics = { terrainComponents, routeBranches: components(field, branches), lateralLinks,
    narrowRegions: components(field, narrow), criticalCuts,
    shortestContactSteps: Math.min(...top.map(p => steps.get(p) ?? Infinity)),
    shortestContactCost: Math.min(...top.map(p => costs.get(p) ?? Infinity)), alternativePaths: corridorCapacity(field,top,bottom),
    meanLOS: lengths / rays, coverFraction: covers.length / field.tiles.length, coverCentroid: centroid(field, covers),
    terrainCentroid: centroid(field, field.tiles.flatMap((t, p) => t !== 'open' ? [p] : [])),
    objectiveDistances: distances([field.objective.cell]),
    ...(landmarkCells(field).length ? { landmarkDistances: distances(landmarkCells(field)) } : {}),
    spatialProfile, signature: '',
  };
  result.signature = [...spatialProfile, result.routeBranches, result.lateralLinks, result.narrowRegions,
    result.shortestContactCost, result.alternativePaths, Math.round(result.meanLOS * 2)].join(',');
  return result;
}
/** Names, entity handles, grades and durability do not count as a different layout. */
export function geometrySignature(field:BattlefieldSpec):string {
  return JSON.stringify([field.tiles,field.groundHeight,field.heightTransitions,field.structures?.map(s=>s?{kind:s.kind,intact:s.hp>0,gateState:s.gateState,top:s.top,access:s.access,platformHeight:s.platformHeight,deckHeight:s.deckHeight,obstructionHeight:s.obstructionHeight}:null),field.overlays,field.city?{inside:field.city.inside,frontline:field.city.frontline,gates:field.city.gates,core:field.city.core}:undefined]);
}
