import type { Combatant, RulePack, Ability, EffectOp } from './types.js';
import { powerBudget } from './power-anchors.js';
import { validTraitLevel } from './data/traits.js';
import { activeTraitIds, effectiveTraitLevel } from './trait-sources.js';
import { phase2Traits } from './trait-level-model.js';
import { traitParameter } from './trait-parameters.js';

export const HEALING_MODEL = 'healing-grades-v1' as const;
export type HealingModel = typeof HEALING_MODEL;
export function validateHealingModel(value: unknown): void {
  if (value !== undefined && value !== HEALING_MODEL) throw Error('治疗模型版本损坏');
}
export function prepareHealingModel(unit: Combatant, rules: Pick<RulePack, 'healingModel'>): void {
  validateHealingModel(rules.healingModel);
  if (rules.healingModel) unit.healingModel = rules.healingModel; else delete unit.healingModel;
}
/** 治疗只比较真实规格与受术者训练；无可信规格的历史效果保持原预算。 */
export function healingGradeMultiplier(power: number | undefined, targetLevel: number, model?: HealingModel): number {
  if (!validTraitLevel(targetLevel) || power !== undefined && !validTraitLevel(power)) throw Error('治疗规格与目标level须为L1–10整数');
  if (model !== HEALING_MODEL || power === undefined || power <= targetLevel + 1) return 1;
  return Math.sqrt(powerBudget(power) / powerBudget(targetLevel + 1));
}
export function medicHealingMultiplier(source: Combatant): number {
  if (source.rulesVersion !== 'v2' || !activeTraitIds(source).includes('medic')) return 1;
  return phase2Traits(source) ? traitParameter('medicHealing', effectiveTraitLevel(source, 'medic')) : 1.25;
}
export interface HealingBudgetInput {
  source: Combatant; target: Combatant; baseAmount: number; power?: number;
  delivery?: 'skill' | 'item' | 'zone' | 'regen'; itemDoses?: number;
  sourceMedicSnapshot?: number; rules?: Pick<RulePack, 'healingModel'>;
}
/** 不取整、不改写单位。编译分摊/强化已在baseAmount内；剂量与医护仅各乘一次。 */
export function resolveHealingBudget(input: HealingBudgetInput): number {
  const { source, target, power, delivery = 'skill', baseAmount, itemDoses = 1 } = input;
  if (!Number.isFinite(baseAmount) || baseAmount < 0 || !Number.isSafeInteger(itemDoses) || itemDoses < 1) throw Error('治疗预算或剂量损坏');
  const medic = delivery === 'regen' ? 1 : input.sourceMedicSnapshot ?? medicHealingMultiplier(source);
  if (!Number.isFinite(medic) || medic < 0) throw Error('治疗来源医护快照损坏');
  const cohort = target.combatModel === 'cohort-v1' || target.combatModel === 'cohort-v2';
  const teams = delivery === 'skill' && source.scale !== 'hero'
    ? Math.min(source.formation?.members ?? source.hp, Math.max(1, (source.formation?.members ?? source.hp) / 50) * 10) : 1;
  const scale = cohort && target.scale !== 'hero' && delivery !== 'zone' && delivery !== 'regen'
    ? teams / (target.combatModel === 'cohort-v2' ? 1 : target.formation?.memberHp ?? 10) : 1;
  const model = input.rules ? input.rules.healingModel : target.healingModel;
  return baseAmount * scale * medic * itemDoses * healingGradeMultiplier(power, target.level, model);
}

/** 同动作、同规格的确定预算先合并；旧效果与旧骰子保留其原结算。 */
export function healingEffectGroups(ability: Pick<Ability, 'effects'>): EffectOp[] {
  const result: EffectOp[] = [], groups = new Map<number, Extract<EffectOp, { op: 'heal' }>>();
  for (const effect of ability.effects) {
    if (effect.op !== 'heal' || effect.power === undefined || effect.amount === undefined) { result.push(effect); continue; }
    const group = groups.get(effect.power);
    if (group && group.amount !== undefined) group.amount += effect.amount;
    else { const copy = { ...effect }; groups.set(effect.power, copy); result.push(copy); }
  }
  return result;
}
