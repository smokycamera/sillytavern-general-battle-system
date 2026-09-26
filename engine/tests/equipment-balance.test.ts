import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, standardConditionMap, prepareCombatModel, previewAttack, compileSkill,
  SmallBattle, MassBattle, standardField, V4_D20, V4_TW, V4_OVERFLOW_D20, V4_OVERFLOW_TW, V3_D20,
  weaponReloadTurns, type Combatant, type RulePack } from '../src/index.js';
import { compileArmor, compileWeapon } from '../src/gen/equipment.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
import { conditionChance } from '../src/skill-effects.js';
import { skillAttack } from '../src/skill-attack.js';
import { armorPowerScale, anchoredProtection } from '../src/power-anchors.js';
import { skillResourceChange } from '../src/skill-runtime.js';
import { ignoresFriendlyScreen } from '../src/loadout.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';

const registry=traitRegistry(), conditionDefs=standardConditionMap();
function unit(id='a',power=5,weapon='sword'): Combatant {
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',scale:'hero',rulesVersion:'v2',level:5,
    hpMax:100,weaponClass:weapon,weaponLevel:power,armorTier:3,armorLevel:power,traits:[]}, {registry,seed:id,noVariance:true}).unit;
  u.id=id;return u;
}
function learned(id:string,power=5,rules=V4_D20) {
  const a=unit('a',power);a.abilities=[compileSkill(id,power,a.id)];a.preparedAbilityIds=[a.abilities[0]!.id];
  prepareCombatModel(a,rules);upgradeCombatSkills(a);return a;
}
function damage(a:Combatant,d:Combatant,rules:RulePack,ability=false) {
  const skill=a.abilities[0],effect=skill?.effects.find(e=>e.op==='damage');
  return previewAttack({attacker:a,defender:d,rules,distance:1,conditionDefs,traitRegistry:registry,
    ...(ability&&effect?.op==='damage'?skillAttack({mode:'small',units:[a,d],fieldTags:[]},a,d,skill!,effect,rules):{})});
}
describe('装备与技能的机会成本和差异',()=>{
  it.each([V4_D20,V4_TW,V4_OVERFLOW_D20,V4_OVERFLOW_TW])('$id 轻型投射持续火力与投掷单发各有优势，旧投掷实物不重掷',rules=>{
    for(const power of [2,3,5,8,10]) {
      const light=unit('a',power,'light-ranged'),throwing=unit('a',power,'throwing'),d=unit('d',power);
      for(const u of [light,throwing,d])prepareCombatModel(u,rules);
      const opts={defender:d,rules,ranged:true,distance:2,conditionDefs,traitRegistry:registry};
      const l=previewAttack({...opts,attacker:light}).expectedDamage,t=previewAttack({...opts,attacker:throwing}).expectedDamage;
      expect(t).toBeGreaterThan(l);expect(t/(1+weaponReloadTurns(throwing.weapon))).toBeLessThan(l);
      expect(throwing.weapon!.range).toBeGreaterThan(light.weapon!.range!);
      const old=structuredClone(throwing.weapon!);delete old.reload;const before=JSON.stringify(old);
      expect(weaponReloadTurns(old)).toBe(1);expect(JSON.stringify(old)).toBe(before);
      expect(weaponReloadTurns({...old,reload:0,customized:true})).toBe(0);
    }
  });
  it.each([V4_D20,V4_TW])('$id L1–10 专用控制比眩晕便宜、更易生效，多控制不免费附送',rules=>{
    for(let power=1;power<=10;power++) {
      const stun=learned('generic:debuff:stun',power,rules).abilities[0]!,d=unit('d',power);
      const stunEffect=stun.effects.find(e=>e.op==='condition')!;
      if(stunEffect.op!=='condition')throw Error('fixture');
      for(const id of ['root','silence','disarm']) {
        const focused=learned('generic:debuff:'+id,power,rules).abilities[0]!,e=focused.effects[0]!;
        if(e.op!=='condition')throw Error('fixture');
        expect(focused.cost!.amount).toBeLessThan(stun.cost!.amount);
        expect(focused.cooldown!).toBeLessThan(stun.cooldown!);
        expect(conditionChance(d,e)).toBeGreaterThan(conditionChance(d,stunEffect));
      }
      const combined=learned('generic:debuff:stun+root',power,rules).abilities[0]!;
      expect(combined.cost!.amount).toBeGreaterThan(stun.cost!.amount);
      const e=combined.effects.find(e=>e.op==='condition'&&e.conditionId==='stunned')!;
      if(e.op!=='condition')throw Error('fixture');
      expect(conditionChance(d,e)).toBeLessThanOrEqual(conditionChance(d,stunEffect));
      for(const kind of ['magic-single','physical-single']) {
        const pure=learned('generic:'+kind,power,rules).abilities[0]!,control=learned('generic:'+kind+':stun',power,rules).abilities[0]!;
        expect(control.cost!.amount).toBeGreaterThan(pure.cost!.amount);
        expect(control.cooldown!).toBeGreaterThan(pure.cooldown!);
      }
    }
  });
  it('L1–10 混合治疗共享预算；带回能的治疗仍有净精力消耗，包括强化',()=>{
    for(let power=1;power<=10;power++)for(const bonuses of [undefined,{resource:10,healing:10}]){
      const heal=learned('generic:buff:heal',power).abilities[0]!;
      for(const suffix of ['barrier','restore']) {
        const a=unit('a',power);a.abilities=[compileSkill({id:'generic:buff:heal+'+suffix,bonuses},power,a.id)];prepareCombatModel(a,V4_D20);upgradeCombatSkills(a);
        const s=a.abilities[0]!,h=s.effects.find(e=>e.op==='heal')!,pure=heal.effects[0]!;
        if(h.op!=='heal'||pure.op!=='heal')throw Error('fixture');
        if(!bonuses)expect(h.amount!).toBeLessThan(pure.amount!);
        if(suffix==='restore'){
          const effect=s.effects.find(e=>e.op==='resource')!;if(effect.op!=='resource')throw Error('fixture');
          expect(s.cost!.amount).toBeGreaterThan(effect.amount);
          const restored=skillResourceChange({...a,resources:{...a.resources,SP:0}},effect);
          expect(restored-s.cost!.amount).toBeLessThan(0);
        }
      }
    }
  });
  it.each([V4_D20,V4_TW,V4_OVERFLOW_D20,V4_OVERFLOW_TW])('$id 同级盾击保持规格缩放，低级盾不能借高级技能穿高级甲',rules=>{
    for(const power of [3,5,8,10]){
      const a=learned('generic:physical-single:shield',power,rules),d=unit('d',power);prepareCombatModel(d,rules);
      const shield=(p:number)=>({id:'shield',load:2,recipe:{version:'mechanism-v2.3' as const,mechanism:'shield',power:p,quality:3,size:'human' as const,seed:'shield'}});
      a.shield=shield(power);const p=damage(a,d,rules,true);expect(p.expectedDamage).toBeGreaterThan(0);expect(p.penetration).toBe(2*power);
      a.shield=shield(1);expect(damage(a,d,rules,true).expectedDamage).toBe(0);
    }
  });
  it('升级旧公式保留技能身份、强化和冷却次数，重复入场及读档不倍增',()=>{
    const a=unit();a.abilities=[compileSkill({id:'generic:magic-single:stun',bonuses:{accuracy:5,damage:4,range:5}},5,a.id)];
    prepareCombatModel(a,V4_D20);upgradeCombatSkills(a);const skill=a.abilities[0]!;
    const expected=structuredClone(skill);
    skill.effectVersion='skill-v4.1';skill.recipe!.version='skill-formula-v1';skill.cost!.amount=3;skill.cooldown=1;
    a.abilityState=[{abilityId:skill.cooldownGroup!,cdLeft:2,used:1}];
    const id=skill.id,group=skill.cooldownGroup,state=structuredClone(a.abilityState);
    upgradeCombatSkills(a);expect(skill.id).toBe(id);expect(skill.cooldownGroup).toBe(group);expect(a.abilityState).toEqual(state);
    expect(skill).toEqual(expected);expect(combatantFromUnknown(structuredClone(a)).abilities).toEqual(a.abilities);
    expect(skill.cost!.amount).toBe(4);expect(skill.cooldown).toBe(3);
    const after=structuredClone(a);upgradeCombatSkills(a);expect(a).toEqual(after);
    const custom=structuredClone(after);custom.abilities[0]!.customized=true;custom.abilities[0]!.effectVersion='skill-v4.1';
    const frozen=structuredClone(custom);upgradeCombatSkills(custom);expect(custom).toEqual(frozen);
    const legacy=learned('generic:magic-single:stun',5,V3_D20),snapshot=structuredClone(legacy);upgradeCombatSkills(legacy);expect(legacy).toEqual(snapshot);
  });
  it.each(['small','mass'])('%s 实际混合治疗扣净费用，投掷进入独立装填，存档保留支付记录',mode=>{
    const a=learned('generic:buff:heal+restore',3),d=unit('d',3);
    if(mode==='mass'){a.body='large';d.body='large';}
    a.weapon=compileWeapon({mechanism:'throwing',power:3},{id:'throw',seed:'throw',noVariance:true});a.hp=10;
    const field=standardField();field.tiles.fill('open');
    const b=mode==='small'?new SmallBattle({combatants:[a,d],battlefield:field,rules:V4_D20,seed:'balance-cast'}):new MassBattle({combatants:[a,d],rules:V4_TW,seed:'balance-cast'});
    b.start();if(b instanceof SmallBattle){b.turnOrder=['a','d'];b.turnIndex=0;a.pos=38;d.pos=31;}
    const before=a.resources.SP!,hp=a.hp,s=a.abilities[0]!;expect(b.useAbility(a.id,s.id,a.id).ok).toBe(true);
    if(b instanceof MassBattle){b.issue({unitId:d.id,type:'hold'});b.resolveRound();}
    expect(a.hp).toBeGreaterThan(hp);expect(a.resources.SP).toBeLessThan(before);
    const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()),{traitRegistry:registry}):MassBattle.fromSnapshot(structuredClone(b.toSnapshot()),{traitRegistry:registry});
    expect(restored.byId(a.id).abilities).toEqual(a.abilities);expect(restored.byId(a.id).abilityState).toEqual(a.abilityState);expect(restored.byId(a.id).resources).toEqual(a.resources);
    if(b instanceof SmallBattle){b.endTurn();b.endTurn();b.attack(a.id,d.id);expect(b.getActionOptions(a.id).find(o=>o.id==='weapon')!.enabled).toBe(false);}
    else {b.issue({unitId:a.id,type:'volley',targetId:d.id});b.issue({unitId:d.id,type:'hold'});b.resolveRound();expect(b.orderPreview({unitId:a.id,type:'volley',targetId:d.id}).reason).toContain('装填');}
  });
  it('护甲专用构型交换防护、盾牌不乘算耐久，远程遮挡与射程保留不同用途',()=>{
    for(let power=1;power<=10;power++)for(const tier of [1,2,3,4] as const){
      const d=unit('d',power);d.armor=compileArmor({tier,power},{id:'armor',seed:'armor'});
      const balanced=['kinetic','thermal','arcane'].map(c=>anchoredProtection(d,c as 'kinetic'));
      for(const profile of ['kinetic','thermal','arcane'] as const){
        d.armor=compileArmor({tier,power,profile},{id:'armor',seed:'armor'});
        const focused=['kinetic','thermal','arcane'].map(c=>anchoredProtection(d,c as 'kinetic'));
        expect(focused.reduce((a,b)=>a+b,0)).toBe(balanced.reduce((a,b)=>a+b,0));
        const index=['kinetic','thermal','arcane'].indexOf(profile);expect(focused[index]).toBeGreaterThanOrEqual(balanced[index]!);
      }
      const before=armorPowerScale(d);d.shield={id:'shield',load:2,recipe:{version:'mechanism-v2.3',mechanism:'shield',power,quality:3,size:'human',seed:'s'}};
      expect(armorPowerScale(d)).toBe(before);
    }
    for(const mechanism of ['bow','magic'])expect(ignoresFriendlyScreen(unit('a',3,mechanism).weapon)).toBe(true);
    for(const mechanism of ['rifle','heavy-rifle','cannon','throwing'])expect(ignoresFriendlyScreen(unit('a',3,mechanism).weapon)).toBe(false);
  });
});
