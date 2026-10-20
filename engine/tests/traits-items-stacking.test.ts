import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, standardConditionMap, prepareCombatModel, prepareTraitModel, prepareItemModel, prepareTraitLevelModel,
  V23_OVERFLOW_D20, V23_OVERFLOW_TW, V22_OVERFLOW_D20, V22_OVERFLOW_TW, SmallBattle, MassBattle, standardField,
  compileItem, gearItem, collectMods, resolveStack, resolveAttack, previewAttack, wornDamageMultiplier, anchoredProtection, defensePower,
  traitParameter, STACKING_MODEL, REVISED_ITEM_HEAL, REVISED_ITEM_BARRIER, ITEM_STACKING, ITEM_PROGRESSION,
  parseSkillMechanism, skillMechanismId, itemAbilityTemplate, upgradeRecoveryItemBudget, historicalRecoveryItem,
  beginLifestealRound, lifestealRecovery, lifestealAmount, memberHealth, applyCombatDamage, bracePose, conditionDamage,
  placeZone, settleZones, skillEffectValue, structureTraitMultiplier, syncGearAbilities, regenerationAmount, medicHealingMultiplier,
  grantTraitSource, type Combatant, type RulePack, type Weapon, type Modifier, type ItemValue, type GenerateInput } from '../src/index.js';
import { prepareInventoryState, prepareInventoryTransaction } from '../../panel/src/inventory-state.js';
import { itemValueSummary } from '../../panel/src/item-description.js';
const registry=traitRegistry(), defs=standardConditionMap();
function unit(id='a', traits:Record<string,number>={}, extra:Partial<GenerateInput>={}, rules=V23_OVERFLOW_D20):Combatant {
  const u=generateUnit({name:id,side:id==='e'?'enemy':'ally',scale:'hero',level:5,rulesVersion:'v2',damageModel:'wounds-v2',weaponClass:'sword',weaponLevel:5,armorTier:0,traits:Object.keys(traits),traitLevels:traits,...extra},{seed:id,noVariance:true,registry}).unit;
  u.id=id;prepareCombatModel(u,rules);prepareTraitModel(u,rules);prepareItemModel(u,rules);prepareTraitLevelModel(u,rules);return u;
}
const mechanism=(s:string)=>skillMechanismId(parseSkillMechanism(s)!);
function item(form:'single'|'charged'|'worn',power:number,active?:string,bonuses?:Parameters<typeof compileItem>[0]['bonuses']):ItemValue {
  const m=compileItem({kind:'item',form,power,active:active?mechanism(active):undefined,bonuses},{id:'gear',seed:'gear'});if(m.kind!=='item')throw Error('fixture');return m.value;
}
function frozen(power=10,form:'single'|'charged'='single',active='buff治疗'):ItemValue {
  const id=mechanism(active);return {recipe:{version:'items-v1',form,power,seed:'frozen',active:id,progressionModel:ITEM_PROGRESSION,bonuses:{healing:2}},ability:itemAbilityTemplate(id,power,{healing:2},form,'药剂',ITEM_PROGRESSION)};
}
const rng=()=>({seed:'fixed',d:(s:number)=>s===20?10:1,next:()=>.1});
const weapon:Weapon={id:'fixed',name:'固定武器',customized:true,powerModel:'wounds-v2',level:1,baseDice:'1d2+99',channel:'kinetic',penetration:30,range:8,tags:['ranged'],damageScale:1};
const opts=(a:Combatant,e:Combatant,rules:RulePack=V23_OVERFLOW_D20)=>({attacker:a,defender:e,rules:{...rules,trainingDamagePerLevel:0},weaponOverride:weapon,ranged:true,distance:3,defenderEngaged:false,conditionDefs:defs,traitRegistry:registry});
const stack=(u:Combatant,extra:Parameters<typeof collectMods>[1]={},kind:'dmg'|'ward'='dmg',mods:Modifier[]=[])=>{
  const ctx={attacker:u,...extra};return resolveStack(collectMods(u,ctx,defs,mods,registry),kind,ctx);
};

describe('V23 组合修正关键回归',()=>{
  it('狂暴L2/L3实际增强；主/协同、并列、来源去重与其他乘区独立',()=>{
    const e=unit('e');e.hp=e.base.hpMax=10000;
    const results=[2,3].map(L=>resolveAttack({...opts(unit('a',{berserk:L}),structuredClone(e)),rng:rng()}));
    expect(results.map(r=>r.finalDamage)).toEqual([130,148]);expect(results[1]!.netAtk-results[0]!.netAtk).toBe(1);
    const a=unit('a',{berserk:10,'melee-master':10});
    expect(stack(a,{ranged:false}).multTotal).toBeCloseTo(4.0475);
    const same=structuredClone(a);grantTraitSource(same,{id:'duplicate',name:'饰品',kind:'blessing',traitIds:['berserk'],traitLevels:{berserk:9},duration:{kind:'permanent'}});
    expect(stack(same,{ranged:false}).multTotal).toBeCloseTo(4.0475);
    const tied:Modifier[]=[...['x','y','z'].map(sourceId=>({source:'intrinsic' as const,sourceId,name:sourceId,kind:'dmg' as const,type:'mult' as const,traitDamage:true,value:3})),{source:'stance',name:'动作',kind:'dmg',type:'mult',value:2}];
    expect(resolveStack(tied,'dmg',{attacker:a}).multTotal).toBe(8);expect(resolveStack(tied.reverse(),'dmg',{attacker:a}).multTotal).toBe(8);
    expect(stack(unit('a',{berserk:10,'anti-large':10,'anti-air':10}),{ranged:true,defender:unit('e',{}, {body:'large',traits:['flying']})}).multTotal).toBeCloseTo(4.05+.25*2.65);
    expect(structureTraitMultiplier(unit('a',{berserk:10,'melee-master':10,'siege-breaker':10}),weapon,{ranged:false})).toBeCloseTo(6.19+.25*(2.65+1.59));
  });
  it('固定特质组合的伤害佩戴品保留独立逐级收益',()=>{
    const damage=(L:number,specific=false)=>{const a=unit('a',{berserk:10,'melee-master':10});a.gear=[gearItem('g','g',item('worn',L,undefined,specific?{kineticDamage:10}:{damage:10}))];return stack(a,{ranged:false}).multTotal*wornDamageMultiplier(a,'kinetic');};
    expect(damage(3)/damage(2)).toBeCloseTo(1.35/1.22);expect(damage(10)/damage(9)).toBeCloseTo(2.82/2.54);expect(damage(10,true)/damage(9,true)).toBeCloseTo(3.275/2.925);
  });
  it('真实通道抵抗L2/L3为73/63；不增加抗穿或防御规格',()=>{
    for(const [L,expected] of [[2,73],[3,63]]){
      const e=unit('e',{'thermal-resist':L!});e.hp=e.base.hpMax=1000;
      expect(anchoredProtection(e,'thermal')).toBe(0);expect(defensePower(e,'thermal')).toBe(e.level);
      const thermal={...weapon,channel:'thermal' as const};
      expect(resolveAttack({...opts(unit(),e),weaponOverride:thermal,rng:rng()}).finalDamage).toBe(expected);
      expect(resolveAttack({...opts(unit(),e),rng:rng()}).finalDamage).toBe(100);
    }
    const e=unit('e',{'thermal-resist':10});
    expect(conditionDamage(e,100,{id:'burning',dur:1})).toBeCloseTo(19);
    expect(conditionDamage(e,100,{id:'poisoned',dur:1})).toBe(100);
    expect(conditionDamage(e,100,{id:'poisoned',dur:1,damageChannel:'thermal'})).toBeCloseTo(19);
    const a=unit(), ctx={units:[a,e],mode:'small' as const,fieldTags:[],rules:V23_OVERFLOW_D20};
    const fire={op:'zone' as const,kind:'fire' as const,power:5,amount:100,penetration:30,dur:2,radius:1};
    placeZone(ctx,a,e,fire,1,'fire');expect(settleZones(ctx,1).find(r=>r.target.id==='e')?.damage).toBe(19);
    const ability={id:'fire',name:'fire',target:'enemy' as const,effects:[fire]};expect(skillEffectValue(ctx,a,e,ability)).toBeLessThan(skillEffectValue(ctx,a,{...e,traits:[],traitLevels:{}},ability));
  });
  it('A/B取强后合并额外有效生命；易伤独立，阵形条件仍保留',()=>{
    const e=unit('e',{guardian:10,'kinetic-resist':10,'shield-wall':10});const a=unit();e.pos=0;a.pos=1;
    e.shield={id:'shield',load:2};e.tacticalPose=bracePose(e,a,'small',5);
    const context={defender:a,ranged:true,distance:3,damageChannel:'kinetic' as const};
    expect(stack(e,context,'ward').multTotal*100).toBeCloseTo(10.49723757);
    e.traits=['guardian','shield-wall'];expect(stack(e,context,'ward').multTotal*100).toBeCloseTo(13.53517364);
    e.conditions=[{id:'vulnerable',dur:1}];expect(stack(e,context,'ward').multTotal*100).toBeCloseTo(13.53517364*1.25);
    delete e.tacticalPose;expect(stack(e,context,'ward').multTotal).toBeCloseTo(.32*1.25);
  });
  it('散兵胜出才按EA/E削暴露，伤害仅A；未胜出和另一范围路径各结算一次',()=>{
    const e=unit('e',{guardian:5,'loose-formation':5},{scale:'company',hpMax:100}),a=unit();
    const context={ranged:true,area:true,distance:3,engaged:false,damageChannel:'kinetic' as const};
    const regular=stack(e,context,'ward'),exposure=stack(e,{...context,looseViaTargets:true},'ward');
    expect(exposure.multTotal).toBeCloseTo(.59);expect(exposure.multTotal*exposure.protection!.exposure).toBeCloseTo(regular.multTotal);
    const bomb={...weapon,baseDice:'1d2+9',splashTargets:10,splashFactor:1};
    const result=resolveAttack({...opts(a,structuredClone(e)),weaponOverride:bomb,rng:rng()});
    expect(result.wardMult).toBeCloseTo(.59);expect(result.damagePlans![0]!.splashTargets).toBe(Math.floor(10*exposure.protection!.exposure));
    e.traits.push('skirmisher');e.traitLevels={...e.traitLevels,skirmisher:10};
    const beaten=stack(e,{...context,looseViaTargets:true},'ward');expect(beaten.protection!.looseWins).toBe(false);expect(beaten.protection!.exposure).toBe(1);
    const other=resolveAttack({...opts(a,structuredClone(e)),weaponOverride:bomb,rng:rng()});expect(other.damagePlans![0]!.splashTargets).toBe(10);
    expect(previewAttack({...opts(a,e),weaponOverride:bomb}).expectedDamage).toBeGreaterThan(0);
  });
  it('吸血共享轮预算，预览只读、来源和升级不刷新，多段小数累计',()=>{
    const a=unit('a',{lifesteal:10,medic:10}),e=unit('e');a.hp=20;a.base.hpMax=164;beginLifestealRound(a,1,true);
    const before=structuredClone(a.lifestealState);expect(lifestealAmount(a,e,10000)).toBe(24);expect(a.lifestealState).toEqual(before);
    expect(lifestealRecovery(a,e,50,1)).toBe(15);expect(lifestealRecovery(a,unit('other'),100,1)).toBe(9);expect(lifestealRecovery(a,e,100,1)).toBe(0);
    expect(a.lifestealState).toMatchObject({baseline:164,round:1,spent:24});
    a.traitLevels!.lifesteal=2;expect(lifestealRecovery(a,e,100,1)).toBe(0);a.traitLevels!.lifesteal=10;expect(lifestealRecovery(a,e,100,1)).toBe(0);
    expect(lifestealRecovery(a,e,100,2)).toBe(24);expect(a.lifestealState!.baseline).toBe(164);
    beginLifestealRound(a,3);a.traitLevels!.lifesteal=1;
    for(let i=0;i<24;i++)expect(lifestealRecovery(a,e,1,3)).toBe(0);expect(lifestealRecovery(a,e,1,3)).toBe(1);
    expect(lifestealRecovery(a,{...e,body:'vehicle'},10000,3)).toBe(0);
    a.traitLevels!.lifesteal=10;expect(lifestealRecovery(a,e,10000,3)).toBe(23);expect(a.lifestealState!.spent).toBe(24);
  });
  it('编队冻结入场现员生命预算，恢复按生命与伤兵容量而非人数',()=>{
    const a=unit('a',{lifesteal:10},{scale:'company',hpMax:10}),e=unit('e');
    a.formation!.memberHp=100;a.formation!.health=[{hp:100,count:10}];beginLifestealRound(a,1,true);
    applyCombatDamage(a,500,5);const before=memberHealth(a),members=a.hp;
    const restored=lifestealRecovery(a,e,10000,1);expect(restored).toBe(150);expect(memberHealth(a)-before).toBe(150);
    expect(a.hp-members).toBeLessThanOrEqual(2);expect(a.lifestealState!.baseline).toBe(1000);expect(lifestealRecovery(a,e,10000,1)).toBe(0);
  });
  it.each(['small','mass'] as const)('%s只在全局完整轮重置，读档保留当轮消耗',mode=>{
    const a=unit('a',{lifesteal:10}),e=unit('e');a.hp=10;a.base.hpMax=164;
    const b=mode==='small'?new SmallBattle({combatants:[a,e],rules:V23_OVERFLOW_D20,battlefield:standardField(),seed:'ledger'}):new MassBattle({combatants:[a,e],rules:V23_OVERFLOW_TW,formationSlots:3,seed:'ledger'});
    b.start();lifestealRecovery(a,e,10000,b.round);expect(a.lifestealState!.spent).toBe(24);
    const snapshot=JSON.parse(JSON.stringify(b.toSnapshot())),restored=mode==='small'?SmallBattle.fromSnapshot(snapshot):MassBattle.fromSnapshot(snapshot);
    expect(JSON.parse(JSON.stringify(restored.toSnapshot()))).toEqual(snapshot);expect(restored.byId('a').lifestealState!.spent).toBe(24);
    if(b instanceof SmallBattle){const first=b.active!.id;b.endTurn();expect(a.lifestealState!.spent).toBe(24);while(b.round===1)b.endTurn();expect(first).toBeTruthy();}
    else {b.orders.set('a',{unitId:'a',type:'hold'});b.orders.set('e',{unitId:'e',type:'hold'});b.resolveRound();}
    expect(b.round).toBe(2);expect(a.lifestealState).toMatchObject({round:2,spent:0,baseline:164});
  });
  it('新预算十级编译完整、医护替换、再生保持；旧实物仅显式升级',()=>{
    for(let L=1;L<=10;L++){
      expect(item('single',L,'buff治疗').ability!.effects[0]).toMatchObject({amount:REVISED_ITEM_HEAL[L-1]});
      expect(item('charged',L,'buff屏障').ability!.effects[0]).toMatchObject({amount:REVISED_ITEM_BARRIER[L-1]});
      expect(L===1||REVISED_ITEM_HEAL[L-1]!>REVISED_ITEM_HEAL[L-2]!).toBe(true);
    }
    const a=unit('a',{medic:10,regen:10},{level:10});a.hp-=50;expect(medicHealingMultiplier(a)).toBe(1.96);expect(regenerationAmount(a)).toBe(23);
    const old=frozen(),before=structuredClone(old),up=upgradeRecoveryItemBudget(old);
    expect(old).toEqual(before);expect(up.recipe).toEqual({...old.recipe,progressionModel:ITEM_STACKING});expect(up.ability!.effects[0]).toMatchObject({amount:136*1.10});
    expect(itemValueSummary(old)).toContain('治疗');expect(itemValueSummary(old)).not.toMatch(/历史规则|以本场|组合/);expect(historicalRecoveryItem(up)).toBe(false);
    const custom=structuredClone(old);(custom.ability!.effects[0] as {amount:number}).amount=999;expect(()=>upgradeRecoveryItemBudget(custom)).toThrow('可信配方');
    const historical=frozen();historical.ability=itemAbilityTemplate(historical.recipe.active!,10,historical.recipe.bonuses,'single','药剂',false,'skills-v2');delete historical.recipe.progressionModel;
    expect(upgradeRecoveryItemBudget(historical).ability!.effects[0]).toMatchObject({amount:136*1.10});
    const oldZone=frozen(10,'charged','治疗区域');oldZone.ability=itemAbilityTemplate(oldZone.recipe.active!,10,oldZone.recipe.bonuses,'charged','药剂',false,'skills-v2');delete oldZone.recipe.progressionModel;
    expect(upgradeRecoveryItemBudget(oldZone).ability!.itemEffectModel).toBe(ITEM_STACKING);
  });
  it.each(['small','mass'] as const)('%s V22快照和冻结治疗不变；升级库存整叠保留身份和归属',mode=>{
    const rules=mode==='small'?V22_OVERFLOW_D20:V22_OVERFLOW_TW,a=unit('a',{berserk:10,'melee-master':10},{},rules),e=unit('e',{}, {},rules);
    const value=frozen(3,'charged');a.gear=[gearItem('old','药剂',value)];syncGearAbilities(a);
    const b=mode==='small'?new SmallBattle({combatants:[a,e],rules,battlefield:standardField(),seed:'old'}):new MassBattle({combatants:[a,e],rules,formationSlots:3,seed:'old'});b.start();const snapshot=JSON.parse(JSON.stringify(b.toSnapshot()));
    const save=prepareInventoryState({inventory:[{id:'stack',name:'旧药剂',qty:7,lootType:'item',assignedTo:'a',revision:2,mechanics:{kind:'item' as const,value:frozen()}}]});
    const upgraded=prepareInventoryTransaction(save,{kind:'upgrade-budget',itemId:'stack',id:'upgrade',expectedRevision:save.factRevision??0});
    expect(upgraded.inventory![0]).toMatchObject({id:'stack',qty:7,assignedTo:'a',revision:3});
    expect(upgraded.inventory![0]!.history).toBeUndefined();
    expect(JSON.parse(JSON.stringify(b.toSnapshot()))).toEqual(snapshot);const restored=mode==='small'?SmallBattle.fromSnapshot(snapshot):MassBattle.fromSnapshot(snapshot);expect(JSON.parse(JSON.stringify(restored.toSnapshot()))).toEqual(snapshot);
    expect(stack(restored.byId('a'),{ranged:false}).multTotal).toBeCloseTo(1+2.65+1.59);expect(restored.byId('a').gear![0]!.ability!.effects[0]).toMatchObject({amount:26*1.10});
    expect(traitParameter('channelResistance',3,'traits-items-v1')).toBe(1.2);expect(traitParameter('channelResistance',3,STACKING_MODEL)).toBe(.37);
  });
});
