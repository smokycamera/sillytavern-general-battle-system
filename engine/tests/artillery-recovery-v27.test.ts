import {describe,it,expect} from 'vitest';
import {generateUnit,prepareCombatModel,prepareArmsModel,prepareTraitModel,prepareTraitLevelModel,prepareItemModel,prepareResourceModel,
  V26_OVERFLOW_D20,V27_OVERFLOW_D20,standardConditionMap,traitRegistry,previewAttack,resolveAttack,SeededRng,compileItem,
  historicalRecoveryItem,upgradeRecoveryItemBudget,validateItemValue,regenerationAmount,healingYield,compileSkill,upgradeCombatSkills,
  SmallBattle,standardField,type Combatant,type RulePack,type ItemValue} from '../src/index.js';
import {artilleryDirect,artillerySplash,artilleryRetention} from '../src/artillery-model.js';
import {combatWeapon} from '../src/power-anchors.js';
import {cannonAmmoControl} from '../../panel/src/combat-model-view.js';
import {resolveHealingBudget} from '../src/healing.js';
import {placeZone,settleZones} from '../src/area-effects.js';
import {applyDamagePlan} from '../src/recovery.js';
import {combatantFromUnknown} from '../../panel/src/unit-state.js';
const reg=traitRegistry(),conditions=standardConditionMap();
function unit(name='a',rules:RulePack=V27_OVERFLOW_D20,company=false,level=5,weapon='cannon'):Combatant {
  const u=generateUnit({name,side:name==='a'?'ally':'enemy',scale:company?'company':'hero',level,rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',traits:[],
    weaponClass:weapon,weaponLevel:level,armorTier:1,armorLevel:level,...(company?{hpMax:30}:{})},{seed:name,noVariance:true}).unit;
  prepareCombatModel(u,rules);prepareArmsModel(u,rules);prepareTraitModel(u,rules);prepareTraitLevelModel(u,rules);prepareItemModel(u,rules);prepareResourceModel(u,rules);return u;
}
function opts(a:Combatant,d:Combatant,rules=V27_OVERFLOW_D20){return {attacker:a,defender:d,rules,conditionDefs:conditions,traitRegistry:reg,ranged:true,distance:4};}
describe('V27 火炮与增血后的恢复',()=>{
  it('新战斗炮弹统一，旧he/ap选择不再改变新伤害，旧版本保留弹种控件',()=>{
    for(const mechanism of ['cannon','indirect-cannon','rocket']){
      const a=unit(),d=unit('d',V27_OVERFLOW_D20,true);a.weapon=generateUnit({name:'gun',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',weaponClass:mechanism,weaponLevel:5,level:5,traits:[]},{noVariance:true,seed:'gun'}).unit.weapon;
      a.cannonAmmo='ap';const ap=previewAttack(opts(a,d));a.cannonAmmo='he';const he=previewAttack(opts(a,d));expect(ap).toEqual(he);expect(combatWeapon(a.weapon,a,d,false,'wounds-v2')?.ammunition).toBeUndefined();expect(cannonAmmoControl(a)).toBe('');
    }
    const old=unit('a',V26_OVERFLOW_D20);old.cannonAmmo='ap';expect(cannonAmmoControl(old)).toContain('穿甲弹');expect(combatWeapon(old.weapon,old,unit('d'),false,'wounds-v2')?.ammunition).toBe('ap');
  });
  it('余伤与溅射连续衰减、没有固定击杀人数上限，防护与训练会影响残余扩散',()=>{
    const d=unit('d',V27_OVERFLOW_D20,true),k=artilleryRetention(d,5);
    expect(artilleryDirect(80,100,k)).toBe(80);expect(artilleryDirect(100,100,k)).toBe(100);
    const a=artilleryDirect(1000,100,k),b=artilleryDirect(10000,100,k);expect(a).toBeGreaterThan(100);expect(b).toBeGreaterThan(a);expect(b-a).toBeLessThan(1000-100);
    expect(artillerySplash(1000,100,4,.4)).toBeLessThan(1000*4*.4);
    expect(artilleryRetention({...d,level:10},5)).toBeLessThan(k);expect(artilleryRetention({...d,armor:{...d.armor!,tier:4}},5)).toBeLessThan(k);
  });
  it('实际伤损、预览及延后提交使用同一衰减，屏障不能恢复未衰减的余伤',()=>{
    const oldA=unit('a',V26_OVERFLOW_D20,false,8),oldD=unit('d',V26_OVERFLOW_D20,true,3),a=unit('a',V27_OVERFLOW_D20,false,8),d=unit('d',V27_OVERFLOW_D20,true,3);
    const old=resolveAttack({...opts(oldA,oldD,V26_OVERFLOW_D20),autoHit:true,rng:new SeededRng('impact')}),next=resolveAttack({...opts(a,d),autoHit:true,rng:new SeededRng('impact')});
    expect(next.finalDamage).toBeLessThan(old.finalDamage);expect(next.overflowDamage).toBeLessThan(old.overflowDamage!);
    const replay=unit('d',V27_OVERFLOW_D20,true,3);const loss=applyDamagePlan(replay,next.damagePlans![0]!);expect(loss.direct+loss.splash).toBe(next.finalDamage);
    const shielded=unit('d',V27_OVERFLOW_D20,true,3);shielded.barrier={remaining:1,duration:1};
    const shieldedLoss=applyDamagePlan(shielded,next.damagePlans![0]!);expect(shieldedLoss.direct+shieldedLoss.splash).toBeLessThanOrEqual(next.finalDamage);
    const fresh=unit('d',V27_OVERFLOW_D20,true,3),before=JSON.stringify(fresh);const p=previewAttack(opts(a,fresh));expect(p.expectedDamage).toBeGreaterThan(0);expect(JSON.stringify(fresh)).toBe(before);
    const oldAgain=previewAttack(opts(oldA,unit('d',V26_OVERFLOW_D20,true,3),V26_OVERFLOW_D20));expect(oldAgain.expectedDamage).toBeGreaterThan(p.expectedDamage);
  });
  it('旧火炮快照按原弹种重放，新快照保持统一炮弹规则',()=>{
    for(const rules of [V26_OVERFLOW_D20,V27_OVERFLOW_D20]){const a=unit('a',rules),d=unit('d',rules,true);a.cannonAmmo='ap';const field=standardField();field.tiles.fill('open');
      const b=new SmallBattle({combatants:[a,d],rules,battlefield:field,seed:'saved',traitRegistry:reg});b.start();const snap=b.toSnapshot();expect(SmallBattle.fromSnapshot(structuredClone(snap),{traitRegistry:reg}).toSnapshot()).toEqual(snap);
      expect(a.cannonAmmo).toBe(rules===V26_OVERFLOW_D20?'ap':undefined);}
  });
  it('可信治疗与再生跟随50%生命提高，医护、跨级和剂量均只乘一次',()=>{
    const old=unit('a',V26_OVERFLOW_D20),u=unit();old.hp=1;u.hp=1;old.traits=u.traits=['regen'];old.traitLevels=u.traitLevels={regen:5};
    expect(regenerationAmount(u)).toBeCloseTo(regenerationAmount(old)*1.5);expect(healingYield(u,u,32,false,5)).toBe(48);expect(healingYield(old,old,32,false,5)).toBe(32);
    expect(healingYield(u,u,32,true,5)).toBe(32);expect(healingYield(u,u,32,false)).toBe(32);
    expect(resolveHealingBudget({source:u,target:u,baseAmount:10,power:5,delivery:'item',itemDoses:2})).toBe(20);
  });
  it('新恢复道具在编译时增加50%，旧实物保持，显式更新可信旧道具不丢身份',()=>{
    const item=(modern:boolean)=>{const m=compileItem({kind:'item',form:'single',active:'generic:buff:heal',power:5},{id:'pot',seed:'pot',...(modern?{numericModel:'graded-v1' as const}:{})});if(m.kind!=='item')throw Error('fixture');return m.value;};
    const old=item(false),next=item(true),e=(v:ItemValue)=>v.ability!.effects.find(e=>e.op==='heal')!;
    expect(e(next)).toMatchObject({amount:69});expect(e(old)).toMatchObject({amount:46});validateItemValue(JSON.parse(JSON.stringify(next)));
    const before=JSON.stringify(old);expect(historicalRecoveryItem(old)).toBe(true);expect(upgradeRecoveryItemBudget(old).ability).toEqual(next.ability);expect(JSON.stringify(old)).toBe(before);
  });
  it('治疗区域的新恢复倍率冻结在区域中，物品区域不重复放大',()=>{
    const a=unit(),d=unit('d');d.side='ally';a.pos=28;d.pos=29;d.hp=1;
    const context={mode:'small' as const,units:[a,d],fieldTags:[],rules:V27_OVERFLOW_D20,battlefield:standardField()};
    const zone={op:'zone' as const,kind:'healing' as const,power:5,amount:10,healingModel:'healing-grades-v1' as const,radius:1,dur:2};
    const z=placeZone(context,a,d,zone,1,'heal');expect(z.recoveryModel).toBe('life-scaled-v1');settleZones(context,2,false,new SeededRng('zone'));expect(d.hp).toBe(16);
    d.hp=1;a.battleZones=[];const iz=placeZone(context,a,d,{...zone,amount:15,itemEffectModel:'item-progression-v3'},2,'item-heal');expect(iz.recoveryModel).toBeUndefined();settleZones(context,3,false,new SeededRng('zone'));expect(d.hp).toBe(16);
    expect(combatantFromUnknown(JSON.parse(JSON.stringify(a))).recoveryModel).toBe('life-scaled-v1');
  });
});
