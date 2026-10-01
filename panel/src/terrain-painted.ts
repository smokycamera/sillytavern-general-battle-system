/** 底图风格「手绘战棋」：参考《战场兄弟》一类回合制战棋的画法——低饱和的手绘地表，
 * 树、岩石、房屋、城墙、掩体都是带顶面与正面的 3/4 俯视道具并投下影子，高地为台地、南侧露出崖面，四周压暗。
 * 只画存档里真实存在的地形与结构，不添加暗示规则的装饰。 */
import { S, r1, noise, rect, circle, ellipse, roundedRect, loopPath, traceLoops, skeleton, segments, components, outline, painter } from './terrain-geometry.js';
import { bridgeVertical, exitChevrons, gateHorizontal, gridLines, landmarkLabels, type TerrainScene } from './terrain-scene.js';

export function buildPainted(t: TerrainScene): string {
  const { g, W, H, id } = t, p = painter(), f = (name: string) => `url(#${id}-${name})`;
  const defs: string[] = [];
  let seq = 0;
  const organic = (inside: (q: number) => boolean, salt: number, off = 0, jitter = 7) => loopPath(traceLoops(g, inside), { r: 30, rc: 14, jitter, step: 26, salt, off });
  const crisp = (inside: (q: number) => boolean, off = 0, r = 0, extend = true) => loopPath(traceLoops(g, inside, extend), { r, rc: 0, off });
  /** 3/4 俯视体块：整块先涂正面色，再把上移 lift 的同形顶面裁回原轮廓，南缘自然露出一条正面。
   *  轮廓只写进 defs 一次，正面、顶面、裁切、投影与纹理都用 <use> 引用，避免同一段路径重复三四遍。 */
  const block = (d: string, lift: number, top: string, face: string, extra: (sid: string) => string = () => '', cast?: [number, number, number]) => {
    if (!d) return;
    const sid = `${id}-s${seq++}`;
    defs.push(`<path id="${sid}" d="${d}"/><clipPath id="${sid}c"><use href="#${sid}"/></clipPath>`);
    if (cast) p.add(`<use href="#${sid}" class="pt-shadow" transform="translate(${cast[0]} ${cast[1]})" filter="${f('soft' + cast[2])}"/>`);
    p.add(`<use href="#${sid}" class="${face}"/><g clip-path="url(#${sid}c)"><g transform="translate(0 ${-lift})"><use href="#${sid}" class="${top}"/>${extra(sid)}</g></g>`);
  };
  const shadow = (d: string, dx = 7, dy = 9, blur = 4) => p.path('pt-shadow', d, ` transform="translate(${dx} ${dy})" filter="${f('soft' + blur)}"`);
  const interior = t.style === 'interior' || t.style === 'compound';
  const ground = t.style === 'interior' ? 'pt-floor' : t.style === 'trenches' ? 'pt-mud' : t.family === 'mountain' ? 'pt-dry' : t.family === 'forest' ? 'pt-lush' : t.family === 'siege' || t.family === 'urban' ? 'pt-trampled' : 'pt-grass';

  // ── 地表：底色 + 大块深浅斑驳 + 笔触颗粒；草丛、小花、碎石只点在开阔地上。
  p.add(`<rect class="pt-ground ${ground}" width="${W}" height="${H}"/>`);
  if (t.style === 'interior') p.add(`<rect width="${W}" height="${H}" filter="${f('wear')}" class="pt-floor-wear"/><rect width="${W}" height="${H}" fill="${f('tiles')}"/>`);
  else {
    p.add(`<rect width="${W}" height="${H}" filter="${f('mottle-dark')}"/><rect width="${W}" height="${H}" filter="${f('mottle-light')}" class="pt-mottle-light"/>`);
    p.add(`<rect width="${W}" height="${H}" filter="${f('brush')}" class="pt-brush"/>`);
    // 草丛只定义四种，开阔地上用 <use> 摆放，地图再大也不重复写叶片路径。
    for (let v = 0; v < 4; v++) {
      let dark = '', light = '';
      for (let b = 0; b < 6; b++) {
        const a = (b - 2.5) * .28 + (noise(v, 530 + b) - .5) * .3, len = 7 + noise(v, 540 + b) * 7;
        const blade = `M-1.2 0Q${r1(Math.sin(a) * len * .4 - 1)} ${r1(-len * .5)} ${r1(Math.sin(a) * len)} ${r1(-Math.cos(a) * len)}Q${r1(Math.sin(a) * len * .4 + 1)} ${r1(-len * .5)} 1.2 0Z`;
        if (b % 2) light += blade; else dark += blade;
      }
      defs.push(`<g id="${id}-gc${v}"><path class="pt-blade" d="${dark}"/><path class="pt-blade pt-blade-light" d="${light}"/></g>`);
    }
    let clumps = '', flowers = '', pebbles = '', pebbleShade = '';
    for (let q = 0; q < g.n; q++) {
      if (t.tiles[q] !== 'open' || t.struct(q) || t.field.overlays?.[q]?.length) continue;
      const [x, y] = t.at(q);
      for (let k = 0; k < 2; k++) {
        if (noise(q, 500 + k) > .62) continue;
        clumps += `<use href="#${id}-gc${Math.floor(noise(q, 530 + k) * 4)}" x="${r1(x + 12 + noise(q, 510 + k) * 76)}" y="${r1(y + 16 + noise(q, 520 + k) * 72)}"/>`;
      }
      if (noise(q, 560) < .16) flowers += circle(x + 15 + noise(q, 561) * 70, y + 15 + noise(q, 562) * 70, 1.8) + circle(x + 18 + noise(q, 563) * 64, y + 20 + noise(q, 564) * 62, 1.5);
      if (noise(q, 570) < .3) { const sx = x + 14 + noise(q, 571) * 72, sy = y + 14 + noise(q, 572) * 72, r = 2.5 + noise(q, 573) * 3; pebbleShade += ellipse(sx + 1, sy + 1.6, r, r * .7); pebbles += ellipse(sx, sy, r, r * .7); }
    }
    p.add(clumps); p.path('pt-flower', flowers); p.path('pt-pebble-shade', pebbleShade); p.path('pt-pebble', pebbles);
  }
  // 硬化地面（街道、广场）：不画具体铺材，只有磨损深浅和细裂纹，石板、夯土、水泥、沥青都说得通。
  if (t.style !== 'interior') { const paved = crisp(t.isPaved); p.path('pt-paving', paved); p.path('pt-wear', paved, ` filter="${f('wear')}"`); p.path('pt-texture', paved, ` fill="${f('cracks')}"`); }
  // 崎岖地：土色斑块 + 带阴影的碎石；堑壕战里是弹坑。
  const rough = t.all(t.isRough);
  if (rough.length) {
    if (t.style === 'trenches') {
      let rims = '', pits = '', lit = '';
      for (const q of rough) {
        const [x, y] = t.at(q);
        for (let k = 0; k < 2; k++) { const cx = x + 30 + noise(q, 300 + k) * 40, cy = y + 30 + noise(q, 310 + k) * 40, r = 13 + noise(q, 320 + k) * 9; rims += circle(cx, cy, r + 6); pits += circle(cx + 1.5, cy + 2.5, r); lit += `M${r1(cx - r * .9)} ${r1(cy + r * .5)}A${r1(r)} ${r1(r)} 0 0 0 ${r1(cx + r * .9)} ${r1(cy + r * .5)}`; }
      }
      p.path('pt-crater-rim', rims, ` filter="${f('soft3')}"`); p.path('pt-crater', pits, ` filter="${f('soft1')}"`); p.path('pt-crater-lit', lit);
    } else {
      p.path('pt-rough', organic(t.isRough, 3), ` filter="${f('soft5')}"`);
      let stones = '', shade = '';
      for (const q of rough) {
        const [x, y] = t.at(q);
        for (let k = 0; k < 8; k++) { const sx = x + 12 + noise(q, 40 + k) * 76, sy = y + 12 + noise(q, 50 + k) * 76, rx = 3.5 + noise(q, 60 + k) * 5, ry = 2.6 + noise(q, 70 + k) * 3.4; shade += ellipse(sx + 1.4, sy + 2.2, rx, ry); stones += ellipse(sx, sy, rx, ry); }
      }
      p.path('pt-pebble-shade', shade); p.path('pt-pebble', stones);
    }
  }
  // 沼泽与水：泥岸 → 浑浊水面，深水更暗，表面有细长反光；岸边长芦苇。
  const reeds = (cells: number[], salt: number) => {
    let dark = '', light = '';
    for (const q of cells) {
      const [x, y] = t.at(q);
      for (let k = 0; k < 3; k++) {
        if (noise(q, salt + k) > .7) continue;
        const cx = x + 10 + noise(q, salt + 10 + k) * 80, cy = y + 14 + noise(q, salt + 20 + k) * 76;
        for (let b = 0; b < 5; b++) { const a = (b - 2) * .22, len = 10 + noise(q, salt + 30 + k * 5 + b) * 9; const path = `M${r1(cx - 1)} ${r1(cy)}L${r1(cx + Math.sin(a) * len)} ${r1(cy - len)}L${r1(cx + 1)} ${r1(cy)}Z`; if (b % 2) light += path; else dark += path; }
      }
    }
    p.path('pt-reed', dark); p.path('pt-reed pt-reed-light', light);
  };
  const marsh = organic(t.isSwamp, 5);
  if (marsh) {
    p.path('pt-swamp', marsh, ` filter="${f('soft4')}"`);
    let pools = '';
    for (const q of t.all(t.isSwamp)) { const [x, y] = t.at(q); for (let k = 0; k < 3; k++) pools += ellipse(x + 20 + noise(q, 30 + k) * 60, y + 22 + noise(q, 34 + k) * 56, 11 + noise(q, 38 + k) * 10, 6 + noise(q, 42 + k) * 5); }
    p.path('pt-pool', pools, ` filter="${f('soft1')}"`);
    reeds(t.all(t.isSwamp), 700);
  }
  const water = traceLoops(g, t.isWater);
  if (water.length) {
    const shape = { r: 34, rc: 14, jitter: 7, step: 26, salt: 9 }, d = loopPath(water, shape);
    p.path('pt-bank', loopPath(water, { ...shape, off: 10 }), ` filter="${f('soft4')}"`);
    p.path('pt-bank-wet', loopPath(water, { ...shape, off: 4 }), ` filter="${f('soft2')}"`);
    p.path('pt-water', d);
    p.path('pt-water-deep', loopPath(traceLoops(g, t.isDeep), { ...shape, off: -10 }), ` filter="${f('soft6')}"`);
    p.path('pt-glint', d, ` filter="${f('glint')}"`);
    p.path('pt-water-edge', loopPath(water, { ...shape, off: -3 }), ` filter="${f('soft2')}"`);
    reeds(t.all(q => t.isWater(q) && !t.isDeep(q) || t.isWater(q) && [q - 1, q + 1, q - g.w, q + g.w].some(n => n >= 0 && n < g.n && !t.isWater(n) && Math.abs(n % g.w - q % g.w) <= 1)).filter((_, i) => i % 2 === 0), 800);
  }
  // 道路：土路柔边 + 车辙；城内为石板路；室内为地毯。
  if (t.roads.length) {
    if (t.style === 'interior') { p.path('pt-rug-edge', skeleton(g, t.roads, t.joinRoad, 48)); p.path('pt-rug', skeleton(g, t.roads, t.joinRoad, 40)); p.path('pt-texture', skeleton(g, t.roads, t.joinRoad, 40), ` fill="${f('weave')}"`); }
    else if (t.style === 'city') {
      p.path('pt-lane', skeleton(g, t.roads, t.joinRoad, 50), ` filter="${f('soft3')}"`);
      p.path('pt-lane-track', segments(g, t.roads, t.joinRoad).map(s => s.y0 === s.y1 ? `M${s.x0} ${s.y0 - 10}H${s.x1}M${s.x0} ${s.y0 + 10}H${s.x1}` : `M${s.x0 - 10} ${s.y0}V${s.y1}M${s.x0 + 10} ${s.y0}V${s.y1}`).join(''), ` filter="${f('soft2')}"`);
    }
    else {
      p.path('pt-road', skeleton(g, t.roads, t.joinRoad, 46), ` filter="${f('soft3')}"`);
      p.path('pt-rut', segments(g, t.roads, t.joinRoad).map(s => s.y0 === s.y1 ? `M${s.x0} ${s.y0 - 9}H${s.x1}M${s.x0} ${s.y0 + 9}H${s.x1}` : `M${s.x0 - 9} ${s.y0}V${s.y1}M${s.x0 + 9} ${s.y0}V${s.y1}`).join(''), ` filter="${f('soft1')}"`);
    }
  }
  if (t.style !== 'interior') p.add(`<rect width="${W}" height="${H}" filter="${f('grain')}" class="pt-grain"/>`);

  // ── 台地：顶面提亮，南缘露出崖面（高差越大崖面越高），东西侧一道暗边，崖下投影。
  if (t.maxLevel > 0) {
    let faces = '', sides = '', rims = '';
    for (let q = 0; q < g.n; q++) {
      const here = t.level(q); if (!here) continue;
      const [x, y] = t.at(q), row = Math.floor(q / g.w), col = q % g.w;
      const south = row < g.h - 1 ? t.level(q + g.w) : here, drop = here - south;
      if (drop > 0) faces += rect(x, y + S - Math.min(36, 14 * drop), S, Math.min(36, 14 * drop));
      if (col > 0 && t.level(q - 1) < here) sides += rect(x, y, 4, S);
      if (col < g.w - 1 && t.level(q + 1) < here) sides += rect(x + S - 4, y, 4, S);
      if (row > 0 && t.level(q - g.w) < here) rims += `M${x} ${y + 1.5}h${S}`;
    }
    for (let L = 1; L <= Math.min(3, t.maxLevel); L++) {
      const d = crisp(q => t.level(q) >= L, 0, 12);
      defs.push(`<mask id="${id}-out${L}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><path d="${d}" fill="#000"/></mask>`);
      p.add(`<g mask="${f('out' + L)}"><path class="pt-cast" d="${d}" transform="translate(4 10)" filter="${f('soft5')}"/></g>`);
      p.path('pt-elev', d);
    }
    p.path('pt-cliff', faces); p.path('pt-texture', faces, ` fill="${f('strata')}"`); p.path('pt-cliff-side', sides); p.path('pt-rim', rims);
  }

  // ── 岩壁：3/4 岩体，上面再摆几块带阴影的巨石。
  const rockCells = t.all(t.isRock);
  if (rockCells.length) {
    const d = organic(t.isRock, 11, -4, 8);
    block(d, 16, 'pt-rock-top', 'pt-rock-face', sid => `<use href="#${sid}" fill="${f('rockgrain')}"/>`, [8, 10, 5]);
    let boulders = '', tops = '', lit = '';
    for (const q of rockCells) {
      const [x, y] = t.at(q);
      for (let k = 0; k < 2; k++) {
        const cx = x + 26 + noise(q, 600 + k) * 48, cy = y + 34 + noise(q, 610 + k) * 40, r = 11 + noise(q, 620 + k) * 7;
        const pts = Array.from({ length: 7 }, (_, i) => { const a = i / 7 * Math.PI * 2, rr = r * (.8 + noise(q, 630 + k * 9 + i) * .35); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .72] as const; });
        const poly = (dy: number, s = 1) => 'M' + pts.map(([px, py]) => `${r1(cx + (px - cx) * s)} ${r1(cy + (py - cy) * s + dy)}`).join('L') + 'Z';
        boulders += poly(0); tops += poly(-6, .86); lit += `M${r1(cx - r * .6)} ${r1(cy - r * .5 - 6)}Q${r1(cx - r * .1)} ${r1(cy - r * .85 - 6)} ${r1(cx + r * .45)} ${r1(cy - r * .55 - 6)}`;
      }
    }
    shadow(boulders, 5, 6, 3); p.path('pt-rock-face', boulders); p.path('pt-rock-top', tops); p.path('pt-rock-lit', lit);
  }

  // ── 树林：按从北到南的顺序画 3/4 树，先统一画投影，再逐棵画树干与三层树冠；整组加轻微叶缘扰动。
  const woods = t.all(t.isWood);
  if (woods.length) {
    const trees: { x: number; y: number; r: number; dense: boolean }[] = [];
    for (const q of woods) {
      const [x, y] = t.at(q), dense = t.legacyThicket(q);
      const spots = dense ? [[22, 34], [70, 28], [46, 62], [22, 92], [74, 88]] : [[22, 40], [68, 34], [36, 80], [78, 86]];
      spots.forEach(([sx, sy], k) => trees.push({ x: x + sx! + (noise(q, 100 + k) - .5) * 12, y: y + sy! + (noise(q, 110 + k) - .5) * 10, r: 24 + noise(q, 120 + k) * 8, dense }));
    }
    trees.sort((a, b) => a.y - b.y);
    p.path('pt-shadow pt-tree-shadow', trees.map(tr => ellipse(tr.x + tr.r * .55, tr.y + 1, tr.r * 1.05, tr.r * .42)).join(''), ` filter="${f('soft4')}"`);
    const lobes = (cx: number, cy: number, r: number, seed: number) => {
      let d = circle(cx, cy, r * .78);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + noise(seed, i) * .8, dist = r * (.36 + noise(seed, 10 + i) * .16); d += circle(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * .85, r * (.46 + noise(seed, 20 + i) * .14)); }
      return d;
    };
    // 六种树形以树干着地点为原点、半径 24 定义一次；每棵树只是一次带位移和缩放的 <use>。
    for (let v = 0; v < 6; v++) {
      const r = 24, cy = -r * 1.25;
      defs.push(`<g id="${id}-tr${v}"><path class="pt-trunk" d="M${r1(-r * .13)} 0L${r1(-r * .06)} ${r1(cy + r * .2)}L${r1(r * .06)} ${r1(cy + r * .2)}L${r1(r * .13)} 0Z"/>`
        + `<path class="pt-canopy" d="${lobes(0, cy, r, v * 13 + 1)}"/><path class="pt-canopy-mid" d="${lobes(-r * .12, cy - r * .14, r * .78, v * 13 + 5)}"/>`
        + `<path class="pt-canopy-light" d="${lobes(-r * .3, cy - r * .36, r * .36, v * 13 + 9)}"/></g>`);
    }
    const body = trees.map((tr, i) => `<use href="#${id}-tr${(i * 7 + Math.round(tr.x)) % 6}"${tr.dense ? ' class="pt-dense"' : ''} transform="translate(${r1(tr.x)} ${r1(tr.y)}) scale(${(tr.r / 24).toFixed(3)})"/>`).join('');
    p.add(`<g filter="${f('leafy')}">${body}</g>`);
  }

  // ── 室内隔墙 / 城区房屋 / 城墙：3/4 体块。
  if (interior) {
    const walls = crisp(q => t.partitions.includes(q), -3, 2, false);
    block(walls, t.style === 'compound' ? 18 : 14, 'pt-iwall-top', 'pt-iwall-face', undefined, [5, 7, 3]);
  } else {
    for (const group of components(g, t.buildings)) {
      const set = new Set(group), d = crisp(q => set.has(q), -6, 3, false);
      const xs = group.map(q => q % g.w), ys = group.map(q => Math.floor(q / g.w));
      const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys), tone = Math.floor(noise(Math.min(...group), 160) * 4);
      let shade = '', ridge = '', windows = '';
      const x0 = Math.min(...xs) * S + 6, x1 = (Math.max(...xs) + 1) * S - 6, y0 = Math.min(...ys) * S + 6, y1 = (Math.max(...ys) + 1) * S - 6;
      // 顶面组整体上移 26 后裁回轮廓，可见的是屋顶坐标里的 [y0+26, y1]，屋脊取其中线。
      const ridgeY = (y0 + y1 + 26) / 2;
      if (horizontal) { shade += rect(x0, ridgeY, x1 - x0, y1 - ridgeY); ridge += `M${x0} ${r1(ridgeY)}H${x1}`; }
      else { shade += rect((x0 + x1) / 2, y0, x1, y1 - y0); ridge += `M${(x0 + x1) / 2} ${y0}V${y1}`; }
      for (const q of group) {
        if (set.has(q + g.w) && Math.floor(q / g.w) < g.h - 1) continue;
        const [x, y] = t.at(q);
        windows += noise(q, 170) < .5 ? rect(x + 20, y + S - 22, 12, 11) + rect(x + 64, y + S - 22, 12, 11) : rect(x + 42, y + S - 26, 16, 20);
      }
      block(d, 26, 'pt-roof pt-roof-' + tone, 'pt-house-face', sid => `<path class="pt-roof-shade" d="${shade}"/><path class="pt-ridge" d="${ridge}"/><use href="#${sid}" fill="${f('shingles')}"/>`, [8, 10, 4]);
      p.path('pt-window', windows);
    }
    if (t.wallLine.length) {
      const body = skeleton(g, t.wallLine, t.joinWall, 44), line = segments(g, t.wallLine, t.joinWall);
      let merlon = '', gaps = '';
      for (const s of line) { const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0), k = Math.max(1, Math.floor(len / 17)); for (let i = 0; i < k; i++) for (const side of [-1, 1]) { const u = (i + .5) * len / k; merlon += s.y0 === s.y1 ? rect(s.x0 + u - 4.5, s.y0 + side * 18 - 4, 9, 8) : rect(s.x0 + side * 18 - 4, s.y0 + u - 4.5, 8, 9); } }
      // 门洞处把墙体连同投影、垛口一起裁掉，两侧由门垛收头。
      for (const q of t.gates) { const [x, y] = t.at(q); gaps += gateHorizontal(t, q) ? rect(x + 29, y - 2, S - 58, S + 4) : rect(x - 2, y + 29, S + 4, S - 58); }
      if (gaps) defs.push(`<mask id="${id}-gatecut" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><path d="${gaps}" fill="#000"/></mask>`);
      p.group(gaps ? `mask="${f('gatecut')}"` : 'class="pt-wall"', () => {
        block(body, 16, 'pt-wall-top', 'pt-wall-face', () => `<path class="pt-merlon" d="${merlon}"/><path class="pt-walk" d="${line.map(s => `M${s.x0} ${s.y0}L${s.x1} ${s.y1}`).join('')}"/>`, [8, 11, 4]);
      });
    }
  }
  for (const q of t.towers) {
    const [x, y] = t.at(q), d = circle(x + 50, y + 54, 38);
    let merlon = '';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; merlon += rect(x + 50 + Math.cos(a) * 33 - 4, y + 54 + Math.sin(a) * 33 - 4, 8, 8); }
    block(d, 22, 'pt-wall-top', 'pt-wall-face', () => `<path class="pt-merlon" d="${merlon}"/><path class="pt-tower-floor" d="${circle(x + 50, y + 54, 24)}"/>`, [9, 11, 4]);
  }
  // ── 城门：城墙在门洞处断开，两侧是略宽略高、带垛口的门垛；门洞露出地面。关闭时一扇带铁箍的门立在门洞中，开启时门扇贴在两侧。
  //    室内门：隔墙本就在门格留空，只画门扇。
  let pillars = '', crenels = '', doorFace = '', doorTop = '', bands = '', leaves = '';
  for (const q of t.gates) {
    const st = t.intact(q)!, [x, y] = t.at(q), cx = x + 50, cy = y + 50, horizontal = gateHorizontal(t, q), open = st.gateState === 'open', half = interior ? 24 : 21;
    if (!interior) {
      if (horizontal) for (const px of [x, x + S - 29]) { pillars += rect(px, cy - 27, 29, 54); for (const mx of [px + 2, px + 11, px + 20]) crenels += rect(mx, cy - 26, 7, 6) + rect(mx, cy + 4, 7, 6); }
      else for (const py of [y, y + S - 29]) { pillars += rect(cx - 27, py, 54, 29); for (const mx of [cx - 25, cx - 3.5, cx + 18]) crenels += rect(mx, py + 1, 7, 6); }
    }
    if (horizontal) {
      if (open) leaves += rect(cx - half, cy - 32, 5, 30) + rect(cx + half - 5, cy - 32, 5, 30);
      else { doorTop += rect(cx - half, cy - 17, half * 2, 3); doorFace += rect(cx - half, cy - 14, half * 2, 18); bands += `M${cx - half} ${cy - 8}h${half * 2}M${cx - half} ${cy - 1}h${half * 2}M${cx} ${cy - 14}v18`; }
    } else {
      if (open) leaves += rect(cx + 3, cy - half, 26, 5) + rect(cx + 3, cy + half - 5, 26, 5);
      else { doorFace += rect(cx - 4, cy - half, 8, half * 2); bands += `M${cx - 4} ${cy - 9}h8M${cx - 4} ${cy + 9}h8`; }
    }
  }
  if (pillars) { block(pillars, 16, 'pt-wall-top', 'pt-wall-face', undefined, [8, 11, 4]); p.path('pt-merlon', crenels); }
  if (doorFace || leaves) { shadow(doorFace + leaves, 4, 6, 2); p.path('pt-door', doorFace + leaves); p.path('pt-door-top', doorTop); p.path('pt-band', bands); }

  // ── 工事：土胸墙（3/4，顶面浅、南面深）+ 壕沟；孤立的为圆形掩体坑。
  if (t.works.length) {
    const join = (q: number) => t.kindAt(q, 'fortification');
    const linked = t.works.filter(q => [q - g.w, q + g.w, q % g.w > 0 ? q - 1 : -1, q % g.w < g.w - 1 ? q + 1 : -1].some(n => n >= 0 && n < g.n && join(n)));
    let ring = '', pit = '';
    for (const q of t.works.filter(q => !linked.includes(q))) { const [x, y] = t.at(q); ring += circle(x + 50, y + 52, 32); pit += circle(x + 50, y + 50, 17); }
    const mound = skeleton(g, linked, join, 62) + ring;
    block(mound, 9, 'pt-parapet-top', 'pt-parapet-face', sid => `<use href="#${sid}" fill="${f('sandbags')}"/>`, [5, 8, 3]);
    p.path('pt-trench', skeleton(g, linked, join, 24) + pit, ` filter="${f('soft1')}"`);
  }
  // ── 掩体：野外为干砌石矮墙，城内为木箱与木桶，室内为桌椅；都带顶面、正面与投影。
  let wallD = '', crateD = '', barrelD = '', tableD = '', crateLines = '';
  for (const q of t.covers) {
    const [x, y] = t.at(q), j = (noise(q, 170) - .5) * 12;
    if (t.style === 'city' || t.style === 'compound') { crateD += roundedRect(x + 20 + j, y + 40, x + 48 + j, y + 70, 2, 2, 2, 2) + roundedRect(x + 50 + j, y + 50, x + 74 + j, y + 74, 2, 2, 2, 2); barrelD += circle(x + 34 + j, y + 27, 10); crateLines += `M${r1(x + 20 + j)} ${y + 47}l28 14M${r1(x + 50 + j)} ${y + 56}l24 12`; }
    else if (t.style === 'interior') tableD += roundedRect(x + 22, y + 34 + j, x + 78, y + 66 + j, 4, 4, 4, 4) + roundedRect(x + 10, y + 42 + j, x + 19, y + 58 + j, 2, 2, 2, 2) + roundedRect(x + 81, y + 42 + j, x + 90, y + 58 + j, 2, 2, 2, 2);
    else {
      for (let k = 0; k < 6; k++) wallD += ellipse(x + 20 + k * 12 + (noise(q, 180 + k) - .5) * 3, y + 64 + j + (noise(q, 190 + k) - .5) * 3, 7.5 + noise(q, 200 + k) * 2, 6.5);
      for (let k = 0; k < 4; k++) wallD += ellipse(x + 30 + k * 13 + (noise(q, 210 + k) - .5) * 3, y + 53 + j, 7 + noise(q, 220 + k) * 2, 6);
    }
  }
  if (wallD) block(wallD, 5, 'pt-drystone-top', 'pt-drystone-face', undefined, [5, 7, 2]);
  if (crateD) { block(crateD, 9, 'pt-crate-top', 'pt-crate-face', () => `<path class="pt-crate-line" d="${crateLines}"/>`, [5, 7, 2]); block(barrelD, 7, 'pt-barrel-top', 'pt-barrel-face', undefined, [5, 7, 2]); }
  if (tableD) block(tableD, 6, 'pt-table-top', 'pt-table-face', undefined, [5, 7, 2]);
  // ── 桥：水面投影 + 桥面 + 两侧护栏；不指定木、石或钢材质。
  let deck = '', rail = '';
  for (const q of t.bridges) {
    const [x, y] = t.at(q), cx = x + 50, cy = y + 50, vertical = bridgeVertical(t, q);
    for (const [start, len] of t.intact(q) ? [[-54, 108]] : [[-54, 30], [24, 30]]) {
      deck += vertical ? rect(cx - 26, cy + start!, 52, len!) : rect(cx + start!, cy - 26, len!, 52);
      rail += vertical ? rect(cx - 26, cy + start!, 6, len!) + rect(cx + 20, cy + start!, 6, len!) : rect(cx + start!, cy - 26, len!, 6) + rect(cx + start!, cy + 20, len!, 6);
    }
  }
  if (deck) { shadow(deck, 8, 12, 4); p.path('pt-deck', deck); p.path('pt-wear', deck, ` filter="${f('wear')}"`); p.path('pt-rail', rail); }
  // ── 瓦砾：尘土 + 带阴影的碎块。
  if (t.rubble.length) {
    let dust = '', stones = '', shade = '';
    for (const q of t.rubble) {
      const [x, y] = t.at(q); dust += ellipse(x + 50, y + 54, 38, 30);
      for (let k = 0; k < 8; k++) { const sx = x + 14 + noise(q, 130 + k) * 72, sy = y + 16 + noise(q, 140 + k) * 68, a = 6 + noise(q, 150 + k) * 8; const poly = (dx: number, dy: number) => `M${r1(sx + dx)} ${r1(sy + dy)}l${r1(a)} ${r1(-a * .4)}l${r1(a * .3)} ${r1(a * .8)}l${r1(-a)} ${r1(a * .3)}Z`; stones += poly(0, 0); shade += poly(1.8, 2.6); }
    }
    p.path('pt-dust', dust, ` filter="${f('soft6')}"`); p.path('pt-pebble-shade', shade); p.path('pt-debris', stones);
  }

  if (t.zone.length) { const set = new Set(t.zone), d = loopPath(traceLoops(g, q => set.has(q), false), { r: 8, off: -6 }); p.path('pt-zone-fill', d, ` fill="${f('hatch')}"`); p.path('pt-zone-line', outline(g, t.zone, 6)); }
  p.add(`<rect width="${W}" height="${H}" fill="${f('vignette')}"/>`);
  p.path('pt-exit', exitChevrons(t));
  p.path('pt-grid', gridLines(t), ' vector-effect="non-scaling-stroke"');
  p.path('pt-landmark', t.marks.map(m => outline(g, m.cells, 4)).join(''));

  const blur = (name: string, sd: number) => `<filter id="${id}-${name}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  const turb = (name: string, freq: string, oct: number, seed: number, matrix: string) => `<filter id="${id}-${name}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}"/><feColorMatrix type="matrix" values="${matrix}"/></filter>`;
  defs.push([1, 2, 3, 4, 5, 6].map(k => blur('soft' + k, k)).join(''),
    turb('mottle-dark', '.006', 3, 7, '0 0 0 0 .1  0 0 0 0 .11  0 0 0 0 .05  1.6 0 0 0 -.75'),
    turb('mottle-light', '.01', 3, 21, '0 0 0 0 .66  0 0 0 0 .6  0 0 0 0 .38  0 1.8 0 0 -.92'),
    turb('brush', '.05 .03', 2, 31, '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -2.6 0 1.45'),
    turb('grain', '.5', 2, 3, '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -2.2 0 1.25'),
    `<filter id="${id}-glint" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".014 .07" numOctaves="2" seed="4"/><feColorMatrix type="matrix" values="0 0 0 0 .78  0 0 0 0 .86  0 0 0 0 .8  0 0 0 2.4 -1.45"/><feComposite in2="SourceGraphic" operator="in"/></filter>`,
    `<filter id="${id}-leafy" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".11" numOctaves="2" seed="5" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency=".22" numOctaves="1" seed="8" result="t2"/><feColorMatrix in="t2" type="matrix" values="0 0 0 0 0  0 0 0 0 .03  0 0 0 0 0  -1.8 0 0 0 1.02" result="shade"/><feComposite in="shade" in2="d" operator="in" result="s"/><feMerge><feMergeNode in="d"/><feMergeNode in="s"/></feMerge></filter>`,
    `<radialGradient id="${id}-vignette" gradientUnits="userSpaceOnUse" cx="${W / 2}" cy="${H / 2}" r="${Math.hypot(W, H) * .56}"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>`,
    `<filter id="${id}-wear" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".014" numOctaves="2" seed="13"/><feColorMatrix type="matrix" values="0 0 0 0 .08  0 0 0 0 .07  0 0 0 0 .05  1.1 0 0 0 -.52"/><feComposite in2="SourceGraphic" operator="in"/></filter>`,
    `<pattern id="${id}-cracks" width="140" height="140" patternUnits="userSpaceOnUse"><path class="pt-pat-crack-fine" d="M12 18l9 6l4 11l10 3M70 8l-4 12l6 9M96 60l11 4l5 10l9 2M40 92l7 9l-2 11M118 112l-9 7l-3 12M20 128l12-4l6 6"/></pattern>`,
    `<pattern id="${id}-tiles" width="50" height="50" patternUnits="userSpaceOnUse"><path class="pt-pat-tile" d="M0 0H50M0 0V50"/></pattern>`,
    `<pattern id="${id}-shingles" width="14" height="9" patternUnits="userSpaceOnUse"><path class="pt-pat-shingle" d="M0 9H14M7 0V9"/></pattern>`,
    `<pattern id="${id}-weave" width="8" height="8" patternUnits="userSpaceOnUse"><path class="pt-pat-weave" d="M0 4H8M4 0V8"/></pattern>`,
    `<pattern id="${id}-strata" width="9" height="30" patternUnits="userSpaceOnUse"><path class="pt-pat-strata" d="M2 0V30M6 4V22"/></pattern>`,
    `<pattern id="${id}-rockgrain" width="26" height="26" patternUnits="userSpaceOnUse"><path class="pt-pat-crack" d="M3 5l7 5l-2 7M16 3l3 8l6 2M12 18l6 5"/></pattern>`,
    `<pattern id="${id}-sandbags" width="18" height="10" patternUnits="userSpaceOnUse"><path class="pt-pat-seam" d="M0 10H18M9 0V5M0 5H18"/></pattern>`,
    `<pattern id="${id}-hatch" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path class="pt-pat-zone" d="M0 0V16"/></pattern>`);
  return `<defs>${defs.join('')}</defs>` + p.out.join('') + landmarkLabels(t, 'pt-label');
}
