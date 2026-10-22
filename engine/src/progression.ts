/** 2026-10-19 数值规格。V22 独立版本；历史快照与实物不重编。 */
export const PROGRESSION_MODEL = 'traits-items-v1' as const;
export const STACKING_MODEL = 'traits-items-v2' as const;
export const stackingRevision = (value: { traitLevelModel?: unknown } | undefined): boolean => value?.traitLevelModel === STACKING_MODEL;
export const progression = (value: { traitLevelModel?: unknown } | undefined): boolean => value?.traitLevelModel === PROGRESSION_MODEL || stackingRevision(value);
export const ITEM_PROGRESSION = 'item-progression-v1' as const;
export const ITEM_STACKING = 'item-progression-v2' as const;
export const ITEM_LIFE_RECOVERY = 'item-progression-v3' as const;
export type ItemProgressionModel = typeof ITEM_PROGRESSION | typeof ITEM_STACKING | typeof ITEM_LIFE_RECOVERY;
export const itemProgression = (model: unknown): model is ItemProgressionModel => model === ITEM_PROGRESSION || model === ITEM_STACKING || model === ITEM_LIFE_RECOVERY;
export const GEAR_G = [.35, .50, .70, 1, 1.40, 1.90, 2.50, 3.20, 4.10, 5.20] as const;
export const GEAR_D = [.10, .22, .35, .50, .67, .85, 1.06, 1.29, 1.54, 1.82] as const;
export const ITEM_HEAL = [10, 17, 26, 38, 54, 74, 98, 126, 158, 194] as const;
export const ITEM_BARRIER = [12, 20, 30, 44, 62, 84, 112, 146, 188, 240] as const;
export const REVISED_ITEM_HEAL = [10,16,24,34,46,60,76,94,114,136] as const;
export const REVISED_ITEM_BARRIER = [12,18,26,36,48,62,78,96,116,138] as const;
export const ITEM_MORALE = [4, 7, 11, 16, 22, 29, 37, 46, 56, 68] as const;
export const ITEM_DURATION = [2, 2, 2, 3, 3, 3, 4, 4, 4, 5] as const;
export const PROGRESSION_PARAMETERS = {
  berserkAttack: [1,1,2,2,3,3,4,4,5,5], berserkDamage: [1.15,1.30,1.48,1.68,1.91,2.17,2.47,2.81,3.20,3.65],
  meleeAttack: [1,1,2,2,3,3,4,4,5,5], meleeDamage: [1.10,1.21,1.33,1.46,1.61,1.77,1.95,2.14,2.36,2.59],
  chargeAttack: [1,1,2,2,3,3,4,4,5,5], chargeDamage: [1.15,1.32,1.52,1.75,2.01,2.31,2.66,3.06,3.52,4.05],
  sneakMultiplier: [1.18,1.39,1.64,1.94,2.29,2.70,3.19,3.76,4.44,5.24],
  trampleMultiplier: [1.15,1.32,1.52,1.75,2.01,2.31,2.66,3.06,3.52,4.05],
  counterAttack: [1,1,2,2,3,3,4,4,5,5], counterMultiplier: [1.15,1.32,1.52,1.75,2.01,2.31,2.66,3.06,3.52,4.05],
  penetrationBudget: [.3,.6,.9,1.2,1.5,1.8,2.1,2.4,2.7,3],
  lifestealRatio: [.06,.09,.13,.18,.24,.31,.39,.48,.58,.70],
  poisonMultiplier: [.35,.55,.80,1.10,1.50,2,2.65,3.50,4.60,6], regenAmount: [1,1.5,2.2,3.2,4.6,6.5,9,12.5,17,23],
  channelResistance: [.4,.8,1.2,1.6,2,2.4,2.8,3.2,3.6,4],
  medicHealing: [1.10,1.23,1.38,1.55,1.74,1.95,2.18,2.44,2.73,3.06], medicRescue: [55,60,65,70,75,79,83,87,91,95],
  engineerDamage: [1.20,1.44,1.73,2.07,2.49,2.99,3.58,4.30,5.16,6.19], engineerSuppression: [.15,.25,.35,.45,.55,.65,.75,.85,.95,1],
  guardianReduction: [.10,.19,.27,.34,.41,.47,.53,.58,.63,.68], shieldReduction: [.15,.27,.37,.46,.54,.61,.67,.72,.77,.81],
  worksDefense: [1,1,2,2,3,3,4,4,5,5], worksReduction: [.10,.19,.27,.34,.41,.47,.53,.58,.63,.68],
  pikeReduction: [.15,.27,.37,.46,.54,.61,.67,.72,.77,.81], formationReduction: [.12,.23,.33,.42,.50,.57,.63,.69,.74,.79],
  skirmishReduction: [.08,.16,.24,.32,.40,.47,.54,.60,.66,.71], skirmishInitiative: [1,1,2,2,3,3,4,4,5,5], skirmishMobility: [0,1,1,1,2,2,2,3,3,3],
  controlResistance: [1,2,3,4,5,6,7,8,9,10], fatigueMultiplier: [.85,.72,.61,.52,.44,.37,.31,.26,.22,.18],
  resilience: [4,8,12,17,22,28,34,41,48,56], command: [3,6,10,14,19,24,30,36,43,50], fearPressure: [4,7,11,16,22,29,37,46,56,68],
  agileReactionReduction: [.2,.4,.6,.8,1,1,1,1,1,1], agileInitiative: [0,0,0,0,0,1,2,3,4,5], agileMobility: [0,0,0,0,0,0,1,1,2,2],
  sharpshooterCover: [0,0,0,1,1,1,2,2,2,3], reconSpotting: [1,2,3,4,5,6,7,8,9,10],
} as const;
/** V23 只覆盖组合修正指定的表，V22 的冻结版本继续使用上表。 */
export const STACKING_PARAMETERS = {
  ...PROGRESSION_PARAMETERS,
  lifestealRatio: [.04,.06,.08,.10,.12,.15,.18,.22,.26,.30],
  lifestealRoundCap: [.03,.04,.05,.06,.07,.08,.095,.11,.13,.15],
  channelResistance: [.15,.27,.37,.46,.54,.61,.67,.72,.77,.81],
  medicHealing: [1.06,1.12,1.19,1.27,1.36,1.46,1.57,1.69,1.82,1.96],
} as const;
