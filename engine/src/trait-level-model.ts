import { PROGRESSION_MODEL, STACKING_MODEL, progression } from './progression.js';
import { prepareHealingModel } from './healing.js';
import type { Combatant, RulePack } from './types.js';
import { TERRAIN_GRADED_TRAITS, P1_GRADED_TRAITS, P2_GRADED_TRAITS } from './trait-parameters.js';
export const TRAIT_LEVEL_MODEL = 'traits-levels-v1' as const;
export const PHASE2_TRAIT_LEVEL_MODEL = 'traits-levels-v2' as const;
export const phase2Traits = (unit: { rulesVersion?: string; traitLevelModel?: unknown } | undefined): boolean => unit?.rulesVersion === 'v2' && (unit.traitLevelModel === PHASE2_TRAIT_LEVEL_MODEL || progression(unit));
export const traitLevelsV16 = (unit: { rulesVersion?: string; traitLevelModel?: unknown } | undefined): boolean => unit?.rulesVersion === 'v2' && (unit.traitLevelModel === TRAIT_LEVEL_MODEL || phase2Traits(unit));
export function gradedTraitEnabled(unit: { rulesVersion?: string; itemModel?: unknown; traitLevelModel?: unknown }, id: string): boolean {
  return unit.rulesVersion === 'v2' && (TERRAIN_GRADED_TRAITS.includes(id) ? (unit.itemModel === 'items-v1' || unit.itemModel === 'items-v2') : P1_GRADED_TRAITS.includes(id) && traitLevelsV16(unit) || P2_GRADED_TRAITS.includes(id) && phase2Traits(unit));
}
export function validateTraitLevelModel(value: unknown): void {
  if (value !== undefined && value !== TRAIT_LEVEL_MODEL && value !== PHASE2_TRAIT_LEVEL_MODEL && value !== PROGRESSION_MODEL && value !== STACKING_MODEL) throw new Error('特质分级规则版本损坏');
}
/** 战斗快照规则为准，旧规则明确移除新门控；不重建基础值或来源。 */
export function prepareTraitLevelModel(unit: Combatant, rules: Pick<RulePack, 'traitLevelModel' | 'healingModel' | 'controlModel' | 'commandRangeModel'>): void {
  if (unit.rulesVersion !== 'v2') return;
  validateTraitLevelModel(rules.traitLevelModel);
  if (rules.commandRangeModel !== undefined && rules.commandRangeModel !== 'graded-v1') throw Error('统率范围规则版本损坏');
  if (rules.commandRangeModel) unit.commandRangeModel = rules.commandRangeModel; else delete unit.commandRangeModel;
  prepareHealingModel(unit, rules);
  if (rules.controlModel !== undefined && rules.controlModel !== 'activation-controls-v1') throw Error('控制规则版本损坏');
  if (rules.controlModel) unit.controlModel = rules.controlModel; else delete unit.controlModel;
  if (rules.traitLevelModel) unit.traitLevelModel = rules.traitLevelModel; else delete unit.traitLevelModel;
}
