import { progression, GEAR_G, GEAR_D } from './progression.js';
import { bonusSteps, type Enhancements, type BonusStat } from './enhancements.js';
import type { GearItem } from './items.js';
import type { Combatant } from './types.js';
import { traitParameter } from './trait-parameters.js';

/** 已换算实效随实物冻结；绝不在读配方时重新计算。 */
export interface WornEffects {
  values: Partial<Record<BonusStat, number>>;
  damageCap: number; negativeDamageCap: number;
  protectionCap: number; negativeProtectionCap: number;
}
/** 同一实物先兑现通用+通道上限，之后才跨实物取强。 */
function capWornSource(effects: WornEffects): WornEffects {
  for (const channel of ['kinetic', 'thermal', 'arcane']) for (const stat of ['damage', 'protection'] as const) {
    const key = (channel + (stat === 'damage' ? 'Damage' : 'Protection')) as BonusStat;
    const general = effects.values[stat] ?? 0, specific = effects.values[key] ?? 0;
    if (general > 0 && specific > 0) effects.values[key] = Math.min(specific, Math.max(0, (stat === 'damage' ? effects.damageCap : effects.protectionCap) - general));
    if (general < 0 && specific < 0) effects.values[key] = Math.max(specific, Math.min(0, -(stat === 'damage' ? effects.negativeDamageCap : effects.negativeProtectionCap) - general));
  }
  return effects;
}
export function compileWornEffects(bonuses: Enhancements | undefined, power: number): WornEffects {
  const G = GEAR_G[power - 1]!, D = GEAR_D[power - 1]!, values: WornEffects['values'] = {};
  for (const [stat, points] of Object.entries(bonuses ?? {}) as [BonusStat, number][]) {
    const q = points / 10, g = points < 0 ? Math.min(G, 1.4) : G, d = points < 0 ? Math.min(D, .67) : D;
    values[stat] = q * (stat === 'damage' ? d : stat.endsWith('Damage') ? 1.25 * d : stat === 'morale' ? 8 * g : stat === 'protection' ? .5 * g : stat.endsWith('Protection') ? .75 * g : g);
  }
  return capWornSource({ values, damageCap: 1.25 * D, negativeDamageCap: 1.25 * Math.min(D, .67), protectionCap: .75 * G, negativeProtectionCap: .75 * Math.min(G, 1.4) });
}
/** 历史点数仅按其原单位解释，不读取L、不写回新配方。新旧实物混戴仍同方向取强。 */
export function wornItemEffects(item: Pick<GearItem, 'passive'>): WornEffects {
  if (item.passive?.actualEffects) return item.passive.actualEffects;
  const bonuses = item.passive?.bonuses, values: WornEffects['values'] = {};
  for (const [stat, points] of Object.entries(bonuses ?? {}) as [BonusStat, number][]) {
    if (stat === 'speed') continue; // 旧速度是先攻修正，保持其历史语义。
    values[stat] = stat === 'damage' || stat.endsWith('Damage') ? points * .05
      : stat === 'protection' || stat.endsWith('Protection') ? points / 5 : bonusSteps(bonuses, stat);
  }
  return capWornSource({ values, damageCap: 1, negativeDamageCap: .5, protectionCap: 2, negativeProtectionCap: 2 });
}
/** 各方向正负分别取极值；汇总后再执行通用+通道上限，不能拆件绕过。 */
export function wornEffects(unit: Pick<Combatant, 'gear'> & Partial<Pick<Combatant, 'traitLevelModel'|'itemModel'>>): WornEffects['values'] {
  if (!progression(unit)) return {};
  const best: WornEffects['values'] = {}, worst: WornEffects['values'] = {};
  let damageCap = 0, negativeDamageCap = 0, protectionCap = 0, negativeProtectionCap = 0;
  for (const item of unit.gear ?? []) {
    const effects = wornItemEffects(item);
    for (const [stat, value] of Object.entries(effects.values) as [BonusStat, number][]) {
      if (value > 0) best[stat] = Math.max(best[stat] ?? 0, value);
      if (value < 0) worst[stat] = Math.min(worst[stat] ?? 0, value);
      if ((stat === 'damage' || stat.endsWith('Damage')) && value > 0) damageCap = Math.max(damageCap, effects.damageCap);
      if ((stat === 'damage' || stat.endsWith('Damage')) && value < 0) negativeDamageCap = Math.max(negativeDamageCap, effects.negativeDamageCap);
      if ((stat === 'protection' || stat.endsWith('Protection')) && value > 0) protectionCap = Math.max(protectionCap, effects.protectionCap);
      if ((stat === 'protection' || stat.endsWith('Protection')) && value < 0) negativeProtectionCap = Math.max(negativeProtectionCap, effects.negativeProtectionCap);
    }
  }
  const out: WornEffects['values'] = {};
  for (const key of new Set([...Object.keys(best), ...Object.keys(worst)]) as Set<BonusStat>) out[key] = (best[key] ?? 0) + (worst[key] ?? 0);
  for (const channel of ['kinetic', 'thermal', 'arcane']) for (const [stat, cap, negativeCap] of [['damage', damageCap, negativeDamageCap], ['protection', protectionCap, negativeProtectionCap]] as const) {
    const key = (channel + (stat === 'damage' ? 'Damage' : 'Protection')) as BonusStat;
    out[key] = Math.min(cap, (best[stat] ?? 0) + (best[key] ?? 0)) + Math.max(-negativeCap, (worst[stat] ?? 0) + (worst[key] ?? 0));
  }
  return out;
}
export const wornDamageMultiplier = (unit: Combatant, channel: string): number => 1 + (wornEffects(unit)[(channel + 'Damage') as BonusStat] ?? 0);
export const wornProtection = (unit: Pick<Combatant, 'gear'> & Partial<Pick<Combatant, 'traitLevelModel'>>, channel: string): number => wornEffects(unit)[(channel + 'Protection') as BonusStat] ?? 0;

// 战斗中的佩戴修正：只依赖类型，供修正栈与伤害结算直接引用。

/**
 * V20（items-v2）佩戴修正按道具 L 换算：乘规格等级锚定表里同级单体创伤预算相对 L5 的比例
 * （8/16/24/28/32/36/42/48/56/64 ÷ 32，与淬毒、再生的分级同一组）。L5 不变，正负修正一起换算。
 */
export const wornLevelScale = (power: number): number => traitParameter('woundRatio', power);
/** 一件佩戴道具在这名单位身上实际给的修正；items-v2 以外照写的点数。 */
export function wornItemBonuses(item: Pick<GearItem, 'recipe' | 'passive'>, unit?: Partial<Pick<Combatant, 'itemModel'>>): Enhancements | undefined {
  const bonuses = item.passive?.bonuses;
  if (!bonuses || unit?.itemModel !== 'items-v2') return bonuses;
  const scale = wornLevelScale(item.recipe.power);
  return Object.fromEntries(Object.entries(bonuses).map(([stat, points]) => [stat, (points ?? 0) * scale])) as Enhancements;
}
/** 佩戴品同方向修正取最高（负面取最低），不同道具不叠加。 */
export function gearBonuses(unit: Pick<Combatant, 'gear'> & Partial<Pick<Combatant, 'itemModel' | 'traitLevelModel'>>): Enhancements | undefined {
  const best: Enhancements = {}, worst: Enhancements = {};
  for (const item of unit.gear ?? []) for (const [stat, points] of Object.entries(progression(unit) ? item.passive?.actualEffects ? {} : item.passive?.bonuses?.speed ? { speed: item.passive.bonuses.speed } : {} : wornItemBonuses(item, unit) ?? {}) as [BonusStat, number][]) {
    if (points > 0) best[stat] = Math.max(best[stat] ?? 0, points);
    if (points < 0) worst[stat] = Math.min(worst[stat] ?? 0, points);
  }
  const out: Enhancements = {};
  for (const stat of new Set([...Object.keys(best), ...Object.keys(worst)]) as Set<BonusStat>) {
    const total = (best[stat] ?? 0) + (worst[stat] ?? 0);
    if (total) out[stat] = total;
  }
  return Object.keys(out).length ? out : undefined;
}
/** 单位修正加上佩戴修正，每个方向合计仍限 ±10；没有佩戴修正时原样返回，旧战斗不受影响。 */
export function combatBonuses(unit: Pick<Combatant, 'gear' | 'bonuses'> & Partial<Pick<Combatant, 'itemModel'>>): Enhancements | undefined {
  const gear = gearBonuses(unit);
  if (!gear) return unit.bonuses;
  const out: Enhancements = { ...unit.bonuses };
  for (const [stat, points] of Object.entries(gear) as [BonusStat, number][]) out[stat] = Math.max(-10, Math.min(10, (out[stat] ?? 0) + points));
  return out;
}
