import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, V4_D20, V4_TW, traitRegistry, standardField, applyRecovery, battleXpAwards, applyXp, previewAttack, type Combatant } from '../../engine/src/index.js';
import { powerBudget, anchoredWeapon, armorPowerScale } from '../../engine/src/power-anchors.js';
import { diceAvg } from '../../engine/src/data/weapons.js';
import { compileWeapon } from '../../engine/src/gen/equipment.js';
import { compileSkill, skillDefinitionId } from '../../engine/src/skill-catalog.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { skillAttack } from '../../engine/src/skill-attack.js';
import { prepareCombatModel } from '../../engine/src/combat-model.js';
import { bonusMultiplier, type Enhancements } from '../../engine/src/enhancements.js';
import { parseProtocol } from './protocol.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope } from './narrative-state.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { learnAbilities } from '../../engine/src/skill-learning.js';
import { gridWeaponRange } from '../../engine/src/small/weapon-range.js';
import { standardConditionMap } from '../../engine/src/conditions.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';

const registry=traitRegistry(), rng={seed:'feedback',next:()=>.4,d:(n:number)=>n};
function unit(id:string,scale:'hero'|'company'='hero',level=1,bonuses?:Enhancements):Combatant {
  const u=generateUnit({name:id,side:id==='A'?'ally':'enemy',rulesVersion:'v2',scale,level,bonuses,
    weaponClass:'sword',weaponLevel:1,armorTier:0,traits:['steadfast'],...(scale==='company'?{hpMax:30}:{})},{seed:id,registry,noVariance:true}).unit;
  u.id=id;prepareCombatModel(u,V4_D20);return u;
}
const mean=(w:ReturnType<typeof anchoredWeapon>)=>diceAvg(w!.baseDice)*(w!.damageScale??1);
function weapon(power:number,bonuses?:Enhancements){return compileWeapon({mechanism:'rifle',power,bonuses},{id:'w',seed:'fixed',noVariance:true});}
describe('反馈数值校准',()=>{
  it('L1—L10严格递增，满强化不越下一级，防具等效耐久匹配高阶输出',()=>{
    for(let p=1;p<=10;p++){
      const base=mean(anchoredWeapon(weapon(p))),plus=mean(anchoredWeapon(weapon(p,{power:10})));
      expect(plus/base).toBeCloseTo(1.5,8);
      if(p<10)expect(plus).toBeLessThan(mean(anchoredWeapon(weapon(p+1))));
      const defender=unit('D');defender.armor!.recipe!.power=p;
      defender.armor!.tier=2;
      expect(armorPowerScale(defender)).toBe(Math.max(1,powerBudget(p)/24));
    }
  });
  it('精度、射程、穿透、训练使用真正的行动预览，生命强化不扩编',()=>{
    const a=unit('A'),d=unit('D');a.weapon=weapon(1);d.base.hpMax=d.hp=1000;
    const opts={attacker:a,defender:d,rules:V4_D20,traitRegistry:registry,conditionDefs:standardConditionMap(),ranged:true,distance:2};
    const plain=previewAttack(opts);
    a.weapon=weapon(1,{accuracy:10});const accurate=previewAttack(opts);
    expect(accurate.hitChance-plain.hitChance).toBeCloseTo(.2,6);
    a.weapon=weapon(1,{range:10});expect(gridWeaponRange(a.weapon)).toBe(gridWeaponRange(weapon(1))+2);
    expect(anchoredWeapon(weapon(1,{penetration:10}))!.penetration).toBe(anchoredWeapon(weapon(1))!.penetration!+2);
    const veteran=unit('A','hero',10);veteran.weapon=a.weapon;
    expect(previewAttack({...opts,attacker:veteran}).expectedDamage).toBeGreaterThan(plain.expectedDamage*2);
    const group=unit('D','company',1,{health:10});expect(group.hp).toBe(30);expect(group.formation!.memberHp).toBe(30);
    const wounded=unit('A','hero',1,{health:10});wounded.hp=5;applyXp(wounded,900,registry);expect(wounded.hp).toBe(5);expect(wounded.base.hpMax).toBeGreaterThan(30);
  });
  it('正文强化贯穿建档、学习与保存，非法点数不会静默变成普通装备',()=>{
    const parsed=parseProtocol('<tb>\n<spawn name="A" side="ally" scale="hero" level="L1+2生命" weapon="枪:步枪L5+6精度+4伤害" armor="重甲L5+10防护" skills="火花:魔法单体L1+10"/>\n</tb>');
    expect(parsed.errors).toEqual([]);const event=parsed.events[0]!;expect(event.kind).toBe('spawn');if(event.kind!=='spawn')return;
    const source:MessageEnvelope={characterId:'c',chatId:'t',branchId:'b',messageId:'1',swipeId:'0',role:'assistant',complete:true,generationId:'g',text:parsed.canonical};
    const ns=namespaceOf(source),binding=captureGeneration({},ns,'g');binding.complete=true;
    const save=prepareNarrativeTransaction({},proposalFromMessage(source,binding)!,ns,true);
    const u=materializeUnitRecord(save.storage![0]!,registry);prepareCombatModel(u,V4_D20);upgradeCombatSkills(u);
    const restored=materializeUnitRecord(unitRecordFromCombatant(u),registry);
    expect(restored.weapon!.recipe!.bonuses).toEqual({accuracy:6,damage:4});expect(restored.bonuses).toEqual({health:2});expect(restored.abilities[0]!.bonuses).toEqual({power:10});
    const id=skillDefinitionId('魔法单体')!;
    const changed=learnAbilities(restored,[{id,name:'火花',level:1,bonuses:{accuracy:10}}]);expect(changed.abilities[0]!.bonuses).toEqual({accuracy:10});
    for(const spec of ['步枪L1+11','步枪L1+6伤害+5精度','步枪L1+3未知'])expect(parseProtocol(`<tb><spawn name="B" side="enemy" scale="hero" weapon="${spec}"/></tb>`).errors.length).toBeGreaterThan(0);
  });
  it('技能各档增长、同级强化倍率与回能守恒，学习不复叠强化',()=>{
    for(let p=1;p<=10;p++){
      const a=unit('A'),id=skillDefinitionId('魔法单体')!;
      a.abilities=[compileSkill({id,level:p,bonuses:{power:10}},p,a.id)];upgradeCombatSkills(a);
      const sk=a.abilities[0]!,damage=sk.effects.find(e=>e.op==='damage');if(damage?.op!=='damage')throw Error('missing damage');
      expect(diceAvg(damage.baseDice)*sk.damageScale!).toBeCloseTo(powerBudget(p)*2.2*1.5,5);
      const before=JSON.stringify(sk);upgradeCombatSkills(a);expect(JSON.stringify(sk)).toBe(before);
      const record=unitRecordFromCombatant(a);expect(()=>materializeUnitRecord(record,registry)).not.toThrow();
    }
    const a=unit('A');a.abilities=[compileSkill({id:skillDefinitionId('buff回能')!,bonuses:{resource:10}},5,'A')];upgradeCombatSkills(a);
    const skill=a.abilities[0]!,gain=skill.effects.find(e=>e.op==='resource');expect(gain?.op==='resource'&&skill.cost!.amount>=gain.amount).toBe(true);
    expect(bonusMultiplier({damage:10},'damage')).toBe(1.5);
  });
  it('低阶武技无法借高阶装备越级；技能射程强化在格子战生效',()=>{
    const a=unit('A'),d=unit('D');a.weapon=weapon(5);a.pos=0;d.pos=1;
    const physical=skillDefinitionId('物理单体射击')!;
    const budgets=[1,5].map(power=>{
      a.abilities=[compileSkill({id:physical},power,'A')];upgradeCombatSkills(a);
      const skill=a.abilities[0]!,effect=skill.effects.find(e=>e.op==='damage');if(effect?.op!=='damage')throw Error('missing damage');
      const context={mode:'small' as const,units:[a,d],round:1,fieldTags:[],traitRegistry:registry};
      const result=skillAttack(context,a,d,skill,effect).abilityDamage!;
      return diceAvg(result.baseDice)*(result.damageScale??1);
    });
    expect(budgets[1]!/budgets[0]!).toBeCloseTo(powerBudget(5)/powerBudget(1),6);
    a.abilities=[compileSkill({id:skillDefinitionId('魔法单体')!,bonuses:{range:10}},1,'A')];upgradeCombatSkills(a);
    expect(gridAbility(a.abilities[0]!).range!.max).toBe(9);
  });
  it.each(['small','mass'] as const)('%s实际击杀后逃跑仍有XP；恢复/重载/再次击倒不重复',mode=>{
    const a=unit('A'),d=unit('D','company');a.base.atk=100;if(mode==='mass')a.body='large';
    a.weapon={...a.weapon!,powerModel:'anchors-v1',baseDice:'1d2+50',damageScale:1,penetration:100,attacks:1};
    const opts={combatants:[a,d],rng,seed:'casualties',traitRegistry:registry,nonLethal:true};
    let battle:SmallBattle|MassBattle=mode==='small'?new SmallBattle({...opts,rules:V4_D20,battlefield:standardField()}):new MassBattle({...opts,rules:V4_TW});battle.start();
    const hit=()=>{if(battle instanceof SmallBattle){battle.byId('A').pos=28;battle.byId('D').pos=21;const r=battle.attack('A','D',{bypassTurn:true});expect(r).toBeTruthy();}else{expect(battle.issue({unitId:'A',type:'attack',targetId:'D'}).ok).toBe(true);battle.issue({unitId:'D',type:'hold'});battle.resolveRound();}};
    hit();let target=battle.byId('D');const lost=30-target.hp;expect(lost).toBeGreaterThan(0);expect(target.hp).toBeGreaterThan(0);expect(battle.xpGained).toBe(lost*25);
    const xp=battle.xpGained;expect(applyRecovery(target,10000)).toBeGreaterThan(0);
    const snap=structuredClone(battle.toSnapshot());battle=mode==='small'?SmallBattle.fromSnapshot(snap):MassBattle.fromSnapshot(snap);Object.assign(battle.rng,rng);
    hit();target=battle.byId('D');expect(battle.xpGained).toBe(xp);
    target.status='fled';battle.finishBattle('ceasefire');
    const awards=battleXpAwards(battle.combatants,battle.xpByUnit,{won:true});expect(awards[0]!.kills).toBe(xp);expect(awards[0]!.participation).toBe(Math.round(xp*.15));
  });
});
