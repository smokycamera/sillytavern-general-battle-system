/**
 * V14 技能补全（skills-v1）。只由新战斗规则开启；旧战斗快照没有该标记，已学技能照原有数值结算。
 *
 * 同时改两项属性的状态（诅咒、重伤、惊惧、士气低下、振奋）按两项附加效果计价：效力、抵抗难度、伤害分摊与精力消耗
 * 都与分别写两个单项相同，不再以一项的价格压过“攻击”“防御”等单项减益。
 * 突进、闪现、后撤与正文解析修正是新增写法，旧战斗里不会出现，不依赖这个开关。
 */
import type { Combatant, RulePack } from './types.js';
import { standardConditionMap } from './conditions.js';

export const SKILL_MODEL = 'skills-v1' as const;
export const PHASE2_SKILL_MODEL = 'skills-v2' as const;
export type SkillModel = typeof SKILL_MODEL | typeof PHASE2_SKILL_MODEL;
export const isSkillModel = (model: unknown): model is SkillModel => model === SKILL_MODEL || model === PHASE2_SKILL_MODEL;
export const skillsV14 = (unit: Pick<Combatant, 'skillModel'> | undefined): boolean => isSkillModel(unit?.skillModel);

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
