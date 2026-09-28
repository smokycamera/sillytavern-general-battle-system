import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, upgradeCombatSkills, V6_OVERFLOW_D20, V7_OVERFLOW_D20, V7_OVERFLOW_TW,
  traitRegistry, standardConditionMap, memberHealth, resolveAttack, previewAttack, penetrationContext,
  SeededRng, rulesById, compileGenericSkill, skillDefinitionId, skillAttack, grantBarrier, SmallBattle, MassBattle,
  standardField, type Combatant, type GenerateInput, type RulePack, type AttackOpts } from '../src/index.js';
import { compileArmor } from '../src/gen/equipment.js';
import { WEAPON_CLASSES } from '../src/data/weapons.js';
import { protectionPower, defensePower, anchoredProtection, gradeOvermatch, powerBudget } from '../src/power-anchors.js';
import { placeZone, settleZones } from '../src/area-effects.js';

const registry=traitRegistry(),conditionDefs=standardConditionMap();
function unit(id:string,extra:Partial<GenerateInput>={}):Combatant {
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',rulesVersion:'v2',damageModel:'wounds-v2',scale:'hero',level:8,
    archetype:'ranged',weaponClass:'energy',weaponLevel:8,armorTier:2,armorLevel:8,traits:[],...extra},{seed:id,noVariance:true,registry}).unit;
  u.id=id;prepareCombatModel(u,V6_OVERFLOW_D20);upgradeCombatSkills(u);return u;
}
function options(a:Combatant,d:Combatant,rules:RulePack=V7_OVERFLOW_D20):Omit<AttackOpts,'rng'> {
  return {attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,distance:4,ranged:!!a.weapon?.tags?.includes('ranged')};
}
function fixed(roll=4) { return {seed:'fixed',next:()=>.5,d:(s:number)=>s===20?18:Math.min(s,roll)}; }
function equivalent(r:ReturnType<typeof resolveAttack>) {return [r.hit,r.crit,r.finalDamage,r.overflowDamage,r.splashDamage,r.hpAfter,r.membersAfter,r.damagePlans];}

describe('V7 bounded cross-grade damage with existing member overflow',()=>{
 it('preserves the accelerating worldbook curve at high grades without changing the adjacent-grade safe band',()=>{
  expect(powerBudget(8)/powerBudget(5)).toBe(40);
  expect(powerBudget(10)/powerBudget(7)).toBeCloseTo(285.7142857143);
  expect(gradeOvermatch(8,5,30,10)).toBeCloseTo(3.7796447301);
  expect(gradeOvermatch(10,7,30,14)).toBeCloseTo(8.1649658093);
  // Compare both upgrades against the SAME target, isolating source-L growth.
  const mid=gradeOvermatch(8,4,30,8)/gradeOvermatch(5,4,30,8);
  const high=gradeOvermatch(10,4,30,8)/gradeOvermatch(7,4,30,8);
  expect(mid).toBeCloseTo(Math.sqrt(40));expect(high).toBeCloseTo(Math.sqrt(400000/1400));
  expect(high).toBeGreaterThan(mid*2.6);
  for(let power=1;power<=10;power++)for(const gap of [0,1])expect(gradeOvermatch(power,power-gap,30,0)).toBe(1);
  expect(gradeOvermatch(10,4,8,8)).toBe(1);
  expect(gradeOvermatch(10,4,8.5,8)).toBeCloseTo(1+(gradeOvermatch(10,4,9,8)-1)/2);
 });
 it('all weapon classes preserve standard same/adjacent-grade outcomes and RNG, including critical hits',()=>{
  for(const mechanism of Object.keys(WEAPON_CLASSES))for(const power of [3,5,8])for(const gap of [-1,0,1])for(const tier of [1,2,3,4] as const){
   const a=unit('a',{weaponClass:mechanism,weaponLevel:power}),d=unit('d',{scale:'company',hpMax:100,level:4,armorLevel:power-gap,armorTier:tier});
   a.base.atk=30;
   for(const seed of ['baseline','critical']) {
    const oldRng=new SeededRng(seed),newRng=new SeededRng(seed);
    if(seed==='critical')for(const rng of [oldRng,newRng]){const roll=rng.d.bind(rng);rng.d=(s:number)=>s===20?20:roll(s);}
    const old=resolveAttack({...options(a,structuredClone(d),V6_OVERFLOW_D20),rng:oldRng});
    const next=resolveAttack({...options(a,structuredClone(d)),rng:newRng});
    expect(next.overmatchMultiplier,mechanism+':'+power+':'+gap+':'+tier).toBe(1);
    expect(equivalent(next)).toEqual(equivalent(old));expect(newRng.getState()).toBe(oldRng.getState());
   }
  }
 });
 it('unit level supplies a floor for every channel, body and scale without adding armor resistance',()=>{
  const a=unit('a',{level:1,weaponLevel:8});
  for(const body of ['human','large','vehicle','giant'] as const)for(const scale of ['hero','company'] as const){
   const d=unit('d',{level:8,body,scale,armorTier:0,armorLevel:1,hpMax:scale==='company'?48:1800});
   for(const channel of ['kinetic','thermal','arcane'] as const){
    const attacker={...a,weapon:{...a.weapon!,channel}};
    const high=penetrationContext(options(attacker,d)),low=penetrationContext(options(attacker,{...d,level:1}));
    expect(high.protectionPower).toBe(8);expect(high.overmatchMultiplier).toBe(1);
    expect(low.overmatchMultiplier).toBeGreaterThan(1);
    expect(high.resistance).toBe(low.resistance);expect(high.factor).toBe(low.factor);
   }
  }
 });
 it('keeps the one-grade safe band and uses the stronger of level and armor instead of adding them',()=>{
  const d=unit('d',{level:5,armorTier:0,armorLevel:1});
  for(const [power,multiplier] of [[5,1],[6,1],[7,Math.sqrt(1400/420)]] as const){
   const a=unit('a',{weaponLevel:power});
   expect(penetrationContext(options(a,d)).overmatchMultiplier).toBeCloseTo(multiplier,10);
  }
  d.armor=compileArmor({power:4,tier:2},{id:'armor',seed:'same',noVariance:true});
  expect(defensePower(d,'thermal')).toBe(5);
  d.armor=compileArmor({power:8,tier:2},{id:'armor',seed:'same',noVariance:true});d.level=1;
  expect(defensePower(d,'thermal')).toBe(8);
  expect(penetrationContext(options(unit('a',{weaponLevel:9}),d)).overmatchMultiplier).toBe(1);
 });
 it('retains ordinary unarmored damage and real armor mitigation after the level floor removes amplification',()=>{
  const a=unit('a',{weaponClass:'rifle',weaponLevel:5}),d=unit('d',{level:5,armorTier:0,armorLevel:1,hpMax:10000});a.base.atk=100;
  const plain=resolveAttack({...options(a,structuredClone(d)),rng:fixed()});
  const old=resolveAttack({...options(a,structuredClone(d),V6_OVERFLOW_D20),rng:fixed()});
  expect(plain.overmatchMultiplier).toBe(1);expect(plain.finalDamage).toBeGreaterThan(0);
  expect(equivalent(plain)).toEqual(equivalent(old));expect(anchoredProtection(d,'kinetic')).toBe(0);
  d.armor=compileArmor({power:5,tier:3},{id:'armor',seed:'same',noVariance:true});
  const armored=resolveAttack({...options(a,d),rng:fixed()});
  expect(armored.overmatchMultiplier).toBe(1);expect(armored.finalDamage).toBeLessThan(plain.finalDamage);
 });
 it('level, wards and finite barriers take the maximum and a weak barrier cannot undo level protection',()=>{
  const a=unit('a',{weaponLevel:8}),d=unit('d',{level:8,armorTier:0,armorLevel:1,hpMax:10000});a.base.atk=100;
  d.conditions.push({id:'blessed',dur:3,defensePower:3});
  grantBarrier(d,20,3,'d',4);
  expect(defensePower(d,'thermal',true)).toBe(8);expect(anchoredProtection(d,'thermal')).toBe(0);
  const bare={...structuredClone(d),barrier:undefined};
  const plain=resolveAttack({...options(a,bare),rng:fixed()});
  const protectedHit=resolveAttack({...options(a,d),rng:fixed()});
  expect(protectedHit.overmatchMultiplier).toBe(1);expect(protectedHit.barrierAbsorbed).toBe(20);
  expect(protectedHit.finalDamage+20).toBe(plain.finalDamage);expect(d.barrier).toBeUndefined();
  grantBarrier(d,20,3,'d',10);
  expect(defensePower(d,'thermal')).toBe(8);expect(defensePower(d,'thermal',true)).toBe(10);
 });
 it.each([V7_OVERFLOW_D20,V7_OVERFLOW_TW])('$id applies the level floor to spells and techniques, with matching previews and member damage',rules=>{
  for(const label of ['魔法单体','魔法范围','物理单体']){
   const a=unit('a',{level:1}),d=unit('d',{level:8,scale:'company',hpMax:48,armorTier:0,armorLevel:1});a.base.atk=100;
   a.abilities=[compileGenericSkill(skillDefinitionId(label)!,8,a.id)];upgradeCombatSkills(a);
   const ability=a.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage')!;if(effect.op!=='damage')throw Error('missing damage');
   const params=skillAttack({units:[a,d],mode:rules===V7_OVERFLOW_TW?'mass':'small',fieldTags:[]},a,d,ability,effect,rules);
   const opts={...options(a,d,rules),...params},previous={...opts,rules:{...rules,overmatch:false}};
   expect(penetrationContext(opts)).toMatchObject({attackPower:8,protectionPower:8,overmatchMultiplier:1,factor:1});
   expect(previewAttack(opts).expectedDamage).toBe(previewAttack(previous).expectedDamage);
   const hit=resolveAttack({...opts,defender:structuredClone(d),rng:fixed()});
   expect(equivalent(hit)).toEqual(equivalent(resolveAttack({...previous,defender:structuredClone(d),rng:fixed()})));
   expect(hit.finalDamage).toBeGreaterThan(0);
   if(label!=='物理单体')expect(hit.overflowDamage??0).toBe(0);
  }
 });
 it('fire and traps respect the level floor while poison keeps its existing damage',()=>{
  const run=(rules:RulePack,kind:'fire'|'trap'|'poison')=>{
   const a=unit('a',{level:1}),d=unit('d',{level:8,armorTier:0,armorLevel:1,hpMax:10000});a.pos=7;d.pos=8;
   const context={units:[a,d],mode:'small' as const,fieldTags:[],battlefield:standardField(),rules};
   placeZone(context,a,d,{op:'zone',kind,power:8,radius:0,dur:3},1,'zone');
   const damage=settleZones(context,1)[0]!.damage;expect(settleZones(context,1)).toEqual([]);return damage;
  };
  for(const kind of ['fire','trap','poison'] as const){
   const damage=run(V7_OVERFLOW_D20,kind);expect(damage).toBeGreaterThan(0);expect(damage).toBe(run(V6_OVERFLOW_D20,kind));
  }
 });
 it('the overmatch coefficient is independent of attacker training, body, HP and troop counts',()=>{
  const factors=[];
  for(const training of [1,5,10])for(const body of ['human','large','vehicle','giant'] as const)for(const scale of ['hero','company'] as const){
   const a=unit('a',{level:training,body}),d=unit('d',{level:4,scale,armorLevel:4,hpMax:scale==='company'?100:1800});
   factors.push(penetrationContext(options(a,d)).overmatchMultiplier);
  }
  for(const factor of factors)expect(factor).toBeCloseTo(Math.sqrt(40),10);
 });
 it('uses actual channel resistance, signed modifiers and overrides rather than a high armor label',()=>{
  const a=unit('a'),d=unit('d',{level:1,armorLevel:4});
  const base=penetrationContext(options(a,d)).overmatchMultiplier!;
  d.armor!.recipe!.bonuses={thermalProtection:10};expect(penetrationContext(options(a,d)).overmatchMultiplier).toBeLessThan(base);
  d.armor!.recipe!.bonuses={thermalProtection:-10};expect(penetrationContext(options(a,d)).overmatchMultiplier).toBeGreaterThan(base);
  d.armor=compileArmor({power:10,tier:2},{id:'armor',seed:'same',noVariance:true});
  d.armor.protectionOverride=true;d.armor.protection={kinetic:30,thermal:7,arcane:6};
  expect(protectionPower(d,'thermal')).toBe(4);expect(penetrationContext(options(a,d)).overmatchMultiplier).toBeCloseTo(base);
  d.armor.protection.thermal=30;expect(penetrationContext(options(a,d)).factor).toBe(0);
  d.armor=compileArmor({power:10,tier:0},{id:'none',seed:'none',noVariance:true});expect(protectionPower(d,'thermal')).toBe(0);
  expect(penetrationContext(options(a,d))).toMatchObject({protectionPower:10,overmatchMultiplier:1,factor:1});
 });
 it('reproduces the supplied P8 laser roll and carries the extra damage through 72-HP members',()=>{
  const a=unit('a',{body:'giant',hpMax:1800}),d=unit('d',{level:4,archetype:'infantry',scale:'company',hpMax:48,armorLevel:4});
  a.base.atk=100;
  const source=JSON.stringify(a.weapon),sequence=[3,6,3,5,3,6,1,3];
  const roll=()=>{let i=0;return {seed:'user-log',next:()=>.5,d:(s:number)=>s===20?18:sequence[i++]!};};
  const old=resolveAttack({...options(a,structuredClone(d),V6_OVERFLOW_D20),rng:roll()});
  const next=resolveAttack({...options(a,d),rng:roll()});
  expect(old.finalDamage).toBe(63);expect(next.finalDamage).toBe(399);expect(next.membersBefore!-next.membersAfter!).toBe(5);
  expect(next.overflowDamage).toBe(327);expect(memberHealth(d)).toBe(3456-399);expect(JSON.stringify(a.weapon)).toBe(source);
 });
 it('an L10 sword can pass through many members, without a one-person or body-based kill cap',()=>{
  const a=unit('a',{weaponClass:'sword',weaponLevel:10}),d=unit('d',{level:4,archetype:'infantry',scale:'company',hpMax:100,armorLevel:4});a.base.atk=100;
  const first=resolveAttack({...options(a,d),rng:fixed()});
  expect(first.membersBefore!-first.membersAfter!).toBeGreaterThan(50);expect(first.overflowDamage).toBeGreaterThan(3600);
  resolveAttack({...options(a,d),rng:fixed()});expect(d.hp).toBe(0);expect(memberHealth(d)).toBe(0);
 });
 it('independent spells use skill L, release overmatch overflow, and never borrow the held weapon L or training',()=>{
  const a=unit('a',{level:1,weaponLevel:1}),d=unit('d',{level:4,archetype:'infantry',scale:'company',hpMax:48,armorLevel:4});a.base.atk=100;
  a.abilities=[compileGenericSkill(skillDefinitionId('魔法单体')!,8,a.id)];upgradeCombatSkills(a);
  const ability=a.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage')!;if(effect.op!=='damage')throw Error('missing damage');
  const params=skillAttack({units:[a,d],mode:'small',fieldTags:[]},a,d,ability,effect,V7_OVERFLOW_D20);
  const opts={...options(a,d),...params};
  expect(penetrationContext(opts).attackPower).toBe(8);
  const result=resolveAttack({...opts,rng:fixed()});expect(result.finalDamage).toBeGreaterThan(300);expect(result.overflowDamage).toBeGreaterThan(0);
  const missing={...params.abilityDamage!,power:undefined};expect(penetrationContext({...opts,abilityDamage:missing}).overmatchMultiplier).toBe(1);
 });
 it('same/adjacent spells keep their former cap, while weapon techniques apply the coefficient only once',()=>{
  for(const label of ['魔法单体','魔法范围','物理单体']){
   const a=unit('a'),d=unit('d',{scale:'company',hpMax:48,armorLevel:7});a.base.atk=100;
   a.abilities=[compileGenericSkill(skillDefinitionId(label)!,8,a.id)];upgradeCombatSkills(a);
   const ability=a.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage')!;if(effect.op!=='damage')throw Error('missing damage');
   const params=skillAttack({units:[a,d],mode:'small',fieldTags:[]},a,d,ability,effect,V7_OVERFLOW_D20);
   const old=resolveAttack({...options(a,structuredClone(d),V6_OVERFLOW_D20),...params,rng:fixed(6)});
   const next=resolveAttack({...options(a,structuredClone(d)),...params,rng:fixed(6)});expect(equivalent(next)).toEqual(equivalent(old));
   if(label==='物理单体'){
    const weak=unit('d',{level:4,hpMax:2000,armorLevel:4});
    const before=resolveAttack({...options(a,structuredClone(weak),V6_OVERFLOW_D20),...params,rng:fixed()});
    const after=resolveAttack({...options(a,weak),...params,rng:fixed()});
    expect(after.dmgMult/before.dmgMult).toBeCloseTo(Math.sqrt(40),10);
   }
  }
 });
 it('barriers absorb final damage once, and shield protection remains limited to actual coverage',()=>{
  const a=unit('a'),d=unit('d',{level:4,scale:'company',hpMax:48,armorLevel:4,shield:true});a.base.atk=100;
  d.shield!.recipe={version:'mechanism-v2.3',mechanism:'shield',power:8,quality:3,size:'human',seed:'shield'};
  const armored=penetrationContext(options(a,d));
  const noShield=penetrationContext(options(a,{...d,shield:undefined}));
  expect(armored.overmatchMultiplier).toBeLessThan(noShield.overmatchMultiplier!);expect(armored.overmatchMultiplier).toBeGreaterThan(1);
  const original=resolveAttack({...options(a,structuredClone(d)),rng:fixed()});grantBarrier(d,100,3);
  const protectedHit=resolveAttack({...options(a,d),rng:fixed()});
  expect(protectedHit.barrierAbsorbed).toBe(100);expect(protectedHit.finalDamage+100).toBe(original.finalDamage);expect(d.barrier).toBeUndefined();
 });
 it('preview follows sampled execution without mutating state for shields and sequential barriers',()=>{
  const a=unit('a'),d=unit('d',{level:4,scale:'company',hpMax:48,armorLevel:4,shield:true});
  d.shield!.recipe={version:'mechanism-v2.3',mechanism:'shield',power:8,quality:3,size:'human',seed:'shield'};
  for(const barrier of [0,150]){
   const target=structuredClone(d);if(barrier)grantBarrier(target,barrier,3);
   const opts=options(a,target),before=JSON.stringify(target),preview=previewAttack(opts);expect(JSON.stringify(target)).toBe(before);
   let total=0,squares=0;const count=768,rng=new SeededRng('overmatch-preview');
   for(let i=0;i<count;i++){const copy=structuredClone(target);let amount=0;for(let n=0;n<2;n++)amount+=resolveAttack({...opts,defender:copy,rng}).finalDamage;total+=amount;squares+=amount*amount;}
   const variance=squares/count-(total/count)**2;
   expect(Math.abs(total/count-preview.expectedDamage)).toBeLessThan(5*Math.sqrt(variance/(barrier?96:count))+1);
  }
 });
 it('zone contact uses skill power but preserves four-member exposure, per-round guards and poison behavior',()=>{
  const run=(rules:RulePack,kind:'fire'|'poison')=>{
   const a=unit('a',{level:1}),d=unit('d',{level:4,archetype:'infantry',scale:'company',hpMax:48,armorLevel:4});a.pos=7;d.pos=8;
   const context={units:[a,d],mode:'small' as const,fieldTags:[],battlefield:standardField(),rules};
   placeZone(context,a,d,{op:'zone',kind,power:8,radius:0,dur:3},1,'zone');
   const result=settleZones(context,1);expect(settleZones(context,1)).toEqual([]);return result[0]!.damage;
  };
  expect(run(V7_OVERFLOW_D20,'fire')).toBe(288);expect(run(V6_OVERFLOW_D20,'fire')).toBe(112);
  expect(run(V7_OVERFLOW_D20,'poison')).toBe(run(V6_OVERFLOW_D20,'poison'));
 });
 it.each(['small','mass'] as const)('%s snapshot keeps V7 explicit and V6 historical rules unchanged',mode=>{
  const a=unit('a',{body:mode==='mass'?'vehicle':'human'}),d=unit('d',{body:mode==='mass'?'vehicle':'human',armorTier:0,armorLevel:1});
  const b=mode==='small'?new SmallBattle({combatants:[a,d],rules:V7_OVERFLOW_D20,battlefield:standardField(),seed:'v7',traitRegistry:registry})
   :new MassBattle({combatants:[a,d],rules:V7_OVERFLOW_TW,seed:'v7',traitRegistry:registry});b.start();
  const snap=b.toSnapshot();
  const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(structuredClone(snap) as ReturnType<SmallBattle['toSnapshot']>):MassBattle.fromSnapshot(structuredClone(snap) as ReturnType<MassBattle['toSnapshot']>);
  expect(restored.rules.overmatch).toBe(true);expect(restored.combatants.map(memberHealth)).toEqual(b.combatants.map(memberHealth));
  expect(penetrationContext(options(restored.byId('a'),restored.byId('d'),restored.rules))).toMatchObject({protectionPower:8,overmatchMultiplier:1,factor:1});
  expect(rulesById('v6-overflow-d20').overmatch).toBeUndefined();
 });
});
