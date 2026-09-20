import type { Ability } from '../types.js';
import { bonusSteps } from '../enhancements.js';

/** 格子战投送距离；旧技能直接投影，不改已冻结的技能强度、成本或会战阵距。 */
export function gridAbility(ability: Ability): Ability {
  if (ability.delivery !== 'magic' || !ability.range || ability.range.metric !== 'grid') return ability;
  const named: Record<string, number> = { 'bp-arcane-bolt': 7, 'bp-hex-bolt': 7, 'bp-smite': 5, 'bp-firestorm': 6, 'bp-binding': 5 };
  const range = named[ability.definitionId ?? ability.id]
    ?? (ability.recipe?.category === 'magic-single' ? 7 : ability.recipe?.category === 'magic-area' ? 6 : undefined);
  return range === undefined ? ability : { ...ability, range: { ...ability.range, max: Math.max(ability.range.max, range + bonusSteps(ability.bonuses,'range',5)) } };
}
