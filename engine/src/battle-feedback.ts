import type { Side, Scale } from './types.js';

/** 仅保存观察者看见的轻量投影，不参与战斗结算。 */
export interface FeedbackUnit {
  id: string; name: string; side: Side; scale: Scale; hp: number; status: string;
  morale: number; fatigue: number; cell?: number; effects: string[]; resources: Record<string, { name: string; value: number }>;
}
export interface UnitChange {
  id: string; name: string; side: Side; scale: Scale;
  lost: number; recovered: number; morale: number; fatigue: number;
  fromCell?: number; toCell?: number; gained: string[]; ended: string[]; statuses: string[];
  sight?: 'found' | 'lost'; resources: Record<string, { name: string; delta: number }>;
}
export interface ObjectiveFeedback { ally: number; enemy: number; winner?: string }
export interface RoundFeedback { round: number; changes: UnitChange[]; objective?: { before: ObjectiveFeedback; after: ObjectiveFeedback } }
export interface ActivationFeedback extends RoundFeedback { actorName?: string }
export interface FeedbackState { version: 2; seen: FeedbackUnit[]; current: RoundFeedback; previous?: RoundFeedback;
  objective?: ObjectiveFeedback; activation?: ActivationFeedback; lastActivation?: ActivationFeedback }
const same = (a: FeedbackUnit, b: FeedbackUnit) => a.hp === b.hp && a.status === b.status && a.morale === b.morale
  && a.fatigue === b.fatigue && a.cell === b.cell && a.effects.join('\n') === b.effects.join('\n') && JSON.stringify(a.resources) === JSON.stringify(b.resources);
const unique = (values: string[]) => [...new Set(values)];

export class BattleFeedback {
  private state: FeedbackState;
  constructor(round: number, units: FeedbackUnit[], restored?: unknown) {
    this.state = validFeedback(restored, round) ? structuredClone(restored) : { version: 2, seen: units, current: { round, changes: [] } };
  }
  /** 只在执行器记录事件或完成边界结算时调用；渲染永不调用采样。 */
  capture(round: number, units: FeedbackUnit[], objective?: ObjectiveFeedback): void {
    if (round !== this.state.current.round) {
      this.state.previous = this.state.current;
      this.state.current = { round, changes: [] };
    }
    if (objective && this.state.objective && JSON.stringify(objective) !== JSON.stringify(this.state.objective)) {
      for (const summary of [this.state.current, ...(this.state.activation ? [this.state.activation] : [])])
        summary.objective = { before: summary.objective?.before ?? this.state.objective, after: objective };
    }
    this.state.objective = objective;
    const before = new Map(this.state.seen.map((u) => [u.id, u]));
    const now = new Map(units.map((u) => [u.id, u]));
    for (const id of unique([...before.keys(), ...now.keys()])) {
      const from = before.get(id), to = now.get(id), unit = to ?? from!;
      if (from && to && same(from, to)) continue;
      for (const changed of [this.state.current.changes, ...(this.state.activation ? [this.state.activation.changes] : [])]) {
      let row = changed.find((c) => c.id === id);
      if (!row) { row = { id, name: unit.name, side: unit.side, scale: unit.scale, lost: 0, recovered: 0, morale: 0, fatigue: 0, gained: [], ended: [], statuses: [], resources: {} }; changed.push(row); }
      row.name = unit.name;
      if (!from || !to) {
        row.sight = to ? 'found' : 'lost';
        // 未观测期间的损伤、移动与状态变化无证据，重新发现时不倒推出隐藏行动。
        continue;
      }
      row.lost += Math.max(0, from.hp - to.hp); row.recovered += Math.max(0, to.hp - from.hp);
      for (const key of unique([...Object.keys(from.resources), ...Object.keys(to.resources)])) {
        const delta = (to.resources[key]?.value ?? 0) - (from.resources[key]?.value ?? 0);
        if (delta) row.resources[key] = { name: (to.resources[key] ?? from.resources[key])!.name, delta: (row.resources[key]?.delta ?? 0) + delta };
      }
      row.morale += to.morale - from.morale; row.fatigue += to.fatigue - from.fatigue;
      if (from.cell !== to.cell) { row.fromCell ??= from.cell; row.toCell = to.cell; }
      row.gained = unique([...row.gained, ...to.effects.filter((e) => !from.effects.includes(e))]);
      row.ended = unique([...row.ended, ...from.effects.filter((e) => !to.effects.includes(e))]);
      if (from.status !== to.status) row.statuses = unique([...row.statuses, to.status]);
      }
    }
    this.state.seen = units;
  }
  beginActivation(round: number, actorName?: string): void { this.state.activation = { round, actorName, changes: [] }; }
  finishActivation(): void { if (this.state.activation) this.state.lastActivation = this.state.activation; delete this.state.activation; }
  activation(): ActivationFeedback | undefined { return this.state.lastActivation ? structuredClone(this.state.lastActivation) : undefined; }
  snapshot(): FeedbackState { return structuredClone(this.state); }
  rounds(): RoundFeedback[] { return structuredClone([this.state.current, ...(this.state.previous ? [this.state.previous] : [])]); }
}

/** 派生摘要损坏时丢弃摘要并从当前可见状态重建，不能改变真实战斗。 */
export function validFeedback(raw: unknown, round: number): raw is FeedbackState {
  if (!raw || typeof raw !== 'object') return false;
  const value = raw as Partial<FeedbackState>;
  const text = (s: unknown) => typeof s === 'string' && s.length <= 2000;
  const texts = (a: unknown): a is string[] => Array.isArray(a) && a.length <= 256 && a.every(text);
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const position = (n: unknown) => n === undefined || typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1000;
  const resources = (raw: unknown, field: 'value' | 'delta') => !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.keys(raw).length <= 256 && Object.values(raw).every((entry) => !!entry && typeof entry === 'object' && text(entry.name) && finite(entry[field]));
  const objective = (o: ObjectiveFeedback) => !!o && finite(o.ally) && finite(o.enemy) && (o.winner === undefined || ['ally', 'enemy', 'draw'].includes(o.winner));
  const identity = (u: FeedbackUnit | UnitChange) => text(u.id) && text(u.name) && ['ally', 'enemy', 'neutral'].includes(u.side) && ['hero', 'company', 'mook'].includes(u.scale);
  const summary = (r: RoundFeedback) => !!r && Number.isInteger(r.round) && r.round > 0 && r.round <= round
    && Array.isArray(r.changes) && r.changes.length <= 4096 && r.changes.every((c) => !!c && identity(c)
      && finite(c.lost) && c.lost >= 0 && finite(c.recovered) && c.recovered >= 0 && finite(c.morale) && finite(c.fatigue)
      && resources(c.resources, 'delta') && position(c.fromCell) && position(c.toCell) && texts(c.gained) && texts(c.ended) && texts(c.statuses)
      && (c.sight === undefined || ['found', 'lost'].includes(c.sight))) && (!r.objective || objective(r.objective.before) && objective(r.objective.after));
  return value.version === 2 && !!value.current && value.current.round === round && summary(value.current)
    && (!value.activation || summary(value.activation) && (value.activation.actorName === undefined || text(value.activation.actorName)))
    && (!value.lastActivation || summary(value.lastActivation) && (value.lastActivation.actorName === undefined || text(value.lastActivation.actorName)))
    && (!value.objective || objective(value.objective)) && (!value.previous || summary(value.previous)) && Array.isArray(value.seen) && value.seen.length <= 4096
    && value.seen.every((u) => !!u && identity(u) && finite(u.hp) && u.hp >= 0 && finite(u.morale) && finite(u.fatigue)
      && resources(u.resources, 'value') && position(u.cell) && text(u.status) && texts(u.effects));
}
