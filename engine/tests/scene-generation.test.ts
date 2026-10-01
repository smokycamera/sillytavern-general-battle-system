import { describe,it,expect } from 'vitest';
import { generatedLayeredField,prepareGridDeployment,generateUnit,SmallBattle,V11_OVERFLOW_D20,gridDistance,groundBlocked,
  normalizeSceneIntent,validateSceneFacts,retreatCells,type SceneIntent,type SceneEntity,type Combatant } from '../src/index.js';
import { geometrySignature,measureMap } from '../src/small/map-metrics.js';

export function sceneUnit(id:string,side:'ally'|'enemy',body:'human'|'vehicle'='human'):Combatant {
  const u=generateUnit({name:id,side,body,scale:'hero',rulesVersion:'v2',level:3,weaponClass:'sword',weaponLevel:3,traits:[]},{seed:id,noVariance:true}).unit;u.id=id;return u;
}
const evidence={basis:'explicit' as const,sources:['m1.p1']};
function entity(id:string,kind:SceneEntity['kind'],extra:Partial<SceneEntity>={}):SceneEntity{return {id,kind,...evidence,...extra};}
export function bridgeTownIntent():SceneIntent {
  return {schema:'scene-intent-v1',archetype:'riverside',entities:[entity('town','city',{anchor:'west',label:'西侧小城'}),entity('river','river',{anchor:'east'}),
    entity('bridge','bridge',{label:'唯一石桥'}),entity('gate','gate',{anchor:'east',label:'东门',state:'closed'}),entity('woods','forest',{anchor:'east',label:'东岸林地'}),
    entity('hill','hill',{anchor:'north',height:2,label:'北侧高台'})],relations:[
      {subject:'town',relation:'west_of',object:'river',...evidence},{subject:'bridge',relation:'crosses',object:'river',...evidence},
      {subject:'bridge',relation:'connected_to',object:'gate',...evidence},{subject:'enemy',relation:'guards',object:'bridge',region:'west_bank',...evidence},
      {subject:'ally',relation:'approaches_from',object:'woods',region:'east_bank',...evidence},
      {subject:'hill',relation:'higher_than',object:'bridge',...evidence}],constraints:[
        {kind:'crossing_count',entity:'river',value:1,...evidence},{kind:'gate_count',entity:'town',value:1,...evidence}]};
}
describe('scene constraints and actual deployment',()=>{
  it('places center at the actual center and riverbank beside real water',()=>{
    const center=generatedLayeredField('center-v2',7,13,['plains'],{plan:{water:'none',landmarks:[{kind:'position',anchor:'center'}]}});
    expect(center.landmarks![0]!.cells).toEqual([45]);
    const bank=generatedLayeredField('bank-v2',7,13,['plains'],{plan:{water:'river',bridgePlan:[{anchor:'center',state:'intact'}],landmarks:[{kind:'position',anchor:'riverbank'}]}});
    const water=bank.tiles.flatMap((t,p)=>t==='deep_water'?[p]:[]);
    expect(Math.min(...water.map(p=>gridDistance(bank,p,bank.landmarks![0]!.cells[0]!)))).toBe(1);
  });
  it('preserves city side, one bridge, closed east gate, banks and hill through several seeds',()=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('b','ally'),sceneUnit('c','enemy'),sceneUnit('d','enemy')];
    for(const seed of ['narrative-1','narrative-2','narrative-3']) {
      const field=generatedLayeredField(seed,7,13,['siege'],{plan:{scene:'city_siege',shape:'enclosure',intent:bridgeTownIntent()},roster});
      const prepared=prepareGridDeployment(field,roster,seed);
      expect(()=>validateSceneFacts(field,prepared)).not.toThrow();
      expect(new Set(field.structures!.filter(s=>s?.kind==='bridge').map(s=>s!.entityId)).size).toBe(1);
      expect(field.city!.gates).toHaveLength(1);expect(field.structures![field.city!.gates[0]!]!.gateState).toBe('closed');
      const bridge=field.scene!.regions.find(r=>r.id==='bridge')!.cells[0]!%field.width;
      expect(prepared.filter(u=>u.side==='ally').every(u=>u.pos!%field.width>bridge)).toBe(true);
      expect(prepared.filter(u=>u.side==='enemy').every(u=>u.pos!%field.width<bridge)).toBe(true);
      expect(field.scene!.fulfilled.some(text=>text.includes('高于'))).toBe(true);
      const battle=new SmallBattle({rules:V11_OVERFLOW_D20,battlefield:field,combatants:structuredClone(roster),seed});battle.start();
      expect(battle.combatants.map(u=>u.pos)).toEqual(prepared.map(u=>u.pos));
      const restored=SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));expect(restored.toSnapshot()).toEqual(battle.toSnapshot());
    }
  });
  it.each(['north','south','east','west','center'] as const)('can place a defended city at %s and derive retreat edges',position=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('e','enemy')];
    const field=generatedLayeredField('city-'+position,7,13,['siege'],{plan:{cityPosition:position,shape:'enclosure',landmarks:[]},roster});
    expect(field.city!.inside.length).toBeGreaterThan(0);
    expect(prepareGridDeployment(field,roster,'changed-seed').map(u=>u.pos)).toEqual(Object.values(field.initialDeployment!).map(p=>p.pos));
    expect(retreatCells(field,'ally').length).toBeGreaterThan(0);
    expect(field.deploymentZones!.find(z=>z.side==='ally')!.cells.every(p=>!field.city!.inside.includes(p))).toBe(true);
  });
  it('keeps an outside battle an annihilation even with a city and exact gate',()=>{
    const intent:SceneIntent={schema:'scene-intent-v1',archetype:'outskirts',entities:[entity('town','city',{anchor:'west'}),entity('gate','gate',{anchor:'east',state:'open'})],relations:[],constraints:[{kind:'gate_count',entity:'town',value:1,...evidence}]};
    const field=generatedLayeredField('outside-town',7,13,['plains'],{plan:{scene:'field',intent,shape:'enclosure'}});
    expect(field.objective.kind).toBe('annihilation');expect(field.city!.defender).toBeUndefined();expect(field.city!.gates.length).toBe(1);
  });
  it('counts wide bridges as entities and preserves independent destroyed states',()=>{
    const field=generatedLayeredField('two-bridges',7,13,['plains'],{plan:{water:'river',waterAxis:'vertical',bridgePlan:[{id:'north_bridge',anchor:'north',state:'intact',width:2},{id:'south_bridge',anchor:'south',state:'destroyed',width:1}],landmarks:[]}});
    const bridges=field.structures!.filter(s=>s?.kind==='bridge');expect(bridges).toHaveLength(3);
    expect(new Set(bridges.map(s=>s!.entityId)).size).toBe(2);
    expect(bridges.filter(s=>s!.entityId==='south_bridge').every(s=>s!.hp===0)).toBe(true);
    expect(field.tiles.filter(t=>t==='deep_water').length).toBe(field.height);
  });
  it('honors zero bridges without leaving an objective protection gap in the river',()=>{
    const field=generatedLayeredField('no-bridges',7,13,['plains'],{plan:{water:'river',bridgePlan:[],landmarks:[]}});
    const row=Math.floor(field.height/2);expect(field.tiles.slice(row*field.width,(row+1)*field.width).every(t=>t==='deep_water')).toBe(true);
    expect(field.structures!.some(s=>s?.kind==='bridge')).toBe(false);expect(groundBlocked(field,field.objective.cell)).toBe(false);
  });
  it('rejects conflicting bridge counts and invented evidence identities',()=>{
    const bad=bridgeTownIntent();bad.constraints[0]!.value=2;
    expect(()=>generatedLayeredField('conflict',7,13,['siege'],{plan:{intent:bad}})).toThrow('数量');
    expect(()=>normalizeSceneIntent({...bad,entities:[{...bad.entities[0],sources:[]}]})).toThrow('来源');
  });
  it('preserves shallow water requested alongside a river entity',()=>{
    const intent:SceneIntent={schema:'scene-intent-v1',entities:[entity('river','river',{anchor:'center'})],relations:[],
      constraints:[{kind:'crossing_count',entity:'river',value:0,...evidence}]};
    const field=generatedLayeredField('narrative-shallow',7,13,['plains'],{plan:{scene:'field',water:'ford',intent}});
    const river=field.scene!.regions.find(r=>r.id==='river')!.cells;
    expect(river).toHaveLength(field.width);
    expect(river.every(p=>field.tiles[p]==='shallow_water'&&!groundBlocked(field,p))).toBe(true);
    expect(field.tiles).not.toContain('deep_water');
    expect(field.structures!.some(s=>s?.kind==='bridge')).toBe(false);
  });
  it('treats changed durability as the same geometry and reads layered blockers in metrics',()=>{
    const a=generatedLayeredField('grade',7,13,['siege'],{plan:{fortLevel:1,shape:'front',landmarks:[]}}),b=generatedLayeredField('grade',7,13,['siege'],{plan:{fortLevel:10,shape:'front',landmarks:[]}});
    expect(geometrySignature(a)).toBe(geometrySignature(b));
    expect(measureMap(a).alternativePaths).toBe(0);
  });
  it('moves a tower off the road it would block instead of rejecting a river town',()=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('b','ally'),sceneUnit('c','enemy'),sceneUnit('d','enemy')];
    const intent:SceneIntent={schema:'scene-intent-v1',entities:[entity('river','river'),entity('bridge','bridge'),entity('town','city',{anchor:'north'}),entity('tower','tower',{label:'哨塔'})],
      relations:[{subject:'bridge',relation:'crosses',object:'river',...evidence},{subject:'town',relation:'north_of',object:'river',...evidence},
        {subject:'tower',relation:'north_of',object:'bridge',...evidence},{subject:'enemy',relation:'guards',object:'tower',...evidence}],
      constraints:[{kind:'crossing_count',entity:'river',value:1,...evidence}]};
    for(const seed of ['tower-1','tower-2','tower-3']) {
      const field=generatedLayeredField(seed,7,13,['urban'],{plan:{scene:'field',intent},roster});
      const tower=field.scene!.regions.find(r=>r.id==='tower')!.cells[0]!;
      expect(field.structures![tower]!.kind).toBe('tower');expect(field.overlays?.[tower]?.includes('road')).toBeFalsy();
      expect(()=>validateSceneFacts(field,prepareGridDeployment(field,roster,seed))).not.toThrow();
    }
  });
  it('holds a building from its doorways and a tower from its platform',()=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('c','enemy'),sceneUnit('d','enemy')];
    const building:SceneIntent={schema:'scene-intent-v1',entities:[entity('inn','building',{label:'客栈'})],relations:[{subject:'enemy',relation:'occupies',object:'inn',...evidence}],constraints:[]};
    const streets=generatedLayeredField('inn',7,13,['urban'],{plan:{scene:'city_streets',intent:building},roster});
    const inn=streets.scene!.regions.find(r=>r.id==='inn')!, held=prepareGridDeployment(streets,roster,'inn');
    expect(held.filter(u=>u.side==='enemy').every(u=>inn.access.includes(u.pos!))).toBe(true);
    const tower:SceneIntent={schema:'scene-intent-v1',entities:[entity('tower','tower')],relations:[{subject:'enemy',relation:'inside',object:'tower',...evidence}],constraints:[]};
    const field=generatedLayeredField('tower-inside',7,13,['plains'],{plan:{scene:'field',intent:tower},roster});
    const top=prepareGridDeployment(field,roster,'tower-inside').filter(u=>u.side==='enemy');
    expect(top.every(u=>u.elevation===1&&field.scene!.regions.find(r=>r.id==='tower')!.cells.includes(u.pos!))).toBe(true);
  });
  it('lets a named unit keep its own post while the rest of its side follows the side-wide relation',()=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('c','enemy'),sceneUnit('d','enemy')];
    const intent:SceneIntent={schema:'scene-intent-v1',entities:[entity('hill','hill',{anchor:'north'}),entity('ruin','ruins',{anchor:'south_west'})],
      relations:[{subject:'enemy',relation:'guards',object:'hill',...evidence},{subject:'u2',relation:'occupies',object:'ruin',...evidence}],constraints:[]};
    const field=generatedLayeredField('posts',7,13,['plains'],{plan:{scene:'field',intent},roster,unitBindings:{u1:'c',u2:'d'}});
    const prepared=prepareGridDeployment(field,roster,'posts');
    expect(field.scene!.regions.find(r=>r.id==='ruin')!.cells).toContain(prepared.find(u=>u.id==='d')!.pos);
    expect(()=>validateSceneFacts(field,prepared)).not.toThrow();
  });
  it('lays a place beside the one it is near, on the stated side',()=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('c','enemy')];
    const intent:SceneIntent={schema:'scene-intent-v1',entities:[entity('river','river'),entity('bridge','bridge',{label:'石桥'}),entity('tower','tower',{label:'哨塔'})],
      relations:[{subject:'bridge',relation:'crosses',object:'river',...evidence},{subject:'tower',relation:'north_of',object:'bridge',...evidence},{subject:'tower',relation:'near',object:'bridge',...evidence}],
      constraints:[{kind:'crossing_count',entity:'river',value:1,...evidence}]};
    for(const seed of ['beside-1','beside-2','beside-3']) {
      const field=generatedLayeredField(seed,7,13,['plains'],{plan:{scene:'field',intent},roster});
      const tower=field.scene!.regions.find(r=>r.id==='tower')!.cells[0]!,bridge=field.scene!.regions.find(r=>r.id==='bridge')!.cells[0]!;
      expect(Math.floor(tower/field.width)).toBeLessThan(Math.floor(bridge/field.width));expect(gridDistance(field,tower,bridge)).toBeLessThanOrEqual(3);
      expect(()=>validateSceneFacts(field,prepareGridDeployment(field,roster,seed))).not.toThrow();
    }
  });
  it('extends a small occupied place to nearby ground for the whole force, and covers posts that cannot overlap',()=>{
    const roster=[sceneUnit('a','ally'),...['c','d','e','f','g'].map(id=>sceneUnit(id,'enemy'))];
    const intent:SceneIntent={schema:'scene-intent-v1',entities:[entity('ruin','ruins',{anchor:'north'}),entity('hill','hill',{anchor:'south_east'})],
      relations:[{subject:'enemy',relation:'occupies',object:'ruin',...evidence}],constraints:[]};
    const field=generatedLayeredField('held',7,13,['plains'],{plan:{scene:'field',intent},roster});
    expect(field.generation!.notes!.some(note=>note.includes('占据范围延伸'))).toBe(true);
    expect(()=>validateSceneFacts(field,prepareGridDeployment(field,roster,'held'))).not.toThrow();
    const split:SceneIntent={...intent,relations:[{subject:'enemy',relation:'occupies',object:'ruin',basis:'inferred',sources:[]},{subject:'enemy',relation:'near',object:'hill',basis:'inferred',sources:[]}]};
    expect(()=>generatedLayeredField('split',7,13,['plains'],{plan:{scene:'field',intent:split},roster})).not.toThrow();
  });
  it('keeps an unplaced river out of the city walls, switching axis when the city spans the map',()=>{
    const roster=[sceneUnit('a','ally'),sceneUnit('c','enemy')];
    for(const entities of [[entity('river','river')],[entity('river','river'),entity('bridge','bridge',{anchor:'south'})]]) {
      const intent:SceneIntent={schema:'scene-intent-v1',entities,relations:entities.length>1?[{subject:'bridge',relation:'crosses',object:'river',...evidence}]:[],constraints:[]};
      const field=generatedLayeredField('river-wall',7,13,['siege'],{plan:{scene:'city_siege',intent},roster});
      const water=field.tiles.flatMap((t,p)=>t==='deep_water'?[p]:[]);
      expect(water.length).toBeGreaterThan(0);expect(water.some(p=>field.city!.frontline.includes(p))).toBe(false);
    }
  });
  it('produces different forest region and route layouts for different archetypes',()=>{
    const path=generatedLayeredField('forest-archetype',7,13,['forest'],{plan:{archetype:'forest_path',water:'none',landmarks:[]}});
    const edge=generatedLayeredField('forest-archetype',7,13,['forest'],{plan:{archetype:'forest_edge',water:'none',landmarks:[]}});
    expect(geometrySignature(path)).not.toBe(geometrySignature(edge));expect(path.scene!.archetype).toBe('forest_path');
  });
});
