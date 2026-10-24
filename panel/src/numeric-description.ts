import type { Combatant } from '../../engine/src/types.js';
import { BONUS_NAMES, type BonusStat } from '../../engine/src/enhancements.js';
import { multiplierPerPoint, unitStep } from '../../engine/src/numeric-model.js';
import { displayNumber } from '../../engine/src/display-number.js';

/** Actual intrinsic contributions at the unit's T; physical gear is displayed separately. */
export function unitModifierSummary(unit: Combatant): string {
  const signed = (n: number) => (n > 0 ? '+' : '') + displayNumber(n);
  return Object.entries(unit.bonuses ?? {}).filter(([, points]) => points).map(([key, points]) => {
    const stat = key as BonusStat;
    if (stat === 'speed') return '移动' + signed(points! * unit.level / 10) + '、先攻' + signed(unitStep(unit, stat));
    if (['accuracy', 'defense', 'morale'].includes(stat)) return BONUS_NAMES[stat] + signed(unitStep(unit, stat));
    return (stat === 'power' ? '伤害与生命' : BONUS_NAMES[stat]) + signed(points! * multiplierPerPoint(unit.level) * 100) + '%';
  }).join('；');
}
