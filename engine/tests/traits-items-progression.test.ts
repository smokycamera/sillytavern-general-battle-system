import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, standardConditionMap, prepareCombatModel, prepareTraitModel, prepareItemModel, prepareTraitLevelModel,
  V22_OVERFLOW_D20, V22_OVERFLOW_TW, V17_OVERFLOW_D20, V17_OVERFLOW_TW, SmallBattle, MassBattle, standardField,
  compileItem, gearItem, traitLevel, collectMods, resolveStack, previewAttack, resolveAttack, estimateHitChance, d20HitWeight,
  wornEffects, wornDamageMultiplier, anchoredProtection, movementPoints, traitPenetrationBonus, reconDistance,
  parseSkillMechanism, skillMechanismId, itemAbilityTemplate, compileSkill, upgradeCombatSkills, resolveHealingBudget,
  PROGRESSION_MODEL, PROGRESSION_PARAMETERS, traitParameter, regenerationAmount, massMoveReach, itemUseAbility,
  compileWornEffects,
  placeZone, settleZones, conditionDamage, skillEffectValue, syncGearAbilities, type Combatant, type GenerateInput, type ItemSpecification, type RulePack, type Weapon } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
import { itemValueSummary, overshadowedGear } from '../../panel/src/item-description.js';
const registry = traitRegistry(), defs = standardConditionMap();
function unit(id: string, extra: Partial<GenerateInput> = {}, rules = V22_OVERFLOW_D20): Combatant {
  const u = generateUnit({ name: id, side: id === 'e' ? 'enemy' : 'ally', scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2', level: 5,
    traits: [], weaponClass: 'sword', weaponLevel: 5, armorTier: 0, ...extra }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, rules); prepareTraitModel(u, rules); prepareItemModel(u, rules); prepareTraitLevelModel(u, rules); return u;
}
const mechanism = (text: string) => skillMechanismId(parseSkillMechanism(text)!);
function item(spec: Omit<Extract<ItemSpecification, {kind:'item'}>, 'kind'>) {
  const m = compileItem({ kind:'item', ...spec }, { id:'item', seed:'item' });
  if (m.kind !== 'item') throw Error('fixture');
  // 本文件固定验证V22冻结配方；默认新建物品已采用V23预算。
  m.value.recipe.progressionModel = 'item-progression-v1';
  if (m.value.passive) { m.value.recipe.traitBudgetModel = 'traits-items-v1'; delete m.value.recipe.wornEffectModel; m.value.passive.actualEffects = compileWornEffects(spec.bonuses, spec.power, 'worn-progression-v1'); }
  if (spec.form !== 'worn') m.value.ability = itemAbilityTemplate(spec.active!,spec.power,spec.bonuses,spec.form,'道具','item-progression-v1');
  return m.value;
}
const equip = (u: Combatant, power: number, bonuses: Extract<ItemSpecification,{kind:'item'}>['bonuses'], id = 'gear') => {
  u.gear = [...(u.gear ?? []), gearItem(id, id, item({ form:'worn', power, bonuses }))];
};
const weapon: Weapon = { id:'fixed', name:'固定武器', customized:true, powerModel:'wounds-v2', level:5, baseDice:'1d2+18', penetration:20, channel:'kinetic', damageScale:1, range:8, tags:['ranged'] };
const options = (a: Combatant, e = unit('e'), rules = V22_OVERFLOW_D20) => ({ attacker:a, defender:e, rules, conditionDefs:defs, traitRegistry:registry, ranged:false, weaponOverride:weapon, distance:1 });

describe('V22 traits与道具逐级成长的关键行为', () => {
  it('新表覆盖十级且主成长单调；旧表及毒/再生/抵抗互相独立', () => {
    for (const values of Object.values(PROGRESSION_PARAMETERS)) { expect(values).toHaveLength(10); expect(values.every(Number.isFinite)).toBe(true); }
    for (const key of ['berserkDamage','meleeDamage','chargeDamage','sneakMultiplier','guardianReduction','poisonMultiplier','regenAmount','channelResistance'] as const) {
      const values = PROGRESSION_PARAMETERS[key]; expect(values.every((v,i) => i === 0 || v > values[i-1]!)).toBe(true);
    }
    expect(traitParameter('berserkDamage',3)).toBe(1);
    expect(traitParameter('woundRatio',10,PROGRESSION_MODEL)).toBe(2);
    const regen=unit('a',{traits:['regen'],traitLevels:{regen:3}});regen.hp-=10;expect(regenerationAmount(regen)).toBeCloseTo(2.2);
  });
  it('狂暴L2→L3在同一物理场景、命中封顶后仍提高实际伤害', () => {
    const results = [2,3].map(L => { const a=unit('a',{traits:['berserk'],traitLevels:{berserk:L}}), e=unit('e'); a.base.atk=100; e.base.hpMax=1000; e.hp=1000;
      return resolveAttack({...options(a,e),rng:{seed:'fixed',d:(sides)=>sides===20?10:1,next:()=>.1}}); });
    expect(results[1]!.netAtk-results[0]!.netAtk).toBe(1);
    expect(results[1]!.finalDamage).toBeGreaterThan(results[0]!.finalDamage);
    const old=unit('a',{traits:['berserk'],traitLevels:{berserk:3}},V17_OVERFLOW_D20);
    expect(resolveStack(collectMods(old,{attacker:old},defs,[],registry),'dmg',{attacker:old}).multTotal).toBe(1);
  });
  it('多traits合并额外部分，同组克制取强；行动倍率保持独立', () => {
    const a=unit('a',{traits:['berserk','melee-master','anti-large','anti-air'],traitLevels:{berserk:3,'melee-master':3,'anti-large':2,'anti-air':3}}),e=unit('e',{body:'large'}); e.airborne=true;
    const ctx={attacker:a,defender:e,ranged:false};
    const mods=collectMods(a,ctx,defs,[{source:'temp',name:'技能倍率',kind:'dmg',type:'mult',value:2}],registry);
    expect(resolveStack(mods,'dmg',ctx).multTotal).toBeCloseTo((1+.48+.33+.52)*2);
  });
  it('射击与混合环境增伤进入同一真实结算，魔法只接受狂暴', () => {
    const a=unit('a',{traits:['sharpshooter','forest-lore','night-fighter'],traitLevels:{sharpshooter:3,'forest-lore':3,'night-fighter':3}});
    const baseline=previewAttack({...options(unit('a')),ranged:true,distance:6,attackerTerrain:'forest',fieldTags:['night'],moved:true});
    const boosted=previewAttack({...options(a),ranged:true,distance:6,attackerTerrain:'forest',fieldTags:['night'],moved:true});
    expect(boosted.expectedDamage).toBeGreaterThan(baseline.expectedDamage);
    const offTerrain={attacker:a,ranged:false,terrain:'open',fieldTags:['forest']};expect(resolveStack(collectMods(a,offTerrain,defs,[],registry),'dmg',offTerrain).multTotal).toBe(1);
    const ctx={attacker:a,ranged:true,terrain:'forest',fieldTags:['night'],skillDelivery:'magic' as const};
    expect(resolveStack(collectMods(a,ctx,defs,[],registry),'dmg',ctx).multTotal).toBe(1);
  });
  it('佩戴实效十级兑现，精度小数进入概率，速度小数可累计支付地形路径', () => {
    let last=0;
    for(let L=1;L<=10;L++) {const a=unit('a');equip(a,L,{damage:10,accuracy:10,speed:10,protection:10});const now=wornDamageMultiplier(a,'kinetic');expect(now).toBeGreaterThan(last);last=now;
      expect(previewAttack(options(a)).attackScore).toBeGreaterThan(previewAttack(options(unit('a'))).attackScore!);}
    const a=unit('a');equip(a,2,{accuracy:10,speed:10});
    expect(estimateHitChance(V22_OVERFLOW_D20,6.5,17)-estimateHitChance(V22_OVERFLOW_D20,6,17)).toBeCloseTo(.025);
    expect(d20HitWeight(V22_OVERFLOW_D20,10,6.5,17)).toBeCloseTo(.5);
    const target=unit('e'),base=previewAttack(options(a,target));target.base.def+=Math.floor(base.attackScore!)+11-base.defenseScore!;
    expect(resolveAttack({...options(a,structuredClone(target)),rng:{seed:'boundary',d:(sides)=>sides===20?10:1,next:()=>.25}}).hit).toBe(true);
    expect(resolveAttack({...options(a,structuredClone(target)),rng:{seed:'boundary',d:(sides)=>sides===20?10:1,next:()=>.75}}).hit).toBe(false);
    expect(movementPoints(a)-movementPoints(unit('a'))).toBeCloseTo(.5);
    const field=standardField();field.tiles.fill('open');field.tiles[1]='forest';field.tiles[2]='forest';delete a.pos;
    const e=unit('e');
    const b=new SmallBattle({combatants:[a,e],rules:V22_OVERFLOW_D20,battlefield:field,seed:'move'});
    b.start();b.turnOrder=['a','e'];b.turnIndex=0;a.pos=0;e.pos=field.tiles.length-1;
    // Forest L2 costs1.75: a fractional budget survives one segment before the next.
    a.traits=['forest-lore'];a.traitLevels={'forest-lore':2};
    const before=b.movementLeft('a',false);b.moveTo('a',1);
    expect(b.movementLeft('a',false)).toBeCloseTo(before-1.75);b.moveTo('a',2);expect(a.pos).toBe(2);expect(b.movementLeft('a',false)).toBeCloseTo(0);
    a.gear=[];equip(a,10,{speed:10});a.conditions.push({id:'hasted',dur:2});b.selectHaste('a',true);b.moveTo('a',3);expect(b.hasteMovement.get('a')).toBeCloseTo(9.2);
    const restored=SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));expect(restored.movementLeft('a',false)).toBeCloseTo(b.movementLeft('a',false));
  });
  it('佩戴方向先换算取强，跨件通道上限及负面封顶生效；特质不乘物品系数', () => {
    const capped=item({form:'worn',power:3,bonuses:{damage:10,kineticDamage:10}}).passive!.actualEffects!.values;expect(capped.damage!+capped.kineticDamage!).toBeCloseTo(.35*1.25);
    const a=unit('a');equip(a,10,{damage:10,protection:10},'general');equip(a,10,{kineticDamage:10,kineticProtection:10},'channel');
    expect(wornEffects(a).kineticDamage).toBeCloseTo(1.25*1.82);expect(wornEffects(a).kineticProtection).toBeCloseTo(.75*5.2);
    equip(a,10,{damage:-10,accuracy:-10},'negative');expect(wornDamageMultiplier(a,'thermal')).toBeCloseTo(1+1.82-.67);expect(wornEffects(a).accuracy).toBeCloseTo(-1.4);
    a.gear!.push({id:'old',name:'旧物品',load:0,recipe:{version:'items-v1',form:'worn',power:10,seed:'old',bonuses:{damage:10}},passive:{traits:[],bonuses:{damage:10}}});expect(wornDamageMultiplier(a,'thermal')).toBeCloseTo(1+1.82-.67);
    a.gear=[gearItem('trait','trait',item({form:'worn',power:10,traits:[{id:'berserk',level:3}]}))];
    expect(traitLevel(a,'berserk')).toBe(3);const ctx={attacker:a};expect(resolveStack(collectMods(a,ctx,defs,[],registry),'dmg',ctx).multTotal).toBeCloseTo(1.48);
    a.traits=['berserk'];a.traitLevels={berserk:5};expect(overshadowedGear(a,'trait')).toContain('狂暴L3');
  });
  it('散兵溅射仅削人数一次；不支持人数削减的范围攻击才减伤', () => {
    const a=unit('a'),e=unit('e',{scale:'company',hpMax:100,traits:['loose-formation'],traitLevels:{'loose-formation':5}});
    a.base.atk=100;
    const blast={...weapon,splashTargets:10,splashFactor:.4,tags:['ranged','blast']};
    const r=resolveAttack({...options(a,e),ranged:true,weaponOverride:blast,distance:3,rng:{seed:'fixed',d:(sides)=>sides===20?10:1,next:()=>.1}});
    expect(r.damagePlans?.[0]?.splashTargets).toBe(5*r.damagePlans![0]!.targets);
    expect(r.wardMult).toBe(1);
    const ctx={attacker:e,area:true,ranged:true,distance:3};expect(resolveStack(collectMods(e,ctx,defs,[],registry),'ward',ctx).multTotal).toBeCloseTo(.5);
  });
  it('主动预算只替换道具，治疗分摊/医护各一次；高阶软效力和净化/位移持久化', () => {
    expect(item({form:'single',power:3,active:mechanism('buff治疗')}).ability!.effects[0]).toMatchObject({op:'heal',amount:26,power:3});
    const area=item({form:'charged',power:5,active:mechanism('buff范围治疗+屏障')}).ability!;
    expect(area.effects.find(e=>e.op==='heal')).toMatchObject({amount:54*.65/2});expect(area.effects.find(e=>e.op==='barrier')).toMatchObject({amount:20,dur:3,defensePower:5});
    const a=unit('a',{traits:['medic'],traitLevels:{medic:3}}),e=unit('e');
    expect(resolveHealingBudget({source:a,target:e,power:3,baseAmount:26,delivery:'item'})).toBeCloseTo(26*1.38);
    const normal=compileSkill({id:mechanism('buff治疗')},3,a.id,'skills-v2');a.skillModel='skills-v2';a.abilities=[normal];upgradeCombatSkills(a);expect(normal.effects[0]).toMatchObject({amount:24});
    const soft=item({form:'charged',power:10,active:mechanism('buff攻击')}).ability!;expect(soft.effects[0]).toMatchObject({magnitude:5.2,dur:5});
    const cleanse=item({form:'charged',power:10,active:mechanism('buff净化')});a.gear=[gearItem('cleanse','cleanse',cleanse),gearItem('soft','soft',item({form:'charged',power:10,active:mechanism('buff攻击')})),gearItem('push','push',item({form:'charged',power:10,active:mechanism('debuff击退')}))];a.abilities=a.gear.map(g=>g.ability!);
    expect(()=>materializeUnitRecord(JSON.parse(JSON.stringify(unitRecordFromCombatant(a))),registry)).not.toThrow();
    const move=item({form:'charged',power:8,active:mechanism('突进')}).ability!.effects[0]!;if(move.op!=='move')throw Error('fixture');expect(move.reach).toBe(9);expect(massMoveReach(move)).toBe(8);
    expect(itemValueSummary(item({form:'worn',power:3,bonuses:{damage:10}}))).toContain('伤害+35%');
  });
  it('虚弱L10保留104%幅度，最终伤害最低0', () => {
    const a=unit('a');a.conditions=[{id:'weakened',dur:5,magnitude:5.2}];const ctx={attacker:a};expect(resolveStack(collectMods(a,ctx,defs,[],registry),'dmg',ctx).multTotal).toBe(0);
    expect(resolveAttack({...options(a),rng:{seed:'fixed',d:(sides)=>sides===20?10:1,next:()=>.1}}).finalDamage).toBe(0);
  });
  it('区域与持续伤害使用新防护，区域医护冻结新倍率可保存', () => {
    const a=unit('a',{traits:['guardian','loose-formation'],traitLevels:{guardian:1,'loose-formation':5}}),e=unit('e');
    expect(conditionDamage(a,4,{id:'poisoned',dur:3})).toBeCloseTo(3.6);
    const context={units:[a,e],mode:'small' as const,fieldTags:[],rules:V22_OVERFLOW_D20,traitRegistry:registry};
    const fire={op:'zone' as const,kind:'fire' as const,power:5,amount:20,penetration:20,radius:1,dur:3};
    const ability={id:'fire',name:'fire',target:'enemy' as const,effects:[fire]};
    const plain={...a,traits:[],traitLevels:{}};expect(skillEffectValue(context,e,plain,ability)).toBeGreaterThan(skillEffectValue(context,e,a,ability));
    placeZone(context,e,a,fire,1,'fire');
    expect(settleZones(context,1).find(r=>r.target.id==='a')?.damage).toBe(9);
    const medic=unit('medic',{traits:['medic'],traitLevels:{medic:10}}),zone=item({form:'single',power:5,active:mechanism('治疗区域')}).ability!.effects[0]!;
    if(zone.op!=='zone')throw Error('fixture');
    const healing=placeZone({...context,units:[medic,e]},medic,medic,zone,1,'healing');expect(healing.sourceMedicSnapshot).toBe(3.06);
    const b=new SmallBattle({combatants:[medic,e],rules:V22_OVERFLOW_D20,seed:'zone'});expect(()=>SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())))).not.toThrow();
  });
  it('抵抗按各自通道相加，破甲保留1/3小数；侦察使用对应战场距离', () => {
    const a=unit('a',{traits:['thermal-resist','ap-weapon'],traitLevels:{'thermal-resist':3,'ap-weapon':10}});
    expect(anchoredProtection(a,'thermal')).toBeCloseTo(1.2);expect(anchoredProtection(a,'kinetic')).toBe(0);
    expect(traitPenetrationBonus(a,weapon,true,2)).toBeCloseTo(2/3);
    expect(reconDistance(3,3,'small',PROGRESSION_MODEL)).toBe(4);expect(reconDistance(3,3,'mass',PROGRESSION_MODEL)).toBe(2);
  });
  it.each(['small','mass'] as const)('%s旧快照与旧物品继续原数值；新道具冻结记录可往返', mode => {
    const rules=mode==='small'?V17_OVERFLOW_D20:V17_OVERFLOW_TW;
    const a=unit('a',{traits:['berserk'],traitLevels:{berserk:3}},rules),e=unit('e',{},rules);
    a.gear=[{id:'legacy',name:'旧饰品',load:0,recipe:{version:'items-v1',form:'worn',power:8,seed:'legacy',bonuses:{damage:10}},passive:{traits:[],bonuses:{damage:10}}}];
    const frozen=itemAbilityTemplate(mechanism('buff治疗'),3,undefined,'charged','old',false);a.gear.push(gearItem('old-heal','old-heal',{recipe:{version:'items-v1',form:'charged',power:3,seed:'old-heal',active:mechanism('buff治疗')},ability:frozen}));syncGearAbilities(a);
    const b=mode==='small'?new SmallBattle({combatants:[a,e],rules,seed:'old'}):new MassBattle({combatants:[a,e],rules,seed:'old'});
    const snapshot=JSON.parse(JSON.stringify(b.toSnapshot()));const restored=mode==='small'?SmallBattle.fromSnapshot(snapshot):MassBattle.fromSnapshot(snapshot);
    expect(restored.toSnapshot()).toEqual(b.toSnapshot());expect(restored.rules.id).toBe(rules.id);expect(restored.byId('a').gear).toEqual(a.gear);
    expect(restored.byId('a').abilities.find(a=>a.equipmentSourceId==='old-heal')!.effects[0]).toMatchObject({amount:24});
    const next=new SmallBattle({combatants:structuredClone([a,e]),rules:V22_OVERFLOW_D20,seed:'explicit-new'});expect(next.byId('a').abilities.find(a=>a.equipmentSourceId==='old-heal')!.effects[0]).toMatchObject({amount:24});
  });
});
