/** 阵营共享敌情记忆：本阵营任何单位实际看见过的敌军最后位置（看见者阵亡、溃退后仍保留），
 * 以及己方遭到看不见的攻击时留下的来袭线索。只在事件发生时按本阵营观测写入，不读取隐藏事实。 */
import type { Combatant, Side } from './types.js';

/** 最后目击作为追索线索的回合数；更早的位置只说明“曾在附近”，交给扫视。 */
export const TRACE_ROUNDS = 6;
/** 最后目击点查过无人后，继续在其周边搜索的回合数；更久之后它可能已在任何地方。 */
export const SPREAD_ROUNDS = 3;
/** 未定位来袭线索保留的回合数与条数。 */
export const CLUE_ROUNDS = 3;
const CLUE_LIMIT = 8;
/** 小战未定位来袭的搜索半径：常见直射武器（弓、步枪）的格子射程上限。 */
export const CLUE_RANGE = 9;

export interface EnemyTrace {
  id: string;
  /** 最后一次看见的回合。 */
  round: number;
  /** 小战格；会战用阵位 node。 */
  cell?: number;
  node?: string;
  /** 看见时在空中或城防平台上。 */
  layer?: 'air' | 'top';
  routing?: true;
  /** 看见时的移动力，用来估计离开视野后的活动范围。 */
  mp?: number;
  /** 本阵营之后亲眼查看过这一格且没有见到它；再次目击时清除。 */
  checked?: true;
}
/** 己方单位在 cell/node 遭到未定位攻击。 */
export interface AttackClue { round: number; victimId: string; cell?: number; node?: string }
export interface SideIntel {
  traces: EnemyTrace[];
  clues: AttackClue[];
  /** 小战：每格最近一次处在本阵营视野内的回合，供扫视跳过刚看过的地方。 */
  viewed?: number[];
}
export type IntelBook = Partial<Record<Side, SideIntel>>;
export type SideViews = ReadonlyMap<Side, ReadonlySet<string>>;

const SIDES: readonly Side[] = ['ally', 'enemy', 'neutral'];
function book(intel: IntelBook, side: Side): SideIntel { return intel[side] ??= { traces: [], clues: [] }; }

/** 事件发生时按各阵营的实际观测更新最后目击；看见倒地、阵亡或撤离即划掉。 */
export function noteSightings(intel: IntelBook, units: readonly Combatant[], views: SideViews, round: number,
  place: (unit: Combatant) => Pick<EnemyTrace, 'cell' | 'node' | 'layer'>, mp?: (unit: Combatant) => number): void {
  for (const side of SIDES) {
    const seen = views.get(side);
    if (!seen || !units.some(u => u.side === side)) continue;
    for (const unit of units) {
      if (unit.side === side || !seen.has(unit.id)) continue;
      const traces = intel[side]?.traces, index = traces?.findIndex(t => t.id === unit.id) ?? -1;
      if (unit.status !== 'ready' && unit.status !== 'routing') { if (index >= 0) traces!.splice(index, 1); continue; }
      const where = place(unit); if (where.cell === undefined && where.node === undefined) continue;
      const trace: EnemyTrace = { id: unit.id, round, ...where, ...(unit.status === 'routing' ? { routing: true as const } : {}), ...(mp ? { mp: mp(unit) } : {}) };
      if (index >= 0) traces![index] = trace; else book(intel, side).traces.push(trace);
    }
  }
}
export function noteClue(intel: IntelBook, side: Side, clue: AttackClue): void {
  const entry = book(intel, side);
  entry.clues = [...entry.clues.filter(c => c.round > clue.round - CLUE_ROUNDS && !(c.round === clue.round && c.victimId === clue.victimId)), clue].slice(-CLUE_LIMIT);
}
/** 当前仍有效、且敌人此刻不在视野里的最后目击。 */
export function liveTraces(intel: IntelBook, side: Side, round: number, visibleIds: ReadonlySet<string>): EnemyTrace[] {
  return (intel[side]?.traces ?? []).filter(t => !visibleIds.has(t.id) && round - t.round <= TRACE_ROUNDS);
}
export function liveClues(intel: IntelBook, side: Side, round: number): AttackClue[] {
  return (intel[side]?.clues ?? []).filter(c => round - c.round <= CLUE_ROUNDS);
}

/** 面板显示用：此刻看不见的最后目击与近几轮未定位来袭，带上当时看见或受击单位的名字。 */
export interface IntelView { traces: (EnemyTrace & { name: string })[]; clues: (AttackClue & { victim: string })[] }
export function intelView(intel: IntelBook, side: Side, round: number, visibleIds: ReadonlySet<string>, name: (id: string) => string | undefined): IntelView {
  return { traces: liveTraces(intel, side, round, visibleIds).map((t) => ({ ...t, name: name(t.id) ?? '敌军' })),
    clues: liveClues(intel, side, round).map((c) => ({ ...c, victim: name(c.victimId) ?? '己方单位' })) };
}

const isIndex = (value: unknown, limit?: number) => Number.isSafeInteger(value) && (value as number) >= 0 && (limit === undefined || (value as number) < limit);
/** 读档时只保留形状正确的记录；记忆只影响AI选择，损坏时丢弃而不阻止读档。 */
export function restoreIntel(value: unknown, cells?: number, nodes?: ReadonlySet<string>): IntelBook {
  const result: IntelBook = {};
  if (!value || typeof value !== 'object') return result;
  const place = (v: Record<string, unknown>) => v.cell !== undefined ? isIndex(v.cell, cells) : typeof v.node === 'string' && (!nodes || nodes.has(v.node));
  for (const side of SIDES) {
    const raw = (value as Record<string, unknown>)[side] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') continue;
    const traces = (Array.isArray(raw.traces) ? raw.traces : []).filter((t: Record<string, unknown>) => t && typeof t.id === 'string' && isIndex(t.round) && place(t)
      && (t.layer === undefined || t.layer === 'air' || t.layer === 'top') && (t.routing === undefined || t.routing === true) && (t.checked === undefined || t.checked === true) && (t.mp === undefined || Number.isFinite(t.mp)));
    const clues = (Array.isArray(raw.clues) ? raw.clues : []).filter((c: Record<string, unknown>) => c && typeof c.victimId === 'string' && isIndex(c.round) && place(c)).slice(-CLUE_LIMIT);
    const viewed = Array.isArray(raw.viewed) && raw.viewed.length === cells && raw.viewed.every(r => isIndex(r)) ? [...raw.viewed as number[]] : undefined;
    result[side] = { traces: structuredClone(traces), clues: structuredClone(clues), ...(viewed ? { viewed } : {}) };
  }
  return result;
}
