import type { Weapon } from './types.js';

/** V4近战性质。运行时读取机制，不按名字猜测，也不重掷已持有的装备。 */
export const MELEE_PROFILES: Record<string, {
  reach: number; accuracy: number; penetration: number; damageScale: number; parry?: number;
  closePenalty?: number; description: string;
}> = {
  sword: { reach: 1, accuracy: 1, parry: 1, penetration: 0, damageScale: 1,
    description: '剑术攻守：触及1格／1阵距，命中+1、对近战武器防御+1；缴械或失能时不能格挡' },
  axe: { reach: 1, accuracy: -1, penetration: 1, damageScale: 1,
    description: '重斧劈砍：触及1格／1阵距，保留高伤害，穿透+1、命中−1' },
  spear: { reach: 2, accuracy: 0, penetration: 0, damageScale: 1, closePenalty: -2,
    description: '长柄支援：触及2格／2阵距；距离0–1命中−2，可越过友军，不能越过墙体或存活敌方前线掩护' },
  blunt: { reach: 1, accuracy: -1, penetration: 2, damageScale: 0.8,
    description: '钝器破甲：触及1格／1阵距，穿透+2、命中−1；原始伤害上限×0.8，专攻重甲' },
};

export function meleeProfile(weapon?: Weapon) {
  if (!weapon || weapon.tags?.includes('ranged')) return undefined;
  const mechanism = weapon.recipe?.mechanism ?? weapon.tags?.find(t => t.startsWith('mechanism:'))?.slice(10);
  return mechanism ? MELEE_PROFILES[mechanism] : undefined;
}

/** 空间投影保持幂等；普通武器至少触及相邻位置，长柄获得第二格/阵位。 */
export function meleeReach(weapon?: Weapon): number {
  return weapon ? Math.max(1, weapon.range ?? 0, meleeProfile(weapon)?.reach ?? 1) : 0;
}

export function formationWeaponRange(weapon?: Weapon): number {
  return weapon?.tags?.includes('ranged') ? weapon.range ?? 3 : meleeReach(weapon);
}
