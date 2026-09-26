import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, V4_D20, compileGenericSkill, SmallBattle, standardField } from '../src/index.js';
import { anchoredWeapon, anchoredProtection, armorPowerScale, penetrationThrough } from '../src/power-anchors.js';
import { bonusMultiplier, bonusRating, bonusSteps, enhancementLabel, parseEnhancementSuffix, validateEnhancements, validateChannelProtection } from '../src/enhancements.js';
import { prepareCombatModel } from '../src/combat-model.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
import { skillAttack } from '../src/skill-attack.js';
import { previewAttack, resolveAttack } from '../src/damage.js';
import { standardConditionMap } from '../src/conditions.js';
import { SeededRng } from '../src/rng.js';
import type { Combatant, GenerateInput } from '../src/index.js';

const registry = traitRegistry();
function unit(id: string, side: 'ally'|'enemy', extra: Partial<GenerateInput> = {}): Combatant {
  const result = generateUnit({ name: id, side, rulesVersion: 'v2', scale: 'hero', level: 5, weaponClass: 'sword', weaponLevel: 3, armorTier: 2, armorLevel: 3, traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  prepareCombatModel(result,V4_D20);return result;
}

describe('有符号、连续及单通道强化', () => {
  it('读写正负、零与命名词条，拒绝溢出、重复及残缺格式', () => {
    const parsed = parseEnhancementSuffix('裂解枪:步枪L5+3伤害-2精度+5热能穿透', 'weapon');
    expect(parsed).toEqual({ text: '裂解枪:步枪L5', bonuses: { damage: 3, accuracy: -2, thermalPenetration: 5 } });
    expect(parseEnhancementSuffix(parsed.text + enhancementLabel(parsed.bonuses), 'weapon')).toEqual(parsed);
    expect(parseEnhancementSuffix('L1-10+0精度', 'weapon').bonuses).toEqual({ power: -10, accuracy: 0 });
    for (const value of ['L1+11','L1-11伤害','L1+1伤害-2伤害','L1+1.5','L1+-1','L1-','L1+3防护']) expect(() => parseEnhancementSuffix(value, 'weapon')).toThrow();
    expect(() => validateEnhancements({ damage: NaN }, 'weapon')).toThrow();
    expect(() => validateChannelProtection({ kinetic: 1.5, thermal: 0, arcane: 0 })).not.toThrow();
    for (const value of [{ kinetic: 1.5 }, { kinetic: -1, thermal: 0, arcane: 0 }, { kinetic: Infinity, thermal: 0, arcane: 0 }]) expect(() => validateChannelProtection(value)).toThrow();
  });
  it('每点连续变化，离散项负方向对称，倍率有下限和叠加上限', () => {
    for (let n=-10;n<=10;n++) {
      expect(bonusRating({ penetration:n }, 'penetration')).toBeCloseTo(n/5);
      expect(bonusMultiplier({ damage:n }, 'damage')).toBeCloseTo(1+n*.05);
      expect(bonusSteps({ range:n }, 'range',5)).toBe(-bonusSteps({ range:-n }, 'range',5));
    }
    expect(bonusMultiplier({ power:-10,damage:-10,thermalDamage:-10 },'damage','thermal')).toBe(.5);
    expect(bonusMultiplier({ power:10,damage:10,thermalDamage:10 },'damage','thermal')).toBe(2);
    expect(bonusRating({ penetration:10,thermalPenetration:10 },'penetration','thermal')).toBe(2);
  });
  it('1.5防护确实生效，所有区间单调且整数锚点不变', () => {
    expect(penetrationThrough(2,1.5)).toBeCloseTo(.775);
    for (const [gap,factor] of [[-3,0],[-2,.12],[-1,.3],[0,.55],[1,1]]) expect(penetrationThrough(5+gap!,5)).toBe(factor);
    for(let n=0;n<120;n++) expect(penetrationThrough(5,n/10)).toBeGreaterThanOrEqual(penetrationThrough(5,(n+1)/10));
    for(const invalid of [NaN,Infinity,-1]) expect(()=>penetrationThrough(2,invalid)).toThrow();
  });
  it('防护通道互不转移；盾与护甲共同受±2档上限；强度与抗穿分别计算', () => {
    const target=unit('guard','enemy',{shield:true});
    const base=['kinetic','thermal','arcane'].map(c=>anchoredProtection(target,c as 'kinetic'));
    const scale=armorPowerScale(target);
    target.armor!.recipe!.bonuses={thermalProtection:5,arcaneProtection:-5};
    expect(anchoredProtection(target,'kinetic')).toBe(base[0]);
    expect(anchoredProtection(target,'thermal')).toBe(base[1]!+1);
    expect(anchoredProtection(target,'arcane')).toBe(base[2]!-1);
    expect(armorPowerScale(target)).toBe(scale);
    target.shield!.recipe={version:'mechanism-v2.3',mechanism:'shield',power:3,quality:3,size:'human',seed:'shield',bonuses:{thermalProtection:10}};
    expect(anchoredProtection(target,'thermal')).toBe(base[1]!+2);
    target.armor!.recipe!.bonuses={power:-10}; delete target.shield;
    expect(armorPowerScale(target)).toBeCloseTo(scale*.5);
  });
  it('武器专项只匹配实际通道，物理技法继承附魔通道且不重复强化', () => {
    const actor=unit('caster','ally'),target=unit('victim','enemy');
    actor.weapon!.channel='thermal';
    const before=anchoredWeapon(actor.weapon)!;
    actor.weapon!.recipe!.bonuses={thermalPenetration:1,arcanePenetration:10,thermalDamage:4};
    const after=anchoredWeapon(actor.weapon)!;
    expect(after.penetration).toBeCloseTo(before.penetration!+.2);
    expect(after.damageScale).toBeCloseTo(before.damageScale!*1.2);
    const ability=compileGenericSkill('generic:physical-single:melee',3,actor.id);
    actor.abilities=[ability];actor.preparedAbilityIds=[ability.id];upgradeCombatSkills(actor);
    const context={units:[actor,target],mode:'small' as const,fieldTags:[]};
    const damage=ability.effects.find(e=>e.op==='damage')!;
    const base=skillAttack(context,actor,target,ability,damage,V4_D20);
    ability.bonuses={thermalPenetration:-1,thermalDamage:4};
    const boosted=skillAttack(context,actor,target,ability,damage,V4_D20);
    expect(boosted.abilityDamage?.channel).toBe('thermal');
    expect(boosted.abilityDamage?.penetration).toBeCloseTo(base.abilityDamage!.penetration!-.2);
    expect(boosted.abilityDamage?.damageScale).toBeCloseTo(base.abilityDamage!.damageScale!*1.2);
  });
  it('旧技能重新编译只发生一次，保留身份、冷却、次数和资源', () => {
    const actor=unit('migration','ally');
    const ability=compileGenericSkill('generic:magic-single:thermal',4,actor.id);
    ability.bonuses={damage:-3,penetration:1,range:-5}; actor.abilities=[ability];actor.preparedAbilityIds=[ability.id];
    upgradeCombatSkills(actor);const expected=structuredClone(ability);
    ability.effectVersion='skill-v4.2';ability.damageScale=123456;ability.range!.max=99;
    actor.abilityState=[{abilityId:ability.cooldownGroup!,cdLeft:3,used:2}];const resources=structuredClone(actor.resources);
    upgradeCombatSkills(actor);
    expect(ability).toEqual(expected);expect(actor.resources).toEqual(resources);
    expect(actor.abilityState).toEqual([{abilityId:ability.cooldownGroup!,cdLeft:3,used:2}]);
    const once=JSON.stringify(actor);upgradeCombatSkills(actor);expect(JSON.stringify(actor)).toBe(once);
    const field=standardField();const battle=new SmallBattle({combatants:[actor,unit('other','enemy')],rules:V4_D20,traitRegistry:registry,battlefield:field,seed:'save'});
    const restored=SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())),{traitRegistry:registry});
    expect(restored.combatants[0]!.abilities[0]!.effectVersion).toBe('skill-v4.3');
  });
  it('真实掷骰结算与预览使用相同小数档系数，均值落在误差范围', () => {
    const actor=unit('attack','ally'),target=unit('defend','enemy');
    actor.weapon={id:'custom',name:'custom',baseDice:'8d6',range:1,tags:[],channel:'kinetic',penetration:2};
    target.armor!.protectionOverride=true;target.armor!.protection={kinetic:1.5,thermal:0,arcane:0};target.armor!.powerScale=1;
    const opts={attacker:actor,defender:target,rules:V4_D20,conditionDefs:standardConditionMap(),traitRegistry:registry,ranged:false};
    const preview=previewAttack(opts);expect(preview.penetrationFactor).toBeCloseTo(.775);
    const rng=new SeededRng('fractional');let sum=0;
    for(let i=0;i<2000;i++) { const result=resolveAttack({...opts,defender:structuredClone(target),rng});sum+=result.finalDamage;if(result.hit)expect(result.penetrationFactor).toBeCloseTo(.775); }
    expect(sum/2000).toBeCloseTo(preview.expectedDamage,0);
  });
});
