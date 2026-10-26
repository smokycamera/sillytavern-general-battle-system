import type {BodyKind,Combatant} from './types.js';
import type {MemberDamagePlan} from './recovery.js';
import {diceAvg,rebuildDice,type ShieldClass} from './data/weapons.js';
import {curveAt} from './data/curves.js';
import {UNIFIED_WOUNDS,powerIndex} from './balance.js';
import {isArmsV2,isArmsV3} from './arms-model.js';

export type ShieldBearer = Pick<Combatant,'shield'> & Partial<Pick<Combatant,'weapon'|'sidearm'|'armsModel'|'shieldDurability'|'scale'|'hp'|'body'>>;
export function shieldClass(unit: Pick<Combatant,'shield'>): ShieldClass { return (unit.shield?.recipe?.mechanism ?? 'shield') as ShieldClass; }
/** 同L标准武器的投影单段原始伤害均值（无训练、无浮动）。 */
function standardMean(power: number, dmgMult: number, attacks: number): number {
  const c = curveAt(power), old = diceAvg(c.dmgBase) + (c.dmgAp ? diceAvg(c.dmgAp) : 0), segment = old * dmgMult / attacks;
  return diceAvg(rebuildDice(segment, segment < 3.5 ? 2 : 6)) * UNIFIED_WOUNDS[powerIndex(power)]! / old;
}
export function standardSwordMean(power: number): number { return standardMean(power, 1, 1); }
/** V21 盾按装备自身的平台尺寸放大，倍率同 V6 身体生命倍率（人形1、大型2、载具6、巨兽6）。 */
const PLATFORM_SCALE: Record<BodyKind, number> = { human: 1, large: 2, vehicle: 6, giant: 6 };
export function shieldPlatformScale(unit: Pick<Combatant,'shield'> & Partial<Pick<Combatant,'body'>>): number {
  return PLATFORM_SCALE[unit.shield?.recipe?.size ?? unit.body ?? 'human'] ?? 1;
}
/** R20 中盾耐久 = n × 同级标准剑单段均值，小盾、大盾按 1 : 2 : 3；W22 旋钮 n。V21 再乘平台倍率。 */
export const SHIELD_DURABILITY_FACTOR = 4;
export function shieldDurabilityMax(unit: ShieldBearer): number {
  if (!unit.shield || shieldClass(unit) === 'energy-shield') return 0;
  const n = { buckler: .5, shield: 1, 'tower-shield': 1.5, 'energy-shield': 0 }[shieldClass(unit)];
  return SHIELD_DURABILITY_FACTOR * n * standardSwordMean(unit.shield.recipe?.power ?? 3) * (unit.scale && unit.scale !== 'hero' ? unit.hp! : 1) * (isArmsV3(unit.armsModel) ? shieldPlatformScale(unit) : 1);
}
export function clampShieldDurability(unit: ShieldBearer): void {
  if (unit.shieldDurability) unit.shieldDurability.remaining = Math.min(unit.shieldDurability.remaining, shieldDurabilityMax(unit));
}

/** R15 每份容量 = 0.25 × 同L标准步枪两段合计（单段按详情显示的一位小数，L5 为 19.0）；W19 旋钮。V18–V20 每次激活回满。 */
export const ENERGY_SHIELD_SHARE = .25;
/** R15 重击吸收系数 k；W20 旋钮。 */
export const ENERGY_HEAVY_ABSORB = .25;
/** V21 每份每次激活回充同级单体创伤预算的三成，不随平台放大：舰载小口径也能慢慢打穿舰盾。 */
export const ENERGY_RECHARGE_SHARE = .3;
export type EnergyBearer = Pick<Combatant,'shield'|'scale'|'hp'> & Partial<Pick<Combatant,'armsModel'|'energyShield'|'body'>>;
export function energyShieldActive(unit: EnergyBearer): boolean { return isArmsV2(unit.armsModel) && !!unit.shield && shieldClass(unit) === 'energy-shield'; }
export function energyShieldShare(power: number): number { return Math.round(ENERGY_SHIELD_SHARE * 2 * Number(standardMean(power, 1.2, 2).toFixed(1))); }
/** V21 每份容量 = 同级单体创伤预算（与同级屏障、治疗相同）× 平台倍率。 */
export function energyShieldPool(power: number, platform = 1): number { return UNIFIED_WOUNDS[powerIndex(power)]! * platform; }
export function energyShieldRecharge(power: number): number { return Math.round(ENERGY_RECHARGE_SHARE * UNIFIED_WOUNDS[powerIndex(power)]!); }
/** R15 过载阈值 T = 0.8 × 同L标准剑单段均值。V21 再乘平台倍率。 */
export function energyOverloadThreshold(power: number): number { return .8 * standardSwordMean(power); }
export const energyPower = (unit: Pick<Combatant,'shield'>) => unit.shield!.recipe?.power ?? 3;
const energyShares = (unit: EnergyBearer) => unit.scale === 'hero' ? 1 : unit.hp;
/** 一份的容量：V21 按同级预算与平台，旧规则按 R15。 */
export function energyShareOf(unit: EnergyBearer): number {
  return isArmsV3(unit.armsModel) ? energyShieldPool(energyPower(unit), shieldPlatformScale(unit)) : energyShieldShare(energyPower(unit));
}
export function energyThresholdOf(unit: EnergyBearer): number {
  return energyOverloadThreshold(energyPower(unit)) * (isArmsV3(unit.armsModel) ? shieldPlatformScale(unit) : 1);
}
export function energyShieldCapacity(unit: EnergyBearer): number { return energyShareOf(unit) * energyShares(unit); }
/** 成员减少时总量上限随之降低，超出部分去掉。 */
export function clampEnergyShield(unit: EnergyBearer): void {
  if (!unit.energyShield) return;
  unit.energyShield.overloaded = Math.min(unit.energyShield.overloaded, energyShares(unit));
  unit.energyShield.remaining = Math.min(unit.energyShield.remaining, energyShieldCapacity(unit));
}
/**
 * 小战每次正常激活开始、会战每轮开始回充，过载的份额跳过这一次。
 * V18–V20：回满到 C ×（现员 − 过载份数）。V21：每份未过载的份额回充同级预算三成，最多到容量。
 */
export function rechargeEnergyShield(unit: EnergyBearer): void {
  if (!unit.energyShield) return;
  const active = Math.max(0, energyShares(unit) - unit.energyShield.overloaded);
  unit.energyShield.remaining = isArmsV3(unit.armsModel)
    ? Math.min(energyShieldCapacity(unit), unit.energyShield.remaining + energyShieldRecharge(energyPower(unit)) * active)
    : energyShieldShare(energyPower(unit)) * active;
  unit.energyShield.overloaded = 0;
}
/** 重击按武器基础单段命中均值判定，不看这一次掷骰；V21 先按盾规格跨代换算（tier）再比阈值。 */
export function energyHeavyHit(unit: EnergyBearer, segmentMean: number, tier = 1): boolean {
  return energyShieldActive(unit) && segmentMean * tier >= energyThresholdOf(unit);
}
/**
 * R15 吸收：护甲减伤之后、技能屏障之前；V39由调用方先处理技能屏障，仅把余伤交到这里。
 * 普通伤害从总量扣，重击只能动用被它打中的那几份，挡完这几份过载。
 * V21：plan.energyRatio 把这次伤害换算成盾规格的消耗（跨代：低级火力少耗、高级火力多耗）；absorbed 是挡下的伤害，spent 是盾的消耗。
 */
export function absorbEnergyShield(unit: EnergyBearer, plan: MemberDamagePlan): { plan: MemberDamagePlan; absorbed: number; spent: number; overloaded: number } {
  const state = unit.energyShield;
  if (!state || unit.hp <= 0) return { plan, absorbed: 0, spent: 0, overloaded: 0 };
  const direct = plan.incomingDirect ?? plan.direct, splash = plan.incomingSplash ?? plan.splash ?? 0, ratio = plan.energyRatio ?? 1;
  const hit = plan.heavy ? Math.min(energyShares(unit) - state.overloaded, unit.scale === 'hero' ? 1 : plan.targets + (plan.splashTargets ?? 0)) : 0;
  const limit = plan.heavy ? Math.min(state.remaining, hit * ENERGY_HEAVY_ABSORB * energyShareOf(unit)) : state.remaining;
  const spent = Math.max(0, Math.min(limit, (direct + splash) * ratio)), absorbed = spent / ratio, onDirect = Math.min(absorbed, direct), onSplash = absorbed - onDirect;
  state.remaining -= spent; state.overloaded += hit;
  if (!absorbed) return { plan, absorbed, spent, overloaded: hit };
  return { absorbed, spent, overloaded: hit, plan: { ...plan, direct: Math.min(plan.direct, direct - onDirect),
    ...(plan.incomingDirect !== undefined ? { incomingDirect: direct - onDirect } : {}),
    ...(plan.splash !== undefined ? { splash: Math.min(plan.splash, splash - onSplash) } : {}),
    ...(plan.incomingSplash !== undefined ? { incomingSplash: splash - onSplash } : {}) } };
}
