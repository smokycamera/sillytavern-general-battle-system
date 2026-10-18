import type { Ability, Combatant } from '../types.js';
import { bonusSteps } from '../enhancements.js';
import { isArmsV2 } from '../arms-model.js';

/** 格子战投送距离；旧技能直接投影，不改已冻结的技能强度、成本或会战阵距。 */
export function gridAbility(ability: Ability, armsModel?: Combatant['armsModel']): Ability {
  if (!ability.range || ability.range.metric !== 'grid') return ability;
  // R26 增益、减益（含战技）在 V18 小战射程 5 格；只移动自己的技能与速用道具不变。
  const support = isArmsV2(armsModel) && ['buff', 'debuff'].includes(ability.recipe?.category ?? '') && !ability.itemQuick && !ability.effects.every(e => e.op === 'move');
  if (ability.delivery !== 'magic' && !support) return ability;
  const named: Record<string, number> = { 'bp-arcane-bolt': 7, 'bp-hex-bolt': 7, 'bp-smite': 5, 'bp-firestorm': 6, 'bp-binding': 5 };
  const range = named[ability.definitionId ?? ability.id]
    ?? (ability.recipe?.category === 'magic-single' ? 7 : ability.recipe?.category === 'magic-area' ? 6 : support ? 5 : undefined);
  return range === undefined ? ability : { ...ability, range: { ...ability.range, max: Math.max(ability.range.max, range + (ability.effects.some(e=>e.op==='summon') ? 0 : bonusSteps(ability.bonuses,'range',5))) } };
}
