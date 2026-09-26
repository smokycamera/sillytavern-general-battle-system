/** 16 contextual skills x 2 modes x 5 seeds x 2 side assignments = 320 actual battles.
 * Run this same file against baseline and candidate engines. No forced skill policy.
 */
import { readFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, traitRegistry, applyCombatDamage } from '../engine/src/index.js';
import { compileSkill, skillDefinitionId } from '../engine/src/skill-catalog.js';
import { compileItem } from '../engine/src/items.js';
import type { Combatant, GenerateInput } from '../engine/src/index.js';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'engine/sim/out/support-candidate';mkdirSync(out,{recursive:true});
const registry=traitRegistry(),scriptSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const cases=[
 ['stun-threat','减益眩晕'],['disarm-weapon','减益缴械'],['disarm-natural','减益缴械'],
 ['silence-caster','减益沉默'],['silence-empty','减益沉默'],['silence-weapon','减益沉默'],
 ['root-chase','减益定身'],['cleanse-stun','增益净化'],['restore-caster','增益回能'],
 ['fear-fragile','减益惊惧'],['fear-steadfast','减益惊惧'],['barrier-threat','屏障'],
 ['heal-wound','增益治疗'],['heal-full','增益治疗'],['shield-strike','物理单体+盾牌+眩晕'],['combined-controls','减益+眩晕+缴械+沉默'],
];
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
 const actor=make('A',0),foe=make('B',0,{weaponClass:name==='disarm-natural'?'natural':name==='silence-weapon'?'magic':'sword'}),units=[actor,foe];
 const teach=(u:Combatant,label:string,power=5)=>{const definition=skillDefinitionId(label);if(!definition)throw Error('Unknown '+label);const a=compileSkill({id:definition},power,u.id);u.abilities.push(a);(u.preparedAbilityIds??=[]).push(a.id);return a;};
 const tested=teach(actor,skillName!);
 if(name!.startsWith('silence-')&&name!=='silence-weapon'){teach(foe,'魔法单体',6);foe.weapon=make('B',9,{weaponClass:'sword',weaponLevel:1}).weapon;if(name==='silence-empty')foe.resources.SP=0;}
 if(name==='fear-fragile'||name==='fear-steadfast'){foe.morale=33;if(name==='fear-steadfast')foe.traits.push('steadfast');}
 if(name==='shield-strike'){const item=compileItem({kind:'shield',power:5},{id:'shield',seed:id});if(item.kind==='shield')actor.shield=item.value;}
 let friend:Combatant|undefined;
 if(['cleanse-stun','restore-caster','barrier-threat','heal-wound','heal-full'].includes(name!)){
  friend=make('A',1,{weaponLevel:6});units.push(friend,make('B',1));
  if(name==='cleanse-stun')friend.conditions.push({id:'stunned',dur:2});
  if(name==='restore-caster'){friend.weapon=make('A',9).weapon;teach(friend,'魔法单体',6);friend.resources.SP=0;}
 }
 const field=standardField();field.tiles.fill('open');
 const b=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,traitRegistry:registry,seed:`support:${name}:${seed}`}):new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,traitRegistry:registry,seed:`support:${name}:${seed}`,roundLimit:40});
 b.start();
 if(b instanceof SmallBattle){for(const u of units)u.pos=u.side==='ally'?31:24;b.turnOrder=[actor.id,...units.filter(u=>u!==actor).map(u=>u.id)];b.turnIndex=0;if(name==='root-chase')foe.pos=actor.side==='ally'?10:45;}
 if(name==='heal-wound'&&friend)applyCombatDamage(friend,mode==='small'?200:400,mode==='small'?1:20);
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
