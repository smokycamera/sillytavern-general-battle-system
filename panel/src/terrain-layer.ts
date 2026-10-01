/** 战术地图静态底图。地形、结构或覆盖层变化时才重建一次 SVG；选中、射程、迷雾等交互状态留在格子层。
 * 纯显示：只画存档里真实存在的地形与结构，不暗示任何额外规则。画法见 terrain-painted.ts，颜色全部走 CSS 类。 */
import type { BattlefieldSpec, Terrain } from '../../engine/src/small/spatial.js';
import { S } from './terrain-geometry.js';
import { analyzeTerrain } from './terrain-scene.js';
import { buildPainted } from './terrain-painted.js';

const TILE_CODE: Record<Terrain, string> = { open: 'o', cover: 'c', wall: 'w', rough: 'r', forest: 'f', hill: 'h', street: 's', shallow_water: 'a', deep_water: 'd', swamp: 'm', cliff: 'k' };
export function signature(text: string): string { return hash(text) + text.length.toString(36); }
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** 缓存键只取决定画面的数据；结构被摧毁、门开关、地标变化才会换底图。 */
export function terrainKey(field: BattlefieldSpec): string {
  let key = `${field.width}x${field.height}:${field.generation?.scene ?? ''}:${field.generation?.family ?? ''}:${(field.environment ?? []).join(',')}|`;
  for (const t of field.tiles) key += TILE_CODE[t] ?? '?';
  key += '|';
  field.structures?.forEach((s, p) => { if (s) key += p + s.kind.slice(0, 2) + (s.hp > 0 ? '' : 'x') + (s.gateState?.[0] ?? '') + ','; });
  key += '|';
  for (const [p, list] of Object.entries(field.overlays ?? {})) if (list?.length) key += p + list.map(o => o[1]).join('') + ',';
  const legacy = field.generation?.landmark;
  key += '|' + JSON.stringify(field.landmarks?.map(m => [m.label, m.cells]) ?? (legacy ? [legacy.label, legacy.cells] : ''));
  if (field.objective.kind === 'control') key += '|z' + (field.objective.cells ?? [field.objective.cell]).join('.');
  key+='|h'+JSON.stringify([field.groundHeight,field.heightTransitions,field.retreatEdges,field.structures?.map(s=>s?[s.platformHeight,s.obstructionHeight,s.deckHeight]:null)]);
  return key;
}

const cache = new Map<string, { id: string; svg: string }>();
/** 返回底图占位；SVG 内容按 id 缓存，由 hydrateTerrain 在格子层打补丁后按需填入，平时的点击不重复解析。 */
export function terrainLayer(field: BattlefieldSpec): string {
  const key = terrainKey(field);
  let entry = cache.get(key);
  if (!entry) {
    const id = 'tb' + hash(key) + key.length.toString(36);
    entry = { id, svg: buildPainted(analyzeTerrain(field, id)) };
    cache.set(key, entry);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
  }
  return `<svg class="terrain-layer" data-static="${entry.id}" viewBox="0 0 ${field.width * S} ${field.height * S}" preserveAspectRatio="none" aria-hidden="true" focusable="false"></svg>`;
}
export function terrainMarkup(id: string): string | undefined {
  for (const entry of cache.values()) if (entry.id === id) return entry.svg;
  return undefined;
}
/** 只有 id 变化（新战斗或地形被改变）时才写入 SVG 内容。 */
export function hydrateTerrain(root: ParentNode): void {
  for (const layer of root.querySelectorAll<SVGSVGElement>('svg.terrain-layer[data-static]')) {
    const id = layer.getAttribute('data-static')!;
    if (layer.getAttribute('data-drawn') === id) continue;
    const svg = terrainMarkup(id);
    if (svg === undefined) continue;
    layer.innerHTML = svg; layer.setAttribute('data-drawn', id);
  }
}
