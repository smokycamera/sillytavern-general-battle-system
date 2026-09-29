import { buildRouteGraph } from './route-graph.js';
import { SeededRng } from '../rng.js';
import { environmentTags } from '../environment.js';
import type { Combatant } from '../types.js';
import { generatedField, type FieldGenerationOptions } from './field-generator.js';
import { normalizeBattlefieldPlan, type BattlefieldPlan, type LandmarkPlan, CITY_SHAPES } from './battlefield-plan.js';
import { createStructure, groundBlocked, type CityShape, type FieldLandmark } from './layers.js';
import { validateField, neighbors, findGridPath, gridDistance, type BattlefieldSpec, type Terrain } from './spatial.js';
import { safeLandmarkLabel } from './map-design.js';

export interface LayeredGenerationOptions extends FieldGenerationOptions { plan?: BattlefieldPlan }
export function recommendedCitySize(roster: readonly Combatant[] = [], size?: BattlefieldPlan['size']): [number, number] {
  if (size === 'large' || !size && roster.length > 20) return [13, 19];
  if (size === 'compact' || !size && roster.length > 0 && roster.length <= 6) return [9, 15];
  return [11, 17];
}
/** New preparation only; never call this on a loaded snapshot. No model or combat RNG is involved. */
export function generatedLayeredField(seed: string, width = 7, height = 13, tags: string[] = [], options: LayeredGenerationOptions = {}): BattlefieldSpec {
  const plan = normalizeBattlefieldPlan(options.plan).plan;
  const environment = environmentTags(tags), siege = environment.includes('siege'), urban = environment.includes('urban');
  const city = width !== 5 && (siege || urban);
  if (city && width === 7) [width, height] = recommendedCitySize(options.roster, plan?.size);
  const random = new SeededRng('layered-field-v1:' + seed);
  const int = (min: number, max: number) => min + Math.floor(random.next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)]!;
  // Preserve route-builder variety; it remains useful for streets and ordinary outdoor terrain.
  let field = generatedField(seed, width, height, tags, options);
  if (plan?.layout || plan?.topology || plan?.density) field = generatedField(seed, width, height, tags, { ...options,
    design: { ...field.generation!.design, ...(plan.layout ? { layout: plan.layout } : {}), ...(plan.topology ? { topology: plan.topology } : {}),
      ...(plan.density ? { obstacles: plan.density, cover: plan.density } : {}) } });
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
  field.generation!.version = 5;
  field.generation!.source = plan || options.design ? 'context' : 'random';
  delete field.generation!.landmark;
  const attack = options.attackingSide ?? 'ally', defender = attack === 'ally' ? 'enemy' : 'ally';
  const at = (x: number, depth: number) => (defender === 'enemy' ? depth : height - 1 - depth) * width + x;
  const depthOf = (p: number) => defender === 'enemy' ? Math.floor(p / width) : height - 1 - Math.floor(p / width);
  const wallLevel = plan?.fortLevel ?? 3;
  let inner: number[] = [], frontline: number[] = [], gates: number[] = [], core: number[] = [], reserve: number[] = [];
  let frontDepth = Math.floor(height * .53), left = 0, right = width - 1;
  if (city) {
    field.tiles.fill('open'); field.structures.fill(null);
    const shape: CityShape | 'district' = siege ? plan?.shape ?? pick(CITY_SHAPES) : 'district';
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
      if (edge.role === 'main' && field.generation!.design.breadth !== 'narrow' && cell % width + 1 < right) road.add(cell + 1);
    }
    // One local gate approach and an inner lateral relief street, not two guaranteed full-map lanes.
    for (const x of [mainX, mainX + 1]) for (let d = Math.max(insideMin, frontDepth - 3); d < frontDepth; d++) road.add(at(x, d));
    for (let x = left + 1; x < right; x++) road.add(at(x, frontDepth - 1));
    const coreX = mainX <= (left + right) / 2 ? Math.max(left + 2, right - 2) : left + 2;
    const coreCell = at(coreX, siege ? 3 : Math.floor(height / 2));
    core = [coreCell, ...neighbors(field, coreCell)].filter(p => inner.includes(p));
    reserve = [at(mainX, Math.max(insideMin + 1, frontDepth - 3)), at(mainX + 1, Math.max(insideMin + 1, frontDepth - 3))];
    for (const p of [...core, ...reserve]) road.add(p);
    // Staggered block parcels, independently sampled gaps, courts and offsets: not mirrored stamps.
    const density = { sparse: .48, balanced: .68, dense: .86 }[plan?.density ?? field.generation!.design.obstacles];
    for (let d = Math.max(insideMin + 1, 3); d < frontDepth - 1; d += int(2, 3)) {
      for (let x = left + 1; x < right; x += int(2, 3)) {
        const rx = int(0, 1), ry = layout === 'lanes' ? int(1, 2) : int(0, 1);
        for (let yy = d; yy <= Math.min(frontDepth - 2, d + ry); yy++) for (let xx = x; xx <= Math.min(right - 1, x + rx); xx++) {
          const p = at(xx, yy);
          if (!road.has(p) && random.next() < density) field.structures[p] = createStructure('building', wallLevel);
          else if (!road.has(p) && random.next() < .22) field.overlays[p] = ['rubble'];
        }
      }
    }
    if (siege) {
      const facing = defender === 'enemy' ? 'south' : 'north';
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
      gate(at(mainX, frontDepth));
      if ((plan?.gates ?? pick(['single', 'side', 'double'])) !== 'single') {
        const second = plan?.gates === 'side' && left > 0 ? at(right, Math.max(3, frontDepth - 2)) : at(secondaryX, frontDepth);
        if (!gates.includes(second)) gate(second);
      }
      if (shape === 'broken') {
        const p = frontline.find(n => field.structures![n]?.kind === 'wall' && !gates.includes(n))!;
        field.structures[p]!.hp = 0; field.overlays[p] = ['rubble'];
      }
      for (const x of [left + 1, right - 1]) {
        const p = at(x, frontDepth - 1);
        if (!core.includes(p) && !gates.some(g => gridDistance(field, g, p) === 1)) field.structures[p] = createStructure('fortification', wallLevel, { facing });
      }
      field.objective = { kind: 'control', cell: coreCell, cells: core, attackingSide: attack, rounds: 5, limit: field.objective.limit };
    }
    for (const p of road) if (!field.structures[p]) field.overlays[p] = ['road'];
    field.city = { shape, inside: inner, frontline: [...new Set(frontline)], gates, core, reserve, ...(siege ? { defender } : {}) };
    // Connect pockets by opening ordinary parcel walls only. Never cut a city perimeter or gate.
    for (const p of inner.filter(p => !groundBlocked(field, p))) {
      const goal = core[0]!;
      if (findGridPath(field, p, goal, n => inner.includes(n) && !groundBlocked(field, n))) continue;
      const path = findGridPath(field, p, goal, n => inner.includes(n) && (!field.structures![n] || field.structures![n]?.kind === 'building'), n => field.structures![n] ? field.tiles.length : 1);
      for (const n of path?.cells ?? []) if (field.structures[n]?.kind === 'building') { field.structures[n] = null; field.overlays[n] = ['road']; }
    }
    // Keep the projected inner street graph as provenance; perimeter reachability is capability-based.
    if (!siege) field.objective.cell = core[0]!;
    if (shape === 'riverside') for (let d = 0; d < height; d++) for (const x of [0]) {
      const p = at(x, d); if (!frontline.includes(p) && !core.includes(p)) { field.tiles[p] = 'deep_water'; field.structures[p] = null; }
    }
    if (shape === 'hillside') for (let d = 2; d < frontDepth; d++) {
      const p = at(0, d); if (!frontline.includes(p) && !core.includes(p)) { field.tiles[p] = 'cliff'; field.structures[p] = null; }
    }
  }
  // Water changes routes. Bridges are real structures; no trait is granted to the roster.
  const water = plan?.water ?? (city ? 'none' : pick(['none', 'none', 'none', 'ford', 'river'] as const));
  if (water !== 'none' && width > 5) {
    const d = city ? Math.min(height - 4, frontDepth + 2) : Math.floor(height / 2);
    for (let x = 0; x < width; x++) {
      const p = at(x, d); if (p === field.objective.cell || core.includes(p) || field.structures[p]?.kind === 'wall' || field.structures[p]?.kind === 'gate') continue;
      field.tiles[p] = water === 'ford' ? 'shallow_water' : 'deep_water'; field.structures[p] = null; delete field.overlays[p];
    }
    if (water !== 'ford') for (const x of [int(1, Math.floor(width / 2) - 1), int(Math.floor(width / 2) + 1, width - 2)]) {
      const p = at(x, d); field.structures[p] = createStructure('bridge', wallLevel); field.overlays[p] = ['road'];
    }
  }
  // Marshes are passable but expensive and do not blanket a primary approach.
  if (!city && width > 5 && random.next() < .45) {
    const p = at(pick([0, width - 1]), int(3, height - 4));
    if (!field.structures[p] && field.tiles[p] !== 'cliff' && p !== field.objective.cell) field.tiles[p] = 'swamp';
  }
  const defaults: LandmarkPlan[] = city ? [{ kind: 'square', anchor: 'core' }, { kind: 'ruins', anchor: 'inside_left' }, ...(random.next() < .6 ? [{ kind: 'fortification' as const, anchor: 'front_right' as const }] : [])]
    : random.next() < .2 ? [] : [{ kind: pick(['hill', 'forest', 'fortification'] as const), anchor: pick(['center', 'front_left', 'front_right'] as const) }];
  const labels = { square: '城区广场', tower: '瞭望塔', ruins: '残垣废墟', fortification: '防御阵地', hill: '制高地', forest: '林间据点', bridge: '渡河桥' };
  const marked = new Set<number>();
  const protectedCells = new Set([...core, ...gates, ...(field.city?.frontline ?? [])]);
  for (const mark of (plan?.landmarks ?? defaults).slice(0, 5)) {
    let x = mark.anchor.endsWith('left') ? left + 2 : mark.anchor.endsWith('right') ? right - 2 : Math.floor(width / 2);
    let d = mark.anchor === 'approach' ? Math.min(height - 4, frontDepth + 1) : mark.anchor.startsWith('front') ? frontDepth - 1
      : mark.anchor === 'rear' ? 2 : mark.anchor === 'core' ? depthOf(core[0] ?? field.objective.cell) : Math.max(3, frontDepth - 3);
    x = Math.max(0, Math.min(width - 1, x)); d = Math.max(1, Math.min(height - 2, d));
    let p = at(x, d);
    if (mark.kind === 'square' && mark.anchor === 'core' && core.length) p = core[0]!;
    if (mark.kind === 'bridge') {
      const waters = field.tiles.flatMap((t, n) => t === 'deep_water' || t === 'shallow_water' ? [n] : []);
      if (!waters.length) continue;
      p = waters.sort((a, b) => gridDistance(field, a, p) - gridDistance(field, b, p) || a - b)[0]!;
    } else if (protectedCells.has(p) && !core.includes(p) || marked.has(p) || field.tiles[p] === 'cliff' || field.tiles[p] === 'deep_water') {
      const candidate = field.tiles.map((_, n) => n).filter(n => !marked.has(n) && !protectedCells.has(n) && !groundBlocked(field, n))
        .sort((a, b) => gridDistance(field, a, p) - gridDistance(field, b, p) || a - b)[0];
      if (candidate === undefined) continue; p = candidate;
    }
    if (mark.kind === 'tower' && city && inner.includes(p)) {
      const plots = inner.filter(n => field.structures![n]?.kind === 'building' && !marked.has(n) && !protectedCells.has(n));
      if (!plots.length) continue;
      // Replace an already closed parcel; never sever an existing alley for a tower.
      p = plots.sort((a, b) => gridDistance(field, a, p) - gridDistance(field, b, p) || a - b)[0]!;
    }
    const cells = [p];
    if (mark.scale === 'major' && mark.kind !== 'tower' && mark.kind !== 'bridge') cells.push(...neighbors(field, p).filter(n => !protectedCells.has(n) && !marked.has(n) && !groundBlocked(field, n)).slice(0, 2));
    for (const n of cells) {
      if (core.includes(n) && mark.kind !== 'square') continue;
      if (mark.kind === 'ruins') field.overlays[n] = [...new Set([...(field.overlays[n] ?? []), 'rubble' as const])];
      else if (mark.kind === 'fortification') field.structures[n] = createStructure('fortification', mark.level ?? wallLevel, { facing: defender === 'enemy' ? 'south' : 'north' });
      else if (mark.kind === 'bridge') field.structures[n] = createStructure('bridge', mark.level ?? wallLevel);
      else if (mark.kind === 'tower') {
        // A tower stands beside circulation, never replaces a gate or the objective.
        if (field.overlays[n]?.includes('road') || protectedCells.has(n)) continue;
        field.structures[n] = createStructure('tower', mark.level ?? wallLevel, { top: true, access: neighbors(field, n).filter(q => !groundBlocked(field, q)) });
      } else if (mark.kind === 'square') { field.structures[n] = null; if (!city) field.tiles[n] = 'open'; }
      else field.tiles[n] = mark.kind; // Explicit parks/high ground are the only natural-terrain exceptions to street parcels.
    }
    const actual = cells.filter(n => !marked.has(n) && !(core.includes(n) && mark.kind !== 'square')
      && (mark.kind !== 'tower' || field.structures![n]?.kind === 'tower'));
    if (!actual.length) continue;
    actual.forEach(n => marked.add(n));
    field.landmarks.push({ kind: mark.kind, label: safeLandmarkLabel(mark.label) ?? labels[mark.kind], cells: actual, scale: mark.scale ?? 'minor' });
  }
  // Explicit roster cells are honored only within legitimate deployment regions at battle start.
  for (const u of options.roster ?? []) if (Number.isInteger(u.pos) && u.pos! >= 0 && u.pos! < field.tiles.length && !frontline.includes(u.pos!)) {
    if (field.structures[u.pos!]?.kind === 'building') field.structures[u.pos!] = null;
  }
  validateField(field);
  return field;
}
