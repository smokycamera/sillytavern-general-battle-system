import { revisedLoad } from './load-model.js';
import { gradedNumbers } from './numeric-model.js';
import { loadMovementScale, loadInitiativePenalty, weaponLoadCrew } from './equipment-load.js';
import { displayNumber } from './display-number.js';
export { hasNaturalArmor, equipmentLoad, humanEncumbered, equipmentCapacity, equipmentBurden, overloadPenalty } from './equipment-load.js';
import { hasNaturalArmor, equipmentLoad, equipmentCapacity, equipmentBurden, overloadPenalty, type BurdenUnit } from './equipment-load.js';
import { isArmsV2 } from './arms-model.js';
import { combatHostile } from './battle-control.js';
import type { BodyKind, Combatant, DamageChannel } from './types.js';

import { BODY } from './data/bodies.js';
export { BODY, bodyProfile } from './data/bodies.js';
/** 产生护甲减益（重甲先攻与移动惩罚、载具重装减速）的护甲档位；天生护甲没有这些减益。轻装前提与防护仍按实际档位。 */
export function armorBurdenTier(unit: Pick<Combatant, 'armor'> & Partial<Pick<Combatant, 'rulesVersion' | 'traits' | 'traitSources'>>): number {
  return hasNaturalArmor(unit) ? 0 : unit.armor?.tier ?? 0;
}
export function equipmentLoadLabel(unit: BurdenUnit): string {
  const load = equipmentLoad(unit), capacity = isArmsV2(unit.armsModel) || revisedLoad(unit) ? equipmentCapacity({...unit,level:unit.level!}) : BODY[unit.body ?? 'human'].capacity, burden = equipmentBurden(unit);
  if (gradedNumbers(unit) || revisedLoad(unit)) return '负重 '+displayNumber(load)+'/'+displayNumber(capacity)+'（'+Math.round(load/capacity*100)+'%）' + (burden ? ' · 移动×'+displayNumber(loadMovementScale(unit))+'、先攻−'+displayNumber(loadInitiativePenalty(unit))+(burden === 2 ? '、命中和闪避−'+displayNumber(overloadPenalty(unit))+'，不能冲锋和突进' : '') : ' · 无负担') + ([unit.weapon,unit.sidearm].some(weapon => weaponLoadCrew(unit,weapon) > 1) ? ' · 班组武器负载按操作人数分摊' : '');
  return '负重 '+displayNumber(load)+'/'+displayNumber(capacity)+'（'+Math.round(load/capacity*100)+'%）' + (burden === 2 ? ' · 超载：移动−2、先攻−4、命中和闪避−'+displayNumber(overloadPenalty(unit))+'，不能冲锋和突进' : burden === 1 ? ' · 重载：移动−1、先攻−2' : '');
}
export function bodyProtection(unit: Combatant, channel: DamageChannel): number {
  return unit.rulesVersion === 'v2' ? BODY[unit.body ?? 'human'].protection[channel] : 0;
}
export function physicalTraitIds(unit: Combatant): string[] {
  if (unit.rulesVersion !== 'v2') return [];
  return unit.body === 'giant' ? ['large', 'titan'] : unit.body === 'large' ? ['large'] : [];
}
/** 直射高度只比较实际体型；载具按大型，骑乘至少大型，不改变践踏、生命或负重。 */
export function canShootOverAlly(attacker: Combatant, ally: Combatant, units: readonly Combatant[] = [attacker,ally]): boolean {
  const height = (unit: Combatant) => Math.max(unit.mount ? 2 : 1, { human: 1, large: 2, vehicle: 2, giant: 3 }[unit.body ?? 'human']);
  return !combatHostile(attacker,ally,units) && height(attacker) > height(ally);
}
export function bodyMovement(unit: Combatant): number {
  const body = unit.body ?? 'human';
  // V29 uses the load ratio; historical vehicle rules retain their fixed heavy-load step.
  return (unit.speedTier ?? BODY[body].movement) - Number(body === 'vehicle' && !revisedLoad(unit) && ((!gradedNumbers(unit) && armorBurdenTier(unit) >= 3) || [unit.weapon, unit.sidearm].some((w) => (w?.load ?? 0) >= 6)));
}
export function effectiveProtection(unit: Combatant, channel: DamageChannel): number {
  return Math.max(bodyProtection(unit, channel), unit.armor?.protection?.[channel] ?? unit.armor?.tier ?? 0);
}
