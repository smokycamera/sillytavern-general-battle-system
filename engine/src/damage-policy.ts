import type { AttackOpts } from './damage.js';
import type { DamageChannel, Weapon } from './types.js';
import { equipmentMultiplier, unitMultiplier } from './numeric-model.js';
import { bonusMultiplier } from './enhancements.js';
import { combatBonuses, wornDamageMultiplier, wornEffects } from './gear-bonuses.js';

/** Same-category positive increments add; negative source factors remain multiplicative. */
export function mergeDamageFactors(factors: readonly number[]): number {
  return (1 + factors.reduce((sum, factor) => sum + Math.max(0, factor - 1), 0))
    * factors.reduce((product, factor) => product * Math.min(1, Math.max(0, factor)), 1);
}
export function damageFactors(opts: Pick<AttackOpts, 'attacker' | 'abilityDamage'>, weapon: Weapon | undefined, channel?: DamageChannel): number[] {
  const recipe = !opts.abilityDamage || opts.abilityDamage.weaponBased ? weapon?.recipe : undefined;
  return [equipmentMultiplier(recipe && weapon?.customized ? { ...recipe, variance: undefined } : recipe, 'damage', channel),
    bonusMultiplier(opts.abilityDamage?.bonuses, 'damage', channel),
    unitMultiplier(opts.attacker, 'damage', channel, combatBonuses(opts.attacker)),
    channel ? wornDamageMultiplier(opts.attacker, channel) : Math.max(0, 1 + (combatWornGeneral(opts.attacker)))];
}
const combatWornGeneral = (unit: AttackOpts['attacker']) => wornEffects(unit).damage ?? 0;
/** Correct embedded frozen weapon/skill factors at execution; never rewrite historical instances. */
export function damageMergeRatio(opts: Pick<AttackOpts, 'attacker' | 'abilityDamage' | 'rules'>, weapon?: Weapon, channel?: DamageChannel): number {
  if (opts.rules.damageStackModel !== 'additive-positive-v1') return 1;
  const factors = damageFactors(opts, weapon, channel), product = factors.reduce((a, b) => a * b, 1);
  return product > 0 ? mergeDamageFactors(factors) / product : 1;
}
export const criticalBudgetScale = (rules: AttackOpts['rules']) => rules.criticalDamageScale ?? 1;
