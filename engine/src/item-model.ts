import { equipmentBurden } from './equipment-load.js';
/**
 * V15 道具系统（items-v1）。只由新战斗规则开启；旧战斗快照没有该标记，携行物品、专精与原型照原规则结算。
 *
 * 1. 一次性道具：喝、敷、注射的单体增益与治疗可用加速动作，其余（投、射、布设、施放）占主行动。
 * 2. 编队使用“每人一份”的一次性道具时，一次最多消耗现员数件；纯治疗按实际伤量减量，屏障容量按件数累加；区域、召唤与士气类一次一件。
 * 3. AI 给一次性道具计保留价值：治疗品留给伤重、濒死的目标，投掷物只在收益够大时用。
 * 4. 五项专精按 L1–10 逐级生效；旧规则一律按 L5（即 V14 及以前的效果）。
 * 5. 冲锋资格与远程判定只看实际坐骑、快速载具、武器和特质，不再看 archetype。
 * 道具实物本身（效果、件数、佩戴）不随规则版本变化：佩戴品的特质与修正、充能道具的每战次数在任何规则下照常生效。
 */
import type { BodyKind, Combatant, RulePack } from './types.js';
import { WEAPON_CLASSES } from './data/weapons.js';

export const ITEM_MODEL = 'items-v1' as const;
export type ItemModel = typeof ITEM_MODEL;
export const isItemModel = (model: unknown): model is ItemModel => model === ITEM_MODEL;
export const itemsV15 = (unit: Pick<Combatant, 'itemModel'> | undefined): boolean => isItemModel(unit?.itemModel);

export function validateItemModel(value: unknown): void {
  if (value !== undefined && !isItemModel(value)) throw new Error('道具规则版本损坏');
}
/** 以战斗规则为准；反复载入是幂等的，不改动单位档案与库存。 */
export function prepareItemModel(unit: Combatant, rules: Pick<RulePack, 'itemModel'>): void {
  if (unit.rulesVersion !== 'v2') return;
  if (rules.itemModel) unit.itemModel = rules.itemModel; else delete unit.itemModel;
}

/** 快速及以上的载具（装甲车、摩托、悬浮车等）可以冲锋。 */
export const fastVehicle = (unit: Pick<Combatant, 'body' | 'speedTier'>): boolean => unit.body === 'vehicle' && (unit.speedTier ?? 0) >= 4;
/** 冲锋资格：V15 看真实坐骑、快速载具或冲锋强化；旧规则沿用机动原型。 */
export function chargeCapable(unit: Pick<Combatant, 'itemModel' | 'archetype' | 'mount' | 'body' | 'speedTier'> & Partial<Combatant>, traits: readonly string[]): boolean {
  if (unit.armsModel === 'arms-v2' && equipmentBurden(unit as Combatant) === 2) return false;
  if (traits.includes('charge-strong')) return true;
  return itemsV15(unit) ? unit.mount === true || fastVehicle(unit) : unit.archetype === 'mobile';
}
/** 旧规则把远程原型当作远程单位；V15 只看实际武器。 */
export const rangedArchetype = (unit: Pick<Combatant, 'itemModel' | 'archetype'>): boolean => !itemsV15(unit) && unit.archetype === 'ranged';
/** 机动单位：V15 看真实坐骑或快速载具；旧规则看机动原型。 */
export const mobileUnit = (unit: Pick<Combatant, 'itemModel' | 'archetype' | 'mount' | 'body' | 'speedTier'>): boolean => itemsV15(unit) ? unit.mount === true || fastVehicle(unit) : unit.archetype === 'mobile';
/**
 * 新单位的原型由配装推断，正文写的 archetype 不再采用：真实坐骑或快速及以上的载具为机动，
 * 主武器是远程武器为远程，其余为步兵。原型只决定建档时的基础属性，已有单位不重算。
 */
export function inferArchetype(loadout: { mount?: boolean; body?: BodyKind; speedTier?: number; weaponClass?: string }): 'infantry' | 'ranged' | 'mobile' {
  if (loadout.mount || fastVehicle(loadout)) return 'mobile';
  const range = loadout.weaponClass ? WEAPON_CLASSES[loadout.weaponClass]?.profile.range : undefined;
  return range !== undefined && range > 1 ? 'ranged' : 'infantry';
}
