/** V27 fixed recovery follows the 50% life increase. Percentage effects already follow life. */
export const LIFE_RECOVERY_MODEL = 'life-scaled-v1' as const;
export type LifeRecoveryModel = typeof LIFE_RECOVERY_MODEL;
export function validateLifeRecoveryModel(value: unknown): void {
  if (value !== undefined && value !== LIFE_RECOVERY_MODEL) throw Error('生命恢复版本损坏');
}
export const lifeRecoveryScale = (value: {recoveryModel?: LifeRecoveryModel}) => value.recoveryModel === LIFE_RECOVERY_MODEL ? 1.5 : 1;
