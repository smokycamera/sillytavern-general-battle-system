import type { Combatant } from './types.js';

/** 屏障在护甲和减伤结算后吸收生命伤害；全队共用一个有限护盾，不增加人数或生命上限。 */
export function barrierAmount(unit: Pick<Combatant, 'barrier'>): number { return unit.barrier?.remaining ?? 0; }
export function grantBarrier(unit: Combatant, amount: number, duration: number, sourceId?: string): number {
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(duration) || duration < 1 || duration > 99) throw Error('屏障强度或持续回合不正确');
  if (unit.hp <= 0 || ['dead', 'fled'].includes(unit.status)) return 0;
  const before = barrierAmount(unit);
  // 重复施放取较强保护，不把多件护符或同一技能无限相加。
  unit.barrier = { remaining: Math.max(before, amount), duration: Math.max(unit.barrier?.duration ?? 0, duration), sourceId };
  return unit.barrier.remaining - before;
}
export function absorbBarrier(unit: Combatant, amount: number): number {
  const incoming = Math.max(0, Math.round(amount)), absorbed = Math.min(incoming, barrierAmount(unit));
  if (unit.barrier) { unit.barrier.remaining -= absorbed; if (!unit.barrier.remaining) delete unit.barrier; }
  return incoming - absorbed;
}
export function decayBarrier(unit: Combatant): void { if (unit.barrier && --unit.barrier.duration <= 0) delete unit.barrier; }
export function validateBarrier(value: Combatant['barrier']): void {
  if (value !== undefined && (!value || !Number.isSafeInteger(value.remaining) || value.remaining < 1 || !Number.isSafeInteger(value.duration) || value.duration < 1 || value.duration > 99 || value.sourceId !== undefined && typeof value.sourceId !== 'string')) throw Error('屏障剩余强度或时间不正确');
}
