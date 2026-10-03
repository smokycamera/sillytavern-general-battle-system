import {describe,it,expect} from 'vitest';
import {generateUnit,traitRegistry,SmallBattle,MassBattle,V3_D20,V3_TW,V6_D20,V6_TW,standardField,applyRecovery,applyHealthLoss,type Combatant} from '../../engine/src/index.js';
import {captureBattleStart,captureBattleArchive} from './report-history.js';
import {unitRecordFromCombatant,materializeUnitRecord,commitBattleState,updateUnitRecord} from './unit-state.js';
import {battleEpilogue,makeNarrativeBatch,battleIdOf,publicBattleEvents,type BattleReport} from './battle-reports.js';
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
  expect(text).toContain('【开局单位状态与血量】');expect(text).toContain(`敌方 D：血量${records[1]!.hp}/${records[1]!.base.hpMax}，可行动`);
  for(const target of ['D','E']){const loss=result.resolutions.filter(r=>r.defenderId===target).reduce((n,r)=>n+r.hpBefore-r.hpAfter,0);expect(loss).toBeGreaterThan(0);expect(text).toContain(`A → ${target}：累计造成${loss}生命损失`);}
  const report:BattleReport={id:battleIdOf(b),card:'',digest:'',summary:'',deliveries:{},epilogue:text,start};
  expect(makeNarrativeBatch(undefined,JSON.parse(JSON.stringify(report)),{},'epilogue').text).toBe(text);
  expect(battleEpilogue(b)).toContain('没有开局存档记录');expect(text).not.toContain('没有开局存档记录');
 });
 it('旧致命战场的零血濒死结清为阵亡，非致命编队的部分减员全部可救',()=>{
  const b=battle('small',false,[unit('A'),unit('D')]);b.byId('D').hp=0;b.byId('D').status='dying';
  const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect(restored.byId('D').status).toBe('dead');
  const company=unit('D','company'),nonLethal=battle('small',true,[unit('A','company'),company]);
  applyHealthLoss(company,4);expect(company.recoverableWounded).toBe(4);
  // 单位提示词已说明治疗不补回永久缺员，终章只给伤兵数。
  expect(battleEpilogue(nonLethal)).toContain('可救伤兵4');expect(battleEpilogue(nonLethal)).not.toContain('治疗不会补回其余缺员');
  expect(applyRecovery(company,10)).toBe(4);
 });
 it('停战和投降的真实结束原因不会被任务胜负摘要覆盖',()=>{
  for(const reason of ['ceasefire','surrender'] as const){
   const b=battle('small',false,[unit('A'),unit('D')]) as SmallBattle;b.finishBattle(reason);
   const recorded=b.log.filter(e=>e.kind==='battle-end').at(-1)!.text;
   expect(publicBattleEvents(b).filter(e=>e.entry.kind==='battle-end').at(-1)!.entry.text).toBe(recorded);
   expect(battleEpilogue(b)).toContain(recorded);expect(makeNarrativeBatch(b,undefined,{},'delta').text).toContain(recorded);
  }
 });
});
describe('终章伤害来源的减员人数',()=>{
 function member(id:string,scale:'hero'|'company',body:'human'|'vehicle'='human') {
  const u=generateUnit({rulesVersion:'v2',damageModel:'wounds-v2',name:id,side:id==='A'?'ally':'enemy',scale,body,level:5,weaponClass:'rifle',weaponLevel:5,armorTier:0,traits:[],...(scale==='company'?{hpMax:30}:{})},{seed:id,registry,noVariance:true}).unit;
  u.id=id;u.morale=100;u.base.moraleMax=100;return u;
 }
 function fight(mode:'small'|'mass',units:Combatant[]) {
  const opts={combatants:units,nonLethal:false,rng,seed:'members',traitRegistry:registry};
  const b=mode==='small'?new SmallBattle({...opts,rules:V6_D20,battlefield:standardField()}):new MassBattle({...opts,rules:V6_TW});b.start();return b;
 }
 const line=(b:SmallBattle|MassBattle,head:string)=>battleEpilogue(b).split(/\r?\n/).find(l=>l.startsWith(head));
 it('攻击的减员写在生命损失后，与状态行的剩余总人数一致',()=>{
  const b=fight('small',[member('A','company'),member('D','company'),member('H','hero')]) as SmallBattle;
  b.byId('A').pos=28;b.byId('D').pos=21;expect(b.attack('A','D',{bypassTurn:true}).hit).toBe(true);
  const lost=30-b.byId('D').hp;expect(lost).toBeGreaterThan(0);
  expect(line(b,'A → D')).toMatch(new RegExp('^A → D：累计造成\\d+生命损失，减员'+lost+'人$'));
  expect(battleEpilogue(b)).toContain(`敌方 D：剩余总人数${b.byId('D').hp}/30`);
 });
 it.each(['small','mass'] as const)('%s持续伤害记录减员数；旧记录缺少时只写下限',mode=>{
  const b=fight(mode,[member('A','company'),member('D','company'),member('H','hero')]),target=b.byId('D');
  target.formation!.health=[{hp:1,count:target.formation!.members}];
  target.conditions=[{id:'burning',dur:3,sourceId:'A'}];
  if(b instanceof SmallBattle){b.turnOrder=['A','D','H'];b.turnIndex=0;b.endTurn();}
  else {for(const id of ['A','D','H'])b.issue({unitId:id,type:'hold'});b.resolveRound();}
  const dot=b.log.find(e=>e.damage?.targetId==='D')!.damage!,lost=30-target.hp;
  expect(dot).toMatchObject({sourceId:'A',unit:'life',members:lost});expect(lost).toBeGreaterThan(0);
  expect(line(b,'A → D')).toMatch(new RegExp('^A → D：累计造成\\d+生命损失（含灼伤），减员'+lost+'人$'));
  delete dot.members;expect(line(b,'A → D')).toMatch(new RegExp('^A → D：累计造成\\d+生命损失（含灼伤），减员至少0人$'));
 });
 it('载具按辆计，英雄只写生命损失',()=>{
  const b=fight('small',[member('A','company'),member('D','company','vehicle')]) as SmallBattle;
  b.byId('A').pos=28;b.byId('D').pos=21;expect(b.attack('A','D',{bypassTurn:true}).hit).toBe(true);
  expect(line(b,'A → D')).toMatch(new RegExp('^A → D：累计造成\\d+生命损失，减员'+(30-b.byId('D').hp)+'辆$'));
  expect(battleEpilogue(b)).toContain(`敌方 D：剩余总数${b.byId('D').hp}/30辆`);
  const h=fight('small',[member('A','company'),member('H','hero')]) as SmallBattle;
  h.byId('A').pos=28;h.byId('H').pos=21;expect(h.attack('A','H',{bypassTurn:true}).hit).toBe(true);
  expect(line(h,'A → H')).toMatch(/^A → H：累计造成\d+生命损失$/);expect(battleEpilogue(h)).toContain(`敌方 H：血量${h.byId('H').hp}/${h.byId('H').base.hpMax}`);
 });
});
