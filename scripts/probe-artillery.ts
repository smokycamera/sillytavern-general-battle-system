import {writeFileSync,mkdirSync} from 'node:fs';
import { generateUnit, prepareCombatModel, prepareArmsModel, prepareTraitModel, prepareTraitLevelModel, prepareItemModel, prepareResourceModel,
  V26_OVERFLOW_D20,V27_OVERFLOW_D20,standardConditionMap,traitRegistry,previewAttack,resolveAttack,SeededRng } from '../engine/src/index.js';
import {anchoredWeapon} from '../engine/src/power-anchors.js';
const rows:object[]=[],conditionDefs=standardConditionMap(),registry=traitRegistry();
for(const level of [3,5,8])for(const targetLevel of level===8?[3,8]:[level])for(const kind of ['cannon','indirect-cannon','rocket'])for(const guns of [1,6]) {
  for(const variant of ['v26','decay','no-splash','hp75']) {
    const rules=variant==='v26'?V26_OVERFLOW_D20:V27_OVERFLOW_D20;
    const make=(attacker:boolean)=>{
      const u=generateUnit({name:attacker?'a':'d',side:attacker?'ally':'enemy',scale:attacker&&guns===1?'hero':'company',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',
        level:attacker?level:targetLevel,...(attacker&&guns===6?{body:'vehicle' as const,hpMax:6}:attacker?{}:{hpMax:30}),weaponClass:attacker?kind:'sword',weaponLevel:attacker?level:targetLevel,armorTier:1,armorLevel:attacker?level:targetLevel,traits:[]},{seed:attacker?'a':'d',noVariance:true}).unit;
      prepareCombatModel(u,rules);prepareArmsModel(u,rules);prepareTraitModel(u,rules);prepareTraitLevelModel(u,rules);prepareItemModel(u,rules);prepareResourceModel(u,rules);return u;
    };
    const a=make(true),d=make(false);
    if(variant==='no-splash')a.weapon={...anchoredWeapon(a.weapon,'he','wounds-v2')!,splashTargets:0,splashFactor:0};
    if(variant==='hp75'){d.formation!.memberHp=Math.round(d.formation!.memberHp*7/6);d.formation!.health=[{hp:d.formation!.memberHp,count:d.hp}];}
    const opts={attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,ranged:true,distance:4};
    const p=previewAttack(opts);let wipes=0,total=0;const rng=new SeededRng(`artillery:${level}:${targetLevel}:${kind}:${guns}`);
    for(let i=0;i<32;i++){const defender=structuredClone(d);for(let n=0;n<(a.weapon?.attacks??1)&&defender.hp>0;n++)resolveAttack({...opts,defender,rng});if(!defender.hp)wipes++;total+=30-defender.hp;}
    rows.push({level,targetLevel,kind,guns,variant,expectedDamage:p.expectedDamage,expectedCasualties:p.expectedCasualties,meanCasualties:total/32,wipes,trials:32,memberHp:d.formation!.memberHp});
  }
}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/artillery-comparison.json',JSON.stringify(rows,null,2));
for(const variant of ['v26','decay','no-splash','hp75']){const data=rows as any[];console.log(JSON.stringify({variant,cases:data.filter(r=>r.variant===variant).length,wipes:data.filter(r=>r.variant===variant).reduce((n,r)=>n+r.wipes,0),meanCasualties:data.filter(r=>r.variant===variant).reduce((n,r)=>n+r.meanCasualties,0)/24}));}
