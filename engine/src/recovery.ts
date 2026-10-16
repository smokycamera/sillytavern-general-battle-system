import type { Combatant, ConditionDef, Trait } from './types.js';
import { absorbBarrier } from './barrier.js';
import { activeConditionIds, activeTraitIds } from './trait-sources.js';
import { standardConditionMap } from './conditions.js';
import { traitRegistry } from './data/traits.js';
import { moraleOnDamage, spendIndomitable } from './morale.js';
import { isCohort, setStrength, personnel, COHORT_REFERENCE } from './combat-model.js';
import {hasMemberHealth,memberHealth,damageMemberGroups,memberRecoveryCapacity,healMemberGroups} from './member-health.js';
import { overmatchMultiplier } from './power-anchors.js';
import { traitValue } from './trait-levels.js';
import { phase2Traits } from './trait-level-model.js';
import { effectiveTraitLevel } from './trait-sources.js';
import { traitParameter } from './trait-parameters.js';
import { healingGradeMultiplier } from './healing.js';

type Health = Pick<Combatant, 'hp' | 'base' | 'scale'> & Partial<Pick<Combatant, 'status' | 'rulesVersion' | 'recoverableWounded' | 'combatModel' | 'formation'>>;

/** 保留攻击规格和已乘倍率，屏障可在同时行动实际结算前才获得。 */
export interface DamageOvermatch { power?:number; channel:import('./types.js').DamageChannel; penetration:number; area:boolean; canBlock:boolean; multiplier:number; curve?:import('./types.js').RulePack['overmatchCurve'] }
export interface MemberDamagePlan { direct:number; targets:number; overflow?:boolean; splash?:number; splashTargets?:number; incomingDirect?:number; incomingSplash?:number; overmatch?:DamageOvermatch }
function barrierRatio(unit:Combatant,context?:DamageOvermatch):number {
  if(!unit.barrier||!context)return 1;
  return Math.min(1,overmatchMultiplier(context.power,unit,context.channel,context.penetration,context.area,context.canBlock,true,context.curve)/context.multiplier);
}
/** V4以真实生命结算；旧版继续使用人数换算，不改写进行中的旧战斗。 */
export function applyCombatDamage(unit:Combatant,amount:number,targets=1,overmatch?:DamageOvermatch):number {
  return applyMemberDamage(unit,amount,targets,false,overmatch).health;
}
/** 伤亡中可救伤兵的比例：常规每2名救1名；医护编队每4名救3名。 */
function woundedShare(unit: Combatant): [number, number] {
  return unit.rulesVersion === 'v2' && unit.scale !== 'hero' && activeTraitIds(unit).includes('medic') ? [3, 4] : [1, 2];
}
/** 余量是尚未凑满一组的伤亡；只按累计总数取整，连续小额伤亡不会丢失或重复。 */
function woundedFromLoss(unit: Combatant, loss: number, remainder: number): { recoverable: number; remainder: number } {
  if (phase2Traits(unit)) {
    const level = effectiveTraitLevel(unit, 'medic'), percent = level ? traitParameter('medicRescue', level) : 50;
    const total = (unit.woundedPercentRemainder ?? 0) + loss * percent;
    unit.woundedPercentRemainder = unit.hp > 0 ? total % 100 : 0;
    return { recoverable: Math.floor(total / 100), remainder }; // 旧余量封存
  }
  const [kept, group] = woundedShare(unit), carried = remainder % group, total = loss + carried;
  return { recoverable: Math.floor(kept * total / group) - Math.floor(kept * carried / group), remainder: total % group };
}
function applyMemberDamage(unit:Combatant,amount:number,targets:number,overflow=false,overmatch?:DamageOvermatch):{health:number;overflow:number} {
  if(!hasMemberHealth(unit))return {health:applyHealthLoss(unit,amount,unit.rulesVersion==='v2',overmatch),overflow:0};
  const result=damageMemberGroups(unit,targets > 0 ? absorbBarrier(unit,amount,barrierRatio(unit,overmatch)) : 0,targets,overflow);
  if(result.health)moraleOnDamage(unit,result.health);
  if(result.casualties){
    const wounded=woundedFromLoss(unit,result.casualties,unit.formation!.woundedRemainder??0);
    unit.recoverableWounded=unit.nonLethal?(unit.recoverableWounded??0)+result.casualties:unit.hp>0?(unit.recoverableWounded??0)+wounded.recoverable:0;
    unit.formation!.woundedRemainder=unit.nonLethal||unit.hp===0?0:wounded.remainder;
  }
  return result;
}
export function applyDamagePlan(unit:Combatant,plan:MemberDamagePlan):{direct:number;splash:number;overflow:number} {
  const direct=applyMemberDamage(unit,unit.barrier ? plan.incomingDirect ?? plan.direct : plan.direct,plan.targets,plan.overflow,plan.overmatch);
  const splash=plan.splash&&plan.splashTargets?applyCombatDamage(unit,unit.barrier ? plan.incomingSplash ?? plan.splash : plan.splash,plan.splashTargets,plan.overmatch):0;
  return {direct:direct.health,splash,overflow:direct.overflow};
}

/** 旧档缺省为零；只接受本规则留下的完整人数，不推测历史伤亡。 */
export function validateWounded(unit: Health): void {
  validateRecoveryRemainders(unit as Combatant);
  const count = unit.recoverableWounded;
  if (count === undefined) return;
  if (!Number.isSafeInteger(count) || count < 0 || unit.scale === 'hero' && count !== 0
    || count + unit.hp > unit.base.hpMax || (unit.hp <= 0 && unit.status !== 'dying' || unit.status === 'dead') && count !== 0) {
    throw new Error('可救伤兵记录损坏或超出编制上限');
  }
}

/** 实际损失唯一记账入口；V3跨分组累计半数伤兵余量，避免连发逐次取整丢失。 */
export function applyHealthLoss(unit: Combatant, amount: number, v2 = unit.rulesVersion === 'v2', overmatch?:DamageOvermatch): number {
  let loss = Math.min(unit.hp, absorbBarrier(unit, amount,barrierRatio(unit,overmatch)));
  // 不屈（个体）：每战一次，致命伤以1点生命坚持。
  if (v2 && unit.scale === 'hero' && loss > 0 && loss >= unit.hp && unit.status === 'ready' && spendIndomitable(unit)) loss = unit.hp - 1;
  setStrength(unit, unit.hp - loss);
  if (v2) moraleOnDamage(unit, loss);
  if (v2 && unit.scale !== 'hero' && loss > 0) {
    if (unit.nonLethal) {
      unit.recoverableWounded = (unit.recoverableWounded ?? 0) + loss;
      if (unit.formation) unit.formation.woundedRemainder = 0;
      return loss;
    }
    const wounded = woundedFromLoss(unit, loss, isCohort(unit) ? unit.formation?.woundedRemainder ?? 0 : 0);
    unit.recoverableWounded = unit.hp > 0 ? (unit.recoverableWounded ?? 0) + wounded.recoverable : 0;
    if (unit.formation) unit.formation.woundedRemainder = unit.hp > 0 ? wounded.remainder : 0;
  }
  return loss;
}

/** 已有伤口/伤兵决定恢复上限，普通恢复不能复活或补充永久缺员。 */
export function recoveryCapacity(unit: Health): number {
  if (unit.status === 'dead' || unit.status === 'fled' || unit.hp <= 0 && unit.status !== 'dying') return 0;
  if(hasMemberHealth(unit))return memberRecoveryCapacity(unit as Combatant);
  const missing = Math.max(0, unit.base.hpMax - unit.hp);
  return unit.rulesVersion === 'v2' && unit.scale !== 'hero' ? Math.min(missing, unit.recoverableWounded ?? 0) : missing;
}

export function applyRecovery(unit: Combatant, amount: number): number {
  if(hasMemberHealth(unit)){
    const restored=healMemberGroups(unit,Math.min(recoveryCapacity(unit),Math.max(0,Math.floor(amount))));
    if(unit.status==='dying'&&unit.hp>0)unit.status='ready';return restored;
  }
  const restored = Math.min(recoveryCapacity(unit), Math.max(0, Math.floor(amount)));
  setStrength(unit, unit.hp + restored);
  if (unit.rulesVersion === 'v2' && unit.scale !== 'hero' && restored > 0) unit.recoverableWounded = (unit.recoverableWounded ?? 0) - restored;
  if (unit.status === 'dying' && unit.hp > 0) unit.status = 'ready';
  return restored;
}

/** 吸血：造成实际生命伤害后回复其中25%；非生物与载具目标不提供，编队只救回已有的可救伤兵。 */
export function lifestealRecovery(attacker: Combatant, target: Combatant, lifeDamage: number): number {
  const amount = lifestealAmount(attacker, target, lifeDamage);
  return amount > 0 ? applyRecovery(attacker, amount) : 0;
}
/** 无副作用的恢复估计供面板/AI 使用；输入须为护盾及过量截断后的生命伤害。 */
export function lifestealAmount(attacker: Combatant, target: Combatant, lifeDamage: number): number {
  if (attacker.rulesVersion !== 'v2' || !(lifeDamage > 0) || attacker.status !== 'ready' || attacker.hp <= 0 || target.body === 'vehicle'
    || !activeTraitIds(attacker).includes('lifesteal') || activeTraitIds(target).includes('inorganic')) return 0;
  return Math.min(recoveryCapacity(attacker), Math.floor(lifeDamage * traitValue(attacker, 'lifesteal', 'lifestealRatio', .25)));
}
/** 被动再生不花主行动；失能、濒死与离场时暂停，同源或同类再生只取最高。 */
export function regenerationAmount(unit: Combatant, registry: Map<string, Trait> = traitRegistry(), conditions: Map<string, ConditionDef> = standardConditionMap()): number {
  if (unit.status !== 'ready' || unit.hp <= 0 || activeConditionIds(unit).some((id) => conditions.get(id)?.skipTurn)) return 0;
  let amount = 0;
  for (const id of activeTraitIds(unit)) for (const effect of registry.get(id)?.effects ?? []) if (effect.kind === 'regen') amount = Math.max(amount, effect.perRound);
  if (phase2Traits(unit) && amount > 0) {
    const level = effectiveTraitLevel(unit, 'regen');
    amount = 3 * traitParameter('woundRatio', level) * healingGradeMultiplier(level, unit.level, unit.healingModel);
  }
  return Math.min(recoveryCapacity(unit), amount * (isCohort(unit) && unit.scale !== 'hero' ? Math.max(1,personnel(unit)/COHORT_REFERENCE) : 1) + (phase2Traits(unit) && amount > 0 ? (unit.regenerationRemainder ?? 0) / 10000 : 0));
}

/** amount为本周期只读预算（含旧余量）；不能由额外动作或预览调用此提交入口。 */
export function settleRegeneration(unit: Combatant, amount: number): number {
  if (!phase2Traits(unit)) return applyRecovery(unit, amount);
  if (!activeTraitIds(unit).includes('regen') || ['dead', 'fled'].includes(unit.status) || recoveryCapacity(unit) <= 0) { unit.regenerationRemainder = 0; return 0; }
  if (amount <= 0) return 0; // 失能/临时濒死暂停，保留不足1的既有余量
  const ticks = Math.round(amount * 10000), restored = applyRecovery(unit, Math.floor(ticks / 10000));
  unit.regenerationRemainder = recoveryCapacity(unit) > 0 ? ticks % 10000 : 0;
  return restored;
}

export function validateRecoveryRemainders(unit: Combatant): void {
  for (const [key, max] of [['regenerationRemainder', 9999], ['woundedPercentRemainder', 99]] as const) {
    const value = unit[key]; if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > max)) throw Error('恢复余量记录损坏');
  }
}

/** 明确战外现员更新先消耗已有伤兵；减少现员不凭叙事数字创造可救来源。 */
export function woundedAfterUpdate(unit: Health, hp: number, hpMax: number): number | undefined {
  if (unit.recoverableWounded === undefined) return undefined;
  const remaining = hp <= 0 && unit.status !== 'dying' ? 0 : Math.max(0, unit.recoverableWounded - Math.max(0, hp - unit.hp));
  if (hp + remaining > hpMax) throw new Error('编制上限不足以容纳现员与可救伤兵，不能隐式删除伤兵');
  return remaining;
}

/** brief 只给伤兵数：战报摘要随附的单位提示词已说明治疗不补回永久缺员。 */
export function woundedLabel(unit: Health, brief = false): string {
  return (unit.recoverableWounded ?? 0) > 0 ? `可救伤兵${unit.recoverableWounded}${brief ? '' : '，治疗不会补回其余缺员'}` : '';
}
