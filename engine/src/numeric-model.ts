import { bonusSteps, channelPoints, type BonusStat, type Enhancements } from './enhancements.js';
import { instanceMultiplier, instanceOffset, instanceRating, type InstanceVariance, type VarianceStat } from './instance-variance.js';
import type { Combatant, DamageChannel, ItemRecipe } from './types.js';

/** Absent on historical snapshots and physical items. Only V26/new generation opts in. */
export const NUMERIC_MODEL = 'graded-v1' as const;
export type NumericModel = typeof NUMERIC_MODEL;
export const gradedNumbers = (value: { numericModel?: NumericModel }) => value.numericModel === NUMERIC_MODEL;
export function validateNumericModel(value: unknown): void {
  if (value !== undefined && value !== NUMERIC_MODEL) throw Error('未知数值模型');
}
export const ratingPerPoint = (level: number) => .5 + .05 * (level - 1);
export const multiplierPerPoint = (level: number) => .05 + .005 * (level - 1);
const precise = (value: number) => Number(value.toPrecision(12));
type NumericUnit = Pick<Combatant, 'level' | 'bonuses'> & Partial<Pick<Combatant, 'numericModel' | 'genAudit'>>;
export function unitStep(unit: NumericUnit, stat: BonusStat): number {
  if (!gradedNumbers(unit)) return bonusSteps(unit.bonuses, stat, stat === 'speed' ? 5 : 3);
  const step = stat === 'speed' ? .2 * unit.level : stat === 'morale' ? unit.level + 2 : ratingPerPoint(unit.level);
  return precise((unit.bonuses?.[stat] ?? 0) * step);
}
/** Shared power and the selected channel are added before conversion. Negative effects have no artificial floor. */
export function unitMultiplier(unit: NumericUnit, stat: 'damage' | 'health', channel?: DamageChannel, bonuses = unit.bonuses): number {
  if (!gradedNumbers(unit)) return instanceMultiplier(bonuses, stat, unit.genAudit?.variance, channel);
  return gradedMultiplier(bonuses, stat, unit.level, unit.genAudit?.variance, channel);
}
function gradedMultiplier(bonuses: Enhancements | undefined, stat: VarianceStat, level: number, variance?: InstanceVariance, channel?: DamageChannel): number {
  const points = (bonuses?.[stat] ?? 0) + (stat === 'power' ? 0 : bonuses?.power ?? 0) + channelPoints(bonuses, stat, channel);
  const center = 1 + points * multiplierPerPoint(level);
  return precise(Math.max(0, Math.min(2, center + (center >= 2 || center <= 0 ? 0 : .05 * instanceOffset(variance, stat)))));
}
export function equipmentMultiplier(recipe: ItemRecipe | undefined, stat: VarianceStat, channel?: DamageChannel): number {
  return recipe && gradedNumbers(recipe) ? gradedMultiplier(recipe.bonuses, stat, recipe.power, recipe.variance, channel)
    : instanceMultiplier(recipe?.bonuses, stat, recipe?.variance, channel);
}
export function equipmentRating(recipe: ItemRecipe | undefined, stat: 'penetration' | 'protection', channel?: DamageChannel): number {
  if (!recipe || !gradedNumbers(recipe)) return instanceRating(recipe?.bonuses, stat, recipe?.variance, channel);
  const center = ((recipe.bonuses?.[stat] ?? 0) + channelPoints(recipe.bonuses, stat, channel)) / 5;
  return precise(Math.min(2, center + (center >= 2 ? 0 : instanceOffset(recipe.variance, stat) / 5)));
}
export function equipmentStep(recipe: ItemRecipe | undefined, stat: BonusStat): number {
  if (!recipe || !gradedNumbers(recipe)) return bonusSteps(recipe?.bonuses, stat, stat === 'speed' || stat === 'range' ? 5 : 3);
  return precise((recipe.bonuses?.[stat] ?? 0) * (stat === 'speed' ? recipe.power / 10 : stat === 'morale' ? recipe.power + 2 : ratingPerPoint(recipe.power)));
}
/** Relative physical burden, including bulk and handling; artillery specifications remain frozen. */
export const GRADED_WEAPON_LOAD: Readonly<Record<string, number>> = {
  natural: 0, summon: 0, 'light-ranged': .5, demolition: 1, sword: 1, greatsword: 1.5, dagger: .5,
  axe: 1, 'great-weapon': 3, blunt: 1, spear: 1.5, 'heavy-polearm': 2, throwing: 1, bow: 1,
  crossbow: 1.5, firearm: 1.5, rifle: 1.5, shotgun: 1.5, 'heavy-rifle': 2.5,
  autocannon: 6, cannon: 6, rocket: 2, 'indirect-cannon': 6, energy: 2, sprayer: 5, magic: 1,
};
export const GRADED_SHIELD_LOAD: Readonly<Record<string, number>> = { buckler: .5, shield: 1.5, 'tower-shield': 3, 'energy-shield': 1 };
export const ARTILLERY_MECHANISMS = ['cannon', 'indirect-cannon', 'autocannon', 'rocket'];
export const gradedLifeScale = (value: { numericModel?: NumericModel }) => gradedNumbers(value) ? 1.5 : 1;
