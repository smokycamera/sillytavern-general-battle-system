import type { SeededRng } from '../rng.js';
import { gridDistance, neighbors, type BattlefieldSpec } from './spatial.js';
import { damageStructure, groundBlocked } from './layers.js';
import type { BreachPlan } from './battlefield-plan.js';

/** Open real non-gate wall segments; never count adjacent holes as separate breaches. */
export function carveInitialBreaches(field: BattlefieldSpec, frontline: number[], inside: number[], plan: BreachPlan,
  defender: 'ally' | 'enemy', rng: SeededRng): { groups: number[][]; notes: string[] } {
  const groups: number[][] = [], notes: string[] = [];
  if (!plan.count) return { groups, notes };
  const wall = new Set(frontline), inner = new Set(inside), width = plan.width ?? 1;
  const depth = (p: number) => defender === 'enemy' ? Math.floor(p / field.width) : field.height - 1 - Math.floor(p / field.width);
  const front = Math.max(...frontline.map(depth)), rear = Math.min(...frontline.map(depth));
  const left = Math.min(...frontline.map(p => p % field.width)), right = Math.max(...frontline.map(p => p % field.width));
  const sector = (cells: number[]): string => {
    if (cells.every(p => depth(p) === front)) return cells.reduce((sum, p) => sum + p % field.width, 0) / cells.length < (left + right) / 2 ? 'front_left' : 'front_right';
    if (cells.every(p => depth(p) === rear)) return 'rear';
    return cells.every(p => p % field.width === left) ? 'left' : 'right';
  };
  const candidates = frontline.flatMap(p => (width === 1 ? [[p]] : [[p, p + 1], [p, p + field.width]])
    .filter(cells => cells.every(n => wall.has(n) && field.structures![n]?.kind === 'wall'
      && neighbors(field, n).some(k => inner.has(k) && !wall.has(k) && (!groundBlocked(field,k) || field.structures![k]?.kind === 'building'))
      && neighbors(field, n).some(k => !inner.has(k) && !wall.has(k) && (!groundBlocked(field,k) || field.structures![k]?.kind === 'building')))
      && (width === 1 || gridDistance(field, cells[0]!, cells[1]!) === 1))
    .map(cells => ({ cells, sector: sector(cells), random: rng.next() })));
  candidates.sort((a,b) => Number(b.sector === plan.sector) - Number(a.sector === plan.sector) || a.random - b.random || a.cells[0]! - b.cells[0]!);
  // At most three groups: bounded backtracking avoids a random first choice stranding
  // two wide holes when three non-adjacent holes physically fit the same wall.
  const conflicts = candidates.map(a => candidates.map(b => a.cells.some(p => b.cells.some(n => gridDistance(field,p,n) <= 1))));
  let best: number[] = [];
  const choose = (start: number, chosen: number[]): boolean => {
    if (chosen.length > best.length) best = [...chosen];
    if (chosen.length === plan.count) return true;
    for (let i = start; i < candidates.length; i++) {
      if (chosen.some(j => conflicts[i]![j])) continue;
      if (choose(i + 1, [...chosen, i])) return true;
    }
    return false;
  };
  choose(0, []);
  let relocated = false;
  for (const i of best) {
    const candidate = candidates[i]!;
    for (const cell of candidate.cells) {
      damageStructure(field, cell, field.structures![cell]!.hp);
      // A hole must lead into the city, not terminate against a generated ordinary house.
      for (const n of neighbors(field, cell).filter(n => inner.has(n) && !wall.has(n))) {
        if (field.structures![n]?.kind === 'building') field.structures![n] = null;
      }
    }
    groups.push(candidate.cells);
    if (plan.sector && plan.sector !== 'auto' && candidate.sector !== plan.sector) relocated = true;
  }
  if (relocated) notes.push('指定破口方位容量不足，部分采用相邻合法墙段');
  if (groups.length < plan.count) notes.push(`请求${plan.count}处破口，实际可布置${groups.length}处`);
  return { groups, notes };
}
