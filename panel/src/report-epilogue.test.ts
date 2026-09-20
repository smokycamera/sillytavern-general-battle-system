import {describe,it,expect} from 'vitest';
import {generateUnit,traitRegistry,SmallBattle,MassBattle,V3_D20,V3_TW,standardField,applyRecovery,applyHealthLoss,type Combatant} from '../../engine/src/index.js';
import {captureBattleStart,captureBattleArchive} from './report-history.js';
import {unitRecordFromCombatant,materializeUnitRecord,commitBattleState,updateUnitRecord} from './unit-state.js';
import {battleEpilogue,makeNarrativeBatch,battleIdOf,type BattleReport} from './battle-reports.js';
import {skillDefinitionId} from '../../engine/src/skill-catalog.js';
import {compactEvents} from '../../engine/src/inject/format.js';
const registry=traitRegistry(),rng={seed:'fixed',next:()=>0,d:(sides:number)=>sides};
function unit(id:string,scale:'hero'|'company'='hero',area=false) {
 const u=generateUnit({rulesVersion:'v2',name:id,side:id==='A'?'ally':'enemy',scale,body:'large',level:5,weaponClass:'sword',armorTier:0,traits:[],...(scale==='company'?{hpMax:10}:{}),...(area?{abilityBlueprints:[{id:skillDefinitionId('魔法范围')!,level:5}]}:{})},{seed:id,registry,noVariance:true}).unit;
 u.id=id;u.weapon!.penetration=30;u.weapon!.baseDice='100d6';u.weapon!.apDice='100d6';u.base.atk=100;u.morale=100;u.base.moraleMax=100;return u;
}
function battle(mode:'small'|'mass',nonLethal:boolean,units:Combatant[]) {
 const opts={combatants:units,nonLethal,rng,seed:'epilogue',traitRegistry:registry};
 const b=mode==='small'?new SmallBattle({...opts,rules:V3_D20,battlefield:standardField()}):new MassBattle({...opts,rules:V3_TW});b.start();return b;
}
function hit(b:SmallBattle|MassBattle,actor:string,target:string) {
 if(b instanceof SmallBattle){b.byId(actor).pos=28;b.byId(target).pos=21;b.attack(actor,target,{bypassTurn:true});}
 else {expect(b.issue({unitId:actor,type:'attack',targetId:target}).ok).toBe(true);b.issue({unitId:target,type:'hold'});b.resolveRound();}
}
describe('终章事实与致命开关',()=>{
 it.each(['small','mass'] as const)('%s双方、个体和编队遵守开关，濒死可归档恢复且击败经验不重复',mode=>{
  for(const nonLethal of [false,true])for(const scale of ['hero','company'] as const)for(const attacker of ['A','D']){
   const units=[unit('A',scale),unit('D',scale)],records=units.map(u=>unitRecordFromCombatant(u));
   const b=battle(mode,nonLethal,units),target=attacker==='A'?'D':'A',victim=b.byId(target),initial=victim.hp;
   hit(b,attacker,target);expect(victim.hp).toBe(0);expect(victim.status).toBe(nonLethal?'dying':'dead');expect(b.isOver()).toBe(true);
   if(nonLethal){expect(compactEvents(b.log).join('\n')).not.toContain('†');expect(b.log.find(e=>e.resolution?.hpAfter===0)?.resolution?.defenderStatus).toBe('dying');}
   if(scale==='company')expect(victim.recoverableWounded).toBe(nonLethal?initial:0);
   const restored=mode==='small'?SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())):MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));
   expect(restored.nonLethal).toBe(nonLethal);expect(restored.byId(target).status).toBe(victim.status);
   const saved=commitBattleState({records,roster:units,combatants:b.combatants}).records.find(r=>r.id===target)!;
   expect(materializeUnitRecord(saved,registry).status).toBe(victim.status);
   if(nonLethal){
    const treated=updateUnitRecord(saved,{hp:1},registry);expect(treated.status).toBe('ready');
    const xp=b.xpGained;expect(applyRecovery(victim,1)).toBe(1);hit(b,attacker,target);expect(victim.status).toBe('dying');expect(b.xpGained).toBe(xp);
   }
  }
 });
 it.each(['small','mass'] as const)('%s持续伤害记录真实来源，非致命零血不会在结算时变死亡',mode=>{
  const a=unit('A'),d=unit('D');d.hp=1;
  d.conditions=[{id:'burning',dur:3,sourceId:'A'}];
  const b=battle(mode,true,[a,d]);
  if(b instanceof SmallBattle){b.turnOrder=['A','D'];b.turnIndex=0;b.endTurn();}else{b.issue({unitId:'A',type:'hold'});b.issue({unitId:'D',type:'hold'});b.resolveRound();}
  expect(d.hp).toBe(0);expect(d.status).toBe('dying');
  expect(b.log.find(e=>e.damage?.targetId==='D')?.damage).toMatchObject({sourceId:'A',amount:1});
  expect(battleEpilogue(b)).toContain('A → D：累计造成1生命损失');
 });
 it('终章使用真实开局、结束与多目标技能全部损失，已保存终章在收兵后保持一致',()=>{
  const units=[unit('A','hero',true),unit('D'),unit('E')],records=units.map(u=>unitRecordFromCombatant(u));
  const b=battle('small',false,units) as SmallBattle;
  const start=captureBattleStart(b,captureBattleArchive({storage:records,rosterIds:units.map(u=>u.id),inventory:[]}));
  b.byId('A').pos=14;b.byId('D').pos=7;b.byId('E').pos=8;
  const result=b.useAbility('A',b.byId('A').abilities[0]!.id,'D',{bypassTurn:true});expect(result.ok,result.reason).toBe(true);expect(result.resolutions.length).toBeGreaterThan(1);
  if(!b.isOver())b.finishBattle('ceasefire');
  const text=battleEpilogue(b,start);
  expect(text).toContain('【开局单位状态与血量】');expect(text).toContain(`敌方 D：生命${records[1]!.hp}/${records[1]!.base.hpMax}，可行动`);
  for(const target of ['D','E']){const loss=result.resolutions.filter(r=>r.defenderId===target).reduce((n,r)=>n+r.hpBefore-r.hpAfter,0);expect(loss).toBeGreaterThan(0);expect(text).toContain(`A → ${target}：累计造成${loss}生命损失`);}
  const report:BattleReport={id:battleIdOf(b),card:'',digest:'',summary:'',deliveries:{},epilogue:text,start};
  expect(makeNarrativeBatch(undefined,JSON.parse(JSON.stringify(report)),{},'epilogue').text).toBe(text);
  expect(battleEpilogue(b)).toContain('没有开局快照');expect(text).not.toContain('没有开局快照');
 });
 it('旧致命战场的零血濒死结清为阵亡，非致命编队的部分减员全部可救',()=>{
  const b=battle('small',false,[unit('A'),unit('D')]);b.byId('D').hp=0;b.byId('D').status='dying';
  const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect(restored.byId('D').status).toBe('dead');
  const company=unit('D','company');battle('small',true,[unit('A','company'),company]);
  applyHealthLoss(company,4);expect(company.recoverableWounded).toBe(4);expect(applyRecovery(company,10)).toBe(4);
 });
});
