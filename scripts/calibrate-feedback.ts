import { writeFileSync } from 'node:fs';
import { generateUnit, V4_D20, traitRegistry, previewAttack, standardConditionMap } from '../engine/src/index.js';
import { POWER_ANCHORS, anchoredWeapon, armorPowerScale } from '../engine/src/power-anchors.js';
import { prepareCombatModel } from '../engine/src/combat-model.js';
import { diceAvg } from '../engine/src/data/weapons.js';
import { encodeSave, decodeSave } from '../panel/src/storage-codec.js';
const registry=traitRegistry();
function unit(level:number,power:number,side:'ally'|'enemy'){
 const u=generateUnit({rulesVersion:'v2',name:side,side,scale:'hero',level,weaponClass:'rifle',weaponLevel:power,armorTier:3,armorLevel:power,traits:[]},{seed:'feedback-'+side,noVariance:true,registry}).unit;
 prepareCombatModel(u,V4_D20);return u;
}
const preview=(a:ReturnType<typeof unit>,d:ReturnType<typeof unit>)=>previewAttack({attacker:a,defender:d,rules:V4_D20,conditionDefs:standardConditionMap(),traitRegistry:registry,ranged:true,distance:2});
const round=(v:number)=>Number(v.toFixed(4));
const tiers=POWER_ANCHORS.map(row=>{
 const a=unit(5,row.level,'ally'),d=unit(5,row.level,'enemy'),w=anchoredWeapon(a.weapon)!,p=preview(a,d);
 return {L:row.level,budget:row.budget,rawWeaponMean:round(diceAvg(w.baseDice)*w.damageScale!),sameTierHeavyArmorScale:round(armorPowerScale(d)),sameTierHitChance:p.hitChance,sameTierExpectedLifeLoss:round(p.expectedDamage),targetLife:d.hp};
});
const training=[1,3,5,7,10].map(T=>{const p=preview(unit(T,5,'ally'),unit(5,5,'enemy'));return {T,hitChance:p.hitChance,expectedLifeLoss:round(p.expectedDamage)};});
const sample=JSON.stringify({reports:Array.from({length:1000},(_,id)=>({id,units:[unit(5,5,'ally'),unit(5,5,'enemy')],log:'命中但未减员，按实际剩余生命与伤势归档。'.repeat(10)}))});
const packed=encodeSave(sample);if(decodeSave(packed)!==sample)throw Error('压缩回环失败');
const report={date:'2026-09-16',tiers,training,storage:{sample:'1000份双单位报告（合成）',beforeUtf16Chars:sample.length,afterUtf16Chars:packed.length,savedPercent:round((1-packed.length/sample.length)*100)},checks:'数值与存储定向用例另见feedback-balance.test.ts及storage-codec.test.ts；未运行全量套件或真实宿主验收'};
writeFileSync('artifacts/feedback-20260916/calibration.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
