import { bonusMultiplier } from './enhancements.js';
import type { Combatant, RulePack } from './types.js';
import { BODY } from './body.js';
import { limitCombatantLife } from './health-limits.js';
import { curveAt, ARCHETYPE_MODS } from './data/curves.js';
import { MEMBER_HEALTH_MODEL, initializeMemberHealth, validateMemberHealth, resizeMemberHealth, memberHealth, memberHealthMax, memberNoun, type MemberHealthGroup } from './member-health.js';
export const COHORT_MODEL = 'cohort-v1' as const;
export const COHORT_REFERENCE = 50;
/** 人数是权威量；hp/base.hpMax仅保留为旧存档/协议和通用控件的兼容投影。 */
export interface FormationStrength { members: number; capacity: number; memberHp: number; woundedRemainder?: number; health?:MemberHealthGroup[] }
export const isCohort = (u: Combatant) => u.combatModel === COHORT_MODEL || u.combatModel === MEMBER_HEALTH_MODEL;
export function validateCombatModel(u: Combatant): void {
  if(u.combatModel===undefined){if(u.formation!==undefined)throw Error('编队人数缺少规则版本');return;}
  if(!isCohort(u))throw Error('未知战斗人数模型');
  if(u.scale==='hero'){if(u.formation!==undefined)throw Error('个体不能携带编队人数');return;}
  const f=u.formation;
  if(!f||!Number.isSafeInteger(f.members)||f.members<0||!Number.isSafeInteger(f.capacity)||f.capacity<1||f.members>f.capacity||!Number.isFinite(f.memberHp)||f.memberHp<=0||f.memberHp>1e6
    ||f.woundedRemainder!==undefined&&![0,1].includes(f.woundedRemainder)||f.members!==u.hp||f.capacity!==u.base.hpMax)throw Error('编队人数、成员耐久或兼容记录损坏');
  if(u.combatModel===MEMBER_HEALTH_MODEL)validateMemberHealth(u);
}
export function personnel(u: Combatant): number { return u.formation?.members ?? u.hp; }
export function memberDurability(u: Combatant): number { return u.formation?.memberHp ?? 10 * BODY[u.body ?? 'human'].hp; }
export function nominalLife(u: Combatant): number { return Math.round((curveAt(u.level).hp * BODY[u.body ?? 'human'].hp + ARCHETYPE_MODS[u.archetype ?? 'infantry'].hp) * bonusMultiplier(u.bonuses, 'health')); }
export function synchronizePersonnel(u: Combatant, fromLegacy = false): void {
  if (!isCohort(u) || u.scale === 'hero') { if (u.scale === 'hero') delete u.formation; return; }
  if (!u.formation) u.formation = {members:u.hp,capacity:u.base.hpMax,memberHp:10*BODY[u.body??'human'].hp};
  if (fromLegacy) { resizeMemberHealth(u,u.hp);u.formation.members=u.hp; u.formation.capacity=u.base.hpMax; }
  const f=u.formation;
  if(f.woundedRemainder!==undefined&&![0,1].includes(f.woundedRemainder))throw Error('编队伤员余量损坏');
  if (!Number.isSafeInteger(f.members)||f.members<0||!Number.isSafeInteger(f.capacity)||f.capacity<1||f.members>f.capacity||!Number.isFinite(f.memberHp)||f.memberHp<=0) throw Error('编队人数或成员耐久损坏');
  u.hp=f.members;u.base.hpMax=f.capacity;
}
export function setStrength(u: Combatant, value: number): void {
  u.hp=Math.max(0,Math.min(u.base.hpMax,Math.round(value)));
  if(isCohort(u)&&u.scale!=='hero'){synchronizePersonnel(u,true);}
}
export function prepareCombatModel(u: Combatant, rules: RulePack, memberHp?:number): void {
  if(!rules.combatModel)return;
  for(const c of u.conditions)if(c.affectedMembers!==undefined&&(!Number.isFinite(c.affectedMembers)||c.affectedMembers<0||c.affectedMembers>1e9))throw Error('状态波及人数损坏');
  if(u.combatModel!==undefined||u.formation!==undefined)validateCombatModel(u);
  // 旧快照依旧版本运行；只有显式进入V4才创建成员生命，不能在恢复时重置伤损。
  const fresh=!u.formation;
  u.combatModel=rules.combatModel;synchronizePersonnel(u);
  if(fresh&&u.formation&&rules.combatModel===MEMBER_HEALTH_MODEL)u.formation.memberHp=memberHp??nominalLife(u);
  if(rules.combatModel===MEMBER_HEALTH_MODEL){limitCombatantLife(u);initializeMemberHealth(u);}
}
/** 本地医疗按实际执行单位换算；物品为单份，不随服用者人数放大。 */
export function healingYield(source: Combatant, target: Combatant, amount: number, item = false): number {
  if(!isCohort(target)||target.scale==='hero')return amount;
  const teams=!item&&source.scale!=='hero'?Math.min(personnel(source),Math.max(1,personnel(source)/COHORT_REFERENCE)*10):1;
  return amount*teams/(target.combatModel===MEMBER_HEALTH_MODEL?1:memberDurability(target));
}
export function strengthDescription(u: Combatant): string {
  return u.scale==='hero'?`生命 ${u.hp}/${u.base.hpMax}`:u.combatModel===MEMBER_HEALTH_MODEL?`现员 ${personnel(u)}/${u.base.hpMax}${memberNoun(u)} · 总生命 ${memberHealth(u)}/${memberHealthMax(u)} · 单位生命上限 ${memberDurability(u)}`:isCohort(u)?`现员 ${personnel(u)}/${u.formation?.capacity??u.base.hpMax} · 成员耐久 ${memberDurability(u)}`:`人数 ${u.hp}/${u.base.hpMax}`;
}
