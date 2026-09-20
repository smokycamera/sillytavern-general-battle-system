import {writeFileSync} from 'node:fs';
import {generateUnit,traitRegistry,prepareCombatModel,V3_D20,V3_TW,V4_D20,V4_TW,previewAttack,standardConditionMap,anchoredWeapon,anchoredProtection,armorPowerScale,POWER_ANCHORS} from '../engine/src/index.js';
import {compileWeapon,compileArmor} from '../engine/src/gen/equipment.js';
import {diceAvg} from '../engine/src/data/weapons.js';
const registry=traitRegistry(),conditionDefs=standardConditionMap(),cases=[];
for(const rules of [V3_D20,V3_TW,V4_D20,V4_TW])for(const size of [1,4,12]){
 const a=generateUnit({rulesVersion:'v2',name:'炮车',side:'ally',scale:size===1?'hero':'company',body:'vehicle',level:4,weaponClass:'cannon',weaponLevel:6,armorTier:0,quality:3,traits:[],...(size===1?{}:{hpMax:size,hp:size})},{registry,seed:'anchor-a',noVariance:true}).unit;
 const d=generateUnit({rulesVersion:'v2',name:'食人魔',side:'enemy',scale:'company',body:'giant',level:4,weaponClass:'sword',weaponLevel:4,armorTier:3,armorLevel:4,quality:3,traits:[],hpMax:12,hp:12},{registry,seed:'anchor-d',noVariance:true}).unit;
 prepareCombatModel(a,rules);prepareCombatModel(d,rules,100);a.cannonAmmo='he';
 const p=previewAttack({attacker:a,defender:d,rules,ranged:true,distance:3,conditionDefs,traitRegistry:registry});
 cases.push({rules:rules.id,shooters:size,memberHp:d.formation!.memberHp,penetration:p.penetration,resistance:p.resistance,armorScale:p.armorScale??1,through:p.penetrationFactor,hitChance:p.hitChance,damageChance:p.damageChance,
   expectedLifeLoss:p.damageModel==='member-health'?p.expectedDamage:undefined,expectedCasualties:p.expectedCasualties??p.expectedDamage,exact:p.exact,participants:p.participants});
}
const context={id:'anchor',seed:'anchor',quality:3,noVariance:true,body:'vehicle' as const};
const levels=POWER_ANCHORS.map(row=>{
 const raw=compileWeapon({mechanism:'cannon',power:row.level},context),weapon=anchoredWeapon(raw,'he')!,armor={armor:compileArmor({tier:3,power:row.level},context)};
 const total=(mechanism:string)=>{const w=anchoredWeapon(compileWeapon({mechanism,power:row.level},context))!;return +(diceAvg(w.baseDice)*(w.damageScale??1)*(w.attacks??1)).toFixed(2);};
 return {level:row.level,name:row.name,budget:row.budget,cannonBefore:diceAvg(raw.baseDice),cannonAfter:total('cannon'),rifleVolley:total('rifle'),autocannonVolley:total('autocannon'),cannonPenetration:weapon.penetration,heavyProtection:anchoredProtection(armor,'kinetic'),armorScale:+armorPowerScale(armor).toFixed(3)};
});
const result={assumptions:'T4/Q3，无额外特质、地形或疲劳，射程3；12名食人魔，每名100生命，重甲L4；火炮L6榴弹。只做公式投影，不跑随机胜率矩阵。单车预览为精确骰分布，多车为聚合估计并裁剪至目标剩余生命上限。',cases,levels};
writeFileSync('engine/sim/out/combat-v4-anchor-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({cases:cases.filter(c=>c.shooters===1),levels},null,2));
