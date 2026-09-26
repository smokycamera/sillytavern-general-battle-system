import { bonusSteps } from '../enhancements.js';
import type { Weapon } from '../types.js';
import { meleeReach } from '../melee.js';

/** 格子与会战阵位使用不同空间尺度。旧实物直接按机制投影，无需重掷或改写库存。 */
const GRID_RANGES: Record<string, number> = {
  throwing:4,'heavy-rifle':11,
  bow: 7, firearm: 7, rifle: 9, energy: 9, magic: 7, cannon: 12, 'indirect-cannon': 12, autocannon: 10,
};
export function gridWeaponRange(weapon?: Weapon, modernMelee = true): number {
  if (!weapon) return 0;
  if (!weapon.tags?.includes('ranged')) return modernMelee ? meleeReach(weapon) : Math.max(1, weapon.range ?? 0);
  return Math.max(weapon.range ?? 3, (GRID_RANGES[weapon.recipe?.mechanism ?? ''] ?? 0) + bonusSteps(weapon.recipe?.bonuses,'range',5));
}
export function gridWeapon(weapon?: Weapon, modernMelee = true): Weapon | undefined {
  return weapon ? { ...weapon, range: gridWeaponRange(weapon, modernMelee) } : undefined;
}
