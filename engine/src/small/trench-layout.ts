import type { SeededRng } from '../rng.js';
import type { BattlefieldPlan } from './battlefield-plan.js';
import { createStructure } from './layers.js';
import { neighbors, type BattlefieldSpec } from './spatial.js';
import { TRENCH_PATTERNS, type TrenchPattern, type TrenchNetwork } from './position-plan.js';
import { gridPosition } from './grid-anchor.js';
import { worldAnchorCell } from './landmark-placement.js';

/** Trace each force's network independently; topology is chosen before the crater decoration. */
export function buildTrenchLayout(field: BattlefieldSpec, plan: BattlefieldPlan | undefined, rng: SeededRng): void {
  const { width: w, height: h } = field, level = plan?.fortLevel ?? 3;
  const int = (a: number, b: number) => a + Math.floor(rng.next() * (b - a + 1));
  const pattern: TrenchPattern = plan?.trenches?.pattern ?? (plan?.archetype === 'trench_depth' ? 'depth'
    : TRENCH_PATTERNS[int(0, TRENCH_PATTERNS.length - 1)]!);
  const networks: TrenchNetwork[] = [];
  const north = (a: string) => {const p=gridPosition(a);return p?p[1]<2:a.includes('north');};
  const northSide = plan?.deployments?.find(d => d.subject === 'ally')?.at.some(north)
    && !plan?.deployments?.find(d => d.subject === 'enemy')?.at.some(north) ? 'ally' : 'enemy';
  for (const side of [northSide, northSide === 'enemy' ? 'ally' : 'enemy'] as const) {
    const at = (x: number, d: number) => (side === northSide ? d : h - 1 - d) * w + x;
    const limit = Math.floor(h / 2) - 1;
    const base = Math.max(pattern === 'saps' ? 1 : 2, Math.min(pattern === 'saps' ? limit - 2 : limit, Math.floor(h * .29) + int(-1, 0)));
    const left = int(0, 1), right = w - 1 - int(0, 1), turn = int(2, w - 3), bump = int(0, 1);
    const parts = { front: new Set<number>(), support: new Set<number>(), communication: new Set<number>(), saps: new Set<number>() };
    const point = (part: keyof typeof parts, x: number, d: number) => {
      x = Math.max(0, Math.min(w - 1, x)); d = Math.max(0, Math.min(limit, d)); parts[part].add(at(x, d));
    };
    const path = (part: keyof typeof parts, vertices: [number, number][]) => {
      let [x, d] = vertices[0]!; point(part, x, d);
      for (const [tx, td] of vertices.slice(1)) {
        while (x !== tx || d !== td) { if (d !== td) d += Math.sign(td - d); else x += Math.sign(tx - x); point(part, x, d); }
      }
    };
    const ys = Array.from({ length: w }, (_, x) => pattern === 'echelon'
      ? Math.max(1, Math.min(limit, base - 1 + Math.floor((x - left) * 3 / Math.max(1, right - left))))
      : pattern === 'salient' ? Math.min(limit, base + Math.max(0, 2 - Math.abs(x - turn)))
      : Math.min(limit, base + (x >= turn ? bump : 0)));
    if (pattern === 'strongpoints') {
      const support = Math.max(0, base - 2);
      path('support', [[left, support], [right, support]]);
      const centers = right - left >= 10 ? [left + 1, Math.floor((left + right) / 2), right - 1] : [left + 1, right - 1];
      for (const x of centers) {
        const d = Math.min(limit, base + int(0, 1));
        path('front', [[x - 1, d - 1], [x - 1, d], [x + 1, d], [x + 1, d - 1]]);
        path('communication', [[x, support], [x, d]]);
      }
    } else {
      path('front', Array.from({ length: right - left + 1 }, (_, i) => [left + i, ys[left + i]!] as [number, number]));
      const starts = [...new Set([int(left + 1, Math.max(left + 1, turn)), int(Math.min(turn + 1, right - 1), right - 1)])];
      if (pattern === 'depth') {
        const rear = Math.max(0, base - 2);
        path('support', [[left, rear], [turn, rear], [turn, Math.max(0, rear - 1)], [right, Math.max(0, rear - 1)]]);
      }
      for (const x of starts) {
        const rear = Math.max(0, base - (pattern === 'depth' ? 2 : int(2, 3))), bend = Math.max(left, Math.min(right, x + (rng.next() < .5 ? -1 : 1)));
        path('communication', [[x, ys[x]!], [x, Math.max(rear, ys[x]! - 1)], [bend, Math.max(rear, ys[x]! - 1)], [bend, rear]]);
        // The support line can step one row farther back after its turn.
        if (pattern === 'depth') path('communication', [[bend, rear], [bend, Math.max(0, base - 2 - Number(bend > turn))]]);
      }
      if (pattern === 'saps') for (const x of starts) {
        const shift = Math.max(left, Math.min(right, x + (rng.next() < .5 ? -1 : 1)));
        path('saps', [[x, ys[x]!], [x, Math.min(limit, ys[x]! + 1)], [shift, Math.min(limit, ys[x]! + 1)], [shift, limit]]);
      }
    }
    for (const mark of plan?.landmarks??[]) if(mark.kind==='fortification'&&gridPosition(mark.anchor)) {
      const target=worldAnchorCell(field,mark.anchor as import('./scene-intent.js').WorldAnchor), y=Math.floor(target/w);
      if ((side===northSide)!==(y<h/2)) continue;
      const d=side===northSide?y:h-1-y, x=target%w;
      const closest=[...new Set(Object.values(parts).flatMap(s=>[...s]))].sort((a,b)=>Math.abs(a%w-x)+Math.abs(Math.floor(a/w)-y)-Math.abs(b%w-x)-Math.abs(Math.floor(b/w)-y)||a-b)[0]!;
      path('communication',[[closest%w,side===northSide?Math.floor(closest/w):h-1-Math.floor(closest/w)],[x,d]]);
      point(/后壕|后方|第二|支援|预备|support/.test(mark.label??'')?'support':'front',x,d);
    }
    const cells = [...new Set(Object.values(parts).flatMap(s => [...s]))].sort((a, b) => a - b);
    for (const p of cells) field.structures![p] = createStructure('fortification', level);
    networks.push({ side, ...Object.fromEntries(Object.entries(parts).map(([k, s]) => [k, [...s].sort((a, b) => a - b)])) as Omit<TrenchNetwork, 'side' | 'cells'>, cells });
  }
  const occupied = new Set(networks.flatMap(n => n.cells)), noMansLand: number[] = [];
  for (let x = 0; x < w; x++) {
    const top = Math.max(...networks[0]!.cells.filter(p => p % w === x).map(p => Math.floor(p / w)), 0);
    const bottom = Math.min(...networks[1]!.cells.filter(p => p % w === x).map(p => Math.floor(p / w)), h - 1);
    for (let y = top + 1; y < bottom; y++) if (!occupied.has(y * w + x)) noMansLand.push(y * w + x);
  }
  for (let n = 0; n < int(2, 5); n++) {
    const p = noMansLand[int(0, noMansLand.length - 1)];
    if (p === undefined) continue;
    for (const q of [p, ...neighbors(field, p).slice(0, int(0, 2))]) if (noMansLand.includes(q) && q !== field.objective.cell) {
      field.tiles[q] = 'rough'; field.overlays![q] = ['rubble'];
    }
  }
  field.generation!.version = 8; field.generation!.trenches = { pattern, networks, noMansLand };
}
