import { smokeBlocks } from './area-effects.js';
import type { BattleLogEntry, Combatant, ConditionDef, Side } from './types.js';
import { standardConditionMap } from './conditions.js';
const defaultConditions = standardConditionMap();
import { activeTraitIds } from './trait-sources.js';
import { formationDistance } from './mass/formation.js';
import { gridDistance, lineOfSight, type BattlefieldSpec } from './small/spatial.js';
import { unitLineOfSight } from './small/spatial.js';
import { isAirborne, sameLayer } from './aerial.js';

/** 只查询事实，不消费随机数或改动快照。随队观察者使用宿主位置。 */
export interface ObservationContext {
  units: Combatant[];
  mode: 'small' | 'mass';
  fieldTags: string[];
  battlefield?: BattlefieldSpec;
  attached?: Map<string, string>;
  conditions?: Pick<ReadonlyMap<string, ConditionDef>, 'get'>;
}
function hostOf(context: ObservationContext, unit: Combatant): Combatant | undefined {
  const hostId = [...(context.attached ?? [])].find(([, hero]) => hero === unit.id)?.[0];
  return context.units.find((u) => u.id === hostId && u.status === 'ready');
}
export function positionedUnit(context: ObservationContext, unit: Combatant): Combatant {
  const host = hostOf(context, unit);
  return host ? { ...unit, tags: host.tags, pos: host.pos, formationPosition: host.formationPosition, airborne: host.airborne } : unit;
}
function distanceBetween(context: ObservationContext, a: Combatant, b: Combatant): number {
  const from = positionedUnit(context, a), to = positionedUnit(context, b), field = context.battlefield;
  return context.mode === 'mass' ? formationDistance(from, to) : field ? gridDistance(field, from.pos!, to.pos!) : Math.abs((from.pos ?? 0) - (to.pos ?? 0));
}
function canConceal(context: ObservationContext, unit: Combatant): boolean {
  return unit.rulesVersion === 'v2' && activeTraitIds(unit).includes('stalk') && unit.status === 'ready' && !unit.suppression && !isAirborne(unit)
    && !unit.conditions.some((c) => c.dur > 0 && (context.conditions ?? defaultConditions).get(c.id)?.skipTurn);
}
export function canSpot(context: ObservationContext, observer: Combatant, target: Combatant): boolean {
  if (observer.side === target.side) return true;
  if (observer.status !== 'ready') return false;
  const from = positionedUnit(context, observer), to = positionedUnit(context, target);
  const field = context.battlefield;
  if (field && !unitLineOfSight(field, from, to) || smokeBlocks(context,from,to)) return false;
  const distance = distanceBetween(context, observer, target), subject = hostOf(context, target) ?? target;
  if (canConceal(context, subject) && !subject.tacticalRevealed && distance > (context.mode === 'small' ? 2 : 1)) return false;
  if (!context.fieldTags.includes('night')) return true;
  const range = activeTraitIds(observer).includes('night-fighter') ? (context.mode === 'small' ? 6 : 4) : (context.mode === 'small' ? 3 : 2);
  return distance <= range;
}
export function revealUnit(context: ObservationContext, unit: Combatant): void {
  for (const subject of [unit, hostOf(context, unit)].filter((u): u is Combatant => !!u)) {
    if (subject.rulesVersion === 'v2' && activeTraitIds(subject).includes('stalk')) subject.tacticalRevealed = true;
  }
}
export function revealContacts(context: ObservationContext): void {
  for (const unit of context.units.filter((u) => canConceal(context, u) && !u.tacticalRevealed)) {
    if (context.units.some((foe) => foe.side !== unit.side && foe.status === 'ready' && sameLayer(unit, foe) && distanceBetween(context, unit, foe) <= 1
      && (!context.battlefield || lineOfSight(context.battlefield, positionedUnit(context, unit).pos!, positionedUnit(context, foe).pos!)))) revealUnit(context, unit);
  }
}
export function canReconceal(context: ObservationContext, unit: Combatant): boolean {
  if (!canConceal(context, unit) || !unit.tacticalRevealed || hostOf(context, unit)) return false;
  const cover = context.mode === 'small' ? ['forest', 'cover'].includes(context.battlefield?.tiles[unit.pos!] ?? '') : context.fieldTags.some((tag) => ['forest', 'urban', 'siege'].includes(tag));
  if (!cover && !context.fieldTags.includes('night')) return false;
  return !context.units.some((foe) => foe.side !== unit.side && foe.status === 'ready' && distanceBetween(context, unit, foe) <= (context.mode === 'small' ? 2 : 1)
    && (!context.battlefield || lineOfSight(context.battlefield, positionedUnit(context, unit).pos!, positionedUnit(context, foe).pos!)));
}
export function settleConcealment(context: ObservationContext, unit: Combatant, quiet: boolean): boolean {
  if (!quiet || !canReconceal(context, unit)) return false;
  delete unit.tacticalRevealed; return true;
}
export function concealmentLabel(context: ObservationContext, unit: Combatant): string | undefined {
  if (!activeTraitIds(unit).includes('stalk') || unit.rulesVersion !== 'v2') return undefined;
  if (hostOf(context, unit)) return '随队隐蔽以所在编队为准';
  if (unit.tacticalRevealed) return canReconceal(context, unit) ? '已暴露，原地休整可重新潜伏' : '已暴露，需要掩护并脱离近敌';
  return canConceal(context, unit) ? '潜伏中，近距离仍会被侦察' : '潜伏受压制或失能影响';
}
export function validateConcealment(value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('潜伏暴露记录损坏');
}
export function observedUnits(context: ObservationContext, side: Side): Combatant[] {
  const observers = context.units.filter((u) => u.side === side && u.status === 'ready');
  return context.units.filter((target) => target.side === side || observers.some((observer) => canSpot(context, observer, target)));
}
export function observeEvent(context: ObservationContext, entry: BattleLogEntry): BattleLogEntry {
  const ids = entry.participants ?? (entry.resolution ? [entry.resolution.attackerId, entry.resolution.defenderId] : []);
  const global = !ids.length && ['round', 'battle-end'].includes(entry.kind);
  const observedBy: Side[] = [], observedText: Partial<Record<Side, string>> = {};
  for (const side of ['ally', 'enemy', 'neutral'] as const) {
    const visible = new Set(observedUnits(context, side).map((u) => u.id));
    if (global || ids.length && ids.every((id) => visible.has(id))) observedBy.push(side);
    else if (entry.resolution) {
      const victim = context.units.find((u) => u.id === entry.resolution!.defenderId && u.side === side);
      if (victim) observedText[side] = `${victim.name} 受到未定位攻击，损失${entry.resolution.finalDamage}，剩余${victim.hp}/${victim.base.hpMax}`;
    }
  }
  return { ...entry, observedBy, ...(Object.keys(observedText).length ? { observedText } : {}) };
}
export function observedLog(log: BattleLogEntry[], side: Side): BattleLogEntry[] {
  return log.flatMap((entry) => entry.observedBy?.includes(side) ? [entry] : entry.observedText?.[side]
    ? [{ round: entry.round, kind: entry.kind, text: entry.observedText[side]! }]
    : !entry.observedBy && ['round', 'battle-end'].includes(entry.kind) ? [entry] : []);
}
