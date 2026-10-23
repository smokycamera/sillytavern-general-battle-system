import type { SeededRng } from '../rng.js';
import type { BattlefieldPlan } from './battlefield-plan.js';
import { BattlefieldPlanError } from './battlefield-error.js';
import { createStructure, groundBlocked } from './layers.js';
import { gridDistance, neighbors, type BattlefieldSpec } from './spatial.js';
import { INTERIOR_PATTERN_NAMES, INTERIOR_USE_NAMES, primaryInteriorRoom, type InteriorUse, type InteriorPattern, type InteriorLayoutRecord } from './interior-plan.js';
import { compassSector, gridPosition, gridBounds } from './grid-anchor.js';

interface Area { id: number; l: number; t: number; r: number; b: number; passage?: boolean; wing?: number; band?: number; planId?: string; planLabel?: string }
interface Portal { a: number; b: number; cells: number[] }
const USE_PATTERNS: Record<InteriorUse, InteriorPattern[]> = {
  residence: ['suite', 'hall', 'ring', 'wings'], inn: ['hall', 'suite', 'cells', 'wings'], temple: ['hall', 'ring', 'cross', 'suite'],
  warehouse: ['aisles', 'hall', 'wings'], workshop: ['aisles', 'cross', 'hall', 'suite'], office: ['cells', 'cross', 'wings', 'suite'],
  prison: ['cells', 'wings', 'ring'], ruins: ['broken', 'suite', 'ring', 'cross'],
};
const ROOM_LABELS: Record<InteriorUse, string[]> = {
  residence: ['前厅', '起居室', '书房', '卧房', '厨房', '储藏室', '侧室', '后厅'],
  inn: ['客堂', '厨房', '客房', '账房', '后厅', '储藏室', '偏厅', '客房侧间'],
  temple: ['前殿', '正殿', '侧殿', '经堂', '僧房', '库房', '后殿', '偏殿'],
  warehouse: ['前仓', '货区', '后仓', '库房', '值守间', '侧仓', '分拣间', '储藏间'],
  workshop: ['操作间', '主工坊', '原料间', '工具间', '成品间', '休息间', '侧工坊', '库房'],
  office: ['接待室', '办公间', '会议室', '档案室', '值班室', '资料室', '侧间', '储藏间'],
  prison: ['值守间', '牢室', '牢室侧间', '监房', '看守室', '库房', '侧牢室', '后监房'],
  ruins: ['残存前厅', '破损大厅', '侧室遗迹', '残存房间', '坍塌侧间', '后厅遗迹', '残存库房', '废弃侧室'],
};

/** Local choices are meaningful without a model; old archetypes still select an appropriate family. */
export function chooseInterior(plan: BattlefieldPlan | undefined, rng: SeededRng): Required<NonNullable<BattlefieldPlan['interior']>> {
  const labels = (plan?.landmarks ?? []).map(m => m.label ?? '').join(' ');
  const inferred: InteriorUse = /牢|监狱|囚/.test(labels) ? 'prison' : /客栈|酒馆|客房/.test(labels) ? 'inn'
    : /神殿|佛|寺|祭坛|经堂/.test(labels) ? 'temple' : /档案|办公|会议/.test(labels) ? 'office'
      : /工坊|车间|工具/.test(labels) ? 'workshop' : /仓|货架/.test(labels) ? 'warehouse'
        : /废|遗迹|坍塌/.test(labels) ? 'ruins' : plan?.archetype === 'great_hall' ? 'warehouse'
          : plan?.archetype === 'fortress' ? 'prison' : 'residence';
  const use = plan?.interior?.use ?? inferred;
  const legacy: Partial<Record<NonNullable<BattlefieldPlan['layout']>, InteriorPattern[]>> = {
    ring: ['ring'], crossroads: ['cross'], lanes: ['cells', 'aisles'], broken: ['broken'], strongpoint: ['hall', 'wings'], scattered: ['suite', 'wings'],
  };
  const pool = legacy[plan?.layout ?? 'automatic'] ?? USE_PATTERNS[use];
  return { use, pattern: plan?.interior?.pattern ?? pool[Math.floor(rng.next() * pool.length)]! };
}

/** Partition rooms first, connect their shared boundaries, then furnish the surviving floors. */
export function buildIndoorLayout(field: BattlefieldSpec, plan: BattlefieldPlan | undefined, rng: SeededRng): InteriorLayoutRecord {
  const w = field.width, h = field.height, level = plan?.fortLevel ?? 2;
  const int = (a: number, b: number) => a + Math.floor(rng.next() * (b - a + 1));
  const { use, pattern } = chooseInterior(plan, rng);
  const areas: Area[] = [], owners = Array(w * h).fill(-1) as number[];
  const add = (l: number, t: number, r: number, b: number, extra: Partial<Area> = {}) => {
    if (l > r || t > b) return;
    areas.push({ id: areas.length, l, t, r, b, ...extra });
  };
  const bands = (a: number, b: number, count: number): [number, number][] => {
    const result: [number, number][] = [];
    let start = a;
    for (let n = count; n > 1; n--) {
      const max = b - (n - 1) * 3;
      const end = Math.max(start + 1, Math.min(max, Math.round(start + (b - start + 2 - n) / n) + int(-1, 1)));
      result.push([start, end]); start = end + 2;
    }
    result.push([start, b]); return result;
  };
  const rowCount = Math.max(2, Math.min(4, Math.floor((h + 1) / 4)));
  const cx = Math.max(2, Math.min(w - 3, Math.floor(w / 2) + int(-1, 1)));
  const cy = Math.max(2, Math.min(h - 3, Math.floor(h / 2) + int(-1, 1)));
  const mainMark = plan?.landmarks?.find(m=>m.kind==='room' && primaryInteriorRoom(m));
  if (pattern === 'suite') {
    const sidePassage = w >= 7 && rng.next() < .5;
    if (sidePassage) add(0, 0, 0, h - 1, { passage: true });
    for (const [t, b] of bands(0, h - 1, rowCount)) add(sidePassage ? 2 : 0, t, w - 1, b);
  } else if (pattern === 'hall') {
    if (mainMark && /north|south/.test(compassSector(mainMark.anchor))) {
      if(w<7) throw new BattlefieldPlanError('主厅与侧室部署容量不足，请扩大室内地图');
      const north=compassSector(mainMark.anchor).includes('north');
      const west=(plan?.landmarks??[]).some(m=>m!==mainMark&&m.kind==='room'&&compassSector(m.anchor).includes('west'));
      const cut=west?2:w-3, l=west?cut+1:0, r=west?w-1:cut-1;
      const t=north?0:3, b=north?h-4:h-1, split=Math.floor((t+b)/2)+int(-1,1);
      add(l,t,r,b);
      add(west?0:cut+1,t,west?cut-1:w-1,split-1);
      add(west?0:cut+1,split+1,west?cut-1:w-1,b);
      add(0,north?h-2:0,w-1,north?h-1:1);
    } else if (h < 10) {
      add(0, 0, cx - 1, 1); add(cx + 1, 0, w - 1, 1); add(0, 3, w - 1, h - 1);
    } else {
      const top = Math.max(3, cy - int(1, 2)), bottom = Math.min(h - 4, cy + int(1, 2));
      const rearCut = int(2, w - 3);
      add(0, 0, cx - 1, top - 2); add(cx + 1, 0, w - 1, top - 2);
      add(0, top, w - 1, bottom);
      add(0, bottom + 2, rearCut - 1, h - 1); add(rearCut + 1, bottom + 2, w - 1, h - 1);
    }
  } else if (pattern === 'ring' || pattern === 'wings') {
    for (const wing of [0, 1]) {
      const rows = bands(0, h - 1, rowCount);
      rows.forEach(([t, b], band) => add(wing ? cx + 1 : 0, t, wing ? w - 1 : cx - 1, b, { wing, band }));
    }
  } else if (pattern === 'cross' || pattern === 'cells') {
    const passageId = areas.length;
    add(cx, 0, cx, h - 1, { passage: true });
    if (pattern === 'cross') add(0, cy, w - 1, cy, { id: passageId, passage: true });
    for (const wing of [0, 1]) {
      const l = wing ? cx + 2 : 0, r = wing ? w - 1 : cx - 2;
      const rows = pattern === 'cross' ? [[0, cy - 2], [cy + 2, h - 1]] : bands(0, h - 1, rowCount);
      for (const [t, b] of rows) add(l, t!, r, b!);
    }
  } else if (pattern === 'aisles') {
    add(0, 0, w - 1, 1); add(0, 3, w - 1, h - 4); add(0, h - 2, w - 1, h - 1);
  } else {
    add(0, 0, w - 1, h - 1);
    const count = Math.min(9, Math.max(4, Math.floor(w * h / 17)));
    for (let n = 1; n < count; n++) {
      const candidates = areas.filter(a => a.r - a.l >= 4 || a.b - a.t >= 4);
      if (!candidates.length) break;
      const a = [...candidates].sort((a, b) => (b.r - b.l + 1) * (b.b - b.t + 1) - (a.r - a.l + 1) * (a.b - a.t + 1))[int(0, Math.min(1, candidates.length - 1))]!;
      const vertical = a.r - a.l >= 4 && (a.b - a.t < 4 || rng.next() < .5);
      if (vertical) { const cut = int(a.l + 2, a.r - 2), right = a.r; a.r = cut - 1; add(cut + 1, a.t, right, a.b); }
      else { const cut = int(a.t + 2, a.b - 2), bottom = a.b; a.b = cut - 1; add(a.l, cut + 1, a.r, bottom); }
    }
  }
  // A named eastern/western room occupies a real side room, rather than labeling a whole-width hall.
  for (const mark of (plan?.landmarks ?? []).filter(m => m.kind === 'room' && !gridPosition(m.anchor) && /east|west/.test(m.anchor))) {
    const x = mark.anchor.includes('west') ? Math.floor(w * .2) : Math.floor(w * .8);
    const y = mark.anchor.includes('north') ? Math.floor(h * .2) : mark.anchor.includes('south') ? Math.floor(h * .8) : Math.floor(h / 2);
    const distance = (a: Area) => Math.max(0, a.l-x, x-a.r) + Math.max(0, a.t-y, y-a.b);
    const a = areas.filter(a=>!a.passage).sort((a,b)=>distance(a)-distance(b) || a.id-b.id)[0];
    if (a && a.r-a.l >= 4) {
      const cut = Math.floor((a.l+a.r)/2), right=a.r; a.r=cut-1; add(cut+1,a.t,right,a.b);
    }
  }
  // If the narrative names more rooms, subdivide the largest rooms that still have usable width/depth.
  const wanted = (plan?.landmarks ?? []).filter(m => m.kind === 'room').length;
  while (areas.filter(a => !a.passage).length < wanted) {
    const a = areas.filter(a => !a.passage && (a.r - a.l >= 4 || a.b - a.t >= 4))
      .sort((a, b) => (b.r - b.l) * (b.b - b.t) - (a.r - a.l) * (a.b - a.t))[0];
    if (!a) throw new BattlefieldPlanError('房间部署容量不足，请扩大室内地图');
    if (a.r - a.l >= 4) { const cut = Math.floor((a.l + a.r) / 2), right = a.r; a.r = cut - 1; add(cut + 1, a.t, right, a.b); }
    else { const cut = Math.floor((a.t + a.b) / 2), bottom = a.b; a.b = cut - 1; add(a.l, cut + 1, a.r, bottom); }
  }
  // Numbered room requests partition actual rooms before walls/doors are built. A name always binds a whole room.
  for (const [index, mark] of (plan?.landmarks ?? []).entries()) {
    const b = mark.kind === 'room' ? gridBounds(mark.anchor, w, h) : undefined;
    if (!b) continue;
    const overlap = (a: Area) => Math.max(0, Math.min(a.r,b[1])-Math.max(a.l,b[0])+1)
      * Math.max(0, Math.min(a.b,b[3])-Math.max(a.t,b[2])+1);
    let a = areas.filter(a=>!a.passage&&!a.planId&&overlap(a)>0)
      .sort((a,c)=>overlap(c)-overlap(a)||a.id-c.id)[0];
    if (!a) {
      // Several distinct rooms may share one numbered sector.
      const occupied = areas.filter(a=>!a.passage&&overlap(a)>0&&(a.r-a.l>=2||a.b-a.t>=2))
        .sort((a,c)=>overlap(c)-overlap(a)||a.id-c.id)[0];
      if (!occupied) throw new BattlefieldPlanError(`房间${mark.label??''}在${mark.anchor}部署容量不足`);
      if (occupied.r-occupied.l>=2) { const end=occupied.r,cut=Math.floor((occupied.l+end)/2);occupied.r=cut-1;add(cut+1,occupied.t,end,occupied.b); }
      else { const end=occupied.b,cut=Math.floor((occupied.t+end)/2);occupied.b=cut-1;add(occupied.l,cut+1,occupied.r,end); }
      a=areas.at(-1)!;
    }
    const old={...a}, l=Math.max(a.l,b[0]), r=Math.min(a.r,b[1]), t=Math.max(a.t,b[2]), bottom=Math.min(a.b,b[3]);
    add(old.l,old.t,l-2,old.b);add(r+2,old.t,old.r,old.b);
    add(l,old.t,r,t-2);add(l,bottom+2,r,old.b);
    Object.assign(a,{l,r,t,b:bottom,planId:mark.id??`grid-room-${index}`,planLabel:mark.label});
  }
  field.structures!.fill(null);
  for (let p = 0; p < w * h; p++) field.structures![p] = createStructure('building', level);
  for (const a of areas) for (let y = a.t; y <= a.b; y++) for (let x = a.l; x <= a.r; x++) {
    const p = y * w + x; owners[p] = a.id; field.structures![p] = null;
    if (a.passage) field.overlays![p] = ['road'];
  }
  const portals = new Map<string, Portal>();
  for (let p = 0; p < w * h; p++) if (owners[p] === -1) for (const [a, b] of [[p - 1, p + 1], [p - w, p + w]]) {
    if (!neighbors(field, p).includes(a!) || !neighbors(field, p).includes(b!)) continue;
    const aa = owners[a!]!, bb = owners[b!]!;
    if (aa < 0 || bb < 0 || aa === bb) continue;
    const key = [aa, bb].sort((a, b) => a - b).join(':');
    if (!portals.has(key)) portals.set(key, { a: aa, b: bb, cells: [] });
    portals.get(key)!.cells.push(p);
  }
  const ids = [...new Set(areas.map(a => a.id))], parent = new Map(ids.map(id => [id, id]));
  const root = (id: number): number => parent.get(id) === id ? id : root(parent.get(id)!);
  const joined: Portal[] = [], choices = [...portals.values()].map(edge => ({ edge, roll: rng.next() }));
  const preferred = (edge: Portal) => {
    if (pattern !== 'ring' && pattern !== 'wings') return 0;
    const a = areas.find(a => a.id === edge.a)!, b = areas.find(a => a.id === edge.b)!;
    return a.wing === b.wing || a.band === b.band && (a.band === 0 || a.band === rowCount - 1) ? 0 : 1;
  };
  choices.sort((a, b) => preferred(a.edge) - preferred(b.edge) || a.roll - b.roll);
  for (const { edge } of choices) {
    const a = root(edge.a), b = root(edge.b);
    if (a !== b) { parent.set(a, b); joined.push(edge); }
    else if (pattern === 'ring' && preferred(edge) === 0 || pattern === 'wings' && rng.next() < .35 || pattern === 'broken' && rng.next() < .4) joined.push(edge);
  }
  if (new Set(ids.map(root)).size !== 1) throw new BattlefieldPlanError('房间连通部署容量不足，请扩大室内地图');
  const doorways: number[] = [];
  for (const edge of joined) {
    const p = edge.cells[int(0, edge.cells.length - 1)]!;
    field.structures![p] = null; doorways.push(p); field.overlays![p] = ['road'];
    if (pattern === 'broken' && rng.next() < .65) {
      for (const n of neighbors(field, p).filter(n => edge.cells.includes(n)).slice(0, 1)) {
        field.structures![n] = null; field.overlays![n] = ['rubble'];
      }
    }
  }
  const wantedDoors = plan?.gatePlan?.length ?? (plan?.gates === 'none' ? 0 : plan?.gates === 'single' ? 1 : 2);
  for (const edge of joined) for (const p of edge.cells) {
    if (doorways.length >= wantedDoors) break;
    if (!doorways.includes(p)) { field.structures![p] = null; doorways.push(p); field.overlays![p] = ['road']; }
  }
  // Shelf rows have cross aisles and clear aprons; they never fill door approaches.
  const fixtures: number[] = [];
  if (pattern === 'aisles' && h >= 10) {
    const cross = Math.floor(h / 2), spacing = w >= 9 && rng.next() < .5 ? 3 : 2;
    for (let x = int(1, 2); x < w - 1; x += spacing) for (let y = 4; y < h - 4; y++) {
      const p = y * w + x;
      if (Math.abs(y - cross) <= (h > 15 ? 1 : 0) || doorways.some(d => gridDistance(field, p, d) <= 1)) continue;
      field.structures![p] = createStructure('building', level);
      fixtures.push(p);
    }
  }
  const density = { sparse: .12, balanced: .27, dense: .44 }[plan?.cover ?? plan?.density ?? 'balanced'];
  const rooms = areas.filter(a => !a.passage).map((a, index) => ({
    label: a.planLabel ?? ROOM_LABELS[use][index % ROOM_LABELS[use].length]!,
    ...(a.planId ? {planId:a.planId} : {}),
    cells: field.tiles.flatMap((_, p) => owners[p] === a.id && !groundBlocked(field, p) ? [p] : []),
  })).filter(r => r.cells.length);
  const main = rooms.reduce((best,room)=>room.cells.length>best.cells.length?room:best,rooms[0]!);
  const mainName: Record<InteriorUse,string> = {residence:'起居室',inn:'客堂',temple:'正殿',warehouse:'货区',workshop:'主工坊',office:'办公间',prison:'监房',ruins:'破损大厅'};
  const labels = ROOM_LABELS[use].filter(label=>label!==mainName[use]);
  let labelIndex = 0;
  for (const room of rooms) if(!room.planId) room.label=room===main?mainName[use]:labels[labelIndex++%labels.length]!;
  // Keep the middle of each room usable. Furniture hugs selected walls in clusters rather than perimeter-only stamps.
  for (const room of rooms) {
    const set = new Set(room.cells), edges = room.cells.filter(p => neighbors(field, p).some(n => !set.has(n) && !doorways.includes(n)));
    const corner = edges[int(0, Math.max(0, edges.length - 1))];
    for (const p of edges) {
      if (p === undefined || Math.floor(p / w) < 2 || Math.floor(p / w) >= h - 2 || doorways.some(d => gridDistance(field, p, d) <= 1)) continue;
      if (rng.next() < density && (corner === undefined || gridDistance(field, p, corner) <= 3 || use === 'warehouse' || use === 'workshop')) {
        field.structures![p] = createStructure('cover', level);
        if (use === 'ruins') field.overlays![p] = ['rubble'];
      }
    }
  }
  const walkable = field.tiles.flatMap((_, p) => !groundBlocked(field, p) ? [p] : []);
  field.objective.cell = walkable.sort((a, b) => gridDistance(field, a, Math.floor(h / 2) * w + Math.floor(w / 2)) - gridDistance(field, b, Math.floor(h / 2) * w + Math.floor(w / 2)) || a - b)[0]!;
  const result: InteriorLayoutRecord = { use, pattern, rooms, doorways, ...(fixtures.length?{fixtures}:{}) };
  field.generation!.version = 7; field.generation!.interior = result;
  field.generation!.notes = [...(field.generation!.notes ?? []), `${INTERIOR_USE_NAMES[use]} · ${INTERIOR_PATTERN_NAMES[pattern]}`];
  return result;
}
