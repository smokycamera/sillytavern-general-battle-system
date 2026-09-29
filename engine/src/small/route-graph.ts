import type { SeededRng } from '../rng.js';
import type { BattlefieldSpec } from './spatial.js';
import { neighbors, findGridPath } from './spatial.js';
import type { MapDesign } from './map-design.js';

export const ROUTE_TOPOLOGIES = {
  spine_branches: '主路与双支路', y_fork: 'Y型分叉', braid: '汇合后再分叉',
  flank: '中央主路与单侧迂回', ring: '外围环路', parallel: '三路并行',
  alleys: '多条曲折窄路', crosslinks: '横向联络路网', courtyards: '主路与院落支巷',
} as const;
export type RouteTopology = keyof typeof ROUTE_TOPOLOGIES;
export interface RouteNode { id: string; cell: number }
export interface RouteEdge { from: string; to: string; role: 'main' | 'branch' | 'link' | 'dead_end'; cells: number[] }
export interface RouteGraph { kind: RouteTopology; nodes: RouteNode[]; edges: RouteEdge[]; repairs: number[] }

/** A small abstract graph is embedded before terrain is painted. Shared trunks and junctions
 * are intentional; safety is checked against the final walkable grid, not two reserved rails. */
export function buildRouteGraph(field: BattlefieldSpec, rng: SeededRng, design: MapDesign): RouteGraph {
  const kinds = Object.keys(ROUTE_TOPOLOGIES) as RouteTopology[];
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)]!;
  const kind = typeof design.topology === 'string' && Object.hasOwn(ROUTE_TOPOLOGIES, design.topology) ? design.topology : pick(design.route === 'flank' ? ['flank', 'ring', 'courtyards'] as const
    : design.route === 'direct' ? ['spine_branches', 'y_fork', 'parallel', 'crosslinks'] as const : kinds);
  const graph: RouteGraph = { kind, nodes: [], edges: [], repairs: [] };
  const mirror = rng.next() < .5, centre = .5 + (rng.next() - .5) * .44;
  const upper = .25 + rng.next() * .08, lower = .65 + rng.next() * .10;
  const node = (id: string, x: number, y: number) => {
    const xx = Math.max(0, Math.min(field.width - 1, Math.round((mirror ? 1 - x : x) * (field.width - 1))));
    const yy = Math.max(0, Math.min(field.height - 1, Math.round(y * (field.height - 1))));
    graph.nodes.push({ id, cell: yy * field.width + xx });
  };
  node('top', centre, 0); node('bottom', centre, 1);
  node('u', centre, upper); node('m', centre, .5); node('d', centre, lower);
  node('tl', .08, 0); node('tr', .92, 0); node('bl', .08, 1); node('br', .92, 1);
  node('ul', .08, upper); node('ur', .92, upper); node('ml', .08, .5); node('mr', .92, .5);
  node('dl', .08, lower); node('dr', .92, lower);
  const edge = (from: string, to: string, role: RouteEdge['role'] = 'branch') => {
    const a = graph.nodes.find(n => n.id === from)!.cell, b = graph.nodes.find(n => n.id === to)!.cell;
    if (a === b) return;
    let x = a % field.width, y = Math.floor(a / field.width);
    const tx = b % field.width, ty = Math.floor(b / field.width), cells = [a];
    // Axis-aligned edges stay straight; diagonals choose a bend rather than staircase noise.
    const horizontalFirst = design.orientation === 'transverse' || design.orientation === 'diagonal' && rng.next() < .5;
    for (let pass = 0; pass < 2; pass++) {
      const horizontal = pass === 0 ? horizontalFirst : !horizontalFirst;
      while (horizontal ? x !== tx : y !== ty) {
        if (horizontal) x += Math.sign(tx - x); else y += Math.sign(ty - y);
        cells.push(y * field.width + x);
      }
    }
    graph.edges.push({ from, to, role, cells });
  };
  const chain = (ids: string[], role: RouteEdge['role'] = 'branch') => { for (let n = 1; n < ids.length; n++) edge(ids[n - 1]!, ids[n]!, role); };
  switch (kind) {
    case 'spine_branches': chain(['top', 'u', 'm', 'd', 'bottom'], 'main'); chain(['u', 'ul', 'dl', 'd']); chain(['m', 'mr', 'dr', 'd']); break;
    case 'y_fork': chain(['tl', 'ul', 'm', 'd', 'bottom'], 'main'); chain(['tr', 'ur', 'm']); break;
    case 'braid': chain(['tl', 'ul', 'm', 'dl', 'bl'], 'main'); chain(['tr', 'ur', 'm', 'dr', 'br']); break;
    case 'flank': chain(['top', 'u', 'd', 'bottom'], 'main'); chain(['u', 'ur', 'dr', 'd']); break;
    case 'ring': chain(['top', 'u', 'ul', 'dl', 'd', 'bottom'], 'main'); chain(['u', 'ur', 'dr', 'd']); edge('ul', 'ur', 'link'); edge('dl', 'dr', 'link'); break;
    case 'parallel': chain(['top', 'u', 'd', 'bottom'], 'main'); chain(['tl', 'ul', 'dl', 'bl']); chain(['tr', 'ur', 'dr', 'br']); edge('ul', 'u', 'link'); edge('d', 'dr', 'link'); break;
    case 'alleys': chain(['tl', 'ul', 'm', 'd', 'bl'], 'main'); chain(['tr', 'ur', 'mr', 'd', 'br']); chain(['ul', 'ml', 'dl', 'd']); edge('m', 'mr', 'link'); break;
    case 'crosslinks': chain(['tl', 'ul', 'ml', 'dl', 'bl'], 'main'); chain(['tr', 'ur', 'mr', 'dr', 'br']); edge('ul', 'ur', 'link'); edge('ml', 'mr', 'link'); edge('dl', 'dr', 'link'); break;
    case 'courtyards': chain(['top', 'u', 'm', 'd', 'bottom'], 'main'); chain(['u', 'ul', 'ml', 'm']); edge('m', 'mr', 'dead_end'); edge('d', 'dl', 'dead_end'); break;
  }
  const used = new Set(graph.edges.flatMap(e => [e.from, e.to]));
  graph.nodes = graph.nodes.filter(n => used.has(n.id));
  return graph;
}

/** Reachability from both deployment fronts. A shared *area* is legal; a sole blocking tile
 * that seals off the opposing front is not. Repair only that local cut, without a fixed lane. */
export function repairRouteCuts(field: BattlefieldSpec, graph: RouteGraph): void {
  const last = field.tiles.length - field.width;
  const flood = (blocked: number) => {
    const queue = Array.from({ length: field.width }, (_, p) => p).filter(p => p !== blocked && field.tiles[p] !== 'wall');
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const p of neighbors(field, queue[i]!)) {
      if (p !== blocked && field.tiles[p] !== 'wall' && !seen.has(p)) { seen.add(p); queue.push(p); }
    }
    return seen;
  };
  for (let blocked = field.width; blocked < last; blocked++) {
    if (field.tiles[blocked] === 'wall') continue;
    const reached = flood(blocked);
    if ([...reached].some(p => p >= last)) continue;
    const path = findGridPath(field, Math.floor(field.width / 2), last + Math.floor(field.width / 2), p => p !== blocked,
      p => field.tiles[p] === 'wall' ? field.tiles.length + 1 : 1);
    if (!path) throw Error('地图无法构建替代接敌路线');
    for (const p of path.cells) if (field.tiles[p] === 'wall') { field.tiles[p] = 'rough'; graph.repairs.push(p); }
  }
}
