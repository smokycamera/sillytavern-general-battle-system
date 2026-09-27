import type { Ability, Combatant, EffectOp } from './types.js';

export function validDefensePower(power: unknown): power is number { return Number.isSafeInteger(power) && Number(power) >= 1 && Number(power) <= 10; }
/** 只使用技能自身的L；不根据人物训练、名称或攻击技能推断。 */
export function attachDefensePower(ability: Ability): void {
  // 装备能力与实物逐项校验；其规格在施放时读取，不能改写校验用的实例。
  if (ability.equipmentSourceId || ability.itemSourceId) return;
  const power = ability.power ?? ability.recipe?.power;
  if (!validDefensePower(power)) return;
  const attach = (effect: EffectOp): void => {
    if (effect.op === 'barrier' || effect.op === 'condition' && effect.conditionId === 'blessed') effect.defensePower = power;
    if (effect.op === 'zone') effect.effects?.forEach(attach);
  };
  ability.effects.forEach(attach);
}
export function barrierDefensePower(unit: Pick<Combatant, 'barrier'>): number {
  return unit.barrier && unit.barrier.remaining > 0 && unit.barrier.duration > 0
    ? Math.max(0, ...(unit.barrier.defenses ?? []).filter(d => d.duration > 0).map(d => d.power)) : 0;
}

/** 屏障在护甲和减伤结算后吸收生命伤害；全队共用一个有限护盾，不增加人数或生命上限。 */
export function barrierAmount(unit: Pick<Combatant, 'barrier'>): number { return unit.barrier?.remaining ?? 0; }
export function grantBarrier(unit: Combatant, amount: number, duration: number, sourceId?: string, defensePower?: number): number {
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(duration) || duration < 1 || duration > 99) throw Error('屏障强度或持续回合不正确');
  if (defensePower !== undefined && !validDefensePower(defensePower)) throw Error('屏障防御规格须为1–10整数');
  if (unit.hp <= 0 || ['dead', 'fled'].includes(unit.status)) return 0;
  const before = barrierAmount(unit);
  // 重复施放取较强保护，不把多件护符或同一技能无限相加。
  const defenses = (unit.barrier?.defenses ?? []).map(d => ({ ...d }));
  if (defensePower !== undefined) {
    const same = defenses.find(d => d.power === defensePower);
    if (same) same.duration = Math.max(same.duration, duration);
    else defenses.push({ power: defensePower, duration });
  }
  unit.barrier = { remaining: Math.max(before, amount), duration: Math.max(unit.barrier?.duration ?? 0, duration), sourceId,
    ...(defenses.length ? { defenses } : {}) };
  return unit.barrier.remaining - before;
}
export function absorbBarrier(unit: Combatant, amount: number, protectedRatio = 1): number {
  const incoming = Math.max(0, Math.round(amount));
  // 容量扣除采用屏障规格；只有尚未吸收的攻击份额恢复为肉身规格。
  const protectedDamage = Math.max(0, Math.round(incoming * protectedRatio));
  const absorbed = Math.min(protectedDamage, barrierAmount(unit));
  if (unit.barrier) { unit.barrier.remaining -= absorbed; if (!unit.barrier.remaining) delete unit.barrier; }
  return absorbed === protectedDamage ? 0 : Math.max(0, Math.round(incoming - absorbed / protectedRatio));
}
export function decayBarrier(unit: Combatant): void {
  if (!unit.barrier) return;
  if (--unit.barrier.duration <= 0) { delete unit.barrier; return; }
  if (unit.barrier.defenses) {
    unit.barrier.defenses = unit.barrier.defenses.filter(d => --d.duration > 0);
    if (!unit.barrier.defenses.length) delete unit.barrier.defenses;
  }
}
export function validateBarrier(value: Combatant['barrier']): void {
  if (value !== undefined && (!value || !Number.isSafeInteger(value.remaining) || value.remaining < 1 || !Number.isSafeInteger(value.duration) || value.duration < 1 || value.duration > 99 || value.sourceId !== undefined && typeof value.sourceId !== 'string')) throw Error('屏障剩余强度或时间不正确');
  if (value?.defenses !== undefined && (!Array.isArray(value.defenses) || value.defenses.length > 10
    || value.defenses.some(d => !d || !validDefensePower(d.power) || !Number.isSafeInteger(d.duration) || d.duration < 1 || d.duration > value.duration)
    || new Set(value.defenses.map(d => d.power)).size !== value.defenses.length)) throw Error('屏障防御规格或时间不正确');
}
