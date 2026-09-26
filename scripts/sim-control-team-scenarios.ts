/** 4 team-control scenarios x 2 modes x 5 seeds x 2 sides = 80 actual battles.
 * Run this same file against baseline and candidate engines. No forced skill policy.
 */
import { readFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, traitRegistry, applyCombatDamage } from '../engine/src/index.js';
import { compileSkill, skillDefinitionId } from '../engine/src/skill-catalog.js';
import { compileItem } from '../engine/src/items.js';
import type { Combatant, GenerateInput } from '../engine/src/index.js';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'engine/sim/out/control-teams-candidate';mkdirSync(out,{recursive:true});
const registry=traitRegistry(),scriptSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const cases=[['stun-team','减益眩晕'],['disarm-team','减益缴械'],['silence-team','减益沉默'],['combo-team','减益+眩晕+缴械+沉默']];
const path=out+'/results.jsonl';const old=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
if(old.some(r=>r.scriptSha256!==scriptSha256))throw Error('Changed harness; choose another output');
const done=new Set(old.map(r=>r.id));let completed=0;
for(const mode of ['small','mass'] as const)for(const [name,skillName] of cases)for(let seed=0;seed<5;seed++)for(const swap of [false,true]){
 const id=`${name}-${mode}-${seed}-${swap?'reverse':'forward'}`;if(done.has(id))continue;
 const aSide=swap?'enemy':'ally',bSide=swap?'ally':'enemy';
 const make=(team:string,slot:number,extra:Partial<GenerateInput>={})=>{
  const u=generateUnit({rulesVersion:'v2',name:team+slot,side:team==='A'?aSide:bSide,scale:mode==='small'?'hero':'company',level:5,hpMax:mode==='small'?500:20,weaponClass:'sword',weaponLevel:team==='A'&&slot===0?1:5,armorTier:1,armorLevel:3,traits:[],...extra},{registry,seed:`support:${name}:${team}${slot}`,noVariance:true}).unit;u.id=team+slot;
  if(mode==='mass')u.tags.push('zone:中军','rank:front');return u;
 };
 const actor=make('A',0,{weaponClass:'magic'}),foe=make('B',0),friend=make('A',1),counter=make('B',1,{weaponClass:'magic',weaponLevel:1}),units=[actor,foe,friend,counter];
 const teach=(u:Combatant,label:string,power=5)=>{const definition=skillDefinitionId(label);if(!definition)throw Error('Unknown '+label);const a=compileSkill({id:definition},power,u.id);u.abilities.push(a);(u.preparedAbilityIds??=[]).push(a.id);return a;};
 const tested=teach(actor,skillName!);
 if(name==='silence-team'){for(const u of [friend,foe]){u.weapon=make(u.side===aSide?'A':'B',9,{weaponClass:'sword',weaponLevel:1}).weapon;teach(u,'魔法单体',5);u.resources.SP=20;}}
 const field=standardField();field.tiles.fill('open');
 const b=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,traitRegistry:registry,seed:`support:${name}:${seed}`}):new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,traitRegistry:registry,seed:`support:${name}:${seed}`,roundLimit:40});
 b.start();
 if(b instanceof SmallBattle){for(const u of units){const rear=u===actor||u===counter;u.pos=u.side==='ally'?(rear?38:31):(rear?17:24);}b.turnOrder=[actor.id,...units.filter(u=>u!==actor).map(u=>u.id)];b.turnIndex=0;}
 else for(const u of [actor,counter])u.formationPosition=u.side+':中军:rear';
 const initialSnapshot=JSON.parse(JSON.stringify(b.toSnapshot()));let steps=0;
 while(!b.isOver()&&steps<1600){if(b instanceof SmallBattle){if(!b.active)throw Error('No active');b.autoAction(b.active.id);}else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}steps++;}
 if(!b.isOver()||!b.winner())throw Error('Unfinished '+id);
 const usage=units.flatMap(u=>u.abilities.map(a=>({unitId:u.id,definition:a.definitionId,used:u.abilityState.find(s=>s.abilityId===(a.cooldownGroup??a.id))?.used??0})));
 const used=actor.abilityState.find(s=>s.abilityId===(tested.cooldownGroup??tested.id))?.used??0;
 appendFileSync(out+'/logs.jsonl.gz',gzipSync(JSON.stringify({id,initialSnapshot,log:b.log})+'\n'));
 appendFileSync(path,JSON.stringify({id,name,mode,seed,swap,aSide,scriptSha256,result:b.winner()==='draw'?'draw':b.winner()===aSide?'A':'B',round:b.round,roundsObserved:Math.min(b.round,mode==='small'?60:40),steps,used,usage})+'\n');
 completed++;if(completed%20===0)console.log(JSON.stringify({completed,last:id}));
}
console.log(JSON.stringify({completed,status:'complete'}));
