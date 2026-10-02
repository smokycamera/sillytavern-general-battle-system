import {describe,it,expect} from 'vitest';
import {standardField,findGridPath,gridCostsToGoals,movementStepCost,unitLineOfSight,meleeHeightReason,validateField,
  SmallBattle,V11_OVERFLOW_D20,prepareCombatModel,generateUnit,createStructure,structureDefense,heightDefense,heightDescription,
  standingTerrain,gridWeapon,gridDistance,weaponTargetReason,collectMods,standardConditionMap,traitRegistry,type BattlefieldSpec} from '../src/index.js';
import {rangedScreen} from '../src/guard-screen.js';
import {engagementWidth} from '../src/exposure.js';
function sceneUnit(id:string,side:'ally'|'enemy',ranged=false) {
  const u=generateUnit({name:id,side,scale:'hero',rulesVersion:'v2',level:3,weaponClass:ranged?'bow':'sword',weaponLevel:3,traits:[]},{seed:id,noVariance:true}).unit;u.id=id;return u;
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
  it('sees over slopes and lower terraces, while a ridge higher than both still hides the far side',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');
    a.pos=28;b.pos=33;f.groundHeight![28]=2;for(const p of [29,30,31,32])f.groundHeight![p]=1;
    expect(unitLineOfSight(f,a,b)).toBe(true);expect(unitLineOfSight(f,b,a)).toBe(true);
    f.groundHeight!.fill(0);f.groundHeight![29]=1;f.groundHeight![30]=2;b.pos=30;
    expect(unitLineOfSight(f,a,b)).toBe(true);expect(unitLineOfSight(f,b,a)).toBe(true);
    f.groundHeight![31]=2;b.pos=31;expect(unitLineOfSight(f,a,b)).toBe(true);
    f.groundHeight!.fill(0);f.groundHeight![30]=2;b.pos=32;
    expect(unitLineOfSight(f,a,b)).toBe(false);expect(unitLineOfSight(f,b,a)).toBe(false);
    f.groundHeight![28]=1;f.groundHeight![32]=1;expect(unitLineOfSight(f,a,b)).toBe(false);
    f.groundHeight![28]=3;expect(unitLineOfSight(f,a,b)).toBe(true);
  });
  it('walls still shelter the cell right behind them from a hill and show the height of their top',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');
    f.groundHeight![28]=2;f.structures![30]=createStructure('wall',3,{top:true});a.pos=28;b.pos=31;
    expect(unitLineOfSight(f,a,b)).toBe(false);b.pos=32;expect(unitLineOfSight(f,a,b)).toBe(true);
    expect(heightDescription(f,30)).toBe('高度1');expect(heightDescription(f,29)).toBe('高度0');expect(heightDescription(f,28)).toBe('高度2');
    f.structures![30]=createStructure('building',3);expect(heightDescription(f,30)).toBe('高度2');
    f.structures![30]=createStructure('gate',3);expect(heightDescription(f,30)).toBe('高度1');
    f.structures![30]!.gateState='open';expect(heightDescription(f,30)).toBe('高度0');
    f.groundHeight![30]=1;f.structures![30]=createStructure('tower',3,{top:true});expect(heightDescription(f,30)).toBe('高度3（地面1）');
  });
  it('high-ground defense grows by one per level up to two, and the parapet adds one on platforms',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');a.pos=28;b.pos=30;
    expect(heightDefense(f,b,a)).toBe(0);f.groundHeight![30]=1;expect(heightDefense(f,b,a)).toBe(1);
    f.groundHeight![30]=2;expect(heightDefense(f,b,a)).toBe(2);f.groundHeight![30]=3;expect(heightDefense(f,b,a)).toBe(2);expect(heightDefense(f,a,b)).toBe(0);
    f.groundHeight![30]=0;f.structures![30]=createStructure('wall',3,{top:true});b.elevation=1;
    expect(heightDefense(f,b,a)+structureDefense(f,b,a,true)).toBe(2);
    f.structures![30]=createStructure('tower',3,{top:true});expect(heightDefense(f,b,a)+structureDefense(f,b,a,true)).toBe(3);
    a.pos=31;f.structures![31]=createStructure('wall',3,{top:true});a.elevation=1;expect(heightDefense(f,b,a)+structureDefense(f,b,a,true)).toBe(2);
  });
  it('previews show the scaled high-ground defense in real battles',()=>{
    const f=field(),a=sceneUnit('a','ally',true),b=sceneUnit('b','enemy');a.pos=28;b.pos=31;f.groundHeight![30]=1;f.groundHeight![31]=2;
    f.deploymentZones=[{side:'ally',cells:[28]},{side:'enemy',cells:[31]}];
    const battle=new SmallBattle({rules:V11_OVERFLOW_D20,battlefield:f,combatants:[a,b],seed:'height-defense'});battle.start();battle.turnOrder=['a','b'];battle.turnIndex=0;
    const target=battle.getActionOptions('a').find(o=>o.id==='weapon')!.targets!.find(t=>t.targetId==='b')!;
    expect(target.enabled,target.reason).toBe(true);expect(target.preview?.defenseModifiers).toContain('居高 +2');
  });
  it('ranged weapons reach one cell farther per level fired downhill, at most two',()=>{
    const f=field(),a=sceneUnit('a','ally',true),b=sceneUnit('b','enemy');a.pos=0;
    const weapon=gridWeapon(a.weapon)!,range=weapon.range!;
    const shoot=(target:number)=>{b.pos=target;return weaponTargetReason({actor:a,target:b,weapon,ranged:true,distance:gridDistance(f,a.pos!,b.pos!),field:f});};
    const at=(distance:number)=>Array.from({length:f.tiles.length},(_,p)=>p).find(p=>gridDistance(f,0,p)===distance)!;
    expect(shoot(at(range))).toBeUndefined();expect(shoot(at(range+1))).toContain('超出射程');
    f.groundHeight![0]=1;expect(shoot(at(range+1))).toBeUndefined();expect(shoot(at(range+2))).toContain('+居高1');
    f.groundHeight![0]=3;expect(shoot(at(range+2))).toBeUndefined();expect(shoot(at(range+3))).toContain('+居高2');
    b.airborne=true;b.pos=at(range+1);expect(weaponTargetReason({actor:a,target:b,weapon,ranged:true,distance:gridDistance(f,a.pos!,b.pos!),field:f})).toContain('超出射程');
    b.airborne=false;const sword=gridWeapon(sceneUnit('c','ally').weapon)!;
    expect(weaponTargetReason({actor:a,target:b,weapon:sword,ranged:false,distance:2,field:f})).toContain('距离不足');
  });
  it('fords and bogs cost footing both ways unless the unit crosses water or stands on a bridge',()=>{
    const f=field(),a=sceneUnit('a','ally');a.pos=30;f.tiles[30]='shallow_water';
    const footing=(u:typeof a,terrain=standingTerrain(f,u))=>collectMods(u,{heightRules:true,terrain},standardConditionMap(),[],traitRegistry()).filter(m=>m.name==='立足不稳').map(m=>m.kind+m.value);
    expect(footing(a)).toEqual(['atk-1','def-1']);f.tiles[30]='swamp';expect(footing(a)).toEqual(['atk-1','def-1']);
    f.tiles[30]='deep_water';f.structures![30]=createStructure('bridge',3);expect(standingTerrain(f,a)).toBe('open');expect(footing(a)).toEqual([]);
    f.structures![30]=null;f.tiles[30]='shallow_water';a.traits.push('water-crossing');expect(footing(a)).toEqual([]);
    expect(collectMods(a,{terrain:'shallow_water'},standardConditionMap(),[],traitRegistry()).some(m=>m.name==='立足不稳')).toBe(false);
  });
  it('real-height hills do not break up frontage, while fords do; old maps keep the hill limit',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');a.pos=28;b.pos=30;const full=engagementWidth(a,b,true,f);
    f.tiles[28]='hill';f.groundHeight![28]=2;expect(engagementWidth(a,b,true,f)).toBe(full);
    f.tiles[28]='shallow_water';f.groundHeight![28]=0;expect(engagementWidth(a,b,true,f)).toBeLessThan(full);
    f.structures![28]=createStructure('bridge',3);expect(engagementWidth(a,b,true,f)).toBe(full);
    const old=standardField(7,9);old.tiles.fill('open');old.tiles[28]='hill';expect(engagementWidth(a,b,true,old)).toBeLessThan(full);
  });
  it('rubble shelters a ground unit from distant shots only',()=>{
    const f=field(),a=sceneUnit('a','ally'),b=sceneUnit('b','enemy');a.pos=28;b.pos=31;f.overlays={31:['rubble']};
    expect(structureDefense(f,b,a,true)).toBe(1);expect(structureDefense(f,b,a,false)).toBe(0);a.pos=30;expect(structureDefense(f,b,a,true)).toBe(0);
    const old=standardField(7,9);old.tiles.fill('open');old.layerVersion=1;old.structures=old.tiles.map(()=>null);old.overlays={31:['rubble']};a.pos=28;
    expect(structureDefense(old,b,a,true)).toBe(0);
  });
  it('validates height data and preserves tile-only saves without enabling new height rules',()=>{
    const f=field();f.groundHeight![0]=-1;expect(()=>validateField(f)).toThrow('高度');
    const old=standardField(7,9);old.tiles.fill('open');old.tiles[29]='hill';const a=sceneUnit('a','ally');a.pos=28;
    expect(movementStepCost(old,29,a,[],28)).toBe(2);expect(old.spatialRulesVersion).toBeUndefined();
  });
});
