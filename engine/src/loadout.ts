import { activeTraitIds, activeConditionIds } from './trait-sources.js';
import type { Combatant, Weapon } from './types.js';

export function isRangedWeapon(weapon?: Weapon): boolean { return !!weapon?.tags?.includes('ranged'); }
/** 按实际机制识别火炮，兼容旧装备标签；显示名不改变遮挡规则。 */
export function isCannonWeapon(weapon?: Weapon): boolean {
  return ['cannon', 'indirect-cannon'].includes(weapon?.recipe?.mechanism ?? weapon?.tags?.find(tag => tag.startsWith('mechanism:'))?.slice(10) ?? '');
}
/** 主槽保留旧存档键；副槽独立计时，按 id 比较兼容预览中的武器副本。 */
export function weaponReloadKey(unit: Pick<Combatant, 'id' | 'sidearm'>, weapon?: Weapon): string {
  return weapon && unit.sidearm?.id === weapon.id ? JSON.stringify([unit.id, 'sidearm']) : unit.id;
}
/** 旧 v2 火枪缺省装填一回合；显式 reload=0 仍受尊重。 */
export function weaponReloadTurns(weapon?: Weapon): number {
  return weapon?.reload ?? (weapon?.recipe?.mechanism === 'firearm' ? 1 : 0);
}
/** 近战只能来自真实近战武器，副槽不等于近战，也不能把炮管当剑。 */
export function meleeWeapon(unit: Pick<Combatant, 'weapon' | 'sidearm'>): Weapon | undefined {
  return [unit.weapon, unit.sidearm].find((weapon) => weapon && !isRangedWeapon(weapon));
}
/** 骑乘是显式长期配置；没有坐骑时，骑射标签不制造物理平台。 */
export function validateMount(unit: Pick<Combatant, 'mount' | 'body' | 'speedTier'>): void {
  if (unit.speedTier !== undefined && (!Number.isSafeInteger(unit.speedTier) || unit.speedTier < 1 || unit.speedTier > 5)) throw new Error('速度档位必须为1–5整数');
  if (unit.body !== undefined && !['human', 'large', 'vehicle', 'giant'].includes(unit.body)) throw new Error('身体配置损坏');
  if (unit.mount !== undefined && typeof unit.mount !== 'boolean') throw new Error('骑乘配置需要布尔值');
}
export function mountedShooting(unit: Combatant, weapon?: Weapon): boolean {
  return unit.rulesVersion === 'v2' && unit.mount === true
    && activeTraitIds(unit).includes('mounted-archer') && !unit.airborne && !unit.suppression
    && !activeConditionIds(unit).some((id) => ['slowed', 'stunned', 'restrained'].includes(id))
    && (weapon ? mobileRangedWeapon(weapon) : [unit.weapon, unit.sidearm].some(mobileRangedWeapon));
}
export function mobileRangedWeapon(weapon?: Weapon): boolean {
  return isRangedWeapon(weapon) && (weapon?.load ?? 99) <= 2 && !weaponReloadTurns(weapon);
}
export function vehicleShooting(unit: Combatant, weapon?: Weapon): boolean {
  return unit.rulesVersion === 'v2' && unit.body === 'vehicle' && !unit.airborne && !unit.suppression
    && (weapon ? !!weapon.recipe?.stabilized && isRangedWeapon(weapon) : [unit.weapon, unit.sidearm].some((w) => !!w?.recipe?.stabilized && isRangedWeapon(w)));
}
export function steadyMovingShot(unit: Combatant, weapon?: Weapon): boolean {
  return mountedShooting(unit, weapon) || vehicleShooting(unit, weapon);
}
