import { expect, it } from 'vitest';
import { generateUnit, SmallBattle, V11_OVERFLOW_D20, V8_OVERFLOW_TW, standardConditionMap, traitRegistry, previewAttack, compileSkill, prepareCombatModel, standardField, generatedLayeredField } from '../src/index.js';
import { diceMean } from '../src/dice.js';
import { diceDistribution } from '../src/probability.js';
import { abilityUsed } from '../src/ability-state.js';
import { memberHealth } from '../src/member-health.js';
import { calibrateWeaponRange } from '../src/data/weapons.js';
import { prepareBattleObjective } from '../../panel/src/battle-setup.js';
import { createStructure } from '../src/small/layers.js';

function unit(id:string,side:'ally'|'enemy',scale:'hero'|'company'='hero') {
  const u=generateUnit({name:id,side,scale,hpMax:scale==='company'?10:300,level:1,rulesVersion:'v2',damageModel:'wounds-v2',weaponClass:'sword',armorTier:0,traits:[]},{seed:id,noVariance:true}).unit;
  u.id=id;return u;
}
it('the first activation ticks existing damage and skips stun; a newly stunned caster spends nothing',()=>{
  const a=unit('a','ally'),e=unit('e','enemy');a.base.spd=100;e.base.spd=-100;
  a.conditions=[{id:'burning',dur:1},{id:'stunned',dur:1}];
  const battle=new SmallBattle({combatants:[a,e],seed:'opening-state',rules:V11_OVERFLOW_D20});
  const before=memberHealth(a);battle.start();
  expect(memberHealth(battle.byId('a'))).toBeLessThan(before);expect(battle.active?.id).toBe('e');
  const actor=battle.active!,spell=compileSkill('generic:magic-single',1,actor.id);
  actor.abilities=[spell];actor.preparedAbilityIds=[spell.id];actor.conditions.push({id:'stunned',dur:2});
  const saved=JSON.stringify(actor);expect(battle.useAbility(actor.id,spell.id,'a').ok).toBe(false);expect(JSON.stringify(actor)).toBe(saved);
  const both=[unit('x','ally'),unit('y','enemy')];both.forEach(u=>u.conditions=[{id:'stunned',dur:1}]);
  const skipped=new SmallBattle({combatants:both,seed:'all-opening-stunned',rules:V11_OVERFLOW_D20});skipped.start();
  expect(skipped.round).toBe(2);expect(skipped.active).toBeDefined();
});
it('different zone skills retain independent uses while aliases keep their spent count',()=>{
  const a=unit('a','ally'),e=unit('e','enemy');a.base.spd=100;e.base.spd=-100;
  const smoke=compileSkill('generic:buff:zone-smoke',1,a.id),heal=compileSkill('generic:buff:zone-healing',1,a.id);
  smoke.usesPerBattle=heal.usesPerBattle=1;smoke.cost=heal.cost=undefined;
  a.abilities=[smoke,heal];a.preparedAbilityIds=[smoke.id,heal.id];
  const battle=new SmallBattle({combatants:[a,e],seed:'zone-uses',rules:V11_OVERFLOW_D20,battlefield:standardField()});battle.start();
  const actor=battle.byId('a');expect(battle.useAbility('a',smoke.id,'cell:'+actor.pos).ok).toBe(true);
  expect(abilityUsed(actor,smoke)).toBe(1);expect(abilityUsed(actor,heal)).toBe(0);
  expect(abilityUsed(actor,{...smoke,id:'new-alias',name:'改名烟幕'})).toBe(1);
});
it('keep-high/low dice share execution semantics and critical flat modifiers count once',()=>{
  expect(diceMean('4d6kh3')).toBeCloseTo(12.2445987654321,10);
  expect(diceMean('2d20kh1')+diceMean('2d20kl1')).toBeCloseTo(21,10);
  const dist=diceDistribution('2d6kh1+3',2)!;
  expect([...dist].reduce((s,[v,p])=>s+v*p,0)).toBeCloseTo((diceMean('2d6kh1')*2)+3,10);
  const a=unit('a','ally'),d=unit('d','enemy');
  const preview=previewAttack({attacker:a,defender:d,rules:V11_OVERFLOW_D20,conditionDefs:standardConditionMap(),abilityDamage:{baseDice:'4d6kh3',penetration:100,delivery:'magic'}});
  expect(preview.expectedDamage).toBeGreaterThan(0);
});
it('multi-shot casualties accumulate wounds, invalidate by wound distribution, and leave live state unchanged',()=>{
  const a=unit('a','ally'),d=unit('d','enemy','company');prepareCombatModel(d,V11_OVERFLOW_D20,10);
  a.weapon={id:'burst',name:'连发',baseDice:'1d2+2',penetration:100,attacks:6,range:3,tags:['ranged'],customized:true,powerModel:'anchors-v1'};
  const opts={attacker:a,defender:d,ranged:true,rules:{...V8_OVERFLOW_TW,tw:{...V8_OVERFLOW_TW.tw,min:1,max:1}},conditionDefs:standardConditionMap(),traitRegistry:traitRegistry()};
  const before=JSON.stringify([a,d]),healthy=previewAttack(opts);
  expect(healthy.expectedCasualties).toBeGreaterThan(0);expect(JSON.stringify([a,d])).toBe(before);
  d.formation!.health=[{count:d.hp,hp:1}];
  const wounded=previewAttack(opts);expect(wounded.expectedCasualties).toBeGreaterThan(healthy.expectedCasualties!);
});
it('battle preparation preserves a generated negative range adjustment',()=>{
  const a=generateUnit({name:'短射步枪',side:'ally',scale:'hero',level:2,rulesVersion:'v2',damageModel:'wounds-v2',weaponClass:'rifle',weaponBonuses:{range:-6},traits:[]},{seed:'negative-range'}).unit;
  const before=a.weapon!.range;calibrateWeaponRange(a.weapon);expect(a.weapon!.range).toBe(before);
});
it('a defender without current contact can climb toward a public firing arc',()=>{
  const a=unit('a','ally'),e=unit('e','enemy');a.weapon=generateUnit({name:'bow',side:'ally',scale:'hero',rulesVersion:'v2',level:1,weaponClass:'bow',traits:[]},{seed:'bow'}).unit.weapon;
  a.base.spd=100;e.base.spd=-100;a.pos=59;e.pos=10;
  const field=standardField(7,13);field.tiles.fill('open');field.layerVersion=1;field.structures=field.tiles.map(()=>null);field.overlays={};field.landmarks=[];
  const wall=Array.from({length:7},(_,x)=>42+x);
  wall.forEach(p=>field.structures![p]=createStructure('wall',3,{top:true,access:[p+7]}));
  field.city={shape:'front',inside:Array.from({length:42},(_,i)=>49+i),frontline:wall,gates:[],core:[80],reserve:[73],defender:'ally'};
  field.objective={kind:'control',cell:80,cells:[80],attackingSide:'enemy',rounds:2,limit:60};
  const battle=new SmallBattle({combatants:[a,e],battlefield:field,field:{tags:['night']},rules:V11_OVERFLOW_D20,seed:'wall-fire'});battle.start();
  expect(battle.visibleCombatants('ally').some(u=>u.id==='e')).toBe(false);battle.autoAction('a');
  // Night movement cannot pay the approach and climb in the same activation.
  if (!battle.byId('a').elevation) {battle.endTurn();battle.autoAction('a');}
  expect(battle.byId('a').elevation,battle.log.map(e=>e.text).join('\n')).toBe(1);
});
it('enemy-directed control retains ownership; neutral control uses both deployment distances',()=>{
  const field=standardField(7,13),roster=[unit('a','ally'),unit('e','enemy')];
  field.initialDeployment={a:{pos:87},e:{pos:3}};
  field.scene={version:1,regions:[{id:'target',kind:'position',label:'目标',cells:[45],access:[45]}],fulfilled:[],objectiveRegion:{id:'target',relation:'targets',side:'enemy'}};
  expect(prepareBattleObjective(field,roster,'control').objective).toMatchObject({attackingSide:'enemy',cell:45});
  delete field.scene;field.objective.cell=10;
  const neutral=prepareBattleObjective(field,roster,'control').objective;
  expect(Math.floor(neutral.cell/7)).toBe(6);expect(neutral).not.toHaveProperty('attackingSide');
});
it('more than five narrative landmarks fit without erasing deep water or destroyed facilities',()=>{
  const field=generatedLayeredField('many-marks',7,13,['plains'],{plan:{scene:'field',water:'none',intent:{schema:'scene-intent-v1',entities:Array.from({length:6},(_,i)=>({id:'mark'+i,kind:'cover',anchor:(['north_west','north_east','west','east','south_west','south_east'] as const)[i],state:i===0?'destroyed':'intact',basis:'inferred',sources:[]})),relations:[],constraints:[]}}});
  expect(field.landmarks).toHaveLength(6);
  const destroyed=field.scene!.regions.find(r=>r.id==='mark0')!;expect(destroyed.cells.every(p=>field.structures![p]!.hp===0)).toBe(true);
  const water=generatedLayeredField('marsh-review',7,13,['swamp'],{plan:{water:'river',bridgePlan:[],landmarks:[]}});
  expect(water.tiles.slice(6*water.width,7*water.width).every(t=>t==='deep_water')).toBe(true);
});
