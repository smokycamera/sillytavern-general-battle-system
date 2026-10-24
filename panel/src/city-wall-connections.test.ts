import {describe,it,expect} from 'vitest';
import {generatedLayeredField,generateUnit,traitRegistry,SmallBattle,V34_OVERFLOW_D20} from '../../engine/src/index.js';
import {groundBlocked} from '../../engine/src/small/layers.js';
import {neighbors} from '../../engine/src/small/spatial.js';
import {compileLayout} from './llm-layout.js';

function build(at: string[] | string, attacker: 'ally' | 'enemy' = 'enemy') {
 const plan=compileLayout({city:{at,walls:'double',gates:[{name:'城门',state:'closed'}]}},
  {scene:'city_siege',size:'large',attacker,objectiveMode:'siege',units:[],map:[13,19]}).plan;
 return generatedLayeredField('closed-double',7,13,['siege'],{plan,attackingSide:attacker});
}
describe('闭合城市与墙头连接',()=>{
 it.each([['A3','B3','A4'],['B3','C3','B4','C4']])('触边的双重城墙仍闭合：%j',(...at)=>{
  const f=build(at),urban=new Set([...f.city!.inside,...f.city!.frontline]);
  const queue=f.tiles.flatMap((_,p)=>!urban.has(p)&&!groundBlocked(f,p)?[p]:[]),seen=new Set(queue);
  for(let i=0;i<queue.length;i++)for(const n of neighbors(f,queue[i]!))if(!seen.has(n)&&!groundBlocked(f,n)){seen.add(n);queue.push(n);}
  expect(f.city!.shape).toBe('enclosure');
  expect(f.city!.inside.some(p=>seen.has(p))).toBe(false);
  expect(f.city!.frontline.every(p=>groundBlocked(f,p))).toBe(true);
 });
 it.each([{at:['B2','C2','B3','C3']},{at:'N'}])('生成的相邻墙格能直接沿墙头移动，不添加连桥：$at',({at})=>{
  const f=build(at),outer=f.city!.frontline.find(p=>neighbors(f,p).some(n=>f.structures![n]?.top))!;
  const adjacent=neighbors(f,outer).find(p=>f.structures![p]?.top)!;
  expect(f.structures!.some(s=>s?.kind==='bridge'&&s.top)).toBe(false);
  const registry=traitRegistry(),a=generateUnit({name:'a',side:'ally',scale:'hero',level:3,traits:[]},{registry,seed:'a'}).unit;
  const d=generateUnit({name:'d',side:'enemy',scale:'hero',level:3,traits:[]},{registry,seed:'d'}).unit;a.id='a';d.id='d';
  const b=new SmallBattle({combatants:[a,d],battlefield:f,rules:V34_OVERFLOW_D20,seed:'wall-walk'});b.start();
  b.turnOrder=['a','d'];b.turnIndex=0;a.pos=outer;a.elevation=1;d.pos=f.city!.core[0]!;
  expect(b.pathPreview('a',adjacent).path?.cells).toEqual([outer,adjacent]);
  b.moveTo('a',adjacent);expect(a.pos).toBe(adjacent);expect(a.elevation).toBe(1);
  const snap=b.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
 });
});
