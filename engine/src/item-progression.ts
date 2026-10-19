import type { Ability, EffectOp } from './types.js';
import type { Enhancements } from './enhancements.js';
import { bonusMultiplier, bonusSteps } from './enhancements.js';
import { conditionEffectWeight } from './skill-model.js';
import { gradedTraitCost } from './trait-parameters.js';
import { isGradedTrait } from './data/traits.js';
import { skillMoveReach } from './skill-movement.js';
import { GEAR_G, ITEM_HEAL, ITEM_BARRIER, ITEM_MORALE, ITEM_DURATION, ITEM_PROGRESSION, ITEM_STACKING, REVISED_ITEM_HEAL, REVISED_ITEM_BARRIER, type ItemProgressionModel } from './progression.js';

const hard = new Set(['stunned','restrained','disarmed','silenced']);
const binary = new Set(['taunted','charmed','confused','blinded']);
const dot = new Set(['poisoned','bleeding','burning']);
/** 普通技能先编译一次；只替换本设计指定的主动道具预算，不改武器和技能常量。 */
export function applyItemProgression(ability: Ability, bonuses: Enhancements | undefined, version: ItemProgressionModel = ITEM_STACKING): void {
  const heals = version === ITEM_PROGRESSION ? ITEM_HEAL : REVISED_ITEM_HEAL, barriers = version === ITEM_PROGRESSION ? ITEM_BARRIER : REVISED_ITEM_BARRIER;
  const power = ability.power!, i = power - 1, area = ability.shape === 'burst';
  const payload = [...new Map(ability.effects.flatMap(e => e.op === 'zone' ? e.effects ?? [] : [e]).map(e => [JSON.stringify(e), e])).values()];
  const weight = Math.max(1, payload.filter(e => e.op !== 'damage').reduce((n,e) => n + (e.op === 'condition' ? conditionEffectWeight(e.conditionId, 'skills-v2') : e.op === 'trait' && isGradedTrait(e.traitId) ? Math.max(1, Math.ceil(gradedTraitCost(e.traitId, power) / 3)) : 1), ability.effects.filter(e => e.op === 'zone').length));
  const duration = Math.max(1, ITEM_DURATION[i]! + bonusSteps(bonuses, 'duration', 5));
  const effect = (e: EffectOp, zone = false): EffectOp => {
    if (e.op === 'heal') return { op: 'heal', power, amount: Math.max(1, heals[i]! * (zone ? 1 : area ? .65 : 1) * bonusMultiplier(bonuses, 'healing') / weight) };
    if (e.op === 'barrier') return { ...e, amount: Math.max(1, Math.round(barriers[i]! * (area ? .65 : 1) * bonusMultiplier(bonuses, 'power') / weight)), dur: duration, defensePower: power };
    if (e.op === 'resource') return { ...e, amount: Math.sign(e.amount) * Math.max(0, power + bonusSteps(bonuses, 'resource', 5)) };
    if (e.op === 'morale') return { ...e, amount: Math.sign(e.amount) * ITEM_MORALE[i]! * bonusMultiplier(bonuses, 'morale') };
    if (e.op === 'dispel') return { ...e, count: power };
    if (e.op === 'trait') return { ...e, level: isGradedTrait(e.traitId) ? power : undefined, dur: duration };
    if (e.op === 'push') return { ...e, force: power };
    if (e.op === 'move') return { ...e, reach: skillMoveReach(e.mode, 1) + i, massReach: 1 + i };
    if (e.op === 'condition') {
      if (dot.has(e.conditionId)) return e;
      if (hard.has(e.conditionId) || binary.has(e.conditionId)) return { ...e, saveDC: Math.max(1, 8 + power - (hard.has(e.conditionId) ? 2 * Math.max(0, weight - 1) : 0) - (e.conditionId === 'stunned' ? 2 : 0) + bonusSteps(bonuses, 'accuracy')), ...(hard.has(e.conditionId) ? { dur: 1 } : {}), magnitude: 1 };
      // L5 无强化单项的原始幅度为1；现有效果权重按sqrt分摊一次。
      return { ...e, magnitude: GEAR_G[i]! * bonusMultiplier(bonuses, 'power') / Math.sqrt(weight), dur: duration };
    }
    if (e.op === 'zone') return { ...e, itemEffectModel: version,
      // 区域治疗原有分摊为每周期独立预算，无额外范围65%折扣。
      ...(e.kind === 'healing' ? { amount: heals[i]! * bonusMultiplier(bonuses, 'healing') / weight } : {}),
      ...(e.effects ? { effects: e.effects.map(child => effect(child, true) as NonNullable<typeof e.effects>[number]) } : {}) };
    return e;
  };
  ability.effects = ability.effects.map(e => effect(e));
  ability.itemEffectModel = version;
  if (ability.effects.length && ability.effects.every(e => e.op === 'move') && ability.range) ability.range.max = Math.max(...ability.effects.map(e => e.op === 'move' ? e.reach : 0));
}
