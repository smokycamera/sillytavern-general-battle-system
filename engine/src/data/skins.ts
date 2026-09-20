/**
 * 时代皮肤：术语映射层，机制零差异。
 * 换皮只改面板与注入文案的词汇，引擎数值不变。
 * 武器数值差异化由 weaponIds → 武器原型库（data/weapons.ts）承载：术语与数值同源。
 */

import type { WeaponProfile } from './weapons.js';

export interface Skin {
  id: string;
  name: string;
  /** 原型 → 该时代的名称 */
  archetypes: { infantry: string; ranged: string; mobile: string };
  /** 默认武器名（按原型）——纯展示；数值默认位见 weaponIds */
  weapons: { infantry: string; ranged: string; mobile: string };
  /** 机动单位的远程武器名（骑射手用） */
  mountedRangedWeapon: string;
  /** 四个武器位的默认原型 id（近战步兵 / 射手 / 机动近战 / 机动远程） */
  weaponIds: {
    infantry: string;
    ranged: string;
    mobile: string;
    mountedRanged: string;
  };
  /** 近战副武器默认原型 id——仅作兜底：spawn 声明了 weapon2 但种类猜不出时按时代取位。
   *  不自动配发：没声明 weapon2 的单位一律无副武器。 */
  sidearmId: string;
  /** 三个原型位的默认护甲 id（步兵 / 远程 / 机动） */
  armorIds: {
    infantry: string;
    ranged: string;
    mobile: string;
  };
  /** 伤害措辞（结算卡/注入叙述词汇） */
  words: {
    hit: string;
    miss: string;
    volley: string;
    charge: string;
    break: string;
    flank: string;
  };
}

export const SKINS: Record<string, Skin> = {
  medieval: {
    id: 'medieval',
    name: '冷兵器时代',
    archetypes: { infantry: '步兵', ranged: '弓弩手', mobile: '骑兵' },
    weapons: { infantry: '长剑', ranged: '长弓', mobile: '骑枪' },
    mountedRangedWeapon: '骑弓',
    weaponIds: { infantry: 'wpn-sword', ranged: 'wpn-bow', mobile: 'wpn-lance', mountedRanged: 'wpn-horsebow' },
    sidearmId: 'wpn-sword',
    armorIds: { infantry: 'arm-gambeson', ranged: 'arm-gambeson', mobile: 'arm-gambeson' }, // 默认位 1.0 基准保持兼容；板甲/锁甲经 armorId 显式引用
    words: { hit: '劈中', miss: '被格挡', volley: '箭雨', charge: '冲锋', break: '阵线崩溃', flank: '侧翼包抄' },
  },
  gunpowder: {
    id: 'gunpowder',
    name: '火药时代',
    archetypes: { infantry: '火枪兵', ranged: '炮兵', mobile: '骠骑兵' },
    weapons: { infantry: '燧发枪', ranged: '野战炮', mobile: '马刀' },
    mountedRangedWeapon: '卡宾枪',
    weaponIds: { infantry: 'wpn-saber', ranged: 'wpn-fieldgun', mobile: 'wpn-saber', mountedRanged: 'wpn-carbine' },
    sidearmId: 'wpn-saber',
    armorIds: { infantry: 'arm-uniform', ranged: 'arm-uniform', mobile: 'arm-cuirass' },
    words: { hit: '命中', miss: '打偏', volley: '排枪齐射', charge: '骑袭', break: '战线瓦解', flank: '迂回' },
  },
  modern: {
    id: 'modern',
    name: '现代战争',
    archetypes: { infantry: '步兵班', ranged: '火力支援组', mobile: '装甲车' },
    weapons: { infantry: '突击步枪', ranged: '迫击炮', mobile: '车载机枪' },
    mountedRangedWeapon: '车载机炮',
    weaponIds: { infantry: 'wpn-ar', ranged: 'wpn-mortar', mobile: 'wpn-vmg', mountedRanged: 'wpn-vmc' },
    sidearmId: 'wpn-entrench',
    armorIds: { infantry: 'arm-vest', ranged: 'arm-vest', mobile: 'arm-heavy-vest' },
    words: { hit: '命中', miss: '脱靶', volley: '弹幕覆盖', charge: '突击', break: '防线失守', flank: '侧翼穿插' },
  },
  scifi: {
    id: 'scifi',
    name: '星际战争',
    archetypes: { infantry: '陆战装甲兵', ranged: '轨道炮台', mobile: '悬浮摩托' },
    weapons: { infantry: '等离子步枪', ranged: '轨道炮', mobile: '脉冲炮' },
    mountedRangedWeapon: '悬浮脉冲炮',
    weaponIds: { infantry: 'wpn-plasma', ranged: 'wpn-railgun', mobile: 'wpn-pulse', mountedRanged: 'wpn-hoverpulse' },
    sidearmId: 'wpn-chainsword',
    armorIds: { infantry: 'arm-composite', ranged: 'arm-composite', mobile: 'arm-power' },
    words: { hit: '击穿', miss: '被力场偏折', volley: '轨道打击', charge: '超频突进', break: '护盾矩阵过载', flank: '矢量包抄' },
  },
};

/** 按皮肤 + 原型 + 武器风格取默认武器位 id（骑射=机动+远程） */
export function defaultWeaponId(skin: Skin, archetype: string, loadout: 'melee' | 'ranged'): string {
  if (loadout === 'ranged') {
    return archetype === 'mobile' ? skin.weaponIds.mountedRanged : skin.weaponIds.ranged;
  }
  return skin.weaponIds[archetype as keyof Skin['weaponIds']] ?? skin.weaponIds.infantry;
}

export function getSkin(id?: string): Skin {
  return SKINS[id ?? 'medieval'] ?? SKINS.medieval!;
}
