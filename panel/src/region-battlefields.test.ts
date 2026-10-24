import {describe,it,expect} from 'vitest';
import {generatedLayeredField,generateUnit,traitRegistry,SmallBattle,V32_OVERFLOW_D20,type Combatant} from '../../engine/src/index.js';
import {compileLayout,type LayoutContext} from './llm-layout.js';
import {prepareBattleObjective} from './battle-setup.js';
import {groundBlocked,damageStructure} from '../../engine/src/small/layers.js';
import {buildPlannedWater} from '../../engine/src/small/scene-layout-v2.js';
import {regionCells,connectedCitySectors} from '../../engine/src/small/region-layout.js';
import {neighbors,findGridPath,validateField,cellLabel,gridColumnIndex} from '../../engine/src/small/spatial.js';
import {gameCell} from './mcp-game.js';
import {GRID_ANCHORS,inGridSector} from '../../engine/src/small/grid-anchor.js';
import {bracePose,validateTacticalPose} from '../../engine/src/tactics.js';

const registry=traitRegistry();
function unit(id:string,side:Combatant['side'],traits:string[]=[],vehicle=false){const u=generateUnit({name:id,side,scale:'hero',level:3,traits,...vehicle?{body:'vehicle' as const}:{}},{seed:id,registry}).unit;u.id=id;return u;}
function build(answer:unknown,roster:Combatant[]=[],extra:Partial<LayoutContext>={},seed='region-map'){
 const ctx:LayoutContext={scene:'city_siege',size:'large',attacker:'enemy',objectiveMode:'siege',units:roster.map(u=>({id:u.id,name:u.name,side:u.side,kind:'人物'})),map:[13,19],...extra};
 const compiled=compileLayout(answer,ctx),field=generatedLayeredField(seed,7,13,['siege'],{plan:compiled.plan,roster,attackingSide:ctx.attacker,unitBindings:Object.fromEntries(roster.map(u=>[u.id,u.id]))});
 return {field,compiled};
}
describe('区域城市、水域与建筑',()=>{
 it('按合并城区保持紧凑尺寸，保留凹形外缘墙、独立城门状态和破口',()=>{
  const sectors=['A3','B3','A4'] as const;
  const {field}=build({city:{at:sectors,walls:'ring',level:4,breaches:1,gates:[{name:'北门',at:'N',state:'open'},{name:'东门',at:'E',state:'closed'}]}});
  expect(field.width).toBe(13);expect(field.height).toBe(19);
  const urban=new Set([...field.city!.inside,...field.city!.frontline]);
  expect(field.structures!.every((s,p)=>s?.kind!=='building'||urban.has(p))).toBe(true);
  const wide={...field,width:41,height:41};
  expect(cellLabel(wide,26)).toBe('AA1');expect(gridColumnIndex('AO')).toBe(40);expect(gameCell({battlefield:wide} as SmallBattle,'AA1')).toBe(26);
  const defender=unit('守军','ally');defender.pos=field.city!.core[0];const pose=bracePose(defender,undefined,'small',field.width,field.height);expect(pose.height??19).toBe(field.height);expect(()=>validateTacticalPose(pose)).not.toThrow();
  const actual=new Set([...field.city!.inside,...field.city!.frontline]);
  expect(regionCells(field,['B4']).some(p=>actual.has(p))).toBe(false);
  const seam=regionCells(field,['A3']).filter(p=>neighbors(field,p).some(n=>regionCells(field,['B3']).includes(n)));
  expect(seam.some(p=>field.city!.inside.includes(p))).toBe(true);
  expect(field.city!.gates.map(p=>field.structures![p]!.gateState)).toEqual(['open','closed']);
  expect(field.city!.breaches).toHaveLength(1);expect(field.generation!.version).toBe(11);validateField(field);
  const double=build({city:{at:['B2','C2','B3','C3'],walls:'double',level:5,gates:[{name:'正门',state:'open'}]}}).field;
  expect(double.city!.terrace!.length).toBeGreaterThan(0);
  expect(double.structures!.filter(s=>s?.kind==='gate')).toHaveLength(2);
  expect(double.structures!.filter(s=>s?.kind==='gate').every(s=>s!.gateState==='open'&&s!.level===5)).toBe(true);
 });
 it('分开的城区按最短分区路径连接，不填平凹角',()=>{
  expect(connectedCitySectors(['A3','C3'])).toEqual(['A3','B3','C3']);
  expect(connectedCitySectors(['A3','B3','A4'])).toHaveLength(3);
 });
 it('面状海水只在指定区域铺设，沿岸有连续浅滩，城内与房间保持陆地且不凭空造桥',()=>{
  const sailors=[unit('u1','ally',['sailing'],true),unit('u2','enemy',['sailing'],true)];
  const {field}=build({city:{at:['A3','B3','C3','D3','A4','B4','C4','D4'],walls:'front'},water:{type:'mixed',at:['A1','B1','C1','D1','A2','B2','C2','D2']},ally:{post:'wall'},enemy:{at:['A1','B1']},units:[{unit:'u1',at:'D2'},{unit:'u2',at:'B1'}]},sailors);
  expect(field.tiles.some(t=>t==='deep_water')).toBe(true);expect(field.tiles.some(t=>t==='shallow_water')).toBe(true);
  expect(field.city!.inside.every(p=>!field.tiles[p]!.includes('water'))).toBe(true);
  expect(field.structures!.some(s=>s?.kind==='bridge')).toBe(false);
  for(const u of sailors)expect(field.tiles[field.initialDeployment![u.id]!.pos]).toMatch(/water/);
  const prepared=prepareBattleObjective(field,sailors,'siege',undefined,'enemy');expect(prepared.city!.inside).toContain(prepared.objective.cell);
  const sea=build({water:{type:'river',at:GRID_ANCHORS},ally:{at:['A4']},enemy:{at:['A1']}},sailors,{scene:'field',objectiveMode:'annihilation'}).field;
  expect(sea.tiles.every(t=>t==='deep_water')).toBe(true);validateField(sea);
  const lake=build({water:{type:'river',at:['B2','C2'],bridges:[{name:'湖桥',at:'B2',state:'intact'}]}},[],{scene:'field',objectiveMode:'annihilation'}).field;
  const bridge=lake.scene!.regions.find(r=>r.label==='湖桥')!;expect(bridge.cells.length).toBeGreaterThan(1);
  const ends=bridge.cells.filter(p=>neighbors(lake,p).some(n=>!lake.tiles[n]!.includes('water')&&!groundBlocked(lake,n)));expect(ends).toHaveLength(2);
 });
 it('建筑有真实内部、门和外墙，单位可进入，关门阻路，破墙后可通行并能保存恢复',()=>{
  const roster=[unit('u1','ally'),unit('u2','enemy')];
  const {field}=build({places:[{type:'building',name:'仓库',at:'B3'}],ally:{at:['B3']},enemy:{at:['B1']},units:[{unit:'u1',place:'仓库',relation:'inside'}]},roster,{scene:'field',objectiveMode:'annihilation'});
  const room=field.scene!.regions.find(r=>r.label==='仓库')!;expect(room.cells.length).toBe(9);expect(room.cells).toContain(field.initialDeployment!.u1!.pos);
  const doors=field.structures!.flatMap((s,p)=>s?.kind==='gate'?[p]:[]);expect(doors).toHaveLength(1);
  const door=doors[0]!,outside=neighbors(field,door).find(p=>!room.cells.includes(p)&&!groundBlocked(field,p))!;
  expect(findGridPath(field,outside,room.cells[0]!,p=>!groundBlocked(field,p))).toBeDefined();
  field.structures![door]!.gateState='closed';expect(findGridPath(field,outside,room.cells[0]!,p=>!groundBlocked(field,p))).toBeUndefined();
  damageStructure(field,door,field.structures![door]!.hp);expect(findGridPath(field,outside,room.cells[0]!,p=>!groundBlocked(field,p))).toBeDefined();
  const battle=new SmallBattle({battlefield:field,combatants:structuredClone(roster),rules:V32_OVERFLOW_D20,seed:'region-restore'});battle.start();const snap=battle.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
  const group=Array.from({length:20},(_,i)=>unit('u'+(i+1),'ally'));group.push(unit('u21','enemy'));
  const crowded=build({places:[{type:'building',name:'大仓库',at:'B3'}],ally:{at:['B3']},enemy:{at:['B1']},units:[{unit:group.slice(0,20).map(u=>u.id),place:'大仓库',relation:'inside'}]},group,{scene:'field',objectiveMode:'annihilation'}).field;
  const interior=crowded.scene!.regions.find(r=>r.label==='大仓库')!.cells;expect(interior.length).toBeGreaterThan(9);
  expect(group.slice(0,20).every(u=>interior.includes(crowded.initialDeployment![u.id]!.pos))).toBe(true);
 });
 it('旧全场混合水不留下深水占领格，也不会清空核心后把旗点改到城外',()=>{
  const field=generatedLayeredField('venice-flag-probe',7,13,['siege'],{attackingSide:'enemy',plan:{scene:'city_siege',size:'large',cityPosition:'C3',shape:'enclosure',water:'none'}});
  buildPlannedWater(field,{water:'river',waterCoverage:'all',waterDepth:'mixed',bridgePlan:[]},'venice-flag-probe');
  const prepared=prepareBattleObjective(field,[],'siege',undefined,'enemy');expect(prepared.city!.inside).toContain(prepared.objective.cell);
  expect(prepared.objective.kind==='control'&&prepared.objective.cells!.every(p=>!groundBlocked(prepared,p))).toBe(true);validateField(prepared);
 });
 it('守方舰队保留指定水域分区，不受城内部署、上墙或攻方整片预选区覆盖',()=>{
  const roster=[unit('u1','ally'),unit('u2','ally',['sailing'],true),unit('u3','enemy',['sailing'],true),unit('u4','enemy',['water-crossing'])];
  const {field}=build({city:{at:['B3','C3','B4','C4'],walls:'front'},water:{type:'mixed',at:['A1','B1','C1','D1','A2','B2','C2','D2']},ally:{post:'wall'},enemy:{at:['A1','B1','C1','D1']},units:[{unit:'u2',at:'D1',post:'wall'},{unit:'u3',at:'B1'}]},roster);
  const battle=new SmallBattle({battlefield:field,combatants:structuredClone(roster),rules:V32_OVERFLOW_D20,seed:'naval-sectors'});battle.start();
  for(const [id,at]of [['u2','D1'],['u3','B1']]){
   const actor=battle.byId(id!)!;expect(inGridSector(at!,field.width,field.height,actor.pos!%field.width,Math.floor(actor.pos!/field.width))).toBe(true);
   expect(field.tiles[actor.pos!]).toMatch(/water/);expect(actor.elevation).toBeUndefined();
  }
  const guard=battle.byId('u1');expect([...field.city!.inside,...field.city!.frontline]).toContain(guard.pos);
  const snap=battle.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
 });
 it('按攻方相对城区的位置确定默认正面，内部两行两列不再误判为东西侧',()=>{
  const cases=[
   {city:['B3','C3','B4','C4'],enemy:['B2','C2'],facing:'north'},
   {city:['B1','C1','B2','C2'],enemy:['B3','C3'],facing:'south'},
   {city:['C2','D2','C3','D3'],enemy:['B2','B3'],facing:'west'},
   {city:['A2','B2','A3','B3'],enemy:['C2','C3'],facing:'east'},
  ];
  for(const c of cases){const {field}=build({city:{at:c.city,walls:'front'},enemy:{at:c.enemy}},[],{},'relative-front-'+c.facing);expect(field.city!.facing).toBe(c.facing);}
 });
 it('主力正面不覆盖西侧隐蔽小队和南侧独立部队，多方向整方区域也保持可用',()=>{
  const roster=[unit('u1','ally'),unit('u2','enemy'),unit('u3','enemy'),unit('u4','enemy')];
  const city={at:['B2','C2','B3','C3'],walls:'ring'};
  const {field}=build({city,places:[{type:'position',name:'西侧无人防区',at:'A3'}],ally:{post:'wall'},enemy:{at:['B1','C1']},units:[{unit:'u3',place:'西侧无人防区',relation:'near'},{unit:'u4',at:'B4'}]},roster,{},'flank-parties');
  expect(field.city!.facing).toBe('north');
  const west=field.initialDeployment!.u3!.pos,south=field.initialDeployment!.u4!.pos;
  expect(west%field.width).toBeLessThan(Math.min(...field.city!.frontline.map(p=>p%field.width)));
  expect(inGridSector('B4',field.width,field.height,south%field.width,Math.floor(south/field.width))).toBe(true);
  for(const id of ['u2','u3','u4'])expect([...field.city!.inside,...field.city!.frontline]).not.toContain(field.initialDeployment![id]!.pos);
  const multi=build({city,ally:{post:'inside'},enemy:{at:['A2','A3','B4','C4']},units:[{unit:'u3',at:'A3'},{unit:'u4',at:'B4'}]},roster,{},'multi-fronts').field;
  const main=multi.deploymentZones!.find(z=>z.side==='enemy'&&!z.unitId)!;
  expect(main.cells.some(p=>regionCells(multi,['A2','A3']).includes(p))).toBe(true);
  expect(main.cells.some(p=>regionCells(multi,['B4','C4']).includes(p))).toBe(true);
  for(const [id,at]of [['u3','A3'],['u4','B4']]){const p=multi.initialDeployment![id!]!.pos;expect(inGridSector(at!,multi.width,multi.height,p%multi.width,Math.floor(p/multi.width))).toBe(true);}
 });
});
