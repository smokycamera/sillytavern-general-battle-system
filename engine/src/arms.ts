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
 */
import { isCannonWeapon } from './loadout.js';
import type { Combatant, RulePack, Weapon } from './types.js';

export const ARMS_MODEL = 'arms-v1' as const;
export type ArmsModel = typeof ARMS_MODEL;
export const isArmsModel = (model: unknown): model is ArmsModel => model === ARMS_MODEL;

export function validateArmsModel(value: unknown): void {
  if (value !== undefined && !isArmsModel(value)) throw new Error('武器护甲规则版本损坏');
}
/** The battle's saved rules are authoritative; re-loading is idempotent and never touches equipment. */
export function prepareArmsModel(unit: Combatant, rules: Pick<RulePack, 'armsModel'>): void {
  if (unit.rulesVersion !== 'v2') return;
  if (rules.armsModel) unit.armsModel = rules.armsModel; else delete unit.armsModel;
}

/** Protection offset of an armor type relative to 2×L. Only light armor changes in V12. */
export function armorTierOffset(tier: number, model?: Combatant['armsModel']): number {
  return tier === 1 && isArmsModel(model) ? -0.5 : tier - 2;
}

/** People needed to serve one heavy weapon in a human formation. */
export function weaponCrew(weapon: Weapon | undefined, model?: RulePack['armsModel']): number {
  const mechanism = weapon?.recipe?.mechanism ?? weapon?.tags?.find(t => t.startsWith('mechanism:'))?.slice(10);
  return isCannonWeapon(weapon) ? 4 : mechanism === 'autocannon' ? (isArmsModel(model) ? 2 : 3) : 1;
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
