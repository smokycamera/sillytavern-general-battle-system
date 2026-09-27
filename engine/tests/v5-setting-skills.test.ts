import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, V5_OVERFLOW_D20, V5_OVERFLOW_TW, V4_D20, compileSkill, standardConditionMap, traitRegistry, SmallBattle, MassBattle, standardField, memberHealthMax } from '../src/index.js';
import { anchoredWeapon } from '../src/power-anchors.js';
import { diceAvg } from '../src/data/weapons.js';
import { previewAttack, penetrationContext } from '../src/damage.js';
import { skillAttack } from '../src/skill-attack.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
import { conjureSkillUnit, summonedMemberLife } from '../src/skill-runtime.js';
import type { Combatant, GenerateInput, Ability } from '../src/types.js';
import type { Enhancements } from '../src/enhancements.js';

const rules=V5_OVERFLOW_D20,registry=traitRegistry(),conditionDefs=standardConditionMap();
const mean=(w:NonNullable<Combatant['weapon']>)=>(diceAvg(w.baseDice)+(w.apDice?diceAvg(w.apDice):0))*(w.damageScale??1);
function unit(id:string,extra:Partial<GenerateInput>={}){
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',rulesVersion:'v2',scale:'hero',level:5,hpMax:100,weaponClass:'rifle',weaponLevel:5,armorTier:3,armorLevel:5,traits:[],...extra},{seed:id,noVariance:true}).unit;
  u.id=id;prepareCombatModel(u,rules);return u;
}
function ability(u:Combatant,id:string,power:number,bonuses?:Enhancements){
  const a=compileSkill({id,bonuses},power,u.id);u.abilities=[a];u.preparedAbilityIds=[a.id];upgradeCombatSkills(u);return a;
}
function attack(a:Combatant,d:Combatant,skill:Ability){
  const e=skill.effects.find(e=>e.op==='damage');if(!e||e.op!=='damage')throw Error('expected damage');
  const context={units:[a,d],mode:'small' as const,fieldTags:[]};
  return {...skillAttack(context,a,d,skill,e,rules),attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,distance:1};
}
describe('V5 通用设定、技能与修正约束',()=>{
  it('训练与同级强化不能把低代步枪变成跨代穿甲武器',()=>{
    for(let power=1;power<=7;power++)for(const training of [1,10]){
      const a=unit('a',{level:training,weaponLevel:power,weaponBonuses:{power:10,damage:10,penetration:10,accuracy:10}}),d=unit('d',{armorLevel:power+3});
      const p=previewAttack({attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,ranged:true,distance:2});
      expect(a.weapon!.level).toBe(power);expect(p.penetrationFactor).toBe(0);expect(p.expectedDamage).toBe(0);
    }
    const trained=unit('a',{level:10,weaponLevel:5}),untrained=unit('d',{level:1,weaponLevel:8});
    expect(anchoredWeapon(trained.weapon,undefined,trained.damageModel)!.penetration).toBeLessThan(anchoredWeapon(untrained.weapon,undefined,untrained.damageModel)!.penetration!);
  });
  it.each(['kinetic','thermal','arcane'] as const)('%s 法术有相应跨代门槛，不靠精度或伤害强化绕过',channel=>{
    for(let power=1;power<=7;power++){
      const a=unit('a',{level:10}),d=unit('d',{armorLevel:power+3,armorProfile:channel});
      const s=ability(a,`generic:magic-single:${channel==='kinetic'?'projectile':channel}`,power,{power:10,damage:10,accuracy:10,penetration:10});
      if(channel==='kinetic')s.channel='kinetic';
      const p=previewAttack(attack(a,d,s));expect(p.penetrationFactor).toBe(0);expect(p.expectedDamage).toBe(0);
    }
  });
  it('正负修正有界且只作用于匹配通道；不改技术等级或重复放大武技',()=>{
    for(let n=-10;n<=10;n++){
      const a=unit('a',{weaponClass:'sword',weaponBonuses:{thermalDamage:n,arcaneDamage:10,thermalPenetration:n}}),d=unit('d');a.weapon!.channel='thermal';
      const raw=structuredClone(a.weapon!);raw.recipe!.bonuses=undefined;
      const base=anchoredWeapon(raw,undefined,'wounds-v1')!,w=anchoredWeapon(a.weapon,undefined,'wounds-v1')!;
      expect(mean(w)/mean(base)).toBeCloseTo(1+n*.05);expect(w.penetration!-base.penetration!).toBeCloseTo(n/5);expect(w.level).toBe(5);
      const s=ability(a,'generic:physical-single:melee',5),before=attack(a,d,s).abilityDamage!;
      s.bonuses={thermalDamage:n,arcaneDamage:10};const after=attack(a,d,s).abilityDamage!;
      expect(after.channel).toBe('thermal');expect(after.damageScale!/before.damageScale!).toBeCloseTo(1+n*.05);
    }
  });
  it('高阶武技受真实武器限制；名字不增加概念或无视防护能力',()=>{
    const a=unit('a',{weaponClass:'sword',weaponLevel:1}),d=unit('d',{armorLevel:5});
    const s=ability(a,'generic:physical-single:melee',10);s.name='空间切断神器';
    expect(previewAttack(attack(a,d,s)).expectedDamage).toBe(0);
    const before=JSON.stringify(attack(a,d,s).abilityDamage);s.name='普通挥击';expect(JSON.stringify(attack(a,d,s).abilityDamage)).toBe(before);
  });
  it('L10 的炮击和范围法术仍覆盖编队；不是只提升到略高的单体数值',()=>{
    const a=unit('a',{weaponClass:'cannon',weaponLevel:10,body:'vehicle'}),d=unit('d',{scale:'company',hpMax:100,armorTier:0});
    prepareCombatModel(d,rules,42);
    const w=anchoredWeapon(a.weapon,undefined,'wounds-v1')!;expect(w.splashTargets).toBeGreaterThanOrEqual(d.hp);
    const p=previewAttack({attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,ranged:true,distance:2});expect(p.expectedCasualties).toBeGreaterThan(20);
    const s=ability(a,'generic:magic-area:arcane',10);expect(s.areaExposure).toBeGreaterThanOrEqual(d.hp);
    expect(previewAttack(attack(a,d,s)).expectedCasualties).toBeGreaterThan(20);
  });
  it('治疗与复合技能分摊新预算，屏障的强度/持续修正确实生效且幂等',()=>{
    for(let power=1;power<=10;power++)for(const n of [-10,0,10]){
      const a=unit('a'),s=ability(a,'generic:buff:barrier+heal',power,{power:n,duration:n});
      const barrier=s.effects.find(e=>e.op==='barrier')!,heal=s.effects.find(e=>e.op==='heal')!;
      expect(barrier.op).toBe('barrier');expect(heal.op).toBe('heal');
      if(barrier.op==='barrier'){expect(barrier.amount).toBe(Math.max(1,Math.round(Math.round((8+power*5)/2)*(1+n*.05))));expect(barrier.dur).toBe(3+n/5);}
      const once=JSON.stringify(a);upgradeCombatSkills(a);expect(JSON.stringify(a)).toBe(once);
    }
    const old=unit('a');prepareCombatModel(old,V4_D20);
    const legacy=ability(old,'generic:buff:barrier',5,{power:10,duration:10});expect(legacy.effects).toEqual([{op:'barrier',amount:33,dur:3}]);
  });
  it('控制保留抵抗和冷却；回能复合技能不能无限免费循环',()=>{
    const a=unit('a'),control=ability(a,'generic:debuff:stun',10,{duration:10,accuracy:10});
    const effect=control.effects.find(e=>e.op==='condition')!;expect(effect.op).toBe('condition');
    if(effect.op==='condition'){expect(effect.dur).toBe(1);expect(effect.saveDC).toBeGreaterThan(0);expect(effect.saveDC).toBeLessThanOrEqual(30);}
    expect(control.cooldown).toBeGreaterThanOrEqual(3);
    const mixed=ability(a,'generic:buff:heal+restore',10,{resource:10});
    const gain=mixed.effects.find(e=>e.op==='resource')!;if(gain.op!=='resource')throw Error('expected resource');expect(mixed.cost!.amount).toBeGreaterThan(gain.amount);
  });
  it.each(['small','mass'] as const)('%s 实际召唤继承新规则，单体/群体不会混回指数伤害',mode=>{
    for(const group of [false,true]){
      const a=unit('a',{scale:mode==='mass'?'company':'hero'}),d=unit('d',{scale:mode==='mass'?'company':'hero'});a.tags.push('zone:中军','rank:front');d.tags.push('zone:中军','rank:front');
      const s=ability(a,`generic:buff:summon-${group?'group':'single'}`,8,{damage:5,range:5});
      const b=mode==='small'?new SmallBattle({combatants:[a,d],rules,seed:'v5-summon',battlefield:standardField()}):new MassBattle({combatants:[a,d],rules:V5_OVERFLOW_TW,seed:'v5-summon'});
      b.start();if(b instanceof SmallBattle){a.pos=38;d.pos=24;b.turnOrder=['a','d'];b.turnIndex=0;}
      expect(b.useAbility(a.id,s.id,a.id).ok).toBe(true);if(b instanceof MassBattle){b.issue({unitId:d.id,type:'hold'});b.resolveRound();}
      const u=b.combatants.find(u=>u.summonerId===a.id)!;expect(u.damageModel).toBe('wounds-v1');
      const single=conjureSkillUnit('conjured:single:8','ally','reference',mode,{damage:5,range:5})!;prepareCombatModel(single,rules,summonedMemberLife(single));
      const uw=anchoredWeapon(u.weapon,undefined,u.damageModel)!,sw=anchoredWeapon(single.weapon,undefined,single.damageModel)!;
      expect(mean(uw)*(group?20:1)).toBeCloseTo(mean(sw));expect(memberHealthMax(u)).toBeLessThanOrEqual(memberHealthMax(single));
      expect(mean(sw)).toBeLessThan(100);expect(uw.range).toBe(6);
      const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot()))):MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
      expect(restored.byId(u.id).damageModel).toBe('wounds-v1');expect(restored.byId(u.id).weapon).toEqual(u.weapon);
    }
  });
});
