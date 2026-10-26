import type { Combatant } from './types.js';
import { activeTraitIds, activeConditionIds, expireTraitSources } from './trait-sources.js';
import { traitRegistry } from './data/traits.js';
import { standardConditionMap } from './conditions.js';
import { decayBarrier } from './barrier.js';
import { settleStoryRoundEndEffects } from './round-end-effects.js';

/** 新来源先触发最后一次轮末操作，再按原顺序到期；旧来源没有新增触发。 */
export function expireRoundEffects(unit: Combatant): string[] {
  const triggered = settleStoryRoundEndEffects(unit);
  const traits = activeTraitIds(unit), conditions = activeConditionIds(unit), barrier = !!unit.barrier;
  expireTraitSources(unit, 'rounds'); decayBarrier(unit);
  const remainingTraits = new Set(activeTraitIds(unit)), remainingConditions = new Set(activeConditionIds(unit));
  const ended = [...traits.filter(id => !remainingTraits.has(id)).map(id => traitRegistry().get(id)?.name ?? id),
    ...conditions.filter(id => !remainingConditions.has(id)).map(id => standardConditionMap().get(id)?.name ?? id)];
  return [...triggered, ...(ended.length ? [`${unit.name} 状态结束：${[...new Set(ended)].join('、')}`] : []), ...(barrier && !unit.barrier ? [`${unit.name} 屏障消失`] : [])];
}
