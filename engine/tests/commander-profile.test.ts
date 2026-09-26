import { describe,it,expect } from 'vitest';
import { commanderScores,normalizeCommanderProfiles,type CommandChoice } from '../src/commander-profile.js';
import { SmallBattle,MassBattle,generateUnit,standardField,V4_OVERFLOW_D20,V4_OVERFLOW_TW } from '../src/index.js';
const choices:CommandChoice[]=[
 {key:'fire',score:10,attack:true,ranged:true,move:false,defend:false},
 {key:'flank',score:10,attack:true,ranged:false,move:true,defend:false},
 {key:'guard',score:10,attack:false,ranged:false,move:false,defend:true},
];
describe('bounded built-in commander preferences',()=>{
 it('makes firepower, flanking and cautious styles prefer different legal choices, with unchanged baseline and reproducible estimates',()=>{
  expect(commanderScores(choices,undefined,'turn')).toEqual([10,10,10]);
  for(const [style,index] of [['firepower',0],['flanking',1],['cautious',2]] as const){
   const scores=commanderScores(choices,{ability:'master',style},'turn');expect(scores.indexOf(Math.max(...scores))).toBe(index);
  }
  const novice=commanderScores(choices,{ability:'novice',style:'balanced'},'turn');
  expect(novice).toEqual(commanderScores(choices,{ability:'novice',style:'balanced'},'turn'));
  expect(novice.some(x=>x!==10)).toBe(true);expect(novice.every(x=>x>=8.2&&x<=11.8)).toBe(true);
  expect(commanderScores(choices,{ability:'master',style:'balanced'},'turn')).toEqual([10,10,10]);
  expect(normalizeCommanderProfiles({ally:{ability:'god',style:'unknown'}})).toEqual({});
 });
 it.each(['small','mass'] as const)('keeps %s commands legal and exactly replayable across snapshot restore, while capability changes decisions',mode=>{
  const units=(['ally','enemy'] as const).flatMap(side=>[0,1].map(i=>{
   const u=generateUnit({name:side+i,side,scale:mode==='small'?'hero':'company',hpMax:mode==='small'?200:20,level:3,rulesVersion:'v2',weaponClass:i?'rifle':'sword',weaponLevel:3,armorTier:1,traits:[]},{seed:side+i,noVariance:true}).unit;u.id=side+i;u.morale=u.base.moraleMax=100;if(mode==='mass')u.tags.push('zone:中军','rank:front');return u;
  }));
  const field=standardField();field.tiles.fill('open');
  const base=mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,seed:'profiles'}):new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,seed:'profiles'});
  base.start();base.commanderProfiles={ally:{ability:'novice',style:'flanking'},enemy:{ability:'expert',style:'cautious'}};
  const restore=(snap:Record<string,unknown>)=>mode==='small'?SmallBattle.fromSnapshot(structuredClone(snap)):MassBattle.fromSnapshot(structuredClone(snap));
  const again=restore(base.toSnapshot()),master=restore(base.toSnapshot());master.commanderProfiles={ally:{ability:'master',style:'balanced'},enemy:{ability:'master',style:'balanced'}};
  const advance=(battle:SmallBattle|MassBattle)=>{for(let i=0;i<12&&!battle.isOver();i++){if(battle instanceof SmallBattle)battle.autoAction(battle.active!.id);else{battle.autoOrders('ally');battle.autoOrders('enemy');battle.resolveRound();}}};
  advance(base);advance(again);advance(master);
  expect(again.toSnapshot()).toEqual(base.toSnapshot());
  expect(base.log).not.toEqual(master.log);
  expect(base.round).toBeGreaterThan(1);
  expect(base.combatants.every(u=>u.hp>=0)).toBe(true);
 });
});
