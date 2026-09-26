import { describe, expect, it } from 'vitest';
import { SmallBattle, MassBattle, V4_D20, V4_TW, generateUnit, traitRegistry, standardField, compileGenericSkill, type Combatant, type GenerateInput, type Ability } from '../src/index.js';
import { skillEffectValue } from '../src/skill-effects.js';
import { actionPotential } from '../src/skill-tactics.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
const registry=traitRegistry();
function make(id:string,side:'ally'|'enemy',extra:Partial<GenerateInput>={}) {
  const u=generateUnit({rulesVersion:'v2',name:id,side,scale:'hero',level:5,hpMax:500,weaponClass:'sword',weaponLevel:1,armorTier:0,traits:[],...extra},{registry,seed:id,noVariance:true}).unit;u.id=id;return u;
}
function skill(u:Combatant,definition:string,overrides:Partial<Ability>={}) {
  const a=compileGenericSkill(definition,5,u.id);Object.assign(a,overrides);u.abilities.push(a);(u.preparedAbilityIds??=[]).push(a.id);upgradeCombatSkills(u);return a;
}
function battle(units:Combatant[],mode:'small'|'mass'='small') {
  const field=standardField();field.tiles.fill('open');
  const b=mode==='small'?new SmallBattle({combatants:units,rules:V4_D20,traitRegistry:registry,battlefield:field,seed:'tactics'}):new MassBattle({combatants:units,rules:V4_TW,traitRegistry:registry,seed:'tactics'});
  b.start();units.forEach(u=>{u.pos=u.side==='ally'?31:24;u.formationPosition=u.side==='ally'?'ally:中军:front':'enemy:中军:front';});
  if(b instanceof SmallBattle){b.turnOrder=units.map(u=>u.id);b.turnIndex=0;b.movementSpent.set(units[0]!.id,99);}return b;
}
describe('实际行动收益驱动技能选择',()=>{
  it.each(['small','mass'] as const)('%s：弱输出控制者优先阻止高威胁攻击，评分和预览不修改状态',mode=>{
    const actor=make('controller','ally',{scale:mode==='mass'?'company':'hero',hpMax:mode==='mass'?20:500});
    const foe=make('threat','enemy',{scale:actor.scale,hpMax:actor.hp,weaponLevel:8});const b=battle([actor,foe],mode);
    const stun=skill(actor,'generic:debuff:stun');const before=JSON.stringify(b.toSnapshot());
    const context=b.observationContext();expect(skillEffectValue(context,actor,foe,stun)).toBeGreaterThan(actionPotential(context,actor));
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    if(b instanceof MassBattle)expect(b.recommendedOrder(actor.id)).toMatchObject({type:'ability',abilityId:stun.id,targetId:foe.id});
    else {b.autoAction(actor.id);expect(actor.abilityState.find(s=>s.abilityId===stun.cooldownGroup)?.used).toBe(1);}
  });
  it('缴械不针对天生武器，沉默不封锁普通法杖，空资源与冷却技能没有虚假威胁',()=>{
    const actor=make('controller','ally'),natural=make('natural','enemy',{weaponClass:'natural',weaponLevel:6}),b=battle([actor,natural]);
    const disarm=skill(actor,'generic:debuff:disarm'),silence=skill(actor,'generic:debuff:silence');
    expect(skillEffectValue(b.observationContext(),actor,natural,disarm)).toBe(0);
    expect(skillEffectValue(b.observationContext(),actor,natural,silence)).toBe(0);
    const bolt=skill(natural,'generic:magic-single:arcane');delete natural.weapon;natural.resources.SP=0;
    expect(skillEffectValue(b.observationContext(),actor,natural,silence)).toBe(0);
    natural.resources.SP=10;natural.abilityState=[{abilityId:bolt.cooldownGroup!,cdLeft:2,used:0}];
    expect(skillEffectValue(b.observationContext(),actor,natural,silence)).toBe(0);
    natural.abilityState=[];expect(skillEffectValue(b.observationContext(),actor,natural,silence)).toBeGreaterThan(0);
  });
  it('复合控制按成功组合计边际收益，不能重复计算同一次行动',()=>{
    const actor=make('controller','ally'),foe=make('threat','enemy',{weaponLevel:7}),b=battle([actor,foe]);
    const base=skill(actor,'generic:debuff:stun',{customized:true,effects:[{op:'condition',conditionId:'stunned',dur:1}]});
    const all={...base,effects:[...base.effects,{op:'condition' as const,conditionId:'disarmed',dur:1},{op:'condition' as const,conditionId:'silenced',dur:1}]};
    const context=b.observationContext();expect(skillEffectValue(context,actor,foe,all)).toBeCloseTo(skillEffectValue(context,actor,foe,base));
    foe.conditions=[{id:'stunned',dur:2}];expect(skillEffectValue(b.observationContext(),actor,foe,base)).toBe(0);
  });
  it('净化评估恢复的队友行动，无状态目标为零；回能只额外奖励解锁的可用技能',()=>{
    const actor=make('support','ally'),friend=make('friend','ally',{weaponLevel:7}),foe=make('foe','enemy'),b=battle([actor,foe,friend]);
    const cleanse=skill(actor,'generic:buff:cleanse');friend.conditions=[{id:'stunned',dur:2}];
    const locked=skillEffectValue(b.observationContext(),actor,friend,cleanse);expect(locked).toBeGreaterThan(10);
    friend.conditions=[];expect(skillEffectValue(b.observationContext(),actor,friend,cleanse)).toBe(0);
    delete friend.weapon;friend.resources.SP=0;
    const restore=skill(actor,'generic:buff:restore',{customized:true,cost:{resource:'SP',amount:2},effects:[{op:'resource',resource:'SP',amount:2,maximum:'training'}]});
    const empty=skillEffectValue(b.observationContext(),actor,friend,restore);expect(empty).toBe(3);
    skill(friend,'generic:magic-single:arcane');expect(skillEffectValue(b.observationContext(),actor,friend,restore)).toBeGreaterThan(empty);
  });
  it('屏障受实际来袭上限限制，惊惧尊重不溃，未被观测的威胁不改变估值',()=>{
    const actor=make('support','ally'),foe=make('hidden','enemy',{traits:['stalk']}),b=battle([actor,foe]);foe.pos=0;
    const ward=skill(actor,'generic:buff:defense',{customized:true,effects:[{op:'barrier',amount:10000,dur:2}]});
    const context={...b.observationContext(),units:[actor]};expect(skillEffectValue(context,actor,actor,ward)).toBe(0);
    foe.pos=24;foe.traits=['steadfast'];const fear=skill(actor,'generic:debuff:fear');
    expect(skillEffectValue(b.observationContext(),actor,foe,fear)).toBe(0);
  });
});
