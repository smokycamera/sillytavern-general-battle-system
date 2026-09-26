/** Matched armor diagnostics: hold T5/P3, body, skill and start fixed. */
import {readFileSync,mkdirSync,appendFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {generateUnit,SmallBattle,MassBattle,standardField,V4_OVERFLOW_D20,V4_OVERFLOW_TW,traitRegistry} from '../engine/src/index.js';
const registry=traitRegistry(),output='engine/sim/out/armor-control-320';mkdirSync(output,{recursive:true});
const baseline=JSON.parse(readFileSync('engine/sim/out/worldview-2000/manifest.json','utf8'));
const scriptSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const cases=[{id:'sword-blunt-unarmored',a:'sword',b:'blunt',armor:0,profile:'balanced'},
  {id:'sword-blunt-heavy',a:'sword',b:'blunt',armor:3,profile:'balanced'},
  {id:'rifle-energy-kinetic',a:'rifle',b:'energy',armor:3,profile:'kinetic'},
  {id:'rifle-energy-thermal',a:'rifle',b:'energy',armor:3,profile:'thermal'}] as const;
writeFileSync(output+'/manifest.json',JSON.stringify({baseline:baseline.baseline,sourceSha256:baseline.sourceSha256,scriptSha256,cases,seeds:20,training:5,power:3,companyMembers:50,method:'Fixed close start, open terrain, no skills/accessories, no variance, both side and input order swapped'},null,2));
const path=output+'/matches.jsonl',prior=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
if(prior.some(x=>x.scriptSha256!==scriptSha256))throw Error('Harness changed');const done=new Set(prior.map(x=>x.id));let completed=0;
for(const c of cases)for(const mode of ['small','mass'])for(let seed=0;seed<20;seed++)for(const swap of [false,true]){
  const id=`${c.id}-${mode}-s${seed}-${swap?'reverse':'forward'}`;if(done.has(id))continue;
  const aSide=swap?'enemy':'ally';
  const units=([['A',c.a],['B',c.b]] as const).map(([team,weapon])=>{
    const u=generateUnit({name:team,side:team==='A'?aSide:aSide==='ally'?'enemy':'ally',rulesVersion:'v2',scale:mode==='small'?'hero':'company',level:5,traits:[],weaponClass:weapon,weaponLevel:3,armorTier:c.armor,armorLevel:3,armorProfile:c.profile,...(mode==='mass'?{hpMax:50}:{})},
      {registry,seed:`armor-control:${team}`,noVariance:true}).unit;u.tags.push('zone:中军','rank:front');return u;
  }).sort((a,b)=>Number(a.side==='enemy')-Number(b.side==='enemy'));
  const field=standardField();field.tiles.fill('open');const battleSeed=`armor-control:${seed}`;
  const b=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,seed:battleSeed,traitRegistry:registry})
    :new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,seed:battleSeed,traitRegistry:registry,roundLimit:40});
  b.start();if(b instanceof SmallBattle)for(const u of b.combatants)u.pos=u.side==='ally'?38:24;
  const initialSnapshot=JSON.stringify(b.toSnapshot());let steps=0;
  while(!b.isOver()&&steps<1500){if(b instanceof SmallBattle){if(!b.active)throw Error('Missing active unit');b.autoAction(b.active.id);}else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}steps++;}
  if(!b.isOver()||!b.winner())throw Error('Unfinished '+id);
  const attacks=b.log.flatMap(e=>e.resolutions??(e.resolution?[e.resolution]:[]));
  const row={id,cellId:c.id+'-'+mode,caseId:c.id,mode,seed,swap,aSide,battleSeed,sourceSha256:baseline.sourceSha256,scriptSha256,
    result:b.winner()==='draw'?'draw':b.winner()===aSide?'A':'B',round:b.round,roundsObserved:Math.min(b.round,mode==='small'?60:40),reachedLimit:b instanceof SmallBattle?b.round>=60:b.round>40,usage:[],steps,
    attacks:attacks.length,noPenetration:attacks.filter(a=>a.penetrationFactor===0).length};
  appendFileSync(output+'/logs.jsonl.gz',gzipSync(JSON.stringify({id,initialSnapshot:JSON.parse(initialSnapshot),log:b.log})+'\n'));
  appendFileSync(path,JSON.stringify(row)+'\n');completed++;
  if(completed%40===0)console.log(JSON.stringify({completed,last:id}));
}
console.log(JSON.stringify({completed,status:'complete'}));
