/**
 * V14 技能补全（skills-v1）。只由新战斗规则开启；旧战斗快照没有该标记，已学技能照原有数值结算。
 *
 * 同时改两项属性的状态（诅咒、重伤、惊惧、士气低下、振奋）按两项附加效果计价：效力、抵抗难度、伤害分摊与精力消耗
 * 都与分别写两个单项相同，不再以一项的价格压过“攻击”“防御”等单项减益。
 * 突进、闪现、后撤与正文解析修正是新增写法，旧战斗里不会出现，不依赖这个开关。
 */
import type { Ability, Combatant, RulePack } from './types.js';
import { standardConditionMap } from './conditions.js';

export const SKILL_MODEL = 'skills-v1' as const;
export const PHASE2_SKILL_MODEL = 'skills-v2' as const;
/** V20：组合控制每多一项效果，普通控制的抵抗难度 −1（skills-v2 为 −2）；其余与 skills-v2 相同。 */
export const PHASE3_SKILL_MODEL = 'skills-v3' as const;
/** V21：屏障基础量、状态效力与士气量按单体创伤预算比例；其余与 skills-v3 相同。 */
export const ANCHORED_SKILL_MODEL = 'skills-v4' as const;
export type SkillModel = typeof SKILL_MODEL | typeof PHASE2_SKILL_MODEL | typeof PHASE3_SKILL_MODEL | typeof ANCHORED_SKILL_MODEL;
export const isSkillModel = (model: unknown): model is SkillModel => model === SKILL_MODEL || model === PHASE2_SKILL_MODEL || model === PHASE3_SKILL_MODEL || model === ANCHORED_SKILL_MODEL;
export const skillsV14 = (unit: Pick<Combatant, 'skillModel'> | undefined): boolean => isSkillModel(unit?.skillModel);
/** V17 起的技能公式（新授予期限、治疗规格、默认 L1 等）；V20、V21 沿用。 */
export const skillsPhase2 = (model: unknown): boolean => model === PHASE2_SKILL_MODEL || model === PHASE3_SKILL_MODEL || model === ANCHORED_SKILL_MODEL;
/** 组合技能每多一项效果，普通控制的抵抗难度降低多少；嘲讽、致盲、混乱、魅惑不降，按精力计价。 */
export const controlSavePenalty = (model: unknown): number => model === PHASE3_SKILL_MODEL || model === ANCHORED_SKILL_MODEL ? 1 : 2;
/** V21 技能量按等级锚定：屏障=同级预算，状态效力与士气按预算比例（L5 不变）。 */
export const anchoredSkills = (model: unknown): boolean => model === ANCHORED_SKILL_MODEL;
/** 状态效力上限：旧规则 1.5（L10 的效力），V21 为 2（L10 的预算比例）。 */
export const conditionMagnitudeCap = (model: unknown): number => anchoredSkills(model) ? 2 : 1.5;

/** Replace only the generated 2.2 baseline, retaining signed bonuses, effect discounts and the saved instance. */
export function singleWeaponSkillScale(actor: Pick<Combatant, 'damageModel'>, ability: Ability, rules?: Pick<RulePack, 'singleWeaponSkillMultiplier' | 'weaponSkillCalibration'>): number {
  const formula = rules?.weaponSkillCalibration === 'all-formulas-v1' ? /^skill-v(?:6|7|8|9|10)\./ : /^skill-v6\./;
  return rules?.singleWeaponSkillMultiplier !== undefined && actor.damageModel === 'wounds-v2'
    && ability.shape !== 'burst' && !ability.customized && !ability.fixedPower && formula.test(ability.effectVersion ?? '')
    ? rules.singleWeaponSkillMultiplier / 2.2 : 1;
}

/** Only generated direct damage is calibrated; secondary effects and frozen active items retain their own budgets. */
export function independentSkillDamageScale(actor: Pick<Combatant, 'damageModel'>, ability: Ability, rules?: Pick<RulePack, 'independentSkillDamageMultiplier'>): number {
  if (rules?.independentSkillDamageMultiplier === undefined || actor.damageModel !== 'wounds-v2'
    || ability.damageBasis || ability.customized || ability.fixedPower || ability.itemSourceId || ability.equipmentSourceId
    || !ability.definitionId
    || !/^skill-v(?:6|7|8|9|10)\./.test(ability.effectVersion ?? '')) return 1;
  const category = ability.recipe?.category ?? ability.category;
  const spell = ability.delivery === 'magic' && ['magic-single', 'magic-area', 'magic-burst'].includes(category ?? '');
  const projectile = category === 'physical-single' && ability.shape !== 'burst'
    && ability.delivery === 'ranged' && ability.recipe?.modifiers.includes('projectile');
  return spell || projectile ? rules.independentSkillDamageMultiplier : 1;
}

export function validateSkillModel(value: unknown): void {
  if (value !== undefined && !isSkillModel(value)) throw new Error('技能规则版本损坏');
}
/** 以战斗规则为准；反复载入是幂等的，不改动已学技能本身，技能数值由 upgradeCombatSkills 按版本重建。 */
export function prepareSkillModel(unit: Combatant, rules: Pick<RulePack, 'skillModel'>): void {
  if (unit.rulesVersion !== 'v2') return;
  if (rules.skillModel) unit.skillModel = rules.skillModel; else delete unit.skillModel;
}
const definitions = standardConditionMap();
/** 状态的计价项数：skills-v1 起按状态实际改动的属性项数，旧规则一律为1。 */
export function conditionEffectWeight(conditionId: string | undefined, model?: SkillModel): number {
  return model ? Math.max(1, definitions.get(conditionId ?? '')?.mods?.length ?? 1) : 1;
}
