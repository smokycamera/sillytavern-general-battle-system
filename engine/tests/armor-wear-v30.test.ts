import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, prepareResourceModel, prepareTraitModel, prepareTraitLevelModel,
  V29_OVERFLOW_D20, V29_OVERFLOW_TW, V30_OVERFLOW_D20, V30_OVERFLOW_TW, SmallBattle, MassBattle, standardField,
  collectMods, resolveStack, standardConditionMap, traitRegistry, movementPoints, fatigueAfter, armorWear,
  equipmentLoadLabel, type Combatant, type GenerateInput, type RulePack } from '../src/index.js';
import { loadInitiativePenalty } from '../src/equipment-load.js';
import { buildUnit, newUnitDraft } from '../../panel/src/unit-builder.js';
import { buildEncounter } from '../../panel/src/game-encounter.js';

const registry=traitRegistry(),conditions=standardConditionMap();
function unit(patch:Partial<GenerateInput>={},rules:RulePack=V30_OVERFLOW_D20):Combatant {
  const u=generateUnit({name:'a',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',
    level:5,weaponClass:'sword',weaponLevel:5,armorTier:0,traits:[],...patch},{seed:patch.name??'a',registry,noVariance:true}).unit;
  u.id=patch.name??'a';
  prepareCombatModel(u,rules);prepareArmsModel(u,rules);prepareResourceModel(u,rules);prepareTraitModel(u,rules);prepareTraitLevelModel(u,rules);
  return u;
}
const initiative=(u:Combatant)=>resolveStack(collectMods(u,{},conditions,[],registry),'spd',{}).flatTotal;

describe('V30 worn armor and fractional movement',()=>{
  it.each([[0,3,0,.5],[1,3,0,.5],[2,2.85,-.5,.55],[3,2.55,-1,.63],[4,2.25,-2,.75]] as const)
    ('tier %s uses its approved movement, initiative and activity fatigue', (tier,movement,spd,fatigue)=>{
      const u=unit({armorTier:tier});expect(movementPoints(u)).toBeCloseTo(movement);expect(initiative(u)).toBe(spd);
      // Isolate wearing from level endurance while retaining the actual equipped armor.
      u.level=1;expect(fatigueAfter(u,1)).toBe(fatigue);
      u.fatigue=4;expect(fatigueAfter(u,0,true)).toBe(2);expect(fatigueAfter(u,0,false)).toBe(3);
      if(tier>=2)expect(equipmentLoadLabel(u)).toContain('穿戴：移动×');
    });
  it('multiplies severe overload and adds initiative penalties without a one-point floor or changing equipment',()=>{
    const u=unit({level:1,armorTier:4}),equipment=JSON.stringify([u.weapon,u.armor]);
    expect(movementPoints(u)).toBeCloseTo(.486111111111);
    expect(loadInitiativePenalty(u)).toBeCloseTo(10);expect(initiative(u)).toBeCloseTo(-12);
    u.armor=undefined;expect(movementPoints(u)).toBe(3);expect(initiative(u)).toBe(0);
    const original=JSON.parse(equipment);u.armor=original[1];
    expect(JSON.stringify([u.weapon,u.armor])).toBe(equipment);
    expect(movementPoints(u)).toBeCloseTo(.486111111111);
  });
  it.each(['vehicle','natural'] as const)('%s keeps capacity penalties without human armor wearing restrictions',kind=>{
    const u=unit({level:1,armorTier:4,...(kind==='vehicle'?{body:'vehicle'}:{traits:['natural-armor']})});
    expect(armorWear(u)).toEqual({movement:1,initiative:0,fatigue:1});expect(movementPoints(u)).toBe(3);
    expect(initiative(u)).toBe(0);expect(fatigueAfter(u,1)).toBe(.5);
  });
  it.each(['small','mass'] as const)('%s saves V30 and keeps V29 snapshots and physical gear frozen',mode=>{
    for(const modern of [false,true]){
      const rules=mode==='small'?(modern?V30_OVERFLOW_D20:V29_OVERFLOW_D20):(modern?V30_OVERFLOW_TW:V29_OVERFLOW_TW);
      const scale=mode==='mass'?'company':'hero';
      const a=unit({scale,armorTier:4},rules),d=unit({scale,name:'d',side:'enemy',armorTier:4},rules),gear=JSON.stringify([a.weapon,a.armor]);
      const b=mode==='small'?new SmallBattle({combatants:[a,d],rules,battlefield:standardField(),seed:'armor'}):new MassBattle({combatants:[a,d],rules,seed:'armor'});
      b.start();const snap=b.toSnapshot(),loaded=mode==='small'?SmallBattle.fromSnapshot(structuredClone(snap)):MassBattle.fromSnapshot(structuredClone(snap));
      expect(loaded.toSnapshot()).toEqual(snap);expect(movementPoints(loaded.byId('a'))).toBe(modern?2.25:3);
      expect(JSON.stringify([a.weapon,a.armor])).toBe(gear);
    }
  });
  it.each(['swamp','rough'] as const)('sub-one armor movement accumulates across saves before entering %s at connected height 2',terrain=>{
    const a=unit({level:1,armorTier:4}),d=unit({name:'d',side:'enemy'}),field=standardField();field.tiles.fill('open');
    field.layerVersion=1;field.structures=field.tiles.map(()=>null);field.spatialRulesVersion=2;field.groundHeight=field.tiles.map(()=>0);
    field.movementCostModel='minimum-step-v1';field.tiles[24]=terrain;field.groundHeight[24]=2;field.heightTransitions=[{from:31,to:24,kind:'stairs'}];
    let b=new SmallBattle({combatants:[a,d],rules:V30_OVERFLOW_D20,battlefield:field,seed:'fractional-armor'});b.start();
    b.turnOrder=['a','d'];b.turnIndex=0;a.pos=31;d.pos=3;
    expect(b.pathPreview('a',24).path).toBeUndefined();b.endTurn();b.endTurn();
    expect(b.pathPreview('a',24).path).toBeUndefined();b=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    b.endTurn();b.endTurn();expect(b.pathPreview('a',24).path?.cost).toBe(1);
    b.moveTo('a',24);expect(b.byId('a').pos).toBe(24);expect(b.movementLeft('a')).toBeGreaterThan(0);
    expect(b.movementLeft('a')).toBeLessThan(1);
  });
  it('new UI units and both encounter modes select current wear without changing incoming archived units',()=>{
    const draft=newUnitDraft();draft.name='builder';expect(buildUnit(draft,registry,'builder').armorWearModel).toBe('wear-v2');
    for(const mode of ['small','mass'] as const){
      const roster=[unit({armorTier:4},V29_OVERFLOW_D20),unit({name:'d',side:'enemy'},V29_OVERFLOW_D20)],original=JSON.stringify(roster);
      const b=buildEncounter({roster,setup:{mode,field:'plains',lighting:'day',mapLayout:'standard',objectiveMode:'annihilation',siegeAttacker:'ally'},
        nonLethal:false,seed:'ui-current',registry,summonUnit:()=>null});
      expect(b.rules.armorWearModel).toBe('wear-v2');expect(b.byId('a').armorWearModel).toBe('wear-v2');expect(JSON.stringify(roster)).toBe(original);
    }
  });
});
