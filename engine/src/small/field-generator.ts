import { SeededRng } from '../rng.js';
import { environmentTags } from '../environment.js';
import { flightCapabilityReason } from '../aerial.js';
import type { Combatant } from '../types.js';
import { defaultBattleObjective, deployOnGrid, findGridPath, neighbors, validateField, type BattlefieldSpec, type Terrain } from './spatial.js';

export interface FieldGenerationOptions {
  /** 室内墙体避让本场实际部署；不改写名单或单位位置。 */
  roster?: Combatant[];
  attackingSide?: 'ally' | 'enemy';
}

/**
 * 非对称地形块、街区墙段与独立曲折通路。仅新战场生成，旧快照直接恢复真实格子。
 * 地图使用独立种子，不消费战斗骰子；夜间只影响光照，不重排同一种子的地形。
 */
export function generatedField(seed: string, width = 7, height = 13, tags: string[] = [], options: FieldGenerationOptions = {}): BattlefieldSpec {
  const rng = new SeededRng('field-v2:' + seed), environment = environmentTags(tags);
  const center = Math.floor(width / 2), middle = Math.floor(height / 2), indoor = width === 5;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => 'open');
  const field: BattlefieldSpec = { version: 2, width, height, tiles, environment,
    objective: defaultBattleObjective(width, height, environment, options.attackingSide) };
  validateField(field);
  const int = (min: number, max: number) => min + Math.floor(rng.next() * (max - min + 1));
  const pick = <T>(values: readonly T[]): T => values[int(0, values.length - 1)]!;
  const cell = (x: number, y: number) => y * width + x;
  // 所有任务模式可能使用的点位均保留；护送出口、双方攻城点和歼灭图中心都合法。
  const reserved = new Set([field.objective.cell, cell(center, 0), cell(center, 1), cell(center, middle),
    cell(center, height - 2), cell(center, height - 1)]);
  if (indoor && options.roster?.length) {
    const units = options.roster.map(u => ({ ...u, airborne: u.airborne ?? !flightCapabilityReason(u) }));
    for (const position of deployOnGrid(field, units, seed)) reserved.add(position);
  }

  // 两条通路各自选起点和转折，不复制/旋转另一侧。允许侧边和中列出现地形。
  const roads = new Set<number>();
  for (const [left, right] of [[0, center - 1], [center + 1, width - 1]] as const) {
    let x = int(left, right);
    for (let y = 0; y < height; y++) {
      const previous = x;
      if (y > 1 && y < height - 2 && rng.next() < 0.35) x = Math.max(left, Math.min(right, x + pick([-1, 1])));
      for (let step = Math.min(previous, x); step <= Math.max(previous, x); step++) roads.add(cell(step, y));
    }
  }
  const paint = (position: number, terrain: Terrain) => {
    if (!roads.has(position) && !reserved.has(position)) tiles[position] = terrain;
  };
  // 邻接生长使林地/山地形成可辨认的片区，而不是逐格独立撒点。
  const patch = (terrain: Terrain, size: number, start = cell(int(0, width - 1), int(1, height - 2))) => {
    const grown = new Set([start]);
    for (let n = 0; n < size; n++) {
      const frontier = [...new Set([...grown].flatMap(p => neighbors(field, p)))].filter(p => !grown.has(p)
        && Math.floor(p / width) > 0 && Math.floor(p / width) < height - 1);
      if (!frontier.length) break;
      grown.add(pick(frontier));
    }
    for (const p of grown) paint(p, terrain);
  };
  const patches = (terrain: Terrain, count: number, min: number, max: number) => {
    for (let n = 0; n < count; n++) patch(terrain, int(min, max));
  };
  const siege = environment.includes('siege'), urban = environment.includes('urban');
  const forest = environment.includes('forest'), mountain = environment.includes('mountain');
  if (forest) {
    patches('forest', Math.ceil(tiles.length / 12), 3, 7);
    patches('rough', 2, 1, 3);
  } else if (mountain) {
    patches('hill', Math.ceil(tiles.length / 13), 3, 7);
    patches('rough', 3, 2, 4);
  } else if (urban || siege || indoor) {
    patches('rough', indoor ? 2 : 4, 1, 3);
  } else {
    patches('rough', 2, 1, 3);
    patches(pick(['hill', 'forest'] as const), 2, 1, 3);
  }
  patches('cover', indoor ? 3 : int(4, 6), 0, 2);

  // 标准地图保留前三排部署容量；室内依据名单让位，因此墙段可以进入不同纵深。
  const wallMinY = indoor ? 1 : 3, wallMaxY = height - 1 - wallMinY;
  const wall = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= wallMinY && y <= wallMaxY) paint(cell(x, y), 'wall');
  };
  const segment = (x: number, y: number, length: number, vertical: boolean, bend: boolean) => {
    const direction = pick([-1, 1]);
    for (let n = 0; n < length; n++) wall(x + (vertical ? 0 : n * direction), y + (vertical ? n * direction : 0));
    if (bend) wall(x + (vertical ? direction : 0), y + (vertical ? 0 : direction));
  };
  if (siege) {
    // 防线靠近守方；两条独立通路穿过防线，形成主缺口与侧路。
    const front = options.attackingSide === 'enemy' ? wallMaxY : wallMinY;
    const inward = options.attackingSide === 'enemy' ? -1 : 1;
    for (let x = 0; x < width; x++) wall(x, front);
    for (let n = 0; n < (indoor ? 2 : 3); n++) {
      const x = int(0, width - 1);
      segment(x, front + inward * int(1, 2), int(2, 3), rng.next() < 0.5, true);
      paint(cell(x, Math.max(1, Math.min(height - 2, front - inward))), 'cover');
    }
  } else if (urban || indoor) {
    // 0:错位墙段；1:转角街区；2:偏置广场；3:破碎废墟。
    const layout = int(0, 3), count = indoor ? int(3, 5) : int(5, 8);
    for (let n = 0; n < count; n++) segment(int(0, width - 1), int(wallMinY, wallMaxY),
      layout === 3 ? int(1, 2) : int(2, 4), rng.next() < 0.5, layout === 1 || layout === 2);
    if (layout === 2) {
      const x = int(1, width - 2), y = int(wallMinY, wallMaxY);
      for (const p of [cell(x, y), ...neighbors(field, cell(x, y))]) paint(p, 'open');
    }
  }
  for (const p of roads) tiles[p] = 'open';
  for (const p of reserved) tiles[p] = 'open';

  // 局部开缺口连接孤立房间；不再因一处不通就删除整张图的墙。
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
  validateField(field);
  return field;
}
