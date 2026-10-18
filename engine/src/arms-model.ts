export const ARMS_MODEL = 'arms-v1' as const;
export type ArmsModel = typeof ARMS_MODEL | 'arms-v2';
export const isArmsModel = (model: unknown): model is ArmsModel => model === ARMS_MODEL || model === 'arms-v2';
export const isArmsV2 = (model: unknown): model is 'arms-v2' => model === 'arms-v2';
export function validateArmsModel(value: unknown): void {
  if (value !== undefined && !isArmsModel(value)) throw new Error('武器护甲规则版本损坏');
}
