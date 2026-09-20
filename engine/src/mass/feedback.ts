import { validFeedback, type RoundFeedback } from '../battle-feedback.js';
import type { Combatant } from '../types.js';
import type { Order } from './battle.js';
export const MASS_PHASES = ['计划锁定', '支援', '机动', '交战', '重整'] as const;
export type MassPhase = typeof MASS_PHASES[number];
export type FrontControl = Record<string, 'ally' | 'enemy' | 'contested' | 'empty'>;
export interface OrderReceipt { order: Order; phase: MassPhase; status: 'locked' | 'executed' | 'blocked'; reason?: string }
export interface MassRoundReport {
  round: number; total: RoundFeedback;
  phases: (RoundFeedback & { phase: MassPhase })[];
  orders: OrderReceipt[]; frontBefore: FrontControl; frontAfter: FrontControl;
}
/** 历史摘要只是派生投影；损坏时丢弃摘要，不能修写真实战场。 */
export function restoreMassReport(raw: unknown, nextRound: number, units: Combatant[]): MassRoundReport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as MassRoundReport;
  const summary = (s: RoundFeedback) => s?.round === r.round && validFeedback({ version: 2, seen: [], current: s }, r.round);
  const front = (f: FrontControl) => !!f && typeof f === 'object' && !Array.isArray(f) && Object.entries(f).every(([k, v]) => ['左翼', '中军', '右翼'].includes(k) && ['ally', 'enemy', 'contested', 'empty'].includes(v));
  if (!Number.isInteger(r.round) || r.round < 1 || r.round >= nextRound || !summary(r.total)
    || !Array.isArray(r.phases) || r.phases.length > 5 || r.phases.some((p) => !MASS_PHASES.includes(p.phase) || !summary(p))
    || !front(r.frontBefore) || !front(r.frontAfter) || !Array.isArray(r.orders) || r.orders.length > units.length
    || r.orders.some((o) => !o || !o.order || !units.some((u) => u.id === o.order.unitId && u.side === 'ally')
      || !['takeoff', 'land', 'ability', 'attack', 'charge', 'volley', 'hold', 'brace', 'retreat', 'shift-left', 'shift-right', 'rank-forward', 'rank-back'].includes(o.order.type)
      || !MASS_PHASES.includes(o.phase) || !['locked', 'executed', 'blocked'].includes(o.status)
      || ['targetId', 'abilityId', 'abilityActorId'].some((key) => { const value = o.order[key as keyof Order]; return value !== undefined && typeof value !== 'string'; })
      || o.reason !== undefined && (typeof o.reason !== 'string' || o.reason.length > 2000))) return undefined;
  return structuredClone(r);
}
