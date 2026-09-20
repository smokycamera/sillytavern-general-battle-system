import { SeededRng } from '../rng.js';
import { environmentTags } from '../environment.js';
import { defaultBattleObjective, neighbors, validateField, type BattlefieldSpec, type Terrain } from './spatial.js';

/**
 * 有限布局参数与对称地形布置。地图随机独立于战斗骰子；生成后保存真实格子。
 * 保留中央与两侧通路，避免大图只有一条中央走廊。
 * 标准野战为7×13：双方常规前锋相隔8格，远程优先后排，相隔10–12格；
 * 旧7×9存档仍可校验与恢复，室内图固定5×7。
 */
export function generatedField(seed: string, width = 7, height = 13, tags: string[] = []): BattlefieldSpec {
  const rng = new SeededRng('field-v1:' + seed), environment = environmentTags(tags);
  const middle = Math.floor(height / 2), center = Math.floor(width / 2);
  const tiles: Terrain[] = Array.from({ length: width * height }, () => 'open');
  const field: BattlefieldSpec = { version: 2, width, height, tiles, environment,
    objective: defaultBattleObjective(width, height, environment) };
  validateField(field);
  const paths = new Set([0, center, width - 1]);
  const urban = width === 5 || environment.some((t) => t === 'urban' || t === 'siege');
  const natural: Terrain = environment.includes('forest') ? 'forest' : environment.includes('mountain') ? 'hill' : 'rough';
  const pair = (x: number, y: number, terrain: Terrain) => {
    const oppositeX = width - 1 - x, oppositeY = height - 1 - y;
    if (paths.has(x) || paths.has(oppositeX)) return;
    tiles[y * width + x] = terrain; tiles[oppositeY * width + oppositeX] = terrain;
  };
  // 前三行是部署区，只布置可通行地形；墙体限于中央的预先保留空位。
  for (let y = 1; y <= middle; y++) for (let x = 1; x < width - 1; x++) {
    if (paths.has(x)) continue;
    const roll = rng.next();
    if (roll < (natural === 'rough' ? 0.25 : 0.55)) pair(x, y, natural);
    else if (roll < 0.75) pair(x, y, 'cover');
  }
  if (urban) {
    const offset = rng.next() < 0.5 ? 1 : width - 2;
    pair(offset, middle, 'wall');
    if (width === 7 && rng.next() < 0.5) pair(2, middle, 'wall');
  }
  // 一次洪泛确认全部可通行格与任务点连通，涵盖两侧部署区和护送出口。
  const reached = new Set([field.objective.cell]), queue = [field.objective.cell];
  for (let i = 0; i < queue.length; i++) for (const next of neighbors(field, queue[i]!)) {
    if (tiles[next] === 'wall' || reached.has(next)) continue;
    reached.add(next); queue.push(next);
  }
  if (tiles.some((t, n) => t !== 'wall' && !reached.has(n))) {
    for (let n = 0; n < tiles.length; n++) if (tiles[n] === 'wall') tiles[n] = 'cover';
  }
  return field;
}
