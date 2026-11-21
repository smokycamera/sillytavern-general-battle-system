import { baseBody, isVehicleBody } from './vehicle-size.js';
import { revisedLoad } from './load-model.js';
import { armorWearLabel } from './armor-wear.js';
import { gradedNumbers } from './numeric-model.js';
import { loadMovementScale, loadInitiativePenalty, weaponLoadCrew } from './equipment-load.js';
import { displayNumber } from './display-number.js';
import { formatDisplayText } from './display-text.js';
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
export function equipmentLoadLabel(unit: BurdenUnit, text = formatDisplayText): string {
  const load = equipmentLoad(unit), capacity = isArmsV2(unit.armsModel) || revisedLoad(unit) ? equipmentCapacity({...unit,level:unit.level!}) : BODY[unit.body ?? 'human'].capacity, burden = equipmentBurden(unit);
  const vehicle = isVehicleBody(unit.body) && revisedLoad(unit);
  const loadLabel = text('{label} {load}/{capacity}（{percent}%）', {label:text(vehicle && unit.scale === 'hero' ? '单车负重' : '负重'),
    load:displayNumber(load), capacity:displayNumber(capacity), percent:Math.round(load/capacity*100)});
  const overload = burden === 2 ? text('、命中和闪避−{penalty}，不能冲锋和突进', {penalty:displayNumber(overloadPenalty(unit))}) : '';
  const nextCapacity = vehicle && unit.level !== undefined && unit.level < 10
    ? text('L{level} 承载 {capacity}', {level:unit.level+1, capacity:displayNumber(equipmentCapacity({...unit,level:unit.level+1}))}) : '';
  if (gradedNumbers(unit) || revisedLoad(unit)) {
    const penalties = burden ? text('移动×{move}、先攻−{initiative}', {
      move:displayNumber(loadMovementScale(unit)), initiative:displayNumber(loadInitiativePenalty(unit)),
    }) + overload : text('无负担');
    const crew = [unit.weapon,unit.sidearm].some(weapon => weaponLoadCrew(unit,weapon) > 1) ? text('班组武器负载按操作人数分摊') : '';
    return [loadLabel, penalties, armorWearLabel(unit, text), crew, nextCapacity].filter(Boolean).join(' · ');
  }
  return loadLabel + (burden === 2 ? ' · '+text('超载：移动−2、先攻−4')+overload : burden === 1 ? ' · '+text('重载：移动−1、先攻−2') : '');
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
  const height = (unit: Combatant) => Math.max(unit.mount ? 2 : 1, { human: 1, large: 2, vehicle: 2, giant: 3 }[baseBody(unit.body)]);
  return !combatHostile(attacker,ally,units) && height(attacker) > height(ally);
}
export function bodyMovement(unit: Combatant): number {
  const body = unit.body ?? 'human';
  // V29 uses the load ratio; historical vehicle rules retain their fixed heavy-load step.
  return (unit.speedTier ?? BODY[body].movement) - Number(isVehicleBody(body) && !revisedLoad(unit) && ((!gradedNumbers(unit) && armorBurdenTier(unit) >= 3) || [unit.weapon, unit.sidearm].some((w) => (w?.load ?? 0) >= 6)));
}
export function effectiveProtection(unit: Combatant, channel: DamageChannel): number {
  return Math.max(bodyProtection(unit, channel), unit.armor?.protection?.[channel] ?? unit.armor?.tier ?? 0);
}
