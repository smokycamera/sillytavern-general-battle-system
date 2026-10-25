import {describe,it,expect} from 'vitest';
import {generatedLayeredField,generateUnit,traitRegistry,SmallBattle,V34_OVERFLOW_D20,standardField} from '../src/index.js';
import {canClimbFrom,groundBlocked,createStructure} from '../src/small/layers.js';
import {neighbors,movementNeighbors,findGridPath,reachableGridPaths,gridCostsToGoals} from '../src/small/spatial.js';
import {findIntentRoute} from '../src/small/intent-path.js';
import {compileLayout} from '../../panel/src/llm-layout.js';
const registry=traitRegistry();
function unit(id:string,side:'ally'|'enemy') {const u=generateUnit({name:id,side,scale:'hero',rulesVersion:'v2',level:3,traits:[]},{seed:id,registry,noVariance:true}).unit;u.id=id;return u;}
function field(at=['B2','C2','B3','C3'],walls='double',states=['closed']) {
 const plan=compileLayout({city:{at,walls,gates:states.map((state,i)=>({name:'城门'+i,state}))}},
  {scene:'city_siege',size:'large',attacker:'ally',objectiveMode:'siege',units:[],map:[13,19]}).plan;
 return generatedLayeredField('map-review',7,13,['siege'],{plan,attackingSide:'ally'});
}
describe('分区城防与实际墙头通行',()=>{
 it('内墙只从城内登上；夹道可登外墙但不能无特质登内墙',()=>{
  const f=field(),city=f.city!,urban=new Set([...city.inside,...city.frontline]),terrace=new Set(city.terrace);
  const outer=city.frontline.filter(p=>neighbors(f,p).some(n=>!urban.has(n)));
  for(const p of city.frontline)for(const n of f.structures![p]!.access??[])
   expect(outer.includes(p)?terrace.has(n):city.inside.includes(n)&&!terrace.has(n)).toBe(true);
  const inner=city.frontline.find(p=>!outer.includes(p)&&f.structures![p]?.kind==='wall'&&f.structures![p]!.access!.length&&neighbors(f,p).some(n=>terrace.has(n)))!;
  expect(inner).toBeDefined();
  const passage=neighbors(f,inner).find(n=>terrace.has(n))!,town=f.structures![inner]!.access![0]!;
  const a=unit('a','ally'),d=unit('d','enemy'),b=new SmallBattle({combatants:[a,d],battlefield:f,rules:V34_OVERFLOW_D20,seed:'stairs'});b.start();b.turnOrder=['a','d'];b.turnIndex=0;d.pos=city.core[0]!;
  a.pos=passage;expect(b.climbReason('a',inner)).toContain('梯道');expect(()=>b.climb('a',inner)).toThrow(/梯道/);
  a.pos=town;expect(canClimbFrom(f,a,inner)).toBe(true);expect(b.climbReason('a',inner)).toBeUndefined();b.climb('a',inner);expect(a.elevation).toBe(1);
  const outerStairs=outer.find(p=>f.structures![p]!.access!.length)!;
  expect(canClimbFrom(f,{...a,elevation:undefined,pos:f.structures![outerStairs]!.access![0]},outerStairs)).toBe(true);
 });
 it('四外门分别配四内门，开关与已毁外门的内门状态保持独立，地面通路完整',()=>{
  const states=['open','closed','destroyed','open'],f=field(undefined,'double',states),outer=new Set(f.city!.gates);
  const inner=f.structures!.flatMap((s,p)=>s?.kind==='gate'&&!outer.has(p)?[p]:[]);
  expect(outer.size).toBe(4);expect(inner).toHaveLength(4);
  expect(f.city!.gates.map(p=>f.structures![p]!.gateState)).toEqual(states);
  expect(inner.map(p=>f.structures![p]!.gateState).sort()).toEqual(['closed','closed','open','open']);
  const opened=structuredClone(f),urban=new Set([...f.city!.inside,...f.city!.frontline]);
  for(const s of opened.structures!)if(s?.kind==='gate'){s.hp=s.hpMax;s.gateState='open';}
  for(const gate of outer)expect(findGridPath(opened,gate,f.city!.core[0]!,p=>urban.has(p)&&!groundBlocked(opened,p),()=>1)).toBeDefined();
 });
 it('生成的斜接墙头在手动、意图、可达格和反向寻路中一致，移动与存档保留楼层',()=>{
  const f=field(['A2','B2','B3','C3'],'ring'),from=9*f.width+2,to=10*f.width+3,a=unit('a','ally'),d=unit('d','enemy');
  const b=new SmallBattle({combatants:[a,d],battlefield:f,rules:V34_OVERFLOW_D20,seed:'diagonal-wall'});b.start();b.turnOrder=['a','d'];b.turnIndex=0;a.pos=from;a.elevation=1;d.pos=f.city!.core[0]!;
  const actual=b.battlefield!,allowed=(p:number)=>!groundBlocked(actual,p,a);
  expect(movementNeighbors(actual,from,a)).toContain(to);
  expect(findGridPath(actual,from,to,allowed,()=>1,a)?.cells).toEqual([from,to]);
  expect(reachableGridPaths(actual,from,1,allowed,()=>1,a).some(p=>p.cells.at(-1)===to)).toBe(true);
  expect(gridCostsToGoals(actual,[to],allowed,()=>1,a).get(from)).toBe(1);
  expect(findIntentRoute(actual,a,b.combatants,u=>u.pos===to,()=>false,3,2)?.map(s=>({kind:s.kind,cell:s.cell}))).toEqual([{kind:'move',cell:to}]);
  expect(b.pathPreview('a',to).path?.cells).toEqual([from,to]);const before=b.movementLeft('a');b.moveTo('a',to);
  expect(a.pos).toBe(to);expect(a.elevation).toBe(1);expect(b.movementLeft('a')).toBe(before-1);
  const snap=b.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
  a.pos=from;b.movementSpent.delete('a');b.autoAction('a',{mode:'hold',cell:to});expect(a.pos).toBe(to);expect(a.elevation).toBe(1);
 });
 it.each([[1,1],[-1,1],[1,-1],[-1,-1]])('斜接方向%s/%s不扩大地面移动，不跨已毁墙角或已毁落点',(dx,dy)=>{
  const f=standardField();f.tiles.fill('open');f.layerVersion=1;f.structures=f.tiles.map(()=>null);
  const from=3*f.width+3,to=from+dy*f.width+dx,a={...unit('a','ally'),pos:from,elevation:1 as const};
  f.structures[from]=createStructure('wall',3,{top:true});f.structures[to]=createStructure('gate',3,{top:true});
  expect(movementNeighbors(f,from,a)).toContain(to);
  expect(movementNeighbors(f,from,{...a,elevation:undefined})).not.toContain(to);
  expect(movementNeighbors(f,from,{...a,airborne:true})).not.toContain(to);
  const corner=from+dx;f.structures[corner]=createStructure('wall',3,{top:true});expect(movementNeighbors(f,from,a)).not.toContain(to);
  f.structures[corner]!.hp=0;expect(movementNeighbors(f,from,a)).not.toContain(to);
  f.structures[corner]=null;f.structures[to]!.hp=0;expect(movementNeighbors(f,from,a)).not.toContain(to);
 });
});
