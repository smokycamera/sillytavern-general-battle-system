/** Dependency-free assertions against compiled production code. Not a substitute for the Vitest suite. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const build = resolve(process.argv[2] ?? '.review-build');
const moduleAt = p => import(pathToFileURL(resolve(build,p)).href);
const e = await moduleAt('engine/src/index.js');
const setup = await moduleAt('panel/src/battle-setup.js');
const api = await moduleAt('panel/src/llm-map-design.js');
const { LlmContextController } = await moduleAt('panel/src/llm-context.js');
const { renderTacticalBattle } = await moduleAt('panel/src/tactical-view.js');
const { encounterRequest, normalizeContextSettings } = await moduleAt('panel/src/jev-context.js');
const results=[], started=performance.now();
let mapCount=0, modeCount=0, movementCount=0;
async function check(name,run) { try { await run(); results.push({name,pass:true}); console.log("PASS "+name); } catch(error) { results.push({name,pass:false,error:error.stack}); console.log("FAIL "+name+" :: "+error.message); } }
function army(a,b,version='v2',scale='hero',body='human') {
  return ['ally','enemy'].flatMap(side=>Array.from({length:side==='ally'?a:b},(_,i)=>{
    const v2=version==='v2'||version==='mixed'&&i%2===0;
    const unit=e.generateUnit({name:side+i,side,scale,body,hpMax:20,level:3,weaponClass:i%2?'rifle':'blunt',weaponLevel:3,traits:[],...(v2?{rulesVersion:'v2'}:{})},{seed:side+i,noVariance:true}).unit;
    unit.id=side+String(i).padStart(3,'0'); return unit;
  }));
}
const encounter={mode:'small',field:'urban',lighting:'day',mapLayout:'standard',objectiveMode:'auto',siegeAttacker:'ally'};
const mark=scene=>({kind:scene==='interior'?'room':scene==='building_siege'?'building':'position',anchor:'center',label:scene==='interior'?'会客厅':'交战要点'});
await check('all rule versions use card counts 2..65 without changing roster data',()=>{
  for (const version of ['legacy','mixed','v2']) for (let n=2;n<=65;n++) {
    const units=army(Math.floor(n/2),Math.ceil(n/2),version),before=structuredClone(units);
    assert.equal(setup.recommendBattleMode(units).mode,n<=32?'small':'mass');
    if(n>64) assert.match(setup.battleCapacityIssue(units),/65.*64/); else assert.equal(setup.battleCapacityIssue(units),undefined);
    assert.deepEqual(units,before); modeCount++;
  }
});
await check('small and mass engine starts guard all versions; inactive records do not consume slots',()=>{
  for(const version of ['legacy','mixed','v2']) {
    const units=army(16,17,version);
    assert.throws(()=>new e.SmallBattle({combatants:structuredClone(units),seed:'cap'}).start(),/32/);
    assert.throws(()=>new e.MassBattle({combatants:army(32,33,version),seed:'cap'}).start(),/64/);
    units.at(-1).hp=0;units.at(-1).status='dead';
    e.assertBattleCapacity(units,'small');assert.equal(e.activeBattleUnits(units).length,32);
  }
});
await check('legacy and mixed contextual starts cannot route 33 cards back to a small battle',()=>{
  for(const version of ['legacy','mixed','v2']) for(const n of [32,33,64]) {
    const input={roster:army(1,n-1,version),setup:encounter,settings:{...normalizeContextSettings(),enemy:'manual',scene:'manual'},messages:[],windowSize:0,roles:[],phase:'preparation'};
    assert.equal(encounterRequest(input).base.mode,n<=32?'small':'mass');
  }
});
await check('new 33/64-card formations preserve versions, identity, capacity and deterministic save/replay',()=>{
  for(const version of ['legacy','mixed','v2']) for(const scale of ['hero','company']) for(const [a,b] of [[16,17],[32,32],[1,63],[63,1]]) {
    const units=army(a,b,version,scale),before=structuredClone(units),slots=e.recommendedFormationSlots(units);
    const battle=new e.MassBattle({combatants:setup.prepareMassRoster(units),formationSlots:slots,seed:'mass:'+version+scale+a,zones:['左翼','中军','右翼'],...(version==='v2'?{rules:e.V11_OVERFLOW_TW}:{})});
    battle.start();assert.equal(battle.combatants.length,a+b);assert.deepEqual(units,before);
    for(const unit of battle.combatants) {
      assert.equal(unit.scale,scale);assert.equal(unit.rulesVersion,before.find(u=>u.id===unit.id).rulesVersion);
      const occupants=battle.combatants.filter(u=>u.status==='ready'&&!battle.isAttached(u.id)&&e.formationNode(u).id===e.formationNode(unit).id&&e.isAirborne(u)===e.isAirborne(unit));
      assert.ok(occupants.length<=slots);
    }
    const copy=e.MassBattle.fromSnapshot(structuredClone(battle.toSnapshot()));assert.deepEqual(copy.toSnapshot(),battle.toSnapshot());
    // Advance a round for representative pairs, exercising legacy capacity guards as well as V2.
    if(a===16) {
      for(const current of [battle,copy]) {current.autoOrders('ally');current.autoOrders('enemy');current.resolveRound();movementCount++;}
      assert.deepEqual(copy.toSnapshot(),battle.toSnapshot());
    }
  }
});
await check('mixed explicit formation positions move consistently with legacy zone/rank tags',()=>{
  const units=army(2,2,'mixed','company');
  units[0].formationPosition='ally:左翼:rear';units[0].tags=['zone:左翼','rank:rear'];
  units[1].tags=['zone:右翼','rank:reserve'];
  const battle=new e.MassBattle({combatants:setup.prepareMassRoster(units),formationSlots:3,zones:['左翼','中军','右翼'],seed:'mixed-move'});battle.start();
  battle.issue({unitId:units[0].id,type:'rank-back'});battle.resolveRound();
  assert.equal(e.formationNode(battle.byId(units[0].id)).rank,'reserve');
  assert.ok(battle.byId(units[0].id).tags.includes('rank:reserve'));
});
await check('legacy formations reject full destinations and simultaneous arrivals cannot overfill',()=>{
  for(const version of ['legacy','mixed']) for(const starting of [2,3]) {
    const units=army(starting+2,1,version,'company');
    units.filter(u=>u.side==='ally').forEach((u,i)=>u.tags=[`zone:${i<starting?'中军':i===starting?'左翼':'右翼'}`,'rank:rear']);
    const battle=new e.MassBattle({combatants:setup.prepareMassRoster(units),formationSlots:3,zones:['左翼','中军','右翼'],seed:'converge'});battle.start();
    const arrivals=units.filter(u=>u.side==='ally').slice(starting), before=battle.cp.ally;
    for(const [i,u] of arrivals.entries()) {
      const result=battle.issue({unitId:u.id,type:i===0?'shift-right':'shift-left'});
      assert.equal(result.ok,starting===2);
      if(starting===3) assert.match(result.reason,/容量/);
    }
    if(starting===3) assert.equal(battle.cp.ally,before);
    battle.resolveRound();movementCount++;
    assert.equal(battle.combatants.filter(u=>u.side==='ally' && e.formationNode(u).wing==='中军' && e.formationNode(u).rank==='rear').length,3);
  }
});
await check('existing started snapshots are neither resized nor capped nor given new formationSlots',()=>{
  const battle=new e.SmallBattle({combatants:army(16,16,'legacy'),seed:'old-small'});battle.start();
  const snapshot=structuredClone(battle.toSnapshot());const extra=structuredClone(snapshot.combatants[0]);extra.id='old-extra';snapshot.combatants.push(extra);
  const copy=e.SmallBattle.fromSnapshot(snapshot);assert.equal(copy.combatants.length,33);copy.start();assert.equal(copy.combatants.length,33);
  const old=new e.MassBattle({combatants:army(2,2,'legacy','company'),seed:'old-mass'});old.start();
  assert.equal(e.MassBattle.fromSnapshot(structuredClone(old.toSnapshot())).formationSlots,undefined);
});
await check('intact/damaged/destroyed fortifications protect all sides, including old facing metadata',()=>{
  const field=e.standardField();field.tiles.fill('open');field.layerVersion=1;field.structures=field.tiles.map(()=>null);field.overlays={};field.landmarks=[];
  const [defender,attacker]=army(1,1);defender.pos=24;
  const fort=e.createStructure('fortification',3,{facing:'south'});assert.equal(fort.facing,undefined);field.structures[24]={...fort,facing:'south'};
  for(const [hp,bonus] of [[fort.hpMax,3],[1,1],[0,0]]) {
    field.structures[24].hp=hp;
    for(const p of [17,23,25,31]) for(const ranged of [false,true]) {attacker.pos=p;assert.equal(e.structureDefense(field,defender,attacker,ranged),bonus);}
  }
});
await check('scene and gate schemas preserve exact independent states and reject malformed gate counts',()=>{
  for(const scene of e.BATTLEFIELD_SCENES) assert.equal(e.normalizeBattlefieldPlan({scene}).plan.scene,scene);
  const gatePlan=[{sector:'left',state:'closed'},{sector:'right',state:'open'},{sector:'rear',state:'destroyed'}];
  assert.deepEqual(e.normalizeBattlefieldPlan({gatePlan,command:'erase',hp:900}).plan,{gatePlan});
  for(const value of ['single',[{}],Array(5).fill(gatePlan[0]),[{sector:'outside',state:'open'}]]) assert.throws(()=>e.normalizeBattlefieldPlan({gatePlan:value}),/gatePlan/);
});
await check('all six scene layouts: multiple seeds, both attack sides, deterministic geometry, usable deployments',()=>{
  for(const scene of e.BATTLEFIELD_SCENES) for(let seed=0;seed<30;seed++) for(const attackingSide of ['ally','enemy']) {
    const roster=army(seed%3===0?16:seed%3===1?31:2,seed%3===0?16:seed%3===1?1:2,'v2','hero',seed%5===0?'giant':'human');
    const count=seed%5,gatePlan=Array.from({length:count},(_,i)=>({sector:['front_center','left','right','rear'][i],state:['closed','open','destroyed'][i%3]}));
    const plan={scene,layout:['lanes','ring','scattered','strongpoint'][seed%4],topology:Object.keys(e.ROUTE_TOPOLOGIES)[seed%9],shape:['front','enclosure','riverside','hillside'][seed%4],landmarks:[mark(scene)],...( ['city_siege','building_siege','interior'].includes(scene)?{gatePlan}:{} )};
    const options={roster,plan,attackingSide},tags=scene==='field'?['forest']:['siege'];
    const field=e.generatedLayeredField('audit:'+scene+seed,7,13,tags,options);
    assert.equal(field.generation.scene,scene);assert.deepEqual(e.generatedLayeredField('audit:'+scene+seed,7,13,tags,options),field);e.validateField(field);
    assert.ok(field.landmarks.length>=1&&field.landmarks.length<=5);assert.equal(new Set(field.landmarks.flatMap(m=>m.cells)).size,field.landmarks.flatMap(m=>m.cells).length);
    if(['city_siege','building_siege','interior'].includes(scene)) {
      const gates=field.structures.filter(s=>s?.kind==='gate');assert.equal(gates.length,count);assert.deepEqual(gates.map(g=>g.gateState).sort(),gatePlan.map(g=>g.state).sort());
    }
    if(scene==='interior') {assert.equal(field.generation.family,'indoor');assert.ok(field.tiles.every(t=>t==='street'));assert.equal(field.city,undefined);}
    if(scene==='city_streets') {assert.equal(field.objective.kind,'annihilation');assert.equal(field.city.defender,undefined);assert.equal(field.structures.filter(s=>s?.kind==='wall').length,0);}
    if(scene==='trenches') {assert.ok(field.structures.filter(s=>s?.kind==='fortification').length>10);assert.equal(field.objective.kind,'annihilation');}
    const prepared=e.prepareGridDeployment(field,roster,'audit');assert.equal(prepared.length,roster.length);
    for(const unit of prepared) assert.ok(e.canOccupy(field,prepared.filter(u=>u.id!==unit.id),unit,unit.pos));
    if(seed===0) {
      const battle=new e.SmallBattle({combatants:structuredClone(roster),battlefield:field,rules:e.V11_OVERFLOW_D20,seed:'audit'});battle.start();
      const copy=e.SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));assert.deepEqual(copy.toSnapshot(),battle.toSnapshot());
    }
    mapCount++;
  }
});
await check('city gate plans 0..4 coexist with independent initial breaches',()=>{
  for(const attackingSide of ['ally','enemy']) for(const scene of ['city_siege','building_siege']) for(let n=0;n<=4;n++) {
    const gatePlan=Array.from({length:n},(_,i)=>({sector:['front_center','left','right','rear'][i],state:['closed','open','destroyed'][i%3]}));
    const field=e.generatedLayeredField('gate-'+scene+n,7,13,['siege'],{plan:{scene,size:'large',shape:'enclosure',gatePlan,breaches:{count:2,width:1},landmarks:[mark(scene)]},attackingSide});
    assert.equal(field.structures.filter(s=>s?.kind==='gate').length,n);assert.equal(field.city.breaches.length,2);mapCount++;
  }
});
await check('existing shape/breach matrix retains count, width, separation and reachable interiors',()=>{
  for(const shape of ['front','enclosure','riverside','hillside']) for(const count of [0,1,2,3]) for(const width of [1,2]) for(const attackingSide of ['ally','enemy']) {
    const field=e.generatedLayeredField(`breach-${shape}-${count}-${width}`,7,13,['siege'],{plan:{shape,breaches:{count,width},gates:'single',size:'large',landmarks:[]},attackingSide});
    const c=field.city;assert.equal(c.shape,shape);assert.equal(c.breaches.length,count);
    for(const group of c.breaches) {assert.equal(group.length,width);for(const p of group) {
      assert.equal(e.groundBlocked(field,p),false);
      assert.ok(e.neighbors(field,p).some(n=>c.inside.includes(n)&&e.findGridPath(field,n,c.core[0],k=>c.inside.includes(k)&&!e.groundBlocked(field,k))));
    }}
    for(let i=0;i<count;i++) for(let j=i+1;j<count;j++) assert.ok(c.breaches[i].every(a=>c.breaches[j].every(b=>e.gridDistance(field,a,b)>1)));
    mapCount++;
  }
});
await check('API plans missing landmarks do not inherit random landmarks; indoor never inherits outdoor features',()=>{
  for(const plan of [{}, {scene:'city_streets'}, {landmarks:[]}]) assert.equal(e.generatedLayeredField('no-fallback',7,13,['urban'],{plan}).landmarks.length,0);
  for(let seed=0;seed<20;seed++) {
    const field=e.generatedLayeredField('indoor-'+seed,5,7,['siege'],{roster:army(16,16)});
    assert.equal(field.generation.scene,'interior');assert.ok(field.tiles.every(t=>t==='street'));assert.ok(field.landmarks.every(m=>!['forest','hill','tower','bridge'].includes(m.kind)));mapCount++;
  }
  assert.throws(()=>e.generatedLayeredField('no-forest',7,13,[],{plan:{scene:'interior',landmarks:[{kind:'forest',anchor:'center'}]}}),/室内/);
});
await check('streets use complete building parcels and preserve inner connectivity without opening perimeter walls',()=>{
  for(let seed=0;seed<40;seed++) {
    const field=e.generatedLayeredField('parcel-'+seed,7,13,['urban'],{plan:{scene:'city_streets',density:'dense',landmarks:[{kind:'building',anchor:'inside_left'}]}});
    assert.ok(field.structures.filter(s=>s?.kind==='building').length>=2);
    for(const p of field.city.inside.filter(p=>!e.groundBlocked(field,p))) assert.ok(e.findGridPath(field,p,field.city.core[0],n=>field.city.inside.includes(n)&&!e.groundBlocked(field,n)));
    mapCount++;
  }
});
const settings={enabled:true,selectBattleScale:false,designMap:true,selectVip:false,windowSize:6,url:'https://gateway.example/v1',token:'fake-test-token',model:'test-model',models:[]};
await check('secondary API requires landmarks, accepts safe inferred names, keeps one request and both commander choices',async()=>{
  for(const landmarks of [undefined,[],[{kind:'invalid',anchor:'center'}],[{kind:'room',anchor:'center',label:'概括的会客厅'}]]) {
    let calls=0,payload;
    const fake=async(_url,init)=>{calls++;payload=JSON.parse(init.body);const request=JSON.parse(payload.messages[1].content);
      const values={field:'urban',lighting:'night',map_layout:'indoor',objective:'annihilation',siege_attacker:'ally',ally_ability:'skilled',ally_style:'balanced',enemy_ability:'expert',enemy_style:'cautious'};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({model:'test-model',selections:Object.fromEntries(request.fields.map(f=>[f.id,{value:values[f.id],confidence:.2}])),battlefield:{scene:'interior',landmarks}})}}]}));};
    const controller=new LlmContextController(fake),source={roster:army(2,2),setup:encounter,messages:[{id:'scene',role:'assistant',completed:true,text:'在室内遭遇护卫。'}]};
    if(!landmarks?.length||landmarks[0].kind==='invalid') await assert.rejects(controller.select(source,settings,()=>true),/1—5个有效地标/);
    else {const result=await controller.select(source,settings,()=>true);assert.equal(result.battlefieldPlan.landmarks[0].label,'概括的会客厅');assert.equal(result.commanders.enemy.ability,'expert');}
    assert.equal(calls,1);assert.equal(payload.model,'test-model');assert.match(payload.messages[0].content,/1 to 5/);assert.doesNotMatch(JSON.stringify(payload),/exact short landmark|无明确地标选none|可省略无依据项/);
    assert.equal(controller.busy,false);
  }
  await assert.rejects(new LlmContextController(async()=>{throw Error('should not request');}).select({roster:army(1,1),setup:encounter,messages:[]},settings,()=>true),/没有可读取/);
  const request=api.preparationDesignRequest(army(1,1),settings,encounter,{},'',true);
  assert.throws(()=>api.applyPreparationDesign({selections:{}},request,encounter,army(1,1)),/1—5/);
});
await check('street labels disappear from idle tiles but accessibility, inspection, structures and landmarks remain',()=>{
  const field=e.generatedLayeredField('clean-ui',7,13,['urban'],{plan:{scene:'city_streets',landmarks:[{kind:'building',anchor:'inside_left',label:'目标建筑'}]}});
  const battle=new e.SmallBattle({combatants:army(1,1),battlefield:field,rules:e.V11_OVERFLOW_D20,seed:'ui'});battle.start();
  const before=structuredClone(battle.toSnapshot()),html=renderTacticalBattle(battle,{mode:'weapon'});
  assert.equal((html.match(/class="grid-terrain">街道<\/span>/g)??[]).length,0);assert.match(html,/aria-label="[^"]*街道/);assert.match(html,/目标建筑/);assert.match(html,/城区巷战/);assert.match(html,/structure-building/);
  const cell=field.tiles.findIndex((t,p)=>t==='street'&&!field.structures[p]&&!battle.combatants.some(u=>u.pos===p));
  assert.match(renderTacticalBattle(battle,{mode:'weapon',inspectedCell:cell}),/class="grid-terrain">街道<\/span>/);
  assert.deepEqual(battle.toSnapshot(),before);
});
const summary={runner:'Node assertions against tsc-compiled production sources; Vitest not run by this script',durationMs:Math.round(performance.now()-started),checks:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,mapCount,modeCount,movementCount,results};
mkdirSync('docs',{recursive:true});writeFileSync('docs/pr66-review-audit.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));process.exitCode=summary.failed?1:0;
