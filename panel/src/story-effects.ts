import type { ActiveCondition, Combatant } from '../../engine/src/types.js';
import { compileSkill } from '../../engine/src/skill-catalog.js';
import { skillMechanismFromId } from '../../engine/src/data/skill-mechanisms.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { V39_OVERFLOW_D20 } from '../../engine/src/rules.js';
import { bonusSteps } from '../../engine/src/enhancements.js';
import { grantTraitSource, type TraitDuration, type TraitSourceInput } from '../../engine/src/trait-sources.js';
import type { StoryRoundEndEffect } from '../../engine/src/story-effect-types.js';
import { grantBarrier } from '../../engine/src/barrier.js';
import { storySkillSpec } from './story-spec.js';
import type { SkillSpec } from './tags.js';

/** 持续部分共用状态结算；治疗、士气、精力与解除操作冻结后在战斗轮末触发。 */
export function compileStoryEffect(spec: SkillSpec, id: string, duration: TraitDuration): TraitSourceInput {
  const mechanism = skillMechanismFromId(spec.blueprintId);
  if (!mechanism || !['buff', 'debuff'].includes(mechanism.category) || spec.level === undefined) throw Error('effects需要明确等级的buff/debuff效果规格');
  if (mechanism.area) throw Error('范围效果需要战场与落点，请通过战斗技能施加');
  const ability = compileSkill({ id: spec.blueprintId, name: spec.name, bonuses: spec.bonuses }, spec.level, id, V39_OVERFLOW_D20.skillModel);
  const carrier = { id, combatModel: V39_OVERFLOW_D20.combatModel, damageModel: V39_OVERFLOW_D20.damageModel, skillModel: V39_OVERFLOW_D20.skillModel, abilities: [ability], abilityState: [] } as unknown as Combatant;
  upgradeCombatSkills(carrier);
  // 持续毒伤的技能附带首击；剧情只授予持续状态，不额外结算该次攻击。
  const effects = ability.effects.filter(e => e.op !== 'damage');
  for (const effect of effects) {
    if (effect.op === 'zone') throw Error('区域效果需要战场与落点，请通过战斗技能施加');
    if (effect.op === 'push' || effect.op === 'move') throw Error('位移效果需要战场、施术者与落点，请通过战斗技能施加');
    if (effect.op === 'summon') throw Error('召唤需要战场、召唤者与落点；剧情新单位请通过spawn建档');
  }
  if (effects.some(e => e.op === 'condition' && ['taunted', 'charmed'].includes(e.conditionId))) throw Error('嘲讽与魅惑需要明确施术者，请通过战斗技能施加');
  const adjusted: TraitDuration = duration.kind === 'permanent' ? duration : { ...duration, count: Math.max(1, Math.min(99, duration.count + bonusSteps(spec.bonuses, 'duration', 5))) };
  const dur = adjusted.kind === 'rounds' ? adjusted.count : 99, conditions: ActiveCondition[] = [], traitIds: string[] = [], traitLevels: Record<string, number> = {}, roundEndEffects: StoryRoundEndEffect[] = [];
  let barrier: TraitSourceInput['barrier'];
  for (const effect of effects) {
    if (effect.op === 'condition') conditions.push({ id: effect.conditionId, dur,
      ...(effect.potency !== undefined ? { potency: effect.potency } : {}), ...(effect.magnitude !== undefined ? { magnitude: effect.magnitude } : {}),
      ...(effect.defensePower !== undefined ? { defensePower: effect.defensePower } : {}), ...(effect.damageChannel ? { damageChannel: effect.damageChannel } : {}) });
    else if (effect.op === 'trait') { traitIds.push(effect.traitId); if (effect.level !== undefined) traitLevels[effect.traitId] = effect.level; }
    else if (effect.op === 'barrier') barrier = { amount: effect.amount, defensePower: effect.defensePower };
    else if (effect.op === 'heal') {
      if (effect.amount === undefined) throw Error('剧情治疗需要明确的恢复量');
      roundEndEffects.push({ op: 'heal', amount: effect.amount, ...(effect.power !== undefined ? { power: effect.power } : {}) });
    } else if (effect.op === 'morale' || effect.op === 'resource' || effect.op === 'dispel') roundEndEffects.push({ ...effect });
  }
  if (!traitIds.length && !conditions.length && !barrier && !roundEndEffects.length) throw Error('effects没有可结算的效果');
  return { id, name: ability.name, kind: 'effect', specification: storySkillSpec(ability), traitIds: [...new Set(traitIds)], traitLevels,
    conditions, conditionIds: conditions.map(c => c.id), duration: adjusted, ...(barrier ? { barrier } : {}), ...(roundEndEffects.length ? { roundEndEffects } : {}) };
}

export function grantStoryEffects(unit: Combatant, effects: SkillSpec[], duration: TraitDuration, operationId: string): void {
  for (const [index, spec] of effects.entries()) {
    const source = compileStoryEffect(spec, `effect:${operationId}:${index}`, duration);
    const replay = unit.traitSources?.some(s => s.id === source.id);
    grantTraitSource(unit, source);
    if (replay) continue;
    if (source.barrier) {
      const target = { ...unit, barrierModel: V39_OVERFLOW_D20.barrierModel };
      grantBarrier(target, source.barrier.amount, source.duration.kind === 'rounds' ? source.duration.count : 99, source.id, source.barrier.defensePower);
      unit.barrier = target.barrier;
      unit.barrierModel = target.barrierModel;
    }
  }
}
