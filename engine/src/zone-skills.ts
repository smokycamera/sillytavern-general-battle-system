import type { Ability, EffectOp } from './types.js';
import { bonusMultiplier, bonusRating, bonusSteps, bonusPoints } from './enhancements.js';

type ZoneEffect = Extract<EffectOp, { op: 'zone' }>;
type ZoneStrength = Pick<ZoneEffect, 'power' | 'amount' | 'penetration'>;
export const zoneAmount = (zone: ZoneStrength): number => zone.amount ?? 4 + zone.power * 3;
export const zonePenetration = (zone: ZoneStrength): number => zone.penetration ?? 2 * zone.power;
export function validateZoneStrength(zone: { amount?: unknown; penetration?: unknown }): void {
  if (zone.amount !== undefined && (!Number.isSafeInteger(zone.amount) || Number(zone.amount) < 1 || Number(zone.amount) > 1e6)
    || zone.penetration !== undefined && (typeof zone.penetration !== 'number' || !Number.isFinite(zone.penetration) || zone.penetration < 0)) throw Error('持续区域的强度参数损坏');
}

/** 区域不经过普通伤害技能公式；从原配方升级一次，保留身份、冷却与已布置区域。 */
export function upgradeZoneSkill(ability: Ability): boolean {
  const effect = ability.effects.length === 1 ? ability.effects[0] : undefined;
  if (effect?.op !== 'zone') return false;
  if (!ability.recipe || ability.recipe.modifiers.length !== 1 || ability.recipe.modifiers[0] !== 'zone-' + effect.kind
    || ability.itemSourceId || ability.fixedPower || ability.effectVersion === 'skill-zone-v1') return true;
  // 旧编译器把所有区域都标成 customized；只接管仍与旧模板一致的实例。
  if (ability.customized && !(ability.effectVersion === 'skill-v2.4' && effect.power === ability.recipe.power
    && effect.dur === 3 && effect.radius === (effect.kind === 'trap' ? 0 : 1) && effect.amount === undefined && effect.penetration === undefined
    && ability.range?.metric === 'grid' && ability.range.min === 0 && ability.range.max === 2 + Math.floor(effect.power / 3))) return true;
  const bonuses = ability.bonuses;
  const channel = effect.kind === 'fire' ? 'thermal' : effect.kind === 'trap' ? 'kinetic' : undefined;
  if (effect.kind !== 'smoke') {
    const amount = Math.max(1, Math.round(zoneAmount(effect) * bonusMultiplier(bonuses, effect.kind === 'healing' ? 'healing' : 'damage', channel)));
    if (amount !== zoneAmount(effect)) effect.amount = amount;
  }
  if (channel) {
    const penetration = Math.max(0, zonePenetration(effect) + bonusRating(bonuses, 'penetration', channel));
    if (penetration !== zonePenetration(effect)) effect.penetration = penetration;
    ability.channel = channel;
  }
  // 烟幕遮蔽是开关效果，强度改为延长存在时间；与持续词条合并且有界。
  const duration = effect.kind === 'smoke'
    ? bonusSteps({ duration: Math.max(-10, Math.min(20, bonusPoints(bonuses, 'power') + bonusPoints(bonuses, 'duration'))) }, 'duration', 5)
    : bonusSteps(bonuses, 'duration', 5);
  effect.dur = Math.max(1, Math.min(99, effect.dur + duration));
  if (ability.range) ability.range.max = Math.max(1, ability.range.min, ability.range.max + bonusSteps(bonuses, 'range', 5));
  delete ability.customized;
  ability.effectVersion = 'skill-zone-v1';
  return true;
}

/** 单位详情与战斗预览共用，数值就是区域保存与结算所用的数值。 */
export function zoneEffectDescription(effect: ZoneEffect): string {
  const area = `半径${effect.radius}格，持续${effect.dur}轮`;
  if (effect.kind === 'smoke') return `烟幕：${area}，遮挡穿过区域的非贴身地面视线；强度和持续修正影响持续时间`;
  const amount = zoneAmount(effect);
  if (effect.kind === 'healing') return `治疗区域：${area}，每个友方单位每轮最多恢复${amount}点生命，受可恢复量限制`;
  const protection = effect.kind === 'poison' ? '受毒素抗性限制，封闭车体免疫' : `${effect.kind === 'fire' ? '热能' : '动能'}穿透${Number(zonePenetration(effect).toFixed(2))}，受对应防护限制`;
  return `${effect.kind === 'fire' ? '火墙' : effect.kind === 'poison' ? '毒雾' : '陷阱'}：${area}，每名受影响成员基础伤害${amount}；${protection}；`
    + (effect.kind === 'trap' ? '只由敌方触发，触发一次后消失' : '每个单位每轮最多触发一次，也会伤害友军');
}
