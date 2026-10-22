import { gradedNumbers } from './numeric-model.js';
import { isArmsV2 } from './arms-model.js';
import type { Combatant } from './types.js';
export type EquippedLoad = Pick<Combatant, 'weapon' | 'sidearm' | 'armor' | 'shield' | 'accessories'> & Partial<Pick<Combatant, 'rulesVersion' | 'traits' | 'traitSources' | 'gear'>>;
/** 天生护甲（炼体、兽皮、鳞片、甲壳）：护甲就是身体，只看本身特质与仍有效的来源，装备授予不算。 */
export function hasNaturalArmor(unit: Partial<Pick<Combatant, 'rulesVersion' | 'traits' | 'traitSources'>>): boolean {
  return unit.rulesVersion === 'v2' && (!!unit.traits?.includes('natural-armor') || !!unit.traitSources?.some((s) => !s.revoked && s.kind !== 'equipment'
    && s.traitIds.includes('natural-armor') && (s.duration.kind === 'permanent' || (s.remaining ?? 0) > 0)));
}
/** 主副武器、护甲、盾和两个配件共同占用身体容量。 */
export function equipmentLoad(unit: EquippedLoad): number {
  return (unit.weapon?.load ?? 0) + (unit.sidearm?.load ?? 0) + (hasNaturalArmor(unit) ? 0 : unit.armor?.load ?? 0) + (unit.shield?.load ?? 0)
    + Object.values(unit.accessories ?? {}).reduce((sum, item) => sum + (item?.load ?? 0), 0) + (unit.gear ?? []).reduce((sum, item) => sum + item.load, 0);
}
/** 实时从实际配装推导，卸装/改变身体后不残留状态，也不改写基础属性。 */
export function humanEncumbered(unit: EquippedLoad & Pick<Combatant, 'body' | 'rulesVersion'>): boolean {
  return unit.rulesVersion === 'v2' && (unit.body ?? 'human') === 'human' && equipmentLoad(unit) >= 12;
}
export type BurdenUnit = EquippedLoad & Pick<Combatant,'body'|'rulesVersion'> & Partial<Pick<Combatant,'level'|'armsModel'|'numericModel'>>;
export const HUMAN_CAPACITY = [5,8,9,12,14,18,24,32,44,60] as const;
export function equipmentCapacity(unit: Pick<Combatant,'body'|'level'> & Partial<Pick<Combatant,'numericModel'>>): number {
  if (gradedNumbers(unit) && unit.body !== 'vehicle') return HUMAN_CAPACITY[unit.level - 1]! * (unit.body === 'giant' ? 2 : unit.body === 'large' ? 1.4 : 1);
  return unit.body === 'vehicle' ? 24 : {human:10,large:14,giant:20,vehicle:24}[unit.body ?? 'human'] + Math.floor(.8*unit.level);
}
export function equipmentBurden(unit: BurdenUnit): number {
  if (!isArmsV2(unit.armsModel)) return Number(humanEncumbered(unit));
  const capacity = equipmentCapacity({...unit,level:unit.level!}), load = equipmentLoad(unit);
  return load>capacity ? 2 : load>capacity*.8 ? 1 : 0;
}
export function overloadPenalty(unit: BurdenUnit): number {
  if (gradedNumbers(unit)) return 10 * Math.max(0, loadRatio(unit) - 1);
  return equipmentBurden(unit) === 2 ? Math.min(5,Math.ceil((equipmentLoad(unit)-equipmentCapacity({...unit,level:unit.level!}))/equipmentCapacity({...unit,level:unit.level!})*10)) : 0;
}

export function loadRatio(unit: BurdenUnit): number { return equipmentLoad(unit) / equipmentCapacity({...unit,level:unit.level!}); }
export function loadMovementScale(unit: BurdenUnit): number {
  const ratio = loadRatio(unit);
  return ratio <= .8 ? 1 : ratio <= 1 ? 1 - 1.5 * (ratio - .8) : .7 / ratio ** 2;
}
export function loadInitiativePenalty(unit: BurdenUnit): number {
  return gradedNumbers(unit) ? 10 * Math.max(0, loadRatio(unit) - .8) : 2 * equipmentBurden(unit);
}
