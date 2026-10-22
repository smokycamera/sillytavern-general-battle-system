import { generateUnit, prepareCombatModel, prepareArmsModel, prepareTraitModel, prepareTraitLevelModel, prepareItemModel, prepareResourceModel, V25_OVERFLOW_D20, V26_OVERFLOW_D20, standardConditionMap, traitRegistry, previewAttack, resolveAttack, SeededRng } from '../engine/src/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const graded=process.argv.includes('--graded'), rules=graded?V26_OVERFLOW_D20:V25_OVERFLOW_D20, conditions=standardConditionMap(), registry=traitRegistry(), rows:unknown[]=[];
function unit(id:string,level:number,weapon:string,stacked=false){
 const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',...(graded?{numericModel:'graded-v1' as const}:{}),level,weaponClass:weapon,weaponLevel:level,armorTier:1,armorLevel:level,traits:stacked?['berserk','melee-master']:[],...(stacked?{bonuses:{damage:4}}:{})},{seed:id,noVariance:true}).unit;
 prepareCombatModel(u,rules);prepareArmsModel(u,rules);prepareTraitModel(u,rules);prepareTraitLevelModel(u,rules);prepareItemModel(u,rules);prepareResourceModel(u,rules);return u;
}
for(const level of [3,5,8])for(const weapon of ['sword','greatsword','rifle','heavy-rifle','magic'])for(const stacked of [false,true]){
 const a=unit('a',level,weapon,stacked),d=unit('d',level,'sword');
 const opts={attacker:a,defender:d,rules,conditionDefs:conditions,traitRegistry:registry,ranged:!['sword','greatsword'].includes(weapon),distance:1};
 const p=previewAttack(opts), candidates=[];
 for(const healthScale of graded?[1]:[1,1.5,2]){
  const rng=new SeededRng(`health:${level}:${weapon}:${stacked}`);let killed=0,total=0;
  for(let i=0;i<64;i++){
   const defender=structuredClone(d);defender.base.hpMax=defender.hp=Math.round(d.hp*healthScale);let damage=0;
   for(let shot=0;shot<(a.weapon?.attacks??1)&&defender.hp>0;shot++){
    const r=resolveAttack({...opts,defender,rng});damage+=r.finalDamage;
   }
   total+=damage;if(defender.hp===0)killed++;
  }
  candidates.push({healthScale,hp:Math.round(d.hp*healthScale),oneActionKillRate:killed/64,meanResolvedDamage:total/64});
 }
 rows.push({level,weapon,stacked,hp:d.hp,expectedDamage:p.expectedDamage,damageOnHit:p.damageOnHit,hit:p.hitChance,damageToHealth:p.expectedDamage/d.hp,candidates});
}
const dest=process.argv[2]??'artifacts/graded-health-before.json';mkdirSync(dest.replace(/[\/][^\/]+$/, ''), {recursive:true});writeFileSync(dest,JSON.stringify(rows,null,2));
console.log(JSON.stringify({dest,cases:rows.length,rows:rows.filter((x:any)=>x.level===5)},null,2));

