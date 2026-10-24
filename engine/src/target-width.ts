import type { Combatant } from './types.js';

/** A target's actual bodies bound weapon participants; identity as hero/company does not. */
export const TARGET_WIDTH_MODEL = 'target-width-v1' as const;
export type TargetWidthModel = typeof TARGET_WIDTH_MODEL;
export const SINGLE_TARGET_WIDTH = {
  human: { melee: 6, ranged: 12 }, large: { melee: 10, ranged: 18 },
  giant: { melee: 16, ranged: 28 }, vehicle: { melee: 16, ranged: 32 },
} as const;
export function validateTargetWidthModel(value: unknown): void {
  if (value !== undefined && value !== TARGET_WIDTH_MODEL) throw Error('未知目标交战展开规则');
}
export function targetWidthLimit(target: Combatant, ranged: boolean, model: TargetWidthModel | null | undefined = target.targetWidthModel): number {
  if (model !== TARGET_WIDTH_MODEL) return Infinity;
  const members = target.scale === 'hero' ? 1 : Math.max(0, target.formation?.members ?? target.hp);
  const body = target.mount && (target.body ?? 'human') === 'human' ? 'large' : target.body ?? 'human';
  const width = SINGLE_TARGET_WIDTH[body][ranged ? 'ranged' : 'melee'];
  return width * (ranged ? members : Math.sqrt(members));
}
