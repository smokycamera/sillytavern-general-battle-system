import { equipmentMultiplier, equipmentRating, gradedNumbers } from './numeric-model.js';
import { displayNumber } from './display-number.js';
import { progression, stackingRevision } from './progression.js';
import { traitParameter } from './trait-parameters.js';
import { wornProtection } from './gear-bonuses.js';
import { phase2Traits } from './trait-level-model.js';
import { effectiveTraitLevel } from './trait-sources.js';
import { instanceMultiplier, instanceRating } from './instance-variance.js';
import { isWoundModel, UNIFIED_WOUNDS, UNIFIED_SPLASH, powerIndex } from './balance.js';
import { compileWeapon } from './gen/equipment.js';
import { isCannonWeapon, isRangedWeapon } from './loadout.js';
import { bonusMultiplier, bonusRating, bonusPoints, channelPoints } from './enhancements.js';
import { gearBonuses } from './gear-bonuses.js';
import type {Armor,Combatant,DamageChannel,Weapon,RulePack} from './types.js';
import {curveAt} from './data/curves.js';
import {diceAvg,baseMechanism} from './data/weapons.js';
import {BODY} from './body.js';
import {meleeProfile} from './melee.js';
import {hasMemberHealth,damageMemberGroups} from './member-health.js';
import { barrierDefensePower, validDefensePower } from './barrier.js';
import { armorTierOffset, shieldUsable, shieldClass, shieldCoverage, isArmsV2, type ShieldBearer } from './arms.js';

/** 装备P与训练T分离；高阶增加战术毁伤与覆盖规模，不追加随机骰数量。 */
export const POWER_ANCHORS=[
 {level:1,name:'初始级',budget:4.5,example:'手铳、早期火门枪、劣质冷兵器、投石机、多管排枪/风琴炮、原始炼金武器、最低级一环魔法、破烂甲、木盾、绷带、野狗等天生武器'},
 {level:2,name:'早期军用级',budget:10,example:'火绳枪、普通制式冷兵器、重弩、射石炮、初级二环魔法、制式护甲、包铁盾、药膏、熊等天生武器'},
 {level:3,name:'成熟前工业级',budget:24,example:'燧发枪、优质冷兵器、黑火药火炮、三环魔法、优质护甲、钢盾、急救包、初级治疗药水、初级魔兽天生武器'},
 {level:4,name:'工业军用级／名匠级',budget:60,example:'后装线膛步枪、百炼名器/初级魔导武器、大口径重机枪/20mm早期机炮、近现代火炮、四环魔法、精工重铠/初级附魔甲/防弹衣、防弹盾、中级治疗药水、双足飞龙等中级魔兽天生武器'},
 {level:5,name:'现代军用级／符文级',budget:150,example:'现代步枪、动力冷兵器/符文名刃、25–40mm现代机炮、现代火炮、成熟魔导武器、五环魔法、秘银符文甲/载具重装甲、高级治疗药水、幼龙等高级魔兽天生武器'},
 {level:6,name:'重型／近未来',budget:420,example:'反器材步枪、重型魔导武器、高分子冷兵器/大师级兵刃、50–60mm机炮、重型火炮、轻型电磁炮、六环魔法、先进载具重装甲、再生药水、成年龙等泰坦生物天生武器'},
 {level:7,name:'未来／史诗级',budget:1400,example:'单兵电磁武器、史诗魔导武器/神锻圣剑、大口径高速机炮、重型电磁机炮、超重型火炮、七环魔法、史诗工匠锻甲/先进动力装甲、纳米修复、史诗药水、古龙等史诗生物天生武器'},
 {level:8,name:'传奇级',budget:6000,example:'重型等离子武器、传奇魔剑、力场武器、等离子机炮、轨道炮、太空战舰主炮、八环魔法、传奇工匠锻甲/太空战舰装甲、传奇灵药、龙王、深渊领主等传奇生物天生武器'},
 {level:9,name:'战役兵器／半神器级',budget:40000,example:'反物质、相位武器、半神器、行星炮、九环魔法、半神器装甲、半神器灵药、半神兽天生武器'},
 {level:10,name:'神器级',budget:400000,example:'神器、概念、因果、空间切断、法则、位面级武器、神器装甲、神器灵药、神兽'},
] as const;
/** R17 火箭筒单发伤害为同级直射火炮的比例；W12、W13 旋钮。 */
export const ROCKET_DAMAGE_SHARE = 2 / 3;
export const powerBudget=(power:number)=>POWER_ANCHORS[Math.max(0,Math.min(9,Math.round(power)-1))]!.budget;
/** 单体创伤预算独立于穿透/范围；身体生命不会因穿戴高阶装备而膨胀。 */
export const WOUND_BUDGETS=[4.5,10,24,28,32,36,42,48,56,64] as const;
export const woundBudget=(power:number)=>WOUND_BUDGETS[Math.max(0,Math.min(9,Math.round(power)-1))]!;
export const combatPowerBudget=(power:number,model?:Combatant['damageModel'])=>model==='wounds-v2'?UNIFIED_WOUNDS[powerIndex(power)]!:model==='wounds-v1'?woundBudget(power):powerBudget(power);
export function penetrationThrough(power:number,resistance:number):number {
  if(!Number.isFinite(power)||!Number.isFinite(resistance)||power<0||resistance<0)throw Error('穿透与防护须为非负有限数');
  const gap=power-resistance;
  if(gap>=1)return 1;if(gap<=-3)return 0;
  const anchors=[0,.12,.3,.55,1],lower=Math.floor(gap),index=lower+3;
  return anchors[index]!+(anchors[index+1]!-anchors[index]!)*(gap-lower);
}
/** 至多8粒骰；高规格通过倍率增长，暴击仍能放大整个伤害预算。 */
export function scaledPowerDice(mean:number):{dice:string;scale:number} {
  if(mean<=0)return {dice:'1d2-2',scale:1};
  const dice=mean<3.5?'1d2':'8d6',base=mean<3.5?1.5:28;
  return {dice,scale:mean/base};
}
/** Recompile known giant recipes with the saved seed; preserve hand-authored instances. */
function projectWeaponStrength(weapon: Weapon, model?: Combatant['damageModel']): Weapon {
  const recipe=weapon.recipe;
  if (!recipe || recipe.size!=='giant' || isRangedWeapon(weapon) || weapon.customized) return weapon;
  const from=recipe.balanceVersion==='unified-v1'?'wounds-v2':undefined;
  if ((from==='wounds-v2') === (model==='wounds-v2')) return weapon;
  const spec={mechanism:recipe.mechanism,power:recipe.power,bonuses:recipe.bonuses,stabilized:recipe.stabilized,enchantment:recipe.enchantment};
  const context={id:weapon.id,name:weapon.name,seed:recipe.seed,body:recipe.size,quality:recipe.quality,creatingUnit:true,variance:recipe.variance??false as const};
  // Historical noVariance was not serialized. Match the original dice without a new roll;
  // if rounding makes both modes indistinguishable, prefer the normal seeded recipe.
  for (const noVariance of recipe.noVariance===undefined?[false,true]:[recipe.noVariance]) {
    const old=compileWeapon(spec,{...context,noVariance,damageModel:from});
    if (old.baseDice===weapon.baseDice && !weapon.apDice) {
      const next=compileWeapon(spec,{...context,noVariance,damageModel:model});
      return {...weapon,baseDice:next.baseDice,recipe:{...recipe,...(model==='wounds-v2'?{balanceVersion:'unified-v1' as const}:{balanceVersion:undefined})}};
    }
  }
  // An unrecognized old dice override remains authoritative, just like customized gear.
  return weapon;
}
export function anchoredWeapon(weapon:Weapon|undefined,ammo:'he'|'ap'='he',model?:Combatant['damageModel']):Weapon|undefined {
  if(!weapon)return undefined;
  const projection=isWoundModel(model)?model!:'anchors-v1';
  if(weapon.powerModel===projection||weapon.powerModel&&weapon.customized)return weapon;
  if(weapon.powerModel){
    const power=weapon.recipe?.power??weapon.level??5;
    const ratio=combatPowerBudget(power,model)/combatPowerBudget(power,weapon.powerModel==='anchors-v1'?undefined:weapon.powerModel);
    const giantMelee=weapon.recipe?.size==='giant'&&!isRangedWeapon(weapon);
    const strength=giantMelee?((model==='wounds-v2'?3:1.8)/(weapon.powerModel==='wounds-v2'?3:1.8)):1;
    return {...weapon,powerModel:projection,damageScale:(weapon.damageScale??1)*ratio*strength,
      ...(isCannonWeapon(weapon)&&ammo==='he'&&model==='wounds-v2'?{splashTargets:weapon.recipe?.mechanism==='rocket' && UNIFIED_SPLASH[powerIndex(power)]!>0 ? Math.max(1,UNIFIED_SPLASH[powerIndex(power)]!-2) : UNIFIED_SPLASH[powerIndex(power)]}:{})};
  }
  weapon = projectWeaponStrength(weapon, model);
  const mechanism=baseMechanism(weapon),actual=weapon.recipe?.mechanism??weapon.tags?.find(t=>t.startsWith('mechanism:'))?.slice(10);
  if(!mechanism)return weapon;
  const power=weapon.recipe?.power??weapon.level??5,curve=curveAt(power),old=diceAvg(curve.dmgBase)+(curve.dmgAp?diceAvg(curve.dmgAp):0);
  const melee=meleeProfile(weapon);
  const ratio=combatPowerBudget(power,model)/old*(actual==='rocket'?3*ROCKET_DAMAGE_SHARE:isCannonWeapon(weapon)?3:mechanism==='autocannon'?1.5:1)*(melee?.damageScale??1);
  const base=diceAvg(weapon.baseDice)+(weapon.apDice?diceAvg(weapon.apDice):0),scaled=scaledPowerDice(base*ratio*equipmentMultiplier(weapon.customized && weapon.recipe ? {...weapon.recipe,variance:undefined} : weapon.recipe, 'damage',weapon.channel??'kinetic')*(mechanism==='summon'?(weapon.damageScale??1):1));
  const artillery=isCannonWeapon(weapon),explosive=artillery&&ammo==='he'&&power>=3;
  const baseSplash=explosive?(model==='wounds-v2'?UNIFIED_SPLASH[powerIndex(power)]!:power>=10?1e9:power>=9?256:power>=8?12:power>=7?6:power>=5?4:2):mechanism==='demolition'?6:0;
  const splash=actual==='rocket'&&baseSplash>0?Math.max(1,baseSplash-2):baseSplash;
  return {...weapon,powerModel:projection,ammunition:ammo,baseDice:scaled.dice,apDice:undefined,damageScale:scaled.scale,
    penetration:Math.max(0,2*power+(actual==='crossbow'?1:actual==='shotgun'?0:(['cannon','indirect-cannon','autocannon','demolition'].includes(mechanism)?2:mechanism==='heavy-rifle'?2:['firearm','rifle','energy'].includes(mechanism)?1:0))+(melee?.penetration??0)+(artillery&&ammo==='ap'?(actual==='rocket'?3:2):0)+equipmentRating(weapon.customized && weapon.recipe ? {...weapon.recipe,variance:undefined} : weapon.recipe,'penetration',weapon.channel??'kinetic')),
    splashTargets:splash,splashFactor:mechanism==='demolition'?0.6:0.4};
}
const RESIST_TRAITS = { kinetic: 'kinetic-resist', thermal: 'thermal-resist', arcane: 'arcane-resist' } as const;
type ResistSources = Partial<Pick<Combatant,'rulesVersion'|'traitLevelModel'|'traits'|'traitLevels'|'traitSources'|'gear'|'accessories'>>;
/** 动能/热能/奥术抵抗：该通道防护再加 2×woundRatio[L]（L5 为 +2，相当同通道高一级护甲），不占修正的 ±2 上限。
 * 抵抗只来自本体、bless/技能、佩戴品与旧饰品，身体和装备不会自动派生；先查原始来源，避免每次都归集全部特质。 */
export function resistProtection(unit:ResistSources,channel:DamageChannel):number {
  const id=RESIST_TRAITS[channel];
  if(stackingRevision(unit))return 0;
  if(!phase2Traits(unit)||!(unit.traits?.includes(id)||unit.traitSources?.some(s=>s.traitIds.includes(id))
    ||unit.gear?.some(item=>item.passive?.traits.some(grant=>grant.id===id))||Object.values(unit.accessories??{}).some(item=>item?.traitId===id)))return 0;
  const level=effectiveTraitLevel(unit as Combatant,id);
  return level ? progression(unit) ? traitParameter('channelResistance',level,unit.traitLevelModel) : 2*traitParameter('woundRatio',level) : 0;
}
/** 实际通道抗穿 = 护甲/身体/修正得到的防护 + 对应抵抗。 */
export function anchoredProtection(unit:ShieldBearer & Pick<Combatant,'armor'|'body'|'shield'|'damageModel'|'armsModel'>&Partial<Pick<Combatant,'gear'|'itemModel'>>&ResistSources,channel:DamageChannel):number {
  return Math.max(0, equipmentProtection(unit,channel)+resistProtection(unit,channel)+wornProtection(unit,channel));
}
function equipmentProtection(unit:ShieldBearer & Pick<Combatant,'armor'|'body'|'shield'|'damageModel'|'armsModel'>&Partial<Pick<Combatant,'gear'|'itemModel'>>,channel:DamageChannel):number {
  const armor=unit.armor,innate=BODY[unit.body??'human'].protection[channel];
  const armorBonus=armor?.recipe?.bonuses,shieldBonus=isWoundModel(unit.damageModel)||!shieldUsable(unit)?undefined:unit.shield?.recipe?.bonuses,gear=gearBonuses(unit);
  // 佩戴道具的防护（同方向取最高一件）与护甲、盾的防护修正相加，合计仍限 ±10 点。
  const own=bonusPoints(armorBonus,'protection')+channelPoints(armorBonus,'protection',channel)+bonusPoints(shieldBonus,'protection')+channelPoints(shieldBonus,'protection',channel);
  const adjustment=armor?.recipe && gradedNumbers(armor.recipe)
    ? equipmentRating({...armor.recipe,variance:undefined},'protection',channel) + bonusRating({protection:bonusPoints(shieldBonus,'protection')+channelPoints(shieldBonus,'protection',channel)+bonusPoints(gear,'protection')+channelPoints(gear,'protection',channel)},'protection')
    : bonusRating({protection:own+bonusPoints(gear,'protection')+channelPoints(gear,'protection',channel)},'protection');
  if(!armor)return Math.max(0, Math.max(innate,adjustment));
  if(armor.protectionOverride&&armor.protection)return Math.max(0, Math.max(BODY[unit.body??'human'].protection[channel],armor.protection[channel]));
  const power=armor.recipe?.power??armor.level??5,tier=armor.tier;
  const base=tier===0?0:Math.max(0,2*power+armorTierOffset(tier,unit.armsModel));
  const protection={kinetic:base,thermal:Math.max(0,base-1),arcane:Math.max(0,base-2)};
  const focus=armor.recipe?.protectionProfile;
  if(focus&&focus!=='balanced'){
    let left=2;for(const key of (['kinetic','thermal','arcane'] as const).filter(k=>k!==focus).sort((a,b)=>protection[b]-protection[a])){const n=Math.min(protection[key],left);protection[key]-=n;protection[focus]+=n;left-=n;}
  }
  const nominal = protection[channel] + adjustment;
  // Zero protection stays zero: generation does not conjure armor onto bare skin. The armor's own
  // instance variance follows only its own protection, never a worn charm's.
  const variation = protection[channel] + bonusRating({protection:own},'protection') > 0 ? equipmentRating(armor.recipe, 'protection', channel) - equipmentRating(armor.recipe ? {...armor.recipe,variance:undefined} : undefined, 'protection', channel) : 0;
  return Math.max(0, Math.max(innate,armor.recipe?.variance?Number((nominal + variation).toPrecision(12)):nominal));
}
/** 高阶材料/护场提供等效耐久；24为固定同代交战基准，避免提高攻击曲线后同档全部秒杀。 */
export function armorPowerScale(unit:ShieldBearer & Pick<Combatant,'armor'|'shield'|'damageModel'>):number {
  if(isWoundModel(unit.damageModel))return 1;
  const armor=unit.armor?.powerScale??(unit.armor&&unit.armor.tier>0?Math.max(1,powerBudget(unit.armor.recipe?.power??unit.armor.level??5)/24)*bonusMultiplier(unit.armor.recipe?.bonuses,'power'):1);
  const shield=shieldUsable(unit)?unit.shield?.powerScale??(unit.shield ? Math.max(1,powerBudget(unit.shield.recipe?.power??3)/48) : 1):1;
  return Math.max(armor,shieldUsable(unit)?shield:0)*bonusMultiplier(shieldUsable(unit)?unit.shield?.recipe?.bonuses:undefined,'power');
}
/** 强度只改变部分穿透时的吸能；完全穿透/无法穿透不被另加减伤。 */
export function armorTransmission(unit:ShieldBearer & Pick<Combatant,'armor'|'body'|'shield'|'damageModel'|'armsModel'>,channel:DamageChannel,penetration:number):number {
  const through=penetrationThrough(penetration,anchoredProtection(unit,channel));
  const armorDominates=equipmentProtection({...unit,body:'human'},channel)>=BODY[unit.body??'human'].protection[channel];
  return isWoundModel(unit.damageModel)&&unit.armor&&armorDominates ? through**equipmentMultiplier(unit.armor.recipe,'power') : through;
}
/** 盾牌有界覆盖按期望折算，不追加随机骰；范围/失能/充分穿透不会获得保护。 */
export function shieldProtection(unit:ShieldBearer & Pick<Combatant,'shield'>,channel:DamageChannel):number {
  if(!shieldUsable(unit) || isArmsV2(unit.armsModel) && shieldClass(unit)==='energy-shield')return 0;
  const recipe=unit.shield!.recipe;
  return Math.max(0,2*(recipe?.power??3)+1-({kinetic:0,thermal:1,arcane:2}[channel])+equipmentRating(recipe,'protection',channel));
}
export function shieldTransmission(unit:ShieldBearer & Pick<Combatant,'shield'|'status'>,channel:DamageChannel,penetration:number,area=false,canBlock=true):number {
  if(!shieldUsable(unit)||unit.status!=='ready'||area||!canBlock)return 1;
  const coverage=shieldCoverage(unit);
  return 1-coverage*(1-penetrationThrough(penetration,shieldProtection(unit,channel)));
}

/** Real channel resistance expressed in the existing equipment-L scale, never training T.
 * Type/channel offsets preserve ordinary same/adjacent-grade loadouts. Explicit overrides,
 * focus and signed protection modifiers are reflected through the actual resistance.
 * An absent/zero channel grants no protection merely because a recipe has a high L. */
export function protectionPower(unit:ShieldBearer & Pick<Combatant,'armor'|'body'|'shield'|'damageModel'|'armsModel'>,channel:DamageChannel):number {
  const resistance=anchoredProtection(unit,channel),armor=unit.armor;
  if(resistance<=0)return 0;
  const innate=BODY[unit.body??'human'].protection[channel];
  if(!armor?.tier||equipmentProtection({...unit,body:'human'},channel)<innate)return resistance/2;
  const offset=armorTierOffset(armor.tier,unit.armsModel)-({kinetic:0,thermal:1,arcane:2}[channel]);
  return Math.max(0,(resistance-offset)/2);
}
function continuousPowerBudget(power:number):number {
  const p=Math.max(1,Math.min(10,power)),low=Math.floor(p),fraction=p-low;
  return powerBudget(low)*(powerBudget(Math.min(10,low+1))/powerBudget(low))**fraction;
}
/** Legacy keeps its one-grade safe band; V10 starts at any positive fractional gap.
 * Extra damage ramps in only after the attack exceeds the actual channel resistance.
 * No unit HP, personnel, training, size damage multiplier or new random roll enters here. */
export function gradeOvermatch(power:number|undefined,defensePower:number,penetration:number,resistance:number,curve?:RulePack['overmatchCurve']):number {
  if(curve==='continuous-v1'||curve==='continuous-soft40-v1'){
    if(power===undefined||!Number.isFinite(power)||power<1||power>10
      ||!Number.isFinite(defensePower)||!Number.isFinite(penetration)||!Number.isFinite(resistance)||power<=defensePower)return 1;
    const gap=power-defensePower,ratio=continuousPowerBudget(power)/continuousPowerBudget(defensePower);
    // Adjacent gaps already use the full budget ratio. Only the ADDITIONAL
    // far-gap bonus ramps from x1 toward x2 (C1 at gap=1), without a hard cap.
    const tail=Math.max(0,gap-1)**2;
    const extra=(Math.sqrt(ratio)-1)*(1+tail/(1+tail));
    // Weight only extra overmatch. Attack specification, never actor level, drives it.
    // Smooth endpoints at L3/L7; the frozen V10 curve and all high-grade attacks stay exact.
    const x=Math.max(0,Math.min(1,(power-3)/4));
    const weight=curve==='continuous-soft40-v1' ? 0.4+0.6*(3*x*x-2*x*x*x) : 1;
    return 1+extra*weight*Math.max(0,Math.min(1,penetration-resistance));
  }
  if(power===undefined||!Number.isFinite(power)||power<1||power>10||power<=defensePower+1)return 1;
  const extra=Math.sqrt(continuousPowerBudget(power)/continuousPowerBudget(defensePower+1))-1;
  return 1+extra*Math.max(0,Math.min(1,penetration-resistance));
}
type DefensiveTarget = Pick<Combatant,'level'|'armor'|'body'|'shield'|'status'|'damageModel'> & Partial<Pick<Combatant,'conditions'|'barrier'|'armsModel'|'rulesVersion'|'traitLevelModel'|'traits'|'traitLevels'|'traitSources'|'gear'|'accessories'|'weapon'|'sidearm'|'itemModel'>>;
/** 单位等级、无甲装备规格、实际防护与守护取高；屏障仅在吸收时参与，不改写通道抗穿。 */
export function defensePower(unit:DefensiveTarget,channel:DamageChannel,includeBarrier=false):number {
  const wards=(unit.conditions??[]).filter(c=>c.id==='blessed'&&c.dur>0&&validDefensePower(c.defensePower)).map(c=>c.defensePower!);
  const unarmoredPower=unit.armor?.tier===0?(unit.armor.recipe?.power??unit.armor.level??0):0;
  const guardian = phase2Traits(unit) && unit.traits ? effectiveTraitLevel(unit as Combatant, 'guardian') : 0;
  return Math.max(unit.level,unarmoredPower,protectionPower(unit,channel),guardian,...wards,includeBarrier?barrierDefensePower(unit):0);
}
export function overmatchMultiplier(power:number|undefined,unit:DefensiveTarget,channel:DamageChannel,penetration:number,area=false,canBlock=true,includeBarrier=false,curve?:RulePack['overmatchCurve']):number {
  const armor=gradeOvermatch(power,defensePower(unit,channel,includeBarrier),penetration,anchoredProtection(unit,channel),curve);
  if(!shieldUsable(unit)||unit.status!=='ready'||area||!canBlock||armor===1)return armor;
  const coverage=shieldCoverage(unit);
  const resistance=shieldProtection(unit,channel),through=penetrationThrough(penetration,resistance);
  const shieldPower=Math.max(0,(resistance-1+({kinetic:0,thermal:1,arcane:2}[channel]))/2);
  const shield=gradeOvermatch(power,shieldPower,penetration,resistance,curve);
  // A shield only limits the covered portion; it never lends its L to the whole body.
  return ((1-coverage)*armor+coverage*through*Math.min(armor,shield))/(1-coverage+coverage*through);
}
export function armorEffectLabel(unit:ShieldBearer & Pick<Combatant,'armor'|'shield'|'damageModel'>):string {
  return isWoundModel(unit.damageModel)
    ? (m => m === 1 ? '' : `强度×${m}`)(Number(equipmentMultiplier(unit.armor?.recipe,'power').toFixed(2)))
    : `装甲等效耐久×${Number(armorPowerScale(unit).toFixed(2))}`;
}
/** 没有手动指定时，火炮按公开目标防护和人数选择有效毁伤较高的弹种。 */
export function combatWeapon(weapon:Weapon|undefined,actor:Combatant,target:Combatant,weaponOverflow=false,model=actor.damageModel,overmatch=false,curve?:RulePack['overmatchCurve']):Weapon|undefined {
  if(!weapon)return weapon;
  if(actor.cannonAmmo||!isCannonWeapon(weapon))return anchoredWeapon(weapon,actor.cannonAmmo,model);
  const he=anchoredWeapon(weapon,'he',model)!,ap=anchoredWeapon(weapon,'ap',model)!;
  const protectedTarget={...target,damageModel:model};
  const score=(w:Weapon)=>{
    const raw=diceAvg(w.baseDice)*(w.damageScale??1)*armorTransmission(protectedTarget,w.channel??'kinetic',w.penetration??0)/armorPowerScale(protectedTarget)
      *(overmatch?overmatchMultiplier(w.recipe?.power??w.level,protectedTarget,w.channel??'kinetic',w.penetration??0,!!w.splashTargets,true,false,curve):1);
    if(weaponOverflow&&hasMemberHealth(target)){
      const copy={...target,formation:{...target.formation!,health:target.formation!.health!.map(g=>({...g}))}};
      const direct=damageMemberGroups(copy,Math.round(raw),1,true).health;
      const splashTargets=Math.min(target.hp,w.splashTargets??0);
      const splash=splashTargets?damageMemberGroups(copy,Math.round(raw*splashTargets*(w.splashFactor??0)),splashTargets).health:0;
      return direct+splash;
    }
    const hp=target.scale==='hero'?target.hp:target.formation?.memberHp??target.hp;
    return Math.min(hp,raw)+(target.scale==='hero'?0:Math.min(Math.max(0,target.hp-1),w.splashTargets??0)*Math.min(hp,raw*(w.splashFactor??0)));
  };
  return score(ap)>score(he)?ap:he;
}
export function anchoredWeaponLabel(weapon:Weapon|undefined,model:Combatant['damageModel']=weapon?.powerModel==='wounds-v2'?'wounds-v2':weapon?.powerModel==='wounds-v1'?'wounds-v1':undefined):string {
  const w=anchoredWeapon(weapon,undefined,model);if(!w)return '—';
  const raw=(diceAvg(w.baseDice)+(w.apDice?diceAvg(w.apDice):0))*(w.damageScale??1);
  const melee=meleeProfile(w);
  return `${isRangedWeapon(w) ? (w.indirect ? '曲射' : '直射') + (isCannonWeapon(w) ? '火炮' : '') + ' · ' : ''}${model==='wounds-v2'?'单段均值':'单次均值'}${Number(raw.toFixed(1))} · 穿透${displayNumber(w.penetration??0)}${(w.attacks??1)>1?` · ${w.attacks}段`:''}${w.splashTargets?` · 爆炸${w.splashTargets>=1e9?'覆盖目标编队':'另及'+w.splashTargets+'名额'}`:''}${melee?` · ${melee.description}`:''}`;
}
