import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, upgradeCombatSkills, V9_OVERFLOW_D20, V9_OVERFLOW_TW,
  V10_OVERFLOW_D20, V10_OVERFLOW_TW, traitRegistry, standardConditionMap, memberHealth,
  resolveAttack, previewAttack, penetrationContext, SeededRng, rulesById, compileGenericSkill,
  skillDefinitionId, skillAttack, grantBarrier, SmallBattle, MassBattle, standardField,
  type Combatant, type GenerateInput, type RulePack, type AttackOpts } from '../src/index.js';
import { gradeOvermatch, powerBudget, defensePower, anchoredProtection } from '../src/power-anchors.js';
import { placeZone, settleZones } from '../src/area-effects.js';
const registry=traitRegistry(),conditionDefs=standardConditionMap(),curve='continuous-v1' as const;
function unit(id:string,extra:Partial<GenerateInput>={}):Combatant {
 const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',rulesVersion:'v2',damageModel:'wounds-v2',scale:'hero',level:5,
  archetype:'ranged',weaponClass:'energy',weaponLevel:6,armorTier:1,armorLevel:5,traits:[],...extra},{seed:id,noVariance:true,registry}).unit;
 u.id=id;prepareCombatModel(u,V10_OVERFLOW_D20);upgradeCombatSkills(u);return u;
}
function opts(a:Combatant,d:Combatant,rules:RulePack=V10_OVERFLOW_D20):Omit<AttackOpts,'rng'> {
 return {attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,distance:4,ranged:!!a.weapon?.tags?.includes('ranged')};
}
function fixed(){return {seed:'fixed',next:()=>.5,d:(s:number)=>s===20?18:Math.min(s,4)};}
const expected=(p:number,d:number)=>{
 const gap=Math.max(0,p-d),tail=Math.max(0,gap-1)**2;
 return p<=d?1:1+(Math.sqrt(powerBudget(p)/powerBudget(d))-1)*(1+tail/(1+tail));
};
describe('V10 continuous adjacent overmatch and progressive distant tail',()=>{
 it('freezes every historical rule id and leaves the V9 safe band intact',()=>{
  for(let p=1;p<=10;p++)for(let d=1;d<=10;d++){
   const old=p<=d+1?1:Math.sqrt(powerBudget(p)/powerBudget(d+1));
   expect(gradeOvermatch(p,d,30,0)).toBeCloseTo(old,12);
  }
  for(const suffix of ['d20','tw']){
   expect(rulesById('v9-overflow-'+suffix).overmatchCurve).toBeUndefined();
   expect(rulesById('v10-overflow-'+suffix).overmatchCurve).toBe(curve);
  }
 });
 it('starts at any positive gap, strengthens larger gaps, preserves armor gate and stays finite',()=>{
  for(let p=1;p<=10;p++)for(let d=1;d<=10;d++){
   expect(gradeOvermatch(p,d,30,0,curve)).toBeCloseTo(expected(p,d),10);
   expect(gradeOvermatch(p,d,10,10,curve)).toBe(1);
   expect(gradeOvermatch(p,d,9,10,curve)).toBe(1);
   expect(gradeOvermatch(p,d,10.5,10,curve)).toBeCloseTo(1+(expected(p,d)-1)/2,10);
  }
  for(const bad of [undefined,NaN,Infinity,-Infinity,0,11])expect(gradeOvermatch(bad,4,30,0,curve)).toBe(1);
  for(const bad of [NaN,Infinity,-Infinity]){
   expect(gradeOvermatch(8,bad,30,0,curve)).toBe(1);
   expect(gradeOvermatch(8,4,bad,0,curve)).toBe(1);
   expect(gradeOvermatch(8,4,30,bad,curve)).toBe(1);
  }
 });
 it('has no jump at fractional equal or adjacent boundaries and is monotone',()=>{
  const eps=1e-8;
  for(const d of [1,3.25,5,7.9,9]){
   expect(gradeOvermatch(d+eps,d,30,0,curve)).toBeGreaterThan(1);
   expect(gradeOvermatch(d+eps,d,30,0,curve)-1).toBeLessThan(1e-6);
   if(d+1+eps<=10)expect(Math.abs(gradeOvermatch(d+1+eps,d,30,0,curve)-gradeOvermatch(d+1-eps,d,30,0,curve))).toBeLessThan(1e-5);
   let last=1;for(let n=0;n<=100;n++){const p=d+(10-d)*n/100,value=gradeOvermatch(p,d,30,0,curve);expect(value).toBeGreaterThanOrEqual(last-1e-12);last=value;}
  }
  for(let p=2;p<=10;p++){let last=Infinity;for(let n=0;n<=100;n++){const d=1+(p-1)*n/100,value=gradeOvermatch(p,d,30,0,curve);expect(value).toBeLessThanOrEqual(last+1e-12);last=value;}}
 });
 it('preserves full same-grade resolution and RNG in both modes and all common body sizes',()=>{
  for(const rules of [V10_OVERFLOW_D20,V10_OVERFLOW_TW])for(const p of [1,4,7,10])for(const body of ['human','large','giant','vehicle'] as const){
   const a=unit('a',{level:p,body,weaponLevel:p,armorLevel:p}),d=unit('d',{level:p,body,armorLevel:p,scale:'company',hpMax:48});
   const rng=new SeededRng('equal'),oldRng=new SeededRng('equal');
   const next=resolveAttack({...opts(a,structuredClone(d),rules),rng});
   const old=resolveAttack({...opts(a,structuredClone(d),rules===V10_OVERFLOW_D20?V9_OVERFLOW_D20:V9_OVERFLOW_TW),rng:oldRng});
   expect(next).toEqual(old);expect(rng.getState()).toEqual(oldRng.getState());
  }
 });
 it('keeps training, wards and unarmored equipment as defensive floors, never extra penetration',()=>{
  const d=unit('d',{level:8,armorTier:0,armorLevel:1});
  for(const channel of ['kinetic','thermal','arcane'] as const){
   expect(defensePower(d,channel)).toBe(8);expect(anchoredProtection(d,channel)).toBe(0);
  }
  d.conditions.push({id:'blessed',dur:3,defensePower:9});grantBarrier(d,100,3,'d',10);
  expect(defensePower(d,'thermal')).toBe(9);expect(defensePower(d,'thermal',true)).toBe(10);
  const a=unit('a',{weaponLevel:9});expect(penetrationContext(opts(a,d)).overmatchMultiplier).toBe(1);
  const independent=[];
  for(const level of [1,5,10])for(const body of ['human','large','vehicle','giant'] as const){
   const a=unit('a',{level,body,weaponLevel:8}),d=unit('d',{level:5,armorTier:0,armorLevel:1});
   independent.push(penetrationContext(opts(a,d)).overmatchMultiplier);
  }
  for(const n of independent)expect(n).toBeCloseTo(expected(8,5),10);
 });
 it.each([V10_OVERFLOW_D20,V10_OVERFLOW_TW])('$id shares the curve across weapon skills and independent spells without double application',rules=>{
  for(const label of ['魔法单体','魔法范围','物理单体']){
   const a=unit('a',{weaponLevel:6}),d=unit('d',{level:5,armorTier:0,armorLevel:1,scale:'company',hpMax:100});a.base.atk=100;
   const skill=compileGenericSkill(skillDefinitionId(label)!,6,a.id);a.abilities=[skill];upgradeCombatSkills(a);
   const ability=a.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage');if(!effect||effect.op!=='damage')throw Error('missing damage');
   const params=skillAttack({units:[a,d],mode:rules.hitMode==='tw'?'mass':'small',fieldTags:[]},a,d,ability,effect,rules);
   const original=resolveAttack({...opts(a,structuredClone(d),{...rules,overmatch:false}),...params,rng:fixed()});
   const result=resolveAttack({...opts(a,structuredClone(d),rules),...params,rng:fixed()});
   expect(result.overmatchMultiplier).toBeCloseTo(expected(6,5),10);
   expect(result.dmgMult/original.dmgMult).toBeCloseTo(expected(6,5),10);
   expect(result.damagePlans?.[0]?.overmatch?.curve).toBe(curve);
   expect(previewAttack({...opts(a,d,rules),...params}).expectedDamage).toBeGreaterThan(0);
  }
 });
 it('finite high-grade barriers and coverage-only shields use the same new curve in previews and execution',()=>{
  const a=unit('a',{weaponLevel:8}),d=unit('d',{level:5,armorLevel:5,shield:true,scale:'company',hpMax:48});
  d.shield!.recipe={version:'mechanism-v2.3',mechanism:'shield',power:8,quality:3,size:'human',seed:'shield'};
  expect(penetrationContext(opts(a,d)).overmatchMultiplier).toBeLessThan(penetrationContext(opts(a,{...d,shield:undefined})).overmatchMultiplier!);
  for(const barrier of [0,120]){
   const target=structuredClone(d);if(barrier)grantBarrier(target,barrier,3,'d',7);
   const attack=opts(a,target),before=JSON.stringify(target),preview=previewAttack(attack);expect(JSON.stringify(target)).toBe(before);
   const n=768,rng=new SeededRng('v10-barrier');let sum=0,squares=0;
   for(let i=0;i<n;i++){const copy=structuredClone(target);let total=0;for(let j=0;j<2;j++)total+=resolveAttack({...attack,defender:copy,rng}).finalDamage;sum+=total;squares+=total*total;}
   const variance=squares/n-(sum/n)**2;
   expect(Math.abs(sum/n-preview.expectedDamage)).toBeLessThan(5*Math.sqrt(variance/n)+1);
  }
 });
 it('fire/trap zones propagate new curve into barrier damage; poison and per-round guards stay unchanged',()=>{
  const run=(rules:RulePack,kind:'fire'|'trap'|'poison',barrier=false)=>{
   const a=unit('a',{level:1}),d=unit('d',{level:5,armorTier:0,armorLevel:1,hpMax:10000});a.pos=7;d.pos=8;
   if(barrier)grantBarrier(d,50,3,'d',6);
   const context={units:[a,d],mode:'small' as const,fieldTags:[],battlefield:standardField(),rules};
   placeZone(context,a,d,{op:'zone',kind,power:6,radius:0,dur:3},1,'zone');
   const result=settleZones(context,1)[0]!.damage;expect(settleZones(context,1)).toEqual([]);return result;
  };
  for(const kind of ['fire','trap'] as const){expect(run(V10_OVERFLOW_D20,kind)).toBeGreaterThan(run(V9_OVERFLOW_D20,kind));expect(run(V10_OVERFLOW_D20,kind,true)).toBeLessThan(run(V10_OVERFLOW_D20,kind));}
  expect(run(V10_OVERFLOW_D20,'poison')).toBe(run(V9_OVERFLOW_D20,'poison'));
 });
 it.each(['small','mass'] as const)('%s snapshot restore continues exactly with the explicit new version',mode=>{
  const a=unit('a',{body:mode==='mass'?'vehicle':'human'}),d=unit('d',{body:mode==='mass'?'vehicle':'human'});
  const b=mode==='small'?new SmallBattle({combatants:[a,d],rules:V10_OVERFLOW_D20,battlefield:standardField(),seed:'v10-restore',traitRegistry:registry}):new MassBattle({combatants:[a,d],rules:V10_OVERFLOW_TW,seed:'v10-restore',traitRegistry:registry});b.start();
  const snapshot=b.toSnapshot();const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(structuredClone(snapshot) as ReturnType<SmallBattle['toSnapshot']>):MassBattle.fromSnapshot(structuredClone(snapshot) as ReturnType<MassBattle['toSnapshot']>);
  expect(restored.rules.overmatchCurve).toBe(curve);
  for(const battle of [b,restored])for(let step=0;step<20&&!battle.isOver();step++){
   if(battle instanceof SmallBattle){if(battle.active?.status==='ready')battle.autoAction(battle.active.id);else battle.endTurn();}
   else{battle.autoOrders('ally');battle.autoOrders('enemy');battle.resolveRound();}
  }
  expect(restored.combatants.map(memberHealth)).toEqual(b.combatants.map(memberHealth));expect(restored.log).toEqual(b.log);
 });
});
