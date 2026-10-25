import type { Combatant } from '../types.js';
import { isAirborne } from '../aerial.js';
import { canClimbFrom, groundBlocked, intactStructure, isElevated, STRUCTURE_NAMES } from './layers.js';
import { canOccupy, movementStepCost, movementNeighbors, gridDistance, cellLabel, TERRAIN_NAMES, type BattlefieldSpec } from './spatial.js';
import { GridQueue } from './grid-queue.js';

export type IntentLayer = 'ground' | 'platform';
export interface IntentPlace { cell: number; layer: IntentLayer }
export interface IntentStep extends IntentPlace { kind: 'move' | 'open' | 'climb'; cost: number }

/** A goal describes the destination layer, independently of the unit's current layer. */
export function intentPlace(field: BattlefieldSpec, unit: Combatant, cell: number, layer?: IntentLayer): IntentPlace | undefined {
  if (!Number.isSafeInteger(cell) || cell < 0 || cell >= field.tiles.length) return;
  const grounded = { ...unit, airborne: false, elevation: undefined };
  const door = intactStructure(field, cell);
  // An openable doorway is a ground destination even while its door is closed.
  const resolved = layer ?? (groundBlocked(field, cell, grounded) && door?.kind !== 'gate' && door?.top ? 'platform' : 'ground');
  const actor = { ...unit, elevation: resolved === 'platform' ? 1 as const : undefined };
  if (groundBlocked(field, cell, actor) && !(resolved === 'ground' && !isAirborne(unit) && door?.kind === 'gate')) return;
  return { cell, layer: resolved };
}

/** Weighted, layered graph. Special edges describe real engine actions, not teleports.
 * Rebuilt from observed occupants after movement/actions; no route or hidden unit is saved. */
export function findIntentRoute(field: BattlefieldSpec, unit: Combatant, known: Combatant[], goal: (actor: Combatant) => boolean,
  canOpen: (actor: Combatant, cell: number) => boolean, actionCost: number, climbCost: number, tags = field.environment ?? [], blocked = new Set<number>(), distance?: (actor: Combatant) => number,
  unreachable?: (reachable: Combatant[]) => void): IntentStep[] | undefined {
  const count = field.tiles.length, key = (cell: number, elevated: boolean) => cell + (elevated ? count : 0);
  const start = key(unit.pos!, isElevated(unit));
  const actorAt = (node: number): Combatant => ({ ...unit, pos: node % count, elevation: node >= count ? 1 : undefined });
  const costs = new Map([[start, 0]]), previous = new Map<number, { node: number; step: IntentStep }>(), open = new GridQueue();
  let closest = start, closestDistance = distance?.(unit) ?? Infinity;
  const routeTo = (end: number) => {
    const steps: IntentStep[] = []; let node = end;
    while (node !== start) { const p = previous.get(node)!; steps.unshift(p.step); node = p.node; }
    return steps;
  };
  const opened = new Map<number, BattlefieldSpec>();
  const withOpenDoor = (cell: number) => {
    if (!opened.has(cell)) {
      const structures = [...field.structures!]; structures[cell] = { ...structures[cell]!, gateState: 'open' };
      opened.set(cell, { ...field, structures });
    }
    return opened.get(cell)!;
  };
  open.push(start, 0);
  while (open.size) {
    const entry = open.pop()!, actor = actorAt(entry.cell);
    if (entry.cost !== costs.get(entry.cell)) continue;
    if (goal(actor)) return routeTo(entry.cell);
    const remaining = distance?.(actor) ?? Infinity;
    if (remaining < closestDistance) { closest = entry.cell; closestDistance = remaining; }
    const offer = (cell: number, elevated: boolean, kind: IntentStep['kind'], cost: number) => {
      const node = key(cell, elevated), total = entry.cost + cost;
      if (blocked.has(node) || !Number.isFinite(cost) || total >= (costs.get(node) ?? Infinity)) return;
      costs.set(node, total); previous.set(node, { node: entry.cell, step: { cell, layer: elevated ? 'platform' : 'ground', kind, cost } }); open.push(node, total);
    };
    for (const cell of movementNeighbors(field, actor.pos!, actor)) {
      if (canOccupy(field, known, actor, cell)) offer(cell, isElevated(actor), 'move', movementStepCost(field, cell, actor, tags, actor.pos));
      else if (!isElevated(actor) && !isAirborne(actor) && intactStructure(field, cell)?.gateState === 'closed' && canOpen(actor, cell)) {
        const openedField = withOpenDoor(cell);
        if (canOccupy(openedField, known, actor, cell)) offer(cell, false, 'open', actionCost + movementStepCost(openedField, cell, actor, tags, actor.pos));
      }
      if (field.layerVersion && canClimbFrom(field, actor, cell)) {
        const arrival = { ...actor, elevation: isElevated(actor) ? undefined : 1 as const };
        if (canOccupy(field, known, arrival, cell)) offer(cell, !isElevated(actor), 'climb', actionCost + climbCost);
      }
    }
  }
  // Approach an obstructed destination without replacing it with a regional objective.
  unreachable?.([...costs.keys()].map(actorAt));
  if (distance) return routeTo(closest);
}

/** Explain only observed obstructions along the reachable frontier; hidden occupants never enter the report. */
export function intentRouteFailure(field: BattlefieldSpec, unit: Combatant, known: Combatant[], reachable: Combatant[], toward: number | undefined,
  visible: readonly boolean[], canOpen: (actor: Combatant, cell: number) => boolean): string {
  const obstacles = new Map<number, string>();
  for (const actor of reachable) for (const cell of movementNeighbors(field, actor.pos!, actor)) {
    if (!visible[cell] || canOccupy(field, known, actor, cell) && Number.isFinite(movementStepCost(field, cell, actor, field.environment, actor.pos))) continue;
    const structure = intactStructure(field, cell);
    if (structure?.kind === 'gate' && structure.gateState === 'closed' && canOpen(actor, cell)) continue;
    const occupant = known.find(u => u.id !== unit.id && u.pos === cell && ['ready', 'routing'].includes(u.status) && isElevated(u) === isElevated(actor));
    const reason = occupant ? '单位占位（' + occupant.name + '）' : structure && groundBlocked(field, cell, actor)
      ? isElevated(actor) && !structure.top ? STRUCTURE_NAMES[structure.kind] + '没有可通行墙顶'
        : structure.kind === 'gate' ? '关闭且当前无法打开的城门' : STRUCTURE_NAMES[structure.kind]
      : !Number.isFinite(movementStepCost(field, cell, actor, field.environment, actor.pos)) && !groundBlocked(field, cell, actor) ? '缺少可通行的高度连接'
      : TERRAIN_NAMES[field.tiles[cell]!] + '不适合本单位通行';
    obstacles.set(cell, cellLabel(field, cell) + reason);
  }
  const cells = [...obstacles.keys()].sort((a, b) => (toward === undefined ? 0 : gridDistance(field, a, toward) - gridDistance(field, b, toward)) || a - b).slice(0, 3);
  return cells.length ? '当前没有可通行路线；可见阻碍：' + cells.map(c => obstacles.get(c)).join('、') : '当前没有可通行路线，尚不能从已知信息确定堵点';
}
