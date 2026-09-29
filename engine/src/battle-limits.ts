import type { Combatant } from './types.js';
/** Card counts, never headcount/HP. Frozen battles keep their original rules. */
export const MAX_SMALL_UNITS = 32;
export const MAX_BATTLE_UNITS = 64;

/** One definition for legacy, V2 and mixed rosters; no conversion of unit rules. */
export function activeBattleUnits(roster: readonly Combatant[]): Combatant[] {
  return roster.filter(unit => unit.hp > 0 && unit.status === 'ready');
}
/** New starts only. Snapshot restoration must not truncate an already running battle. */
export function assertBattleCapacity(roster: readonly Combatant[], mode: 'small' | 'mass'): void {
  const count = activeBattleUnits(roster).length;
  if (count > MAX_BATTLE_UNITS) throw Error(`本场有${count}张参战单位卡，超过${MAX_BATTLE_UNITS}张上限；请调整本场名单，档案未删除`);
  if (mode === 'small' && count > MAX_SMALL_UNITS) throw Error(`小战最多${MAX_SMALL_UNITS}张单位卡；本场${count}张，请采用会战`);
}
