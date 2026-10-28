import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, skillMechanismId, V39_OVERFLOW_D20, V40_OVERFLOW_D20, V40_OVERFLOW_TW,
  prepareCondition, conditionChance, applyDispel, dispelCandidates, abilityCost, skillAttack, previewAttack, compileItem, gearItem, syncGearAbilities,
  type Combatant, type GenerateInput, type RulePack } from '../src/index.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';

const registry = traitRegistry();
function fixture(modifier: string, L: number, bonuses?: {accuracy?:number;resource?:number}, rules: RulePack = V40_OVERFLOW_D20, category: 'buff'|'debuff'|'magic-single' = 'buff') {
  const id = skillMechanismId({category,modifiers:[modifier],area:false});
  const make = (name:string,side:'ally'|'enemy',extra:Partial<GenerateInput>={})=>generateUnit({name,side,rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',body:'human',scale:'hero',level:5,weaponClass:'sword',armorTier:0,traits:[],...extra},{seed:name,noVariance:true,registry,skillModel:rules.skillModel}).unit;
  const a=make('a','ally',{abilityBlueprints:[{id,level:L,bonuses}]}),d=make('d','enemy');
  const field=standardField();field.tiles.fill('open');
  const battle=new SmallBattle({combatants:[a,d],rules,battlefield:field,seed:'progression',traitRegistry:registry});a.pos=31;d.pos=24;
  return {a,d,ability:a.abilities[0]!,battle,field};
}
describe('V40 skill progression',()=>{
  it('every formerly flat primitive has a real adjacent-level benefit, including independent effect levels',()=>{
    for(const [category,modifier] of [['buff','cleanse'],['debuff','dispel'],['buff','restore'],['debuff','drain'],['buff','dash'],['buff','blink'],['buff','withdraw'],['debuff','push'],['debuff','pull'],['buff','trait-inorganic']] as const) {
      let prior='';
      for(let L=1;L<=10;L++){
        const {a,ability}=fixture(modifier,L,undefined,V40_OVERFLOW_D20,category);
        const signature=JSON.stringify({effects:ability.effects,range:ability.range});
        expect(signature,`${modifier} L${L}`).not.toBe(prior);prior=signature;
        expect(()=>combatantFromUnknown(structuredClone(a))).not.toThrow();
        if(modifier==='restore')expect(abilityCost(a,ability)!.amount).toBeGreaterThanOrEqual(ability.effects.find(e=>e.op==='resource')!.op==='resource'?(ability.effects.find(e=>e.op==='resource') as {amount:number}).amount:0);
      }
    }
  });
  it('higher dispel grades actually remove another effect; fractional recovery is not rounded away',()=>{
    const {d,ability}=fixture('cleanse',3);d.conditions=['stunned','silenced','poisoned','blinded'].map(id=>({id,dur:3}));
    const effect=ability.effects.find(e=>e.op==='dispel')!;if(effect.op!=='dispel')throw Error('fixture');
    applyDispel(d,dispelCandidates(d,effect));expect(d.conditions).toHaveLength(1);
    const x=fixture('restore',2,{resource:1}).ability.effects.find(e=>e.op==='resource')!;
    expect(x.op==='resource'&&x.amount).toBeCloseTo(2+1/3+.2);
  });
  it('accuracy advances every point in attack and control probabilities; execution interpolates the boundary',()=>{
    let lastHit=0,lastControl=0;
    for(let p=0;p<=10;p++) {
      const {a,d,ability,field}=fixture('arcane',4,{accuracy:p},V40_OVERFLOW_D20,'magic-single');
      const effect=ability.effects.find(e=>e.op==='damage')!;if(effect.op!=='damage')throw Error('fixture');
      const hit=previewAttack({attacker:a,defender:d,rules:V40_OVERFLOW_D20,conditionDefs:new Map(),traitRegistry:registry,...skillAttack({mode:'small',units:[a,d],battlefield:field,fieldTags:[]},a,d,ability,effect,V40_OVERFLOW_D20)}).hitChance;
      const c=fixture('stun',4,{accuracy:p},V40_OVERFLOW_D20,'debuff'),control=c.ability.effects.find(e=>e.op==='condition')!;if(control.op!=='condition')throw Error('fixture');
      const probability=conditionChance(c.d,control);if(p){expect(hit).toBeGreaterThan(lastHit);expect(probability).toBeGreaterThan(lastControl);}lastHit=hit;lastControl=probability;
    }
    const {a,d}=fixture('stun',4,undefined,V40_OVERFLOW_D20,'debuff');
    const effect={op:'condition' as const,conditionId:'poisoned',dur:1,saveDC:12.5,continuousSave:true as const};
    const rolls=Array.from({length:18},(_,i)=>i+2).filter(roll=>{
      const low=prepareCondition(a,d,effect,{seed:'low',d:()=>roll,next:()=>0});
      const high=prepareCondition(a,d,effect,{seed:'high',d:()=>roll,next:()=>.999});
      return !!low.condition!==!!high.condition;
    });
    expect(rolls.length).toBe(1);
  });
  it('V39 skills and frozen gear retain their effects; V40 snapshots round-trip in both modes',()=>{
    const old=fixture('dash',5,undefined,V39_OVERFLOW_D20),before=structuredClone(old.a.abilities);
    const restored=SmallBattle.fromSnapshot(old.battle.toSnapshot(),{traitRegistry:registry});
    expect(restored.rules.id).toBe(V39_OVERFLOW_D20.id);expect(restored.combatants[0]!.abilities).toEqual(before);
    const fresh=fixture('dash',5);const item=compileItem({kind:'item',form:'charged',power:5,active:'generic:buff:heal'},{id:'frozen',seed:'frozen'});if(item.kind!=='item')throw Error('fixture');
    fresh.a.gear=[gearItem('frozen','frozen',item.value)];syncGearAbilities(fresh.a);const frozen=structuredClone(fresh.a.gear);
    const small=new SmallBattle({combatants:[fresh.a,fresh.d],rules:V40_OVERFLOW_D20,seed:'small'});
    expect(SmallBattle.fromSnapshot(small.toSnapshot(),{traitRegistry:registry}).combatants[0]!.gear).toEqual(frozen);
    const company=generateUnit({name:'company',side:'ally',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',scale:'company',level:5,hpMax:50,traits:[],abilityBlueprints:[{id:'generic:buff:cleanse',level:8}]},{seed:'company',noVariance:true,registry,skillModel:V40_OVERFLOW_TW.skillModel}).unit;
    const mass=new MassBattle({combatants:[company],rules:V40_OVERFLOW_TW,seed:'mass'});
    expect(MassBattle.fromSnapshot(mass.toSnapshot(),{traitRegistry:registry}).combatants[0]!.abilities).toEqual(company.abilities);
  });
  it('persists fractional control DCs and expanded dispel payloads in zones',()=>{
    const {a,d}=fixture('cleanse',8);
    for(const [category,modifiers] of [['buff',['zone-smoke','cleanse']],['debuff',['zone-trap','stun']]] as const) {
      const u=generateUnit({name:'zone',side:'ally',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',scale:'hero',level:5,traits:[],abilityBlueprints:[{id:skillMechanismId({category,modifiers:[...modifiers],area:false}),level:8,bonuses:{accuracy:1}}]},{seed:'zone',noVariance:true,registry,skillModel:V40_OVERFLOW_D20.skillModel}).unit;
      const battle=new SmallBattle({combatants:[u,structuredClone(d)],rules:V40_OVERFLOW_D20,seed:'zone'});
      expect(()=>combatantFromUnknown(structuredClone(u))).not.toThrow();
      expect(SmallBattle.fromSnapshot(battle.toSnapshot()).combatants[0]!.abilities).toEqual(u.abilities);
    }
    expect(a.abilities[0]!.effects[0]).toMatchObject({op:'dispel',count:8});
  });
  it('push utility grade opens a farther legal target',()=>{
    const reachable=(L:number)=>{
      const {a,d,ability,battle}=fixture('push',L,undefined,V40_OVERFLOW_D20,'debuff');delete a.pos;delete d.pos;battle.start();a.pos=0;d.pos=42;battle.turnOrder=[a.id,d.id];battle.turnIndex=0;
      return battle.getActionOptions(a.id).find(o=>o.id===ability.id)!.targets!.find(t=>t.targetId===d.id)!;
    };
    expect(reachable(3).enabled).toBe(false);const higher=reachable(4);expect(higher.enabled,JSON.stringify(higher)).toBe(true);
  });
});
