import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareTraitModel, prepareTraitLevelModel, regenerationAmount, settleRegeneration,
  V29_OVERFLOW_D20, V29_OVERFLOW_TW, V30_OVERFLOW_D20, V30_OVERFLOW_TW, SmallBattle, MassBattle, standardField,
  healingGradeMultiplier, type Combatant, type GenerateInput, type RulePack } from '../src/index.js';

function unit(patch:Partial<GenerateInput>={},rules:RulePack=V30_OVERFLOW_D20):Combatant {
  const u=generateUnit({name:'a',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',
    level:5,weaponClass:'sword',armorTier:0,traits:['regen'],traitLevels:{regen:5},...patch},{seed:patch.name??'a',noVariance:true}).unit;
  u.id=patch.name??'a';prepareCombatModel(u,rules);prepareTraitModel(u,rules);prepareTraitLevelModel(u,rules);
  if(u.scale==='hero')u.hp=1;else u.formation!.health=[{hp:1,count:u.hp}];
  return u;
}
const tick=(u:Combatant)=>settleRegeneration(u,regenerationAmount(u));

describe('V30 regeneration life floor',()=>{
  it.each([['human',10.56],['large',20.64],['giant',60.96],['vehicle',60.96]] as const)
    ('L5 %s regenerates at its own life scale without a second 1.5 multiplier', (body,expected)=>{
      const u=unit({body});expect(regenerationAmount(u)).toBeCloseTo(expected);
      const old=unit({body},V29_OVERFLOW_D20);expect(regenerationAmount(old)).toBeCloseTo(6.9);
    });
  it('formation floors keep the existing per-50 grouping rather than multiplying by every member',()=>{
    for(const [body,expected] of [['human',21.12],['large',41.28],['giant',121.92]] as const){
      const u=unit({body,scale:'company',hpMax:100,hp:100});expect(regenerationAmount(u)).toBeCloseTo(expected);
      const one=unit({body,scale:'company',hpMax:1,hp:1});expect(regenerationAmount(one)).toBeCloseTo(expected/2);
    }
  });
  it('every trait grade advances and keeps old fixed restoration as a floor, including high-grade cross-level healing',()=>{
    let previous=0;
    for(let level=1;level<=10;level++){
      const u=unit({level:10,traitLevels:{regen:level}}),old=unit({level:10,traitLevels:{regen:level}},V29_OVERFLOW_D20);
      expect(regenerationAmount(u)).toBeGreaterThan(previous);expect(regenerationAmount(u)).toBeGreaterThanOrEqual(regenerationAmount(old));
      previous=regenerationAmount(u);
    }
    const low=unit({hpMax:6,traitLevels:{regen:10}});expect(regenerationAmount(low)).toBe(5);
    const stronger=unit({level:1,hpMax:1000,traitLevels:{regen:10}});
    expect(regenerationAmount(stronger)).toBeCloseTo(Math.min(999,140*healingGradeMultiplier(10,1,stronger.healingModel)));
  });
  it('carries fractional healing exactly, preserves paused remainder, ignores medic and clears after full recovery or losing regen',()=>{
    const u=unit({traits:['regen','medic'],traitLevels:{regen:5,medic:10}});
    expect(tick(u)).toBe(10);expect(u.regenerationRemainder).toBe(5600);
    u.conditions.push({id:'stunned',dur:1});expect(tick(u)).toBe(0);expect(u.regenerationRemainder).toBe(5600);
    u.conditions=[];expect(tick(u)).toBe(11);expect(u.regenerationRemainder).toBe(1200);
    u.hp=u.base.hpMax-1;expect(tick(u)).toBe(1);expect(u.regenerationRemainder).toBe(0);
    u.hp=1;u.regenerationRemainder=3000;u.traits=[];expect(tick(u)).toBe(0);expect(u.regenerationRemainder).toBe(0);
  });
  it.each(['small','mass'] as const)('%s new snapshots retain the floor and V29 snapshots retain fixed restoration',mode=>{
    for(const modern of [false,true]){
      const rules=mode==='small'?(modern?V30_OVERFLOW_D20:V29_OVERFLOW_D20):(modern?V30_OVERFLOW_TW:V29_OVERFLOW_TW);
      const scale=mode==='mass'?'company':'hero',a=unit({scale,hpMax:scale==='company'?100:undefined},rules),d=unit({name:'d',side:'enemy',scale},rules);
      const b=mode==='small'?new SmallBattle({combatants:[a,d],rules,battlefield:standardField(),seed:'regen-save'}):new MassBattle({combatants:[a,d],rules,seed:'regen-save'});
      b.start();tick(a);const snapshot=b.toSnapshot();
      const loaded=mode==='small'?SmallBattle.fromSnapshot(structuredClone(snapshot)):MassBattle.fromSnapshot(structuredClone(snapshot));
      expect(loaded.toSnapshot()).toEqual(snapshot);expect(regenerationAmount(loaded.byId('a'))).toBeCloseTo(regenerationAmount(a));
      expect(loaded.byId('a').regenerationModel).toBe(modern?'life-floor-v1':undefined);
    }
  });
});
