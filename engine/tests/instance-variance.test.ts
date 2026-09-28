import { describe, expect, it } from 'vitest';
import { rollInstanceVariance, instanceMultiplier, instanceRating, instanceOffset, validateInstanceVariance, instanceVarianceLabel, INSTANCE_VARIANCE_VERSION, type InstanceVariance } from '../src/instance-variance.js';
import { bonusMultiplier, bonusRating } from '../src/enhancements.js';
import { compileItem } from '../src/items.js';
import { compileWeapon, compileArmor } from '../src/gen/equipment.js';
import { anchoredWeapon, anchoredProtection, armorTransmission, shieldProtection, shieldTransmission } from '../src/power-anchors.js';
import { diceAvg } from '../src/data/weapons.js';
import { generateUnit, prepareCombatModel, applyXp, traitRegistry, V11_OVERFLOW_D20, standardConditionMap, memberHealth, type Combatant, type GenerateInput } from '../src/index.js';
import { nominalLife, validateCombatModel } from '../src/combat-model.js';
import { XP_LEVEL_COSTS } from '../src/data/curves.js';
import { previewAttack, resolveAttack } from '../src/damage.js';
import { SeededRng } from '../src/rng.js';

const variance = (n: number): InstanceVariance => ({ version: INSTANCE_VARIANCE_VERSION, rolls: { damage:n, health:n, penetration:n, protection:n, power:n } });
const ctx = {id:'test',seed:'test',damageModel:'wounds-v2' as const};
const mean = (u: NonNullable<Combatant['weapon']>) => diceAvg(u.baseDice)*(u.damageScale??1);
const registry = traitRegistry(), conditionDefs = standardConditionMap();
function unit(seed: string, extra: Partial<GenerateInput> = {}, noVariance = false) {
  const u = generateUnit({name:'test',side:'ally',rulesVersion:'v2',damageModel:'wounds-v2',scale:'hero',level:5,weaponClass:'sword',weaponLevel:5,armorTier:1,traits:[],...extra},{seed,registry,noVariance}).unit;
  prepareCombatModel(u,V11_OVERFLOW_D20); return u;
}

describe('frozen five-point enhancement bands', () => {
  it('L1+2 lies strictly between L1+1 peak and L1+3 valley; both gaps are .2 point', () => {
    const band = (points: number) => [-2,-1,0,1,2].map(n => instanceMultiplier({damage:points},'damage',variance(n)));
    expect(band(2)).toEqual([1.08,1.09,1.1,1.11,1.12]);
    expect(Math.max(...band(1))).toBe(1.07); expect(Math.min(...band(3))).toBe(1.13);
    expect(instanceVarianceLabel(variance(1))).toContain('伤害+0.2档');
  });
  it('all signed points and both global clamps have separated monotone bands and unbiased centers', () => {
    for (let points=-10; points<=20; points++) {
      const bonuses = {damage: Math.min(10,points),power:Math.max(0,points-10)};
      const values = [-2,-1,0,1,2].map(n=>instanceMultiplier(bonuses,'damage',variance(n)));
      expect(values.reduce((a,b)=>a+b)/5).toBeCloseTo(bonusMultiplier(bonuses,'damage'),12);
      expect(values.every(n=>n>=.5 && n<=2)).toBe(true);
      if (points<20) {
        const next = {damage:Math.min(10,points+1),power:Math.max(0,points+1-10)};
        expect(Math.max(...values)).toBeLessThan(instanceMultiplier(next,'damage',variance(-2)));
      }
      if (points<=10) {
        const ratings = [-2,-1,0,1,2].map(n=>instanceRating({protection:points},'protection',variance(n)));
        expect(ratings.reduce((a,b)=>a+b)/5).toBeCloseTo(bonusRating({protection:points},'protection'),12);
        if (points<10) expect(Math.max(...ratings)).toBeLessThan(instanceRating({protection:points+1},'protection',variance(-2)));
      }
    }
    expect(instanceMultiplier({damage:10,power:10,kineticDamage:10},'damage',variance(2),'kinetic')).toBe(2);
    expect(instanceRating({protection:-10,kineticProtection:-10},'protection',variance(2),'kinetic')).toBe(-2);
  });
  it('domain-separated rolls repeat after JSON restore and do not depend on naming or axis order', () => {
    const a=rollInstanceVariance('id:123',['damage','penetration']);
    expect(a).toEqual(rollInstanceVariance('id:123',['damage','penetration']));
    expect(a.rolls).toEqual(rollInstanceVariance('id:123',['penetration','damage']).rolls);
    expect(a.rolls.damage).toBe(rollInstanceVariance('id:123',['health','damage']).rolls.damage);
    expect(instanceMultiplier({damage:2},'damage',JSON.parse(JSON.stringify(a)))).toBe(instanceMultiplier({damage:2},'damage',a));
    const counts=[0,0,0,0,0];
    for(let i=0;i<10000;i++) counts[rollInstanceVariance(`distribution:${i}`,['damage']).rolls.damage!+2]!++;
    expect(counts.every(n=>n>1700 && n<2300)).toBe(true);
    expect(()=>rollInstanceVariance('',['damage'])).toThrow();
  });
  it.each([null,[],{}, {version:'future',rolls:{}}, {version:INSTANCE_VARIANCE_VERSION,rolls:[]}, ...[3,-3,0.1,NaN,Infinity,'1'].map(roll=>({version:INSTANCE_VARIANCE_VERSION,rolls:{damage:roll}})), {version:INSTANCE_VARIANCE_VERSION,rolls:{speed:1}}].map(bad=>({bad})))('rejects corrupt frozen rolls: %j', ({bad}) => {
    expect(()=>validateInstanceVariance(bad)).toThrow(/固定浮动/);
  });
  it('old or explicitly neutral instances have exactly the old multipliers and no new marker', () => {
    expect(instanceOffset(undefined,'damage')).toBe(0);
    for(let n=-10;n<=10;n++) expect(instanceMultiplier({damage:n},'damage')).toBe(bonusMultiplier({damage:n},'damage'));
    expect(compileWeapon({mechanism:'sword',power:5},{...ctx,variance:false}).recipe?.variance).toBeUndefined();
    expect(compileWeapon({mechanism:'sword',power:5},{...ctx,noVariance:true}).recipe?.variance).toBeUndefined();
    expect(compileWeapon({mechanism:'sword',power:5},{...ctx,damageModel:undefined}).recipe?.variance).toBeUndefined();
    expect(unit('neutral',{},true).genAudit?.variance).toBeUndefined();
    validateInstanceVariance(undefined);
  });
  it('L1–10 damage survives dice quantization; all weapon bands are strictly ordered with fixed nonrandom range/load/attacks', () => {
    for(let power=1;power<=10;power++) for(const mechanism of ['sword','rifle','magic','cannon','autocannon','natural']) {
      let previous = -Infinity;
      for(let points=-10;points<=10;points++) {
        const raw = [-2,-1,0,1,2].map(n=>compileWeapon({mechanism,power,bonuses:{damage:points}},{...ctx,variance:variance(n)}));
        const projected=raw.map(w=>anchoredWeapon(w,'he','wounds-v2')!);
        const lo=mean(projected[0]!),hi=mean(projected[4]!);
        expect(lo).toBeGreaterThan(previous); previous=hi;
        if(points>-10) expect(hi).toBeGreaterThan(lo);
        expect(new Set(raw.map(w=>JSON.stringify([w.baseDice,w.range,w.load,w.attacks,w.hands]))).size).toBe(1);
      }
    }
  });
  it('armor and shield protection/absorption use frozen values, but bare zero protection stays zero', () => {
    for(let power=1;power<=10;power++) {
      let prior=-Infinity;
      for(let points=-10;points<=10;points++) {
        const values=[-2,2].map(n=>anchoredProtection({armor:compileArmor({tier:2,power,bonuses:{protection:points}},{...ctx,variance:variance(n)}),body:'human',damageModel:'wounds-v2'},'kinetic'));
        expect(values[0]).toBeGreaterThanOrEqual(prior); prior=values[1]!;
      }
    }
    const armor=(n:number)=>({armor:compileArmor({tier:2,power:5},{...ctx,variance:variance(n)}),body:'human' as const,damageModel:'wounds-v2' as const});
    expect(armorTransmission(armor(2),'kinetic',10)).toBeLessThan(armorTransmission(armor(-2),'kinetic',10));
    for(const n of [-2,2]) expect(anchoredProtection({armor:compileArmor({tier:0,power:10},{...ctx,variance:variance(n)}),body:'human'},'kinetic')).toBe(0);
    const shield=(n:number)=>{const m=compileItem({kind:'shield',power:5},{...ctx,variance:variance(n)});if(m.kind!=='shield')throw Error();return {shield:m.value,status:'ready' as const};};
    expect(shieldProtection(shield(2),'kinetic')).toBeGreaterThan(shieldProtection(shield(-2),'kinetic'));
    expect(shieldTransmission(shield(2),'kinetic',10)).toBeLessThan(shieldTransmission(shield(-2),'kinetic',10));
    expect(shieldTransmission(shield(2),'kinetic',10,true)).toBe(1);
  });
  it('unit growth preserves roll identity, no auto-heal, no extra personnel; record validation catches corrupt unit/equipment rolls', () => {
    for(const scale of ['hero','company'] as const) {
      const u=unit('growth',{level:1,scale,...(scale==='company'?{hpMax:20}:{})}), rolls=structuredClone(u.genAudit!.variance),weapon=structuredClone(u.weapon);
      const hp=u.hp;
      for(let level=2;level<=10;level++) {
        applyXp(u,XP_LEVEL_COSTS[level-2]!,registry);
        expect(u.genAudit!.variance).toEqual(rolls);expect(u.weapon).toEqual(weapon);expect(u.hp).toBe(hp);
        expect(scale==='hero'?u.base.hpMax:u.formation!.memberHp).toBe(nominalLife(u));
        if(scale==='company')expect(u.formation!.capacity).toBe(20);
      }
      validateCombatModel(JSON.parse(JSON.stringify(u)));
      u.genAudit!.variance={...variance(0),rolls:{health:99}};expect(()=>validateCombatModel(u)).toThrow(/固定浮动/);
    }
    const custom=unit('custom',{hpMax:1500,hp:1000});expect(custom.base.hpMax).toBe(1500);expect(custom.hp).toBe(1000);
  });
  it.each(['weapon','magic'] as const)('%s preview is immutable, repeatable and agrees with seeded combat sample', type => {
    const attacker=unit('attacker'),defender=unit('defender',{side:'enemy',armorTier:1,level:6,hpMax:3000});
    const opts={attacker,defender,rules:V11_OVERFLOW_D20,conditionDefs,traitRegistry:registry,ranged:type==='magic',...(type==='magic'?{abilityDamage:{baseDice:'8d6',damageScale:1,channel:'arcane' as const,penetration:11,delivery:'magic' as const}}:{})};
    const before=JSON.stringify([attacker,defender]),preview=previewAttack(opts);
    expect(previewAttack(opts)).toEqual(preview); expect(JSON.stringify([attacker,defender])).toBe(before);
    let total=0, squares=0;
    for(let i=0;i<2048;i++) {const d=structuredClone(defender);resolveAttack({...opts,defender:d,rng:new SeededRng('check:'+i)});const loss=memberHealth(defender)-memberHealth(d);total+=loss;squares+=loss*loss;}
    const avg=total/2048,se=Math.sqrt(Math.max(0,squares/2048-avg*avg)/2048);
    expect(Math.abs(avg-preview.expectedDamage)).toBeLessThan(5*se+.1);
    expect(JSON.stringify([attacker,defender])).toBe(before);
  });
});
