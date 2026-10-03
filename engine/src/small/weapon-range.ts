import { bonusSteps } from '../enhancements.js';
import type { Combatant, Weapon } from '../types.js';
import { meleeReach } from '../melee.js';
import { isArmsModel } from '../arms.js';

/** 格子与会战阵位使用不同空间尺度。旧实物直接按机制投影，无需重掷或改写库存。 */
const GRID_RANGES: Record<string, number> = {
  throwing:4,'heavy-rifle':11,
  bow: 7, firearm: 7, rifle: 9, energy: 9, magic: 7, cannon: 12, 'indirect-cannon': 12, autocannon: 10,
};
/** V12: pistols, slings and hand crossbows reach as far as thrown weapons; frozen battles keep 2 cells. */
const ARMS_GRID_RANGES: Record<string, number> = { ...GRID_RANGES, 'light-ranged': 4 };
export function gridWeaponRange(weapon?: Weapon, modernMelee = true, armsModel?: Combatant['armsModel']): number {
  if (!weapon) return 0;
  if (!weapon.tags?.includes('ranged')) return modernMelee ? meleeReach(weapon) : Math.max(1, weapon.range ?? 0);
  const ranges = isArmsModel(armsModel) ? ARMS_GRID_RANGES : GRID_RANGES;
  return Math.max(weapon.range ?? 3, (ranges[weapon.recipe?.mechanism ?? ''] ?? 0) + bonusSteps(weapon.recipe?.bonuses,'range',5));
}
export function gridWeapon(weapon?: Weapon, modernMelee = true, armsModel?: Combatant['armsModel']): Weapon | undefined {
  return weapon ? { ...weapon, range: gridWeaponRange(weapon, modernMelee, armsModel) } : undefined;
}
