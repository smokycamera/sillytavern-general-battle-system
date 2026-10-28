import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, V39_OVERFLOW_D20, V40_OVERFLOW_D20, V40_OVERFLOW_TW, previewAttack, resolveAttack, SeededRng, standardConditionMap, traitRegistry, type AttackOpts, type RulePack } from '../src/index.js';
import { exactSequenceMoments } from '../src/sequence-preview.js';
import { grantBarrier } from '../src/barrier.js';
const registry=traitRegistry(),conditionDefs=standardConditionMap();
function options(weapon:string,points:number,rules:RulePack=V40_OVERFLOW_D20):Omit<AttackOpts,'rng'>{
  const units=(['ally','enemy'] as const).map(side=>generateUnit({name:side,side,rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',scale:'hero',body:'human',level:1,weaponClass:side==='ally'?weapon:'sword',weaponLevel:1,weaponBonuses:side==='ally'?{damage:points}:undefined,armorTier:side==='ally'?2:0,armorLevel:1,traits:[]},{seed:side,noVariance:true,registry}).unit);
  new SmallBattle({combatants:units,rules,seed:'prepare',traitRegistry:registry});units[0]!.pos=38;units[1]!.pos=24;
  return {attacker:units[0]!,defender:units[1]!,ranged:true,distance:2,rules,conditionDefs,traitRegistry:registry};
}
describe('V40 exact multishot preview',()=>{
  it('convolves independent packets before clipping to remaining life',()=>{
    const p=exactSequenceMoments('1d2',undefined,1,1,0,2,2,3)!;
    expect(p.mean).toBeCloseTo(2.75);expect(p.second).toBeCloseTo(7.75);expect(p.positive).toBeCloseTo(1);
  });
  it('fixes the reported +7 to +8 inversion without changing historical preview rules',()=>{
    for(const weapon of ['rifle','energy'])for(const rules of [V40_OVERFLOW_D20,V40_OVERFLOW_TW]){
      let previous=-1;
      for(let p=-10;p<=10;p++){const result=previewAttack(options(weapon,p,rules));expect(result.exact).toBe(true);expect(result.expectedDamage).toBeGreaterThanOrEqual(previous-1e-10);previous=result.expectedDamage;}
    }
    const legacy=previewAttack(options('rifle',7,V39_OVERFLOW_D20));expect(legacy.exact).toBe(false);expect(legacy.expectedDamage).toBeCloseTo(7.0833333333);
  });
  it('agrees with independent actual resolutions and leaves inputs unchanged',()=>{
    const o=options('rifle',8),before=structuredClone(o),p=previewAttack(o),rng=new SeededRng('independent-preview-check'),n=12000;
    let sum=0;
    for(let i=0;i<n;i++){const defender=structuredClone(o.defender);for(let shot=0;shot<2&&defender.hp>0;shot++)resolveAttack({...o,defender,rng});sum+=o.defender.hp-defender.hp;}
    expect(Math.abs(sum/n-p.expectedDamage)).toBeLessThan(.2);expect(o).toEqual(before);
    expect(previewAttack({...o,defender:{...o.defender,hp:3}}).expectedDamage).toBeLessThanOrEqual(3);
  });
  it('keeps coupled complex-defense comparisons monotone when fractional draws appear or disappear',()=>{
    for(const rules of [V40_OVERFLOW_D20,V40_OVERFLOW_TW])for(const protectedTarget of [false,true])for(const stat of ['damage','accuracy'] as const){
      let previous=-1;
      for(let point=0;point<=10;point++){
        const o=options('rifle',0,rules);o.attacker.weapon!.recipe!.bonuses={[stat]:point};
        if(protectedTarget)grantBarrier(o.defender,4,3,'source',1,'layer');
        // Cover clipped exact sequences and stateful sampled sequences separately.
        if(!protectedTarget)o.defender.base.hpMax=o.defender.hp=5;
        const before=structuredClone(o),p=previewAttack(o);
        expect(p.exact).toBe(!protectedTarget);
        expect(p.expectedDamage).toBeGreaterThanOrEqual(previous-1e-10);expect(o).toEqual(before);previous=p.expectedDamage;
      }
    }
  });
});
