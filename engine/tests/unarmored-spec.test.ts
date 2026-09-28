import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, V7_OVERFLOW_D20, traitRegistry, standardConditionMap,
  penetrationContext, previewAttack, resolveAttack, type Combatant, type GenerateInput } from '../src/index.js';
import { compileArmor } from '../src/gen/equipment.js';
import { anchoredProtection, armorTransmission, armorEffectLabel, defensePower } from '../src/power-anchors.js';
import { parseArmorSpec } from '../../panel/src/tags.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';

const registry=traitRegistry(),conditionDefs=standardConditionMap();
function unit(id:string,extra:Partial<GenerateInput>={}):Combatant {
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',rulesVersion:'v2',damageModel:'wounds-v2',scale:'hero',level:1,
    hpMax:2000,weaponClass:'rifle',weaponLevel:10,armorTier:0,armorLevel:1,traits:[],...extra},{seed:id,noVariance:true,registry}).unit;
  prepareCombatModel(u,V7_OVERFLOW_D20);return u;
}
const options=(a:Combatant,d:Combatant)=>({attacker:a,defender:d,rules:V7_OVERFLOW_D20,traitRegistry:registry,conditionDefs,ranged:true,distance:4});

describe('unarmored equipment grades and signed armor enhancements',()=>{
 it('L10 gauze protects a low-level wearer from overmatch without granting base armor or weight',()=>{
  const a=unit('a'),d=unit('d',{armorName:'薄纱',armorLevel:10});a.base.atk=100;
  for(const channel of ['kinetic','thermal','arcane'] as const){
   const attacker={...a,weapon:{...a.weapon!,channel}};
   expect(penetrationContext(options(attacker,d))).toMatchObject({protectionPower:10,overmatchMultiplier:1,resistance:0,factor:1});
  }
  const hit=resolveAttack({...options(a,d),rng:{seed:'fixed',next:()=>.5,d:(s:number)=>s===20?18:4}});
  expect(hit.finalDamage).toBeGreaterThan(0);expect(hit.overmatchMultiplier).toBe(1);expect(d.armor!.load).toBe(0);
  delete d.armor;expect(penetrationContext(options(a,d)).overmatchMultiplier).toBeGreaterThan(1);
 });
 it('defaults unspecified unarmored grades to L1 and preserves explicit and armored grades',()=>{
  expect(unit('d',{armorLevel:undefined}).armor!.level).toBe(1);
  expect(unit('d',{armorLevel:undefined,armorTier:undefined}).armor!.level).toBe(1);
  expect(unit('d',{armorLevel:undefined,armorTier:1}).armor!.level).toBe(5);
  const context={id:'cloth',seed:'cloth',noVariance:true};
  expect(compileArmor({tier:0},context).level).toBe(1);
  expect(compileArmor({tier:0,power:10},context).level).toBe(10);
 });
 it('generic and channel protection modifiers apply with the existing signed bounds',()=>{
  const d=unit('d',{armorLevel:10,armorBonuses:{protection:10,thermalProtection:-5,arcaneProtection:5}});
  expect(anchoredProtection(d,'kinetic')).toBe(2);
  expect(anchoredProtection(d,'thermal')).toBe(1);
  expect(anchoredProtection(d,'arcane')).toBe(2);
  d.armor!.recipe!.bonuses={kineticProtection:5,thermalProtection:10,arcaneProtection:-10};
  expect(anchoredProtection(d,'kinetic')).toBe(1);
  expect(anchoredProtection(d,'thermal')).toBe(2);
  expect(anchoredProtection(d,'arcane')).toBe(0);
  d.armor!.recipe!.bonuses={protection:-10};
  for(const channel of ['kinetic','thermal','arcane'] as const)expect(anchoredProtection(d,channel)).toBe(0);
 });
 it('strength changes partial penetration and its display, retaining full-penetration and no-penetration endpoints',()=>{
  const d=unit('d',{armorLevel:10,armorBonuses:{protection:10}});
  const plain=armorTransmission(d,'kinetic',2.5);expect(plain).toBeCloseTo(.775);
  d.armor!.recipe!.bonuses!.power=10;
  expect(armorTransmission(d,'kinetic',2.5)).toBeCloseTo(plain**1.5);
  expect(armorEffectLabel(d)).toContain('吸能强度×1.5');
  d.armor!.recipe!.bonuses!.power=-10;
  expect(armorTransmission(d,'kinetic',2.5)).toBeCloseTo(Math.sqrt(plain));
  expect(armorEffectLabel(d)).toContain('吸能强度×0.5');
  expect(armorTransmission(d,'kinetic',3)).toBe(1);
  d.armor!.recipe!.bonuses={protection:10,power:10};
  d.armor!.protectionOverride=true;d.armor!.protection={kinetic:4,thermal:0,arcane:0};
  expect(armorTransmission(d,'kinetic',1)).toBe(0);
 });
 it('signed defense modifiers change attack defense independently of armor resistance',()=>{
  const a=unit('a'),d=unit('d',{armorLevel:10});
  const before=previewAttack(options(a,d)).defenseScore!;
  for(const [points,delta] of [[10,4],[-10,-4],[5,2]] as const){
   d.armor!.recipe!.bonuses={defense:points};
   expect(previewAttack(options(a,d)).defenseScore).toBe(before+delta);
   expect(anchoredProtection(d,'kinetic')).toBe(0);
  }
 });
 it('the requested thin-gauze syntax retains every armor modifier through generation and reload',()=>{
  const spec=parseArmorSpec('薄纱:无甲L10+10强度+5防御+10防护+3动能防护-5热能防护+5奥术防护');
  expect(spec).toMatchObject({tier:0,level:10,bonuses:{power:10,defense:5,protection:10,kineticProtection:3,thermalProtection:-5,arcaneProtection:5}});
  const d=unit('d',{armorName:spec.label,armorTier:spec.tier,armorLevel:spec.level,armorBonuses:spec.bonuses});
  const restored=combatantFromUnknown(JSON.parse(JSON.stringify(d)));
  expect(restored.armor).toEqual(d.armor);expect(defensePower(restored,'thermal')).toBe(10);
  expect(anchoredProtection(restored,'thermal')).toBe(1);expect(armorTransmission(restored,'thermal',1)).toBeCloseTo(.55**1.5);
 });
});
