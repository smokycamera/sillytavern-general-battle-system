/** Paired, seeded battles through the production SmallBattle / MassBattle AI.
 * Formula selection is supplied by the experiment runner, never by the combat policy.
 */
import { mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { generateUnit, SmallBattle, MassBattle, generatedField, rulesById,
  traitRegistry, memberHealth, memberHealthMax, validateMemberHealth, skillDefinitionId, grantBarrier,
  type Combatant, type GenerateInput } from '../engine/src/index.js';
const arg=(key:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.split('=').slice(1).join('=')??fallback;
const label=arg('label','baseline'),out=arg('out','/mnt/data/curve-results'),phase=arg('phase','discovery');
const only=arg('only',''),production=arg('production','false')==='true';
const smallRules=rulesById(production?'v10-overflow-d20':'v9-overflow-d20'),massRules=rulesById(production?'v10-overflow-tw':'v9-overflow-tw');
const limit=Number(arg('limit','999999')),offset=Number(arg('offset',phase==='holdout'?'104729':'0'));
const shard=Number(arg('shard','0')),shards=Number(arg('shards','1'));
mkdirSync(out,{recursive:true});
const registry=traitRegistry();
type Spec=Partial<GenerateInput>&{barrier?:number;ward?:number};
type Scenario={id:string;group:string;a:Spec[];b:Spec[];high?:'A';low:number;highLevel:number};
const cases:Scenario[]=[];
const weapons=['sword','axe','spear','blunt','rifle','energy','magic','firearm','bow','heavy-rifle'];
const base=(level:number,weaponClass='sword',extra:Spec={}):Spec=>({level,weaponClass,weaponLevel:level,armorLevel:level,armorTier:1,traits:[],...extra});
const add=(id:string,group:string,a:Spec[],b:Spec[],low:number,highLevel:number)=>cases.push({id,group,a,b,low,highLevel,...(highLevel>low?{high:'A' as const}:{})});
for(let l=1;l<=10;l++){
 const w=weapons[(l-1)%weapons.length]!;
 const skill=l%3===0?[{id:skillDefinitionId(w==='magic'?'魔法单体奥术':'物理单体近战')!,level:l}]:[];
 const s=base(l,w,{armorTier:(l%5) as 0|1|2|3|4,abilityBlueprints:skill,shield:l%4===0});
 add('same-L'+l,'same',[s],[s],l,l);
}
for(let l=1;l<=9;l++){
 const w=weapons[(l-1)%weapons.length]!;
 add('equipment-L'+(l+1)+'-L'+l,'adjacent-equipment',[base(l,w,{weaponLevel:l+1})],[base(l,w)],l,l+1);
 add('matched-L'+(l+1)+'-L'+l,'adjacent-matched',[base(l+1,w)],[base(l,w)],l,l+1);
}
for(const [p,d] of [[3,1],[4,2],[5,3],[6,4],[7,5],[8,6],[8,5],[9,6],[10,7],[10,1]]){
 const w=weapons[(p!+d!)%weapons.length]!;
 add('gap-L'+p+'-L'+d,'wide',[base(d!,w,{weaponLevel:p})],[base(d!,w)],d!,p!);
}
add('artifact-v-100','overflow',[base(7,'sword',{weaponLevel:10,armorLevel:7,body:'large',scale:'hero',traits:['steadfast']})],[base(4,'rifle',{scale:'company',hpMax:100,traits:['steadfast']})],4,10);
add('energy-v-48','overflow',[base(8,'energy',{body:'giant',weaponLevel:8,scale:'hero',traits:['steadfast']})],[base(4,'rifle',{weaponLevel:5,scale:'company',hpMax:48,traits:['steadfast']})],4,8);
add('spell-v-100','spell-overflow',[base(6,'magic',{weaponLevel:1,body:'large',scale:'hero',abilityBlueprints:[{id:skillDefinitionId('魔法单体奥术')!,level:9}],traits:['steadfast']})],[base(4,'rifle',{scale:'company',hpMax:100,traits:['steadfast']})],4,9);
add('burst-mixed','area',[base(7,'magic',{weaponLevel:1,abilityBlueprints:[{id:skillDefinitionId('魔法范围燃烧')!,level:8}]}),base(7,'spear')],[base(6,'rifle'),base(6,'magic',{abilityBlueprints:[{id:skillDefinitionId('魔法单体')!,level:6}]})],6,8);
add('shield-screen','shield',[base(5,'energy',{weaponLevel:7})],[base(5,'sword',{shield:true,armorTier:3})],5,7);
add('barrier-screen','barrier',[base(5,'energy',{weaponLevel:8})],[base(5,'magic',{armorTier:0,armorLevel:1,barrier:8})],5,8);
add('ward-floor','ward',[base(5,'magic',{weaponLevel:8})],[base(5,'magic',{armorTier:0,armorLevel:1,ward:8})],5,8);
add('unarmored-master','training-floor',[base(2,'energy',{weaponLevel:9})],[base(9,'sword',{weaponLevel:2,armorTier:0,armorLevel:1})],2,9);
add('vehicle-guns','vehicle',[base(6,'cannon',{body:'vehicle',armorTier:3,weaponLevel:7,weaponStabilized:true}),base(6,'autocannon',{body:'vehicle',armorTier:3})],[base(6,'indirect-cannon',{body:'vehicle',armorTier:3}),base(6,'autocannon',{body:'vehicle',armorTier:3})],6,7);
add('flying-large','flying',[base(5,'throwing',{body:'large',weaponLevel:6,traits:['flying']})],[base(5,'heavy-rifle',{body:'large'})],5,6);
add('signed-10','enhancements',[base(5,'blunt',{weaponLevel:6,weaponBonuses:{damage:-10,penetration:10}})],[base(5,'sword',{weaponBonuses:{damage:10},armorBonuses:{protection:-10}})],5,6);
add('outnumbered','numbers',[base(6,'demolition',{weaponLevel:7}),base(6,'spear')],[base(5,'spear'),base(5,'rifle'),base(5,'magic'),base(5,'natural')],5,7);
if(cases.length!==50)throw Error('Expected 50 templates: '+cases.length);
if(cases.some(c=>[...c.a,...c.b].some(s=>s.abilityBlueprints?.some(a=>typeof a!=='string'&&!a.id))))throw Error('Unknown skill');
const envs=[['plains'],['plains','night'],['forest'],['mountain','night'],['urban'],['siege','night']];
const modes=['small','mass'] as const;
const harnessHash=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const engineHash=createHash('sha256').update(readFileSync('engine/src/power-anchors.ts')).digest('hex');
const path=`${out}/${label}-${phase}-${shard}.jsonl`,logs=`${out}/${label}-${phase}-${shard}-logs.jsonl.gz`;
writeFileSync(path,'');writeFileSync(logs,'');
writeFileSync(`${out}/manifest-${label}-${phase}-${shard}.json`,JSON.stringify({label,phase,offset,production,harnessHash,engineHash,baselineCommit:'069c4c0f0973a3c99ebda56cf94d5d31e7ab835f',cases,envs,modes,shard,shards,seeds:2,mirrors:2},null,2));
let scheduled=0,completed=0,errors=0;const start=Date.now();
for(const scenario of cases)for(const tags of envs)for(const mode of modes)for(let seed=0;seed<2;seed++)for(const swap of [false,true]){
 const index=scheduled++;if(only&&only!==scenario.id+':'+mode)continue;if(index%shards!==shard||completed>=limit)continue;
 const id=`${scenario.id}:${tags.join('+')}:${mode}:${seed+offset}:${swap?'reverse':'forward'}`;
 const aSide=swap?'enemy':'ally';
 try{
  const make=(team:'A'|'B',s:Spec,i:number):Combatant=>{
   const {barrier,ward,...extra}=s;
   const unit=generateUnit({name:team+i,side:team==='A'?aSide:aSide==='ally'?'enemy':'ally',scale:mode==='small'?'hero':'company',...(mode==='mass'&&s.scale!=='hero'?{hpMax:20}:{}),rulesVersion:'v2',damageModel:'wounds-v2',level:5,archetype:['sword','axe','blunt','spear','natural'].includes(s.weaponClass??'')?'infantry':'ranged',speedTier:3,traits:[],...extra},{registry,seed:`roster:${scenario.id}:${seed+offset}:${team}${i}`,noVariance:true}).unit;
   unit.id=team+i;
   if(mode==='mass'&&i>=3)unit.formationPosition=unit.side+':左翼:front';
   if(barrier)grantBarrier(unit,100,10,'precast',barrier);
   if(ward)unit.conditions.push({id:'blessed',dur:10,defensePower:ward});
   return unit;
  };
  const aa=scenario.a.map((s,i)=>make('A',s,i)),bb=scenario.b.map((s,i)=>make('B',s,i));
  const roster=swap?[...bb,...aa]:[...aa,...bb];
  const battleSeed=`battle:${scenario.id}:${tags.join('+')}:${seed+offset}`;
  let field=mode==='small'?generatedField(`map:${scenario.id}:${tags[0]}:${seed+offset}`,7,13,tags,{roster,attackingSide:'ally'}):undefined;
  // Mirror the ACTUAL non-symmetric map so terrain advantage follows the team, not the seat.
  if(field&&swap){field.tiles.reverse();field.objective.cell=field.tiles.length-1-field.objective.cell;if(field.objective.kind==='control')field.objective.attackingSide=aSide;}
  const b=mode==='small'?new SmallBattle({combatants:roster,rules:smallRules,battlefield:field,field:{tags},seed:battleSeed,traitRegistry:registry})
   :new MassBattle({combatants:roster,rules:massRules,field:{tags},seed:battleSeed,traitRegistry:registry,roundLimit:40});
  b.start();
  const initial=structuredClone(b.toSnapshot());
  const maxHealth=Object.fromEntries(roster.map(u=>[u.id,memberHealthMax(u)]));
  let steps=0,lastRound=0;
  while(!b.isOver()&&steps<5000){steps++;lastRound=b.round;
   if(b instanceof SmallBattle){if(b.active?.status==='ready')b.autoAction(b.active.id);else b.endTurn();}
   else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
  }
  for(const u of b.combatants){validateMemberHealth(u);if(!Number.isFinite(memberHealth(u))||u.hp<0||u.hp>u.base.hpMax)throw Error('Invalid health '+u.id);}
  const attacks=b.log.flatMap(e=>e.resolution?[{round:e.round,...e.resolution}]:[]);
  const damaged=(team:'A'|'B')=>attacks.filter(r=>r.defenderId.startsWith(team)&&r.finalDamage>0);
  const oneShots=attacks.filter(r=>r.hit&&r.finalDamage>=maxHealth[r.defenderId]!&&r.hpBefore>0&&b.combatants.find(u=>u.id===r.defenderId)?.scale==='hero');
  const firstContact=attacks.find(r=>r.finalDamage>0)?.round;
  const final=b.combatants.map(u=>({id:u.id,side:u.side,health:memberHealth(u),hp:u.hp,status:u.status,SP:u.resources.SP,fatigue:u.fatigue}));
  const result=b.isOver()?(b.winner()==='draw'?'draw':b.winner()===aSide?'A':'B'):'unfinished';
  const fingerprint=createHash('sha256').update(JSON.stringify({result,lastRound,steps,final,log:b.log})).digest('hex');
  const row={id,index,label,phase,scenario:scenario.id,group:scenario.group,mode,tags,seed:seed+offset,swap,low:scenario.low,highLevel:scenario.highLevel,gap:scenario.highLevel-scenario.low,
   result,rounds:lastRound,steps,firstContact,contactRounds:firstContact===undefined?0:lastRound-firstContact+1,attacks:attacks.length,hits:attacks.filter(r=>r.hit).length,
   overmatchHits:attacks.filter(r=>r.hit&&(r.overmatchMultiplier??1)>1).length,oneShots:oneShots.length,oneShotBattle:oneShots.length>0,
   AHealth:final.filter(u=>u.id.startsWith('A')).reduce((a,u)=>a+u.health,0),BHealth:final.filter(u=>u.id.startsWith('B')).reduce((a,u)=>a+u.health,0),
   ADamage:damaged('B').reduce((a,r)=>a+r.finalDamage,0),BDamage:damaged('A').reduce((a,r)=>a+r.finalDamage,0),
   abilityEvents:b.log.filter(e=>e.kind==='ability').length,logHash:fingerprint,finished:b.isOver()};
  appendFileSync(path,JSON.stringify(row)+'\n');
  // All initial snapshots + battle logs, gzip members are independently appendable/recoverable.
  appendFileSync(logs,gzipSync(JSON.stringify({id,initial,log:b.log,final})+'\n'));
 }catch(e){errors++;appendFileSync(path,JSON.stringify({id,index,label,phase,scenario:scenario.id,mode,tags,seed:seed+offset,swap,error:String(e),stack:e instanceof Error?e.stack:undefined})+'\n');}
 completed++;if(completed%50===0)console.log(JSON.stringify({label,phase,shard,completed,errors,seconds:(Date.now()-start)/1000}));
}
console.log(JSON.stringify({label,phase,shard,completed,errors,seconds:(Date.now()-start)/1000,status:errors?'errors':'complete'}));
if(errors)process.exitCode=1;
