import type { Combatant, RulePack } from './types.js';

/** V30 percentage floor is already life-scaled; historical regeneration remains fixed. */
export const REGENERATION_MODEL = 'life-floor-v1' as const;
export type RegenerationModel = typeof REGENERATION_MODEL;
export const REGENERATION_FLOOR = [.02, .03, .04, .06, .08, .09, .10, .11, .12, .14] as const;
export function validateRegenerationModel(value: unknown): void {
  if (value !== undefined && value !== REGENERATION_MODEL) throw Error('未知再生恢复规则');
}
export function prepareRegenerationModel(unit: Combatant, rules: Pick<RulePack, 'regenerationModel'>): void {
  validateRegenerationModel(unit.regenerationModel); validateRegenerationModel(rules.regenerationModel);
  if (rules.regenerationModel) unit.regenerationModel = rules.regenerationModel;
  else delete unit.regenerationModel;
}
