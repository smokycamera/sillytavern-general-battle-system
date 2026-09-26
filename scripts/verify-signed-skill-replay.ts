/** Verify a deterministic selection of complete saved battles, not only winners. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { SmallBattle, MassBattle, traitRegistry } from '../engine/src/index.js';
const registry=traitRegistry(),verified:string[]=[];
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
for(const suite of ['signed-skill-regression','support-candidate-v2','control-teams-candidate','signed-channel-battles']){
 const dir='engine/sim/out/'+suite;
 const rows=readdirSync(dir).filter(p=>p.endsWith('.jsonl.gz')).sort().flatMap(p=>gunzipSync(readFileSync(dir+'/'+p)).toString().trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)));
 for(const mode of ['small','mass']){
  const selected=rows.filter(r=>!!r.initialSnapshot.battlefield===(mode==='small')).sort((a,b)=>a.id.localeCompare(b.id));
  const count=suite==='signed-skill-regression'||suite==='support-candidate-v2'?4:2;
  for(let i=0;i<count;i++){
   const saved=selected[Math.floor(i*(selected.length-1)/(count-1))];if(!saved)throw Error('Missing examples');
   const b=mode==='small'?SmallBattle.fromSnapshot(saved.initialSnapshot,{traitRegistry:registry}):MassBattle.fromSnapshot(saved.initialSnapshot,{traitRegistry:registry});let steps=0;
   while(!b.isOver()&&steps<1600){if(b instanceof SmallBattle){if(!b.active)throw Error('No active');b.autoAction(b.active.id);}else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}steps++;}
   if(!b.isOver()||hash(b.log)!==hash(saved.log))throw Error('Replay differs '+saved.id);
   verified.push(suite+':'+saved.id);
  }
 }
}
writeFileSync('docs/signed-skill-balance-20260926/replay-verification.json',JSON.stringify({verified:verified.length,completeLogsMatch:true,ids:verified},null,2)+'\n');
console.log(JSON.stringify({verified:verified.length,completeLogsMatch:true}));
