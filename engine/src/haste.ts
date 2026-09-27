import type { Combatant } from './types.js';
import { activeConditionIds, traitSourceActive } from './trait-sources.js';

/** 同类加速取最高效力；一次额外行动不会因刷新、复合或重复施法增加。 */
export function hasteMagnitude(unit: Combatant): number {
  if (unit.rulesVersion !== 'v2' || !activeConditionIds(unit).includes('hasted')) return 0;
  const effects = unit.conditions.filter(c => c.id === 'hasted' && c.dur > 0);
  const sourced = unit.traitSources?.some(s => traitSourceActive(unit, s) && s.conditionIds?.includes('hasted'));
  return Math.max(sourced ? 1 : 0, ...effects.map(c => (c.potency ?? 2) / 2 * (c.magnitude ?? 1)));
}
export const hasteAttackScale = (unit: Combatant) => Math.min(1, Math.max(0, hasteMagnitude(unit) * 0.5));
