import { SeededRng } from '../rng.js';
import { environmentTags } from '../environment.js';
import { flightCapabilityReason } from '../aerial.js';
import type { Combatant } from '../types.js';
import { mapFamily, validMapDesign, type MapDesign } from './map-design.js';
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
  const rng = new SeededRng('field-v3:' + seed), environment = environmentTags(tags);
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
  const randomDesign: MapDesign = {
    layout: pick(['scattered', 'lanes', 'crossroads', 'ring', 'strongpoint', 'broken']),
    orientation: pick(['longitudinal', 'transverse', 'diagonal']),
    relief: pick(['balanced', 'balanced', 'dense']), cover: pick(['sparse', 'balanced', 'dense']),
    obstacles: pick(['sparse', 'balanced', 'dense']), route: pick(['direct', 'winding', 'winding', 'flank']),
    breadth: pick(['narrow', 'normal', 'broad']), feature: 'none', featureZone: 'center',
  };
  const directed = validMapDesign(options.design);
  const design: MapDesign = directed ? { ...options.design! } : randomDesign;
  if (design.layout === 'automatic') design.layout = randomDesign.layout;
  field.generation = { version: 3, family, source: directed ? 'context' : 'random', design: { ...design } };
  const reserved = new Set([field.objective.cell, 0, width - 1, tiles.length - width, tiles.length - 1,
    cell(center, 0), cell(center, 1), cell(center, middle), cell(center, height - 2), cell(center, height - 1)]);
  if (indoor && options.roster?.length) {
    const units = options.roster.map(u => ({ ...u, airborne: u.airborne ?? !flightCapabilityReason(u) }));
    for (const position of deployOnGrid(field, units, seed)) reserved.add(position);
  }
  // Even vanguard / explicitly positioned units must not be buried by a wall.
  for (const unit of options.roster ?? []) if (Number.isInteger(unit.pos) && unit.pos! >= 0 && unit.pos! < tiles.length) reserved.add(unit.pos!);

  // Two vertex-disjoint safety routes can move across the centre, unlike fixed left/right lanes.
  // They prohibit walls, not all terrain: forest paths and rocky passes keep their identity.
  const routes = new Set<number>(), primaryRoute = new Set<number>(), wideRoutes = new Set<number>();
  let left = design.route === 'flank' ? int(0, 1) : int(0, width - 3);
  let right = design.route === 'flank' ? int(width - 2, width - 1) : int(left + 2, width - 1);
  for (let y = 0; y < height; y++) {
    const previousLeft = left, previousRight = right;
    if (design.route !== 'direct' && y > 0 && y < height - 1) {
      left = Math.max(0, Math.min(previousRight - 1, left + pick([-1, 0, 1])));
      right = Math.max(Math.max(previousLeft, left) + 1, Math.min(width - 1, right + pick([-1, 0, 1])));
      if (Math.max(previousLeft, left) >= Math.min(previousRight, right)) { left = previousLeft; right = previousRight; }
    }
    for (let x = Math.min(previousLeft, left); x <= Math.max(previousLeft, left); x++) primaryRoute.add(cell(x, y));
    for (const [a, b] of [[previousLeft, left], [previousRight, right]]) for (let x = Math.min(a!, b!); x <= Math.max(a!, b!); x++) routes.add(cell(x, y));
  }
  if (design.breadth === 'broad') for (const p of primaryRoute) if (p % width < width - 1) wideRoutes.add(p + 1);
  const wallMinY = indoor ? 1 : 3, wallMaxY = height - 1 - wallMinY;
  const paint = (x: number, y: number, terrain: Terrain) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const p = cell(x, y);
    if (reserved.has(p)) return;
    if (terrain === 'wall' && (!structural || y < wallMinY || y > wallMaxY || routes.has(p) || wideRoutes.has(p))) return;
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
  // A broad road clears its shoulder; narrow roads retain costly but traversable terrain.
  for (const p of wideRoutes) if (!reserved.has(p) && rng.next() < .7) tiles[p] = 'open';
  for (const p of routes) {
    if (tiles[p] === 'wall') tiles[p] = 'cover';
    if (design.breadth !== 'narrow' && rng.next() < (design.breadth === 'broad' ? .85 : .4)) tiles[p] = 'open';
  }
  // A small room or a broad road must not erase every environmental feature.
  const minimumDetail = Math.ceil(tiles.length * (family === 'forest' || family === 'mountain' ? .27 * relief : .16));
  let detail = tiles.filter(t => t !== 'open').length;
  const detailCells = tiles.map((_, p) => ({ p, rank: rng.next() })).filter(({ p }) => !reserved.has(p) && !primaryRoute.has(p)).sort((a, b) => a.rank - b.rank);
  for (const { p } of detailCells) { if (detail >= minimumDetail) break; if (tiles[p] === 'open') { tiles[p] = theme; detail++; } }
  // Landmark is a bounded local patch. No model may overwrite deployment or close a route.
  const landmarkCells: number[] = [];
  const landmarkTerrain: Terrain | undefined = design.feature === 'none' ? undefined : design.feature === 'clearing' ? 'open' : design.feature;
  if (landmarkTerrain) {
    const zone = design.featureZone;
    const x = zone.endsWith('left') ? 1 : zone.endsWith('right') ? width - 2 : center;
    const y = zone.startsWith('enemy') ? 2 : zone.startsWith('ally') ? height - 3 : middle;
    brush(x, y, 1, 1, landmarkTerrain);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = cell(x + dx, y + dy);
      if (!reserved.has(p) && tiles[p] === landmarkTerrain) landmarkCells.push(p);
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
  if (landmarkTerrain) field.generation.landmark = { terrain: landmarkTerrain, cells: landmarkCells.filter(p => tiles[p] === landmarkTerrain) };
  validateField(field);
  return field;
}
