import type { Enhancements, BonusStat } from './enhancements.js';
import type { Combatant } from './types.js';

// 战斗中的佩戴修正：只依赖类型，供修正栈与伤害结算直接引用。

/** 佩戴品同方向修正取最高（负面取最低），不同道具不叠加。 */
export function gearBonuses(unit: Pick<Combatant, 'gear'>): Enhancements | undefined {
  const best: Enhancements = {}, worst: Enhancements = {};
  for (const item of unit.gear ?? []) for (const [stat, points] of Object.entries(item.passive?.bonuses ?? {}) as [BonusStat, number][]) {
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
export function combatBonuses(unit: Pick<Combatant, 'gear' | 'bonuses'>): Enhancements | undefined {
  const gear = gearBonuses(unit);
  if (!gear) return unit.bonuses;
  const out: Enhancements = { ...unit.bonuses };
  for (const [stat, points] of Object.entries(gear) as [BonusStat, number][]) out[stat] = Math.max(-10, Math.min(10, (out[stat] ?? 0) + points));
  return out;
}

