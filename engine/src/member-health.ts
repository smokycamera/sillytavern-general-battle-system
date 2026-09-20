import type {Combatant} from './types.js';
import { capSingleLife } from './health-limits.js';

/** 同生命成员合并存储，人数再大也不为每个成员创建运行对象。 */
export interface MemberHealthGroup { hp:number; count:number }
export const MEMBER_HEALTH_MODEL='cohort-v2' as const;
export const hasMemberHealth=(unit:Partial<Combatant>):boolean=>unit.combatModel===MEMBER_HEALTH_MODEL&&unit.scale!=='hero';
export const memberNoun=(unit:Pick<Combatant,'body'>)=>unit.body==='vehicle'?'辆':'人';
export function memberHealth(unit:Partial<Combatant>):number {
  return hasMemberHealth(unit)?(unit.formation?.health??[]).reduce((n,g)=>n+g.hp*g.count,0):unit.hp??0;
}
export function memberHealthMax(unit:Partial<Combatant>):number {
  return hasMemberHealth(unit)?(unit.base?.hpMax??0)*(unit.formation?.memberHp??1):unit.base?.hpMax??0;
}
export function mergeHealth(groups:MemberHealthGroup[]):MemberHealthGroup[] {
  const counts=new Map<number,number>();
  for(const g of groups)if(g.count>0&&g.hp>0)counts.set(g.hp,(counts.get(g.hp)??0)+g.count);
  return [...counts].sort((a,b)=>a[0]-b[0]).map(([hp,count])=>({hp,count}));
}
export function validateMemberHealth(unit:Combatant):void {
  const f=unit.formation;if(!hasMemberHealth(unit)||!f)return;
  if(!Array.isArray(f.health)||f.health.some(g=>!Number.isSafeInteger(g.hp)||g.hp<=0||g.hp>f.memberHp||!Number.isSafeInteger(g.count)||g.count<=0)
    ||f.health.reduce((n,g)=>n+g.count,0)!==f.members)throw Error('成员生命分组损坏或与现员不一致');
}
export function initializeMemberHealth(unit:Combatant):void {
  const f=unit.formation;if(!hasMemberHealth(unit)||!f)return;
  f.health??=f.members>0?[{hp:f.memberHp,count:f.members}]:[];
  validateMemberHealth(unit);f.health=mergeHealth(f.health);
}
/** 外部明确调整现员时保留已有成员伤损；新补员才以完整成员生命加入。 */
export function resizeMemberHealth(unit:Combatant,members:number):void {
  const f=unit.formation;if(!hasMemberHealth(unit)||!f)return;
  let groups=mergeHealth(f.health??[]),count=groups.reduce((n,g)=>n+g.count,0);
  if(members>count)groups.push({hp:f.memberHp,count:members-count});
  else if(members<count){let remove=count-members;groups=groups.map(g=>{const n=Math.min(g.count,remove);remove-=n;return {...g,count:g.count-n};});}
  f.health=mergeHealth(groups);
}
export function setMemberMaximum(unit:Combatant,max:number):void {
  if(!Number.isSafeInteger(max)||max<1)throw Error('成员最大生命必须为正整数');
  max = capSingleLife(max);
  if(!unit.formation)return;
  unit.formation.memberHp=max;
  if(unit.formation.health)unit.formation.health=mergeHealth(unit.formation.health.map(g=>({hp:Math.min(g.hp,max),count:g.count})));
}
/** 先在命中成员间分配伤害；武器可显式开启同编队余伤传递，持续伤害默认不传递。 */
export function damageMemberGroups(unit:Combatant,amount:number,targets:number,overflow=false):{health:number;casualties:number;overflow:number} {
  const f=unit.formation!;initializeMemberHealth(unit);
  const count=Math.min(unit.hp,Math.max(0,Math.floor(targets))),damage=Math.max(0,Math.floor(amount));
  if(!count||!damage)return {health:0,casualties:0,overflow:0};
  const per=Math.floor(damage/count);let extra=damage%count,remaining=count,health=0,casualties=0;
  const groups:MemberHealthGroup[]=[];
  const hit=(hp:number,n:number,dose:number)=>{if(!n)return;const after=Math.max(0,hp-dose);health+=(hp-after)*n;if(after)groups.push({hp:after,count:n});else casualties+=n;};
  for(const g of f.health!){
    const n=Math.min(remaining,g.count),higher=Math.min(extra,n);remaining-=n;extra-=higher;
    hit(g.hp,higher,per+1);hit(g.hp,n-higher,per);
    if(g.count>n)groups.push({hp:g.hp,count:g.count-n});
  }
  f.health=mergeHealth(groups);
  let overflowDamage=0;
  if(overflow&&damage>health){
    let left=damage-health;
    const survivors:MemberHealthGroup[]=[];
    // 按生命组批量扣除，优先现有伤员；十亿人也不逐人创建对象或掷骰。
    for(const g of f.health){
      const killed=Math.min(g.count,Math.floor(left/g.hp));
      left-=killed*g.hp;overflowDamage+=killed*g.hp;casualties+=killed;
      let rest=g.count-killed;
      if(rest&&left){survivors.push({hp:g.hp-left,count:1});overflowDamage+=left;left=0;rest--;}
      if(rest)survivors.push({hp:g.hp,count:rest});
    }
    f.health=mergeHealth(survivors);
  }
  unit.hp-=casualties;f.members=unit.hp;
  return {health:health+overflowDamage,casualties,overflow:overflowDamage};
}
export function memberRecoveryCapacity(unit:Combatant):number {
  return Math.max(0,unit.hp*unit.formation!.memberHp-memberHealth(unit))+(unit.recoverableWounded??0)*unit.formation!.memberHp;
}
/** 先修复现有伤员，再救回零生命伤兵；永久缺员不在可恢复池中。 */
export function healMemberGroups(unit:Combatant,amount:number):number {
  const f=unit.formation!;initializeMemberHealth(unit);let left=Math.max(0,Math.floor(amount));const start=left,groups:MemberHealthGroup[]=[];
  for(const g of f.health!){
    const missing=f.memberHp-g.hp;if(!missing||!left){groups.push(g);continue;}
    const full=Math.min(g.count,Math.floor(left/missing));left-=full*missing;
    if(full)groups.push({hp:f.memberHp,count:full});
    let rest=g.count-full;
    if(rest&&left){const healed=Math.min(left,missing);groups.push({hp:g.hp+healed,count:1});left-=healed;rest--;}
    if(rest)groups.push({hp:g.hp,count:rest});
  }
  const wounded=Math.min(unit.recoverableWounded??0,Math.max(0,f.capacity-unit.hp)),full=Math.min(wounded,Math.floor(left/f.memberHp));
  if(full){groups.push({hp:f.memberHp,count:full});unit.hp+=full;unit.recoverableWounded=(unit.recoverableWounded??0)-full;left-=full*f.memberHp;}
  if(left&&wounded>full){const healed=Math.min(left,f.memberHp);groups.push({hp:healed,count:1});unit.hp++;unit.recoverableWounded!--;left-=healed;}
  f.members=unit.hp;f.health=mergeHealth(groups);return start-left;
}
export function memberHealthSummary(unit:Combatant,limit=6):string {
  if(!hasMemberHealth(unit))return '';
  const groups=unit.formation?.health??[],shown=[...groups].reverse().slice(0,limit);
  return shown.map(g=>`${g.count}${memberNoun(unit)} ${g.hp}/${unit.formation!.memberHp}生命`).join('；')+(groups.length>limit?`；另${groups.length-limit}组伤损`:'');
}
