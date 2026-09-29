import { SeededRng } from '../rng.js';
import { environmentTags } from '../environment.js';
import { flightCapabilityReason } from '../aerial.js';
import type { Combatant } from '../types.js';
import { mapFamily, validMapDesign, safeLandmarkLabel, MAP_DESIGN_OPTIONS, type MapDesign, type MapDesignKey } from './map-design.js';
import { buildRouteGraph, repairRouteCuts, ROUTE_TOPOLOGIES } from './route-graph.js';
import { defaultBattleObjective, deployOnGrid, findGridPath, neighbors, validateField, type BattlefieldSpec, type Terrain } from './spatial.js';

export interface FieldGenerationOptions {
  roster?: Combatant[];
  attackingSide?: 'ally' | 'enemy';
  /** Optional bounded director plan. Old snapshots never pass through generation. */
  design?: MapDesign;
}

/** Macro layout → environmental regions → structures → routes/landmarks → safety repair.
 * Independent RNG, asymmetric geometry, no reroll of combat dice or saved tile arrays. */
export function generatedField(seed: string, width = 7, height = 13, tags: string[] = [], options: FieldGenerationOptions = {}): BattlefieldSpec {
  const rng = new SeededRng('field-v4:' + seed), environment = environmentTags(tags);
  const center = Math.floor(width / 2), middle = Math.floor(height / 2), indoor = width === 5;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => 'open');
  const field: BattlefieldSpec = { version: 2, width, height, tiles, environment,
    objective: defaultBattleObjective(width, height, environment, options.attackingSide) };
  validateField(field);
  const int = (min: number, max: number) => min + Math.floor(rng.next() * (max - min + 1));
  const pick = <T>(values: readonly T[]): T => values[int(0, values.length - 1)]!;
  const cell = (x: number, y: number) => y * width + x;
  const clampX = (x: number) => Math.max(0, Math.min(width - 1, x));
  const clampY = (y: number) => Math.max(1, Math.min(height - 2, y));
  const family = mapFamily(environment, width), structural = ['urban', 'siege', 'indoor'].includes(family);
  // Consume the same defaults before overlaying a plan, so each option has an isolated effect.
  const landmarkRoll = rng.next();
  const featurePool: MapDesign['feature'][] = family === 'forest' ? ['clearing', 'forest', 'cover', 'hill']
    : family === 'mountain' ? ['hill', 'rough', 'cover', 'clearing'] : structural ? ['ruins', 'cover', 'clearing', 'rough']
      : ['clearing', 'cover', 'forest', 'hill', 'rough'];
  const randomDesign: MapDesign = {
    layout: pick(['scattered', 'lanes', 'crossroads', 'ring', 'strongpoint', 'broken']),
    orientation: pick(['longitudinal', 'transverse', 'diagonal']),
    relief: pick(['balanced', 'balanced', 'dense']), cover: pick(['sparse', 'balanced', 'dense']),
    obstacles: pick(['sparse', 'balanced', 'dense']), route: pick(['direct', 'winding', 'winding', 'flank']),
    breadth: pick(['narrow', 'normal', 'broad']), feature: landmarkRoll < .4 ? 'none' : pick(featurePool),
    featureZone: pick(Object.keys(MAP_DESIGN_OPTIONS.featureZone) as MapDesign['featureZone'][]),
    landmarkScale: landmarkRoll >= .85 ? 'major' : 'minor',
  };
  const directed = validMapDesign(options.design);
  // Copy only the supported schema; never persist unknown model commands or tile arrays.
  const design: MapDesign = directed ? Object.fromEntries((Object.keys(MAP_DESIGN_OPTIONS) as MapDesignKey[]).map(k => [k, options.design![k]])) as unknown as MapDesign : randomDesign;
  if (directed) {
    const requested = options.design!;
    if (typeof requested.topology === 'string' && Object.hasOwn(ROUTE_TOPOLOGIES, requested.topology)) design.topology = requested.topology;
    const label = safeLandmarkLabel(requested.landmarkLabel);
    if (label) design.landmarkLabel = label;
    design.landmarkScale = requested.landmarkScale === 'major' ? 'major' : 'minor';
  }
  if (design.layout === 'automatic') design.layout = randomDesign.layout;
  field.generation = { version: 4, family, source: directed ? 'context' : 'random', design: { ...design } };
  const reserved = new Set([field.objective.cell, 0, width - 1, tiles.length - width, tiles.length - 1,
    cell(center, 0), cell(center, 1), cell(center, middle), cell(center, height - 2), cell(center, height - 1)]);
  if (indoor && options.roster?.length) {
    const units = options.roster.map(u => ({ ...u, airborne: u.airborne ?? !flightCapabilityReason(u) }));
    for (const position of deployOnGrid(field, units, seed)) reserved.add(position);
  }
  // Even vanguard / explicitly positioned units must not be buried by a wall.
  for (const unit of options.roster ?? []) if (Number.isInteger(unit.pos) && unit.pos! >= 0 && unit.pos! < tiles.length) reserved.add(unit.pos!);

  const graph = buildRouteGraph(field, rng, design);
  field.generation.routes = graph;
  field.generation.design.topology = graph.kind;
  const routes = new Set(graph.edges.flatMap(e => e.cells));
  const primaryRoute = new Set(graph.edges.filter(e => e.role === 'main').flatMap(e => e.cells));
  const wideRoutes = new Set<number>();
  if (design.breadth === 'broad') for (const p of primaryRoute) {
    const shoulder = p % width < width - 1 ? p + 1 : p - 1;
    wideRoutes.add(shoulder);
  }
  const wallMinY = indoor ? 1 : 3, wallMaxY = height - 1 - wallMinY;
  const paint = (x: number, y: number, terrain: Terrain) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const p = cell(x, y);
    if (reserved.has(p)) return;
    if (terrain === 'wall' && (y < wallMinY || y > wallMaxY || routes.has(p) || wideRoutes.has(p))) return;
    tiles[p] = terrain;
  };
  const brush = (x: number, y: number, rx: number, ry: number, terrain: Terrain, broken = false) => {
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      if ((dx / (rx + .5)) ** 2 + (dy / (ry + .5)) ** 2 > 1 || broken && rng.next() < .3) continue;
      paint(x + dx, y + dy, terrain);
    }
  };
  const stroke = (x: number, y: number, length: number, terrain: Terrain, orientation = design.orientation, broken = false) => {
    const direction = pick([-1, 1]);
    for (let n = 0; n < length; n++) {
      if (broken && rng.next() < .3) continue;
      const dx = orientation === 'longitudinal' ? 0 : n * direction;
      const dy = orientation === 'transverse' ? 0 : orientation === 'diagonal' ? Math.floor(n / 2) : n;
      paint(x + dx, y + dy, terrain);
    }
  };
  const level = { sparse: .65, balanced: 1, dense: 1.4 };
  const relief = level[design.relief], cover = level[design.cover], obstacles = level[design.obstacles];
  const anchorX = int(1, width - 2), anchorY = int(Math.max(2, middle - 2), Math.min(height - 3, middle + 2));
  const theme: Terrain = family === 'forest' ? 'forest' : family === 'mountain' ? 'hill' : structural ? 'rough' : pick(['rough', 'hill', 'forest']);
  const regionCount = Math.ceil(tiles.length / (structural ? 22 : family === 'plains' ? 27 : 14) * relief);
  for (let n = 0; n < regionCount; n++) {
    const x = int(0, width - 1), y = int(1, height - 2);
    switch (design.layout) {
      case 'lanes': stroke(x, y, int(3, 6), theme); brush(clampX(x + 1), clampY(y + 1), 0, 1, theme); break;
      case 'crossroads': brush(x, y, int(0, 1), int(1, 2), theme); break;
      case 'ring': brush(x < center ? int(0, 1) : int(width - 2, width - 1), y, 1, int(1, 2), theme); break;
      case 'strongpoint': brush(clampX(anchorX + int(-2, 2)), clampY(anchorY + int(-2, 2)), 1, int(1, 2), theme); break;
      case 'broken': brush(x, y, 1, 1, theme, true); stroke(x, y, int(2, 4), 'rough', design.orientation, true); break;
      default: brush(x, y, int(0, 1), int(1, 2), theme, rng.next() < .3);
    }
  }
  // Secondary biome/relief forms a transition instead of making every environment monochrome.
  const secondary: Terrain = family === 'forest' ? 'hill' : family === 'mountain' ? 'rough' : 'rough';
  for (let n = 0; n < Math.ceil(tiles.length / 28); n++) brush(int(0, width - 1), int(1, height - 2), 0, 1, secondary);
  for (let n = 0; n < Math.ceil(tiles.length / 11 * cover); n++) {
    const x = design.layout === 'strongpoint' ? clampX(anchorX + int(-2, 2)) : int(0, width - 1);
    const y = design.layout === 'strongpoint' ? clampY(anchorY + int(-2, 2)) : int(1, height - 2);
    stroke(x, y, int(1, 2), 'cover', pick(['longitudinal', 'transverse']));
  }
  if (structural) {
    const count = Math.ceil(tiles.length / 15 * obstacles);
    for (let n = 0; n < count; n++) {
      const x = int(0, width - 1), y = int(wallMinY, wallMaxY);
      switch (design.layout) {
        case 'scattered': // small independent buildings / storage partitions, with door gaps
          stroke(x, y, int(2, 3), 'wall', 'transverse'); stroke(x, y, int(2, 3), 'wall', 'longitudinal'); break;
        case 'lanes': stroke(x, y, int(3, 5), 'wall'); break;
        case 'crossroads': stroke(x, y, int(2, 4), 'wall', pick(['longitudinal', 'transverse'])); break;
        case 'ring': stroke(x < center ? Math.max(0, anchorX - 2) : Math.min(width - 1, anchorX + 2), y, int(2, 4), 'wall', 'longitudinal'); break;
        case 'strongpoint': stroke(clampX(anchorX + int(-2, 2)), y, int(2, 4), 'wall', n % 2 ? 'transverse' : 'longitudinal'); break;
        case 'broken': stroke(x, y, int(2, 5), 'wall', design.orientation, true); break;
      }
    }
  }
  // Natural hard obstacles use the existing wall collision/LOS rule, never invisible forest opacity.
  // Sparse boulders on plains, dense tree barriers in forests and rock spurs in mountains.
  if (!structural) {
    const clusters = Math.max(1, Math.round(int(1, family === 'plains' ? 2 : 4) * obstacles));
    for (let n = 0; n < clusters; n++) {
      const x = int(0, width - 1), y = int(wallMinY, wallMaxY);
      stroke(x, y, family === 'plains' ? 1 : int(1, 3), 'wall',
        family === 'mountain' ? design.orientation : pick(['longitudinal', 'transverse']));
      for (const p of neighbors(field, cell(x, y))) if (!routes.has(p) && tiles[p] !== 'wall') {
        paint(p % width, Math.floor(p / width), family === 'forest' ? 'forest' : 'rough');
      }
    }
  }
  // Layout-specific negative space changes the fight, not just the tile colouring.
  if (design.layout === 'crossroads') {
    for (let x = 0; x < width; x++) paint(x, anchorY, 'open');
    for (let y = 1; y < height - 1; y++) paint(clampX(anchorX + (design.orientation === 'diagonal' ? (y % 3 === 0 ? 1 : 0) : 0)), y, 'open');
  } else if (design.layout === 'ring') brush(anchorX, anchorY, 1, 1, 'open');
  else if (design.layout === 'strongpoint') brush(anchorX, anchorY, 0, 1, structural ? 'cover' : theme);

  if (family === 'siege') {
    const front = options.attackingSide === 'enemy' ? wallMaxY : wallMinY;
    const inward = options.attackingSide === 'enemy' ? -1 : 1;
    for (let x = 0; x < width; x++) paint(x, front, 'wall');
    for (let n = 0; n < Math.ceil(2 * obstacles); n++) {
      const x = int(0, width - 1), y = front + inward * int(1, Math.max(1, Math.floor((wallMaxY - wallMinY) / 2)));
      stroke(x, y, int(2, 3), 'wall', 'transverse', design.layout === 'broken');
      paint(x, front - inward, 'cover');
    }
  }
  // Main routes are faster but exposed. Branches keep cover/biome trade-offs; no invisible road bonus.
  for (const p of wideRoutes) if (!reserved.has(p)) tiles[p] = 'open';
  for (const edge of graph.edges) for (const p of edge.cells) {
    if (reserved.has(p)) continue;
    if (edge.role === 'main') tiles[p] = design.breadth === 'narrow' && rng.next() < .2 ? theme : 'open';
    else if (edge.role === 'dead_end') tiles[p] = rng.next() < .5 ? 'cover' : 'open';
    else if (tiles[p] === 'wall') tiles[p] = 'rough';
    else if (!primaryRoute.has(p) && rng.next() < .45) tiles[p] = family === 'forest' ? 'forest' : family === 'mountain' ? 'hill' : 'cover';
  }
  // Important route decisions get usable positions rather than decoration scattered at random.
  for (const node of graph.nodes) {
    const degree = graph.edges.filter(e => e.from === node.id || e.to === node.id).length;
    if (degree < 3) continue;
    const positions = neighbors(field, node.cell).filter(p => !reserved.has(p) && !routes.has(p));
    if (positions.length) tiles[pick(positions)] = family === 'mountain' ? 'hill' : 'cover';
  }
  // A small room or a broad road must not erase every environmental feature.
  const minimumDetail = Math.ceil(tiles.length * (family === 'forest' || family === 'mountain' ? .27 * relief : .16));
  let detail = tiles.filter(t => t !== 'open').length;
  const detailCells = tiles.map((_, p) => ({ p, rank: rng.next() })).filter(({ p }) => !reserved.has(p) && !primaryRoute.has(p)).sort((a, b) => a.rank - b.rank);
  for (const { p } of detailCells) { if (detail >= minimumDetail) break; if (tiles[p] === 'open') { tiles[p] = theme; detail++; } }
  // Landmarks exist locally too: 40% none, 45% small, 15% major before contextual override.
  // Major landmarks combine existing tiles: a position, an approach and an exposed access gap.
  const landmarkCells: number[] = [];
  const landmarkTerrain: Terrain | undefined = design.feature === 'none' ? undefined
    : design.feature === 'clearing' ? 'open' : design.feature === 'ruins' ? 'rough' : design.feature;
  const defaultLabels: Record<Exclude<MapDesign['feature'], 'none'>, string> = {
    clearing: structural ? '院落广场' : family === 'forest' ? '林间空地' : '开阔空地', cover: '掩体阵地', forest: '密林地带', hill: '岩脊高地', rough: '崎岖地带', ruins: '残垣废墟',
  };
  if (landmarkTerrain) {
    const zone = design.featureZone;
    const x = zone.endsWith('left') ? 1 : zone.endsWith('right') ? width - 2 : center;
    const y = zone.startsWith('enemy') ? 2 : zone.startsWith('ally') ? height - 3 : middle;
    const major = design.landmarkScale === 'major', rx = 1, ry = major && !indoor ? 2 : 1;
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= width || yy < 1 || yy >= height - 1) continue;
      const p = cell(xx, yy);
      if (reserved.has(p)) continue;
      let terrain: Terrain = landmarkTerrain;
      if (design.feature === 'ruins') terrain = structural && Math.abs(dx) === rx && dy < 0 && !routes.has(p) ? 'wall' : dy % 2 ? 'cover' : 'rough';
      else if (major && Math.abs(dx) === rx && Math.abs(dy) === ry) terrain = design.feature === 'hill' ? 'rough' : 'cover';
      // Never overwrite the fast approach with impassable walls or an entire slow-terrain blanket.
      if (primaryRoute.has(p) && terrain !== 'open' && design.feature !== 'ruins') continue;
      paint(xx, yy, terrain);
      if (tiles[p] === terrain) landmarkCells.push(p);
    }
    // A centred landmark in a tiny room still needs a real, non-reserved cell.
    if (!landmarkCells.length) {
      const p = tiles.map((_, p) => p).filter(p => !reserved.has(p) && !primaryRoute.has(p))
        .sort((a, b) => Math.abs(a % width - x) + Math.abs(Math.floor(a / width) - y) - Math.abs(b % width - x) - Math.abs(Math.floor(b / width) - y))[0];
      if (p !== undefined) { tiles[p] = landmarkTerrain; landmarkCells.push(p); }
    }
  }
  for (const p of reserved) tiles[p] = 'open';

  // Keep >25% open ground, preferentially thinning peripheral ground, not structures/landmarks.
  const minimumOpen = Math.floor(tiles.length * .28) + 1;
  const candidates = tiles.map((t, p) => ({ t, p, rank: rng.next() })).filter(v => v.t !== 'open' && v.t !== 'wall' && !landmarkCells.includes(v.p)).sort((a, b) => a.rank - b.rank);
  let openCount = tiles.filter(t => t === 'open').length;
  for (const { p } of candidates) { if (openCount >= minimumOpen) break; tiles[p] = 'open'; openCount++; }

  // Reconnect isolated pockets by removing the minimum-cost local wall cuts, not whole buildings.
  const reachable = () => {
    const reached = new Set([field.objective.cell]), queue = [field.objective.cell];
    for (let n = 0; n < queue.length; n++) for (const next of neighbors(field, queue[n]!)) {
      if (tiles[next] !== 'wall' && !reached.has(next)) { reached.add(next); queue.push(next); }
    }
    return reached;
  };
  let reached = reachable();
  for (let p = 0; p < tiles.length; p++) {
    if (tiles[p] === 'wall' || reached.has(p)) continue;
    const connection = findGridPath(field, p, field.objective.cell, () => true, n => tiles[n] === 'wall' ? tiles.length + 1 : 1)!;
    for (const n of connection.cells) if (tiles[n] === 'wall') tiles[n] = 'cover';
    reached = reachable();
  }
  repairRouteCuts(field, graph);
  if (landmarkTerrain && landmarkCells.length) field.generation.landmark = { terrain: landmarkTerrain,
    cells: [...new Set(landmarkCells)].filter(p => !reserved.has(p)),
    label: safeLandmarkLabel(design.landmarkLabel) ?? defaultLabels[design.feature as Exclude<MapDesign['feature'], 'none'>],
    scale: design.landmarkScale ?? 'minor', zone: design.featureZone };
  validateField(field);
  return field;
}
