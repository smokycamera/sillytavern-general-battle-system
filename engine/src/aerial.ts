import type { Combatant, ConditionDef } from './types.js';
import { activeTraitIds, activeConditionIds } from './trait-sources.js';
import { standardConditionMap } from './conditions.js';
const defaultConditions = standardConditionMap();
export type FlightConditions = Pick<ReadonlyMap<string, ConditionDef>, 'get'>;
export function isAirborne(unit: Combatant): boolean { return unit.rulesVersion === 'v2' && unit.airborne === true; }
export function sameLayer(a: Combatant, b: Combatant): boolean { return isAirborne(a) === isAirborne(b); }
export function hasFlightAbility(unit: Combatant): boolean { return unit.rulesVersion === 'v2' && activeTraitIds(unit).includes('flying'); }
export function flightCapabilityReason(unit: Combatant, defs: FlightConditions = defaultConditions): string | undefined {
  if (unit.status !== 'ready' || unit.hp <= 0) return '当前不能主动飞行';
  return flightMaintenanceReason(unit, defs);
}
export function flightMaintenanceReason(unit: Combatant, defs: FlightConditions = defaultConditions): string | undefined {
  if (unit.status === 'fled') return undefined;
  if (!hasFlightAbility(unit)) return '没有有效飞行来源';
  if (unit.status === 'dead' || unit.status === 'dying' || unit.hp <= 0) return '当前无法维持飞行';
  if (activeConditionIds(unit).some((id) => defs.get(id)?.skipTurn || defs.get(id)?.preventMove)) return '失能或定身，无法维持飞行';
  return undefined;
}
export function aerialTargetReason(actor: Combatant, target: Combatant, ranged: boolean): string | undefined {
  if (!ranged && !isAirborne(actor) && isAirborne(target)) return '地面近战无法攻击空中目标';
  return undefined;
}
export function fallDamage(unit: Combatant): number { return Math.min(unit.hp, Math.max(1, Math.ceil(unit.base.hpMax * 0.1))); }
export function validateFlightState(value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('空地状态损坏');
}
