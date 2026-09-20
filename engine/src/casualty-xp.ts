import type { Combatant } from './types.js';
import { curveAt } from './data/curves.js';

export const remainingForXp = (unit: Combatant) => unit.scale === 'hero' ? (unit.hp > 0 ? 1 : 0) : unit.hp;
export const initialXpStrength = (units: Combatant[]) => new Map(units.filter(u => u.side !== 'neutral' && !u.summonerId).map(u => [u.id, remainingForXp(u)]));

/** 仅为低于本战既往最低现员的部分计奖；恢复后重复击倒不再入账。 */
export function casualtyXp(unit: Combatant, minimum: Map<string, number>): number {
  if (unit.side === 'neutral' || unit.summonerId) return 0;
  const current = remainingForXp(unit), previous = minimum.get(unit.id) ?? current;
  minimum.set(unit.id, Math.min(previous, current));
  return Math.max(0, previous - current) * curveAt(unit.level).xp;
}
