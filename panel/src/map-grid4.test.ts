import {describe,it,expect} from 'vitest';
import {compileLayout,layoutTask,type LayoutContext} from './llm-layout.js';
import {generatedLayeredField,generateUnit,SmallBattle,V32_OVERFLOW_D20,type Combatant} from '../../engine/src/index.js';
import {GRID_ANCHORS,inGridSector} from '../../engine/src/small/grid-anchor.js';
import {worldAnchorCell} from '../../engine/src/small/landmark-placement.js';
import {sectorCells} from '../../engine/src/small/force-deployment.js';
import {groundBlocked} from '../../engine/src/small/layers.js';
import {neighbors} from '../../engine/src/small/spatial.js';
import {prepareBattleObjective} from './battle-setup.js';

const actors=(n=8)=>Array.from({length:n},(_,i)=>{
  const unit=generateUnit({name:'单位'+i,side:i<n/2?'ally':'enemy',scale:'hero',rulesVersion:'v2',level:3,weaponClass:'sword',weaponLevel:3,traits:[]},{seed:'grid4-'+i,noVariance:true}).unit;
  unit.id='u'+(i+1);return unit;
});
function context(roster:Combatant[],extra:Partial<LayoutContext>={}):LayoutContext{return {scene:'field',size:'large',objectiveMode:'annihilation',attacker:'ally',map:[13,19],units:roster.map(u=>({id:u.id,name:u.name,side:u.side,kind:'人物'})),...extra};}
function build(answer:unknown,roster:Combatant[],extra:Partial<LayoutContext>={},seed='numbered-grid'){
  const ctx=context(roster,extra),compiled=compileLayout(answer,ctx);
  const field=generatedLayeredField(seed,13,19,['plains'],{plan:compiled.plan,roster,attackingSide:ctx.attacker,unitBindings:Object.fromEntries(roster.map(u=>[u.id,u.id]))});
  return {field,compiled,ctx};
}
function checkRegion(field:ReturnType<typeof generatedLayeredField>,label:string,at:string){
  const region=field.scene!.regions.find(r=>r.label===label)!;
  expect(region?.cells.length).toBeGreaterThan(0);
  const x=region.cells.reduce((n,p)=>n+p%field.width,0)/region.cells.length;
  const y=region.cells.reduce((n,p)=>n+Math.floor(p/field.width),0)/region.cells.length;
  expect(inGridSector(at,field.width,field.height,x,y),`${label} at ${at}: ${x},${y}`).toBe(true);
  return region;
}

describe('numbered 4×4 map preparation',()=>{
  it('partitions every real cell once and keeps all sixteen anchors distinct while preserving old compass coordinates',()=>{
    const {field}=build({},[]);
    const all=GRID_ANCHORS.flatMap(at=>sectorCells(field,at));
    expect(all.length).toBe(field.tiles.length);expect(new Set(all).size).toBe(all.length);
    expect(new Set(GRID_ANCHORS.map(at=>worldAnchorCell(field,at))).size).toBe(16);
    expect(worldAnchorCell(field,'north')).toBe(Math.floor(field.height*.2)*field.width+Math.floor(field.width/2));
    for(const at of GRID_ANCHORS)expect(sectorCells(field,at)).toContain(worldAnchorCell(field,at));
  });
  it('preserves inner/outer landmarks in all quadrants and their actual heights',()=>{
    const places=[{type:'hill',name:'峰',at:'A1',height:3},{type:'hill',name:'低台',at:'B2',height:1},{type:'forest',name:'外林',at:'D1'},{type:'cover',name:'石堆',at:'C2'},
      {type:'ruins',name:'断垣',at:'A4',state:'destroyed'},{type:'forest',name:'内林',at:'B3'},{type:'position',name:'营地',at:'D4'},{type:'hill',name:'草坡',at:'C3',height:2}];
    const {field,compiled}=build({archetype:'farmland',places,ally:{at:['A4']},enemy:{at:['D1']}},actors());
    expect(compiled.notes).toEqual([]);expect(field.generation!.version).toBe(9);
    for(const p of places){const r=checkRegion(field,p.name,p.at);if(p.height!==undefined)expect(r.cells.every(n=>field.groundHeight![n]===p.height)).toBe(true);}
  });
  it('deploys and restores all 32 units in their actual numbered sectors, including a third party',()=>{
    const roster=actors(32);roster.forEach((u,i)=>u.side=i<12?'ally':i<24?'enemy':'neutral');
    const at={ally:'A4',enemy:'D1',neutral:'D3'};
    const {field}=build({ally:{at:['A4']},enemy:{at:['D1']},neutral:{at:['D3']},units:roster.map(u=>({unit:u.id,at:at[u.side]}))},roster);
    const battle=new SmallBattle({battlefield:field,combatants:roster,rules:V32_OVERFLOW_D20,seed:'grid4-32'});battle.start();
    const snapshot=battle.toSnapshot(),restored=SmallBattle.fromSnapshot(structuredClone(snapshot));
    expect(restored.toSnapshot()).toEqual(snapshot);
    for(const u of restored.combatants)expect(sectorCells(field,at[u.side] as typeof GRID_ANCHORS[number])).toContain(u.pos);
  });
  it('builds separate real rooms at numbered locations and keeps grouped units inside after restore',()=>{
    const roster=actors(16),points=['A1','D1','A2','D2','A4','D4','C1','C4'];
    const places=points.map((at,i)=>({type:'room',name:'房'+i,at}));
    const {field}=build({interior:{use:'office',pattern:'wings'},places,units:places.map((p,i)=>({unit:['u'+(i*2+1),'u'+(i*2+2)],place:p.name,relation:'inside'}))},roster,{scene:'interior'},'grid-audit-interior');
    const battle=new SmallBattle({battlefield:field,combatants:roster,rules:V32_OVERFLOW_D20,seed:'rooms4'});battle.start();
    const restored=SmallBattle.fromSnapshot(battle.toSnapshot());
    for(const [i,p]of places.entries()){
      const r=checkRegion(restored.battlefield!,p.name,p.at);
      for(const id of ['u'+(i*2+1),'u'+(i*2+2)])expect(r.cells).toContain(restored.combatants.find(u=>u.id===id)!.pos);
    }
  });
  it('connects reversed trench networks to named sectors without restoring destroyed fortifications',()=>{
    const places=[{type:'fortification',name:'北后壕',at:'A1'},{type:'fortification',name:'北支撑点',at:'D2'},{type:'fortification',name:'南前壕',at:'A3'},{type:'fortification',name:'南后壕',at:'D4'},{type:'fortification',name:'旧机枪阵地',at:'C3',state:'destroyed'}];
    const {field}=build({trenches:{pattern:'depth'},places,ally:{at:['A1']},enemy:{at:['D4']}},actors(),{scene:'trenches'},'grid-audit-trenches');
    for(const p of places){const r=checkRegion(field,p.name,p.at);if(p.state)expect(r.cells.every(n=>field.structures![n]?.hp===0)).toBe(true);}
    for(const network of field.generation!.trenches!.networks){const allowed=new Set(network.cells),seen=new Set([network.cells[0]!]),queue=[network.cells[0]!];for(let i=0;i<queue.length;i++)for(const p of neighbors(field,queue[i]!))if(allowed.has(p)&&!seen.has(p)){seen.add(p);queue.push(p);}expect(seen.size).toBe(allowed.size);}
  });
  it('keeps compound gates on their explicit wall sides while binding numbered interior areas',()=>{
    const {field}=build({compound:{pattern:'forecourt'},city:{level:3,gates:[{name:'南院门',at:'S',state:'open'},{name:'北院门',at:'N',state:'closed'}]},
      places:[{type:'room',name:'厢房',at:'B2'},{type:'square',name:'前院',at:'C3'}],ally:{at:['B4']},enemy:{post:'inside'}},actors(),{scene:'building_siege'},'compound-numbered');
    checkRegion(field,'厢房','B2');checkRegion(field,'前院','C3');
    expect(field.city!.gates.map(p=>field.structures![p]!.gateState)).toEqual(['open','closed']);
  });
  it('keeps two separate rooms in the same numbered region',()=>{
    const {field}=build({interior:{use:'office',pattern:'wings'},places:[{type:'room',name:'甲室',at:'B2'},{type:'room',name:'乙室',at:'B2'}]},[],{scene:'interior'},'shared-numbered-room');
    const first=checkRegion(field,'甲室','B2'),second=checkRegion(field,'乙室','B2');
    expect(first.cells.some(p=>second.cells.includes(p))).toBe(false);
  });
  it('keeps a south-side defending city and a reachable named capture target with reversed attackers',()=>{
    const roster=actors(),{field,ctx}=build({city:{at:'B4',walls:'front',level:4,gates:[{name:'北正门',state:'open'}]},places:[{type:'building',name:'军议厅',at:'C4'}],objective:'军议厅',ally:{post:'inside'},enemy:{at:['A1','B1']}},roster,{scene:'city_siege',attacker:'enemy',objectiveMode:'siege'},'grid-audit-city-siege');
    checkRegion(field,'军议厅','C4');expect(field.city!.defender).toBe('ally');
    const prepared=prepareBattleObjective(field,roster,'siege',undefined,ctx.attacker);expect(prepared.objective.kind).toBe('control');expect(groundBlocked(prepared,prepared.objective.cell)).toBe(false);
  });
  it('accepts a whole river column and numbered bridges without collapsing their row positions',()=>{
    const {field,compiled}=build({water:{type:'river',at:'D',bridges:[{name:'上桥',at:'D1',state:'intact'},{name:'下桥',at:'D4',state:'destroyed'}]}},[]);
    expect(compiled.notes).toContain('河流按D列布置');expect(compiled.plan.intent!.entities.find(e=>e.kind==='river')!.anchor).toBe('D2');
    for(const [name,at] of [['上桥','D1'],['下桥','D4']])checkRegion(field,name!,at!);
    expect(field.structures!.filter(s=>s?.entityId===compiled.plan.intent!.entities.find(e=>e.label==='下桥')!.id).every(s=>s!.hp===0)).toBe(true);
    const center=compileLayout({water:{type:'river',at:'B2',bridges:[{at:'B1'},{at:'B4'}]}},context([]));
    const inner=generatedLayeredField('inner-river',13,19,[],{plan:center.plan});
    expect(new Set(inner.tiles.flatMap((t,p)=>t==='deep_water'?[p%inner.width]:[])).size).toBe(1);
  });
  it('keeps the approved coordinate explanation and legacy answer compatibility',()=>{
    const task=layoutTask(context(actors()));expect(task).toContain('x为列，从左到右为A、B、C、D；y为行，从上到下为1、2、3、4。');
    expect(task).toContain('单位有具体地点时优先使用place。');expect(task).not.toContain('上北下南');
    const old=compileLayout({places:[{type:'hill',name:'旧峰',at:'NW'}],ally:{at:['S']}},context([]));
    expect(old.plan.intent!.entities[0]!.anchor).toBe('north_west');expect(old.plan.deployments).toContainEqual({subject:'ally',at:['south']});
    const next=compileLayout({places:[{type:'position',name:'营地',at:'b2'}],ally:{at:['A1']}},context([]));
    expect(next.plan.intent!.entities[0]!.anchor).toBe('B2');expect(next.plan.deployments).toContainEqual({subject:'enemy',at:['D4']});
  });
  it('constructs each explicitly requested indoor terrain kind while leaving the default indoors dry',()=>{
    const kinds=['hill','forest','square','tower','ruins','fortification','building','room','cover','position'];
    for(const [i,type] of kinds.entries()){
      const {field,compiled}=build({interior:{use:'office',pattern:'wings'},places:[{type,name:'指定地点',at:'B2'}]},[],{scene:'interior'},'indoor-type-'+i);
      expect(compiled.plan.intent!.entities[0]!.kind).toBe(type);
      const region=checkRegion(field,'指定地点','B2');
      if(type==='hill'||type==='forest')expect(region.cells.every(p=>field.tiles[p]===type)).toBe(true);
      if(['tower','fortification','building','cover'].includes(type))expect(region.cells.every(p=>field.structures![p]?.kind===type)).toBe(true);
    }
    const {field}=build({},[],{scene:'interior'},'dry-default');
    expect(field.tiles.some(t=>['deep_water','shallow_water','hill','forest'].includes(t))).toBe(false);
  });
  it('lays indoor rivers and bridges without replacing walls or doors',()=>{
    const interior={use:'office',pattern:'hall'},dry=build({interior},[],{scene:'interior'},'indoor-stream').field;
    const {field}=build({interior,water:{type:'river',at:'B2',bridges:[{name:'石桥',at:'B2'}]}},[],{scene:'interior'},'indoor-stream');
    expect(field.tiles).toContain('deep_water');checkRegion(field,'石桥','B2');
    for(const door of dry.generation!.interior!.doorways){expect(field.structures![door]).toEqual(dry.structures![door]);expect(field.tiles[door]).toBe(dry.tiles[door]);}
    for(const [p,s]of dry.structures!.entries())if(s&&['wall','building','gate'].includes(s.kind))expect(field.structures![p]).toEqual(s);
    expect(field.structures!.some(s=>s&&['wall','building'].includes(s.kind))).toBe(true);
  });
  it('floods low ground in every scene while preserving existing structures, rubble and raised terrain',()=>{
    for(const scene of ['field','city_siege','city_streets','building_siege','trenches','interior'] as const){
      const answer={places:[{type:'hill',name:'高地',at:'C3',height:2},{type:'cover',name:'石堆',at:'B2'}]};
      const seed='all-water-'+scene,extra={scene};
      const dry=build(answer,[],extra,seed).field;
      const {field,compiled}=build({...answer,water:{type:'ford',at:'all'}},[],extra,seed);
      expect(compiled.plan.waterCoverage).toBe('all');expect(field.generation!.waterCoverage).toBe('all');
      expect(field.tiles).toContain('shallow_water');expect(field.structures).toEqual(dry.structures);
      for(let p=0;p<dry.tiles.length;p++){
        const protectedGround=!!dry.structures![p]||dry.groundHeight![p]!>0||['wall','cliff','hill','cover','forest','rough'].includes(dry.tiles[p]!)||dry.overlays![p]?.includes('rubble');
        expect(field.tiles[p],scene+':'+p).toBe(protectedGround?dry.tiles[p]:'shallow_water');
      }
      expect(field.groundHeight).toEqual(dry.groundHeight);
    }
    const roster=actors(4),{field}=build({water:{type:'ford',at:'all'}},roster,{scene:'interior'},'flooded-indoor-start');
    const battle=new SmallBattle({battlefield:field,combatants:roster,rules:V32_OVERFLOW_D20,seed:'flooded-start'});battle.start();
    expect(SmallBattle.fromSnapshot(battle.toSnapshot()).toSnapshot()).toEqual(battle.toSnapshot());
  });
  it('keeps full deep water deep and uses actual water capability for deployment',()=>{
    const roster=actors(2);roster.forEach(u=>u.traits.push('water-crossing'));
    const {field}=build({water:{type:'river',at:'all',bridges:[]}},roster,{scene:'field'},'deep-all');
    expect(field.tiles).toContain('deep_water');expect(field.tiles).not.toContain('shallow_water');
    expect(field.structures!.some(s=>s?.kind==='bridge')).toBe(false);
    const battle=new SmallBattle({battlefield:field,combatants:roster,rules:V32_OVERFLOW_D20,seed:'deep-all'});battle.start();
    expect(battle.combatants.every(u=>!groundBlocked(field,u.pos!,u))).toBe(true);
  });
  it('mixes both depths in a flooded map with reproducible patches and a legal ordinary-unit start',()=>{
    const roster=actors(4),answer={water:{type:'mixed',at:'all',bridges:[]}};
    const {field,compiled}=build(answer,roster,{scene:'interior'},'mixed-all');
    expect(compiled.plan.waterDepth).toBe('mixed');expect(field.tiles).toContain('deep_water');expect(field.tiles).toContain('shallow_water');
    expect(build(answer,roster,{scene:'interior'},'mixed-all').field.tiles).toEqual(field.tiles);
    const battle=new SmallBattle({battlefield:field,combatants:roster,rules:V32_OVERFLOW_D20,seed:'mixed-all'});battle.start();
    expect(battle.combatants.every(u=>!groundBlocked(field,u.pos!,u))).toBe(true);
    expect(SmallBattle.fromSnapshot(battle.toSnapshot()).toSnapshot()).toEqual(battle.toSnapshot());
  });
});
