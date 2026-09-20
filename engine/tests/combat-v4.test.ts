import {describe,it,expect} from 'vitest';
import {generateUnit,traitRegistry,SmallBattle,MassBattle,V3_D20,V4_D20,V4_TW,standardField,prepareCombatModel,resolveAttack,previewAttack,standardConditionMap,applyCombatDamage,applyRecovery,memberHealth,memberHealthMax,anchoredWeapon,POWER_ANCHORS,type Combatant} from '../src/index.js';
import {compileWeapon} from '../src/gen/equipment.js';
import {diceAvg} from '../src/data/weapons.js';
import {unitRecordFromCombatant,materializeUnitRecord} from '../../panel/src/unit-state.js';
const registry=traitRegistry(),conditionDefs=standardConditionMap(),rng={seed:'v4-hit',next:()=>0,d:(s:number)=>s};
function unit(id:string,side:'ally'|'enemy',scale:'hero'|'company',body:'vehicle'|'large'|'human'='large',count=12,life=100,power=6):Combatant {
 const u=generateUnit({rulesVersion:'v2',name:id,side,scale,body,level:4,weaponClass:side==='ally'?'cannon':'sword',weaponLevel:power,armorTier:side==='enemy'?3:0,armorLevel:4,quality:3,traits:[],...(scale==='company'?{hpMax:count,hp:count}:{})},{registry,seed:id,noVariance:true}).unit;
 u.id=id;u.morale=100;u.base.moraleMax=100;prepareCombatModel(u,V4_D20,life);return u;
}
function setup(mode:'small'|'mass',ammo:'he'|'ap'='he',nonLethal=false,power=6){
 const a=unit('炮车','ally','hero','vehicle',1,100,power),d=unit('食人魔','enemy','company');a.cannonAmmo=ammo;
 const opts={combatants:[a,d],rng,traitRegistry:registry,seed:'v4',nonLethal};
 const b=mode==='small'?new SmallBattle({...opts,battlefield:standardField(),rules:V4_D20}):new MassBattle({...opts,rules:V4_TW});b.start();return {a,d,b};
}
function fire(b:SmallBattle|MassBattle,a:Combatant,d:Combatant){
 if(b instanceof SmallBattle){a.pos=14;d.pos=7;return b.attack(a.id,d.id,{bypassTurn:true});}
 expect(b.issue({unitId:a.id,type:'volley',targetId:d.id}).ok).toBe(true);b.issue({unitId:d.id,type:'hold'});b.resolveRound();return b.log.filter(e=>e.resolution).at(-1)?.resolution!;
}
describe('V4武器锚定与成员生命',()=>{
 it('命中27再命中19真实保存为54/100；治疗与档案往返不丢失伤势',()=>{
  const u=unit('编队','enemy','company');expect(memberHealth(u)).toBe(1200);
  expect(applyCombatDamage(u,27,1)).toBe(27);expect(applyCombatDamage(u,19,1)).toBe(19);expect(u.hp).toBe(12);
  expect(u.formation!.health).toEqual([{hp:54,count:1},{hp:100,count:11}]);
  const saved=unitRecordFromCombatant(u),restored=materializeUnitRecord(saved,registry);expect(restored.formation).toEqual(u.formation);
  expect(applyRecovery(restored,20)).toBe(20);expect(restored.formation!.health![0]).toEqual({hp:74,count:1});expect(restored.hp).toBe(12);
 });
 it.each(['small','mass'] as const)('%s L6火炮穿透L4重甲，榴弹造成多成员伤损，穿甲弹集中一人',mode=>{
  const he=setup(mode),ap=setup(mode,'ap');const before=memberHealth(he.d),r=fire(he.b,he.a,he.d),p=fire(ap.b,ap.a,ap.d);
  expect(r.penetration).toBe(14);expect(r.resistance).toBe(9);expect(r.penetrationFactor).toBe(1);expect(r.finalDamage).toBe(before-memberHealth(he.d));
  expect(r.splashDamage).toBeGreaterThan(0);expect(he.d.hp).toBeLessThan(ap.d.hp);expect(ap.d.hp).toBe(11);expect(p.penetration).toBe(16);expect(p.splashDamage).toBe(0);
  const restored=mode==='small'?SmallBattle.fromSnapshot(structuredClone(he.b.toSnapshot())):MassBattle.fromSnapshot(structuredClone(he.b.toSnapshot()));
  expect(restored.byId(he.d.id).formation).toEqual(he.d.formation);expect(restored.byId(he.a.id).cannonAmmo).toBe('he');
 });
 it('非致命归零保留所有可救成员；救起后再次击倒不重复经验',()=>{
  const {a,d,b}=setup('small','he',true,10);fire(b,a,d);expect(d.hp).toBe(0);expect(d.status).toBe('dying');expect(d.recoverableWounded).toBe(12);
  const xp=b.xpGained;expect(applyRecovery(d,20)).toBe(20);expect(d.hp).toBe(1);expect(d.formation!.health).toEqual([{hp:20,count:1}]);
  if(b instanceof SmallBattle)for(let i=0;i<6&&(b.reloadCd.get(a.id)??0)>0;i++)b.endTurn();
  fire(b,a,d);expect(d.status).toBe('dying');expect(d.recoverableWounded).toBe(12);expect(b.xpGained).toBe(xp);
 });
 it('武器规格单调增长，预测不改实战状态；低阶武器不能磨穿高阶重甲',()=>{
  const rows=POWER_ANCHORS.map(({level})=>anchoredWeapon(compileWeapon({mechanism:'cannon',power:level},{id:'gun',seed:'gun',quality:3,noVariance:true}))!);
  const means=rows.map(w=>diceAvg(w.baseDice)*w.damageScale!);for(let i=1;i<means.length;i++)expect(means[i]).toBeGreaterThan(means[i-1]!);
  expect(means[9]!/means[0]!).toBeGreaterThan(1000);
  const {a,d}=setup('small');const options={attacker:a,defender:d,rules:V4_D20,ranged:true,distance:3,conditionDefs,traitRegistry:registry};
  const before=JSON.stringify([a,d]),p=previewAttack(options);expect(JSON.stringify([a,d])).toBe(before);expect(p.expectedDamage).toBeGreaterThan(200);expect(p.expectedCasualties).toBeGreaterThan(2);expect(p.maxDamage).toBeLessThanOrEqual(1200);
  a.weapon=compileWeapon({mechanism:'sword',power:1},{id:'low',seed:'low',noVariance:true});d.armor!.level=10;d.armor!.recipe!.power=10;
  const r=resolveAttack({...options,rng});expect(r.penetrationFactor).toBe(0);expect(r.finalDamage).toBe(0);expect(memberHealth(d)).toBe(1200);
 });
 it('大编队和L10炮的计算有界，损失等于真实成员生命，过量伤害不重复计入',()=>{
  const a=unit('炮群','ally','company','vehicle',100,400,10),d=unit('万人编队','enemy','company','human',10000,100),counter={calls:0};
  const r=resolveAttack({attacker:a,defender:d,rules:V4_TW,ranged:true,distance:3,conditionDefs,traitRegistry:registry,rng:{seed:'bounded',next:()=>{counter.calls++;return 0;},d:(s:number)=>{counter.calls++;return s;}}});
  expect(d.hp).toBe(0);expect(r.finalDamage).toBe(1000000);expect(r.packetRolls!.reduce((n,p)=>n+p.damage,0)).toBe(r.finalDamage);expect(counter.calls).toBeLessThan(200);expect(r.packetCount).toBeLessThanOrEqual(8);
 });
 it('载具编队保留逐车生命；旧V3快照恢复仍使用原规则',()=>{
  const vehicles=unit('车辆','ally','company','vehicle',12,400);applyCombatDamage(vehicles,100,1);
  expect(vehicles.formation!.health).toEqual([{hp:300,count:1},{hp:400,count:11}]);expect(memberHealthMax(vehicles)).toBe(4800);
  const old=generateUnit({rulesVersion:'v2',name:'旧单位',side:'ally',scale:'company',level:4,traits:[],hpMax:12},{registry,seed:'old'}).unit;
  const enemy=structuredClone(old);enemy.id='old-enemy';enemy.side='enemy';const b=new SmallBattle({combatants:[old,enemy],rules:V3_D20,seed:'old'});b.start();
  const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect(restored.rules.id).toBe('v3-d20');expect(restored.combatants[0]!.formation!.health).toBeUndefined();
 });
 it('自动选弹能对重装单体使用穿甲弹，手动榴弹选择仍然有效',()=>{
  const a=unit('炮车','ally','hero','vehicle'),d=unit('重装车辆','enemy','hero','vehicle');d.armor!.tier=4;d.armor!.level=6;d.armor!.recipe!.power=6;
  const opts={attacker:a,defender:d,rules:V4_TW,ranged:true,distance:3,conditionDefs,traitRegistry:registry};
  expect(previewAttack(opts).penetration).toBe(16);a.cannonAmmo='he';expect(previewAttack(opts).penetration).toBe(14);
 });
 it('高阶同档护甲按材料强度提供防护，跨代武器仍能压倒低阶防护',()=>{
  const a=unit('高阶射手','ally','hero','vehicle'),d=unit('高阶装甲','enemy','hero','vehicle');a.weapon=compileWeapon({mechanism:'rifle',power:10},{id:'rifle',seed:'rifle',noVariance:true});d.armor!.level=10;d.armor!.recipe!.power=10;d.hp=1000;d.base.hpMax=1000;
  const opts={attacker:a,defender:d,rules:V4_TW,ranged:true,distance:3,conditionDefs,traitRegistry:registry,rng:{seed:'grade',next:()=>0,d:()=>4}};
  const protectedHit=resolveAttack(opts);expect(protectedHit.armorScale).toBeGreaterThan(1000);expect(protectedHit.finalDamage).toBeGreaterThan(0);expect(protectedHit.finalDamage).toBeLessThan(100);
  d.hp=1000;d.armor!.level=4;d.armor!.recipe!.power=4;expect(resolveAttack(opts).finalDamage).toBe(1000);
 });
 it('会战同时命中按实际剩余生命提交；持续伤害扣成员生命而非整个人数',()=>{
  const a=unit('A','ally','hero','vehicle'),c=unit('C','ally','hero','vehicle'),d=unit('D','enemy','company','large',2,600);a.cannonAmmo='ap';c.cannonAmmo='ap';
  const b=new MassBattle({combatants:[a,c,d],rules:V4_TW,seed:'same-phase',traitRegistry:registry,rng:{seed:'fixed',next:()=>0,d:()=>4}});b.start();
  for(const u of [a,c])b.issue({unitId:u.id,type:'volley',targetId:d.id});b.issue({unitId:d.id,type:'hold'});b.resolveRound();
  // 9/16功率与训练增伤升级后，两发固定命中的穿甲炮各击倒一名600生命成员。
  const hits=b.log.filter(e=>e.resolution).map(e=>e.resolution!);expect(hits.reduce((n,r)=>n+r.finalDamage,0)).toBe(1200-memberHealth(d));expect(d.hp).toBe(0);expect(memberHealth(d)).toBe(0);
  const burning=unit('燃烧编队','enemy','company');burning.conditions=[{id:'burning',dur:3,sourceId:'火源',affectedMembers:1}];
  const source=unit('火源','ally','hero','vehicle'),small=new SmallBattle({combatants:[source,burning],rules:V4_D20,battlefield:standardField(),seed:'burning',traitRegistry:registry,rng});small.start();small.turnOrder=[source.id,burning.id];small.turnIndex=0;small.endTurn();
  expect(burning.hp).toBe(12);expect(memberHealth(burning)).toBeLessThan(1200);expect(small.log.find(e=>e.damage?.cause)?.damage?.unit).toBe('life');
 });
});
