import { bonusMultiplier, bonusSteps, validateEnhancements, type Enhancements } from '../enhancements.js';
import { BODY } from '../body.js';
export { BODY } from '../body.js';
/** 单位生成与独立库存物品共用的装备编译器。上下文的 seed 已包含稳定实例/槽位域。 */
import type { Armor, BodyKind, DamageChannel, ItemRecipe, Weapon } from '../types.js';
import { curveAt } from '../data/curves.js';
import { WEAPON_CLASSES, WEAPON_LIBRARY, diceAvg, rebuildDice } from '../data/weapons.js';
import { ARMOR_LIBRARY } from '../data/armors.js';
import { SeededRng } from '../rng.js';

export const FORMULA_VERSION = 'mechanism-v2.3';
const WEAPON_ALIASES: Record<string, string> = {
  'wpn-sword': 'sword', 'wpn-bow': 'bow', 'wpn-lance': 'spear', 'wpn-horsebow': 'bow', 'wpn-pike': 'spear', 'wpn-staff': 'magic',
  'wpn-saber': 'sword', 'wpn-musket': 'firearm', 'wpn-matchlock': 'firearm', 'wpn-fieldgun': 'cannon', 'wpn-stonegun': 'cannon', 'wpn-carbine': 'rifle',
  'wpn-ar': 'rifle', 'wpn-mortar': 'cannon', 'wpn-vmg': 'rifle', 'wpn-vmc': 'autocannon', 'wpn-tankgun': 'cannon', 'wpn-atgm': 'cannon', 'wpn-entrench': 'blunt',
  'wpn-plasma': 'energy', 'wpn-railgun': 'cannon', 'wpn-pulse': 'energy', 'wpn-hoverpulse': 'energy', 'wpn-lasgun': 'energy', 'wpn-bolter': 'rifle',
  'wpn-chainsword': 'sword', 'wpn-smartgun': 'rifle', 'wpn-monokatana': 'sword',
};
const ARMOR_ALIASES: Record<string, 0 | 1 | 2 | 3 | 4> = {
  'arm-gambeson': 1, 'arm-mail': 2, 'arm-plate': 3, 'arm-uniform': 0, 'arm-cuirass': 2, 'arm-vest': 2, 'arm-heavy-vest': 3,
  'arm-composite': 3, 'arm-power': 4, 'arm-flak': 2, 'arm-subdermal': 1, 'arm-arament': 4, 'arm-terminator': 4,
};
export interface EquipmentContext {
  bonuses?: Enhancements; id: string; name?: string; seed: string; body?: BodyKind; quality?: number; noVariance?: boolean;
  /** 仅建档使用：接受明确声明的装备组合，不改变战斗使用规则。 */
  creatingUnit?: boolean;
}
function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name}必须是${min}–${max}的整数`);
  return value;
}
export function equipmentRecipe(mechanism: string, power: number, context: EquipmentContext): ItemRecipe {
  const size = context.body ?? 'human';
  if (!BODY[size]) throw new Error('不支持的身体/平台');
  if (!context.id || !context.seed) throw new Error('物品缺少实例身份或种子');
  validateEnhancements(context.bonuses, mechanism.startsWith('armor:') ? 'armor' : mechanism === 'heal' ? 'consumable' : mechanism === 'shield' ? 'shield' : 'weapon');
  return { bonuses: context.bonuses, version: FORMULA_VERSION, mechanism, power: integer(power, 1, 10, '规格P'), size,
    quality: integer(context.quality ?? 3, 1, 5, '品质Q'), seed: context.seed };
}
export function compileWeapon(spec: { mechanism?: string; weaponId?: string; power?: number; bonuses?: Enhancements; stabilized?: boolean; enchantment?: 'none' | 'thermal' | 'arcane' }, context: EquipmentContext): Weapon {
  if (spec.weaponId && !WEAPON_ALIASES[spec.weaponId]) throw new Error('未知武器 id，不能猜测回退');
  const mechanism = spec.mechanism ?? (spec.weaponId ? WEAPON_ALIASES[spec.weaponId] : undefined);
  if (!mechanism || !WEAPON_CLASSES[mechanism]) throw new Error('未知武器机制');
  if (spec.weaponId && spec.mechanism && WEAPON_ALIASES[spec.weaponId] !== spec.mechanism) throw new Error('武器 id 与机制冲突');
  const profile = spec.weaponId ? WEAPON_LIBRARY[spec.weaponId]! : WEAPON_CLASSES[mechanism]!.profile;
  const recipe = equipmentRecipe(mechanism, spec.power ?? 5, { ...context, bonuses: spec.bonuses ?? context.bonuses });
  if (mechanism === 'autocannon') recipe.version += '+autocannon-v2';
  if (spec.enchantment !== undefined && spec.enchantment !== 'none') {
    if (!['thermal', 'arcane'].includes(spec.enchantment)) throw new Error('不支持的武器附魔机制');
    recipe.enchantment = spec.enchantment;
  }
  const powerCurve = curveAt(recipe.power), ranged = profile.range > 1;
  if (spec.stabilized !== undefined && typeof spec.stabilized !== 'boolean') throw new Error('武器稳定配置损坏');
  if (spec.stabilized) {
    if (!context.creatingUnit && (recipe.size !== 'vehicle' || !ranged)) throw new Error('稳定装置需要实际载具规格的射击武器');
    recipe.stabilized = true;
  }
  const jitter = context.noVariance ? 1 : 0.97 + new SeededRng(recipe.seed).next() * 0.06;
  const budget = (diceAvg(powerCurve.dmgBase) + (powerCurve.dmgAp ? diceAvg(powerCurve.dmgAp) : 0))
    * Math.min(1.6, profile.dmgMult) * (0.85 + recipe.quality * 0.05) * (ranged ? 1 : BODY[recipe.size].strength) * jitter * (recipe.stabilized ? 0.85 : 1);
  const attacks = Math.max(1, Math.min(3, profile.attacks ?? 1));
  return { id: context.id, name: context.name?.trim() || profile.name,
    baseDice: rebuildDice(budget / attacks, budget / attacks < 3.5 ? 2 : 6), recipe,
    channel: recipe.enchantment ?? (mechanism === 'energy' ? 'thermal' : mechanism === 'magic' ? 'arcane' : 'kinetic'),
    penetration: 1 + Math.floor(recipe.power / 2) + (['cannon', 'indirect-cannon', 'demolition', 'autocannon'].includes(mechanism) ? 2 : ['firearm', 'rifle', 'energy'].includes(mechanism) ? 1 : 0),
    range: profile.range + (ranged ? bonusSteps(recipe.bonuses, 'range', 5) : 0), minRange: profile.minRange ?? 0,
    pointBlankPolicy: profile.pointBlankPolicy ?? 'allow', pointBlankPenalty: profile.pointBlankPenalty,
    indirect: profile.indirect, attacks, reload: profile.reload, level: recipe.power,
    hands: mechanism === 'light-ranged' ? 1 : ranged ? 2 : 1, load: mechanism === 'light-ranged' ? 1 : ['cannon', 'indirect-cannon', 'autocannon'].includes(mechanism) ? 6 : ranged ? 2 : 1,
    tags: [...(ranged ? ['ranged'] : []), ...(profile.blast ? ['blast'] : []), 'mechanism:' + mechanism] };
}
/** 旧长兵器改为单手；保留明确自定义值，不重掷装备。 */
export function calibrateWeaponHands(weapon?: Weapon): void {
  if (weapon && !weapon.customized && weapon.recipe?.mechanism === 'spear') weapon.hands = 1;
}
/** 机炮平衡升级按原配方/种子编译一次，保留身份、其他属性及战斗冷却。 */
export function calibrateAutocannon(weapon?: Weapon): void {
  const recipe = weapon?.recipe;
  if (!weapon || weapon.customized || recipe?.mechanism !== 'autocannon' || recipe.version.endsWith('+autocannon-v2')) return;
  const updated = compileWeapon({ mechanism: 'autocannon', power: recipe.power, stabilized: recipe.stabilized, enchantment: recipe.enchantment },
    { id: weapon.id, name: weapon.name, seed: recipe.seed, body: recipe.size, quality: recipe.quality, creatingUnit: true });
  weapon.baseDice = updated.baseDice; weapon.penetration = updated.penetration;
  weapon.recipe = { ...recipe, version: updated.recipe!.version };
}
export function compileArmor(spec: { tier?: Armor['tier']; armorId?: string; power?: number; bonuses?: Enhancements; profile?: 'balanced' | DamageChannel }, context: EquipmentContext): Armor {
  if (spec.armorId && ARMOR_ALIASES[spec.armorId] === undefined) throw new Error('未知护甲 id');
  const tier = spec.tier ?? (spec.armorId ? ARMOR_ALIASES[spec.armorId]! : 1);
  integer(tier, 0, 4, '防护构型');
  if (spec.armorId && spec.tier !== undefined && ARMOR_ALIASES[spec.armorId] !== spec.tier) throw new Error('护甲 id 与构型冲突');
  const recipe = equipmentRecipe('armor:' + tier, spec.power ?? 5, { ...context, bonuses: spec.bonuses ?? context.bonuses });
  const resistance = tier === 0 ? 0 : tier + Math.floor((recipe.power - 1) / 3);
  const protection = { kinetic: resistance, thermal: Math.max(0, resistance - 1), arcane: Math.max(0, resistance - 2) };
  const focus = spec.profile ?? 'balanced';
  if (!['balanced', 'kinetic', 'thermal', 'arcane'].includes(focus)) throw new Error('未知防护构型');
  recipe.protectionProfile = focus;
  if (focus !== 'balanced') {
    // 同预算转移至专用通道；提高专项防护必须支付其他通道防护。
    let shifted = 0;
    for (const channel of (['kinetic', 'thermal', 'arcane'] as const).filter((c) => c !== focus).sort((a, b) => protection[b] - protection[a])) {
      const transfer = Math.min(protection[channel], 2 - shifted);
      protection[channel] -= transfer; protection[focus] += transfer; shifted += transfer;
    }
  }
  return { id: context.id, name: context.name?.trim() || (spec.armorId ? ARMOR_LIBRARY[spec.armorId]!.name : ['无甲', '轻甲', '中甲', '重甲', '超重甲'][tier]!),
    tier, level: recipe.power, recipe,
    protection,
    load: [0, 1, 2, 4, 5][tier]!, drScale: 1 };
}
