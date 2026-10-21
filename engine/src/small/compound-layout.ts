import type { SeededRng } from '../rng.js';
import type { BattlefieldPlan } from './battlefield-plan.js';
import { createStructure, groundBlocked } from './layers.js';
import { neighbors, gridDistance, type BattlefieldSpec } from './spatial.js';
import { COMPOUND_PATTERNS, type CompoundPattern, type PositionArea } from './position-plan.js';

/** Build the footprint before naming its spaces. An outer wall never doubles as an internal partition. */
export function buildCompoundLayout(field: BattlefieldSpec, plan: BattlefieldPlan | undefined, rng: SeededRng,
  attackingSide: 'ally' | 'enemy'): number[] {
  const { width: w, height: h } = field, defender = attackingSide === 'ally' ? 'enemy' : 'ally';
  const int = (a: number, b: number) => a + Math.floor(rng.next() * (b - a + 1));
  const pattern: CompoundPattern = plan?.compound?.pattern ?? COMPOUND_PATTERNS[int(0, COMPOUND_PATTERNS.length - 1)]!;
  const at = (x: number, d: number) => (defender === 'enemy' ? d : h - 1 - d) * w + x;
  const depth = (p: number) => defender === 'enemy' ? Math.floor(p / w) : h - 1 - Math.floor(p / w);
  const left = int(1, Math.max(1, Math.floor(w * .18))), right = w - 1 - int(1, Math.max(1, Math.floor(w * .16)));
  const back = int(1, 2), front = Math.min(h - 3, Math.max(back + 8, Math.floor(h * .67) + int(-1, 1)));
  const level = plan?.fortLevel ?? 3, footprint = new Set<number>(), perimeter: number[] = [], inside: number[] = [];
  // An offset wing makes the route turn; either side can project farther forward.
  const notchSide = int(0, 1), turn = int(back + 2, front - 2), notch = Math.max(1, Math.floor((right - left) / 3));
  for (let d = back; d <= front; d++) for (let x = left; x <= right; x++) {
    if (pattern === 'dogleg' && (d < turn ? (notchSide ? x > right - notch : x < left + notch)
      : (notchSide ? x < left + notch : x > right - notch))) continue;
    footprint.add(at(x, d));
  }
  for (const p of footprint) {
    field.tiles[p] = 'street';
    if (neighbors(field, p).some(n => !footprint.has(n))) {
      perimeter.push(p); field.structures![p] = createStructure('wall', level, { owner: defender, top: false });
    } else inside.push(p);
  }
  const floor = new Set(inside), internalDoors: number[] = [];
  const wall = (p: number) => { if (floor.has(p)) field.structures![p] = createStructure('wall', level, { owner: defender, top: false }); };
  const door = (cells: number[]) => {
    const usable = cells.filter(p => floor.has(p) && field.structures![p]?.kind === 'wall');
    if (!usable.length) return;
    const p = usable[int(0, usable.length - 1)]!;
    field.structures![p] = createStructure('gate', level, { owner: defender, top: false, gateState: 'open' });
    internalDoors.push(p);
  };
  const across = (d: number) => {
    const row = inside.filter(p => depth(p) === d); row.forEach(wall); door(row);
  };
  if (pattern === 'forecourt') across(int(back + 4, front - 2));
  else if (pattern === 'wings') {
    const lx = left + 2, rx = right - 2;
    for (const [x, end] of [[lx, front - int(2, 3)], [rx, front - int(1, 2)]]) {
      if (x! <= left + 1 || x! >= right - 1 || lx >= rx) continue;
      const line = inside.filter(p => p % w === x && depth(p) > back + 2 && depth(p) <= end!
        || depth(p) === end && (x === lx ? p % w < lx : p % w > rx));
      line.forEach(wall); door(line.filter(p => p % w === x && depth(p) < end!));
    }
  } else if (pattern === 'bailey') {
    const innerFront = Math.min(front - 2, back + Math.max(3, Math.floor((front - back) * .55)));
    const lx = left + 2, rx = right - int(2, Math.min(3, right - left - 3));
    const line = inside.filter(p => depth(p) === innerFront && p % w >= lx && p % w <= rx
      || p % w === lx && depth(p) > back + 2 && depth(p) < innerFront
      || p % w === rx && depth(p) > back + 2 && depth(p) < innerFront);
    line.forEach(wall); door(line.filter(p => depth(p) === innerFront));
  } else if (pattern === 'ruined') {
    const d = int(back + 2, front - 2), gap = int(left + 1, right - 1);
    for (const p of inside.filter(p => depth(p) === d)) {
      if (Math.abs(p % w - gap) > 1 && rng.next() < .75) wall(p);
      else { field.tiles[p] = 'rough'; field.overlays![p] = ['rubble']; }
    }
    for (const p of inside) if (!field.structures![p] && rng.next() < .12) field.overlays![p] = ['rubble'];
  }
  // A rear hall provides an actual enterable building in every compound, with a door into its yard.
  // It is a partition within the defended area, so demolition cannot erase the outer walls by aliasing.
  across(back + 2);
  // Connect side rooms isolated by intersecting hall/wing partitions, without cutting the perimeter.
  for (let pass = 0; pass < inside.length; pass++) {
    const component = new Map<number, number>(); let count = 0;
    for (const start of inside) if (!groundBlocked(field, start) && !component.has(start)) {
      const queue = [start]; component.set(start, count);
      for (let i = 0; i < queue.length; i++) for (const n of neighbors(field, queue[i]!))
        if (floor.has(n) && !groundBlocked(field, n) && !component.has(n)) { component.set(n, count); queue.push(n); }
      count++;
    }
    if (count <= 1) break;
    const candidates = inside.filter(p => field.structures![p]?.kind === 'wall'
      && new Set(neighbors(field, p).map(n => component.get(n)).filter(n => n !== undefined)).size > 1);
    if (!candidates.length) break;
    door(candidates);
  }
  const unseen = new Set(inside.filter(p => !groundBlocked(field, p) && !internalDoors.includes(p))), areas: PositionArea[] = [];
  while (unseen.size) {
    const start = unseen.values().next().value!, cells = [start]; unseen.delete(start);
    for (let i = 0; i < cells.length; i++) for (const n of neighbors(field, cells[i]!)) if (unseen.delete(n)) cells.push(n);
    areas.push({ kind: 'court', label: '院落', cells });
  }
  areas.sort((a, b) => Math.min(...a.cells.map(depth)) - Math.min(...b.cells.map(depth)) || a.cells[0]! - b.cells[0]!);
  areas.forEach((a, i) => {
    a.kind = i === 0 ? 'room' : 'court'; a.label = i === 0 ? '主屋' : i === areas.length - 1 ? '前院' : '内院';
    const x = a.cells.reduce((s, p) => s + p % w, 0) / a.cells.length;
    if (pattern === 'wings' && i > 0 && (x < left + 2 || x > right - 2)) {
      a.kind = 'room'; a.label = x < left + 2 ? '西厢房' : '东厢房';
    }
  });
  const rear = areas[0]?.cells ?? inside.filter(p => !groundBlocked(field, p));
  const target = at(Math.floor((left + right) / 2), back + 1);
  const core = [...rear].sort((a, b) => gridDistance(field, a, target) - gridDistance(field, b, target) || a - b).slice(0, 3);
  field.city = { shape: 'enclosure', inside, frontline: perimeter, gates: [], core,
    reserve: inside.filter(p => !core.includes(p) && !groundBlocked(field, p) && depth(p) < front - 1).slice(0, w), defender };
  field.objective = { kind: 'control', cell: core[0]!, cells: core, attackingSide, rounds: 2, limit: field.objective.limit };
  field.generation!.version = 8;
  field.generation!.compound = { pattern, areas, passages: internalDoors, internalDoors };
  const protectedFloor = new Set([...core, ...internalDoors, ...internalDoors.flatMap(p => neighbors(field, p))]);
  for (const p of inside) if (!protectedFloor.has(p) && !field.structures![p] && rng.next() < (plan?.density === 'dense' ? .12 : plan?.density === 'sparse' ? .025 : .06)) {
    field.structures![p] = createStructure('cover', level);
  }
  return perimeter.filter(p => neighbors(field, p).some(n => floor.has(n) && !groundBlocked(field, n))
    && neighbors(field, p).some(n => !footprint.has(n)));
}
