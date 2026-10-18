/** P1 候选数值，L1→L10。纯数据：不得依赖来源归集、战斗或 UI。 */
export const DEFAULT_NEW_TRAIT_LEVEL = 1;
export const TERRAIN_GRADED_TRAITS: readonly string[] = ['forest-lore', 'mountain-born', 'night-fighter', 'plains-runner', 'urban-fighter'];
export const P1_GRADED_TRAITS: readonly string[] = ['guardian', 'lifesteal', 'sneak-attack', 'fatigue-trained', 'trample', 'shield-wall', 'ap-weapon', 'anti-infantry', 'anti-large', 'stubborn', 'commander'];
export const P2_GRADED_TRAITS: readonly string[] = ['regen', 'medic', 'poison-strike', 'fear', 'fortification', 'pike-wall', 'loose-formation', 'skirmisher', 'tenacity', 'agile', 'siege-breaker', 'melee-master', 'sharpshooter', 'charge-strong', 'berserk', 'anti-air', 'stalk', 'recon', 'kinetic-resist', 'thermal-resist', 'arcane-resist'];
export const reconDistance = (stalk: number, recon: number, mode: 'small' | 'mass'): number => Math.max(1, Math.min(mode === 'small' ? 7 : 3,
  mode === 'small' ? 2 + (recon > 0 ? 2 + (recon - 5) / 2 : 0) - (stalk - 5) / 2 : 1 + (recon > 0 ? 1 + (recon - 5) / 4 : 0) - (stalk - 5) / 4));
export const TRAIT_LEVEL_ALIASES: Readonly<Record<string, { id: string; level: number }>> = {
  'guardian-greater': { id: 'guardian', level: 8 }, 'ap-master': { id: 'ap-weapon', level: 8 }, 'monster-hunter': { id: 'anti-large', level: 8 },
  terror: { id: 'fear', level: 8 },
};
export const canonicalTraitId = (id: string, phase2 = true): string => id === 'terror' && !phase2 ? id : TRAIT_LEVEL_ALIASES[id]?.id ?? id;
export const sourceTraitLevel = (id: string, level?: number): number => TRAIT_LEVEL_ALIASES[id]?.level ?? level ?? 5;
export const TRAIT_PARAMETERS = {
  medicHealing: [1.05, 1.10, 1.15, 1.20, 1.25, 1.28, 1.31, 1.34, 1.37, 1.40],
  medicRescue: [55, 60, 65, 70, 75, 77, 79, 81, 83, 85],
  woundRatio: [.25, .5, .75, .875, 1, 1.125, 1.3125, 1.5, 1.75, 2],
  fearPressure: [2, 3, 5, 6, 8, 10, 12, 15, 17, 18],
  worksDefense: [1, 1, 2, 2, 3, 3, 3, 4, 4, 5],
  worksReduction: [.10, .15, .20, .25, .30, .33, .36, .39, .42, .45],
  formationReduction: [.10, .20, .30, .40, .50, .53, .56, .59, .62, .65],
  skirmishInitiative: [0, 1, 1, 2, 2, 2, 3, 3, 3, 4],
  skirmishMobility: [0, 0, 1, 1, 1, 1, 1, 2, 2, 2],
  skirmishReduction: [.05, .10, .15, .20, .25, .28, .31, .34, .37, .40],
  controlResistance: [1, 2, 3, 3, 4, 5, 6, 7, 8, 9],
  pushLimit: [0, 1, 2, 3, 99, 99, 99, 99, 99, 99],
  agileTerrain: [.8, .6, .4, .2, 0, 0, 0, 0, 0, 0],
  agileReactionReduction: [.1, .2, .3, .4, 1, 1, 1, 1, 1, 1],
  agileInitiative: [0, 0, 0, 0, 0, 1, 2, 2, 3, 3],
  agileMobility: [0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
  engineerDamage: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2],
  engineerSuppression: [.2, .4, .6, .8, 1, 1, 1, 1, 1, 1],
  meleeAttack: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4],
  meleeDamage: [1, 1.025, 1.05, 1.10, 1.15, 1.20, 1.20, 1.25, 1.30, 1.30],
  chargeAttack: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  chargeDamage: [1, 1, 1, 1, 1, 1.05, 1.05, 1.10, 1.10, 1.15],
  berserkAttack: [1, 1, 1, 2, 2, 3, 3, 3, 4, 4],
  berserkDamage: [1, 1, 1, 1, 1, 1, 1.03, 1.06, 1.06, 1.10],
  antiAirRangeSmall: [2, 2, 1, 1, 0, 0, 0, 0, 0, 0],
  antiAirRangeMass: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
  reconSpotting: [0, 1, 1, 2, 2, 2, 3, 3, 3, 4],
  guardianReduction: [.05, .10, .15, .20, .25, .30, .35, .40, .425, .45],
  lifestealRatio: [.05, .10, .15, .20, .25, .28, .31, .34, .37, .40],
  sneakMultiplier: [1.10, 1.20, 1.30, 1.40, 1.50, 1.55, 1.60, 1.65, 1.70, 1.75],
  fatigueMultiplier: [.90, .80, .70, .60, .50, .47, .44, .41, .38, .35],
  trampleMultiplier: [1.05, 1.10, 1.15, 1.20, 1.25, 1.28, 1.31, 1.34, 1.37, 1.40],
  shieldReduction: [.10, .18, .26, .33, .40, .43, .46, .49, .52, .55],
  penetrationBudget: [.2, .4, .6, .8, 1, 1.25, 1.5, 2, 2.25, 2.5],
  counterAttack: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4],
  counterMultiplier: [1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.45, 1.50],
  resilience: [3, 6, 9, 12, 15, 17, 19, 21, 23, 25],
  command: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
} as const;
export type TraitParameter = keyof typeof TRAIT_PARAMETERS;
export function traitParameter(parameter: TraitParameter, level: number): number {
  return TRAIT_PARAMETERS[parameter][Math.max(0, Math.min(9, Math.round(level) - 1))]!;
}
/** 原五项保留 ceil(L/2)；P1 保留旧 L5 成本和已有强版本 L8 成本。 */
export function gradedTraitCost(id: string, level: number): number {
  if (TERRAIN_GRADED_TRAITS.includes(id)) return Math.ceil(level / 2);
  const canonical = canonicalTraitId(id), L = sourceTraitLevel(id, level);
  // 屠兽者历史上不在 STRONG_TRAITS 中，实际成本为3，不能因为名称叫“强版”猜成6。
  const c5 = canonical === 'regen' ? 6 : 3, c8 = canonical === 'guardian' || canonical === 'ap-weapon' || canonical === 'fear' ? 6 : canonical === 'anti-large' ? 3 : undefined;
  const c1 = Math.max(1, Math.ceil(c5 * .4)), c10 = Math.max(Math.ceil(c5 * 1.6), Math.ceil((c8 ?? 0) * 1.25));
  const anchors = [[1, c1], [5, c5], ...(c8 === undefined ? [] : [[8, c8]]), [10, c10]];
  const upper = anchors.findIndex(([l]) => L <= l!);
  if (upper <= 0) return anchors[0]![1]!;
  const [a, x] = anchors[upper - 1]!, [b, y] = anchors[upper]!;
  return Math.ceil(x! + (y! - x!) * (L - a!) / (b! - a!) - 1e-10);
}
