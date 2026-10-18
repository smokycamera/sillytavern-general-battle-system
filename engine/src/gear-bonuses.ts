import type { Enhancements, BonusStat } from './enhancements.js';
import type { Combatant } from './types.js';
import type { GearItem } from './items.js';
import { traitParameter } from './trait-parameters.js';

// 战斗中的佩戴修正：只依赖类型与纯数据，供修正栈与伤害结算直接引用。

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
export function gearBonuses(unit: Pick<Combatant, 'gear'> & Partial<Pick<Combatant, 'itemModel'>>): Enhancements | undefined {
  const best: Enhancements = {}, worst: Enhancements = {};
  for (const item of unit.gear ?? []) for (const [stat, points] of Object.entries(wornItemBonuses(item, unit) ?? {}) as [BonusStat, number][]) {
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
