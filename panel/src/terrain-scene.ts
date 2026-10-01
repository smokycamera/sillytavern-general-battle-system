/** 底图用的战场解读：把存档里的地块、结构、覆盖层归成绘制用的格集合。各底图风格共用，只读、不推断规则。 */
import type { FieldStructure } from '../../engine/src/small/layers.js';
import { mapFamily, safeLandmarkLabel, type MapFamily } from '../../engine/src/small/map-design.js';
import type { BattlefieldSpec, Terrain } from '../../engine/src/small/spatial.js';
import { retreatCells } from '../../engine/src/small/spatial.js';
import { surfaceHeightAt } from '../../engine/src/small/height-map.js';
import { S, type Grid } from './terrain-geometry.js';

export type SceneStyle = 'field' | 'city' | 'compound' | 'interior' | 'trenches';
export function sceneStyleOf(field: BattlefieldSpec): SceneStyle {
  const scene = field.generation?.scene, family = field.generation?.family ?? mapFamily(field.environment ?? [], field.width);
  if (scene === 'interior' || !scene && family === 'indoor') return 'interior';
  if (scene === 'building_siege') return 'compound';
  if (scene === 'trenches') return 'trenches';
  if (scene === 'city_siege' || scene === 'city_streets' || !scene && (family === 'urban' || family === 'siege')) return 'city';
  return 'field';
}

export interface TerrainScene {
  field: BattlefieldSpec; id: string; g: Grid; W: number; H: number;
  style: SceneStyle; family: MapFamily; tiles: readonly Terrain[];
  inB(p: number): boolean; at(p: number): readonly [number, number];
  struct(p: number): FieldStructure | undefined; intact(p: number): FieldStructure | undefined;
  kindAt(p: number, ...kinds: FieldStructure['kind'][]): boolean;
  overlay(p: number, o: 'road' | 'rubble'): boolean;
  all(pred: (p: number) => boolean): number[];
  legacyWall(p: number): boolean; legacyBuilding(p: number): boolean; legacyThicket(p: number): boolean; legacyRock(p: number): boolean;
  isWater(p: number): boolean; isDeep(p: number): boolean; isSwamp(p: number): boolean; isRough(p: number): boolean;
  isRock(p: number): boolean; isWood(p: number): boolean; isPaved(p: number): boolean; isBuilding(p: number): boolean;
  /** 实际地表高度（spatialRulesVersion 2）；旧图的山地格按1级处理，只用于画面。 */
  level(p: number): number; heightRules: boolean; maxLevel: number;
  roads: number[]; joinRoad(p: number): boolean;
  rubble: number[]; buildings: number[]; partitions: number[]; joinPartition(p: number): boolean;
  wallLine: number[]; joinWall(p: number): boolean; towers: number[]; gates: number[]; works: number[]; covers: number[]; bridges: number[];
  zone: number[]; exits: number[]; marks: { label?: string; cells: number[] }[];
}

export function analyzeTerrain(field: BattlefieldSpec, id: string): TerrainScene {
  const g: Grid = { w: field.width, h: field.height, n: field.tiles.length };
  const style = sceneStyleOf(field), family = field.generation?.family ?? mapFamily(field.environment ?? [], g.w), tiles = field.tiles;
  const inB = (p: number) => p >= 0 && p < g.n;
  const struct = (p: number): FieldStructure | undefined => inB(p) ? field.structures?.[p] ?? undefined : undefined;
  const intact = (p: number) => { const s = struct(p); return s && s.hp > 0 ? s : undefined; };
  const kindAt = (p: number, ...kinds: FieldStructure['kind'][]) => { const s = intact(p); return !!s && kinds.includes(s.kind); };
  const overlay = (p: number, o: 'road' | 'rubble') => !!field.overlays?.[p]?.includes(o);
  const all = (pred: (p: number) => boolean) => { const out: number[] = []; for (let p = 0; p < g.n; p++) if (pred(p)) out.push(p); return out; };
  // 旧版无分层地图里 wall 地块按环境家族解释：城区为建筑，森林为密林，其他为岩石。
  const legacyWall = (p: number) => tiles[p] === 'wall' && !struct(p);
  const legacyBuilding = (p: number) => legacyWall(p) && (style === 'city' || family === 'urban' || family === 'siege');
  const legacyThicket = (p: number) => legacyWall(p) && style === 'field' && family === 'forest';
  const legacyRock = (p: number) => legacyWall(p) && style === 'field' && family !== 'forest';
  const isWater = (p: number) => tiles[p] === 'shallow_water' || tiles[p] === 'deep_water';
  const heightRules = field.spatialRulesVersion === 2;
  const level = (p: number) => !inB(p) || isWater(p) ? 0 : heightRules ? surfaceHeightAt(field, p) : tiles[p] === 'hill' ? 1 : 0;
  const isBuilding = (p: number) => inB(p) && (kindAt(p, 'building') || legacyBuilding(p));
  const joinRoad = (p: number) => inB(p) && (overlay(p, 'road') || struct(p)?.kind === 'gate' || struct(p)?.kind === 'bridge');
  const joinPartition = (p: number) => inB(p) && (kindAt(p, 'building', 'wall', 'gate', 'tower') || legacyWall(p));
  const joinWall = (p: number) => inB(p) && kindAt(p, 'wall', 'gate', 'tower');
  const legacy = field.generation?.landmark;
  const marks = field.landmarks?.length ? field.landmarks.map(m => ({ label: safeLandmarkLabel(m.label), cells: Array.isArray(m.cells) ? m.cells.filter(inB) : [] }))
    : legacy ? [{ label: safeLandmarkLabel(legacy.label), cells: Array.isArray(legacy.cells) ? legacy.cells.filter(p => Number.isInteger(p) && inB(p)) : [] }] : [];
  let maxLevel = 0;
  for (let p = 0; p < g.n; p++) maxLevel = Math.max(maxLevel, level(p));
  return {
    field, id, g, W: g.w * S, H: g.h * S, style, family, tiles, inB, at: p => [(p % g.w) * S, Math.floor(p / g.w) * S] as const,
    struct, intact, kindAt, overlay, all, legacyWall, legacyBuilding, legacyThicket, legacyRock,
    isWater, isDeep: p => tiles[p] === 'deep_water', isSwamp: p => tiles[p] === 'swamp', isRough: p => tiles[p] === 'rough',
    isRock: p => tiles[p] === 'cliff' || legacyRock(p), isWood: p => tiles[p] === 'forest' || legacyThicket(p), isPaved: p => tiles[p] === 'street', isBuilding,
    level, heightRules, maxLevel,
    roads: all(p => overlay(p, 'road') && struct(p)?.kind !== 'bridge' && struct(p)?.kind !== 'gate'), joinRoad,
    rubble: all(p => overlay(p, 'rubble')),
    buildings: style === 'interior' || style === 'compound' ? [] : all(isBuilding),
    partitions: style === 'interior' || style === 'compound' ? all(p => kindAt(p, 'building', 'wall') || legacyWall(p)) : [], joinPartition,
    wallLine: style === 'interior' || style === 'compound' ? [] : all(p => kindAt(p, 'wall', 'gate')), joinWall,
    towers: all(p => kindAt(p, 'tower')), gates: all(p => kindAt(p, 'gate')), works: all(p => kindAt(p, 'fortification')),
    covers: all(p => kindAt(p, 'cover') || tiles[p] === 'cover' && !struct(p)), bridges: all(p => struct(p)?.kind === 'bridge'),
    zone: field.objective.kind === 'control' ? (field.objective.cells ?? [field.objective.cell]).filter(inB) : [],
    exits: [...new Set([...retreatCells(field, 'ally'), ...retreatCells(field, 'enemy')])],
    marks,
  };
}

/** 城门朝向：左右为墙体则为水平墙线上的门（通道南北向）。 */
export function gateHorizontal(t: TerrainScene, p: number): boolean {
  const blocking = (q: number) => t.kindAt(q, 'wall', 'gate', 'tower', 'building') || t.legacyWall(q);
  return (p % t.g.w > 0 && blocking(p - 1)) || (p % t.g.w < t.g.w - 1 && blocking(p + 1));
}
/** 桥的走向：两侧为水则桥面南北向。 */
export function bridgeVertical(t: TerrainScene, p: number): boolean {
  const x = p % t.g.w, y = (p - x) / t.g.w;
  return (x > 0 && t.isWater(p - 1)) || (x < t.g.w - 1 && t.isWater(p + 1)) || !((y > 0 && t.isWater(p - t.g.w)) || (y < t.g.h - 1 && t.isWater(p + t.g.w)));
}
/** 撤离方向标记的折线。 */
export function exitChevrons(t: TerrainScene, size = 12): string {
  let d = '';
  for (const p of t.exits) {
    const [x, y] = t.at(p), row = Math.floor(p / t.g.w);
    d += row === 0 ? `M${x + 50 - size} ${y + 13}l${size} -8l${size} 8` : row === t.g.h - 1 ? `M${x + 50 - size} ${y + 87}l${size} 8l${size} -8`
      : p % t.g.w === 0 ? `M${x + 13} ${y + 50 - size}l-8 ${size}l8 ${size}` : `M${x + 87} ${y + 50 - size}l8 ${size}l-8 ${size}`;
  }
  return d;
}
export function gridLines(t: TerrainScene): string {
  let d = '';
  for (let x = 1; x < t.g.w; x++) d += `M${x * S} 0V${t.H}`;
  for (let y = 1; y < t.g.h; y++) d += `M0 ${y * S}H${t.W}`;
  return d;
}
const escText = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** 地标名称：放在范围左上角（贴右边时右对齐）。 */
export function landmarkLabels(t: TerrainScene, cls: string): string {
  let out = '';
  for (const m of t.marks) {
    if (!m.cells.length || !m.label) continue;
    const first = Math.min(...m.cells), x = first % t.g.w, y = Math.floor(first / t.g.w), end = x >= t.g.w - 2;
    out += `<text class="${cls}" x="${end ? (x + 1) * S - 7 : x * S + 7}" y="${y * S + 24}"${end ? ' text-anchor="end"' : ''}>${escText(m.label)}</text>`;
  }
  return out;
}
