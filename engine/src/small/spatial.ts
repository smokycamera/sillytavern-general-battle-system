import { isRangedWeapon } from '../loadout.js';
import type { Combatant } from '../types.js';
import { activeTraitIds } from '../trait-sources.js';
import { environmentTags } from '../environment.js';
import { isAirborne, sameLayer } from '../aerial.js';

export const DEFAULT_SMALL_ROUND_LIMIT = 60;

export type Terrain = 'open' | 'cover' | 'wall' | 'rough' | 'forest' | 'hill';
export interface BattlefieldSpec {
  environment?: string[];
  version: 2;
  width: number;
  height: number;
  tiles: Terrain[];
  objective: { kind: 'annihilation'; cell: number; limit: number } | { kind: 'control'; cell: number; rounds: number; limit: number; attackingSide?: 'ally' | 'enemy' } | { kind: 'escape'; unitId: string; cell: number; limit: number; defenderWins?: boolean };
}
/** 攻城点位于守方纵深中央；歼灭战保留中心坐标仅供地图连通性检查。 */
export function defaultBattleObjective(width: number, height: number, tags: string[], attackingSide: 'ally' | 'enemy' = 'ally'): BattlefieldSpec['objective'] {
  return tags.includes('siege')
    ? { kind: 'control', attackingSide, cell: (attackingSide === 'ally' ? 1 : height - 2) * width + Math.floor(width / 2), rounds: 5, limit: DEFAULT_SMALL_ROUND_LIMIT }
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
  if (field.version !== 2 || ![[7, 9], [5, 7], [7, 11], [7, 13]].some(([w, h]) => field.width === w && field.height === h)) throw new Error('支持7×13标准地图、旧7×11/7×9存档或5×7室内地图');
  if (field.tiles.length !== field.width * field.height || field.tiles.some((t) => !['open', 'cover', 'wall', 'rough', 'forest', 'hill'].includes(t))) throw new Error('地形数据不完整');
  if (field.environment !== undefined && (!Array.isArray(field.environment) || field.environment.some((t) => typeof t !== 'string'))) throw new Error('环境附加记录损坏');
  if (!inBounds(field, field.objective.cell) || field.tiles[field.objective.cell] === 'wall') throw new Error('目标必须是合法可通行格');
  if (field.objective.kind === 'escape' && field.objective.defenderWins !== undefined && typeof field.objective.defenderWins !== 'boolean') throw new Error('护送判胜规则损坏');
}
export function inBounds(field: BattlefieldSpec, cell: number): boolean { return Number.isInteger(cell) && cell >= 0 && cell < field.tiles.length; }
export function gridDistance(field: BattlefieldSpec, a: number, b: number): number {
  return Math.abs(a % field.width - b % field.width) + Math.abs(Math.floor(a / field.width) - Math.floor(b / field.width));
}
export function cellLabel(field: BattlefieldSpec, cell: number): string { return String.fromCharCode(65 + cell % field.width) + (Math.floor(cell / field.width) + 1); }
export function neighbors(field: BattlefieldSpec, cell: number): number[] {
  return [cell - field.width, cell - 1, cell + 1, cell + field.width].filter((n) => inBounds(field, n) && gridDistance(field, cell, n) === 1);
}
export function tileCost(field: BattlefieldSpec, cell: number, actor?: Combatant): number {
  if (actor && isAirborne(actor)) return 1;
  const terrain = field.tiles[cell], traits = actor?.rulesVersion === 'v2' ? activeTraitIds(actor) : [];
  if (terrain === 'forest') return traits.includes('forest-lore') ? 1 : 2;
  if (terrain === 'hill') return traits.includes('mountain-born') ? 1 : 2;
  return terrain === 'rough' ? 2 : 1;
}
export function footprint(unit: Combatant): number { return unit.mount === true || unit.body && unit.body !== 'human' ? 2 : 1; }
export function canOccupy(field: BattlefieldSpec, units: Combatant[], actor: Combatant, cell: number): boolean {
  if (!inBounds(field, cell) || field.tiles[cell] === 'wall' && !isAirborne(actor)) return false;
  const occupants = units.filter((u) => u.id !== actor.id && u.pos === cell && sameLayer(actor, u) && u.hp > 0 && (u.status === 'ready' || u.status === 'routing'));
  if (occupants.some((u) => u.side !== actor.side)) return false;
  return footprint(actor) + occupants.reduce((n, u) => n + footprint(u), 0) <= 2;
}
/** Dijkstra：几何距离与地形路径成本分开，稳定平局规则不消费RNG。 */
export function findGridPath(field: BattlefieldSpec, start: number, goal: number, allowed: (cell: number) => boolean, costOf = (cell: number) => tileCost(field, cell)): GridPath | undefined {
  if (!inBounds(field, start) || !inBounds(field, goal) || (goal !== start && !allowed(goal))) return undefined;
  const costs = new Map([[start, 0]]); const previous = new Map<number, number>(); const open = new Set([start]);
  while (open.size) {
    const current = [...open].sort((a, b) => costs.get(a)! - costs.get(b)! || a - b)[0]!;
    open.delete(current);
    if (current === goal) {
      const cells = [goal]; while (cells[0] !== start) cells.unshift(previous.get(cells[0]!)!);
      return { cells, cost: costs.get(goal)! };
    }
    for (const next of neighbors(field, current)) {
      if (!allowed(next)) continue;
      const cost = costs.get(current)! + costOf(next);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, current); open.add(next);
    }
  }
  return undefined;
}
/** 一次有界Dijkstra得到所有可达格，沿用单目标寻路的平局规则与路径。 */
export function reachableGridPaths(field: BattlefieldSpec, start: number, budget: number, allowed: (cell: number) => boolean,
  costOf = (cell: number) => tileCost(field, cell)): GridPath[] {
  if (!inBounds(field, start) || budget < 0) return [];
  const costs = new Map([[start, 0]]), previous = new Map<number, number>(), open = new Set([start]);
  while (open.size) {
    const current = [...open].sort((a, b) => costs.get(a)! - costs.get(b)! || a - b)[0]!;
    open.delete(current);
    for (const next of neighbors(field, current)) {
      if (!allowed(next)) continue;
      const cost = costs.get(current)! + costOf(next);
      if (cost > budget || cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, current); open.add(next);
    }
  }
  return [...costs.keys()].sort((a, b) => a - b).map(goal => {
    const cells = [goal]; while (cells[0] !== start) cells.unshift(previous.get(cells[0]!)!);
    return { cells, cost: costs.get(goal)! };
  });
}
/** 反向多源Dijkstra：一次计算各格到合法目标格的实际移动成本，供AI绕障碍。 */
export function gridCostsToGoals(field: BattlefieldSpec, goals: number[], allowed: (cell: number) => boolean,
  costOf = (cell: number) => tileCost(field, cell)): Map<number, number> {
  const costs = new Map(goals.filter(cell => inBounds(field, cell) && allowed(cell)).map(cell => [cell, 0]));
  const open = new Set(costs.keys());
  while (open.size) {
    const current = [...open].sort((a, b) => costs.get(a)! - costs.get(b)! || a - b)[0]!;
    open.delete(current);
    for (const previous of neighbors(field, current)) {
      if (!allowed(previous)) continue;
      // 正向从previous进入current时支付current地形成本。
      const cost = costs.get(current)! + costOf(current);
      if (cost >= (costs.get(previous) ?? Infinity)) continue;
      costs.set(previous, cost); open.add(previous);
    }
  }
  return costs;
}
/** 中心射线的保守 supercover；角点两侧硬遮挡都检查，正反方向一致。 */
export function lineOfSight(field: BattlefieldSpec, from: number, to: number, blockedAt: (cell: number) => boolean = cell => field.tiles[cell] === 'wall'): boolean {
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
export function unitLineOfSight(field: BattlefieldSpec, from: Combatant, to: Combatant): boolean {
  return inBounds(field, from.pos!) && inBounds(field, to.pos!) && (isAirborne(from) || isAirborne(to) || lineOfSight(field, from.pos!, to.pos!));
}
/** 部署先在副本上验证所有容量与阵营归属，失败不改真实单位。 */
export function gridDeploymentCells(field: BattlefieldSpec, unit: Combatant): number[] {
  const rows = unit.side === 'enemy' ? [2, 1, 0] : [field.height - 3, field.height - 2, field.height - 1];
  if (unit.rulesVersion === 'v2' && isRangedWeapon(unit.weapon)) rows.reverse();
  const ordinary = rows.flatMap((y) => Array.from({ length: field.width }, (_, x) => y * field.width + x));
  if (unit.rulesVersion !== 'v2' || !activeTraitIds(unit).includes('vanguard')) return ordinary;
  const y = unit.side === 'enemy' ? 3 : field.height - 4;
  const forward = Array.from({ length: field.width }, (_, x) => x)
    .filter((x) => field.height !== 7 || (unit.side === 'enemy' ? x > Math.floor(field.width / 2) : x < Math.floor(field.width / 2)))
    .sort((a, b) => Math.min(a, field.width - 1 - a) - Math.min(b, field.width - 1 - b) || a - b)
    .map((x) => y * field.width + x).filter((cell) => cell !== field.objective.cell);
  return [...forward, ...ordinary];
}
export function deployOnGrid(field: BattlefieldSpec, units: Combatant[]): number[] {
  validateField(field);
  const scratch = units.map((u) => ({ ...u }));
  const occupied: Combatant[] = [];
  for (const unit of [...scratch].sort((a, b) => Number(a.pos === undefined) - Number(b.pos === undefined) || a.id.localeCompare(b.id))) {
    const candidates = gridDeploymentCells(field, unit);
    const cell = unit.pos ?? candidates.find((n) => canOccupy(field, occupied, unit, n));
    if (cell === undefined || !candidates.includes(cell) || !canOccupy(field, occupied, unit, cell)) throw new Error('部署越界、跨阵营或容量不足；请减少上场单位');
    unit.pos = cell; occupied.push(unit);
  }
  return units.map((u) => scratch.find((c) => c.id === u.id)!.pos!);
}
