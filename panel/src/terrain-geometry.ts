/** 战术底图几何：格网坐标上的形状拼合、外轮廓追踪、偏移与平滑。纯函数，与主题和配色无关。1格 = S 个 SVG 单位。 */
export const S = 100;
export interface Grid { w: number; h: number; n: number }
export const r1 = (v: number) => Math.round(v * 10) / 10;
/** 与格号绑定的确定性抖动：同一张图每次画出来完全一样。 */
export function noise(cell: number, salt: number): number {
  let h = Math.imul(cell + 0x3c6ef372, 0x9e3779b1) ^ Math.imul(salt + 0x1b873593, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** 按绝对坐标取值：相邻两块地形共用的边得到同一组抖动，拼接处不留缝。 */
export const noiseAt = (x: number, y: number, salt = 0) => noise(Math.round(x) * 7919 + Math.round(y) * 104729, salt);
export const rect = (x: number, y: number, w: number, h: number) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
export const circle = (cx: number, cy: number, r: number) => `M${r1(cx - r)} ${r1(cy)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0`;
export const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${r1(cx - rx)} ${r1(cy)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0`;
export function roundedRect(x0: number, y0: number, x1: number, y1: number, nw: number, ne: number, se: number, sw: number): string {
  return `M${r1(x0 + nw)} ${r1(y0)}H${r1(x1 - ne)}${ne ? `a${ne} ${ne} 0 0 1 ${ne} ${ne}` : ''}V${r1(y1 - se)}${se ? `a${se} ${se} 0 0 1 ${-se} ${se}` : ''}`
    + `H${r1(x0 + sw)}${sw ? `a${sw} ${sw} 0 0 1 ${-sw} ${-sw}` : ''}V${r1(y0 + nw)}${nw ? `a${nw} ${nw} 0 0 1 ${nw} ${-nw}` : ''}Z`;
}

/** 线状结构（道路、城墙、堑壕）：格心方块 + 通向可连接邻格的连杆，天然连成网。 */
export function skeleton(g: Grid, cells: readonly number[], join: (p: number) => boolean, width: number, core = width): string {
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
export interface Segment { x0: number; y0: number; x1: number; y1: number }
/** 线状结构的中心线段（格心到可连接邻格格心）；孤立格返回一段短横线。 */
export function segments(g: Grid, cells: readonly number[], join: (p: number) => boolean): Segment[] {
  const members = new Set(cells), out: Segment[] = [];
  for (const p of cells) {
    const x = p % g.w, y = (p - x) / g.w, cx = x * S + S / 2, cy = y * S + S / 2;
    let linked = false;
    if (x < g.w - 1 && join(p + 1)) { out.push({ x0: cx, y0: cy, x1: cx + S, y1: cy }); linked = true; }
    if (y < g.h - 1 && join(p + g.w)) { out.push({ x0: cx, y0: cy, x1: cx, y1: cy + S }); linked = true; }
    if (x > 0 && join(p - 1)) { linked = true; if (!members.has(p - 1)) out.push({ x0: cx - S, y0: cy, x1: cx, y1: cy }); }
    if (y > 0 && join(p - g.w)) { linked = true; if (!members.has(p - g.w)) out.push({ x0: cx, y0: cy - S, x1: cx, y1: cy }); }
    if (!linked) out.push({ x0: cx - 22, y0: cy, x1: cx + 22, y1: cy });
  }
  return out;
}
/** 区域外轮廓（虚线圈出占领区、地标范围）。 */
export function outline(g: Grid, cells: readonly number[], inset = 0): string {
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
export function components(g: Grid, cells: readonly number[]): number[][] {
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

/** 顺时针闭合轮廓（屏幕坐标，内部在行进方向右侧）。顶点为格角坐标（格单位），convex 为外凸角。 */
export interface Loop { pts: [number, number][]; convex: boolean[] }
/** 追踪格集合的外轮廓与内洞。extend 时地图外一圈视为最近格的延续，贴边的地形会自然延伸出画面而不在边上描线。 */
export function traceLoops(g: Grid, inside: (p: number) => boolean, extend = true): Loop[] {
  const m = extend ? 1 : 0;
  const cellIn = (x: number, y: number) => {
    if (x < -m || y < -m || x >= g.w + m || y >= g.h + m) return false;
    return inside(Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x)));
  };
  const vk = (x: number, y: number) => (x + 4) * 4099 + (y + 4);
  const out = new Map<number, number[][]>();
  const add = (sx: number, sy: number, ex: number, ey: number) => { const k = vk(sx, sy), list = out.get(k); const e = [sx, sy, ex, ey]; if (list) list.push(e); else out.set(k, [e]); };
  for (let y = -m; y < g.h + m; y++) for (let x = -m; x < g.w + m; x++) {
    if (!cellIn(x, y)) continue;
    if (!cellIn(x, y - 1)) add(x, y, x + 1, y);
    if (!cellIn(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!cellIn(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!cellIn(x - 1, y)) add(x, y + 1, x, y);
  }
  const used = new Set<number[]>(), loops: Loop[] = [];
  for (const list of out.values()) for (const first of list) {
    if (used.has(first)) continue;
    const chain: number[][] = [];
    let edge: number[] | undefined = first;
    while (edge && !used.has(edge)) {
      used.add(edge); chain.push(edge);
      const dx: number = edge[2]! - edge[0]!, dy: number = edge[3]! - edge[1]!;
      const next: number[][] = (out.get(vk(edge[2]!, edge[3]!)) ?? []).filter(e => !used.has(e) || e === first);
      // 对角相接的两格在此分开：优先右转（沿内部走），再直行，最后左转。
      const turn = (e: number[]) => { const ex = e[2]! - e[0]!, ey = e[3]! - e[1]!, c = dx * ey - dy * ex; return c > 0 ? 0 : c === 0 ? 1 : 2; };
      edge = next.sort((a, b) => turn(a) - turn(b))[0];
      if (edge === first) break;
    }
    // 合并共线边，只保留转角。
    const pts: [number, number][] = [], convex: boolean[] = [];
    for (let i = 0; i < chain.length; i++) {
      const a = chain[(i - 1 + chain.length) % chain.length]!, b = chain[i]!;
      const ax = a[2]! - a[0]!, ay = a[3]! - a[1]!, bx = b[2]! - b[0]!, by = b[3]! - b[1]!, c = ax * by - ay * bx;
      if (c !== 0) { pts.push([b[0]!, b[1]!]); convex.push(c > 0); }
    }
    if (pts.length >= 4) loops.push({ pts, convex });
  }
  return loops;
}
export interface LoopStyle {
  /** 外凸角半径 / 内凹角半径（SVG 单位）。 */
  r?: number; rc?: number;
  /** 正数外扩、负数内缩。 */
  off?: number;
  /** 自然边缘：沿边法向的抖动幅度与取样步长。 */
  jitter?: number; step?: number; salt?: number;
}
/** 轮廓转为路径。直边模式用二次曲线倒角；自然模式先加密取样、按绝对坐标抖动，再以闭合 Catmull-Rom 平滑。 */
export function loopPath(loops: readonly Loop[], style: LoopStyle = {}): string {
  const { r = 0, rc = 0, off = 0, jitter = 0, step = 34, salt = 0 } = style;
  let d = '';
  for (const loop of loops) {
    const n = loop.pts.length;
    const v = loop.pts.map(([x, y], i) => {
      const [px, py] = loop.pts[(i - 1 + n) % n]!, [nx, ny] = loop.pts[(i + 1) % n]!;
      const ix = Math.sign(x - px), iy = Math.sign(y - py), ox = Math.sign(nx - x), oy = Math.sign(ny - y);
      // 外法向 = 行进方向左侧；正交多边形的偏移顶点 = 原点 + off·(入边法向 + 出边法向)。
      return [x * S + off * (iy + oy), y * S + off * (-ix - ox)] as const;
    });
    const corner = (i: number) => {
      const [x, y] = v[i]!, [px, py] = v[(i - 1 + n) % n]!, [nx, ny] = v[(i + 1) % n]!;
      const lin = Math.hypot(x - px, y - py), lout = Math.hypot(nx - x, ny - y);
      const rad = Math.max(0, Math.min(loop.convex[i] ? r : rc, lin / 2, lout / 2));
      return { x, y, ax: x + (px - x) / (lin || 1) * rad, ay: y + (py - y) / (lin || 1) * rad, bx: x + (nx - x) / (lout || 1) * rad, by: y + (ny - y) / (lout || 1) * rad };
    };
    const cs = v.map((_, i) => corner(i));
    if (!jitter) {
      const c0 = cs[0]!;
      d += `M${r1(c0.bx)} ${r1(c0.by)}`;
      for (let i = 1; i <= n; i++) { const c = cs[i % n]!; d += `L${r1(c.ax)} ${r1(c.ay)}` + (c.ax !== c.bx || c.ay !== c.by ? `Q${r1(c.x)} ${r1(c.y)} ${r1(c.bx)} ${r1(c.by)}` : ''); }
      d += 'Z';
      continue;
    }
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const c = cs[i]!, e = cs[(i + 1) % n]!;
      pts.push([c.ax, c.ay]);
      if (c.ax !== c.bx || c.ay !== c.by) pts.push([c.bx, c.by]);
      const len = Math.hypot(e.ax - c.bx, e.ay - c.by), k = Math.max(1, Math.round(len / step));
      const horizontal = Math.abs(e.ax - c.bx) > Math.abs(e.ay - c.by);
      for (let j = 1; j < k; j++) {
        const x = c.bx + (e.ax - c.bx) * j / k, y = c.by + (e.ay - c.by) * j / k, amount = (noiseAt(x, y, salt) * 2 - 1) * jitter;
        pts.push(horizontal ? [x, y + amount] : [x + amount, y]);
      }
    }
    d += smoothClosed(pts);
  }
  return d;
}
/** 闭合 Catmull-Rom → 三次贝塞尔。 */
export function smoothClosed(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M${r1(pts[0]![0])} ${r1(pts[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + 'Z';
}
/** 收集 SVG 片段；空路径不输出。 */
export function painter() {
  const out: string[] = [];
  return {
    out,
    path(cls: string, d: string, attrs = '') { if (d) out.push(`<path class="${cls}"${attrs} d="${d}"/>`); },
    add(markup: string) { if (markup) out.push(markup); },
    group(attrs: string, body: () => void) { const start = out.length; body(); if (out.length > start) { out.splice(start, 0, `<g ${attrs}>`); out.push('</g>'); } },
  };
}
