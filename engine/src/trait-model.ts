/**
 * V13 特质翻修（traits-v1）。只由新战斗规则开启；旧战斗快照没有该标记，继续按 V12 及以前的特质规则结算。
 *
 * 1. 工事只在据守位置生效：开战时或获得工事时的位置；移动即失效，原地完整休整一轮后在新位置重新构筑。
 * 2. 工兵攻击无视目标的工事加成，不再有攻城环境攻击+2；拆墙等结构伤害×1.5不变。
 * 3. 拒马不再需要长兵器：对骑乘、载具与机动目标攻击+2、伤害×1.25，固守时正面冲锋伤害减半。
 * 4. 散兵分单体与编队：都在未被近敌牵制时范围伤害减半，编队另承担近战展开减半与近战防御−1。
 * 5. 主武器为步枪、单发重步枪或能量武器的轻中装人形编队自动散兵。
 *
 * 新增特质（对空、侦察、医护、非生物、偷袭、吸血、坚韧、身法、天生护甲、不屈）不会出现在旧战斗里，不需要这个开关。
 */
import type { Combatant, RulePack } from './types.js';

export const TRAIT_MODEL = 'traits-v1' as const;
export type TraitModel = typeof TRAIT_MODEL;
export const isTraitModel = (model: unknown): model is TraitModel => model === TRAIT_MODEL;
export const traitsV13 = (unit: Pick<Combatant, 'traitModel'> | undefined): boolean => isTraitModel(unit?.traitModel);

export function validateTraitModel(value: unknown): void {
  if (value !== undefined && !isTraitModel(value)) throw new Error('特质规则版本损坏');
}
/** The battle's saved rules are authoritative; re-loading is idempotent and never touches traits. */
export function prepareTraitModel(unit: Combatant, rules: Pick<RulePack, 'traitModel'>): void {
  if (unit.rulesVersion !== 'v2') return;
  if (rules.traitModel) unit.traitModel = rules.traitModel; else delete unit.traitModel;
}
export function validateEntrenchment(value: unknown): void {
  if (value !== undefined && !(Number.isSafeInteger(value) && (value as number) >= 0) && !(typeof value === 'string' && value.length > 0 && value.length <= 64)) throw new Error('工事据守位置损坏');
}
