import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, prepareCombatModel, V4_D20, V5_D20, V5_TW, V5_OVERFLOW_D20, SmallBattle, MassBattle, standardField, standardConditionMap, compileGenericSkill } from '../src/index.js';
import { anchoredWeapon, anchoredProtection, armorPowerScale, armorTransmission, shieldTransmission, shieldProtection, woundBudget } from '../src/power-anchors.js';
import { previewAttack, resolveAttack, penetrationContext } from '../src/damage.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
import { SeededRng } from '../src/rng.js';
import { rulesById } from '../src/rules.js';
import { placeZone, settleZones } from '../src/area-effects.js';
import { conditionDamage } from '../src/afflictions.js';
import type { DamageChannel, GenerateInput, RulePack } from '../src/types.js';

const registry=traitRegistry(), conditionDefs=standardConditionMap();
function unit(id:string, extra:Partial<GenerateInput>={},rules:RulePack=V5_D20){
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',scale:'hero',rulesVersion:'v2',level:5,hpMax:42,weaponClass:'rifle',weaponLevel:5,armorTier:3,armorLevel:5,traits:[],...extra},{seed:id,registry,noVariance:true}).unit;
  prepareCombatModel(u,rules);return u;
}
describe('V5 通道防护与创伤模型',()=>{
  it.each(['kinetic','thermal','arcane'] as const)('充分穿透 %s 后没有等级、强度或旧耐久的额外减伤',channel=>{
    for(let power=1;power<=10;power++){
      const d=unit('d',{armorLevel:power,armorBonuses:{power:10},shield:true});
      d.armor!.powerScale=10000;d.shield!.powerScale=10000;
      const penetration=Math.max(anchoredProtection(d,channel),shieldProtection(d,channel))+1;
      expect(armorTransmission(d,channel,penetration)).toBe(1);
      expect(shieldTransmission(d,channel,penetration)).toBe(1);
      expect(armorPowerScale(d)).toBe(1);
      expect(d.base.hpMax).toBe(42);
    }
  });
  it('护甲强度只影响部分穿透，通道特化与轻重甲仍有区别',()=>{
    const d=unit('d'),pen=anchoredProtection(d,'kinetic');
    const base=armorTransmission(d,'kinetic',pen);
    d.armor!.recipe!.bonuses={power:10};expect(armorTransmission(d,'kinetic',pen)).toBeLessThan(base);
    d.armor!.recipe!.bonuses={power:-10};expect(armorTransmission(d,'kinetic',pen)).toBeGreaterThan(base);
    expect(armorTransmission(d,'kinetic',pen-3)).toBe(0);
    const light=unit('l',{armorTier:1}),focused=unit('f',{armorProfile:'kinetic'});
    expect(armorTransmission(light,'kinetic',11)).toBe(1);
    expect(armorTransmission(d,'kinetic',11)).toBeLessThan(1);
    expect(armorTransmission(focused,'kinetic',11)).toBeLessThan(base);
    expect(armorTransmission(focused,'thermal',11)).toBe(1);
    const giant=unit('g',{body:'giant',armorTier:1,armorLevel:1,armorBonuses:{power:10}});
    expect(armorTransmission(giant,'kinetic',2)).toBe(.55);
  });
  it('火墙共用热能吸能且绕过盾，已经形成的内部伤损不受外甲影响',()=>{
    const a=unit('a'),d=unit('d',{armorBonuses:{power:10},shield:true});a.pos=0;d.pos=8;
    const context={units:[a,d],mode:'small' as const,fieldTags:[],battlefield:standardField()};
    placeZone(context,a,d,{op:'zone',kind:'fire',power:5,radius:0,dur:3},1,'fire');
    settleZones(context,1);
    expect(d.hp).toBe(34);
    expect(conditionDamage(d,2,{id:'bleeding',dur:1})).toBe(2);
    expect(conditionDamage({...d,armor:undefined,shield:undefined},2,{id:'bleeding',dur:1})).toBe(2);
  });
  it('盾独立承担通道防护；范围、失能与强穿透绕过掩护',()=>{
    const a=unit('a',{weaponClass:'sword'}),d=unit('d',{armorTier:0,shield:true});
    d.shield!.recipe={version:'mechanism-v2.3',mechanism:'shield',power:5,quality:3,size:'human',seed:'s',bonuses:{kineticProtection:5}};
    expect(anchoredProtection(d,'kinetic')).toBe(0);
    const opts={attacker:a,defender:d,rules:V5_D20,conditionDefs};
    expect(penetrationContext(opts).shieldFactor).toBeLessThan(1);
    expect(penetrationContext({...opts,abilityDamage:{baseDice:'8d6',channel:'kinetic',penetration:10,shape:'burst'}}).shieldFactor).toBe(1);
    d.conditions=[{id:'stunned',dur:1}];expect(penetrationContext(opts).shieldFactor).toBe(1);
    d.conditions=[];d.status='routing';expect(penetrationContext(opts).shieldFactor).toBe(1);
    d.status='ready';expect(penetrationContext({...opts,abilityDamage:{baseDice:'8d6',channel:'kinetic',penetration:30}}).shieldFactor).toBe(1);
  });
  it('预览与实际掷骰共用护甲和盾处理，含暴击与生命上限',()=>{
    const a=unit('a'),d=unit('d',{armorLevel:3,shield:true});
    a.weapon={id:'test',name:'固定测试投射',baseDice:'8d6',range:3,tags:['ranged'],channel:'kinetic',penetration:6};
    const opts={attacker:a,defender:d,rules:V5_D20,conditionDefs,traitRegistry:registry,ranged:true,distance:2};
    const p=previewAttack(opts), rng=new SeededRng('wound-shield-moments');
    expect(p.armorFactor).toBeCloseTo(.3);expect(p.shieldFactor).toBeLessThan(1);expect(p.exact).toBe(true);
    let total=0;const n=2000;
    for(let i=0;i<n;i++)total+=resolveAttack({...opts,defender:structuredClone(d),rng}).finalDamage;
    expect(Math.abs(total/n-p.expectedDamage)).toBeLessThan(5*Math.sqrt(p.variance!/n));
  });
  it('武器单体毁伤与范围独立；投影不改实物，不重复换算',()=>{
    const a=unit('a',{weaponClass:'cannon',weaponLevel:10,body:'vehicle'}),original=structuredClone(a.weapon);
    const old=anchoredWeapon(a.weapon)!,next=anchoredWeapon(a.weapon,'he','wounds-v1')!;
    expect(next.damageScale).toBeLessThan(old.damageScale!);
    expect(next.penetration).toBe(old.penetration);expect(next.splashTargets).toBe(old.splashTargets);
    expect(anchoredWeapon(next,'he','wounds-v1')).toBe(next);
    expect(anchoredWeapon(old,'he','wounds-v1')!.damageScale).toBeCloseTo(next.damageScale!);
    expect(anchoredWeapon(next)!.damageScale).toBeCloseTo(old.damageScale!);
    expect(a.weapon).toEqual(original);
    const custom={...old,customized:true};expect(anchoredWeapon(custom,'he','wounds-v1')).toBe(custom);
  });
  it('技能迁移保持冷却、使用次数与身份，并按新创伤预算治疗',()=>{
    const u=unit('a',{},V4_D20),a=compileGenericSkill('generic:buff:heal',5,u.id);
    u.abilities=[a];u.preparedAbilityIds=[a.id];upgradeCombatSkills(u);
    const id=a.id,old=structuredClone(a.effects),SP=u.resources.SP;
    u.abilityState=[{abilityId:a.cooldownGroup!,cdLeft:2,used:1}];const ledger=structuredClone(u.abilityState);
    prepareCombatModel(u,V5_D20);upgradeCombatSkills(u);
    expect(a.effectVersion).toBe('skill-v5.0');expect(a.effects).toEqual([{op:'heal',amount:woundBudget(5)}]);
    expect(a.id).toBe(id);expect(u.preparedAbilityIds).toEqual([id]);expect(u.abilityState).toEqual(ledger);expect(u.resources.SP).toBe(SP);
    const saved=JSON.stringify(u);upgradeCombatSkills(u);expect(JSON.stringify(u)).toBe(saved);
    prepareCombatModel(u,V4_D20);upgradeCombatSkills(u);expect(a.effects).toEqual(old);expect(u.damageModel).toBeUndefined();
  });
  it.each([V4_D20,V5_OVERFLOW_D20])('小战 $id 读档继续保留原规则及随机结果',rules=>{
    const a=unit('a',{},rules),d=unit('d',{},rules),battle=new SmallBattle({combatants:[a,d],rules,traitRegistry:registry,battlefield:standardField(),seed:'restore'});
    battle.start();a.pos=38;d.pos=24;
    const saved=JSON.parse(JSON.stringify(battle.toSnapshot()));
    const restored=SmallBattle.fromSnapshot(saved,{traitRegistry:registry});
    expect(restored.rules.damageModel).toBe(rules.damageModel);
    for(const b of [battle,restored])for(let n=0;n<2&&!b.isOver();n++)b.autoAction(b.active!.id);
    expect(restored.combatants.map(u=>[u.hp,u.damageModel,u.status])).toEqual(battle.combatants.map(u=>[u.hp,u.damageModel,u.status]));
    if(!rules.damageModel)expect(armorPowerScale(restored.combatants[0]!)).toBe(6.25);
  });
  it('V5 会战伤损组读档不重置，未知版本不回退',()=>{
    const units=[unit('a',{scale:'company',hpMax:30},V5_TW),unit('d',{scale:'company',hpMax:30},V5_TW)];
    units.forEach(u=>u.tags.push('zone:中军','rank:front'));
    const battle=new MassBattle({combatants:units,rules:V5_TW,traitRegistry:registry,seed:'restore-mass'});battle.start();battle.autoOrders('ally');battle.autoOrders('enemy');battle.resolveRound();
    const restored=MassBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())),{traitRegistry:registry});
    expect(restored.rules.id).toBe('v5-tw');expect(restored.combatants.map(u=>u.formation)).toEqual(battle.combatants.map(u=>u.formation));
    expect(()=>rulesById('v5-unknown')).toThrow();
  });
});
