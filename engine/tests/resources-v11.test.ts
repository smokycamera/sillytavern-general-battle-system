import { describe, it, expect } from 'vitest';
import { generateUnit, traitRegistry, compileGenericSkill, spCapacity, casterReserve, abilityCost, prepareResourceModel,
  spRecovery, recoverSp, fatigueLimit, fatigueAfter, skillExertion, validateTacticalEffort,
  SmallBattle, MassBattle, standardField, V8_OVERFLOW_D20, V9_OVERFLOW_D20, V10_OVERFLOW_D20, V10_OVERFLOW_TW,
  V11_OVERFLOW_D20, V11_OVERFLOW_TW, rulesById, memberHealth, type Combatant, type RulePack } from '../src/index.js';
import { gradeOvermatch } from '../src/power-anchors.js';
import { combatantFromUnknown, unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
import { tacticalRestValue, nextResourceState } from '../src/skill-economy.js';
import { applyUnitSet } from '../../panel/src/unit-set.js';
const registry=traitRegistry();
function make(id='a',level=5,magic=true,scale:'hero'|'company'='hero'):Combatant {
 const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',rulesVersion:'v2',damageModel:'wounds-v2',level,scale,
  weaponClass:magic?'magic':'sword',weaponLevel:1,armorTier:0,hpMax:scale==='hero'?100000:100,traits:[]},
  {seed:id,registry,noVariance:true}).unit;u.id=id;
 const a=compileGenericSkill(magic?'generic:magic-single':'generic:physical-single',level,u.id);
 u.abilities=[a];u.preparedAbilityIds=[a.id];u.resources.SP=spCapacity(u);return u;
}
function battle(mode:'small'|'mass',rules?:RulePack){
 const a=make('a',5,true,mode==='small'?'hero':'company'),e=make('e',5,false,mode==='small'?'hero':'company');
 const field=standardField();field.tiles.fill('open');
 const b=mode==='small'?new SmallBattle({combatants:[a,e],rules:rules??V11_OVERFLOW_D20,battlefield:field,seed:'v11-save',traitRegistry:registry})
 :new MassBattle({combatants:[a,e],rules:rules??V11_OVERFLOW_TW,seed:'v11-save',traitRegistry:registry});
 b.start();if(b instanceof SmallBattle){b.turnOrder=['a','e'];b.turnIndex=0;a.pos=31;e.pos=24;}
 return {a,e,b};
}
function step(b:SmallBattle|MassBattle){if(b.isOver())return;if(b instanceof SmallBattle){if(b.active?.status==='ready')b.autoAction(b.active.id);else b.endTurn();}else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}}
describe('V11 soft40 curve and smaller SP pool',()=>{
 it.each(Array.from({length:10},(_,i)=>i+1))('L%i reduces only new reserves and preserves costs, fatigue and regeneration',level=>{
  for(const magic of [false,true]){
   const u=make('a',level,magic);prepareResourceModel(u,V10_OVERFLOW_D20);
   const old=structuredClone(u),cost=abilityCost(u,u.abilities[0]!);expect(spCapacity(u)).toBe(magic?10+3*level:6+2*level);
   prepareResourceModel(u,V11_OVERFLOW_D20);expect(spCapacity(u)).toBe(magic?6+2*level:4+level);expect(u.resources.SP).toBe(spCapacity(u));
   expect(abilityCost(u,u.abilities[0]!)).toEqual(cost);expect(fatigueLimit(u)).toBe(8);
   u.resources.SP=old.resources.SP=0;
   for(const fatigue of [0,3.99,4,7.99,8]){u.fatigue=old.fatigue=fatigue;
    expect(spRecovery(u)).toBe(spRecovery(old));expect(spRecovery(u,true)).toBe(spRecovery(old,true));
    expect(fatigueAfter(u,2,true)).toBe(fatigueAfter(old,2,true));expect(skillExertion(u,u.abilities[0]!)).toBe(skillExertion(old,old.abilities[0]!));
   }
   if(magic)expect(spCapacity(u)).toBeGreaterThanOrEqual(2*cost!.amount);
  }
 });
 it('training controls capacity; high equipment and high skill grades cannot enlarge it',()=>{
  const u=make('a',1);prepareResourceModel(u,V11_OVERFLOW_D20);const cap=spCapacity(u);
  u.weapon!.recipe!.power=10;u.abilities[0]!.power=10;expect(spCapacity(u)).toBe(cap);
  expect(abilityCost(u,u.abilities[0]!)!.amount).toBeGreaterThan(abilityCost(u,compileGenericSkill('generic:magic-single',1,u.id))!.amount);
 });
 it('equal area fees, item/custom fees and transfer floors remain identical to V10',()=>{
  const u=make();prepareResourceModel(u,V11_OVERFLOW_D20);const old={...u,resourceModel:'endurance-v1' as const};
  for(let p=1;p<=10;p++)for(const stem of ['magic','physical']){
   const single=compileGenericSkill(`generic:${stem}-single`,p,u.id),area=compileGenericSkill(`generic:${stem}-area`,p,u.id);
   expect(abilityCost(u,single)).toEqual(abilityCost(u,area));expect(abilityCost(u,area)).toEqual(abilityCost(old,area));
   for(const extra of [{customized:true},{itemSourceId:'potion'},{equipmentSourceId:'wand'}]){
    const custom={...single,...extra,cost:{resource:'SP',amount:2}};expect(abilityCost(u,custom)).toEqual(custom.cost);
   }
  }
  const transfer=compileGenericSkill('generic:buff:area:restore',5,u.id);expect(abilityCost(u,transfer)).toEqual(abilityCost(old,transfer));
 });
 it('fresh cap migration is idempotent and explicit/depleted SP is never refilled',()=>{
  for(const have of [0,0.25,2.5,16,25])for(const explicit of [false,true]){
   const u=make();prepareResourceModel(u,V10_OVERFLOW_D20);u.resources.SP=have;if(explicit)u.storyState={...u.storyState,resources:true};
   prepareResourceModel(u,V11_OVERFLOW_D20);expect(u.resources.SP).toBe(Math.min(have,16));
   const before=JSON.stringify(u);prepareResourceModel(u,V11_OVERFLOW_D20);expect(JSON.stringify(u)).toBe(before);
  }
  const u=make();prepareResourceModel(u,V11_OVERFLOW_D20);u.resources.SP=0.5;prepareResourceModel(u,V8_OVERFLOW_D20);expect(u.resources.SP).toBe(0.5);expect(spRecovery(u)).toBe(0);
 });
 it('classification stays tied to prepared learned magic or actual equipment, without free refills',()=>{
  const u=make('a',5,false);prepareResourceModel(u,V11_OVERFLOW_D20);u.resources.SP=1.25;
  const spell=compileGenericSkill('generic:magic-single',5,u.id);u.abilities.push(spell);
  expect(casterReserve(u)).toBe(false);expect(spCapacity(u)).toBe(9);
  u.preparedAbilityIds!.push(spell.id);expect(casterReserve(u)).toBe(true);expect(spCapacity(u)).toBe(16);expect(u.resources.SP).toBe(1.25);
 });
 it('new snapshots and archive validation accept fractional effort but reject unknown versions',()=>{
  const u=make();prepareResourceModel(u,V11_OVERFLOW_D20);u.tacticalEffort=1.25;u.fatigue=3.75;u.resources.SP=0.25;
  expect(()=>validateTacticalEffort(1.25,'endurance-v2')).not.toThrow();expect(()=>validateTacticalEffort(NaN,'endurance-v2')).toThrow();
  expect(combatantFromUnknown(JSON.parse(JSON.stringify(u))).resourceModel).toBe('endurance-v2');
  const r=unitRecordFromCombatant(u),restored=materializeUnitRecord(r,registry);expect(restored.resourceModel).toBe('endurance-v2');
  expect(()=>combatantFromUnknown({...u,resourceModel:'future-invalid'})).toThrow('资源');
  // Unit-set's fractional fatigue validation must not accidentally fall back to pre-V9 integers.
  const changed=applyUnitSet({storage:[r],rosterIds:['a']},'a',{fatigue:2.25,resources:{SP:0.5}},'v11-test');
  expect(materializeUnitRecord(changed.storage![0]!,registry).fatigue).toBe(2.25);
 });
 it.each(['small','mass']as const)('%s paid low-SP save restore is identical, and V10 remains V10',mode=>{
  for(const rules of [mode==='small'?V11_OVERFLOW_D20:V11_OVERFLOW_TW,mode==='small'?V10_OVERFLOW_D20:V10_OVERFLOW_TW]){
   const {a,b}=battle(mode,rules);a.resources.SP=5.25;a.fatigue=1.5;
   step(b);const snap=JSON.parse(JSON.stringify(b.toSnapshot()));
   const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(snap,{traitRegistry:registry}):MassBattle.fromSnapshot(snap,{traitRegistry:registry});
   expect(restored.rules.id).toBe(rules.id);expect(restored.byId('a').resources.SP).toBe(a.resources.SP);
   for(let i=0;i<12;i++){step(b);step(restored);}
   expect(restored.log).toEqual(b.log);expect(restored.combatants.map(memberHealth)).toEqual(b.combatants.map(memberHealth));
   expect(restored.combatants.map(u=>u.resources)).toEqual(b.combatants.map(u=>u.resources));
  }
 });
 it('rest forecast, recovery caps and suppression still use the endurance model',()=>{
  const {a,e,b}=battle('small');a.resources.SP=0;a.fatigue=1;
  const ctx={units:[a,e],mode:'small' as const,fieldTags:[],battlefield:(b as SmallBattle).battlefield,rules:b.rules};
  expect(nextResourceState(ctx,a,true).resources.SP).toBeGreaterThan(nextResourceState(ctx,a).resources.SP!);
  expect(Number.isFinite(tacticalRestValue(ctx,a))).toBe(true);
  for(let i=0;i<100;i++)recoverSp(a,true);expect(a.resources.SP).toBe(spCapacity(a));
  a.resources.SP=0;expect(spRecovery(a,false,true)).toBe(0);a.status='routing';expect(spRecovery(a,true)).toBe(0);
 });
 it('soft40 is continuous, monotone, gated by penetration, and never changes V10 or attacks L7+',()=>{
  const soft='continuous-soft40-v1' as const,old='continuous-v1' as const;
  for(let pi=10;pi<=100;pi++){const p=pi/10,x=Math.max(0,Math.min(1,(p-3)/4)),w=.4+.6*(3*x*x-2*x*x*x);
   let last=Infinity;for(let di=10;di<=100;di++){const d=di/10,m=gradeOvermatch(p,d,30,0,soft),base=gradeOvermatch(p,d,30,0,old);
    expect(m).toBeCloseTo(1+w*(base-1),10);expect(m).toBeLessThanOrEqual(last+1e-10);last=m;
    expect(gradeOvermatch(p,d,10,10,soft)).toBe(1);if(p>=7)expect(m).toBe(base);if(p<=d)expect(m).toBe(1);
   }
  }
  for(const p of [3,7])expect(Math.abs(gradeOvermatch(p+1e-8,1,30,0,soft)-gradeOvermatch(p-1e-8,1,30,0,soft))).toBeLessThan(1e-4);
  for(const bad of [undefined,NaN,Infinity,0,11])expect(gradeOvermatch(bad,1,30,0,soft)).toBe(1);
  expect(rulesById('v10-overflow-d20').overmatchCurve).toBe(old);expect(rulesById('v10-overflow-d20').resourceModel).toBe('endurance-v1');
  expect(rulesById('v11-overflow-d20').overmatchCurve).toBe(soft);
 });
});
