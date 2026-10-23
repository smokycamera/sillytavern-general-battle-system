import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, prepareTraitModel, prepareTraitLevelModel, prepareItemModel,
  prepareResourceModel, V25_OVERFLOW_D20, V26_OVERFLOW_D20, V26_OVERFLOW_TW, SmallBattle, MassBattle, standardField,
  previewAttack, standardConditionMap, traitRegistry, compileItem, compileWornEffects, gearItem, wornEffects, applyXp,
  upgradeWornItemBudget, validateItemValue, collectMods, resolveStack, movementPoints, nominalLife, type Combatant, type GenerateInput } from '../src/index.js';
import { equipmentStep } from '../src/numeric-model.js';
import { equipmentLoad, equipmentCapacity, equipmentBurden, loadMovementScale, overloadPenalty } from '../src/equipment-load.js';
import { anchoredWeapon, anchoredProtection } from '../src/power-anchors.js';
import { gridWeaponRange } from '../src/small/weapon-range.js';
import { formationMarchSteps, movementFraction } from '../src/tactics.js';
import { moraleProfile, moraleRisk } from '../src/morale.js';
import { combatantFromUnknown, materializeUnitRecord, unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import { createInventoryItem } from '../../panel/src/inventory-state.js';
import { newUnitDraft, buildUnit } from '../../panel/src/unit-builder.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap(), rules = V26_OVERFLOW_D20;
function unit(patch: Partial<GenerateInput> = {}, legacy = false): Combatant {
  const u = generateUnit({ name:'a',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',
    ...(legacy ? {} : {numericModel:'graded-v1'}), level:5,weaponClass:'sword',weaponLevel:5,armorTier:1,armorLevel:5,traits:[],...patch },
    {seed:patch.name ?? 'a',registry,noVariance:true}).unit;
  const r = legacy ? V25_OVERFLOW_D20 : rules;
  prepareCombatModel(u,r); prepareArmsModel(u,r); prepareTraitModel(u,r); prepareTraitLevelModel(u,r); prepareItemModel(u,r); prepareResourceModel(u,r);
  return u;
}
function preview(a:Combatant,d=unit({name:'d',side:'enemy'})) {
  return previewAttack({attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,ranged:!!a.weapon?.tags?.includes('ranged'),distance:1});
}
describe('V26 连续修正、容量与生命', () => {
  it('T1–10每一点本体正负修正在实际命中、伤害、生命、速度和士气中递增', () => {
    for(let level=1;level<=10;level++) {
      const defender=unit({name:'d',side:'enemy',level,armorLevel:level});
      for(const stat of ['accuracy','defense','damage','health','power','speed','morale','kineticDamage'] as const) {
        let last=-Infinity;
        for(const points of [-2,-1,0,1,2]) {
          const a=unit({level,weaponLevel:level,bonuses:{[stat]:points}});
          const effect=stat==='accuracy'?preview(a,defender).hitChance:stat==='defense'?-preview(defender,a).hitChance
            :stat==='health'?a.base.hpMax:stat==='speed'?movementPoints(a):stat==='morale'?a.base.moraleMax!
            :preview(a,defender).damageOnHit!;
          expect(effect,`T${level} ${stat} ${points}`).toBeGreaterThan(last);last=effect;
        }
      }
    }
  });
  it('武器每点精度、防御、伤害、穿透和远近射程生效；旧实物保留折档', () => {
    const d=unit({name:'d',side:'enemy'});
    for(const stat of ['accuracy','defense','damage','penetration','range'] as const) {
      let last=-Infinity;
      for(const p of [-2,-1,0,1,2]) {
        const a=unit({weaponClass:stat==='range'?'bow':'sword',weaponBonuses:{[stat]:p}});
        const w=anchoredWeapon(a.weapon,undefined,a.damageModel)!;
        const value=stat==='accuracy'?preview(a,d).hitChance:stat==='defense'?-preview(d,a).hitChance
          :stat==='damage'?preview(a,d).damageOnHit!:stat==='penetration'?w.penetration!:gridWeaponRange(a.weapon,true,a.armsModel);
        expect(value,`${stat} ${p}`).toBeGreaterThan(last);last=value;
      }
    }
    expect(equipmentStep(unit({weaponBonuses:{accuracy:1}},true).weapon?.recipe,'accuracy'))
      .toBe(equipmentStep(unit({weaponBonuses:{accuracy:2}},true).weapon?.recipe,'accuracy'));
    expect(unit({weaponBonuses:{range:1}}).weapon!.range).toBeGreaterThan(unit().weapon!.range!);
  });
  it('T4重甲与T5超重甲均有80%以内的余量；跨80/100%连续衰减且超载不封顶', () => {
    for(const [level,tier,load,capacity] of [[4,3,8,12],[5,4,10,14]] as const) {
      const u=unit({level,armorTier:tier,weaponClass:'heavy-polearm'});
      expect(equipmentLoad(u)).toBe(load); expect(equipmentCapacity(u)).toBe(capacity); expect(equipmentBurden(u)).toBe(0); expect(movementPoints(u)).toBe(3);
    }
    const u=unit();u.armor=undefined;u.weapon!.load=11.2;
    expect(loadMovementScale(u)).toBeCloseTo(1);u.weapon!.load=12.6;expect(loadMovementScale(u)).toBeCloseTo(.85);
    u.weapon!.load=14;expect(loadMovementScale(u)).toBeCloseTo(.7);u.weapon!.load=28;expect(loadMovementScale(u)).toBeCloseTo(.175);expect(overloadPenalty(u)).toBeCloseTo(10);
    const tiny=loadMovementScale({...u,weapon:{...u.weapon!,load:14.000001}});expect(tiny).toBeCloseTo(.7,5);
  });
  it('护甲类型不扣移动/先攻；护甲速度正负对称且在负重乘区之前计入', () => {
    const light=unit({level:10,armorTier:1}),heavy=unit({level:10,armorTier:4});
    const initiative=(u:Combatant)=>u.base.spd+resolveStack(collectMods(u,{},conditionDefs,[],registry),'spd',{}).flatTotal;
    expect(movementPoints(heavy)).toBe(movementPoints(light));expect(initiative(heavy)).toBe(initiative(light));
    for(const p of [-2,-1,1,2]) {
      const u=unit({level:5,armorBonuses:{speed:p}});
      expect(movementPoints(u)-movementPoints(unit())).toBeCloseTo(p*.5);expect(initiative(u)-initiative(unit())).toBeCloseTo(p);
    }
    const cursed=unit({bonuses:{speed:-10},armorBonuses:{speed:-10}});expect(movementPoints(cursed)).toBe(0);expect(cursed.base.spd).toBeLessThan(0);
  });
  it('速度小数跨激活兑现，预览不吃掉会战行军余量', () => {
    const u=unit({level:2,bonuses:{speed:1}});let steps=0;
    for(let i=0;i<5;i++){const budget=movementPoints(u)+(u.movementRemainder??0);steps+=Math.floor(budget+1e-9);u.movementRemainder=movementFraction(budget);}
    expect(steps).toBe(16);
    const a=unit({scale:'company',level:2,bonuses:{speed:1}}),d=unit({name:'d',side:'enemy',scale:'company'});
    const battle=new MassBattle({combatants:[a,d],rules:V26_OVERFLOW_TW,seed:'march',traitRegistry:registry});battle.start();
    const before=JSON.stringify(battle.toSnapshot());battle.orderPreview({unitId:a.id,type:'rank-back'});expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    expect(formationMarchSteps(a)).toBeCloseTo(3.2/3);
  });
  it('T2士气−2/+4形成55/79差异，个体同样生效；超过100保留储备，抵抗不再按十点截断', () => {
    for(const scale of ['hero','company'] as const){expect(unit({level:2,scale,bonuses:{morale:-2}}).morale).toBe(55);expect(unit({level:2,scale,bonuses:{morale:4}}).morale).toBe(79);}
    const a=unit({level:10,bonuses:{morale:4}}),context={mode:'small' as const,units:[a],fieldTags:[]};
    expect(moraleProfile(context,a).effective).toBe(135);
    a.status='routing';a.morale=55;const first=moraleRisk(context,a,25).rallyChance;a.morale=56;expect(moraleRisk(context,a,25).rallyChance).toBeGreaterThan(first);
    const stubborn=unit({traits:['stubborn'],traitLevels:{stubborn:5}}),profile=moraleProfile({mode:'small',units:[stubborn],fieldTags:[]},stubborn);
    expect(stubborn.base.moraleMax).toBe(72);expect(profile.effective).toBe(72+profile.resilience);
  });
  it('护甲／盾的士气每点按装备L+2换算，正负和L1–10均有差别；挂背或损坏盾失效', () => {
    for(const slot of ['armor','shield'] as const) for(let level=1;level<=10;level++) {
      let previous=-Infinity;
      for(const points of [-2,-1,0,1,2]) {
        const u=unit({level:2,armorLevel:level,shield:true,shieldClass:'shield',shieldLevel:level,
          ...(slot==='armor'?{armorBonuses:{morale:points}}:{shieldBonuses:{morale:points}})});
        const value=moraleProfile({mode:'small',units:[u],fieldTags:[]},u).effective;
        expect(value).toBeCloseTo(63+points*(level+2));expect(value).toBeGreaterThan(previous);previous=value;
      }
    }
    const u=unit({level:2,armorLevel:2,armorBonuses:{morale:1},shield:true,shieldClass:'shield',shieldLevel:2,shieldBonuses:{morale:1}});
    const effective=()=>moraleProfile({mode:'small',units:[u],fieldTags:[]},u).effective;
    expect(effective()).toBe(71);u.weapon!.hands=2;expect(effective()).toBe(67);u.weapon!.hands=1;
    u.shieldDurability={remaining:0};expect(effective()).toBe(67);
  });
  it('新生命提高50%，编队仅增加每人耐久；版本转换保留伤口、自定义上限和旧装备', () => {
    const legacy=unit({},true),u=unit(),group=unit({scale:'company'});
    expect(legacy.base.hpMax).toBe(88);expect(u.base.hpMax).toBe(132);expect(group.hp).toBe(50);expect(group.formation!.memberHp).toBe(132);
    legacy.hp-=10;const physical=JSON.stringify([legacy.weapon,legacy.armor]);prepareCombatModel(legacy,rules);
    expect(legacy.hp).toBe(122);expect(legacy.base.hpMax).toBe(132);expect(JSON.stringify([legacy.weapon,legacy.armor])).toBe(physical);
    prepareCombatModel(legacy,rules);expect(legacy.hp).toBe(122);
    const custom=unit({hpMax:211,hp:199},true);prepareCombatModel(custom,rules);expect([custom.base.hpMax,custom.hp]).toEqual([211,199]);
    expect(nominalLife(unit({bonuses:{health:-10,power:-10}}))).toBe(1);
    const cursed=unit({level:8,bonuses:{health:-10}});applyXp(cursed,999999,registry);expect(cursed.level).toBe(10);expect(cursed.base.hpMax).toBe(nominalLife(cursed));
  });
  it('新负面佩戴效果逐级增长且不受通用+通道上限截断；v1读取与显式升级各守版本', () => {
    const m=compileItem({kind:'item',form:'worn',power:10,bonuses:{damage:-10,kineticDamage:-10,protection:-10,kineticProtection:-10,speed:-10}}, {id:'curse',seed:'curse'});
    if(m.kind!=='item')throw Error('fixture');validateItemValue(JSON.parse(JSON.stringify(m.value)));
    const u=unit();u.gear=[gearItem('curse','curse',m.value)];expect(wornEffects(u).kineticDamage).toBeCloseTo(-4.095);expect(wornEffects(u).kineticProtection).toBeCloseTo(-6.5);expect(movementPoints(u)).toBe(0);expect(anchoredProtection(u,'kinetic')).toBeGreaterThanOrEqual(0);expect(preview(u).expectedDamage).toBe(0);
    const old=structuredClone(m.value);old.recipe.wornEffectModel='worn-anchored-v1';old.passive!.actualEffects=compileWornEffects(old.passive!.bonuses,10,'worn-anchored-v1');
    const before=JSON.stringify(old);validateItemValue(old);const upgraded=upgradeWornItemBudget(old);expect(JSON.stringify(old)).toBe(before);expect(upgraded.passive).toEqual(m.value.passive);
    expect(compileWornEffects({speed:-10},10).values.speed).toBe(-10);expect(compileWornEffects({speed:-10},5).values.speed).toBe(-5);
    const frozen = (bonuses: {damage?:number;kineticDamage?:number}) => {
      const m=compileItem({kind:'item',form:'worn',power:2,bonuses},{id:'old',seed:'old'});if(m.kind!=='item')throw Error('fixture');
      m.value.recipe.wornEffectModel='worn-anchored-v1';m.value.passive!.actualEffects=compileWornEffects(bonuses,2,'worn-anchored-v1');return m.value;
    };
    const weak=compileItem({kind:'item',form:'worn',power:10,bonuses:{damage:-1}},{id:'weak',seed:'weak'});if(weak.kind!=='item')throw Error('fixture');
    u.gear=[gearItem('old-a','a',frozen({damage:-10})),gearItem('old-b','b',frozen({kineticDamage:-10})),gearItem('weak','c',weak.value)];
    expect(wornEffects(u).kineticDamage).toBeCloseTo(-.275);
  });
  it('新建档和库存选择新模型，恢复旧战斗不转换；新余量可保存，战后档案不携带', () => {
    const draft=newUnitDraft();draft.name='new';const built=buildUnit(draft,registry,'build');expect(built.numericModel).toBe('graded-v1');expect(built.weapon?.recipe?.numericModel).toBe('graded-v1');
    const item=createInventoryItem('w','剑',{kind:'weapon',mechanism:'sword',power:5},'w');if(item.mechanics?.kind!=='weapon')throw Error('fixture');expect(item.mechanics.value.recipe?.numericModel).toBe('graded-v1');
    const a=unit({},true),d=unit({name:'d',side:'enemy'},true),field=standardField();field.tiles.fill('open');
    const battle=new SmallBattle({combatants:[a,d],rules:V25_OVERFLOW_D20,battlefield:field,seed:'legacy',traitRegistry:registry});battle.start();
    const snap=battle.toSnapshot(), restored=SmallBattle.fromSnapshot(structuredClone(snap),{traitRegistry:registry});expect(restored.toSnapshot()).toEqual(snap);expect(restored.combatants[0]!.numericModel).toBeUndefined();expect(restored.combatants[0]!.base.hpMax).toBe(88);
    const u=unit();u.movementRemainder=.4;expect(combatantFromUnknown(JSON.parse(JSON.stringify(u))).movementRemainder).toBe(.4);
    const record=unitRecordFromCombatant(u,undefined,{kind:'battle'});expect(record.snapshot!.movementRemainder).toBeUndefined();expect(materializeUnitRecord(record,registry).numericModel).toBe('graded-v1');
  });
  it('车辆容量固定24，火炮的配方、负载和装备修正保持原数值', () => {
    for(const level of [2,5,10])expect(equipmentCapacity(unit({level,body:'vehicle'}))).toBe(24);
    for(const weaponClass of ['cannon','indirect-cannon','autocannon','rocket']) {
      const old=unit({weaponClass,weaponBonuses:{accuracy:2,damage:2,range:2}},true),next=unit({weaponClass,weaponBonuses:{accuracy:2,damage:2,range:2}});
      expect(next.weapon).toEqual(old.weapon);expect(anchoredWeapon(next.weapon,undefined,'wounds-v2')).toEqual(anchoredWeapon(old.weapon,undefined,'wounds-v2'));
    }
  });
});
