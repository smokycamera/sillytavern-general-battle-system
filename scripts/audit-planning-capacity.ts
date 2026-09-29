/** Deterministic orthogonal map choices and full-capacity deployment/runtime checks. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { generatedLayeredField, generateUnit, SmallBattle, MassBattle, V11_OVERFLOW_D20, V11_OVERFLOW_TW,
  canOccupy, groundBlocked, findGridPath, recommendedFormationSlots, formationNode, type Combatant, type BattlefieldPlan } from '../engine/src/index.js';
import { newBattleCommanderProfiles } from '../engine/src/commander-profile.js';
import { prepareMassRoster } from '../panel/src/battle-setup.js';
const began=performance.now(), failures:unknown[]=[], cases:unknown[]=[], timings:number[]=[];
let maps=0,gridDeployments=0,massDeployments=0,breachPathChecks=0,smallActions=0,massRounds=0,restores=0;
function roster(a:number,b:number,variant:number):Combatant[]{return (['ally','enemy'] as const).flatMap(side=>Array.from({length:side==='ally'?a:b},(_,i)=>{
  const traits=variant===2&&i%5===0?['flying']:variant===3&&i%4===0?['vanguard']:i%3===0?['siege-assault','water-crossing']:[];
  const u=generateUnit({name:side+i,side,scale:variant===1?'company':'hero',body:variant===0?'giant':'human',hpMax:20,level:3,rulesVersion:'v2',weaponClass:i%7===0?'cannon':i%2?'rifle':'blunt',weaponLevel:3,traits},{seed:side+i,noVariance:true}).unit;
  u.id=side+i;u.morale=u.base.moraleMax=100;return u;
}));}
const profiles=newBattleCommanderProfiles({ally:{ability:'expert',style:'siege'},enemy:{ability:'expert',style:'depth'}});
for(const env of ['plains','forest','mountain','urban','siege'])for(const variant of [0,1,2,3])for(const left of [1,16,31])for(let i=0;i<4;i++){
  const seed=`capacity:${env}:${variant}:${left}:${i}`;
  try{
    const units=roster(left,32-left,variant),original=structuredClone(units),plan:BattlefieldPlan={size:'compact',shape:(['front','enclosure','riverside','hillside'] as const)[i],breaches:{count:i as 0|1|2|3,width:i%2?2:1},water:i%2?'river':'none',gateState:i%3===0?'open':'closed',cover:i%2?'dense':'sparse',obstacles:'dense'};
    const f=generatedLayeredField(seed,7,13,[env],{roster:units,plan,attackingSide:i%2?'ally':'enemy'});maps++;
    const b=new SmallBattle({combatants:structuredClone(units),battlefield:f,rules:V11_OVERFLOW_D20,seed});b.commanderProfiles=profiles;b.start();assert.equal(b.combatants.length,32);assert.deepEqual(units,original);gridDeployments++;
    for(const u of b.combatants){assert.ok(canOccupy(b.battlefield!,b.combatants,u,u.pos!));if(f.city?.defender&&u.side!==f.city.defender)assert.ok(!f.city.inside.includes(u.pos!));}
    const saved=structuredClone(b.toSnapshot());assert.deepEqual(SmallBattle.fromSnapshot(saved).toSnapshot(),b.toSnapshot());restores++;
    if(f.city?.defender){assert.equal(f.city.breaches!.length,i);for(const group of f.city.breaches!){assert.equal(group.length,i%2?2:1);for(const p of group){assert.equal(f.structures![p]!.hp,0);assert.ok(findGridPath(f,p,f.city.core[0]!,n=>!groundBlocked(f,n)));breachPathChecks++;}}}
  }catch(error){failures.push({seed,error:String(error)});}
}
for(const shape of ['front','enclosure','riverside','hillside'] as const)for(const count of [0,1,2,3] as const)for(const width of [1,2] as const)for(const sector of ['auto','front_left','front_right','left','right','rear'] as const)for(const gates of ['none','single','side','double'] as const){
  const seed=`choice:${shape}:${count}:${width}:${sector}:${gates}`;
  try{
    const f=generatedLayeredField(seed,7,13,['siege'],{plan:{shape,breaches:{count,width,sector},gates,size:'compact',landmarks:[]}});maps++;
    assert.equal(f.city!.shape,shape);assert.equal(f.city!.breaches!.length,count);for(const g of f.city!.breaches!)assert.equal(g.length,width);
  }catch(error){failures.push({seed,error:String(error)});}
}
for(const variant of [0,1,2,3])for(const [a,b] of [[16,17],[32,32],[1,63],[63,1]])for(let i=0;i<4;i++){
  const seed=`mass:${variant}:${a}:${b}:${i}`;
  try{
    const units=roster(a!,b!,variant),original=structuredClone(units),slots=recommendedFormationSlots(units);
    const battle=new MassBattle({combatants:prepareMassRoster(units),formationSlots:slots,rules:V11_OVERFLOW_TW,seed});battle.start();massDeployments++;assert.equal(battle.combatants.length,a!+b!);assert.deepEqual(units,original);
    for(const u of battle.combatants){assert.equal(formationNode(u).side,u.side);assert.ok(battle.combatants.filter(v=>v.status==='ready'&&!battle.isAttached(v.id)&&!!v.airborne===!!u.airborne&&formationNode(v).id===formationNode(u).id).length<=slots);}
    assert.deepEqual(MassBattle.fromSnapshot(structuredClone(battle.toSnapshot())).toSnapshot(),battle.toSnapshot());restores++;
  }catch(error){failures.push({seed,error:String(error)});}
}
// Actual turn work, bounded to three small rounds / two macro rounds; not a full balance simulation.
for(const env of ['plains','urban','siege']){
  const seed='live32:'+env;
  try{
    const units=roster(16,16,2),f=generatedLayeredField(seed,7,13,[env],{roster:units,plan:{shape:'riverside',breaches:{count:2,width:2},water:'river'}});
    const b=new SmallBattle({combatants:units,battlefield:f,rules:V11_OVERFLOW_D20,seed});b.commanderProfiles=profiles;b.start();let actions=0;
    while(!b.isOver()&&b.round<=3&&actions<110){const start=performance.now();b.autoAction(b.active!.id);timings.push(performance.now()-start);actions++;assert.ok(b.combatants.every(u=>u.status!=='ready'||canOccupy(b.battlefield!,b.combatants,u,u.pos!)));}
    const snap=structuredClone(b.toSnapshot()),copy=SmallBattle.fromSnapshot(structuredClone(snap)),again=SmallBattle.fromSnapshot(structuredClone(snap));if(!copy.isOver()){copy.autoAction(copy.active!.id);again.autoAction(again.active!.id);assert.deepEqual(copy.toSnapshot(),again.toSnapshot());}restores++;
    smallActions+=actions;cases.push({seed,initialCards:32,actions,round:b.round,ended:b.isOver()});
  }catch(error){failures.push({seed,error:String(error)});}
}
for(const variant of [1,2]){
  const seed='live64:'+variant;
  try{
    const units=roster(32,32,variant),b=new MassBattle({combatants:prepareMassRoster(units),formationSlots:recommendedFormationSlots(units),rules:V11_OVERFLOW_TW,seed});b.commanderProfiles=profiles;b.start();
    for(let i=0;i<2&&!b.isOver();i++){b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();massRounds++;}
    const copy=MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));assert.deepEqual(copy.toSnapshot(),b.toSnapshot());restores++;
    if(!copy.isOver()){const again=MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));for(const c of [copy,again]){c.autoOrders('ally');c.autoOrders('enemy');c.resolveRound();}assert.deepEqual(copy.toSnapshot(),again.toSnapshot());}
    cases.push({seed,initialCards:64,round:b.round,ended:b.isOver()});
  }catch(error){failures.push({seed,error:String(error)});}
}
timings.sort((a,b)=>a-b);
const result={maps,gridDeployments,massDeployments,breachPathChecks,restores,smallActions,massRounds,smallActionP50Ms:timings[Math.floor(timings.length*.5)],smallActionP95Ms:timings[Math.floor(timings.length*.95)],elapsedMs:performance.now()-began,cases,failures};
writeFileSync(process.env.TB_AUDIT_REPORT??'docs/planning-capacity-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
