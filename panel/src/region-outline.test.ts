import {describe,it,expect} from 'vitest';
import {generatedLayeredField,SmallBattle,V33_OVERFLOW_D20,generateUnit,type Combatant} from '../../engine/src/index.js';
import {connectedCitySectors,regionCells} from '../../engine/src/small/region-layout.js';
import {neighbors,findGridPath} from '../../engine/src/small/spatial.js';
import {groundBlocked} from '../../engine/src/small/layers.js';
import {compileLayout,type LayoutContext} from './llm-layout.js';
import type {GridAnchor} from '../../engine/src/small/grid-anchor.js';

const z:GridAnchor[]=['A1','B1','B2','B3','C3'];
function permutations(values:GridAnchor[]):GridAnchor[][] {return values.length<=1?[values]:values.flatMap((v,i)=>permutations(values.filter((_,j)=>i!==j)).map(rest=>[v,...rest]));}
function plan(scene:LayoutContext['scene'],at:GridAnchor[],roster:Combatant[]=[]) {
 return compileLayout({city:{at,walls:'ring',gates:[{name:'正门',state:'closed'}]},compound:{pattern:'courtyard'},ally:{at:['D4']},enemy:{post:'inside'}},
  {scene,size:'standard',attacker:'ally',objectiveMode:'siege',units:roster.map(u=>({id:u.id,name:u.name,side:u.side,kind:'人物'})),map:[11,17]}).plan;
}
describe('authoritative connected outlines',()=>{
 it('all 120 orderings of a connected Z keep exactly the selected five sectors',()=>{
  for(const input of permutations(z))expect(connectedCitySectors(input)).toEqual(z);
 });
 it('only disconnected components need bridging, with order-independent dry routing and no water shortcut',()=>{
  const selected:GridAnchor[]=['A1','D1','D4'],water:GridAnchor[]=['B1','C1'];
  const expected=connectedCitySectors(selected,water);
  for(const input of permutations(selected))expect(connectedCitySectors(input,water)).toEqual(expected);
  expect(expected).toEqual(expect.arrayContaining(selected));expect(expected.some(a=>water.includes(a))).toBe(false);
  expect(()=>connectedCitySectors(['A1','C1'],['B1','B2','B3','B4'])).toThrow(/隔断/);
 });
 it.each(['city_siege','building_siege'] as const)('%s keeps the actual Z perimeter, closed gates and identical geometry after reordering',scene=>{
  const f=generatedLayeredField('z-outline',7,13,['siege'],{plan:plan(scene,z)});
  const reordered=generatedLayeredField('z-outline',7,13,['siege'],{plan:plan(scene,['A1','C3','B3','B2','B1'])});
  expect([reordered.width,reordered.height,reordered.tiles,reordered.structures,reordered.city]).toEqual([f.width,f.height,f.tiles,f.structures,f.city]);
  const actual=new Set([...f.city!.inside,...f.city!.frontline]),allowed=new Set(regionCells(f,z));
  expect([...actual].every(p=>allowed.has(p))).toBe(true);
  expect(regionCells(f,['C1','C2']).some(p=>actual.has(p))).toBe(false);
  for(const p of f.city!.frontline)expect(neighbors(f,p).some(n=>!actual.has(n))).toBe(true);
  const inside=f.city!.inside.filter(p=>!groundBlocked(f,p)),out=f.tiles.flatMap((_,p)=>!actual.has(p)&&!groundBlocked(f,p)?[p]:[]);
  expect(out.some(start=>findGridPath(f,start,inside[0]!,p=>!groundBlocked(f,p)))).toBe(false);
  f.structures![f.city!.gates[0]!]!.gateState='open';
  const entrance=neighbors(f,f.city!.gates[0]!).find(p=>!actual.has(p)&&!groundBlocked(f,p))!;
  expect(findGridPath(f,entrance,f.city!.core[0]!,p=>!groundBlocked(f,p))).toBeDefined();
 });
 it('the same outline yields varied connected rooms and usable eight-unit battles without changing its perimeter',()=>{
  const roster=(['ally','enemy'] as const).flatMap(side=>Array.from({length:4},(_,i)=>{const u=generateUnit({name:side+i,side,scale:'hero',rulesVersion:'v2',level:3,weaponClass:'sword',traits:[]},{seed:side+i,noVariance:true}).unit;u.id=side+i;return u;}));
  const skeletons=new Set<string>();
  for(let i=0;i<8;i++){
   const f=generatedLayeredField('z-room-'+i,7,13,['siege'],{plan:plan('building_siege',z,roster),roster,attackingSide:'ally'});
   const cells=f.city!.inside.filter(p=>!groundBlocked(f,p)),allowed=new Set(cells),queue=[cells[0]!],reached=new Set(queue);
   for(let q=0;q<queue.length;q++)for(const n of neighbors(f,queue[q]!))if(allowed.has(n)&&!reached.has(n)){reached.add(n);queue.push(n);}
   expect(reached.size).toBe(cells.length);expect(f.generation!.compound!.areas.length).toBeGreaterThan(1);
   skeletons.add(JSON.stringify(f.structures!.flatMap((s,p)=>s&&['wall','gate'].includes(s.kind)&&f.city!.inside.includes(p)?[[p,s.kind]]:[])));
   const b=new SmallBattle({combatants:structuredClone(roster),battlefield:f,rules:V33_OVERFLOW_D20,seed:'z-room-'+i});b.start();
   const snap=b.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
  }
  expect(skeletons.size).toBeGreaterThan(1);
 });
 it('named rooms and an exterior square stay bound to their real sides of the irregular wall',()=>{
  const ctx:LayoutContext={scene:'building_siege',size:'standard',attacker:'ally',objectiveMode:'siege',units:[],map:[11,17]};
  const layout=compileLayout({city:{at:z,gates:[{name:'正门',state:'closed'}]},compound:{pattern:'courtyard'},
   places:[{type:'room',name:'北屋',at:'B1'},{type:'room',name:'南屋',at:'C3'},{type:'square',name:'院外广场',at:'D4'}],objective:'北屋'},ctx);
  const f=generatedLayeredField('z-named',7,13,['siege'],{plan:layout.plan}),inside=new Set(f.city!.inside);
  for(const label of ['北屋','南屋']){
   const region=f.scene!.regions.find(r=>r.label===label)!;expect(region.cells.length).toBeGreaterThan(1);expect(region.cells.every(p=>inside.has(p))).toBe(true);
  }
  const square=f.scene!.regions.find(r=>r.label==='院外广场')!;expect(square.cells.every(p=>!inside.has(p)&&!f.city!.frontline.includes(p))).toBe(true);
  expect(f.scene!.regions.find(r=>r.label==='北屋')!.cells).toContain(f.objective.cell);
 });
});
