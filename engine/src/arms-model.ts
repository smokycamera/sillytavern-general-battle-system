export const ARMS_MODEL = 'arms-v1' as const;
export type ArmsModel = typeof ARMS_MODEL | 'arms-v2' | 'arms-v3';
export const isArmsModel = (model: unknown): model is ArmsModel => model === ARMS_MODEL || model === 'arms-v2' || model === 'arms-v3';
/** V18 百兵谱的全部规则；V21（arms-v3）沿用。 */
export const isArmsV2 = (model: unknown): model is 'arms-v2' | 'arms-v3' => model === 'arms-v2' || model === 'arms-v3';
/** V21 等级锚定：能量盾容量随平台、按规格跨代换算，实体盾耐久随平台。 */
export const isArmsV3 = (model: unknown): model is 'arms-v3' => model === 'arms-v3';
export function validateArmsModel(value: unknown): void {
  if (value !== undefined && !isArmsModel(value)) throw new Error('武器护甲规则版本损坏');
}
