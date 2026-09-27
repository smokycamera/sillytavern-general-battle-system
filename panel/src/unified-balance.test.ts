import { compileItem, carriedItemAbility } from '../../engine/src/items.js';
import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, upgradeCombatSkills, V5_D20, V6_D20, V6_OVERFLOW_D20,
 SmallBattle, traitRegistry, ABILITY_BLUEPRINTS, type Combatant } from '../../engine/src/index.js';
import { compileSkill, skillDefinitionId } from '../../engine/src/skill-catalog.js';
import { SKILL_CATEGORIES, SKILL_MODIFIERS, skillMechanismId, skillMechanismFromId } from '../../engine/src/data/skill-mechanisms.js';
import { ENHANCEMENT_STATS, type Enhancements } from '../../engine/src/enhancements.js';
import { unitRecordFromCombatant, combatantFromUnknown, materializeUnitRecord } from './unit-state.js';
import { reviewMigration } from './migration-review.js';
import { applyUnitSet } from './unit-set.js';
import { prepareInventoryState } from './inventory-state.js';
import { zoneAmount } from '../../engine/src/zone-skills.js';
import { diceAvg } from '../../engine/src/data/weapons.js';
const registry=traitRegistry();
function unit(old=false):Combatant {
 const u=generateUnit({name:'known unit',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:old?'wounds-v1':'wounds-v2',level:10,body:'giant',traits:[],weaponClass:'sword',weaponLevel:10}, {seed:'v6-save',registry,noVariance:true}).unit;
 prepareCombatModel(u,old?V5_D20:V6_D20);return u;
}
function skill(name:string,power=5,bonuses?:Enhancements) {
 const u=unit();u.abilities=[compileSkill({id:skillDefinitionId(name)!,bonuses},power,u.id)];u.preparedAbilityIds=[u.abilities[0]!.id];upgradeCombatSkills(u);return u;
}
describe('V6 archive, skill families and signed modifier round trips',()=>{
 it('every blueprint/modifier at low/high tiers and all signed skill keys survives saving and repeated upgrading',()=>{
  const definitions=new Set(Object.keys(ABILITY_BLUEPRINTS));
  for(const category of SKILL_CATEGORIES) for(const modifier of SKILL_MODIFIERS) {
   const id=skillMechanismId({category:category.id,area:category.id.endsWith('area'),modifiers:[modifier.id]});
   if(skillMechanismFromId(id))definitions.add(id);
  }
  definitions.add(skillDefinitionId('debuff攻击+防御+虚弱+易伤+减速+中毒+流血+燃烧+士气+诅咒')!);
  const cases:Enhancements[]=[{power:10,damage:10},{power:-10,damage:-10},...ENHANCEMENT_STATS.skill.flatMap(key=>[-10,10].map(value=>({[key]:value})))];
  for(const id of definitions)for(const power of [1,10])for(const bonuses of cases) {
   const u=unit();u.abilities=[compileSkill({id,bonuses},power,u.id)];u.preparedAbilityIds=[u.abilities[0]!.id];upgradeCombatSkills(u);
   const before=JSON.stringify(u);upgradeCombatSkills(u);expect(JSON.stringify(u),id).toBe(before);
   expect(()=>combatantFromUnknown(u),id+' '+JSON.stringify(bonuses)).not.toThrow();
  }
 });
 it('weapon skills accept 4.4×, independent single skills use 1.5×, healing follows the low-tier budget',()=>{
  const physical=skill('物理单体',1,{power:10,damage:10});expect(physical.abilities[0]!.weaponDamageMult).toBeCloseTo(4.4);
  expect(materializeUnitRecord(unitRecordFromCombatant(physical),registry).abilities).toEqual(physical.abilities);
  const magic=skill('魔法单体',1),a=magic.abilities[0]!,effect=a.effects.find(e=>e.op==='damage')!;
  expect(effect.op==='damage'&&diceAvg(effect.baseDice)*(a.damageScale??1)).toBeCloseTo(12);
  expect(skill('buff治疗',1).abilities[0]!.effects).toEqual([{op:'heal',amount:8}]);
  expect(skill('buff治疗',2,{power:10,healing:10}).abilities[0]!.effects).toEqual([{op:'heal',amount:32}]);
 });
 it('zones apply ±10 once, retain their own per-tick budgets and keep smoke/control duration bounded',()=>{
  for(const [name,key,channel] of [['火墙','damage','thermalDamage'],['陷阱','damage','kineticDamage'],['毒雾','damage',undefined],['治疗区域','healing',undefined]] as const) {
   for(const points of [-10,10]) {
    const a=skill(name,5,{power:points,[key]:points,...(channel?{[channel]:points}:{}),duration:points}).abilities[0]!;
    const e=a.effects.find(e=>e.op==='zone')!;expect(e.op).toBe('zone');if(e.op!=='zone')throw Error();
    expect(zoneAmount(e)).toBe(Math.round(19*(points===10?2:.5)));expect(e.dur).toBe(points===10?5:1);
   }
  }
  const smoke=skill('烟幕',5,{power:10,duration:10}).abilities[0]!.effects[0]!;expect(smoke.op==='zone'&&smoke.dur).toBe(7);
  for(const name of ['debuff眩晕','debuff沉默','debuff缴械','debuff定身']) {
   const e=skill(name,10,{duration:10}).abilities[0]!.effects.find(e=>e.op==='condition')!;expect(e.op==='condition'&&e.dur).toBe(1);
  }
 });
 it('new consumables and nested zone healing use current life; saved old items remain frozen',()=>{
  for(const points of [-10,0,10]){
   const bonuses={power:points,healing:points},spec={kind:'consumable' as const,mechanism:'heal' as const,power:10,bonuses};
   const old=compileItem(spec,{id:'old',seed:'old'}),next=compileItem(spec,{id:'new',seed:'new',damageModel:'wounds-v2'});
   expect(old.kind==='consumable'&&old.effect).toEqual({op:'heal',amount:Math.round(21*(points<0?.5:points>0?2:1))});
   expect(next.kind==='consumable'&&next.effect).toEqual({op:'heal',amount:Math.round(41*(points<0?.5:points>0?2:1))});
   const bomb=compileItem({kind:'consumable',mechanism:'grenade',power:10,bonuses:{power:points}},{id:'bomb',seed:'bomb',damageModel:'wounds-v2'});
   if(bomb.kind!=='consumable')throw Error();
   expect(carriedItemAbility({id:'bomb',name:'bomb',quantity:1,revision:1,mechanics:bomb}).damageScale).toBe(1+points*.05);
  }
  const e=skill('治疗区域+治疗',10).abilities[0]!.effects.find(e=>e.op==='zone')!;
  expect(e.op==='zone'&&e.effects?.find(e=>e.op==='heal')).toEqual({op:'heal',amount:21});
 });
 it('upgrade review is explicit and keeps the complete original; active V5 snapshots are not migrated',()=>{
  const u=unit(true);u.hp-=7;u.resources.SP=1;u.abilities=[compileSkill({id:skillDefinitionId('魔法范围')!,name:'same'},10,u.id)];upgradeCombatSkills(u);
  u.abilityState=[{abilityId:u.abilities[0]!.cooldownGroup!,cdLeft:2,used:1}];
  const old=prepareInventoryState({schemaVersion:2,storage:[unitRecordFromCombatant(u)],rosterIds:[u.id],factRevision:7}),before=structuredClone(old);
  expect(reviewMigration(old)).toBeUndefined();const review=reviewMigration(old,true)!;expect(old).toEqual(before);expect(review.original).toEqual(before);
  const next=review.candidate.storage![0]!.snapshot!;expect(next.damageModel).toBe('wounds-v2');expect(next.base.hpMax-next.hp).toBe(7);
  expect(next.abilityState).toEqual(u.abilityState);expect(next.resources).toEqual(u.resources);expect(next.weapon).toEqual(u.weapon);
  expect(next.abilities[0]!.areaExposure).toBe(32);expect(next.abilities[0]!.id).toBe(u.abilities[0]!.id);expect(reviewMigration(review.candidate,true)).toBeUndefined();
  const battle=new SmallBattle({combatants:[structuredClone(u)],rules:V5_D20,seed:'saved-v5',traitRegistry:registry});battle.start();
  const active={...old,battle:{kind:'small' as const,snap:battle.toSnapshot()}};expect(reviewMigration(active)).toBeUndefined();
  expect(()=>reviewMigration(active,true)).toThrow('收兵');expect(SmallBattle.fromSnapshot(structuredClone(active.battle.snap)).rules.id).toBe(V5_D20.id);
 });
 it('upgrade honors archive deployment and wounds over stale snapshot fields without resetting resources',()=>{
  const u=unit(true);u.tags.push('zone:中军','rank:reserve');u.resources.SP=1;u.fatigue=2;
  const record=unitRecordFromCombatant(u);record.zone='右翼';record.rank='rear';record.hp-=9;
  record.name='archive name';record.traits.push('vanguard');
  const save={schemaVersion:2,storage:[record],rosterIds:[record.id]};
  const review=reviewMigration(save,true)!;const next=review.candidate.storage![0]!;
  expect(next).toMatchObject({name:'archive name',zone:'右翼',rank:'rear'});
  expect(next.base.hpMax-next.hp).toBe(9);expect(next.traits).toContain('vanguard');
  expect(next.snapshot!.tags).toEqual(expect.arrayContaining(['zone:右翼','rank:rear']));
  expect(next.snapshot!.tags).not.toContain('rank:reserve');
  expect(next.snapshot!.resources).toEqual(u.resources);expect(next.snapshot!.fatigue).toBe(2);
  expect(review.original).toEqual(save);expect(record.snapshot!.tags).toContain('rank:reserve');
 });
 it('unit_set applies combined ±10 life to the current formula and preserves quantities, ledgers and explicit maxima',()=>{
  const u=skill('魔法单体');u.storyState={resources:true,abilityState:true};u.resources.SP=1;u.abilityState=[{abilityId:u.abilities[0]!.cooldownGroup!,cdLeft:3,used:1}];
  let save=prepareInventoryState({storage:[unitRecordFromCombatant(u)],rosterIds:[u.id]});
  save=applyUnitSet(save,u.id,{bonuses:{power:10,health:10}},'max-bonus');const next=save.storage![0]!.snapshot!;
  expect(next.base.hpMax).toBe(1976);expect(next.hp).toBe(988);expect(next.resources).toEqual(u.resources);expect(next.abilityState).toEqual(u.abilityState);
  const explicit=applyUnitSet(save,u.id,{base:{hpMax:2000},hp:1999},'explicit');expect(explicit.storage![0]!.hp).toBe(1999);
  expect(()=>applyUnitSet(save,u.id,{bonuses:{health:11}},'invalid')).toThrow();
 });
});
