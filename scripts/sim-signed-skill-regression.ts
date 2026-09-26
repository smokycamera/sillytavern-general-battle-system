/** Re-run the frozen 2,000-worldview and 240-default-policy starting snapshots.
 * Input: raw audit archive documented by PR #17. No synthetic result rows.
 * npx vite-node scripts/sim-signed-skill-regression.ts --worker=0 --workers=4
 */
import { readFileSync, readdirSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { SmallBattle, MassBattle, traitRegistry } from '../engine/src/index.js';
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=')[1]??fallback;
const worker=Number(arg('worker','0')),workers=Number(arg('workers','4')),limit=Number(arg('limit','999999'));
const out=arg('out','engine/sim/out/signed-skill-regression');mkdirSync(out,{recursive:true});
const scriptSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const path=`${out}/worker-${worker}.jsonl`;
const previous=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
if(previous.some(r=>r.scriptSha256!==scriptSha256))throw Error('Harness changed; choose a new output folder');
const done=new Set(previous.map(r=>r.id)),registry=traitRegistry();let assigned=0,completed=0,index=0;
for(const suite of ['worldview-2000','skill-policy-480']){
  const dir='engine/sim/out/'+suite;
  const baseline=new Map(readdirSync(dir).filter(p=>/^worker-.*\.jsonl$/.test(p)).flatMap(p=>readFileSync(dir+'/'+p,'utf8').trim().split('\n').filter(Boolean).map(s=>{const r=JSON.parse(s);return [r.id,r] as const;})));
  const rows=readdirSync(dir).filter(p=>/^logs-.*\.jsonl\.gz$/.test(p)).sort().flatMap(p=>gunzipSync(readFileSync(dir+'/'+p)).toString().trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)));
  const ids=new Set<string>();
  for(const row of rows){
    if(ids.has(row.id))throw Error('Duplicate source '+row.id);ids.add(row.id);
    if(suite==='skill-policy-480'&&!row.id.endsWith('-auto'))continue;
    if(index++%workers!==worker)continue;
    const id=suite+':'+row.id;if(done.has(id))continue;if(assigned++>=limit)continue;
    const base=baseline.get(row.id);if(!base)throw Error('Missing original result '+row.id);
    const inputHash=createHash('sha256').update(JSON.stringify(row.initialSnapshot)).digest('hex');
    const b=base.mode==='small'?SmallBattle.fromSnapshot(row.initialSnapshot,{traitRegistry:registry}):MassBattle.fromSnapshot(row.initialSnapshot,{traitRegistry:registry});
    const initialSnapshot=JSON.parse(JSON.stringify(b.toSnapshot()));let steps=0;
    while(!b.isOver()&&steps<1600){
      if(b instanceof SmallBattle){if(!b.active)throw Error('Missing active');b.autoAction(b.active.id);}
      else {b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
      steps++;
    }
    if(!b.isOver()||!b.winner())throw Error('Unfinished '+id);
    const usage=b.combatants.flatMap(u=>u.abilities.map(a=>({side:u.side,definition:a.definitionId??a.name,used:u.abilityState.find(s=>s.abilityId===(a.cooldownGroup??a.id))?.used??0})));
    const result={id,sourceId:row.id,suite,cellId:base.cellId,mode:base.mode,seed:base.seed,swap:base.swap,aSide:base.aSide,scriptSha256,inputHash,
      result:b.winner()==='draw'?'draw':b.winner()===base.aSide?'A':'B',round:b.round,roundsObserved:Math.min(b.round,base.mode==='small'?60:40),steps,usage,
      before:{result:base.result,round:base.round,roundsObserved:base.roundsObserved,usage:base.usage}};
    appendFileSync(`${out}/logs-${worker}.jsonl.gz`,gzipSync(JSON.stringify({id,inputHash,initialSnapshot,log:b.log})+'\n'));
    appendFileSync(path,JSON.stringify(result)+'\n');completed++;
    if(completed%25===0)console.log(JSON.stringify({worker,completed,last:id}));
  }
}
console.log(JSON.stringify({worker,completed,status:'complete'}));
