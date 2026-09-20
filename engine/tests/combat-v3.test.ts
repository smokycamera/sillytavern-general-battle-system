import {describe,it,expect} from 'vitest';
import {generateUnit,traitRegistry,standardConditionMap,previewAttack,resolveAttack,SeededRng,V2_D20,V3_D20,V3_TW,SmallBattle,MassBattle,generatedField,learnAbilities} from '../src/index.js';
import {prepareCombatModel,memberDurability,healingYield,validateCombatModel} from '../src/combat-model.js';
import {upgradeCombatSkills} from '../src/skill-upgrade.js';
import {sharedParticipants} from '../src/exposure.js';
import {skillDefinitionId} from '../src/skill-catalog.js';
import {skillAttack} from '../src/skill-attack.js';
import {applyHealthLoss,applyRecovery} from '../src/recovery.js';
import {moraleProfile,moraleOnDamage} from '../src/morale.js';
import {prepareMassRoster} from '../../panel/src/battle-setup.js';
import {conditionDamage,conditionExposure} from '../src/afflictions.js';
import {unitRecordFromCombatant,materializeUnitRecord} from '../../panel/src/unit-state.js';
import type {GenerateInput,Combatant} from '../src/types.js';
const registry=traitRegistry(),conditionDefs=standardConditionMap();
function make(id='A',size=50,extra:Partial<GenerateInput>={}):Combatant{
 const u=generateUnit({rulesVersion:'v2',name:id,side:id==='A'?'ally':'enemy',scale:size===1?'hero':'company',...(size===1?{}:{hpMax:size}),level:5,quality:3,weaponClass:'rifle',weaponLevel:5,armorTier:1,armorLevel:5,traits:[],...extra},{registry,seed:id,noVariance:true}).unit;
 u.id=id;prepareCombatModel(u,V3_D20);upgradeCombatSkills(u);return u;
}
const opts=(a:Combatant,d:Combatant)=>({attacker:a,defender:d,rules:V3_TW,conditionDefs,traitRegistry:registry,ranged:true,distance:3});
describe('V3人数、技能与续战',()=>{
 it('持续伤害按受影响成员换算，大编队与个体来源不互相混用',()=>{
  const a=make('A',500),d=make('D',2000),hero=make('A',1);
  expect(conditionExposure(a,d,true)).toBe(200);expect(conditionExposure(hero,d,true)).toBe(4);
  expect(conditionDamage(d,4,{id:'burning',dur:2,affectedMembers:200})).toBe(80);
  expect(conditionDamage(d,4,{id:'burning',dur:2,affectedMembers:4})).toBe(1.6);
  const vehicle=make('D',50,{body:'vehicle'});expect(conditionDamage(vehicle,4,{id:'poisoned',dur:2,affectedMembers:50})).toBe(0);
 });
 it('人数增长同比提高期望火力，对个体仍受交战面限制，伤员使火力下降',()=>{
  const small=make(),big=make('A',500),d=make('D',2000),hero=make('D',1);
  expect(previewAttack(opts(big,d)).expectedDamage).toBeCloseTo(previewAttack(opts(small,d)).expectedDamage*10,8);
  expect(previewAttack(opts(big,hero)).expectedDamage).toBeCloseTo(previewAttack(opts(small,hero)).expectedDamage,8);
  applyHealthLoss(big,250);expect(big.formation?.members).toBe(250);
  expect(previewAttack(opts(big,d)).expectedDamage).toBeCloseTo(previewAttack(opts(small,d)).expectedDamage*5,8);
 });
 it('同阵位拆编不复制攻击面，体型耐久独立于人数',()=>{
  const a=make('A',200),b=make('B',300),d=make('D',500);b.side='ally';
  expect(sharedParticipants(a,[a,b],10,d)+sharedParticipants(b,[a,b],10,d)).toBe(100);
  expect(sharedParticipants(a,[a,b],10,make('D',1))+sharedParticipants(b,[a,b],10,make('D',1))).toBe(10);
  const vehicle=make('D',500,{body:'vehicle'});expect(vehicle.formation?.members).toBe(500);expect(memberDurability(vehicle)).toBe(60);
  expect(previewAttack(opts(a,vehicle)).expectedDamage).toBeCloseTo(previewAttack(opts(a,d)).expectedDamage/6,8);
  const intact=make('A',50,{weaponClass:'demolition'}),half=make('B',25,{weaponClass:'demolition'});half.side='ally';const half2=structuredClone(half);half2.id='C';
  const shared=sharedParticipants(half,[half,half2],10,d);
  expect(previewAttack({...opts(half,d),participants:shared}).expectedDamage*2).toBeCloseTo(previewAttack(opts(intact,d)).expectedDamage,8);
 });
 it('大编队最多8组，合计真实损失与伤兵一致，预览不消耗随机数',()=>{
  const a=make('A',2000),d=make('D',2000),rng=new SeededRng('bounded-packets');const before=JSON.stringify(rng);
  const p=previewAttack(opts(a,d));expect(JSON.stringify(rng)).toBe(before);expect(p.aggregationSamples).toBe(8);
  expect(p.anyHitChance).toBeCloseTo(1-Math.pow(1-p.hitChance,8*(a.weapon?.attacks??1)),12);
  const r=resolveAttack({...opts(a,d),rng});expect(r.packetCount).toBeLessThanOrEqual(8);expect(r.finalDamage).toBe(2000-d.hp);
  expect(r.packetRolls?.reduce((n,p)=>n+p.damage,0)).toBe(r.finalDamage);expect(d.formation?.members).toBe(d.hp);expect(d.recoverableWounded).toBe(Math.floor(r.finalDamage/2));
  const fifty=previewAttack(opts(make(),make('D',2000)));
  expect(p.variance!).toBeLessThan(fifty.variance!*40*40);
 });
 it('零穿透仍为零损失与零受创压力，不靠百分比扣血',()=>{
  const a=make('A',2000),d=make('D',2000);a.weapon!.penetration=0;d.armor!.protection={kinetic:9,thermal:9,arcane:9};
  expect(previewAttack(opts(a,d)).expectedDamage).toBe(0);
  const r=resolveAttack({...opts(a,d),rng:new SeededRng('armor')});expect(r.finalDamage).toBe(0);expect(d.moraleState?.damage??0).toBe(0);
 });
 it('会战同阶段连发超额火力只记实际减员，逐组损失合计仍吻合',()=>{
  const a=make('A',500),d=make('D',50);a.weapon!.baseDice='1d2+1000';a.weapon!.penetration=20;a.weapon!.attacks=3;a.base.atk=100;
  const b=new MassBattle({combatants:[a,d],rules:V3_TW,seed:'overkill-v3',traitRegistry:registry});b.start();
  b.issue({unitId:'A',type:'volley',targetId:'D'});b.issue({unitId:'D',type:'hold'});b.resolveRound();
  const hits=b.log.flatMap(e=>e.resolution?.attackerId==='A'?[e.resolution]:[]);expect(hits.length).toBeGreaterThan(1);
  expect(hits.reduce((n,r)=>n+r.finalDamage,0)).toBe(50-d.hp);
  for(const r of hits){expect(r.finalDamage).toBe(r.hpBefore-r.hpAfter);expect(r.packetRolls?.reduce((n,p)=>n+p.damage,0)).toBe(r.finalDamage);}
 });
 it('伤兵累计取整不因连发丢失，恢复上限与药品份额独立',()=>{
  const a=make('A',500),d=make('D',500);for(let i=0;i<11;i++)applyHealthLoss(d,1);
  expect(d.recoverableWounded).toBe(5);expect(d.formation?.woundedRemainder).toBe(1);
  expect(healingYield(a,d,10)).toBe(100);expect(healingYield(a,d,10,true)).toBe(1);
  expect(healingYield(make('A',50,{hpMax:1}),d,10)).toBe(healingYield(make('A',1),d,10));
  expect(applyRecovery(d,100)).toBe(5);expect(d.hp).toBe(494);expect(d.formation?.members).toBe(494);expect(d.recoverableWounded).toBe(0);
 });
 it('高生命受创积累战斗压力，不溃个体继续免疫惊退',()=>{
  const d=make('D',1,{hpMax:500});applyHealthLoss(d,100);expect(d.hp).toBe(400);expect(d.moraleState?.damagePenalty).toBeGreaterThan(50);
  const before=JSON.stringify(d.moraleState);moraleOnDamage(d,0);expect(JSON.stringify(d.moraleState)).toBe(before);
  const immune=[...registry.values()].find(t=>t.effects.some(e=>e.kind==='immuneMorale'))!;d.traits.push(immune.id);
  expect(moraleProfile({units:[d],mode:'small',fieldTags:[]},d,registry).immune).toBe(true);
 });
 it('单体武技与法术高于普通攻击，不同机制冷却独立且重复升级稳定',()=>{
  const ids=['物理单体射击','魔法单体','魔法范围'].map(s=>skillDefinitionId(s)!);
  const a=make('A',500,{abilityBlueprints:ids.map(id=>({id,level:5}))}),d=make('D',500),plain=previewAttack(opts(a,d)).expectedDamage;
  for(const ability of a.abilities.slice(0,2)){
   const effect=ability.effects.find(e=>e.op==='damage')!;if(effect.op!=='damage')throw Error();
   expect(previewAttack({...opts(a,d),...skillAttack({units:[a,d],mode:'mass',fieldTags:[]},a,d,ability,effect)}).expectedDamage).toBeGreaterThan(plain*1.7);
  }
  expect(new Set(a.abilities.map(a=>a.cooldownGroup)).size).toBe(3);const before=JSON.stringify(a);upgradeCombatSkills(a);expect(JSON.stringify(a)).toBe(before);
  const first=a.abilities[0]!;a.abilityState.push({abilityId:first.cooldownGroup!,cdLeft:2,used:1});
  const next=learnAbilities(a,[{id:ids[0]!,instanceId:first.id,name:'改名技法',level:6}]);
  expect(next.abilities[0]?.effectVersion).toBe('skill-v3.0');expect(next.abilityState.find(s=>s.abilityId===next.abilities[0]?.cooldownGroup)?.cdLeft).toBe(2);
 });
 it('档案往返保留人数与成员耐久，冲突快照拒绝加载',()=>{
  const u=make('A',500);applyHealthLoss(u,11);const r=unitRecordFromCombatant(u);const next=materializeUnitRecord(r,registry);
  expect(next.formation).toEqual(u.formation);expect(next.hp).toBe(489);
  const broken=structuredClone(r);broken.snapshot!.formation!.members=490;expect(()=>materializeUnitRecord(broken,registry)).toThrow();
  const damaged=structuredClone(u);damaged.formation!.woundedRemainder=.5;expect(()=>validateCombatModel(damaged)).toThrow();
 });
 it.each(['small','mass'] as const)('%s保存续战保留规则与后续随机结果',mode=>{
  const a=make('A',500),d=make('D',500);const units=mode==='mass'?prepareMassRoster([a,d]):[a,d];
  const b=mode==='mass'?new MassBattle({combatants:units,rules:V3_TW,seed:'persist',traitRegistry:registry}):new SmallBattle({combatants:units,rules:V3_D20,seed:'persist',traitRegistry:registry,battlefield:generatedField('persist',7,13,['plains'])});b.start();
  const step=(x:SmallBattle|MassBattle)=>{if(x instanceof SmallBattle)x.autoAction(x.active!.id);else{x.autoOrders('ally');x.autoOrders('enemy');x.resolveRound();}};
  step(b);const snap=JSON.parse(JSON.stringify(b.toSnapshot()));const restored=mode==='mass'?MassBattle.fromSnapshot(snap,{traitRegistry:registry}):SmallBattle.fromSnapshot(snap,{traitRegistry:registry});
  step(b);step(restored);expect(restored.toSnapshot()).toEqual(b.toSnapshot());
 });
 it.each(['small','mass'] as const)('%s治疗预览与实际伤兵恢复一致，召唤使用新人数模型',mode=>{
  const summon=skillDefinitionId('buff召唤')!,original=make('A',500,{abilityBlueprints:['bp-mending',{id:summon,level:5}]}),d=make('D',500);
  const b=mode==='mass'?new MassBattle({combatants:prepareMassRoster([original,d]),rules:V3_TW,seed:'support-v3',traitRegistry:registry}):new SmallBattle({combatants:[original,d],rules:V3_D20,seed:'support-v3',traitRegistry:registry,battlefield:generatedField('support-v3',7,13,['plains'])});b.start();
  const a=b.byId('A');applyHealthLoss(a,100);const healing=a.abilities[0]!;healing.effects=[{op:'heal',amount:5}];
  const sp=a.resources.SP!;
  if(b instanceof SmallBattle){b.turnOrder=['A','D'];b.turnIndex=0;
   const preview=b.getActionOptions('A').find(o=>o.id===healing.id)!.targets!.find(t=>t.targetId==='A')!.preview!;
   expect(preview.healing).toBe(40);expect(b.useAbility('A',healing.id,'A').ok).toBe(true);
   b.actedThisTurn.clear();
  }else{const order={unitId:'A',type:'ability' as const,abilityId:healing.id,targetId:'A'};expect(b.orderPreview(order).healing).toBe(40);b.issue(order);b.issue({unitId:'D',type:'hold'});b.resolveRound();}
  expect(a.hp).toBe(440);expect(a.recoverableWounded).toBe(10);expect(a.resources.SP).toBe(sp-healing.cost!.amount);
  const summoner=a.abilities[1]!;
  if(b instanceof SmallBattle)expect(b.useAbility('A',summoner.id).ok).toBe(true);
  else{expect(b.issue({unitId:'A',type:'ability',abilityId:summoner.id,targetId:'A'}).ok).toBe(true);b.issue({unitId:'D',type:'hold'});b.resolveRound();}
  const born=b.combatants.filter(u=>u.summonerId==='A');expect(born).toHaveLength(1);expect(born[0]!.combatModel).toBe('cohort-v1');if(mode==='mass')expect(born[0]!.formation?.members).toBe(born[0]!.hp);
 });
 it('旧战斗快照不升级人数和技能规则',()=>{
  const a=make('A',1),d=make('D',1);delete a.combatModel;delete d.combatModel;
  const b=new SmallBattle({combatants:[a,d],rules:V2_D20,seed:'legacy'});b.start();
  const restored=SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));expect(restored.rules.id).toBe('v2-d20');expect(restored.combatants[0]?.combatModel).toBeUndefined();
 });
});
