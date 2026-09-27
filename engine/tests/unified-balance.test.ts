import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, upgradeCombatSkills, V5_D20, V6_D20, V6_OVERFLOW_D20, V6_OVERFLOW_TW,
  traitRegistry, standardConditionMap, memberHealth, memberHealthMax, applyCombatDamage, applyXp, type GenerateInput, type Combatant } from '../src/index.js';
import { compileWeapon } from '../src/gen/equipment.js';
import { anchoredWeapon, combatPowerBudget, armorTransmission, shieldTransmission } from '../src/power-anchors.js';
import { diceAvg } from '../src/data/weapons.js';
import { nominalLife } from '../src/combat-model.js';
import { engagementWidth, sharedParticipants } from '../src/exposure.js';
import { skillDefinitionId } from '../src/skill-catalog.js';
import { conjureSkillUnit, summonedMemberLife } from '../src/skill-runtime.js';
import { previewAttack, resolveAttack } from '../src/damage.js';
import { SeededRng } from '../src/rng.js';
import { applyDamagePlan } from '../src/recovery.js';
import { XP_LEVEL_COSTS } from '../src/data/curves.js';
const registry=traitRegistry(), conditionDefs=standardConditionMap();
function unit(extra:Partial<GenerateInput>={}, old=false):Combatant {
 const u=generateUnit({name:'unit',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:old?'wounds-v1':'wounds-v2',level:5,archetype:'ranged',weaponClass:'sword',weaponLevel:5,armorTier:0,traits:[],...extra},{seed:'unified-test',noVariance:true,registry}).unit;
 prepareCombatModel(u,old?V5_D20:V6_D20);upgradeCombatSkills(u);return u;
}
const mean=(w:NonNullable<Combatant['weapon']>)=>(diceAvg(w.baseDice)+(w.apDice?diceAvg(w.apDice):0))*(w.damageScale??1);
describe('V6 unified formulas and bounded signed enhancements',()=>{
 it('T1–10, all bodies and ±10: individual/member life agrees, enhancements never create personnel',()=>{
  for(let level=1;level<=10;level++)for(const body of ['human','large','vehicle','giant'] as const)for(const health of [-10,0,10]) {
   const extra={level,body,bonuses:{health,power:health}},a=unit(extra),g=unit({...extra,scale:'company',hpMax:100});
   const expected=Math.round((16*level+4)*({human:1,large:2,vehicle:6,giant:6}[body])*(health===-10?.5:health===10?2:1));
   expect(a.base.hpMax).toBe(expected);expect(a.hp).toBe(expected);expect(g.formation!.memberHp).toBe(expected);
   expect(memberHealth(g)).toBe(expected*100);expect([g.hp,g.base.hpMax]).toEqual([100,100]);
  }
  expect(unit({level:10,body:'giant',archetype:'infantry',bonuses:{health:10,power:10}}).base.hpMax).toBe(1976);
 });
 it('existing wounds, custom life, death, skill identities and ledgers survive one explicit upgrade',()=>{
  const a=unit({archetype:'infantry',abilityBlueprints:[{id:skillDefinitionId('魔法单体')!,level:5}]},true);
  a.hp-=7;a.resources.SP=1;a.abilityState=[{abilityId:a.abilities[0]!.cooldownGroup!,cdLeft:2,used:1}];
  const before=structuredClone(a);prepareCombatModel(a,V6_D20);upgradeCombatSkills(a);
  expect(a.base.hpMax-a.hp).toBe(7);expect(a.base.hpMax).toBe(88);expect(a.weapon).toEqual(before.weapon);
  expect(a.abilities[0]!.id).toBe(before.abilities[0]!.id);expect(a.abilityState).toEqual(before.abilityState);expect(a.resources).toEqual(before.resources);
  const once=structuredClone(a);prepareCombatModel(a,V6_D20);upgradeCombatSkills(a);expect(a).toEqual(once);
  const g=unit({scale:'company',hpMax:100},true);applyCombatDamage(g,10,1);const count=g.hp;
  prepareCombatModel(g,V6_D20);expect(g.hp).toBe(count);expect(g.formation!.health).toEqual([{hp:74,count:1},{hp:84,count:99}]);
  const custom=unit({hpMax:777,hp:20},true);prepareCombatModel(custom,V6_D20);expect([custom.hp,custom.base.hpMax]).toEqual([20,777]);
  const dead=unit({},true);dead.hp=0;dead.status='dead';prepareCombatModel(dead,V6_D20);expect(dead.hp).toBe(0);expect(dead.status).toBe('dead');
  expect(()=>prepareCombatModel(a,V5_D20)).toThrow('降级');
 });
 it('giant weapon projection keeps seed and equipment intact, follows new strength, and leaves ranged/custom gear alone',()=>{
  for(let power=1;power<=10;power++)for(const noVariance of [true,false])for(const mechanism of ['sword','axe','spear','natural','rifle']) {
   const context={id:'same',seed:'same:'+power,body:'giant' as const,noVariance};
   const old=compileWeapon({mechanism,power},context);
   // Legacy generation remains byte-for-byte frozen; known recipe provenance is explicit.
   old.recipe!.noVariance=noVariance;
   const saved=structuredClone(old);
   const current=compileWeapon({mechanism,power},{...context,damageModel:'wounds-v2'});
   expect(mean(anchoredWeapon(old,'he','wounds-v2')!)).toBeCloseTo(mean(anchoredWeapon(current,'he','wounds-v2')!),8);
   expect(old).toEqual(saved);
   if(mechanism==='rifle')expect(old.baseDice).toBe(current.baseDice);
  }
  const custom=anchoredWeapon(unit({body:'giant'}).weapon,'he','wounds-v1')!;custom.customized=true;
  expect(anchoredWeapon(custom,'he','wounds-v2')).toEqual(custom);
 });
 it('frontage is shared under splitting; vehicles and crew limits remain separate',()=>{
  const a=unit({scale:'company',hpMax:100}),target=unit({scale:'company',hpMax:100});
  expect(sharedParticipants(a,[a],engagementWidth(a,target,true),target)).toBe(40);
  const split=[40,35,25].map((hp,i)=>{const u=unit({scale:'company',hpMax:hp});u.id=String(i);return u;});
  expect(split.reduce((n,u)=>n+sharedParticipants(u,split,20,target),0)).toBe(40);
  expect(engagementWidth(a,target,true,undefined,['forest'])).toBe(16);expect(engagementWidth(a,target,false,undefined,['forest'])).toBe(12);
  const old=unit({scale:'company',hpMax:100},true);expect(engagementWidth(old,target,true)).toBe(10);
 });
 it('P1/P2 only increase wound budgets; P9/P10 coverage is finite and weapon overflow stays on',()=>{
  expect(Array.from({length:10},(_,i)=>combatPowerBudget(i+1,'wounds-v2'))).toEqual([8,16,24,28,32,36,42,48,56,64]);
  for(const power of [9,10]) {
   const w=compileWeapon({mechanism:'cannon',power},{id:'gun',seed:'gun',body:'vehicle'});
   expect(anchoredWeapon(w,'he','wounds-v2')!.splashTargets).toBe(power===9?16:24);
   expect(anchoredWeapon(w,'he','wounds-v1')!.splashTargets).toBe(power===9?256:1e9);
  }
  expect(V6_OVERFLOW_D20.weaponOverflow&&V6_OVERFLOW_TW.weaponOverflow).toBe(true);
  const target=unit({scale:'company',hpMax:100,level:10});applyDamagePlan(target,{direct:500,targets:1,overflow:true});
  expect(memberHealthMax(target)-memberHealth(target)).toBe(500);expect(target.hp).toBe(97);
 });
 it('independent bursts conserve caster budget across exposure and preview does not mutate real state',()=>{
  const attacker=unit({level:1}),defender=unit({scale:'company',hpMax:100,body:'giant',level:10});
  attacker.weapon=undefined;
  const base={attacker,defender,rules:V6_OVERFLOW_D20,conditionDefs,traitRegistry:registry,ranged:true,
   abilityDamage:{baseDice:'8d6',damageScale:1,shape:'burst' as const,channel:'arcane' as const,penetration:30,areaExposure:4,delivery:'magic' as const}};
  const before=JSON.stringify([attacker,defender]),a=previewAttack(base),b=previewAttack({...base,abilityDamage:{...base.abilityDamage,areaExposure:32}});
  expect(a.expectedDamage).toBeCloseTo(b.expectedDamage,8);expect(b.exact).toBe(true);
  expect(previewAttack({...base,attacker:unit({level:1,scale:'company',hpMax:20})}).exact).toBe(false);expect(JSON.stringify([attacker,defender])).toBe(before);
  let total=0;for(let i=0;i<512;i++){const d=structuredClone(defender);resolveAttack({...base,defender:d,rng:new SeededRng('v6-area:'+i)});total+=memberHealth(defender)-memberHealth(d);}
  expect(Math.abs(total/512-a.expectedDamage)).toBeLessThan(2);
 });
 it('summon forms use the current life curve and share rather than multiply the member budget',()=>{
  for(const power of [1,3,5,7,10])for(const points of [-10,0,10]) {
   const single=conjureSkillUnit('conjured:single:'+power,'ally','single','small',{power:points},'wounds-v2')!;
   const group=conjureSkillUnit('conjured:group:'+power,'ally','group','mass',{power:points},'wounds-v2')!;
   prepareCombatModel(single,V6_D20);prepareCombatModel(group,V6_D20,summonedMemberLife(group));
   expect(memberHealth(group)).toBeLessThanOrEqual(single.hp);expect(single.hp-memberHealth(group)).toBeLessThan(group.hp);
   expect(mean(anchoredWeapon(group.weapon,'he','wounds-v2')!)*group.hp).toBeCloseTo(mean(anchoredWeapon(single.weapon,'he','wounds-v2')!),8);
  }
 });
 it('all intermediate signed health values keep level-up maxima identical for heroes and members',()=>{
  for(let points=-10;points<=10;points++)for(const archetype of ['infantry','ranged','mobile'] as const){
   const a=unit({level:1,archetype,bonuses:{health:points}}),g=unit({level:1,archetype,scale:'company',hpMax:20,bonuses:{health:points}});
   for(let level=2;level<=10;level++){
    applyXp(a,XP_LEVEL_COSTS[level-2]!,registry);applyXp(g,XP_LEVEL_COSTS[level-2]!,registry);
    expect(a.base.hpMax).toBe(nominalLife(a));expect(g.formation!.memberHp).toBe(a.base.hpMax);
   }
  }
 });
 it('T9→10 grows the new maximum without healing, spawning members or rerolling gear',()=>{
  for(const scale of ['hero','company'] as const){
   const a=unit({level:9,scale,body:'giant',bonuses:{health:10,power:10}}),hp=a.hp,health=memberHealth(a),gear=structuredClone(a.weapon),max=nominalLife(a);
   applyXp(a,XP_LEVEL_COSTS[8]!,registry);expect(a.level).toBe(10);expect(a.hp).toBe(hp);expect(memberHealth(a)).toBe(health);expect(a.weapon).toEqual(gear);expect(nominalLife(a)-max).toBe(192);
  }
 });
});
