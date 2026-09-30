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
  it('produces different forest region and route layouts for different archetypes',()=>{
    const path=generatedLayeredField('forest-archetype',7,13,['forest'],{plan:{archetype:'forest_path',water:'none',landmarks:[]}});
    const edge=generatedLayeredField('forest-archetype',7,13,['forest'],{plan:{archetype:'forest_edge',water:'none',landmarks:[]}});
    expect(geometrySignature(path)).not.toBe(geometrySignature(edge));expect(path.scene!.archetype).toBe('forest_path');
  });
});
