import type { AttackOpts } from './damage.js';
import type { DamageChannel, Weapon } from './types.js';
import { channelPoints, bonusMultiplier, bonusRating, trainingDamage } from './enhancements.js';
import { equipmentMultiplier, equipmentRating, gradedNumbers, multiplierPerPoint, unitMultiplier } from './numeric-model.js';
import { combatBonuses, wornEffects } from './gear-bonuses.js';
import { channelBuffDamage } from './channel-buffs.js';

export interface AdditionalChannelBudget { channel: DamageChannel; scale: number; penetrationDelta: number }
/** 最多补充另外两个通道；共享原攻击骰，不增加命中、暴击或独立抽样。 */
export function additionalChannelBudgets(opts: Omit<AttackOpts, 'rng'>, weapon?: Weapon): AdditionalChannelBudget[] {
  if (opts.rules.enhancementModel !== 'channels-life-v1' || opts.rules.combatModel !== 'cohort-v2') return [];
  const primary = opts.abilityDamage?.channel ?? weapon?.channel ?? 'kinetic';
  const weaponAttack = !opts.abilityDamage || opts.abilityDamage.weaponBased;
  const recipe = weaponAttack ? weapon?.recipe : undefined, skill = opts.abilityDamage?.bonuses;
  const own = combatBonuses(opts.attacker), worn = wornEffects(opts.attacker);
  const wornGeneral = Math.max(0, 1 + (worn.damage ?? 0));
  let common = (opts.abilityDamage?.damageScale ?? weapon?.damageScale ?? 1) * trainingDamage(opts.attacker.level, opts.rules)
    * unitMultiplier(opts.attacker, 'damage', undefined, own) * wornGeneral;
  if (recipe) {
    const primaryScale = equipmentMultiplier(recipe, 'damage', primary);
    common *= primaryScale > 0 ? equipmentMultiplier(recipe, 'damage') / primaryScale : 0;
  }
  if (skill) common *= bonusMultiplier(skill, 'damage') / bonusMultiplier(skill, 'damage', primary);
  const result: AdditionalChannelBudget[] = [];
  for (const channel of ['kinetic', 'thermal', 'arcane'] as const) {
    if (channel === primary) continue;
    const unitPart = channelPoints(own, 'damage', channel) * (gradedNumbers(opts.attacker) ? multiplierPerPoint(opts.attacker.level) : .05);
    const weaponPart = channelPoints(recipe?.bonuses, 'damage', channel) * (recipe && gradedNumbers(recipe) ? multiplierPerPoint(recipe.power) : .05);
    const skillPart = channelPoints(skill, 'damage', channel) * .05;
    // wornEffects 的通道值已含通用伤害；先剥离它，避免通用伤害凭空新增三个通道。
    const wornPart = wornGeneral ? Math.max(0, 1 + (worn[(channel + 'Damage') as 'kineticDamage'] ?? 0)) / wornGeneral - 1 : -1;
    // 与原有单位/武器倍率同样逐来源封顶2倍；负修正不能因相乘而重新变成正伤害。
    const factor = (part: number) => Math.max(0, Math.min(2, 1 + part));
    const fraction = Math.max(0, factor(unitPart) * factor(weaponPart) * factor(skillPart) * Math.max(0, 1 + wornPart) * (1 + channelBuffDamage(opts.attacker,channel)) - 1);
    if (!fraction || !common) continue;
    const penetrationDelta = (recipe ? equipmentRating(recipe, 'penetration', channel) - equipmentRating(recipe, 'penetration', primary) : 0)
      + bonusRating(skill, 'penetration', channel) - bonusRating(skill, 'penetration', primary);
    result.push({ channel, scale: common * fraction, penetrationDelta });
  }
  return result;
}

/** 各通道共用一次取整，并按比例分配；整数之和严格等于本次伤害。 */
export function splitChannelDamage(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const values = weights.map(w => total * w / sum), result = values.map(Math.floor);
  let left = total - result.reduce((a, b) => a + b, 0);
  const order = values.map((value, i) => ({ i, rest: value - result[i]! })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const entry of order) if (left-- > 0) result[entry.i]!++;
  return result;
}
