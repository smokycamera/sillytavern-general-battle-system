import { flightCapabilityReason } from '../aerial.js';
import { SeededRng } from '../rng.js';
import type { Combatant } from '../types.js';
import type { BattlefieldPlan } from './battlefield-plan.js';
import { regionCells } from './region-layout.js';
import { groundBlocked, terrainExposure, waterOnly } from './layers.js';
import { gridDeploymentCells, gridDistance, neighbors, type BattlefieldSpec } from './spatial.js';

/** Lay down the open medium around the actual structures and named places. */
export function paintOceanSpace(field: BattlefieldSpec, plan: BattlefieldPlan | undefined, seed: string): void {
  const space = field.environment!.includes('cosmos');
  const rng = new SeededRng('ocean-space:' + seed);
  const land = new Set(regionCells(field,plan?.land ?? []));
  if (!space && !plan?.land && !plan?.waterSectors && plan?.waterCoverage !== 'all' && rng.next() < .7) {
    const island = rng.d(field.tiles.length) - 1;
    land.add(island);
    for (const p of neighbors(field,island)) if (rng.next() < .6) land.add(p);
  }
  for (const mark of field.landmarks ?? []) for (const cell of mark.cells) land.add(cell);
  const water = new Set(regionCells(field,plan?.waterSectors ?? []));
  const shallow = new Set(regionCells(field,plan?.waterShallowSectors ?? []));
  for (let cell = 0; cell < field.tiles.length; cell++) {
    if (land.has(cell) || field.structures?.[cell] || field.overlays?.[cell]?.length) continue;
    if (space) field.tiles[cell] = 'vacuum';
    else if (!water.size || water.has(cell)) field.tiles[cell] = shallow.has(cell) || (!plan?.waterDepth || plan.waterDepth === 'mixed') && neighbors(field,cell).some(p => land.has(p)) ? 'shallow_water' : 'deep_water';
  }
  if (!space) {
    field.generation!.waterCoverage = field.tiles.every(t => t === 'deep_water' || t === 'shallow_water') ? 'all' : 'regions';
    return;
  }
  const sectors = plan?.asteroids ?? (rng.next() < .5 ? ['A2','C3'] as const : ['B2','D3'] as const);
  for (const sector of sectors) {
    const cells = regionCells(field,[sector]).filter(p => field.tiles[p] === 'vacuum' && p !== field.objective.cell);
    if (cells.length) field.tiles[cells[Math.floor(rng.next() * cells.length)]!] = 'cliff';
  }
}

/** Generated deployment may need dry deck space inside a specific side's or unit's sector. */
export function reserveSafeStarts(field: BattlefieldSpec, roster: readonly Combatant[]): void {
  const reserved = new Set<number>();
  const medium = field.tiles.findIndex(t => t === 'vacuum' || t === 'deep_water');
  if (medium < 0) return;
  for (const unit of roster) {
    if (unit.ride || unit.hp <= 0 || unit.status !== 'ready' || waterOnly(unit)) continue;
    const actor = {...unit, airborne:unit.airborne ?? !flightCapabilityReason(unit), pos:undefined};
    if (!terrainExposure(field,medium,actor)) continue;
    const candidates = gridDeploymentCells(field,actor).filter(p => !reserved.has(p));
    const origin = unit.pos ?? candidates[Math.floor(candidates.length / 2)];
    if (origin === undefined) continue;
    const order = candidates.sort((a,b) => gridDistance(field,a,origin) - gridDistance(field,b,origin) || a-b);
    const safe = order.find(p => !terrainExposure(field,p,actor) && !groundBlocked(field,p,actor));
    const cell = safe ?? order.find(p => terrainExposure(field,p,actor));
    if (cell === undefined) continue;
    reserved.add(cell);
    if (safe === undefined) field.tiles[cell] = 'open';
  }
}
