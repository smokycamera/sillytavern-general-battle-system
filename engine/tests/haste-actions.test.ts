import { describe, expect, it } from 'vitest';
import { SmallBattle, MassBattle, V7_OVERFLOW_D20, V7_OVERFLOW_TW, generateUnit, traitRegistry, standardField, compileGenericSkill, type Combatant } from '../src/index.js';
import { compileItem, carriedItemAbility } from '../src/items.js';
import { compileWeapon } from '../src/gen/equipment.js';
import { applySkillCondition, skillEffectValue } from '../src/skill-effects.js';
import { hasteAttackScale } from '../src/haste.js';
const registry=traitRegistry();
const rng={seed:'haste',next:()=>0.5,d:(n:number)=>n===20?15:3};
function make(id:string, side:'ally'|'enemy', scale:'hero'|'company'='hero'):Combatant {
 const u=generateUnit({rulesVersion:'v2',damageModel:'wounds-v2',name:id,side,scale,level:5,hpMax:scale==='hero'?100000:100,weaponClass:'sword',weaponLevel:3,armorTier:0,traits:[]},{registry,seed:id,noVariance:true}).unit;u.id=id;u.morale=u.base.moraleMax=100;u.base.atk=100;return u;
}
function small(){const a=make('a','ally'),d=make('d','enemy'),field=standardField();field.tiles.fill('open');const b=new SmallBattle({combatants:[a,d],rules:V7_OVERFLOW_D20,battlefield:field,rng,traitRegistry:registry});b.start();b.turnOrder=['a','d'];b.turnIndex=0;a.pos=31;d.pos=24;applySkillCondition(a,{id:'hasted',dur:5,magnitude:1});return{b,a,d};}
function mass(){const a=make('a','ally','company'),d=make('d','enemy','company'),b=new MassBattle({combatants:[a,d],rules:V7_OVERFLOW_TW,rng,traitRegistry:registry});b.start();a.formationPosition='ally:中军:front';d.formationPosition='enemy:中军:front';applySkillCondition(a,{id:'hasted',dur:5,magnitude:1});return{b,a,d};}

describe('每轮一次非技能加速动作',()=>{
 it('小战先主攻击再加速攻击，预览一致、不可第三次，存档和刷新不重置次数',()=>{
  const {b,a,d}=small();const first=b.attack(a.id,d.id),preview=b.getActionOptions(a.id).find(o=>o.id==='weapon')!.targets![0]!.preview!;
  const second=b.attack(a.id,d.id);expect(second.finalDamage).toBeCloseTo(first.finalDamage*0.5,0);expect(second.targetDef).toBe(preview.defenseScore);
  expect(b.hasteAvailable(a.id)).toBe(false);expect(()=>b.attack(a.id,d.id)).toThrow();
  applySkillCondition(a,{id:'hasted',dur:10,magnitude:2});expect(b.hasteAvailable(a.id)).toBe(false);
  const restored=SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())),{traitRegistry:registry});expect(restored.hasteAvailable(a.id)).toBe(false);expect(()=>restored.attack(a.id,d.id)).toThrow();
 });
 it('可以先加速固守，再用主行动施法；加速不能再次施法',()=>{
  const {b,a}=small(),spell=compileGenericSkill('generic:buff:ward',5,a.id);a.abilities=[spell];a.preparedAbilityIds=[spell.id];a.resources.SP=20;
  b.selectHaste(a.id,true);expect(b.useAbility(a.id,spell.id,a.id).ok).toBe(false);b.brace(a.id);expect(b.actedThisTurn.has(a.id)).toBe(false);
  expect(b.useAbility(a.id,spell.id,a.id).ok).toBe(true);expect(b.useAbility(a.id,spell.id,a.id).ok).toBe(false);expect(b.hasteAvailable(a.id)).toBe(false);
 });
 it('加速起飞沿用飞行门槛、消耗同一份加速机动，剩余移动保留',()=>{
  const {b,a}=small();b.movementSpent.set(a.id,b.movementBudget(a.id));b.selectHaste(a.id,true);
  expect(()=>b.changeFlight(a.id,true)).toThrow();a.traits.push('flying');b.changeFlight(a.id,true);
  expect(a.airborne).toBe(true);expect(b.hasteAvailable(a.id)).toBe(false);expect(b.movementLeft(a.id)).toBe(b.movementBudget(a.id)-1);expect(b.actedThisTurn.has(a.id)).toBe(false);
 });
 it('加速警戒与普通借机共享反应额度，不能额外刷反应',()=>{
  const {b,a,d}=small();b.attack(a.id,d.id);b.setOverwatch(a.id);expect(b.hasteOverwatch.get(a.id)).toBe(0.5);expect(b.hasteAvailable(a.id)).toBe(false);
  expect(()=>b.setOverwatch(a.id)).toThrow();b.reactionSpent.add(a.id);expect(b.overwatchReason(a.id)).toBeTruthy();
 });
 it('实际警戒射击应用额外攻击折算；会战额外起飞仍要求飞行能力',()=>{
  const shot=(extra:boolean)=>{const {b,a,d}=small();a.weapon=compileWeapon({mechanism:'bow',power:3},{id:'bow',seed:'bow'});a.pos=31;d.pos=10;
   if(extra)b.actedThisTurn.add(a.id);b.setOverwatch(a.id);b.endTurn();b.moveTo(d.id,17);
   return b.log.find(l=>l.text.startsWith('警戒反应'))!.resolution!.finalDamage;
  };
  expect(shot(true)).toBeCloseTo(shot(false)*.5,0);
  const {b,a}=mass();a.traits.push('flying');b.issue({unitId:a.id,type:'hold'});b.issue({unitId:'d',type:'hold'});b.setHasteOrder({unitId:a.id,type:'takeoff'},a.id);b.resolveRound();expect(a.airborne).toBe(true);
 });
 it('主动装填减少实际冷却；眩晕不能使用加速',()=>{
  const {b,a}=small();a.weapon=compileWeapon({mechanism:'firearm',power:3},{id:'gun',seed:'gun'});b.reloadCd.set(a.id,2);b.actedThisTurn.add(a.id);b.reloadWeapon(a.id);expect(b.reloadCd.get(a.id)).toBe(1);expect(b.hasteAvailable(a.id)).toBe(false);
  b.hasteSpent.clear();a.conditions.push({id:'stunned',dur:1});expect(b.hasteAvailable(a.id)).toBe(false);expect(()=>b.reloadWeapon(a.id)).toThrow();
 });
 it('会战在主攻击后追加折算攻击，只结算一次状态时间',()=>{
  const {b,a,d}=mass();b.issue({unitId:a.id,type:'attack',targetId:d.id});b.issue({unitId:d.id,type:'hold'});b.setHasteOrder({unitId:a.id,type:'attack',targetId:d.id},a.id);b.resolveRound();
  const hits=b.log.filter(l=>l.resolution?.attackerId===a.id);expect(hits).toHaveLength(2);expect(b.lastPhases).toContain('加速');expect(a.conditions.find(c=>c.id==='hasted')?.dur).toBe(4);expect(b.round).toBe(2);
  expect(b.roundReport()?.orders.filter(o=>o.order.unitId===a.id)).toHaveLength(2);expect(()=>b.resolveRound(1)).toThrow();
 });
 it('会战加速支持机动、固守、起落；技能任务被拒绝，读档保留额外计划',()=>{
  const {b,a}=mass();expect(()=>b.setHasteOrder({unitId:a.id,type:'ability',abilityId:'x'},a.id)).toThrow();b.setHasteOrder({unitId:a.id,type:'rank-back'},a.id);
  const restored=MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())),{traitRegistry:registry});expect(restored.hasteOrders.get(a.id)?.type).toBe('rank-back');
  restored.issue({unitId:a.id,type:'hold'});restored.issue({unitId:'d',type:'hold'});restored.resolveRound();expect(restored.byId(a.id).formationPosition).toBe('ally:中军:reserve');
 });
 it('自动行动实际花掉加速额度并推进，不会重新施法或循环',()=>{
  const {b,a}=small();b.autoAction(a.id);
  expect(b.hasteSpent.get(a.id)).toBe(1);expect(b.active?.id).toBe('d');
  expect(b.log.some(l=>l.resolution?.attackerId===a.id)).toBe(true);
 });
 it('同轮施放加速立即获得额外任务；消耗品仍可使用，次数照常扣除',()=>{
  const {b,a}=mass();a.conditions=[];
  const haste=compileGenericSkill('generic:buff:haste',5,a.id);a.abilities=[haste];a.preparedAbilityIds=[haste.id];a.resources.SP=20;
  expect(b.issue({unitId:a.id,type:'ability',abilityId:haste.id,targetId:a.id}).ok).toBe(true);
  b.issue({unitId:'d',type:'hold'});b.setHasteOrder({unitId:a.id,type:'brace'},a.id);b.resolveRound();
  expect(a.tacticalPose?.kind).toBe('brace');expect(b.roundReport()?.orders.filter(o=>o.status==='executed')).toHaveLength(2);
  const mechanics=compileItem({kind:'consumable',mechanism:'restore',power:1},{id:'potion',seed:'potion'});
  if(mechanics.kind!=='consumable')throw Error('missing item');
  const carried={id:'potion',name:'药剂',quantity:1,revision:0,mechanics};
  const item=carriedItemAbility(carried);a.carriedItems=[carried];a.abilities=[item];a.resources.SP=0;a.resources['item:potion']=1;
  b.issue({unitId:a.id,type:'hold'});b.issue({unitId:'d',type:'hold'});
  b.setHasteOrder({unitId:a.id,type:'ability',abilityId:item.id,targetId:a.id},a.id);b.resolveRound();
  expect(a.resources.SP).toBeGreaterThan(0);expect(a.resources['item:potion']).toBe(0);expect(a.abilityState.find(s=>s.abilityId===(item.cooldownGroup??item.id))?.used).toBe(1);
 });
 it('会战额外固守延续到下轮，而非在下轮尚未交战时清空',()=>{
  const {b,a}=mass();b.issue({unitId:a.id,type:'hold'});b.issue({unitId:'d',type:'hold'});
  b.setHasteOrder({unitId:a.id,type:'brace'},a.id);b.resolveRound();
  const restored=MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())),{traitRegistry:registry});
  restored.byId(a.id).conditions=[];restored.issue({unitId:a.id,type:'hold'});restored.issue({unitId:'d',type:'hold'});restored.resolveRound();
  expect(restored.byId(a.id).tacticalPose?.kind).toBe('brace');
  restored.issue({unitId:a.id,type:'hold'});restored.issue({unitId:'d',type:'hold'});restored.resolveRound();expect(restored.byId(a.id).tacticalPose).toBeUndefined();
 });
 it('主任务不能伪装加速，损坏的加速存档被拒绝',()=>{
  const {b,a}=mass();expect(b.issue({unitId:a.id,type:'hold',haste:true}).ok).toBe(false);
  const {b:sb}=small(),snap=sb.toSnapshot();
  expect(()=>SmallBattle.fromSnapshot({...snap,hasteOverwatch:[['a',2]]},{traitRegistry:registry})).toThrow();
 });
 it('长效增益得到有界的额外价值，加速有实际输出收益，复合效力折算',()=>{
  const {b,a}=small();a.conditions=[];const spell=compileGenericSkill('generic:buff:haste',5,a.id),ctx=b.observationContext();
  const value=(dur:number)=>skillEffectValue(ctx,a,a,{...spell,effects:[{op:'condition',conditionId:'hasted',dur,magnitude:1}]});
  expect(value(1)).toBeGreaterThan(0);expect(value(10)).toBeGreaterThan(value(2));expect(value(10)).toBeLessThan(value(1)*3);
  applySkillCondition(a,{id:'hasted',dur:5,magnitude:.5});expect(hasteAttackScale(a)).toBe(.25);
 });
});
