/** 3 channels x 3 stats x {-10,0,+10} x 2 modes x 3 seeds x 2 sides = 324 battles. */
import { readFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, traitRegistry } from '../engine/src/index.js';
import { compileWeapon, compileArmor } from '../engine/src/gen/equipment.js';
import { anchoredWeapon, anchoredProtection } from '../engine/src/power-anchors.js';
import type { BonusStat } from '../engine/src/enhancements.js';
const out='engine/sim/out/signed-channel-battles';mkdirSync(out,{recursive:true});
const registry=traitRegistry(),scriptSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const file=out+'/results.jsonl';const old=existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
if(old.some(r=>r.scriptSha256!==scriptSha256))throw Error('Harness changed');const done=new Set(old.map(r=>r.id));let completed=0;
for(const channel of ['kinetic','thermal','arcane'] as const)for(const stat of ['Damage','Penetration','Protection'])for(const points of [-10,0,10])for(const mode of ['small','mass'] as const)for(let seed=0;seed<3;seed++)for(const swap of [false,true]){
 const id=`${channel}-${stat}-${points}-${mode}-${seed}-${swap?'reverse':'forward'}`;if(done.has(id))continue;
 const aSide=swap?'enemy':'ally';
 const units=['A','B'].map(team=>{
  const u=generateUnit({name:team,rulesVersion:'v2',side:team==='A'?aSide:swap?'ally':'enemy',scale:mode==='small'?'hero':'company',...(mode==='mass'?{hpMax:20}:{}),level:5,weaponClass:'rifle',weaponLevel:3,armorTier:3,armorLevel:3,traits:['steadfast']},{registry,seed:team,noVariance:true}).unit;u.id=team;
  const bonuses=team==='A'?{[(channel+stat) as BonusStat]:points}:undefined;
  u.weapon=compileWeapon({mechanism:'rifle',power:3,enchantment:channel==='kinetic'?'none':channel,...(stat!=='Protection'?{bonuses}:{})},{id:team+':rifle',seed:'equal',noVariance:true});
  u.armor=compileArmor({tier:3,power:3,profile:channel==='kinetic'?'balanced':channel,...(stat==='Protection'?{bonuses}:{})},{id:team+':armor',seed:'equal',noVariance:true});
  if(mode==='mass')u.tags.push('zone:中军','rank:front');return u;
 });
 const field=standardField();field.tiles.fill('open');
 const b=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,traitRegistry:registry,seed:`signed:${channel}:${stat}:${seed}`}):new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,traitRegistry:registry,seed:`signed:${channel}:${stat}:${seed}`,roundLimit:40});
 b.start();if(b instanceof SmallBattle)for(const u of units)u.pos=u.side==='ally'?38:24;
 const initialSnapshot=JSON.parse(JSON.stringify(b.toSnapshot()));let steps=0;
 while(!b.isOver()&&steps<1600){if(b instanceof SmallBattle){if(!b.active)throw Error('No active');b.autoAction(b.active.id);}else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}steps++;}
 if(!b.isOver()||!b.winner())throw Error('Unfinished '+id);
 const numbers=units.map(u=>({team:u.id,penetration:anchoredWeapon(u.weapon)?.penetration,resistance:anchoredProtection(u,channel)}));
 appendFileSync(out+'/logs.jsonl.gz',gzipSync(JSON.stringify({id,initialSnapshot,log:b.log})+'\n'));
 appendFileSync(file,JSON.stringify({id,channel,stat,points,mode,seed,swap,aSide,scriptSha256,numbers,result:b.winner()==='draw'?'draw':b.winner()===aSide?'A':'B',round:b.round,roundsObserved:Math.min(b.round,mode==='small'?60:40),steps})+'\n');
 completed++;if(completed%54===0)console.log(JSON.stringify({completed,last:id}));
}
console.log(JSON.stringify({completed,status:'complete'}));
