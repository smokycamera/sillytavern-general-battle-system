/** Bounded activation probes, not completed battles and not included in battle totals. */
import { writeFileSync } from 'node:fs';
import {generateUnit,SmallBattle,standardField,V11_OVERFLOW_D20,traitRegistry,abilityCost,spCapacity,type Combatant}from '../engine/src/index.js';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'/tmp/cadence.json',registry=traitRegistry();
const rows=[];
for(let level=1;level<=10;level++)for(const kind of ['magic-single','magic-area','magic-single:stun'])for(const fallback of ['attack','rest']){
 const make=(id:string):Combatant=>{const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',rulesVersion:'v2',damageModel:'wounds-v2',scale:'hero',level,hpMax:100000,weaponClass:'magic',weaponLevel:1,armorTier:0,traits:['steadfast'],
  ...(id==='a'?{abilityBlueprints:[{id:'generic:'+kind,level}]}:{})},{seed:id,registry,noVariance:true}).unit;u.id=id;return u;};
 const a=make('a'),e=make('e'),field=standardField();field.tiles.fill('open');
 const b=new SmallBattle({combatants:[a,e],rules:V11_OVERFLOW_D20,battlefield:field,seed:'cadence:'+level+':'+kind,traitRegistry:registry});b.start();b.turnOrder=['a','e'];b.turnIndex=0;a.pos=31;e.pos=24;
 const spell=a.abilities[0]!,cost=abilityCost(a,spell)!.amount,capacity=spCapacity(a),activations=[];
 let n=0,steps=0;
 while(n<20&&!b.isOver()&&steps++<100){
  if(b.active?.id==='a'){
   n++;const before=a.resources.SP!,fatigueBefore=a.fatigue;
   const used=before>=cost?b.useAbility('a',spell.id,'e'):{ok:false,reason:'SP'};
   if(!used.ok&&fallback==='attack')b.attack('a','e');
   b.endTurn();activations.push({n,cast:used.ok,reason:used.ok?undefined:used.reason,before,after:a.resources.SP,fatigueBefore,fatigueAfter:a.fatigue});
  }else b.endTurn();
 }
 if(n!==20)throw Error('Probe ended unexpectedly');
 rows.push({level,kind,fallback,capacity,cost,casts:activations.filter(a=>a.cast).length,castsFirst6:activations.filter(a=>a.n<=6&&a.cast).length,firstGap:activations.find(a=>!a.cast)?.n,activations});
}
writeFileSync(out,JSON.stringify(rows,null,2));console.log(JSON.stringify({probes:rows.length,out}));
