import { movementPoints } from '../tactics.js';
import { GridQueue } from './grid-queue.js';
import { layerMoveCost, groundBlocked, obstructionHeight, structureAt, STRUCTURE_NAMES, validateLayers, isElevated, structureDefense, type FieldStructure, type GroundOverlay, type FieldLandmark, type CityRecord } from './layers.js';
import { landmarkAt, BATTLEFIELD_SCENES, type MapGenerationRecord } from './map-design.js';
import { isRangedWeapon } from '../loadout.js';
import type { Combatant, ConditionDef } from '../types.js';
import { activeTraitIds } from '../trait-sources.js';
import { environmentTags } from '../environment.js';
import { isAirborne, sameLayer, flightCapabilityReason, type FlightConditions } from '../aerial.js';
import { SeededRng } from '../rng.js';
import { rangedScreen } from '../guard-screen.js';
import {validateSceneRecord,type SceneRecord,type DeploymentZone} from './scene-compiler.js';
import { heightStepCost,validateHeightMap,eyeHeight,unitHeight,groundHeightAt,heightDefense,standingTerrain,type HeightTransition } from './height-map.js';
import { gridWeaponRange } from './weapon-range.js';

export const DEFAULT_SMALL_ROUND_LIMIT = 60;

export type Terrain = 'open' | 'cover' | 'wall' | 'rough' | 'forest' | 'hill' | 'street' | 'shallow_water' | 'deep_water' | 'swamp' | 'cliff';
export const TERRAIN_NAMES: Record<Terrain, string> = { open: '开阔地', cover: '掩体', wall: '墙体', rough: '崎岖地', forest: '森林', hill: '山地', street: '街道', shallow_water: '浅水', deep_water: '深水', swamp: '沼泽', cliff: '岩壁' };
export interface BattlefieldSpec {
  spatialRulesVersion?: 2;
  groundHeight?: number[];
  heightTransitions?: HeightTransition[];
  scene?: SceneRecord;
  deploymentZones?: DeploymentZone[];
  retreatEdges?: Partial<Record<'ally'|'enemy',number[]>>;
  initialDeployment?: Record<string,{pos:number;elevation?:1;airborne?:boolean}>;
  layerVersion?: 1;
  structures?: (FieldStructure | null)[];
  overlays?: Partial<Record<number, GroundOverlay[]>>;
  landmarks?: FieldLandmark[];
  city?: CityRecord;
  terrainRevision?: number;
  /** Frozen provenance; actual tiles remain authoritative when loading old/new saves. */
  generation?: MapGenerationRecord;
  environment?: string[];
  version: 2;
  width: number;
  height: number;
  tiles: Terrain[];
  objective: { kind: 'annihilation'; cell: number; limit: number } | { kind: 'control'; cell: number; rounds: number; limit: number; cells?: number[]; attackingSide?: 'ally' | 'enemy' } | { kind: 'escape'; unitId: string; cell: number; limit: number; defenderWins?: boolean };
}
/** 攻城点位于守方纵深中央；歼灭战保留中心坐标仅供地图连通性检查。 */
export function defaultBattleObjective(width: number, height: number, tags: string[], attackingSide: 'ally' | 'enemy' = 'ally'): BattlefieldSpec['objective'] {
  return tags.includes('siege')
    ? { kind: 'control', attackingSide, cell: (attackingSide === 'ally' ? 1 : height - 2) * width + Math.floor(width / 2), rounds: 2, limit: DEFAULT_SMALL_ROUND_LIMIT }
    : { kind: 'annihilation', cell: Math.floor(height / 2) * width + Math.floor(width / 2), limit: DEFAULT_SMALL_ROUND_LIMIT };
}
export interface GridPath { cells: number[]; cost: number }
export function standardField(width = 7, height = 9, tags: string[] = []): BattlefieldSpec {
  const tiles: Terrain[] = Array.from({ length: width * height }, () => 'open');
  const middle = Math.floor(height / 2);
  for (const y of [middle - 1, middle + 1]) {
    tiles[y * width + 1] = 'cover'; tiles[y * width + width - 2] = 'cover';
  }
  tiles[middle * width + 1] = 'wall'; tiles[middle * width + width - 2] = 'wall';
  tiles[middle * width + 2] = 'rough';
  const environment = environmentTags(tags);
  const special = environment.includes('forest') ? 'forest' : environment.includes('mountain') ? 'hill' : undefined;
  if (special) for (let y = 1; y < height - 1; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x;
    if (x !== Math.floor(width / 2) && tiles[cell] !== 'wall') tiles[cell] = special;
  }
  return { version: 2, width, height, tiles, environment, objective: defaultBattleObjective(width, height, environment) };
}
export function validateField(field: BattlefieldSpec): void {
  if (field.generation?.scene !== undefined && !BATTLEFIELD_SCENES.includes(field.generation.scene)) throw Error('场景记录损坏');
  if (field.version !== 2 || ![[7, 9], [5, 7], [7, 11], [7, 13], [9, 15], [11, 17], [13, 19]].some(([w, h]) => field.width === w && field.height === h)) throw new Error('地图尺寸不支持（野战7×13，城区9×15/11×17/13×19，或旧地图）');
  if (field.tiles.length !== field.width * field.height || field.tiles.some((t) => !Object.hasOwn(TERRAIN_NAMES, t))) throw new Error('地形数据不完整');
  validateLayers(field);
  validateHeightMap(field);
  validateSceneRecord(field);
  if (field.objective.kind === 'control' && field.objective.cells !== undefined && (!Array.isArray(field.objective.cells) || !field.objective.cells.includes(field.objective.cell) || field.objective.cells.some(p => !inBounds(field, p) || groundBlocked(field, p)))) throw Error('占领区域不合法');
  if (field.environment !== undefined && (!Array.isArray(field.environment) || field.environment.some((t) => typeof t !== 'string'))) throw new Error('环境附加记录损坏');
  if (!inBounds(field, field.objective.cell) || (field.layerVersion ? groundBlocked(field, field.objective.cell) : field.tiles[field.objective.cell] === 'wall')) throw new Error('目标必须是合法可通行格');
  if (field.objective.kind === 'escape' && field.objective.defenderWins !== undefined && typeof field.objective.defenderWins !== 'boolean') throw new Error('护送判胜规则损坏');
}
export function inBounds(field: BattlefieldSpec, cell: number): boolean { return Number.isInteger(cell) && cell >= 0 && cell < field.tiles.length; }
export function gridDistance(field: BattlefieldSpec, a: number, b: number): number {
  return Math.abs(a % field.width - b % field.width) + Math.abs(Math.floor(a / field.width) - Math.floor(b / field.width));
}
export function cellLabel(field: BattlefieldSpec, cell: number): string { return String.fromCharCode(65 + cell % field.width) + (Math.floor(cell / field.width) + 1); }
/** 战报使用实际落点；飞越特殊地形时标清空中，避免误报地面掩护。 */
/** The collision token stays wall; environmental names explain natural hard blockers in v4 maps. */
export function structureDisplayName(field: BattlefieldSpec, cell: number): string {
  const structure = structureAt(field, cell), scene = field.generation?.scene;
  if (!structure) return '';
  if (scene === 'interior' && ['wall', 'building'].includes(structure.kind)) return '隔墙';
  if (scene === 'building_siege' && structure.kind === 'wall') return '外墙';
  if ((scene === 'interior' || scene === 'building_siege') && structure.kind === 'gate') return '门';
  return STRUCTURE_NAMES[structure.kind];
}
export function terrainName(field: BattlefieldSpec, cell: number): string {
  const terrain = field.tiles[cell];
  const structure = structureAt(field, cell);
  const indoor = field.generation?.scene === 'interior';
  const floorName = indoor && terrain === 'street' ? '室内地面' : TERRAIN_NAMES[terrain!];
  const structureLabel = structureDisplayName(field, cell);
  if (structure) return `${floorName}·${structureLabel}${structure.hp > 0 ? ' L' + structure.level + (structure.kind === 'gate' ? structure.gateState === 'open' ? '（开启）' : '（关闭）' : '') : '（已毁）'}`;
  if (indoor && terrain === 'street') return floorName;
  if (terrain === 'wall' && field.generation?.version === 4) {
    if (field.generation.family === 'forest') return '密林障碍';
    if (field.generation.family === 'mountain') return '岩障';
    if (field.generation.family === 'plains') return '巨石';
  }
  return terrain ? TERRAIN_NAMES[terrain] : '';
}
export function terrainCellLabel(field: BattlefieldSpec, cell: number, actor?: Combatant): string {
  const terrain = field.tiles[cell];
  return cellLabel(field, cell) + (landmarkAt(field, cell) ? '〔' + landmarkAt(field, cell) + '〕' : '') + (terrain && terrain !== 'open' ? '(' + terrainName(field, cell) + (actor && isAirborne(actor) ? '上空' : '') + ')' : '');
}
export function neighbors(field: BattlefieldSpec, cell: number): number[] {
  return [cell - field.width, cell - 1, cell + 1, cell + field.width].filter((n) => inBounds(field, n) && gridDistance(field, cell, n) === 1);
}
export function tileCost(field: BattlefieldSpec, cell: number, actor?: Combatant): number {
  const layered = layerMoveCost(field, cell, actor);
  if (layered !== undefined) return layered;
  if (actor && isAirborne(actor)) return 1;
  const terrain = field.tiles[cell], traits = actor?.rulesVersion === 'v2' ? activeTraitIds(actor) : [];
  if (terrain === 'forest') return traits.includes('forest-lore') ? 1 : 2;
  if (terrain === 'hill') return traits.includes('mountain-born') ? 1 : 2;
  return terrain === 'rough' ? 2 : 1;
}
/** Difficult but traversable ground cannot permanently trap a slow unit. A step costs
 * at most its FULL normal allowance, never its remaining allowance. Thus a 2-MP unit
 * with only 1 MP left still cannot enter a 3-cost fortification. Prohibitions stay infinite. */
export function movementStepCost(field: BattlefieldSpec, cell: number, actor: Combatant, tags = field.environment ?? [],from=actor.pos??cell): number {
  const cost = tileCost(field, cell, actor)+heightStepCost(field,from,cell,actor);
  return field.layerVersion && Number.isFinite(cost) ? Math.min(cost, movementPoints(actor, tags)) : cost;
}
export function footprint(unit: Combatant): number { return unit.mount === true || unit.body && unit.body !== 'human' ? 2 : 1; }
export function canOccupy(field: BattlefieldSpec, units: Combatant[], actor: Combatant, cell: number): boolean {
  if (!inBounds(field, cell) || (field.layerVersion ? groundBlocked(field, cell, actor) : field.tiles[cell] === 'wall' && !isAirborne(actor))) return false;
  const occupants = units.filter((u) => u.id !== actor.id && u.pos === cell && sameLayer(actor, u) && u.hp > 0 && (u.status === 'ready' || u.status === 'routing'));
  if (occupants.some((u) => u.side !== actor.side)) return false;
  return footprint(actor) + occupants.reduce((n, u) => n + footprint(u), 0) <= 2;
}
/** Dijkstra：几何距离与地形路径成本分开，稳定平局规则不消费RNG。 */
export function findGridPath(field: BattlefieldSpec, start: number, goal: number, allowed: (cell: number) => boolean, costOf:(cell:number,from:number)=>number = (cell,from) => tileCost(field, cell)+heightStepCost(field,from,cell)): GridPath | undefined {
  if (!inBounds(field, start) || !inBounds(field, goal) || (goal !== start && !allowed(goal))) return undefined;
  const costs = new Map([[start, 0]]); const previous = new Map<number, number>(); const open = new GridQueue(); open.push(start, 0);
  while (open.size) {
    const entry = open.pop()!, current = entry.cell;
    if (entry.cost !== costs.get(current)) continue;
    if (current === goal) {
      const cells = [goal]; while (cells[0] !== start) cells.unshift(previous.get(cells[0]!)!);
      return { cells, cost: costs.get(goal)! };
    }
    for (const next of neighbors(field, current)) {
      if (!allowed(next)) continue;
      const cost = costs.get(current)! + costOf(next,current);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, current); open.push(next, cost);
    }
  }
  return undefined;
}
/** 一次有界Dijkstra得到所有可达格，沿用单目标寻路的平局规则与路径。 */
export function reachableGridPaths(field: BattlefieldSpec, start: number, budget: number, allowed: (cell: number) => boolean,
  costOf:(cell:number,from:number)=>number = (cell,from) => tileCost(field, cell)+heightStepCost(field,from,cell)): GridPath[] {
  if (!inBounds(field, start) || budget < 0) return [];
  const costs = new Map([[start, 0]]), previous = new Map<number, number>(), open = new GridQueue(); open.push(start, 0);
  while (open.size) {
    const entry = open.pop()!, current = entry.cell;
    if (entry.cost !== costs.get(current)) continue;
    for (const next of neighbors(field, current)) {
      if (!allowed(next)) continue;
      const cost = costs.get(current)! + costOf(next,current);
      if (cost > budget || cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, current); open.push(next, cost);
    }
  }
  return [...costs.keys()].sort((a, b) => a - b).map(goal => {
    const cells = [goal]; while (cells[0] !== start) cells.unshift(previous.get(cells[0]!)!);
    return { cells, cost: costs.get(goal)! };
  });
}
/** 反向多源Dijkstra：一次计算各格到合法目标格的实际移动成本，供AI绕障碍。 */
export function gridCostsToGoals(field: BattlefieldSpec, goals: number[], allowed: (cell: number) => boolean,
  costOf:(cell:number,from:number)=>number = (cell,from) => tileCost(field, cell)+heightStepCost(field,from,cell)): Map<number, number> {
  const costs = new Map(goals.filter(cell => inBounds(field, cell) && allowed(cell)).map(cell => [cell, 0]));
  const open = new GridQueue(); for (const cell of costs.keys()) open.push(cell, 0);
  while (open.size) {
    const entry = open.pop()!, current = entry.cell;
    if (entry.cost !== costs.get(current)) continue;
    for (const previous of neighbors(field, current)) {
      if (!allowed(previous)) continue;
      // 正向从previous进入current时支付current地形成本。
      const cost = costs.get(current)! + costOf(current,previous);
      if (cost >= (costs.get(previous) ?? Infinity)) continue;
      costs.set(previous, cost); open.push(previous, cost);
    }
  }
  return costs;
}
/** 中心射线的保守 supercover；角点两侧硬遮挡都检查，正反方向一致。 */
export function lineOfSight(field: BattlefieldSpec, from: number, to: number, blockedAt: (cell: number) => boolean = cell => field.layerVersion ? obstructionHeight(field, cell) > 0 : field.tiles[cell] === 'wall'): boolean {
  if (!inBounds(field, from) || !inBounds(field, to)) return false;
  let x = from % field.width; let y = Math.floor(from / field.width);
  const tx = to % field.width; const ty = Math.floor(to / field.width);
  const dx = tx - x; const dy = ty - y; const sx = Math.sign(dx); const sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx); const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let atX = deltaX / 2; let atY = deltaY / 2;
  const blocked = (cx: number, cy: number) => blockedAt(cy * field.width + cx);
  while (x !== tx || y !== ty) {
    if (Math.abs(atX - atY) < 1e-9) {
      if (blocked(x + sx, y) || blocked(x, y + sy)) return false;
      x += sx; y += sy; atX += deltaX; atY += deltaY;
    } else if (atX < atY) { x += sx; atX += deltaX; }
    else { y += sy; atY += deltaY; }
    if (blocked(x, y)) return false;
  }
  return true;
}
/** 本版障碍只有地面高度，空中可越过；昼夜观测仍由观测模块约束。 */
export function meleeLineBlocker(field: BattlefieldSpec, from: Combatant, to: Combatant, units: Combatant[]): Combatant | undefined {
  if (!sameLayer(from, to)) return undefined;
  const blockers = units.filter(u => u.id !== from.id && u.id !== to.id && u.side !== from.side
    && u.hp > 0 && (u.status === 'ready' || u.status === 'routing') && sameLayer(from, u)
    && u.pos !== from.pos && u.pos !== to.pos);
  let blocker: Combatant | undefined;
  lineOfSight(field, from.pos!, to.pos!, cell => {
    blocker = blockers.find(u => u.pos === cell); return !!blocker;
  });
  return blocker;
}
/** Natural ground hides a unit only where it rises above both units: whoever stands at least as high as a slope,
 * terrace or crest sees over it, while a ridge higher than both still hides the far side. Walls, buildings, closed
 * gates and rock faces stay solid blocks checked against the actual ray at its lowest point inside them, so they
 * still shelter whoever stands right behind them. Both directions give the same answer. */
function heightLineOfSight(field: BattlefieldSpec, from: Combatant, to: Combatant): boolean {
  const fx = from.pos! % field.width, fy = Math.floor(from.pos! / field.width);
  const dx = to.pos! % field.width - fx, dy = Math.floor(to.pos! / field.width) - fy;
  const start = eyeHeight(field, from), rise = eyeHeight(field, to) - start;
  const standing = Math.max(unitHeight(field, from), unitHeight(field, to));
  const platform = isElevated(from) !== isElevated(to) ? isElevated(from) ? from : to : undefined;
  const adjacentDiagonal = Math.abs(dx) === 1 && Math.abs(dy) === 1;
  const forest = new Set<number>();
  return lineOfSight(field, from.pos!, to.pos!, cell => {
    if (cell === to.pos || cell === from.pos) return false;
    const cx = cell % field.width, cy = Math.floor(cell / field.width), ground = groundHeightAt(field, cell), top = obstructionHeight(field, cell);
    // A wall-top shot at the diagonal foot only grazes the corner of the connected wall segment.
    if (adjacentDiagonal && platform && structureAt(field, cell)?.top && top <= unitHeight(field, platform)) return false;
    if (top > ground) {
      let enter = 0, leave = 1;
      for (const [origin, delta, centre] of [[fx, dx, cx], [fy, dy, cy]] as const) if (delta !== 0) {
        const a = (centre - .5 - origin) / delta, b = (centre + .5 - origin) / delta;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
      return top >= start + rise * (rise >= 0 ? enter : leave);
    }
    if (ground > standing) return true;
    // Canopy stands one level above its ground; a ray passing under it counts toward the dense-forest limit.
    const ray = start + rise * Math.max(0, Math.min(1, ((cx - fx) * dx + (cy - fy) * dy) / Math.max(1, dx * dx + dy * dy)));
    if (field.tiles[cell] === 'forest' && ray < ground + 1) forest.add(cell);
    return forest.size > 2;
  });
}
export function unitLineOfSight(field: BattlefieldSpec, from: Combatant, to: Combatant): boolean {
  if (!inBounds(field, from.pos!) || !inBounds(field, to.pos!)) return false;
  if (!field.layerVersion) return isAirborne(from) || isAirborne(to) || lineOfSight(field, from.pos!, to.pos!);
  if (field.spatialRulesVersion === 2) return heightLineOfSight(field, from, to);
  const height = (u: Combatant) => isAirborne(u) ? 2.25 : isElevated(u) ? 1.25 : .25;
  const distance = Math.max(1, gridDistance(field, from.pos!, to.pos!));
  const adjacentDiagonal = Math.abs(from.pos! % field.width - to.pos! % field.width) === 1
    && Math.abs(Math.floor(from.pos! / field.width) - Math.floor(to.pos! / field.width)) === 1;
  const forest = new Set<number>();
  return lineOfSight(field, from.pos!, to.pos!, cell => {
    if (cell === to.pos || cell === from.pos) return false;
    // 墙顶射向斜邻墙脚时，射线只擦过相连的墙顶格角，不应被本段城墙挡住。
    if (adjacentDiagonal && isElevated(from) && !isElevated(to) && gridDistance(field, from.pos!, cell) === 1
      && structureAt(field, cell)?.top && obstructionHeight(field, cell) === 1) return false;
    const rayHeight = height(from) + (height(to) - height(from)) * Math.min(1, gridDistance(field, from.pos!, cell) / distance);
    if (obstructionHeight(field, cell) >= rayHeight) return true;
    if (field.tiles[cell] === 'forest' && rayHeight < 1) forest.add(cell);
    return forest.size > 2;
  });
}
/** 部署先在副本上验证所有容量与阵营归属，失败不改真实单位。 */
export function gridDeploymentCells(field: BattlefieldSpec, unit: Combatant): number[] {
  const specific=field.deploymentZones?.filter(z=>z.unitId===unit.id)??[];
  const bySide=field.deploymentZones?.filter(z=>!z.unitId&&z.side===unit.side)??[];
  const selected=specific.length?specific:bySide.some(z=>z.landmarkId)?bySide.filter(z=>z.landmarkId):bySide;
  if(selected.length&&(!isElevated(unit)||selected.some(z=>z.landmarkId))) {
    let cells=selected[0]!.cells.filter(p=>selected.every(z=>z.cells.includes(p)));
    // Several posts for one side that cannot overlap are covered together rather than leaving no cell.
    if(!cells.length)cells=[...new Set(selected.flatMap(z=>z.cells))];
    if(isElevated(unit))cells=cells.filter(p=>structureAt(field,p)?.top&&structureAt(field,p)!.hp>0);
    if(unit.rulesVersion==='v2'&&activeTraitIds(unit).includes('vanguard')&&!selected.some(z=>z.landmarkId)) {
      const front=[...new Set(cells.flatMap(p=>neighbors(field,p)))].filter(p=>!cells.includes(p)&&!groundBlocked(field,p,unit)
        &&(!field.city?.defender||unit.side===field.city.defender||!field.city.inside.includes(p))
        &&!field.deploymentZones?.some(z=>z.side!==unit.side&&z.cells.includes(p)));
      cells=[...cells,...front];
    }
    return [...new Set(cells)];
  }
  // Defenders posted in the streets or sallying out do not man the walls.
  if (isElevated(unit) && selected.some(z => z.relation === 'sector:inside' || z.relation === 'sector:outside')) return [];
  if (field.layerVersion && field.city?.defender === unit.side) {
    const cells = isElevated(unit) ? field.city.frontline.filter(p => structureAt(field, p)?.top && structureAt(field, p)!.hp > 0)
      : [...field.city.inside, ...field.city.reserve].filter(p => !groundBlocked(field, p, unit));
    return [...new Set(cells)];
  }
  const rows = unit.side === 'enemy' ? [2, 1, 0] : [field.height - 3, field.height - 2, field.height - 1];
  if (unit.rulesVersion === 'v2' && isRangedWeapon(unit.weapon)) rows.reverse();
  const ordinary = rows.flatMap((y) => Array.from({ length: field.width }, (_, x) => y * field.width + x));
  if (unit.rulesVersion !== 'v2' || !activeTraitIds(unit).includes('vanguard')) return ordinary;
  const y = unit.side === 'enemy' ? 3 : field.height - 4;
  const forward = Array.from({ length: field.width }, (_, x) => x)
    .filter((x) => field.height !== 7 || (unit.side === 'enemy' ? x > Math.floor(field.width / 2) : x < Math.floor(field.width / 2)))
    .sort((a, b) => Math.min(a, field.width - 1 - a) - Math.min(b, field.width - 1 - b) || a - b)
    .map((x) => y * field.width + x).filter((cell) => cell !== field.objective.cell);
  return [...forward, ...ordinary].filter(p => !field.city?.defender || unit.side === field.city.defender || !field.city.inside.includes(p));
}
export function retreatCells(field:BattlefieldSpec,side:Combatant['side']):number[] {
  if(side!=='ally'&&side!=='enemy')return [];
  return field.retreatEdges?.[side]??Array.from({length:field.width},(_,x)=>(side==='ally'?field.height-1:0)*field.width+x);
}
/** 小幅扰动按单位/格子派生，数组顺序、评分次数与战斗骰子都不会改变它。 */
function deploymentNoise(seed: string, id: string, key: string): number {
  return new SeededRng(JSON.stringify(['deployment-v1', seed, id, key])).next();
}

/** 只看公开地形与己方站位，不读取尚未发现的敌军位置来优化射界。 */
function deploymentScorer(field: BattlefieldSpec, unit: Combatant, seed: string) {
  const enemy = unit.side === 'enemy', ranged = isRangedWeapon(unit.weapon), air = isAirborne(unit);
  const forward = enemy ? 3 : field.height - 4;
  const vanguard = activeTraitIds(unit).includes('vanguard');
  const preferredDepth = ranged ? gridWeaponRange(unit.weapon) <= 4 ? 1 : 0 : 2;
  const preferredY = vanguard ? forward : enemy ? preferredDepth : field.height - 1 - preferredDepth;
  const middle = Math.floor(field.height / 2);
  const probes = [...new Set([forward, middle])].flatMap(y => Array.from({ length: field.width }, (_, x) => y * field.width + x))
    .filter(p => field.layerVersion ? !groundBlocked(field, p, unit) : field.tiles[p] !== 'wall');
  const costs = gridCostsToGoals(field, probes, p => field.layerVersion ? !groundBlocked(field, p, unit) : air || field.tiles[p] !== 'wall', (p,from) => tileCost(field, p, unit)+heightStepCost(field,from,p,unit));
  // A garrison given only a compass area keeps the siege layout: close to its walls, with a reserve.
  const contextual=field.deploymentZones?.some(z=>(z.unitId===unit.id||!z.unitId&&z.side===unit.side)&&!(field.city?.defender===unit.side&&z.relation?.startsWith('sector')));
  const emptyConditions = new Map<string, ConditionDef>();
  return (position: number, placed: Combatant[]) => {
    const actor = { ...unit, pos: position }, friends = placed.filter(u => u.id !== unit.id && u.side === unit.side);
    const blockingFriends = friends.filter(u => sameLayer(unit, u) && u.hp > 0 && ['ready', 'routing'].includes(u.status));
    const y = Math.floor(position / field.width), x = position % field.width;
    const terrain = air ? 'open' : field.tiles[position];
    const distance = probes.length ? Math.min(...probes.map(p => gridDistance(field, position, p))) : 0;
    const detour = Math.max(0, (costs.get(position) ?? distance + 20) - distance);
    const city = field.layerVersion && field.city?.defender === unit.side ? field.city : undefined;
    // A ring or a double wall is manned on the face toward the assault, not on the rear or the inner wall.
    const slots = city ? (deploymentNoise(seed, unit.id, 'reserve') < .2 && !isElevated(unit) ? city.reserve : city.frontage?.length ? city.frontage : city.frontline) : [];
    const lineDistance = slots.length ? Math.min(...slots.map(p => gridDistance(field, p, position))) : 0;
    let score = (contextual?(ranged?1.2:-1.8)*gridDistance(field,position,field.objective.cell):city ? -4 * lineDistance : -5 * Math.abs(y - preferredY)) - 0.45 * Math.abs(x - Math.floor(field.width / 2))
      - 8 * blockingFriends.filter(u => u.pos === position).length
      - 0.3 * blockingFriends.filter(u => gridDistance(field, u.pos!, position) === 1).length
      - 0.4 * detour - 0.7 * (tileCost(field, position, unit) - 1)
      + (terrain === 'cover' ? 1.4 : terrain === 'forest' ? 0.4 : 0)
      + 1.5 * deploymentNoise(seed, unit.id, String(position));
    if (ranged && !unit.weapon?.indirect) {
      const targets = probes.filter(p => p !== position && gridDistance(field, position, p) <= gridWeaponRange(unit.weapon));
      const clear = targets.filter(p => {
        const target = { ...actor, id: '@deployment-probe', side: enemy ? 'ally' as const : 'enemy' as const, pos: p, airborne: false };
        return unitLineOfSight(field, actor, target) && !rangedScreen(actor, target, unit.weapon, friends, { mode: 'small', width: field.width,battlefield:field }, emptyConditions);
      }).length;
      score += clear ? 4 * clear / targets.length : -6;
    }
    return score;
  };
}

/** Pure preparation shared by generator capacity checks and SmallBattle.start. */
export function prepareGridDeployment(field: BattlefieldSpec, units: readonly Combatant[], seed = 'deployment', conditions?: FlightConditions, enableFlight = true): Combatant[] {
  const prepared = units.map(u => ({ ...u, ...(enableFlight && u.rulesVersion === 'v2' && u.airborne === undefined && !flightCapabilityReason(u, conditions) ? { airborne: true } : {}) }));
  for(const u of prepared) {
    const frozen=field.initialDeployment&&Object.hasOwn(field.initialDeployment,u.id)?field.initialDeployment[u.id]:undefined;
    if(frozen&&u.pos===undefined){if(frozen.airborne&&(!enableFlight||flightCapabilityReason(u,conditions)))throw Error('冻结部署的飞行状态与实际能力不一致');Object.assign(u,frozen);}
    // Same precedence as gridDeploymentCells: a unit's own zones replace its side's zones.
    const own=field.deploymentZones?.filter(z=>z.unitId===u.id)??[];
    const zones=own.length?own:field.deploymentZones?.filter(z=>!z.unitId&&z.side===u.side)??[];
    if(zones.some(z=>z.platform)){u.elevation=1;u.airborne=false;}
    else if(zones.some(z=>z.relation==='occupies'||z.relation==='inside'))u.airborne=false;
  }
  if (field.layerVersion && field.city?.defender) {
    const guard = prepared.filter(u => u.side === field.city!.defender && u.pos === undefined && !isAirborne(u)
      &&gridDeploymentCells(field,{...u,elevation:1}).some(p=>structureAt(field,p)?.top))
      .sort((a,b) => Number(isRangedWeapon(b.weapon)) - Number(isRangedWeapon(a.weapon)) || a.id.localeCompare(b.id));
    const capacity = field.city.frontline.filter(p => structureAt(field,p)?.hp && structureAt(field,p)?.top).length;
    // A narrative that mans the walls lifts most guards onto them; the default keeps a street reserve.
    const manned = field.deploymentZones?.some(z => !z.unitId && z.side === field.city!.defender && z.relation === 'sector:wall');
    for (const u of guard.slice(0, Math.min(capacity, Math.floor(guard.length * (manned ? .75 : .4))))) u.elevation = 1;
  }
  const positions = deployOnGrid(field, prepared, seed);
  prepared.forEach((u,i) => { u.pos = positions[i]; });
  return prepared;
}

/** 未指定位置的新规则单位按角色/地形布阵；同种子复现，显式部署优先且失败不修改原名单。 */
export function deployOnGrid(field: BattlefieldSpec, units: Combatant[], seed = 'deployment'): number[] {
  validateField(field);
  const scratch = units.map((u) => ({ ...u }));
  const occupied: Combatant[] = [];
  const modern = units.every(u => u.rulesVersion === 'v2');
  const ordered = [...scratch].sort((a, b) => Number(a.pos === undefined) - Number(b.pos === undefined)
    || (modern ? footprint(b) - footprint(a)
      || Number(activeTraitIds(a).includes('vanguard')) - Number(activeTraitIds(b).includes('vanguard'))
      || Number(isRangedWeapon(a.weapon)) - Number(isRangedWeapon(b.weapon))
      || deploymentNoise(seed, a.id, 'order') - deploymentNoise(seed, b.id, 'order') : 0)
    || a.id.localeCompare(b.id));
  const scorers = new Map(ordered.filter(u => modern && u.pos === undefined).map(u => [u.id, deploymentScorer(field, u, seed)]));
  const select = (unit: Combatant, candidates: number[]) => {
    let legal = candidates.filter(n => canOccupy(field, occupied, unit, n));
    // 先锋优先利用专属前出域，避免占掉普通单位唯一可用的部署容量。
    if (modern && activeTraitIds(unit).includes('vanguard')&&!field.deploymentZones?.length) {
      const forward = unit.side === 'enemy' ? 3 : field.height - 4;
      const advanced = legal.filter(n => Math.floor(n / field.width) === forward);
      if (advanced.length) legal = advanced;
    }
    const score = scorers.get(unit.id);
    return score ? legal.map(n => ({ n, score: score(n, occupied) })).sort((a, b) => b.score - a.score || a.n - b.n)[0]?.n : legal[0];
  };
  for (const unit of ordered) {
    const candidates = gridDeploymentCells(field, unit);
    const cell = unit.pos ?? select(unit, candidates);
    if (cell === undefined || !candidates.includes(cell) || !canOccupy(field, occupied, unit, cell)) throw new Error('部署越界、跨阵营或容量不足；请减少上场单位');
    unit.pos = cell; occupied.push(unit);
  }
  // 大型远程先占整格后，再依据已完成的前排站位调整一次射界；玩家指定位置不动。
  if (modern) for (const unit of ordered.filter(u => scorers.has(u.id) && isRangedWeapon(u.weapon))) {
    unit.pos = select(unit, gridDeploymentCells(field, unit)) ?? unit.pos;
  }
  return units.map((u) => scratch.find((c) => c.id === u.id)!.pos!);
}

/** Small positional tie-breaker, using actual rules and observed opponents only. Never a combat modifier. */
export function terrainTacticalValue(field: BattlefieldSpec, cell: number, actor: Combatant, visibleFoes: Combatant[]): number {
  if (isAirborne(actor) || !inBounds(field, cell)) return 0;
  // Real-height maps judge the ground the unit would actually stand on (a platform or bridge deck is not undergrowth or water).
  const heights = field.spatialRulesVersion === 2, terrain = heights ? standingTerrain(field, { ...actor, pos: cell }) : field.tiles[cell], traits = activeTraitIds(actor);
  const foes = visibleFoes.filter(u => u.side !== actor.side && u.status === 'ready' && u.hp > 0 && u.pos !== undefined);
  let protection = 0;
  for (const foe of foes) {
    const distant = gridDistance(field, cell, foe.pos!) > 1;
    const cover = terrain === 'cover' && distant || actor.rulesVersion === 'v2' && terrain === 'forest' && distant && isRangedWeapon(foe.weapon) ? 2 : 0;
    const height = actor.rulesVersion !== 'v2' ? 0 : heights ? heightDefense(field, { ...actor, pos: cell }, foe)
      : terrain === 'hill' && (isAirborne(foe) || field.tiles[foe.pos!] !== 'hill') ? 1 : 0;
    // Real heights stack with cover in combat; older maps keep the first matching protection only.
    protection += heights ? cover + height : cover || height;
  }
  const penalty = actor.rulesVersion === 'v2' && (terrain === 'forest' && !traits.includes('forest-lore') || !heights && terrain === 'hill' && !traits.includes('mountain-born')) ? .45
    : heights && (terrain === 'shallow_water' || terrain === 'swamp') && !traits.includes('water-crossing') ? 1 : 0;
  const concealment = traits.includes('stalk') && ['cover', 'forest'].includes(terrain ?? '')
    && foes.every(u => gridDistance(field, cell, u.pos!) > 2) ? .25 : 0;
  if (field.layerVersion) protection += foes.reduce((n, f) => n + structureDefense(field, { ...actor, pos: cell }, f, isRangedWeapon(f.weapon)), 0);
  return Math.min(field.layerVersion ? 2.2 : 1.2, protection / Math.max(1, foes.length) * .55) - penalty + concealment;
}
