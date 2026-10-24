import {describe,it,expect,vi} from 'vitest';
import {generateUnit,traitRegistry,SmallBattle,MassBattle,V32_OVERFLOW_D20,V33_OVERFLOW_D20,V33_OVERFLOW_TW,
  prepareCombatModel,movementPoints,compileSkill,upgradeCombatSkills,standardField,type Combatant} from '../../engine/src/index.js';
import {areaTargets} from '../../engine/src/area-effects.js';
import {loadRatio} from '../../engine/src/equipment-load.js';
import {parseProtocol} from './protocol.js';
import {parseAbilitySpec} from './tags.js';
import {materializeUnitRecord,combatantFromUnknown} from './unit-state.js';
import {captureGeneration,namespaceOf,prepareNarrativeTransaction,proposalFromMessage,type MessageEnvelope} from './narrative-state.js';
import {generatedLayeredField} from '../../engine/src/small/layered-generator.js';
import {compileLayout} from './llm-layout.js';
import {neighbors,findGridPath} from '../../engine/src/small/spatial.js';
import {groundBlocked} from '../../engine/src/small/layers.js';

const registry=traitRegistry();
function unit(id:string,side:Combatant['side']='ally') {
 const u=generateUnit({name:id,side,scale:'hero',rulesVersion:'v2',level:5,numericModel:'graded-v1',loadModel:'capacity-v2',damageModel:'wounds-v2',weaponClass:'sword',armorTier:3,traits:[]},{registry,seed:id,noVariance:true}).unit;
 u.id=id;return u;
}
describe('移动、开放城墙与组合技能的实际行为',()=>{
 it('基础移动2的重甲单位不超负载时，每次激活均能进入相邻崎岖地，旧规则冻结',()=>{
  const a=unit('a'),d=unit('d','enemy');a.speedTier=2;
  const field=standardField();field.tiles.fill('rough');field.layerVersion=1;field.structures=field.tiles.map(()=>null);field.movementCostModel='minimum-step-v1';
  let b=new SmallBattle({combatants:[a,d],battlefield:field,rules:V33_OVERFLOW_D20,seed:'wear-rough'});b.start();b.turnOrder=['a','d'];b.turnIndex=0;a.pos=31;d.pos=3;
  expect(loadRatio(a)).toBeLessThan(.8);expect(movementPoints(a)).toBeCloseTo(1.9);
  for(const p of [30,29,28]) {
   expect(b.pathPreview('a',p).path).toBeDefined();b.moveTo('a',p);expect(b.byId('a').pos).toBe(p);
   b.endTurn();b.endTurn();b=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
  }
  const old=unit('old');old.speedTier=2;prepareCombatModel(old,V32_OVERFLOW_D20);expect(movementPoints(old)).toBeCloseTo(1.7);
 });
 it('括号共享等级和类别后的共享等级都保留单项L，重新解析与保存恢复一致',()=>{
  const specs=['震慑旋斩:（物理范围+近战+环形+惊惧）L4','震慑旋斩:（物理范围+近战+环形+惊惧L3）L4','震慑旋斩:物理范围L4+近战+环形+惊惧L2'];
  for(const [i,spec] of specs.entries()) {
   const parsed=parseProtocol(`<spawn name="a" side="ally" scale="hero" level="5" skills="${spec}"/>`);
   expect(parsed.errors).toEqual([]);expect(parseProtocol(parsed.canonical).canonical).toBe(parsed.canonical);
   const direct=parseAbilitySpec(spec)[0]!;expect(direct.level).toBe(4);
   const skill=compileSkill({id:direct.blueprintId},direct.level!,'a','skills-v4');
   const fear=skill.effects.find(e=>e.op==='condition'&&e.conditionId==='fearful');
   expect(fear).toMatchObject({op:'condition',saveDC:8+[4,3,2][i]!-1});
   const source:MessageEnvelope={characterId:'combo',chatId:'c',branchId:'b',messageId:String(i),swipeId:'0',generationId:String(i),role:'assistant',complete:true,text:parsed.canonical};
   const ns=namespaceOf(source),binding=captureGeneration({},ns,String(i));binding.complete=true;
   const saved=prepareNarrativeTransaction({},proposalFromMessage(source,binding)!,ns,true);
   const loaded=materializeUnitRecord(JSON.parse(JSON.stringify(saved.storage![0]!)),registry);
   prepareCombatModel(loaded,V33_OVERFLOW_D20);upgradeCombatSkills(loaded);
   expect(loaded.abilities[0]!.effects.find(e=>e.op==='condition'&&e.conditionId==='fearful')).toMatchObject(fear!);
  }
 });
 it('环形以施放者为圆心，包含唯一选中敌人，并能实际命中和附加惊惧',()=>{
  const a=unit('a'),d=unit('d','enemy'),f=standardField();f.tiles.fill('open');
  const spec=parseAbilitySpec('物理范围L4+近战+环形+惊惧L2')[0]!;
  a.abilities=[compileSkill({id:spec.blueprintId},4,'a','skills-v4')];a.preparedAbilityIds=[a.abilities[0]!.id];
  const b=new SmallBattle({combatants:[a,d],battlefield:f,rules:V33_OVERFLOW_D20,seed:'ring-actual'});b.start();b.turnOrder=['a','d'];b.turnIndex=0;a.pos=31;d.pos=30;
  expect(areaTargets({units:[a,d],mode:'small',fieldTags:[],battlefield:f,rules:V33_OVERFLOW_D20},a,d,a.abilities[0]!,u=>u.side==='enemy')).toEqual([d]);
  expect(areaTargets({units:[a,d],mode:'small',fieldTags:[],battlefield:f,rules:V32_OVERFLOW_D20},a,d,a.abilities[0]!,u=>u.side==='enemy')).toEqual([]);
  let rolls=0;const dice=vi.spyOn(b.rng,'d').mockImplementation(sides=>sides===20&&rolls++===0?20:1);
  const result=b.useAbility('a',a.abilities[0]!.id,'d');expect(result.ok,result.reason).toBe(true);dice.mockRestore();
  expect(d.conditions.some(c=>c.id==='fearful')).toBe(true);
  expect(b.log.some(e=>e.kind==='ability'&&e.participants?.includes('d'))).toBe(true);
  const snap=b.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
 });
 it('混合治疗、防护与高于共享等级的授予特质，入场后仍各用自己的L',()=>{
  const a=unit('a'),d=unit('d','enemy'),spec=parseAbilitySpec('（buff+治疗L2+屏障L3+防御L4+守护L6）L5')[0]!;
  a.abilities=[compileSkill({id:spec.blueprintId},spec.level!,'a','skills-v4')];
  const b=new SmallBattle({combatants:[a,d],battlefield:standardField(),rules:V33_OVERFLOW_D20,seed:'mixed-support'});b.start();
  const effects=a.abilities[0]!.effects;
  expect(effects).toEqual(expect.arrayContaining([
   expect.objectContaining({op:'heal',power:2}),expect.objectContaining({op:'barrier',defensePower:3}),
   expect.objectContaining({op:'condition',conditionId:'encouraged',dur:4}),expect.objectContaining({op:'trait',traitId:'guardian',level:6})
  ]));
  expect(()=>combatantFromUnknown(JSON.parse(JSON.stringify(a)))).not.toThrow();
 });
 it('会战环形也包含选定敌人，保存后保留新规则',()=>{
  const a=unit('a'),d=unit('d','enemy');a.scale='company';d.scale='company';
  a.tags.push('zone:中军','rank:front');d.tags.push('zone:中军','rank:front');
  const spec=parseAbilitySpec('物理范围L4+近战+环形+惊惧L2')[0]!,skill=compileSkill({id:spec.blueprintId},4,'a','skills-v4');
  const b=new MassBattle({combatants:[a,d],rules:V33_OVERFLOW_TW,seed:'ring-mass'});b.start();
  expect(areaTargets({units:[a,d],mode:'mass',fieldTags:[],rules:V33_OVERFLOW_TW},a,d,skill,u=>u.side==='enemy')).toEqual([d]);
  const snap=b.toSnapshot();expect(MassBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
 });
 it('中央城区的正面城墙连成开放防线，后方可通行且不强制围成方框',()=>{
  const plan=compileLayout({city:{at:['B2','C2','B3','C3'],walls:'front'},enemy:{at:['B1','C1']}},{scene:'city_siege',size:'large',attacker:'enemy',objectiveMode:'siege',units:[],map:[13,19]}).plan;
  const f=generatedLayeredField('open-city',7,13,['siege'],{plan,attackingSide:'enemy'}),walls=f.city!.frontline;
  expect([f.width,f.height]).toEqual([13,19]);expect(f.city!.shape).toBe('front');
  const reached=new Set([walls[0]!]),queue=[walls[0]!];for(let i=0;i<queue.length;i++)for(const n of neighbors(f,queue[i]!))if(walls.includes(n)&&!reached.has(n)){reached.add(n);queue.push(n);}
  expect(reached.size).toBe(walls.length);
  const outside=f.tiles.flatMap((_,p)=>!f.city!.inside.includes(p)&&!walls.includes(p)&&!groundBlocked(f,p)?[p]:[]);
  expect(outside.some(p=>findGridPath(f,p,f.city!.core[0]!,q=>!groundBlocked(f,q)))).toBe(true);
 });
 it('沿东部地图边缘的双重陆墙保留两条纵向防线，不能因double自动围成方堡',()=>{
  const plan=compileLayout({city:{at:['C1','D1','C2','D2','C3','D3','C4','D4'],walls:'double'},ally:{at:['A2','A3']}},{scene:'city_siege',size:'standard',attacker:'ally',objectiveMode:'siege',units:[],map:[11,17]}).plan;
  const f=generatedLayeredField('double-front',7,13,['siege'],{plan,attackingSide:'ally'});
  expect(f.city!.shape).toBe('front');expect(f.city!.facing).toBe('west');expect(f.city!.terrace!.length).toBeGreaterThan(0);
  expect(new Set(f.city!.frontline.map(p=>p%f.width)).size).toBe(2);
  expect(f.structures!.filter(s=>s?.kind==='gate')).toHaveLength(2);
 });
});
