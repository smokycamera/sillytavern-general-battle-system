import { generateUnit, SmallBattle, standardField, traitRegistry, V7_OVERFLOW_D20, V8_OVERFLOW_D20, skillDefinitionId } from '../engine/src/index.js';
const registry=traitRegistry(),heavy=process.argv.includes('--heavy');
for(const level of heavy?[3,5]:[1,3,5,7,10])for(const tier of heavy?[3] as const:[1,3] as const)for(const kind of heavy?['physical','blunt']:['basic','physical','magic'])for(const sample of heavy?[0,1,2,3,4,5,6,7]:[0,1])for(const rules of [V7_OVERFLOW_D20,V8_OVERFLOW_D20]) {
 const units=['a','b'].map(id=>{const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',scale:'hero',level,archetype:'infantry',rulesVersion:'v2',damageModel:'wounds-v2',weaponClass:kind==='magic'?'magic':kind==='blunt'?'blunt':'sword',weaponLevel:level,armorTier:tier,armorLevel:level,traits:['steadfast'],abilityBlueprints:kind==='basic'?[]:[{id:skillDefinitionId(kind==='magic'?'魔法单体奥术':'物理单体近战')!,level}]},{seed:id,registry,noVariance:true}).unit;u.id=id;return u;});
 const field=standardField();field.tiles.fill('open');
 const b=new SmallBattle({combatants:units,rules,seed:'pacing:'+sample,traitRegistry:registry,battlefield:field});b.start();b.byId('a').pos=45;b.byId('b').pos=46;
 let steps=0,last=0;
 while(!b.isOver()&&steps<160){steps++;last=b.round;if(b.active?.status==='ready')b.autoAction(b.active.id);else b.endTurn();}
 console.log(JSON.stringify({level,tier,kind,sample,rules:rules.id,rounds:last,steps,finished:b.isOver(),winner:b.winner()}));
}
