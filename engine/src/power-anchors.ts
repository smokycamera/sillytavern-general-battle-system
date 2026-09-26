import { isCannonWeapon, isRangedWeapon } from './loadout.js';
import { bonusMultiplier, bonusSteps } from './enhancements.js';
import type {Armor,Combatant,DamageChannel,Weapon} from './types.js';
import {curveAt} from './data/curves.js';
import {diceAvg} from './data/weapons.js';
import {BODY} from './body.js';
import {meleeProfile} from './melee.js';
import {hasMemberHealth,damageMemberGroups} from './member-health.js';

/** 装备P与训练T分离；高阶增加战术毁伤与覆盖规模，不追加随机骰数量。 */
export const POWER_ANCHORS=[
 {level:1,name:'原始级',budget:4.5,example:'手铳、早期火门枪、劣质冷兵器、投石机、最轻型机炮、原始炼金武器、最低级一环魔法'},
 {level:2,name:'早期军用级',budget:10,example:'火绳枪、制式冷兵器、重弩、射石炮、20mm级机炮、初级二环魔法'},
 {level:3,name:'成熟前工业级',budget:24,example:'燧发枪、优质冷兵器、25mm级机炮、黑火药火炮、三环魔法'},
 {level:4,name:'工业军用级',budget:60,example:'后装线膛步枪、初级魔导武器、30mm级机炮、近现代火炮、四环魔法'},
 {level:5,name:'现代军用级',budget:150,example:'现代步枪、动力冷兵器、40mm级机炮、现代火炮、成熟魔导武器、五环魔法'},
 {level:6,name:'重型／近未来级',budget:420,example:'反器材步枪、重型魔导武器、高分子冷兵器、50–60mm机炮、重型火炮、轻型电磁炮、六环魔法'},
 {level:7,name:'未来级',budget:1400,example:'单兵电磁武器、史诗魔导武器、大计算方式高速机炮、重型电磁机炮、超重型火炮、七环魔法'},
 {level:8,name:'传奇级',budget:6000,example:'重型电磁、单兵等离子、传奇魔剑、力场武器、高能激光机炮、轨道炮、太空战舰主炮、八环魔法'},
 {level:9,name:'战役兵器／半神器级',budget:40000,example:'反物质、相位武器、半神器、行星炮、九环魔法'},
 {level:10,name:'神器级',budget:400000,example:'神器、概念、因果、空间切断、法则、位面级武器'},
] as const;
export const powerBudget=(power:number)=>POWER_ANCHORS[Math.max(0,Math.min(9,Math.round(power)-1))]!.budget;
export function penetrationThrough(power:number,resistance:number):number {
  const gap=power-resistance;return gap>=1?1:gap===0?.55:gap===-1?.3:gap===-2?.12:0;
}
/** 至多8粒骰；高规格通过倍率增长，暴击仍能放大整个伤害预算。 */
export function scaledPowerDice(mean:number):{dice:string;scale:number} {
  if(mean<=0)return {dice:'1d2-2',scale:1};
  const dice=mean<3.5?'1d2':'8d6',base=mean<3.5?1.5:28;
  return {dice,scale:mean/base};
}
export function anchoredWeapon(weapon:Weapon|undefined,ammo:'he'|'ap'='he'):Weapon|undefined {
  if(!weapon)return undefined;
  if(weapon.powerModel==='anchors-v1')return weapon;
  const mechanism=weapon.recipe?.mechanism??weapon.tags?.find(t=>t.startsWith('mechanism:'))?.slice(10);
  if(!mechanism)return weapon;
  const power=weapon.recipe?.power??weapon.level??5,curve=curveAt(power),old=diceAvg(curve.dmgBase)+(curve.dmgAp?diceAvg(curve.dmgAp):0);
  const melee=meleeProfile(weapon);
  const ratio=powerBudget(power)/old*(isCannonWeapon(weapon)?3:mechanism==='autocannon'?1.5:1)*(melee?.damageScale??1);
  const base=diceAvg(weapon.baseDice)+(weapon.apDice?diceAvg(weapon.apDice):0),scaled=scaledPowerDice(base*ratio*bonusMultiplier(weapon.recipe?.bonuses, 'damage'));
  const artillery=isCannonWeapon(weapon),explosive=artillery&&ammo==='he'&&power>=3;
  const splash=explosive?(power>=10?1e9:power>=9?256:power>=8?12:power>=7?6:power>=5?4:2):mechanism==='demolition'?6:0;
  return {...weapon,powerModel:'anchors-v1',ammunition:ammo,baseDice:scaled.dice,apDice:undefined,damageScale:scaled.scale,
    penetration:2*power+(['cannon','indirect-cannon','autocannon','demolition'].includes(mechanism)?2:mechanism==='heavy-rifle'?2:['firearm','rifle','energy'].includes(mechanism)?1:0)+(melee?.penetration??0)+(artillery&&ammo==='ap'?2:0)+bonusSteps(weapon.recipe?.bonuses,'penetration',5),
    splashTargets:splash,splashFactor:mechanism==='demolition'?0.6:0.4};
}
export function anchoredProtection(unit:Pick<Combatant,'armor'|'body'>,channel:DamageChannel):number {
  const armor=unit.armor;if(!armor)return BODY[unit.body??'human'].protection[channel];
  if(armor.protectionOverride&&armor.protection)return Math.max(BODY[unit.body??'human'].protection[channel],armor.protection[channel]);
  const power=armor.recipe?.power??armor.level??5,tier=armor.tier;
  const base=tier===0?0:Math.max(0,2*power+tier-2+bonusSteps(armor.recipe?.bonuses,'protection',5));
  const protection={kinetic:base,thermal:Math.max(0,base-1),arcane:Math.max(0,base-2)};
  const focus=armor.recipe?.protectionProfile;
  if(focus&&focus!=='balanced'){
    let left=2;for(const key of (['kinetic','thermal','arcane'] as const).filter(k=>k!==focus).sort((a,b)=>protection[b]-protection[a])){const n=Math.min(protection[key],left);protection[key]-=n;protection[focus]+=n;left-=n;}
  }
  return Math.max(BODY[unit.body??'human'].protection[channel],protection[channel]);
}
/** 高阶材料/护场提供等效耐久；24为固定同代交战基准，避免提高攻击曲线后同档全部秒杀。 */
export function armorPowerScale(unit:Pick<Combatant,'armor'|'shield'>):number {
  const armor=unit.armor?.powerScale??(unit.armor&&unit.armor.tier>0?Math.max(1,powerBudget(unit.armor.recipe?.power??unit.armor.level??5)/24)*bonusMultiplier(unit.armor.recipe?.bonuses,'protection'):1);
  const shield=unit.shield?.powerScale??(unit.shield ? Math.max(1,powerBudget(unit.shield.recipe?.power??3)/48) : 1);
  return Math.max(armor,shield)*bonusMultiplier(unit.shield?.recipe?.bonuses,'protection');
}
/** 没有手动指定时，火炮按公开目标防护和人数选择有效毁伤较高的弹种。 */
export function combatWeapon(weapon:Weapon|undefined,actor:Combatant,target:Combatant,weaponOverflow=false):Weapon|undefined {
  if(!weapon||weapon.powerModel==='anchors-v1')return weapon;
  if(actor.cannonAmmo||!isCannonWeapon(weapon))return anchoredWeapon(weapon,actor.cannonAmmo);
  const he=anchoredWeapon(weapon,'he')!,ap=anchoredWeapon(weapon,'ap')!;
  const score=(w:Weapon)=>{
    const raw=diceAvg(w.baseDice)*(w.damageScale??1)*penetrationThrough(w.penetration??0,anchoredProtection(target,w.channel??'kinetic'))/armorPowerScale(target);
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
export function anchoredWeaponLabel(weapon:Weapon|undefined):string {
  const w=anchoredWeapon(weapon);if(!w)return '—';
  const raw=(diceAvg(w.baseDice)+(w.apDice?diceAvg(w.apDice):0))*(w.damageScale??1);
  const melee=meleeProfile(w);
  return `${isRangedWeapon(w) ? (w.indirect ? '曲射' : '直射') + (isCannonWeapon(w) ? '火炮' : '') + ' · ' : ''}单次命中均值${Number(raw.toFixed(1))}生命 · 穿透${w.penetration??0}${(w.attacks??1)>1?` · ${w.attacks}段`:''}${w.splashTargets?` · 爆炸${w.splashTargets>=1e9?'覆盖目标编队':'另及'+w.splashTargets+'名额'}`:''}${melee?` · ${melee.description}`:''}`;
}
