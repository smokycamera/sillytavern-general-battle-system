import { displayNumber } from './display-number.js';
import {shieldClass,shieldDurabilityMax,clampShieldDurability,energyShieldActive,energyShieldCapacity,energyShieldShare,energyShareOf,energyThresholdOf,energyShieldRecharge,energyPower,energyOverloadThreshold,clampEnergyShield,rechargeEnergyShield,type ShieldBearer} from './shield-state.js';
export {shieldClass,shieldDurabilityMax,clampShieldDurability,standardSwordMean,SHIELD_DURABILITY_FACTOR,energyShieldActive,energyShieldCapacity,energyShieldShare,energyShieldPool,energyShieldRecharge,energyShareOf,energyThresholdOf,shieldPlatformScale,energyOverloadThreshold,energyHeavyHit,rechargeEnergyShield,ENERGY_SHIELD_SHARE,ENERGY_HEAVY_ABSORB,ENERGY_RECHARGE_SHARE,type ShieldBearer} from './shield-state.js';
import { equipmentBurden } from './equipment-load.js';
/**
 * V12 武器与护甲校准（arms-v1）。只由新战斗规则开启；旧战斗快照没有该标记，继续使用冻结的V11投影。
 *
 * 1. 人形个体单人操作机炮只能维持三分之二火力；火炮对单个人形目标命中−3（不影响编队、大型、坐骑与载具目标）。
 * 2. 人形编队的机炮按两人一组操作（原三人），直射/曲射火炮仍为四人一门。
 * 3. 编队爆破装置每三名参战人员投送一份，不再人人投送；英雄仍为一份。
 * 4. 轻甲同级防护由“规格×2−1”提高到“规格×2−0.5”，同级普通刀剑、弓、手枪仍可穿透但损失约两成；中甲及以上不变。
 * 5. 长兵器贴身（距离0–1）命中修正由−2放宽为−1。
 * 6. 轻型投射（手枪、投石索、手弩）格子射程由2格提高到4格，与投掷冷兵器相同；会战阵距不变。
 * 7. 远程武器技法的射程等于所用武器的实际射程（小战格子射程、会战阵距），不再受通用技能射程 2+⌊P/3⌋ 限制（见 actions.ts）。
 *
 * V18「百兵谱」（arms-v2）在 V12 校准之上加新类别、盾类型与 R1–R26（docs/arms-v2-spec-20261017.md），只看 isArmsV2。
 */
import { isCannonWeapon, meleeWeapon } from './loadout.js';
import { SHIELD_CLASSES } from './data/weapons.js';
import { equipmentMultiplier } from './numeric-model.js';
import { instanceMultiplier } from './instance-variance.js';
import { prepareBarrierModel } from './barrier.js';
import type { Combatant, RulePack, Weapon } from './types.js';

export { ARMS_MODEL, isArmsModel, isArmsV2, isArmsV3, validateArmsModel, type ArmsModel } from './arms-model.js';
import { isArmsModel, isArmsV2, isArmsV3 } from './arms-model.js';

/** The battle's saved rules are authoritative; re-loading is idempotent and never touches equipment. */
export function prepareArmsModel(unit: Combatant, rules: Pick<RulePack, 'armsModel' | 'barrierModel'>): void {
  if (unit.rulesVersion !== 'v2') return;
  if (rules.armsModel) unit.armsModel = rules.armsModel; else delete unit.armsModel;
  prepareBarrierModel(unit, rules);
  if (isArmsV2(unit.armsModel) && unit.shield && shieldClass(unit) !== 'energy-shield') { unit.shieldDurability ??= { remaining: shieldDurabilityMax(unit) }; clampShieldDurability(unit); }
  if (energyShieldActive(unit)) { unit.energyShield ??= { remaining: energyShieldCapacity(unit), overloaded: 0 }; clampEnergyShield(unit); }
}

/** Protection offset of an armor type relative to 2×L. Only light armor changes in V12. */
export function armorTierOffset(tier: number, model?: Combatant['armsModel']): number {
  return tier === 1 && isArmsModel(model) ? -0.5 : tier - 2;
}

/** People needed to serve one heavy weapon in a human formation. */
export function weaponCrew(weapon: Weapon | undefined, model?: RulePack['armsModel']): number {
  const mechanism = weapon?.recipe?.mechanism ?? weapon?.tags?.find(t => t.startsWith('mechanism:'))?.slice(10);
  return mechanism === 'rocket' ? (isArmsV2(model) ? 2 : 4) : isCannonWeapon(weapon) ? 4 : mechanism === 'autocannon' ? (isArmsModel(model) ? 2 : 3) : 1;
}

/** One demolition charge per three participating members of a formation; at least one charge. */
export const DEMOLITION_TEAM = 3;
export function demolitionPackets(participants: number): number {
  return participants <= 0 ? 0 : Math.max(Math.min(participants, 1), participants / DEMOLITION_TEAM);
}

/** A lone, ordinary-sized person: artillery is poor at hitting such a target. */
export function humanSizedIndividual(unit: Pick<Combatant, 'scale' | 'body' | 'mount'>): boolean {
  return unit.scale === 'hero' && (unit.body ?? 'human') === 'human' && !unit.mount;
}
/** A single human operating a crew-served automatic cannon cannot feed and lay it at full rate. */
export function loneHeavyOperator(unit: Pick<Combatant, 'scale' | 'body'>, weapon?: Weapon): boolean {
  const mechanism = weapon?.recipe?.mechanism ?? weapon?.tags?.find(t => t.startsWith('mechanism:'))?.slice(10);
  return unit.scale === 'hero' && (unit.body ?? 'human') === 'human' && mechanism === 'autocannon';
}
export const LONE_AUTOCANNON_SHARE = 2 / 3;
export const ARTILLERY_SMALL_TARGET = -3;

/** R16 喷射武器燃料：每战3次，警戒与加速攻击同样消耗，战后补满。 */
export const SPRAYER_FUEL = 3;
export const isSprayer = (weapon?: Weapon): boolean => weapon?.recipe?.mechanism === 'sprayer';
export function sprayerFuel(unit: Pick<Combatant, 'sprayerFuel'>, weapon: Weapon): number { return unit.sprayerFuel?.[weapon.id] ?? SPRAYER_FUEL; }
export function spendSprayerFuel(unit: Combatant, weapon: Weapon | undefined, amount = 1): void {
  if (!isArmsV2(unit.armsModel) || !weapon || !isSprayer(weapon)) return;
  (unit.sprayerFuel ??= {})[weapon.id] = Math.max(0, sprayerFuel(unit, weapon) - amount);
}
export const ENERGY_FIRE_LIMIT = 3;
export function beginArmsActivation(unit: Combatant): void {
  if (!isArmsV2(unit.armsModel)) return;
  rechargeEnergyShield(unit);
  for (const state of Object.values(unit.weaponHeat ?? {})) {
    const cooling = state.streak >= ENERGY_FIRE_LIMIT;
    if (!state.fired || cooling) state.streak = 0;
    delete state.fired;
    state.cooling = cooling;
  }
}
export function noteArmsFire(unit: Combatant, weapon?: Weapon): void {
  if (!isArmsV2(unit.armsModel) || weapon?.recipe?.mechanism !== 'energy') return;
  const state = (unit.weaponHeat ??= {})[weapon.id] ??= { streak: 0 };
  if (!state.fired) { state.streak++; state.fired = true; }
}
export function armsWeaponReason(unit: Combatant, weapon?: Weapon): string | undefined {
  if (isArmsV2(unit.armsModel) && (unit.body ?? 'human') === 'human' && unit.movedDuringActivation && ['autocannon','cannon','indirect-cannon'].includes(weapon?.recipe?.mechanism ?? '')) return '需架设：本次激活已移动，不能用' + weapon!.name + '开火';
  if (isArmsV2(unit.armsModel) && weapon && unit.weaponHeat?.[weapon.id]?.cooling) return weapon.name + '过热：连续开火三次后需要冷却一次';
  if (isArmsV2(unit.armsModel) && weapon && isSprayer(weapon) && !sprayerFuel(unit, weapon)) return weapon.name + '燃料耗尽：每战只能喷射' + SPRAYER_FUEL + '次';
  return undefined;
}
export function validateArmsState(unit: Combatant): void {
  if (unit.denialTriggered !== undefined && (!unit.denialTriggered || !Number.isSafeInteger(unit.denialTriggered.round) || unit.denialTriggered.round < 0 || !Array.isArray(unit.denialTriggered.targets) || unit.denialTriggered.targets.some(id => typeof id !== 'string'))) throw Error('拒止反应记录损坏');
  if (unit.shieldDurability !== undefined && (!unit.shieldDurability || !Number.isFinite(unit.shieldDurability.remaining) || unit.shieldDurability.remaining < 0)) throw Error('盾耐久记录损坏');
  if (unit.sprayerFuel !== undefined && (!unit.sprayerFuel || typeof unit.sprayerFuel !== 'object' || Array.isArray(unit.sprayerFuel) || Object.values(unit.sprayerFuel).some(n => !Number.isInteger(n) || n < 0 || n > SPRAYER_FUEL))
    || unit.tankRupturedRound !== undefined && (!Number.isSafeInteger(unit.tankRupturedRound) || unit.tankRupturedRound < 0)) throw Error('喷射燃料记录损坏');
  // 重击只吸收每份的四分之一，剩余量可以是小数（每份14时吸收3.5）。
  if (unit.energyShield !== undefined && (!unit.energyShield || !Number.isFinite(unit.energyShield.remaining) || unit.energyShield.remaining < 0 || !Number.isSafeInteger(unit.energyShield.overloaded) || unit.energyShield.overloaded < 0)) throw Error('能量盾记录损坏');
  if (unit.weaponHeat !== undefined && (!unit.weaponHeat || typeof unit.weaponHeat !== 'object' || Array.isArray(unit.weaponHeat) || Object.values(unit.weaponHeat).some(s => !s || !Number.isInteger(s.streak) || s.streak < 0 || s.streak > ENERGY_FIRE_LIMIT || s.fired !== undefined && typeof s.fired !== 'boolean' || s.cooling !== undefined && typeof s.cooling !== 'boolean'))) throw Error('武器过热记录损坏');
}

/** 状态栏：负重档、过热、燃料，以及盾（shield=false 时留给单位详情的盾一行）。 */
export function armsStatusLabels(unit: Combatant, shield = true): string[] {
  if (!isArmsV2(unit.armsModel)) return [];
  const labels: string[] = [];
  const burden=equipmentBurden(unit);if(burden)labels.push(burden===2?'超载':'重载');
  if (Object.values(unit.weaponHeat ?? {}).some(s => s.cooling)) labels.push('过热');
  for (const weapon of [unit.weapon, unit.sidearm]) if (weapon && isSprayer(weapon)) labels.push('燃料 ' + sprayerFuel(unit, weapon) + '/' + SPRAYER_FUEL);
  return shield ? [...labels, ...shieldStatusLabels(unit)] : labels;
}
/** 单位详情的盾一行：类型与规格，再接挂背、覆盖、耐久或能量盾说明。 */
export function shieldDetail(unit: Combatant): string {
  const v2 = isArmsV2(unit.armsModel), kind = v2 ? shieldClass(unit) : 'shield', power = unit.shield!.recipe?.power ?? 3, head = SHIELD_CLASSES[kind].name + 'L' + power;
  if (v2 && kind === 'energy-shield' && isArmsV3(unit.armsModel)) return [head, '每人一份' + displayNumber(energyShareOf(unit)) + '点，每次激活回充' + displayNumber(energyShieldRecharge(energyPower(unit))) + '点，单段均值不低于' + Number(energyThresholdOf(unit).toFixed(1)) + '的重击只能由被击中的份额抵挡', ...shieldStatusLabels(unit)].join(' · ');
  if (v2 && kind === 'energy-shield') return [head, '每人一份' + displayNumber(energyShieldShare(power)) + '点，单段均值不低于' + Number(energyOverloadThreshold(power).toFixed(1)) + '的重击只能由被击中的份额抵挡', ...shieldStatusLabels(unit)].join(' · ');
  if (v2 && unit.shieldDurability?.remaining === 0) return head + ' · 盾已碎';
  if (v2 && !shieldUsable(unit)) return head + ' · 挂背（主武器双手）';
  return [head, '覆盖' + Math.round(shieldCoverage(unit) * 100) + '%', ...shieldStatusLabels(unit)].join(' · ');
}
/** R1/R15/R20 盾的状态：挂背、耐久、碎盾、能量盾剩余与过载。 */
export function shieldStatusLabels(unit: Combatant): string[] {
  if (!isArmsV2(unit.armsModel) || !unit.shield) return [];
  const labels: string[] = [];
  if (unit.shieldDurability) labels.push(unit.shieldDurability.remaining === 0 ? '盾已碎' : '盾 ' + Number(Math.min(unit.shieldDurability.remaining,shieldDurabilityMax(unit)).toFixed(1)) + '/' + Number(shieldDurabilityMax(unit).toFixed(1)));
  if (!shieldUsable(unit) && unit.shieldDurability?.remaining !== 0) labels.push('盾牌挂背');
  if (unit.energyShield) {
    const { remaining, overloaded } = unit.energyShield;
    labels.push('能量盾 ' + (isArmsV3(unit.armsModel) ? Number(remaining.toFixed(1)) : displayNumber(remaining)) + '/' + displayNumber(energyShieldCapacity(unit)) + (overloaded && unit.scale !== 'hero' ? '（' + overloaded + ' 人过载）' : ''));
    if (overloaded && unit.scale === 'hero') labels.push('能量盾过载');
  }
  return labels;
}
/** 战斗界面的防护层：盾耐久或能量盾剩余（含过载），再加技能屏障剩余。 */
export function defenseLayerLabels(unit: Combatant): string[] {
  return [...shieldStatusLabels(unit), ...(unit.barrier ? ['屏障 ' + displayNumber(unit.barrier.remaining)] : [])];
}

export function shieldUsable(unit: ShieldBearer, incoming?: Weapon): boolean {
  if (!unit.shield) return false;
  if (!isArmsV2(unit.armsModel)) return true;
  const kind = shieldClass(unit);
  if (kind === 'energy-shield') return true;
  if (unit.shieldDurability?.remaining === 0 || incoming?.recipe?.mechanism === 'great-weapon') return false;
  return kind === 'buckler' || (unit.weapon ?? unit.sidearm)?.hands !== 2;
}
export function shieldGuardUsable(unit: ShieldBearer): boolean {
  return shieldUsable(unit) && (!isArmsV2(unit.armsModel) || ['shield','tower-shield'].includes(shieldClass(unit)));
}
export function shieldCoverage(unit: ShieldBearer, incoming?: Weapon): number {
  if (!shieldUsable(unit,incoming)) return 0;
  const kind = isArmsV2(unit.armsModel) ? SHIELD_CLASSES[shieldClass(unit)] : SHIELD_CLASSES.shield;
  const coverage = Math.min(kind.limit,kind.coverage * equipmentMultiplier(unit.shield!.recipe,'power'));
  return coverage * (isArmsV2(unit.armsModel) && unit.scale && unit.scale !== 'hero' && unit.shieldDurability ? Math.min(1,unit.shieldDurability.remaining / shieldDurabilityMax(unit)) : 1);
}
export function applyShieldWear(unit: Combatant, wear: number): boolean {
  if (!isArmsV2(unit.armsModel) || !unit.shieldDurability) return false;
  const before = unit.shieldDurability.remaining;
  unit.shieldDurability.remaining = Math.max(0,Math.min(shieldDurabilityMax(unit),before - wear));
  return before > 0 && unit.shieldDurability.remaining === 0;
}
export function shieldUnavailableReason(unit: ShieldBearer): string | undefined {
  if (!unit.shield) return '需要实际盾牌';
  if (!isArmsV2(unit.armsModel)) return undefined;
  if (shieldClass(unit) === 'energy-shield') return '需要实体盾';
  if (unit.shieldDurability?.remaining === 0) return '盾已碎';
  if (!shieldUsable(unit)) return '盾牌挂背：双手武器只能配小盾或能量盾';
  return undefined;
}

export const DENIAL_CHARGE_DAMAGE = 1.25, GREATSWORD_DENIAL_ACCURACY = -4, MOUNTED_SPRINT_DAMAGE = 1.5, HOOK_ACCURACY = 2;
export function denialReady(holder: Combatant, defs: Map<string, import('./types.js').ConditionDef>): boolean {
  return isArmsV2(holder.armsModel) && ['spear','heavy-polearm'].includes(meleeWeapon(holder)?.recipe?.mechanism ?? '') && holder.status === 'ready' && !holder.suppression && !holder.airborne && !holder.conditions.some(c => c.dur > 0 && (defs.get(c.id)?.skipTurn || defs.get(c.id)?.preventAttack));
}
export function denialModifiers(mover: Combatant, charging: boolean, watching = false): import('./bonus.js').Modifier[] {
  const mods: import('./bonus.js').Modifier[] = [];
  if (watching) mods.push({source:'intrinsic',name:'警戒拒止',kind:'atk',type:'flat',value:2});
  if (charging) mods.push({source:'intrinsic',name:'拒止冲锋',kind:'atk',type:'flat',value:2},{source:'intrinsic',name:'拒止冲锋',kind:'dmg',type:'mult',value:DENIAL_CHARGE_DAMAGE});
  if (mover.weapon?.recipe?.mechanism === 'greatsword') mods.push({source:'intrinsic',name:'巨剑破阵',kind:'atk',type:'flat',value:GREATSWORD_DENIAL_ACCURACY});
  return mods;
}
