import type { Combatant } from './types.js';
import { activeTraitIds, activeConditionIds, expireTraitSources } from './trait-sources.js';
import { traitRegistry } from './data/traits.js';
import { standardConditionMap } from './conditions.js';
import { decayBarrier } from './barrier.js';

/** 保持原有轮末到期顺序，只返回实际消失的效果，供小战与会战记录。 */
export function expireRoundEffects(unit: Combatant): string[] {
  const traits = activeTraitIds(unit), conditions = activeConditionIds(unit), barrier = !!unit.barrier;
  expireTraitSources(unit, 'rounds'); decayBarrier(unit);
  const remainingTraits = new Set(activeTraitIds(unit)), remainingConditions = new Set(activeConditionIds(unit));
  const ended = [...traits.filter(id => !remainingTraits.has(id)).map(id => traitRegistry().get(id)?.name ?? id),
    ...conditions.filter(id => !remainingConditions.has(id)).map(id => standardConditionMap().get(id)?.name ?? id)];
  return [...(ended.length ? [`${unit.name} 状态结束：${[...new Set(ended)].join('、')}`] : []), ...(barrier && !unit.barrier ? [`${unit.name} 屏障消失`] : [])];
}
