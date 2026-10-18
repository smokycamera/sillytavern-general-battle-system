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
export type BurdenUnit = EquippedLoad & Pick<Combatant,'body'|'rulesVersion'> & Partial<Pick<Combatant,'level'|'armsModel'>>;
export function equipmentCapacity(unit: Pick<Combatant,'body'|'level'>): number {
  return unit.body === 'vehicle' ? 24 : {human:10,large:14,giant:20,vehicle:24}[unit.body ?? 'human'] + Math.floor(.8*unit.level);
}
export function equipmentBurden(unit: BurdenUnit): number {
  if (!isArmsV2(unit.armsModel)) return Number(humanEncumbered(unit));
  const capacity = equipmentCapacity({body:unit.body,level:unit.level!}), load = equipmentLoad(unit);
  return load>capacity ? 2 : load>capacity*.8 ? 1 : 0;
}
export function overloadPenalty(unit: BurdenUnit): number {
  return equipmentBurden(unit) === 2 ? Math.min(5,Math.ceil((equipmentLoad(unit)-equipmentCapacity({body:unit.body,level:unit.level!}))/equipmentCapacity({body:unit.body,level:unit.level!})*10)) : 0;
}
