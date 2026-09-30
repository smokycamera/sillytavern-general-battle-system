import {describe,it,expect} from 'vitest';
import {standardField,findGridPath,gridCostsToGoals,movementStepCost,unitLineOfSight,meleeHeightReason,validateField,
  SmallBattle,V11_OVERFLOW_D20,prepareCombatModel,generateUnit,type BattlefieldSpec} from '../src/index.js';
import {rangedScreen} from '../src/guard-screen.js';
function sceneUnit(id:string,side:'ally'|'enemy') {
  const u=generateUnit({name:id,side,scale:'hero',rulesVersion:'v2',level:3,weaponClass:'sword',weaponLevel:3,traits:[]},{seed:id,noVariance:true}).unit;u.id=id;return u;
}

function field():BattlefieldSpec {
  const f=standardField(7,9);f.tiles.fill('open');f.layerVersion=1;f.structures=f.tiles.map(()=>null);f.spatialRulesVersion=2;f.groundHeight=f.tiles.map(()=>0);return f;
}
describe('real ground heights',()=>{
  it('uses directional costs for uphill/downhill and the same reverse goal costs',()=>{
    const f=field(),a=sceneUnit('a','ally');a.pos=28;f.groundHeight![29]=1;f.groundHeight![30]=2;
    const allowed=(p:number)=>[28,29,30].includes(p),cost=(p:number,from:number)=>movementStepCost(f,p,a,[],from);
    expect(findGridPath(f,28,30,allowed,cost)?.cost).toBe(4);expect(findGridPath(f,30,28,allowed,cost)?.cost).toBe(2);
    expect(gridCostsToGoals(f,[30],allowed,cost).get(28)).toBe(4);expect(gridCostsToGoals(f,[28],allowed,cost).get(30)).toBe(2);
  });
  it('keeps plateaus cheap, cliffs impassable, and explicit stairs usable',()=>{
    const f=field(),a=sceneUnit('a','ally');a.pos=28;f.groundHeight![28]=2;f.groundHeight![29]=2;f.tiles[29]='hill';
    expect(movementStepCost(f,29,a,[],28)).toBe(1);
    f.groundHeight![28]=0;expect(movementStepCost(f,29,a,[],28)).toBe(Infinity);
    f.heightTransitions=[{from:28,to:29,kind:'stairs'}];expect(movementStepCost(f,29,a,[],28)).toBe(3);
  });
  it('blocks low observers behind a ridge but allows a raised ray above it',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');a.pos=28;b.pos=34;f.groundHeight![31]=2;
    expect(unitLineOfSight(f,a,b)).toBe(false);f.groundHeight![28]=3;f.groundHeight![34]=3;
    expect(unitLineOfSight(f,a,b)).toBe(true);expect(unitLineOfSight(f,b,a)).toBe(true);
  });
  it('does not permit adjacent melee across an abrupt elevation difference',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');a.pos=28;b.pos=29;f.groundHeight![29]=2;
    expect(meleeHeightReason(f,a,b)).toContain('高差');f.groundHeight![29]=1;expect(meleeHeightReason(f,a,b)).toBeUndefined();
  });
  it('previewed costs equal executed movement and cannot be lowered by remaining MP',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');a.pos=28;b.pos=34;f.groundHeight![29]=1;f.groundHeight![30]=2;
    f.deploymentZones=[{side:'ally',cells:[28]},{side:'enemy',cells:[34]}];
    const battle=new SmallBattle({rules:V11_OVERFLOW_D20,battlefield:f,combatants:[a,b],seed:'height-cost'});battle.start();battle.turnOrder=['a','b'];battle.turnIndex=0;
    const before=battle.movementLeft('a'),preview=battle.pathPreview('a',29);expect(preview.path?.cost).toBe(2);
    battle.moveTo('a',29);expect(battle.movementLeft('a')).toBe(before-2);expect(battle.pathPreview('a',30).path).toBeUndefined();
    expect(SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot())).toSnapshot()).toEqual(battle.toSnapshot());
  });
  it('height can clear a ground friendly screen without changing the old screen rule',()=>{
    const f=field(),a=sceneUnit('a','ally'),friend=sceneUnit('f','ally'),b=sceneUnit('b','enemy');
    a.pos=28;friend.pos=29;b.pos=34;prepareCombatModel(a,V11_OVERFLOW_D20);a.weapon={...a.weapon!,tags:['ranged'],recipe:{...a.weapon!.recipe!,mechanism:'rifle'}};
    f.groundHeight![28]=3;
    expect(rangedScreen(a,b,a.weapon,[friend],{mode:'small',width:7,battlefield:f},new Map())).toBeUndefined();
    expect(rangedScreen(a,b,a.weapon,[friend],{mode:'small',width:7},new Map())?.id).toBe('f');
  });
  it('validates height data and preserves tile-only saves without enabling new height rules',()=>{
    const f=field();f.groundHeight![0]=-1;expect(()=>validateField(f)).toThrow('高度');
    const old=standardField(7,9);old.tiles.fill('open');old.tiles[29]='hill';const a=sceneUnit('a','ally');a.pos=28;
    expect(movementStepCost(old,29,a,[],28)).toBe(2);expect(old.spatialRulesVersion).toBeUndefined();
  });
});
