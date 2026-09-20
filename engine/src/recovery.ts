import type { Combatant, ConditionDef, Trait } from './types.js';
import { activeConditionIds, activeTraitIds } from './trait-sources.js';
import { standardConditionMap } from './conditions.js';
import { traitRegistry } from './data/traits.js';
import { moraleOnDamage } from './morale.js';
import { isCohort, setStrength, personnel, COHORT_REFERENCE } from './combat-model.js';
import {hasMemberHealth,memberHealth,damageMemberGroups,memberRecoveryCapacity,healMemberGroups} from './member-health.js';

type Health = Pick<Combatant, 'hp' | 'base' | 'scale'> & Partial<Pick<Combatant, 'status' | 'rulesVersion' | 'recoverableWounded' | 'combatModel' | 'formation'>>;

export interface MemberDamagePlan { direct:number; targets:number; overflow?:boolean; splash?:number; splashTargets?:number }
/** V4以真实生命结算；旧版继续使用人数换算，不改写进行中的旧战斗。 */
export function applyCombatDamage(unit:Combatant,amount:number,targets=1):number {
  return applyMemberDamage(unit,amount,targets).health;
}
function applyMemberDamage(unit:Combatant,amount:number,targets:number,overflow=false):{health:number;overflow:number} {
  if(!hasMemberHealth(unit))return {health:applyHealthLoss(unit,amount),overflow:0};
  const result=damageMemberGroups(unit,amount,targets,overflow);
  if(result.health)moraleOnDamage(unit,result.health);
  if(result.casualties){
    const wounded=result.casualties+(unit.formation!.woundedRemainder??0);
    unit.recoverableWounded=unit.nonLethal?(unit.recoverableWounded??0)+result.casualties:unit.hp>0?(unit.recoverableWounded??0)+Math.floor(wounded/2):0;
    unit.formation!.woundedRemainder=unit.nonLethal||unit.hp===0?0:wounded%2;
  }
  return result;
}
export function applyDamagePlan(unit:Combatant,plan:MemberDamagePlan):{direct:number;splash:number;overflow:number} {
  const direct=applyMemberDamage(unit,plan.direct,plan.targets,plan.overflow);
  const splash=plan.splash&&plan.splashTargets?applyCombatDamage(unit,plan.splash,plan.splashTargets):0;
  return {direct:direct.health,splash,overflow:direct.overflow};
}

/** 旧档缺省为零；只接受本规则留下的完整人数，不推测历史伤亡。 */
export function validateWounded(unit: Health): void {
  const count = unit.recoverableWounded;
  if (count === undefined) return;
  if (!Number.isSafeInteger(count) || count < 0 || unit.scale === 'hero' && count !== 0
    || count + unit.hp > unit.base.hpMax || (unit.hp <= 0 && unit.status !== 'dying' || unit.status === 'dead') && count !== 0) {
    throw new Error('可救伤兵记录损坏或超出编制上限');
  }
}

/** 实际损失唯一记账入口；V3跨分组累计半数伤兵余量，避免连发逐次取整丢失。 */
export function applyHealthLoss(unit: Combatant, amount: number, v2 = unit.rulesVersion === 'v2'): number {
  const loss = Math.min(unit.hp, Math.max(0, Math.round(amount)));
  setStrength(unit, unit.hp - loss);
  if (v2) moraleOnDamage(unit, loss);
  if (v2 && unit.scale !== 'hero' && loss > 0) {
    if (unit.nonLethal) {
      unit.recoverableWounded = (unit.recoverableWounded ?? 0) + loss;
      if (unit.formation) unit.formation.woundedRemainder = 0;
      return loss;
    }
    const wounded = loss + (isCohort(unit) ? unit.formation?.woundedRemainder ?? 0 : 0);
    unit.recoverableWounded = unit.hp > 0 ? (unit.recoverableWounded ?? 0) + Math.floor(wounded / 2) : 0;
    if (unit.formation) unit.formation.woundedRemainder = unit.hp > 0 ? wounded % 2 : 0;
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

/** 被动再生不花主行动；失能、濒死与离场时暂停，同源或同类再生只取最高。 */
export function regenerationAmount(unit: Combatant, registry: Map<string, Trait> = traitRegistry(), conditions: Map<string, ConditionDef> = standardConditionMap()): number {
  if (unit.status !== 'ready' || unit.hp <= 0 || activeConditionIds(unit).some((id) => conditions.get(id)?.skipTurn)) return 0;
  let amount = 0;
  for (const id of activeTraitIds(unit)) for (const effect of registry.get(id)?.effects ?? []) if (effect.kind === 'regen') amount = Math.max(amount, effect.perRound);
  return Math.min(recoveryCapacity(unit), amount * (isCohort(unit) && unit.scale !== 'hero' ? Math.max(1,personnel(unit)/COHORT_REFERENCE) : 1));
}

/** 明确战外现员更新先消耗已有伤兵；减少现员不凭叙事数字创造可救来源。 */
export function woundedAfterUpdate(unit: Health, hp: number, hpMax: number): number | undefined {
  if (unit.recoverableWounded === undefined) return undefined;
  const remaining = hp <= 0 && unit.status !== 'dying' ? 0 : Math.max(0, unit.recoverableWounded - Math.max(0, hp - unit.hp));
  if (hp + remaining > hpMax) throw new Error('编制上限不足以容纳现员与可救伤兵，不能隐式删除伤兵');
  return remaining;
}

export function woundedLabel(unit: Health): string {
  return (unit.recoverableWounded ?? 0) > 0 ? `可救伤兵${unit.recoverableWounded}，治疗不会补回其余缺员` : '';
}
