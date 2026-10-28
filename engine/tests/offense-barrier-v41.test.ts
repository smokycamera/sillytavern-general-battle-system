import { describe, it, expect } from 'vitest';
import { generateUnit, compileItem, gearItem, SmallBattle, MassBattle, standardField, traitRegistry, standardConditionMap,
  V40_OVERFLOW_D20, V41_OVERFLOW_D20, V41_OVERFLOW_TW, previewAttack, resolveAttack, SeededRng,
  grantBarrier, absorbBarrier, barrierAmount, decayBarrier, validateBarrier, itemSpecText, validateItemValue, skillAttack, skillDefinitionId, prepareArmsModel, type Combatant, type RulePack } from '../src/index.js';
import { mergeDamageFactors } from '../src/damage-policy.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';
import { parseItemSpecification, itemSpecificationText } from '../../panel/src/item-spec.js';
import { parseProtocol } from '../../panel/src/protocol.js';
import { itemPassiveSummary, overshadowedGear } from '../../panel/src/item-description.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
function unit(id = 'a', patch: Record<string, unknown> = {}): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', level: 4, hpMax: 1000,
    rulesVersion: 'v2', damageModel: 'wounds-v2', numericModel: 'graded-v1', loadModel: 'capacity-v2',
    weaponClass: 'greatsword', weaponLevel: 4, armorTier: 0, traits: [], ...patch }, { seed: id, noVariance: true, registry, skillModel: 'skills-v5' }).unit;
  u.id = id; return u;
}
function wearable(id: string, power: number, barrierPower = power) {
  const m = compileItem({kind:'item',form:'worn',power,barrierPower},{id,seed:id});
  if (m.kind !== 'item') throw Error('fixture'); return gearItem(id,id,m.value);
}
function options(rules: RulePack = V41_OVERFLOW_D20, weapon = 'greatsword') {
  const a=unit('a',{weaponClass:weapon, weaponBonuses:{damage:4}, bonuses:{damage:3}}),d=unit('d');
  const m=compileItem({kind:'item',form:'worn',power:4,bonuses:{damage:10}},{id:'ring',seed:'ring'});
  if(m.kind!=='item')throw Error('fixture');a.gear=[gearItem('ring','ring',m.value)];
  new SmallBattle({combatants:[a,d],rules,seed:'test',traitRegistry:registry});
  return {attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,distance:1};
}
const fixed = (critical=false) => ({seed:'fixed', next:()=>critical?.999:.8,d:(s:number)=>s===20?(critical?20:18):Math.ceil(s/2)});

describe('V41 damage policy and equipment entry barriers',()=>{
  it('adds only positive source increments and retains penalties',()=>{
    expect(mergeDamageFactors([1.26,1.15,1.5])).toBeCloseTo(1.91);
    expect(mergeDamageFactors([1.26,1.15,.8])).toBeCloseTo(1.41*.8);
    expect(mergeDamageFactors([2,2,2,2])).toBe(5);
    expect(mergeDamageFactors([2,0])).toBe(0);
    const old=options(V40_OVERFLOW_D20),next=options();
    const x=resolveAttack({...old,rng:fixed()}),y=resolveAttack({...next,rng:fixed()});
    expect(y.hit).toBe(true);expect(y.finalDamage).toBeLessThan(x.finalDamage);
    expect(y.penetration).toBe(x.penetration);expect(y.penetrationFactor).toBe(x.penetrationFactor);
    expect(next.attacker.weapon).toEqual(old.attacker.weapon);
    expect(next.attacker.gear).toEqual(old.attacker.gear);
  });
  it('scales critical budgets, preserves ordinary hits and never bypasses protection',()=>{
    for(const rules of [V41_OVERFLOW_D20]){
      const o=options(rules);o.attacker.bonuses=undefined;o.attacker.gear=[];o.attacker.weapon!.recipe!.bonuses=undefined;
      const plain=resolveAttack({...o,defender:structuredClone(o.defender),rng:fixed()});
      const crit=resolveAttack({...o,defender:structuredClone(o.defender),rng:fixed(true)});
      expect(crit.crit).toBe(true);expect(crit.finalDamage/plain.finalDamage).toBeCloseTo(1.5,1);
      const legacy=resolveAttack({...o,rules:V40_OVERFLOW_D20,defender:structuredClone(o.defender),rng:fixed(true)});
      expect(crit.finalDamage/legacy.finalDamage).toBeCloseTo(.75,1);
    }
    const o=options(V41_OVERFLOW_TW,'dagger');o.defender.conditions.push({id:'stunned',dur:2});
    const crit=resolveAttack({...o,defender:structuredClone(o.defender),rng:{...fixed(),next:()=>.01}});
    const legacy=resolveAttack({...o,rules:{...V41_OVERFLOW_TW,criticalDamageScale:1},defender:structuredClone(o.defender),rng:{...fixed(),next:()=>.01}});
    expect(crit.crit).toBe(true);expect(crit.finalDamage/legacy.finalDamage).toBeCloseTo(.75,1);
  });
  it('keeps single-hit, multishot and additional-channel previews aligned with actual damage',()=>{
    for(const rules of [V41_OVERFLOW_D20,V41_OVERFLOW_TW])for(const weapon of ['greatsword','rifle']){
      const o=options(rules,weapon);o.attacker.bonuses={damage:3,thermalDamage:4};
      const before=structuredClone(o),p=previewAttack(o),rng=new SeededRng('v41-preview');let sum=0;
      for(let i=0;i<1600;i++){const d=structuredClone(o.defender);for(let shot=0;shot<(o.attacker.weapon!.attacks??1)&&d.hp>0;shot++)sum+=resolveAttack({...o,defender:d,rng}).finalDamage;}
      expect(Math.abs(sum/1600-p.expectedDamage)).toBeLessThan(Math.max(1.6,p.expectedDamage*.08));
      expect(o).toEqual(before);expect(p.additionalChannels?.length).toBe(1);
    }
  });
  it('parses canonical, fullwidth and unicode signs without changing grades or frozen payloads',()=>{
    const texts=['佩戴L4+屏障L6+夜战专精L3+4防御','佩戴Ｌ４＋屏障Ｌ６＋夜战专精Ｌ３＋４防御','佩戴l4+屏障l6+夜战专精l3+4防御'];
    const specs=texts.map(t=>parseItemSpecification(t));expect(specs[1]).toEqual(specs[0]);expect(specs[2]).toEqual(specs[0]);
    const spec=specs[0]!;if(spec.kind!=='item')throw Error('fixture');
    const m=compileItem(spec,{id:'i',seed:'i'});if(m.kind!=='item')throw Error('fixture');
    expect(m.value.passive!.barrier).toEqual({power:6,amount:62});
    expect(parseItemSpecification(itemSpecText(m.value.recipe))).toEqual(spec);
    expect(itemSpecificationText(spec)).toContain('佩戴L4+屏障L6');
    expect(itemPassiveSummary(m.value.passive!)).toContain('开战屏障62点');validateItemValue(m.value);
    const bad=structuredClone(m.value);bad.passive!.barrier!.power=5;expect(()=>validateItemValue(bad)).toThrow();
    expect(()=>parseItemSpecification('佩戴L4+屏障L4+屏障L5')).toThrow();
    expect(parseItemSpecification('佩戴Ｌ４−３动能防护')).toMatchObject({bonuses:{kineticProtection:-3}});
    expect(parseItemSpecification('护符﹕佩戴Ｌ４﹢屏障Ｌ４–３防御')).toMatchObject({barrierPower:4,bonuses:{defense:-3}});
    const ungraded=parseItemSpecification('佩戴L4+屏障L4+不屈');
    if(ungraded.kind!=='item')throw Error('fixture');
    const frozen=compileItem(ungraded,{id:'ungraded',seed:'ungraded'});if(frozen.kind!=='item')throw Error('fixture');
    expect(parseItemSpecification(itemSpecText(frozen.value.recipe))).toEqual(ungraded);
    const parsed=parseProtocol('<tb><add item="护符" spec="佩戴Ｌ４＋屏障Ｌ４"/></tb>');
    expect(parsed.events).toHaveLength(1);
  });
  it('grants the strongest wearable once, coexists with active layers, lasts through long battles and persists after break/load',()=>{
    for(const mass of [false,true]){
      const a=unit(),d=unit('d');a.gear=[wearable('weak',2),wearable('strong',4)];
      const rules=mass?V41_OVERFLOW_TW:V41_OVERFLOW_D20;
      const b=mass?new MassBattle({combatants:[a,d],rules,seed:'entry',traitRegistry:registry,formationSlots:3}):new SmallBattle({combatants:[a,d],rules,seed:'entry',traitRegistry:registry,battlefield:standardField()});
      b.start();expect(barrierAmount(a)).toBe(36);expect(overshadowedGear(a,'weak')).toContain('开战屏障');
      grantBarrier(a,10,99,'long-caster',4,'long-active');absorbBarrier(a,5);
      expect(a.barrier!.grants!.find(g=>g.battleLong)!.remaining).toBe(36);
      for(let i=0;i<120;i++)decayBarrier(a);expect(barrierAmount(a)).toBe(36);
      grantBarrier(a,10,1,'caster',4,'active');expect(barrierAmount(a)).toBe(46);decayBarrier(a);expect(barrierAmount(a)).toBe(36);
      absorbBarrier(a,20);expect(barrierAmount(a)).toBe(16);validateBarrier(a.barrier);
      const snap=JSON.parse(JSON.stringify(b.toSnapshot()));
      const restored=mass?MassBattle.fromSnapshot(snap,{traitRegistry:registry}):SmallBattle.fromSnapshot(snap,{traitRegistry:registry});
      expect(barrierAmount(restored.combatants[0]!)).toBe(16);
      absorbBarrier(restored.combatants[0]!,1000);restored.combatants[0]!.gear=[wearable('new',10)];
      const second=mass?MassBattle.fromSnapshot(restored.toSnapshot(),{traitRegistry:registry}):SmallBattle.fromSnapshot(restored.toSnapshot(),{traitRegistry:registry});
      expect(second.combatants[0]!.barrier).toBeUndefined();expect(second.combatants[0]!.wornBarrierUsed).toBe(true);
      expect(combatantFromUnknown(JSON.parse(JSON.stringify(second.combatants[0]))).wornBarrierUsed).toBe(true);
      b.start();expect(barrierAmount(a)).toBe(16);
    }
  });
  it('retains old rules, consumes empty entry and gives a shared single capacity to formations',()=>{
    const a=unit(),d=unit('d');a.gear=[wearable('i',4)];const old=new SmallBattle({combatants:[a,d],rules:V40_OVERFLOW_D20,seed:'old'});old.start();expect(a.barrier).toBeUndefined();
    const fresh=new SmallBattle({combatants:[a,d],rules:V41_OVERFLOW_D20,seed:'new'});fresh.start();expect(barrierAmount(a)).toBe(36);
    const f=unit('f',{scale:'company',hpMax:40});f.gear=[wearable('fitem',4)];
    const empty=unit('a');const b=new SmallBattle({combatants:[empty,f],rules:V41_OVERFLOW_D20,seed:'formation'});b.start();expect(barrierAmount(f)).toBe(36);
    empty.gear=[wearable('late',4)];const reload=SmallBattle.fromSnapshot(b.toSnapshot());expect(reload.combatants[0]!.barrier).toBeUndefined();
  });
  it('uses real weapon and independent skill budgets without modifying frozen skill formulas',()=>{
    for(const category of ['物理单体近战','魔法单体']){
      const a=unit('a',{abilityBlueprints:[{id:skillDefinitionId(category)!,level:3,bonuses:{damage:3,thermalDamage:2}}],weaponBonuses:{damage:4,thermalDamage:3},bonuses:{damage:3}}),d=unit('d');
      new SmallBattle({combatants:[a,d],rules:V41_OVERFLOW_D20,seed:'skill',traitRegistry:registry});
      const ability=a.abilities[0]!,e=ability.effects.find(e=>e.op==='damage');if(e?.op!=='damage')throw Error('fixture');
      const attack=skillAttack({mode:'small',units:[a,d],battlefield:standardField(),fieldTags:[]},a,d,ability,e,V41_OVERFLOW_D20);
      const o={attacker:a,defender:d,rules:V41_OVERFLOW_D20,conditionDefs,traitRegistry:registry,distance:1,...attack};
      const p=previewAttack(o),rng=new SeededRng(category);let sum=0;
      for(let i=0;i<2000;i++)sum+=resolveAttack({...o,defender:structuredClone(d),rng}).finalDamage;
      expect(Math.abs(sum/2000-p.expectedDamage)).toBeLessThan(Math.max(1,p.expectedDamage*.07));
    }
  });
  it('absorbs into the wearable before energy shield and does not convert blocked damage into life loss',()=>{
    const a=unit('a',{weaponLevel:1}),d=unit('d');d.gear=[wearable('entry',4)];
    const shield=compileItem({kind:'shield',mechanism:'energy-shield',power:3},{id:'energy',seed:'energy'});if(shield.kind!=='shield')throw Error('fixture');d.shield=shield.value;
    const b=new SmallBattle({combatants:[a,d],rules:V41_OVERFLOW_D20,seed:'energy'});b.start();prepareArmsModel(d,V41_OVERFLOW_D20);
    const before=structuredClone(d.energyShield),hp=d.hp;
    resolveAttack({attacker:a,defender:d,rules:V41_OVERFLOW_D20,conditionDefs,traitRegistry:registry,distance:1,autoHit:true,rng:fixed()});
    expect(d.energyShield).toEqual(before);expect(d.hp).toBe(hp);expect(barrierAmount(d)).toBeLessThan(36);
  });
});
