import { isIndirectCannonWeapon } from './loadout.js';
import type { Combatant, ConditionDef, Weapon } from './types.js';
import { activeTraitIds, activeConditionIds } from './trait-sources.js';
import { standardConditionMap } from './conditions.js';
const defaultConditions = standardConditionMap();
export type FlightConditions = Pick<ReadonlyMap<string, ConditionDef>, 'get'>;
export function isAirborne(unit: Combatant): boolean { return unit.rulesVersion === 'v2' && unit.airborne === true; }
export function sameLayer(a: Combatant, b: Combatant): boolean { return isAirborne(a) === isAirborne(b) && (isAirborne(a) || (a.elevation ?? 0) === (b.elevation ?? 0)); }
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
export type AerialRangeSpace = 'small' | 'mass';
export const GROUND_TO_AIR_RANGE_COST = { small: 2, mass: 1 } as const;
/** 仅用于远程选敌的射程预算，不改变移动、接敌、视线或范围效果半径。 */
export function groundToAirRangePenalty(actor: Combatant, target: Combatant, space: AerialRangeSpace = 'small'): number {
  return !isAirborne(actor) && isAirborne(target) ? GROUND_TO_AIR_RANGE_COST[space] : 0;
}
export function rangedTargetDistance(actor: Combatant, target: Combatant, distance: number, space: AerialRangeSpace = 'small'): number {
  return distance + groundToAirRangePenalty(actor, target, space);
}
export function aerialTargetReason(actor: Combatant, target: Combatant, ranged: boolean, weapon?: Weapon): string | undefined {
  if (ranged && isAirborne(target) && isIndirectCannonWeapon(weapon)) return '曲射火炮不能攻击空中目标';
  if (!ranged && !isAirborne(actor) && isAirborne(target)) return '地面近战无法攻击空中目标';
  return undefined;
}
export function fallDamage(unit: Combatant): number { return Math.min(unit.hp, Math.max(1, Math.ceil(unit.base.hpMax * 0.1))); }
export function validateFlightState(value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('空地状态损坏');
}
