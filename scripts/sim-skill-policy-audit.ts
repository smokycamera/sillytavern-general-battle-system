/** Follow-up: identical fixtures/seeds, default AI vs legal skill-priority policy. */
import {readFileSync,mkdirSync,appendFileSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {generateUnit,SmallBattle,MassBattle,standardField,V4_OVERFLOW_D20,V4_OVERFLOW_TW,traitRegistry} from '../engine/src/index.js';
import {compileItem} from '../engine/src/items.js';
import type {GenerateInput} from '../engine/src/types.js';
const registry=traitRegistry();
const source='engine/sim/out/worldview-2000/manifest.json';
const manifest=JSON.parse(readFileSync(source,'utf8'));
const output='engine/sim/out/skill-policy-480';mkdirSync(output,{recursive:true});
const worker=Number(process.argv.find(a=>a.startsWith('--worker='))?.split('=')[1]??0);
const scriptSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const cells=manifest.cells.filter((c:any)=>Number(c.id.slice(1))>=180&&Number(c.id.slice(1))<=191);
if(worker===0)writeFileSync(output+'/manifest.json',JSON.stringify({source,sourceSha256:manifest.sourceSha256,baseline:manifest.baseline,scriptSha256,cells,seeds:10,policies:['auto','skill-priority'],notes:'Skill-priority uses the first legal prepared skill once per action opportunity, otherwise default AI. It is a diagnostic policy, not an optimal player.'},null,2));
const path=`${output}/worker-${worker}.jsonl`;
const prior=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
if(prior.some(x=>x.scriptSha256!==scriptSha256))throw Error('Changed harness; choose new output');
const done=new Set(prior.map(x=>x.id));let completed=0;
for(const [index,c] of cells.entries()){
  if(index%2!==worker)continue;
  for(let seed=0;seed<10;seed++)for(const swap of [false,true])for(const policy of ['auto','skill-priority']){
    const id=`${c.id}-s${seed}-${swap?'reverse':'forward'}-${policy}`;if(done.has(id))continue;
    const aSide=swap?'enemy':'ally';
    const units=['A','B'].flatMap(team=>c[team==='A'?'a':'b'].map((role:any,slot:number)=>{
      const identity=`policy:${c.id}:${team}:${slot}`;
      const u=generateUnit({name:team,side:team==='A'?aSide:aSide==='ally'?'enemy':'ally',scale:c.mode==='small'?'hero':'company',rulesVersion:'v2',level:c.level,traits:[],weaponClass:role.weapon,weaponLevel:c.powerA,armorTier:role.armor,armorLevel:c.powerA,
        ...(c.mode==='mass'?{hpMax:50}:{}),abilityBlueprints:role.skills.map((s:string)=>({id:'generic:'+s,level:c.powerA}))} as GenerateInput,{registry,seed:identity,noVariance:true}).unit;
      if(role.shield){const shield=compileItem({kind:'shield',power:c.powerA},{id:identity+':shield',seed:identity});if(shield.kind==='shield')u.shield=shield.value;}
      if(c.mode==='mass')u.tags.push('zone:中军','rank:front');return u;
    })).sort((a:any,b:any)=>Number(a.side==='enemy')-Number(b.side==='enemy'));
    const field=standardField();field.tiles.fill('open');
    const battleSeed=`policy-diagnostic:${c.id}:${seed}`;
    const b=c.mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,seed:battleSeed,traitRegistry:registry})
      :new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,seed:battleSeed,traitRegistry:registry,roundLimit:40});
    b.start();if(b instanceof SmallBattle)for(const u of b.combatants)u.pos=u.side==='ally'?38:24;
    const initialSnapshot=JSON.stringify(b.toSnapshot());let steps=0,forced=0;
    while(!b.isOver()&&steps<1500){
      if(b instanceof SmallBattle){
        if(!b.active)throw Error('Missing active unit');const actor=b.active;
        let used=false;
        if(policy==='skill-priority')for(const ability of actor.abilities){
          const targets=b.combatants.filter(t=>ability.target==='enemy'?t.side!==actor.side:t.side===actor.side);
          for(const target of targets){const result=b.useAbility(actor.id,ability.id,target.id);if(result.ok){used=true;forced++;break;}}
          if(used)break;
        }
        if(used){if(!b.isOver())b.endTurn();}else b.autoAction(actor.id);
      }else{
        if(policy==='skill-priority')for(const actor of b.combatants){
          let issued=false;
          for(const ability of actor.abilities){
            for(const target of b.combatants.filter(t=>ability.target==='enemy'?t.side!==actor.side:t.side===actor.side)){
              if(!b.abilityOrderReason(actor.id,ability.id,target.id)){
                const result=b.useAbility(actor.id,ability.id,target.id);if(!result.ok)throw Error(result.reason);issued=true;forced++;break;
              }
            }
            if(issued)break;
          }
        }
        b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();
      }
      steps++;
    }
    if(!b.isOver()||!b.winner())throw Error('Unfinished '+id);
    const usage=b.combatants.flatMap(u=>u.abilities.map(a=>({side:u.side,definition:a.definitionId??a.name,used:u.abilityState.find(s=>s.abilityId===(a.cooldownGroup??a.id))?.used??0})));
    const row={id,cellId:c.id,mode:c.mode,policy,seed,swap,aSide,battleSeed,scriptSha256,sourceSha256:manifest.sourceSha256,result:b.winner()==='draw'?'draw':b.winner()===aSide?'A':'B',round:b.round,roundsObserved:Math.min(b.round,c.mode==='small'?60:40),reachedLimit:b instanceof SmallBattle?b.round>=60:b.round>40,steps,forced,usage};
    appendFileSync(output+`/logs-${worker}.jsonl.gz`,gzipSync(JSON.stringify({id,initialSnapshot:JSON.parse(initialSnapshot),log:b.log})+'\n'));
    appendFileSync(path,JSON.stringify(row)+'\n');completed++;
    if(completed%40===0)console.log(JSON.stringify({worker,completed,last:id}));
  }
}
console.log(JSON.stringify({worker,completed,status:'complete'}));
