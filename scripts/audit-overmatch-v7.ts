import { mkdirSync, writeFileSync } from 'node:fs';
import { generateUnit,prepareCombatModel,upgradeCombatSkills,SmallBattle,MassBattle,standardField,traitRegistry,
  V6_OVERFLOW_D20,V6_OVERFLOW_TW,V7_OVERFLOW_D20,V7_OVERFLOW_TW,memberHealth,skillDefinitionId,
  type GenerateInput,type Combatant } from '../engine/src/index.js';
const registry=traitRegistry();
function make(id:string,side:'ally'|'enemy',extra:Partial<GenerateInput>):Combatant {
 const unit=generateUnit({name:id,side,rulesVersion:'v2',damageModel:'wounds-v2',scale:'hero',level:5,archetype:'ranged',weaponClass:'energy',weaponLevel:5,armorTier:2,armorLevel:5,traits:[],...extra},{seed:id,noVariance:true,registry}).unit;
 unit.id=id;prepareCombatModel(unit,V6_OVERFLOW_D20);upgradeCombatSkills(unit);return unit;
}
function battle(roster:Combatant[],mode:'small'|'mass',v7:boolean,seed:string){
 const units=structuredClone(roster),rules=mode==='small'?(v7?V7_OVERFLOW_D20:V6_OVERFLOW_D20):(v7?V7_OVERFLOW_TW:V6_OVERFLOW_TW);
 const b=mode==='small'?new SmallBattle({combatants:units,rules,seed,battlefield:standardField(),traitRegistry:registry})
  :new MassBattle({combatants:units,rules,seed,traitRegistry:registry});b.start();
 let steps=0,lastRound=0;
 while(!b.isOver()&&b.round<=40&&steps<1000){
  steps++;lastRound=b.round;
  if(b instanceof SmallBattle){if(b.active?.status==='ready')b.autoAction(b.active.id);else b.endTurn();}
  else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
 }
 const resolutions=b.log.flatMap(e=>e.resolution?[e.resolution]:[]);
 return {over:b.isOver(),rounds:lastRound,steps,winner:b.isOver()?b.winner():null,
  final:b.combatants.map(u=>({id:u.id,hp:u.hp,health:memberHealth(u),status:u.status})),
  attacks:resolutions.map(r=>[r.attackerId,r.defenderId,r.hit,r.crit,r.finalDamage,r.hpAfter]),
  overmatchHits:resolutions.filter(r=>(r.overmatchMultiplier??1)>1&&r.hit).length};
}
const baseline:object[]=[],differences:object[]=[],cross:object[]=[];
for(const level of [3,5,8])for(const mode of ['small','mass'] as const)for(const gap of [0,1])for(const skills of [false,true])for(const seed of [0,1]){
 const roster=[];
 for(const side of ['ally','enemy'] as const)for(let i=0;i<2;i++){
  const power=level+(side==='enemy'?gap:0),body=level===8?'giant':'human';
  roster.push(make(side+i,side,{level:power,body,scale:mode==='mass'?'company':'hero',...(mode==='mass'?{hpMax:30}:{}),
   weaponClass:i?'sword':'energy',weaponLevel:power,armorLevel:power,
   ...(skills?{abilityBlueprints:[{id:skillDefinitionId(i?'物理单体':'魔法单体')!,level:power}]}:{})}));
 }
 const old=battle(roster,mode,false,'baseline:'+seed),next=battle(roster,mode,true,'baseline:'+seed);
 const same=JSON.stringify(old)===JSON.stringify(next),row={level,mode,gap,skills,seed,same,rounds:old.rounds,over:old.over,winner:old.winner};
 baseline.push(row);if(!same)differences.push({row,old,next});
}
for(const mode of ['small','mass'] as const)for(const scenario of ['liberty-v-rangers','sword10-v-company','spell8-v-company'] as const)for(const seed of [0,1,2,3]){
 const power=scenario==='sword10-v-company'?10:8;
 const a=make('a','ally',{body:'giant',level:8,hpMax:1800,weaponClass:scenario==='sword10-v-company'?'sword':'energy',weaponLevel:power,armorTier:4,armorLevel:8,traits:['steadfast'],
  ...(scenario==='spell8-v-company'?{weaponClass:'magic',weaponLevel:1,abilityBlueprints:[{id:skillDefinitionId('魔法单体')!,level:8}]}:{})});
 const d=make('d','enemy',{level:4,archetype:'infantry',scale:'company',hpMax:scenario==='liberty-v-rangers'?48:100,weaponClass:'rifle',weaponLevel:5,armorLevel:4,traits:['steadfast']});
 const old=battle([a,d],mode,false,'cross:'+seed),next=battle([a,d],mode,true,'cross:'+seed);
 cross.push({scenario,mode,seed,old,next});
}
mkdirSync('docs/validation',{recursive:true});
const path='docs/validation/overmatch-v7.json';
writeFileSync(path,JSON.stringify({baselineCommit:'6c553da43a37ec81766103719a5906b4e750969f',method:'V6 versus V7 using the same saved inputs and seeds; 40-round/1000-action limit. Cross cases use steadfast troops to measure damage rather than early routs. Not a population win-rate study.',baseline,differences,cross:cross.map((r:any)=>({...r,old:{...r.old,attacks:r.old.attacks.length},next:{...r.next,attacks:r.next.attacks.length}}))},null,2)+'\n');
console.log(JSON.stringify({path,baselinePairs:baseline.length,baselineDifferences:differences.length,baselineUnfinished:baseline.filter((r:any)=>!r.over).length,crossPairs:cross.length,
 cross:cross.map((r:any)=>({scenario:r.scenario,mode:r.mode,seed:r.seed,oldRounds:r.old.rounds,oldOver:r.old.over,newRounds:r.next.rounds,newOver:r.next.over,winner:r.next.winner}))},null,2));
if(differences.length)process.exitCode=1;
