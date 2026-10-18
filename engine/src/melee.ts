import type { Weapon } from './types.js';

/** V4近战性质。运行时读取机制，不按名字猜测，也不重掷已持有的装备。 */
export const MELEE_PROFILES: Record<string, {
  reach: number; accuracy: number; penetration: number; damageScale: number; parry?: number;
  /** closePenalty applies to frozen pre-V12 battles; armsClosePenalty to V12 (arms-v1) battles. */
  closePenalty?: number; armsClosePenalty?: number; description: string;
}> = {
  greatsword: { reach: 1, accuracy: 0, parry: 1, penetration: 0, damageScale: 1, description: '双手破阵：格挡+1，拒止攻击命中−4' },
  dagger: { reach: 1, accuracy: 1, penetration: -1, damageScale: 1, description: '两段快刺：命中+1，暴击19起' },
  'great-weapon': { reach: 1, accuracy: -1, penetration: 1, damageScale: 1, description: '双手重击：命中−1，穿透+1，无视实体盾' },
  'heavy-polearm': { reach: 2, accuracy: 0, penetration: 1, damageScale: 1, description: '重型长柄：触及2，穿透+1，拒止与钩拽' },
  sword: { reach: 1, accuracy: 1, parry: 1, penetration: 0, damageScale: 1,
    description: '剑术攻守：命中+1，对近战防御+1' },
  axe: { reach: 1, accuracy: -1, penetration: 1, damageScale: 1,
    description: '重斧劈砍：穿透+1，命中−1' },
  spear: { reach: 2, accuracy: 0, penetration: 0, damageScale: 1, closePenalty: -2, armsClosePenalty: -1,
    description: '长柄支援：触及2格，可越过友军，贴身命中−1' },
  blunt: { reach: 1, accuracy: -1, penetration: 2, damageScale: 0.8,
    description: '钝器破甲：穿透+2，命中−1，伤害×0.8' },
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
