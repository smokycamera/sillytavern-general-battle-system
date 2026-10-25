import type { Ability } from './types.js';
import { conditionEffectWeight, type SkillModel } from './skill-model.js';
import { CHANNEL_BUFF_CONDITIONS } from './channel-buffs.js';

export const HARD_CONTROLS = new Set(['stunned', 'restrained', 'disarmed', 'silenced']);
export const BUFF_CONDITIONS = new Set(['inspired', 'encouraged', 'empowered', 'blessed', 'hasted', 'confident', ...CHANNEL_BUFF_CONDITIONS]);
/** 投送方式、能量通道和几何形状不占效果预算；skills-v1 起同时改两项属性的状态计两项。 */
export function genericEffectCount(ability: Ability, formula?: SkillModel): number {
  return Math.max(1, ability.effects.filter(e => e.op !== 'damage').reduce((sum, e) => sum + (e.op === 'condition' ? conditionEffectWeight(e.conditionId, formula) : 1), 0));
}
/** 完全失能比专用控制更昂贵；多效果不是同价附送。 */
export function balanceGenericSkill(ability: Ability, formula?: SkillModel): void {
  if (!ability.definitionId?.startsWith('generic:') || ability.customized) return;
  const controls=ability.effects.filter(e=>e.op==='condition'&&HARD_CONTROLS.has(e.conditionId));
  const stun=controls.some(e=>e.op==='condition'&&e.conditionId==='stunned'), area=ability.shape==='burst';
  if (controls.length) {
    ability.cooldown=Math.max(ability.cooldown??0,stun?3:2);
    if(ability.cost?.resource==='SP')ability.cost.amount=Math.max(ability.cost.amount,(area?3:2)+(stun?2:0)+genericEffectCount(ability,formula)-1);
  }
  const restore=ability.effects.find(e=>e.op==='resource'&&e.resource==='SP'&&e.amount>0);
  if(restore?.op==='resource'&&ability.cost?.resource==='SP') {
    // 纯回能允许转移精力；混合技能的其余效果仍须支付净费用。
    ability.cost.amount=Math.max(ability.cost.amount,restore.amount*(area?2:1)+2*(genericEffectCount(ability,formula)-1));
  }
}
