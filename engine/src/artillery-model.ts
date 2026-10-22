import type { Combatant } from './types.js';

export const ARTILLERY_MODEL = 'blast-decay-v1' as const;
export type ArtilleryModel = typeof ARTILLERY_MODEL;
export function validateArtilleryModel(value: unknown): void {
  if (value !== undefined && value !== ARTILLERY_MODEL) throw Error('未知火炮结算模型');
}
/** Game-scale spill energy. Armor/HP already resolve penetration before this curve.
 * Trained/protected targets retain less residual spread; higher weapon L retains more.
 * This is a balance abstraction inspired by diminishing cumulative fragment effects,
 * not a calibrated real-weapon lethality model. No fixed casualty/kill-count ceiling. */
export function artilleryRetention(target: Combatant, power: number): number {
  const armor = target.armor;
  return .45 * Math.sqrt((power + 2) / (target.level + 2))
    / (1 + .04 * (target.level - 1) + .04 * (armor?.tier ?? 0) * (armor?.recipe?.power ?? armor?.level ?? 1) / 10);
}
/** Direct hits up to the original hit members' full durability are unchanged. */
export function artilleryDirect(raw: number, reference: number, retention: number): number {
  if (reference <= 0) return 0;
  if (raw <= reference) return raw;
  return reference + retention * reference * Math.log1p((raw - reference) / reference);
}
/** Small fragment doses retain their first-order strength; high doses have diminishing spread. */
export function artillerySplash(raw: number, reference: number, extra: number, fraction: number): number {
  return reference > 0 ? reference * Math.log1p(raw / reference) * extra * fraction : 0;
}
