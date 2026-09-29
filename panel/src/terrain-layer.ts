/** 战术地图静态底图。地形、结构或覆盖层变化时才重建一次 SVG；选中、射程、迷雾等交互状态留在格子层。
 * 纯显示：只画存档里真实存在的地形与结构，不暗示任何额外规则。颜色全部走 CSS 类，深浅主题共用一份几何。 */
import type { FieldStructure } from '../../engine/src/small/layers.js';
import { mapFamily, safeLandmarkLabel } from '../../engine/src/small/map-design.js';
import type { BattlefieldSpec, Terrain } from '../../engine/src/small/spatial.js';

const S = 100;
type Style = 'field' | 'city' | 'compound' | 'interior' | 'trenches';
const TILE_CODE: Record<Terrain, string> = { open: 'o', cover: 'c', wall: 'w', rough: 'r', forest: 'f', hill: 'h', street: 's', shallow_water: 'a', deep_water: 'd', swamp: 'm', cliff: 'k' };
const escText = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const r1 = (v: number) => Math.round(v * 10) / 10;
/** 与格号绑定的确定性抖动：同一张图每次画出来完全一样。 */
function noise(cell: number, salt: number): number {
  let h = Math.imul(cell + 0x3c6ef372, 0x9e3779b1) ^ Math.imul(salt + 0x1b873593, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
export function signature(text: string): string { return hash(text) + text.length.toString(36); }
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
const rect = (x: number, y: number, w: number, h: number) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
const circle = (cx: number, cy: number, r: number) => `M${r1(cx - r)} ${r1(cy)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${r1(cx - rx)} ${r1(cy)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0`;
function roundedRect(x0: number, y0: number, x1: number, y1: number, nw: number, ne: number, se: number, sw: number): string {
  return `M${r1(x0 + nw)} ${r1(y0)}H${r1(x1 - ne)}${ne ? `a${ne} ${ne} 0 0 1 ${ne} ${ne}` : ''}V${r1(y1 - se)}${se ? `a${se} ${se} 0 0 1 ${-se} ${se}` : ''}`
    + `H${r1(x0 + sw)}${sw ? `a${sw} ${sw} 0 0 1 ${-sw} ${-sw}` : ''}V${r1(y0 + nw)}${nw ? `a${nw} ${nw} 0 0 1 ${nw} ${-nw}` : ''}Z`;
}

interface Grid { w: number; h: number; n: number }
/** 同类格合成一块：外凸角倒圆，外露边可外扩（水岸）或内缩（任务区）。地图边外默认视为延续。 */
function blob(g: Grid, cells: readonly number[], inside: (p: number) => boolean, radius: number, grow = 0, edgeInside = true): string {
  const has = (x: number, y: number) => x < 0 || y < 0 || x >= g.w || y >= g.h ? edgeInside : inside(y * g.w + x);
  let d = '';
  for (const p of cells) {
    const x = p % g.w, y = (p - x) / g.w;
    const n = has(x, y - 1), e = has(x + 1, y), s = has(x, y + 1), w = has(x - 1, y);
    d += roundedRect(x * S - (w ? 0 : grow), y * S - (n ? 0 : grow), (x + 1) * S + (e ? 0 : grow), (y + 1) * S + (s ? 0 : grow),
      !n && !w ? radius : 0, !n && !e ? radius : 0, !s && !e ? radius : 0, !s && !w ? radius : 0);
  }
  return d;
}
/** 线状结构（道路、城墙、堑壕）：格心方块 + 通向可连接邻格的连杆，天然连成网。 */
function skeleton(g: Grid, cells: readonly number[], join: (p: number) => boolean, width: number, core = width): string {
  const half = width / 2, members = new Set(cells); let d = '';
  for (const p of cells) {
    const x = p % g.w, y = (p - x) / g.w, cx = x * S + S / 2, cy = y * S + S / 2;
    d += rect(cx - core / 2, cy - core / 2, core, core);
    if (x < g.w - 1 && join(p + 1)) d += rect(cx, cy - half, S, width);
    if (y < g.h - 1 && join(p + g.w)) d += rect(cx - half, cy, width, S);
    if (x > 0 && join(p - 1) && !members.has(p - 1)) d += rect(cx - S, cy - half, S, width);
    if (y > 0 && join(p - g.w) && !members.has(p - g.w)) d += rect(cx - half, cy - S, width, S);
  }
  return d;
}
function centerlines(g: Grid, cells: readonly number[], join: (p: number) => boolean): string {
  const members = new Set(cells); let d = '';
  for (const p of cells) {
    const x = p % g.w, y = (p - x) / g.w, cx = x * S + S / 2, cy = y * S + S / 2;
    let linked = false;
    if (x < g.w - 1 && join(p + 1)) { d += `M${cx} ${cy}h${S}`; linked = true; }
    if (y < g.h - 1 && join(p + g.w)) { d += `M${cx} ${cy}v${S}`; linked = true; }
    if (x > 0 && join(p - 1)) { linked = true; if (!members.has(p - 1)) d += `M${cx} ${cy}h${-S}`; }
    if (y > 0 && join(p - g.w)) { linked = true; if (!members.has(p - g.w)) d += `M${cx} ${cy}v${-S}`; }
    if (!linked) d += `M${cx - 22} ${cy}h44`;
  }
  return d;
}
/** 区域外轮廓（虚线圈出占领区、地标范围）。 */
function outline(g: Grid, cells: readonly number[], inset = 0): string {
  const set = new Set(cells); let d = '';
  for (const p of cells) {
    const x = p % g.w, y = (p - x) / g.w, x0 = x * S, y0 = y * S;
    if (y === 0 || !set.has(p - g.w)) d += `M${x0} ${y0 + inset}h${S}`;
    if (y === g.h - 1 || !set.has(p + g.w)) d += `M${x0} ${y0 + S - inset}h${S}`;
    if (x === 0 || !set.has(p - 1)) d += `M${x0 + inset} ${y0}v${S}`;
    if (x === g.w - 1 || !set.has(p + 1)) d += `M${x0 + S - inset} ${y0}v${S}`;
  }
  return d;
}
function components(g: Grid, cells: readonly number[]): number[][] {
  const set = new Set(cells), seen = new Set<number>(), out: number[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const group: number[] = [], queue = [start]; seen.add(start);
    while (queue.length) {
      const p = queue.pop()!, x = p % g.w; group.push(p);
      for (const q of [x > 0 ? p - 1 : -1, x < g.w - 1 ? p + 1 : -1, p - g.w, p + g.w]) if (q >= 0 && q < g.n && set.has(q) && !seen.has(q)) { seen.add(q); queue.push(q); }
    }
    out.push(group);
  }
  return out;
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
  return key;
}

const cache = new Map<string, { id: string; svg: string }>();
/** 返回底图占位；SVG 内容按 id 缓存，由 hydrateTerrain 在格子层打补丁后按需填入，平时的点击不重复解析。 */
export function terrainLayer(field: BattlefieldSpec): string {
  const key = terrainKey(field);
  let entry = cache.get(key);
  if (!entry) {
    const id = 'tb' + hash(key) + key.length.toString(36);
    entry = { id, svg: buildTerrain(field, id) };
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

function styleOf(field: BattlefieldSpec): Style {
  const scene = field.generation?.scene, family = field.generation?.family ?? mapFamily(field.environment ?? [], field.width);
  if (scene === 'interior' || !scene && family === 'indoor') return 'interior';
  if (scene === 'building_siege') return 'compound';
  if (scene === 'trenches') return 'trenches';
  if (scene === 'city_siege' || scene === 'city_streets' || !scene && (family === 'urban' || family === 'siege')) return 'city';
  return 'field';
}

function buildTerrain(field: BattlefieldSpec, id: string): string {
  const g: Grid = { w: field.width, h: field.height, n: field.tiles.length }, W = g.w * S, H = g.h * S;
  const style = styleOf(field), family = field.generation?.family ?? mapFamily(field.environment ?? [], g.w), tiles = field.tiles;
  const inB = (p: number) => p >= 0 && p < g.n;
  const struct = (p: number): FieldStructure | undefined => inB(p) ? field.structures?.[p] ?? undefined : undefined;
  const intact = (p: number) => { const s = struct(p); return s && s.hp > 0 ? s : undefined; };
  const kindAt = (p: number, ...kinds: FieldStructure['kind'][]) => { const s = intact(p); return !!s && kinds.includes(s.kind); };
  const overlay = (p: number, o: 'road' | 'rubble') => !!field.overlays?.[p]?.includes(o);
  const all = (pred: (p: number) => boolean) => { const out: number[] = []; for (let p = 0; p < g.n; p++) if (pred(p)) out.push(p); return out; };
  const at = (p: number) => [(p % g.w) * S, Math.floor(p / g.w) * S] as const;
  const out: string[] = [];
  const path = (cls: string, d: string, attrs = '') => { if (d) out.push(`<path class="${cls}"${attrs} d="${d}"/>`); };
  // 旧版无分层地图里 wall 地块按环境家族解释：城区为建筑，森林为密林，其他为岩石。
  const legacyWall = (p: number) => tiles[p] === 'wall' && !struct(p);
  const legacyBuilding = (p: number) => legacyWall(p) && (style === 'city' || family === 'urban' || family === 'siege');
  const legacyThicket = (p: number) => legacyWall(p) && style === 'field' && family === 'forest';
  const legacyRock = (p: number) => legacyWall(p) && style === 'field' && family !== 'forest';

  // 地面与铺装。
  const ground = style === 'interior' ? 'floor' : style === 'trenches' ? 'mud' : family === 'mountain' ? 'dry' : family === 'forest' ? 'lush' : family === 'siege' ? 'trampled' : 'grass';
  out.push(`<rect class="t-ground t-ground-${ground}" width="${W}" height="${H}"/>`);
  const paved = all(p => tiles[p] === 'street');
  if (paved.length) {
    const floor = style === 'interior' || style === 'compound', area = blob(g, paved, p => tiles[p] === 'street', 0);
    path(floor ? 't-floor' : 't-paving', area);
    path('t-grain-fill', area, ` fill="url(#${id}-${floor ? 'planks' : 'cobble'})"`);
  }
  let tufts = '', patches = '';
  for (let p = 0; p < g.n; p++) {
    if (tiles[p] !== 'open' || struct(p) || field.overlays?.[p]?.length) continue;
    const [x, y] = at(p);
    if (noise(p, 1) < .55) { const tx = x + 18 + noise(p, 2) * 64, ty = y + 26 + noise(p, 3) * 60; tufts += `M${r1(tx)} ${r1(ty)}l-5 -10M${r1(tx)} ${r1(ty)}l1 -12M${r1(tx)} ${r1(ty)}l6 -9`; }
    if (noise(p, 4) < .35) { const tx = x + 20 + noise(p, 5) * 60, ty = y + 20 + noise(p, 6) * 60; tufts += `M${r1(tx)} ${r1(ty)}l-4 -8M${r1(tx)} ${r1(ty)}l4 -8`; }
    if (noise(p, 7) < .3) patches += ellipse(x + 30 + noise(p, 8) * 40, y + 30 + noise(p, 9) * 40, 18 + noise(p, 10) * 14, 10 + noise(p, 11) * 8);
  }
  path('t-patch', patches); path('t-tuft', tufts);

  // 水体：先画岸，再画浅水，深水压在上面。
  const isWater = (p: number) => tiles[p] === 'shallow_water' || tiles[p] === 'deep_water';
  const water = all(isWater), deep = all(p => tiles[p] === 'deep_water');
  if (water.length) {
    path('t-bank', blob(g, water, isWater, 30, 8));
    path('t-shallow', blob(g, water, isWater, 24));
    path('t-deep', blob(g, deep, p => tiles[p] === 'deep_water', 18));
    let waves = '';
    for (const p of water) {
      const [x, y] = at(p);
      for (let k = 0; k < 2; k++) { const wx = x + 14 + noise(p, 20 + k) * 50, wy = y + 24 + k * 38 + noise(p, 22 + k) * 14; waves += `M${r1(wx)} ${r1(wy)}q6 -6 12 0t12 0`; }
    }
    path('t-wave', waves);
  }
  const swamp = all(p => tiles[p] === 'swamp');
  if (swamp.length) {
    path('t-swamp', blob(g, swamp, p => tiles[p] === 'swamp', 28, 2));
    let puddles = '', reeds = '';
    for (const p of swamp) {
      const [x, y] = at(p);
      puddles += ellipse(x + 30 + noise(p, 30) * 20, y + 34 + noise(p, 31) * 10, 16, 7) + ellipse(x + 60 + noise(p, 32) * 16, y + 70, 13, 6);
      for (let k = 0; k < 3; k++) { const rx = x + 18 + k * 26 + noise(p, 33 + k) * 10, ry = y + 58 + noise(p, 36 + k) * 26; reeds += `M${r1(rx)} ${r1(ry)}v-16M${r1(rx + 5)} ${r1(ry)}l3 -12`; }
    }
    path('t-puddle', puddles); path('t-reed', reeds);
  }
  const rough = all(p => tiles[p] === 'rough');
  if (rough.length) {
    path('t-rough', blob(g, rough, p => tiles[p] === 'rough', 30, 0, false));
    let pebbles = '';
    for (const p of rough) {
      const [x, y] = at(p);
      for (let k = 0; k < 5; k++) pebbles += ellipse(x + 14 + noise(p, 40 + k) * 72, y + 14 + noise(p, 50 + k) * 72, 4 + noise(p, 60 + k) * 5, 3 + noise(p, 70 + k) * 3);
    }
    path('t-pebble', pebbles);
  }
  const hills = all(p => tiles[p] === 'hill');
  if (hills.length) {
    path('t-hill', blob(g, hills, p => tiles[p] === 'hill', 36, 0, false));
    let contour = '', light = '';
    for (const p of hills) {
      const [x0, y0] = at(p), x = x0 + (noise(p, 80) - .5) * 10, y = y0 + (noise(p, 81) - .5) * 8;
      contour += `M${r1(x + 10)} ${r1(y + 80)}q40 -56 80 0M${r1(x + 26)} ${r1(y + 76)}q24 -32 48 0`;
      light += `M${r1(x + 18)} ${r1(y + 68)}q12 -18 28 -26`;
    }
    path('t-contour', contour); path('t-hill-light', light);
  }
  const rockCells = all(p => tiles[p] === 'cliff' || legacyRock(p));
  if (rockCells.length) {
    const isRock = (p: number) => tiles[p] === 'cliff' || legacyRock(p);
    const shape = blob(g, rockCells, isRock, 14);
    path('t-rock-shadow', shape, ' transform="translate(5 7)"'); path('t-rock', shape);
    let cracks = '', edge = '';
    for (const p of rockCells) {
      const [x, y] = at(p), j = noise(p, 90) * 30;
      cracks += `M${r1(x + 16 + j)} ${y + 14}l12 22l-9 18l14 22M${r1(x + 64 - j / 2)} ${y + 30}l-8 18l10 14`;
      if (p < g.w || !isRock(p - g.w)) edge += `M${x + 8} ${y + 6}h84`;
    }
    path('t-crack', cracks); path('t-rock-edge', edge);
  }
  // 森林（以及旧版森林家族的“密林障碍”）：林下底色 + 树冠。
  const woods = all(p => tiles[p] === 'forest' || legacyThicket(p));
  if (woods.length) {
    path('t-forest-floor', blob(g, woods, p => tiles[p] === 'forest' || legacyThicket(p), 30, 0, false));
    let shadow = '', canopy = '', dense = '', light = '';
    for (const p of woods) {
      const [x, y] = at(p), thick = legacyThicket(p);
      const spots = thick ? [[26, 26], [72, 26], [48, 52], [26, 76], [74, 76]] : [[28, 30], [72, 34], [44, 72], [80, 76]];
      spots.forEach(([sx, sy], k) => {
        const cx = x + sx! + (noise(p, 100 + k) - .5) * 12, cy = y + sy! + (noise(p, 110 + k) - .5) * 12, r = (thick ? 20 : 17) + noise(p, 120 + k) * 6;
        shadow += circle(cx + 5, cy + 6, r);
        if (thick) dense += circle(cx, cy, r); else canopy += circle(cx, cy, r);
        if (k % 2 === 0) light += circle(cx - r * .3, cy - r * .32, r * .45);
      });
    }
    path('t-canopy-shadow', shadow); path('t-canopy', canopy); path('t-canopy t-canopy-dense', dense); path('t-canopy-light', light);
  }

  // 道路与瓦砾（真实覆盖层）。道路延伸进相邻的门与桥，视觉上连通。
  const roads = all(p => overlay(p, 'road') && struct(p)?.kind !== 'bridge' && struct(p)?.kind !== 'gate');
  if (roads.length) {
    const joinRoad = (p: number) => inB(p) && (overlay(p, 'road') || struct(p)?.kind === 'gate' || struct(p)?.kind === 'bridge');
    if (style === 'interior') { path('t-carpet-edge', skeleton(g, roads, joinRoad, 52)); path('t-carpet', skeleton(g, roads, joinRoad, 40)); }
    else { path('t-road-edge', skeleton(g, roads, joinRoad, 64)); path(style === 'city' ? 't-road' : 't-road t-road-dirt', skeleton(g, roads, joinRoad, 54)); }
  }
  const rubble = all(p => overlay(p, 'rubble'));
  if (rubble.length) {
    let dust = '', stones = '';
    for (const p of rubble) {
      const [x, y] = at(p);
      dust += ellipse(x + 50, y + 54, 38, 30);
      for (let k = 0; k < 8; k++) {
        const sx = x + 14 + noise(p, 130 + k) * 70, sy = y + 16 + noise(p, 140 + k) * 68, a = 5 + noise(p, 150 + k) * 8;
        stones += `M${r1(sx)} ${r1(sy)}l${r1(a)} ${r1(-a * .4)}l${r1(a * .3)} ${r1(a * .8)}l${r1(-a)} ${r1(a * .3)}Z`;
      }
    }
    path('t-dust', dust); path('t-rubble', stones);
  }

  // 建筑：城区为带阴影的屋顶街区；室内与建筑围攻为墙线。
  if (style === 'interior' || style === 'compound') {
    const joinWall = (p: number) => inB(p) && (kindAt(p, 'building', 'wall', 'gate', 'tower') || legacyWall(p));
    const partition = all(p => kindAt(p, 'building', 'wall') || legacyWall(p));
    // 墙格本身不可通行：格心画成实墙块，连杆表示墙线走向。
    const thick = style === 'compound' ? 44 : 28, core = style === 'compound' ? 60 : 58, body = skeleton(g, partition, joinWall, thick, core);
    path('t-wall-shadow', skeleton(g, partition, joinWall, thick + 6, core + 6), ' transform="translate(4 6)"');
    path(style === 'compound' ? 't-cwall' : 't-iwall', body);
    if (style === 'compound') path('t-joint', centerlines(g, partition, joinWall));
  } else {
    const isBuilding = (p: number) => inB(p) && (kindAt(p, 'building') || legacyBuilding(p));
    const buildings = all(isBuilding);
    if (buildings.length) {
      const margin = 7; let shadow = '', shade = '', ridge = '', eaves = '';
      const roofs = ['', '', ''];
      for (const group of components(g, buildings)) {
        const xs = group.map(p => p % g.w), ys = group.map(p => Math.floor(p / g.w));
        const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
        const tone = Math.floor(noise(Math.min(...group), 160) * 3);
        for (const p of group) {
          const x = p % g.w, y = (p - x) / g.w;
          const n = y > 0 && isBuilding(p - g.w), s = y < g.h - 1 && isBuilding(p + g.w), w = x > 0 && isBuilding(p - 1), e = x < g.w - 1 && isBuilding(p + 1);
          const x0 = x * S + (w ? 0 : margin), x1 = (x + 1) * S - (e ? 0 : margin), y0 = y * S + (n ? 0 : margin), y1 = (y + 1) * S - (s ? 0 : margin);
          shadow += rect(x0, y0, x1 - x0, y1 - y0);
          roofs[tone] += rect(x0, y0, x1 - x0, y1 - y0);
          if (!n) eaves += `M${x0} ${y0 + 1.5}H${x1}`;
          if (!w) eaves += `M${x0 + 1.5} ${y0}V${y1}`;
          if (horizontal) { shade += rect(x0, y * S + 50, x1 - x0, y1 - y * S - 50); ridge += `M${x0} ${y * S + 50}H${x1}`; }
          else { shade += rect(x * S + 50, y0, x1 - x * S - 50, y1 - y0); ridge += `M${x * S + 50} ${y0}V${y1}`; }
        }
      }
      path('t-bshadow', shadow, ' transform="translate(6 8)"');
      roofs.forEach((d, k) => path('t-roof t-roof-' + k, d));
      path('t-roof-shade', shade); path('t-ridge', ridge); path('t-eaves', eaves);
    }
    // 城墙：连续墙体 + 城垛接缝；塔楼与城门压在墙线上。
    const joinWall = (p: number) => kindAt(p, 'wall', 'gate', 'tower');
    const line = all(p => kindAt(p, 'wall', 'gate'));
    if (line.length) {
      path('t-wall-shadow', skeleton(g, line, joinWall, 62), ' transform="translate(6 9)"');
      path('t-wall', skeleton(g, line, joinWall, 60));
      path('t-walk', skeleton(g, line, joinWall, 24));
      path('t-joint', centerlines(g, line, joinWall));
    }
  }
  const towers = all(p => kindAt(p, 'tower'));
  if (towers.length) {
    let body = '', top = '';
    for (const p of towers) { const [x, y] = at(p); body += circle(x + 50, y + 50, 42); top += circle(x + 50, y + 50, 22); }
    path('t-wall-shadow', body, ' transform="translate(6 8)"'); path('t-tower', body); path('t-tower-rim', body); path('t-tower-top', top);
  }
  // 门：朝向取决于墙线走向；开门留出通道，毁门交给瓦砾。
  const gates = all(p => kindAt(p, 'gate'));
  if (gates.length) {
    let door = '', planks = '', passage = '', swing = '';
    const interiorDoor = style === 'interior' || style === 'compound';
    for (const p of gates) {
      const s = intact(p)!, [x, y] = at(p), cx = x + 50, cy = y + 50;
      const blocking = (q: number) => kindAt(q, 'wall', 'gate', 'tower', 'building') || legacyWall(q);
      const horizontal = (p % g.w > 0 && blocking(p - 1)) || (p % g.w < g.w - 1 && blocking(p + 1));
      // 水平墙线上的门，通道南北向；在局部坐标里画完再映射。
      const map = (u: number, v: number) => horizontal ? [cx + u, cy + v] as const : [cx + v, cy + u] as const;
      const box = (u: number, v: number, du: number, dv: number) => { const [ax, ay] = map(u, v), [bx, by] = map(u + du, v + dv); return rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); };
      const open = s.gateState === 'open';
      if (interiorDoor) {
        passage += box(-24, -16, 48, 32);
        if (open) { const [hx, hy] = map(-24, 0), [ex, ey] = map(-24, -46), [ax, ay] = map(22, 0); swing += `M${hx} ${hy}L${ex} ${ey}A46 46 0 0 ${horizontal ? 1 : 0} ${ax} ${ay}`; }
        else door += box(-24, -5, 48, 10);
      } else {
        passage += box(-24, -50, 48, 100);
        if (open) door += box(-31, -44, 8, 36) + box(23, -44, 8, 36);
        else {
          door += box(-28, -20, 56, 40);
          for (let k = -16; k <= 16; k += 11) { const [ax, ay] = map(k, -20), [bx, by] = map(k, 20); planks += `M${ax} ${ay}L${bx} ${by}`; }
          for (const v of [-9, 9]) { const [ax, ay] = map(-28, v), [bx, by] = map(28, v); planks += `M${ax} ${ay}L${bx} ${by}`; }
        }
      }
    }
    path(interiorDoor ? 't-doorway' : 't-passage', passage); path('t-gate', door); path('t-gate-line', planks); path('t-door-swing', swing);
  }
  // 工事：连成堑壕（沙袋边 + 暗色壕底 + 踏板）；孤立工事呈射击坑。
  const works = all(p => kindAt(p, 'fortification'));
  if (works.length) {
    const joinWork = (p: number) => kindAt(p, 'fortification'), spine = centerlines(g, works, joinWork);
    path('t-sandbag', skeleton(g, works, joinWork, 76)); path('t-sandbag-seam', spine);
    path('t-trench', skeleton(g, works, joinWork, 38)); path('t-duckboard', spine);
  }
  // 掩体：野外为沙袋矮墙，城内为货箱，室内为家具。旧存档的 cover 地块同样处理。
  const covers = all(p => kindAt(p, 'cover') || tiles[p] === 'cover' && !struct(p));
  if (covers.length) {
    let body = '', line = '';
    for (const p of covers) {
      const [x, y] = at(p), j = (noise(p, 170) - .5) * 14;
      if (style === 'city' || style === 'compound') {
        body += rect(x + 22 + j, y + 44, 26, 26) + rect(x + 52 + j, y + 50, 22, 22) + circle(x + 36 + j, y + 30, 10);
        line += `M${r1(x + 22 + j)} ${y + 44}l26 26m0 -26l-26 26M${r1(x + 52 + j)} ${y + 50}l22 22`;
      } else if (style === 'interior') {
        body += rect(x + 24, y + 36 + j, 52, 28) + rect(x + 12, y + 42 + j, 9, 16) + rect(x + 79, y + 42 + j, 9, 16);
        line += `M${x + 24} ${r1(y + 50 + j)}h52`;
      } else {
        const cy = y + 62 + j;
        body += roundedRect(x + 16, cy - 10, x + 84, cy + 10, 10, 10, 10, 10) + roundedRect(x + 30, cy - 27, x + 70, cy - 9, 9, 9, 9, 9);
        line += `M${x + 39} ${r1(cy - 10)}v20M${x + 61} ${r1(cy - 10)}v20M${x + 50} ${r1(cy - 27)}v18`;
      }
    }
    path('t-cover', body); path('t-cover-line', line);
  }
  // 桥：沿跨越方向铺板；被毁的桥只留两端残桩。
  const bridges = all(p => struct(p)?.kind === 'bridge');
  if (bridges.length) {
    let deck = '', plank = '', rail = '';
    for (const p of bridges) {
      const x = p % g.w, y = (p - x) / g.w, cx = x * S + 50, cy = y * S + 50;
      const vertical = (x > 0 && isWater(p - 1)) || (x < g.w - 1 && isWater(p + 1)) || !((y > 0 && isWater(p - g.w)) || (y < g.h - 1 && isWater(p + g.w)));
      for (const [start, len] of intact(p) ? [[-56, 112]] : [[-56, 32], [24, 32]]) {
        deck += vertical ? rect(cx - 28, cy + start!, 56, len!) : rect(cx + start!, cy - 28, len!, 56);
        for (let k = start! + 6; k < start! + len!; k += 11) plank += vertical ? `M${cx - 28} ${cy + k}h56` : `M${cx + k} ${cy - 28}v56`;
        rail += vertical ? `M${cx - 28} ${cy + start!}v${len}M${cx + 28} ${cy + start!}v${len}` : `M${cx + start!} ${cy - 28}h${len}M${cx + start!} ${cy + 28}h${len}`;
      }
    }
    path('t-bridge', deck); path('t-plank', plank); path('t-rail', rail);
  }

  // 任务区：占领区斜纹 + 虚线边。
  if (field.objective.kind === 'control') {
    const zone = (field.objective.cells ?? [field.objective.cell]).filter(inB), inZone = (p: number) => zone.includes(p);
    path('t-zone-fill', blob(g, zone, inZone, 10, -6, false), ` fill="url(#${id}-hatch)"`);
    path('t-zone-line', outline(g, zone, 6));
  }
  // 撤离方向：我方最下沿、敌方最上沿。
  let exits = '';
  for (let x = 0; x < g.w; x++) exits += `M${x * S + 38} ${H - 13}l12 8l12 -8M${x * S + 38} 13l12 -8l12 8`;
  path('t-exit', exits);
  let grid = '';
  for (let x = 1; x < g.w; x++) grid += `M${x * S} 0V${H}`;
  for (let y = 1; y < g.h; y++) grid += `M0 ${y * S}H${W}`;
  path('t-grid', grid, ' vector-effect="non-scaling-stroke"');
  // 地标：点线圈出范围，左上角标名。
  const legacy = field.generation?.landmark;
  const marks = field.landmarks?.length ? field.landmarks.map(m => ({ label: safeLandmarkLabel(m.label), cells: Array.isArray(m.cells) ? m.cells.filter(inB) : [] }))
    : legacy ? [{ label: safeLandmarkLabel(legacy.label), cells: Array.isArray(legacy.cells) ? legacy.cells.filter(p => Number.isInteger(p) && inB(p)) : [] }] : [];
  let markLines = '', labels = '';
  for (const m of marks) {
    if (!m.cells.length) continue;
    markLines += outline(g, m.cells, 4);
    if (!m.label) continue;
    const first = Math.min(...m.cells), x = first % g.w, y = Math.floor(first / g.w), end = x >= g.w - 2;
    labels += `<text class="t-label" x="${end ? (x + 1) * S - 7 : x * S + 7}" y="${y * S + 24}"${end ? ' text-anchor="end"' : ''}>${escText(m.label)}</text>`;
  }
  path('t-landmark-line', markLines);
  const defs = `<defs><pattern id="${id}-cobble" width="26" height="26" patternUnits="userSpaceOnUse"><path class="t-grain" d="M0 13H26M0 26H26M13 0V13M6 13V26M19 13V26"/></pattern>`
    + `<pattern id="${id}-planks" width="100" height="25" patternUnits="userSpaceOnUse"><path class="t-grain" d="M0 25H100M34 0V25M84 0V12"/></pattern>`
    + `<pattern id="${id}-hatch" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path class="t-hatch" d="M0 0V16"/></pattern></defs>`;
  return defs + out.join('') + labels;
}
