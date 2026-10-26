import type { Combatant } from './types.js';
import { traitSourceActive } from './trait-sources.js';
import { STORY_ROUND_END_IDS, storyRoundEndId, type StoryRoundEndEffect, type StoryRoundEndId } from './story-effect-types.js';
import { resolveHealingBudget } from './healing.js';
import { applyRecovery } from './recovery.js';
import { changeMorale } from './morale.js';
import { resourceRound } from './resources.js';
import { skillResourceChange } from './skill-runtime.js';
import { applyDispel, dispelCandidates } from './skill-effects.js';
import { displayNumber } from './display-number.js';

const NO_EFFECTS: readonly string[] = Object.freeze([]);

/** 只由完整战斗轮边界调用。没有轮末来源的单位不分配集合，也不解析/重编译规格。 */
export function settleStoryRoundEndEffects(unit: Combatant): readonly string[] {
  if (unit.hp <= 0 || unit.status === 'dead' || unit.status === 'fled' || !unit.traitSources?.some(s => s.roundEndEffects?.length && traitSourceActive(unit, s))) return NO_EFFECTS;
  const strongest = new Map<StoryRoundEndId, { effect: StoryRoundEndEffect; value: number; name: string }>();
  for (const source of unit.traitSources) {
    if (!source.roundEndEffects || !traitSourceActive(unit, source)) continue;
    for (const effect of source.roundEndEffects) {
      // 无施术者的持续来源按一份恢复预算；不把受术者人数或医护借作施术加成。
      const value = effect.op === 'heal' ? resolveHealingBudget({ source: unit, target: unit, delivery: 'zone', recoveryModel: unit.recoveryModel,
        sourceMedicSnapshot: 1, baseAmount: effect.amount, power: effect.power }) : effect.op === 'dispel' ? effect.count : Math.abs(effect.amount);
      const id = storyRoundEndId(effect);
      if (value > (strongest.get(id)?.value ?? -1)) strongest.set(id, { effect, value, name: source.name });
    }
  }
  const messages: string[] = [];
  // 同方向同类来源取强，正负分别结算；净化/驱散最后执行，结果与来源数组顺序无关。
  for (const id of STORY_ROUND_END_IDS) {
    const selected = strongest.get(id);
    if (!selected) continue;
    const { effect, value, name } = selected, label = `${unit.name} ${name}：`;
    if (effect.op === 'heal') {
      const restored = applyRecovery(unit, value);
      if (restored) messages.push(label + '恢复' + displayNumber(restored) + '生命');
    } else if (effect.op === 'morale') {
      const changed = changeMorale(unit, effect.amount);
      if (changed) messages.push(label + '士气' + (changed > 0 ? '+' : '') + displayNumber(changed));
    } else if (effect.op === 'resource') {
      const changed = skillResourceChange(unit, effect);
      if (changed) {
        unit.resources[effect.resource] = resourceRound((unit.resources[effect.resource] ?? 0) + changed);
        messages.push(label + '精力' + (changed > 0 ? '+' : '') + displayNumber(changed));
      }
    } else {
      const chosen = dispelCandidates(unit, effect);
      if (chosen.length) { applyDispel(unit, chosen); messages.push(label + '解除' + chosen.map(entry => entry.name).join('、')); }
    }
  }
  return messages;
}
