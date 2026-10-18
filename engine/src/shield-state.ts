import type {Combatant} from './types.js';
import type {MemberDamagePlan} from './recovery.js';
import {diceAvg,rebuildDice,type ShieldClass} from './data/weapons.js';
import {curveAt} from './data/curves.js';
import {UNIFIED_WOUNDS,powerIndex} from './balance.js';
import {isArmsV2} from './arms-model.js';

export type ShieldBearer = Pick<Combatant,'shield'> & Partial<Pick<Combatant,'weapon'|'sidearm'|'armsModel'|'shieldDurability'|'scale'|'hp'>>;
export function shieldClass(unit: Pick<Combatant,'shield'>): ShieldClass { return (unit.shield?.recipe?.mechanism ?? 'shield') as ShieldClass; }
/** 同L标准武器的投影单段原始伤害均值（无训练、无浮动）。 */
function standardMean(power: number, dmgMult: number, attacks: number): number {
  const c = curveAt(power), old = diceAvg(c.dmgBase) + (c.dmgAp ? diceAvg(c.dmgAp) : 0), segment = old * dmgMult / attacks;
  return diceAvg(rebuildDice(segment, segment < 3.5 ? 2 : 6)) * UNIFIED_WOUNDS[powerIndex(power)]! / old;
}
export function standardSwordMean(power: number): number { return standardMean(power, 1, 1); }
/** R20 中盾耐久 = n × 同级标准剑单段均值，小盾、大盾按 1 : 2 : 3；W22 旋钮 n。 */
export const SHIELD_DURABILITY_FACTOR = 4;
export function shieldDurabilityMax(unit: ShieldBearer): number {
  if (!unit.shield || shieldClass(unit) === 'energy-shield') return 0;
  const n = { buckler: .5, shield: 1, 'tower-shield': 1.5, 'energy-shield': 0 }[shieldClass(unit)];
  return SHIELD_DURABILITY_FACTOR * n * standardSwordMean(unit.shield.recipe?.power ?? 3) * (unit.scale && unit.scale !== 'hero' ? unit.hp! : 1);
}
export function clampShieldDurability(unit: ShieldBearer): void {
  if (unit.shieldDurability) unit.shieldDurability.remaining = Math.min(unit.shieldDurability.remaining, shieldDurabilityMax(unit));
}

/** R15 每份容量 = 0.25 × 同L标准步枪两段合计（单段按详情显示的一位小数，L5 为 19.0）；W19 旋钮。 */
export const ENERGY_SHIELD_SHARE = .25;
/** R15 重击吸收系数 k；W20 旋钮。 */
export const ENERGY_HEAVY_ABSORB = .25;
export type EnergyBearer = Pick<Combatant,'shield'|'scale'|'hp'> & Partial<Pick<Combatant,'armsModel'|'energyShield'>>;
export function energyShieldActive(unit: EnergyBearer): boolean { return isArmsV2(unit.armsModel) && !!unit.shield && shieldClass(unit) === 'energy-shield'; }
export function energyShieldShare(power: number): number { return Math.round(ENERGY_SHIELD_SHARE * 2 * Number(standardMean(power, 1.2, 2).toFixed(1))); }
/** R15 过载阈值 T = 0.8 × 同L标准剑单段均值。 */
export function energyOverloadThreshold(power: number): number { return .8 * standardSwordMean(power); }
const energyPower = (unit: EnergyBearer) => unit.shield!.recipe?.power ?? 3;
const energyShares = (unit: EnergyBearer) => unit.scale === 'hero' ? 1 : unit.hp;
export function energyShieldCapacity(unit: EnergyBearer): number { return energyShieldShare(energyPower(unit)) * energyShares(unit); }
/** 成员减少时总量上限随之降低，超出部分去掉。 */
export function clampEnergyShield(unit: EnergyBearer): void {
  if (!unit.energyShield) return;
  unit.energyShield.overloaded = Math.min(unit.energyShield.overloaded, energyShares(unit));
  unit.energyShield.remaining = Math.min(unit.energyShield.remaining, energyShieldCapacity(unit));
}
/** 小战每次正常激活开始、会战每轮开始：回充到 C ×（现员 − 过载份数），过载的份额跳过这一次。 */
export function rechargeEnergyShield(unit: EnergyBearer): void {
  if (!unit.energyShield) return;
  unit.energyShield.remaining = energyShieldShare(energyPower(unit)) * Math.max(0, energyShares(unit) - unit.energyShield.overloaded);
  unit.energyShield.overloaded = 0;
}
/** 重击按武器基础单段命中均值判定，不看这一次掷骰。 */
export function energyHeavyHit(unit: EnergyBearer, segmentMean: number): boolean {
  return energyShieldActive(unit) && segmentMean >= energyOverloadThreshold(energyPower(unit));
}
/** R15 吸收：护甲减伤之后、技能屏障之前；普通伤害从总量扣，重击只能动用被它打中的那几份，挡完这几份过载。 */
export function absorbEnergyShield(unit: EnergyBearer, plan: MemberDamagePlan): { plan: MemberDamagePlan; absorbed: number; overloaded: number } {
  const state = unit.energyShield;
  if (!state || unit.hp <= 0) return { plan, absorbed: 0, overloaded: 0 };
  const direct = plan.incomingDirect ?? plan.direct, splash = plan.incomingSplash ?? plan.splash ?? 0;
  const hit = plan.heavy ? Math.min(energyShares(unit) - state.overloaded, unit.scale === 'hero' ? 1 : plan.targets + (plan.splashTargets ?? 0)) : 0;
  const limit = plan.heavy ? Math.min(state.remaining, hit * ENERGY_HEAVY_ABSORB * energyShieldShare(energyPower(unit))) : state.remaining;
  const absorbed = Math.max(0, Math.min(limit, direct + splash)), onDirect = Math.min(absorbed, direct), onSplash = absorbed - onDirect;
  state.remaining -= absorbed; state.overloaded += hit;
  if (!absorbed) return { plan, absorbed, overloaded: hit };
  return { absorbed, overloaded: hit, plan: { ...plan, direct: Math.min(plan.direct, direct - onDirect),
    ...(plan.incomingDirect !== undefined ? { incomingDirect: direct - onDirect } : {}),
    ...(plan.splash !== undefined ? { splash: Math.min(plan.splash, splash - onSplash) } : {}),
    ...(plan.incomingSplash !== undefined ? { incomingSplash: splash - onSplash } : {}) } };
}
