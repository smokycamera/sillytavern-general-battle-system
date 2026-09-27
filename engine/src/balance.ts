import type { Combatant } from './types.js';

/** V6 is opt-in by rule id. Missing markers always retain the saved V2–V5 formulas. */
export const UNIFIED_DAMAGE_MODEL = 'wounds-v2' as const;
export const isWoundModel = (model?: Combatant['damageModel']) => model === 'wounds-v1' || model === UNIFIED_DAMAGE_MODEL;
export const UNIFIED_HP = [20, 36, 52, 68, 84, 100, 116, 132, 148, 164] as const;
export const UNIFIED_WOUNDS = [8, 16, 24, 28, 32, 36, 42, 48, 56, 64] as const;
export const UNIFIED_SPLASH = [0, 0, 2, 2, 4, 4, 6, 12, 16, 24] as const;
export const UNIFIED_AREA = [4, 4, 4, 4, 4, 4, 8, 16, 24, 32] as const;
export const powerIndex = (power: number) => Math.max(0, Math.min(9, Math.round(power) - 1));
