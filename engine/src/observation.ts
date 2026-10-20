import { controlCondition } from './battle-control.js';
import { phase2Traits } from './trait-level-model.js';
import { reconDistance } from './trait-parameters.js';
import { intactStructure } from './small/layers.js';
import { meleeContact } from './small/layers.js';
import { smokeBlocks } from './area-effects.js';
import type { BattleLogEntry, Combatant, ConditionDef, Side } from './types.js';
import { standardConditionMap } from './conditions.js';
const defaultConditions = standardConditionMap();
import { activeTraitIds } from './trait-sources.js';
import { traitLevel, nightSight, terrainStalks, MAX_NIGHT_SIGHT } from './trait-levels.js';
import { itemsV15 } from './item-model.js';
import { standingTerrain } from './small/height-map.js';
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
  /** Frozen macro-node capacity; old battle contexts default to three. */
  formationSlots?: number;
  conditions?: Pick<ReadonlyMap<string, ConditionDef>, 'get'>;
  rules?: import('./types.js').RulePack;
  traitRegistry?: Map<string, import('./types.js').Trait>;
  reload?: ReadonlyMap<string, number>;
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
/** 单位脚下的地形：小战看格子（建筑格算建筑），会战看战场环境。 */
function terrainsOf(context: ObservationContext, unit: Combatant): string[] {
  if (context.mode === 'mass') return context.fieldTags;
  const field = context.battlefield, at = positionedUnit(context, unit);
  if (!field || at.pos === undefined) return [];
  return [intactStructure(field, at.pos)?.kind === 'building' ? 'building' : standingTerrain(field, at) ?? ''];
}
/** 有潜伏特质，或 V15 专精够级且站在对应地形中（林地、山地 L8，巷战 L9）。 */
const TERRAIN_STALK_TRAITS = ['forest-lore', 'mountain-born', 'urban-fighter'];
function stalking(context: ObservationContext, unit: Combatant): boolean {
  const traits = activeTraitIds(unit);
  if (traits.includes('stalk')) return true;
  // 观测每次配对都会经过这里：没有这三项专精的单位不必再查脚下地形。
  return itemsV15(unit) && traits.some((id) => TERRAIN_STALK_TRAITS.includes(id)) && terrainsOf(context, unit).some((terrain) => terrainStalks(unit, terrain, traits));
}
/** 出手是否会暴露：能潜伏的单位都记一次暴露，之后离开或回到对应地形也要重新潜伏。 */
function stalkCapable(unit: Combatant): boolean {
  const traits = activeTraitIds(unit);
  return traits.includes('stalk') || itemsV15(unit) && (['forest', 'hill', 'street'] as const).some((terrain) => terrainStalks(unit, terrain, traits));
}
function canConceal(context: ObservationContext, unit: Combatant): boolean {
  return unit.rulesVersion === 'v2' && stalking(context, unit) && unit.status === 'ready' && !unit.suppression && !isAirborne(unit)
    && !unit.conditions.some((c) => c.dur > 0 && (context.conditions ?? defaultConditions).get(c.id)?.skipTurn);
}
/** 此刻仍处在潜伏中（未暴露）；偷袭在出手暴露之前读取。 */
export function concealedUnit(context: ObservationContext, unit: Combatant): boolean {
  return canConceal(context, unit) && !unit.tacticalRevealed;
}
export function canSpot(context: ObservationContext, observer: Combatant, target: Combatant): boolean {
  if (observer.id === target.id) return true;
  const personal = ['blinded','charmed','confused'].some(id => controlCondition(observer, id));
  if (!personal && observer.side === target.side) return true;
  if (controlCondition(observer, 'blinded') && distanceBetween(context, observer, target) > 1) return false;
  if (observer.status !== 'ready') return false;
  // 夜间先按最远夜视（夜战专长）剪掉远处的配对，不必追视线或查特质；白天照旧先判视线。判定结果不变。
  const night = context.fieldTags.includes('night'), early = night ? distanceBetween(context, observer, target) : undefined;
  if (early !== undefined && early > MAX_NIGHT_SIGHT[context.mode]) return false;
  const from = positionedUnit(context, observer), to = positionedUnit(context, target);
  const field = context.battlefield;
  if (field && !unitLineOfSight(field, from, to) || smokeBlocks(context,from,to)) return false;
  const distance = early ?? distanceBetween(context, observer, target), subject = hostOf(context, target) ?? target;
  // 侦察（斥候、观察员、神识）识破潜伏的距离翻倍；只在目标确实隐匿时才查观察者特质。
  if (canConceal(context, subject) && !subject.tacticalRevealed) {
    if (controlCondition(observer, 'blinded')) return false;
    const S = Math.max(traitLevel(subject, 'stalk'), terrainsOf(context, subject).some(t => terrainStalks(subject, t)) ? 5 : 0);
    const radius = phase2Traits(subject) || phase2Traits(observer) ? reconDistance(S, traitLevel(observer, 'recon'), context.mode, subject.traitLevelModel) : (context.mode === 'small' ? 2 : 1) * (activeTraitIds(observer).includes('recon') ? 2 : 1);
    if (distance > radius) return false;
  }
  if (!night) return true;
  return distance <= nightSight(traitLevel(observer, 'night-fighter'), context.mode);
}
export function revealUnit(context: ObservationContext, unit: Combatant): void {
  for (const subject of [unit, hostOf(context, unit)].filter((u): u is Combatant => !!u)) {
    if (subject.rulesVersion === 'v2' && stalkCapable(subject)) subject.tacticalRevealed = true;
  }
}
export function revealContacts(context: ObservationContext): void {
  for (const unit of context.units.filter((u) => canConceal(context, u) && !u.tacticalRevealed)) {
    if (context.units.some((foe) => foe.side !== unit.side && foe.status === 'ready' && !controlCondition(foe, 'blinded') && meleeContact(context.battlefield,unit,foe) && distanceBetween(context, unit, foe) <= 1
      && (!context.battlefield || unitLineOfSight(context.battlefield, positionedUnit(context, unit), positionedUnit(context, foe))))) revealUnit(context, unit);
  }
}
export function canReconceal(context: ObservationContext, unit: Combatant): boolean {
  if (!canConceal(context, unit) || !unit.tacticalRevealed || hostOf(context, unit)) return false;
  const cover = itemsV15(unit) && !activeTraitIds(unit).includes('stalk') ? true : context.mode === 'small' ? (['forest', 'cover'].includes(context.battlefield?.tiles[unit.pos!] ?? '') || !!context.battlefield?.layerVersion && (['cover', 'fortification'].includes(intactStructure(context.battlefield, unit.pos!)?.kind ?? '') || !!context.battlefield.overlays?.[unit.pos!]?.includes('rubble'))) : context.fieldTags.some((tag) => ['forest', 'urban', 'siege'].includes(tag));
  if (!cover && !context.fieldTags.includes('night')) return false;
  return !context.units.some((foe) => foe.side !== unit.side && foe.status === 'ready' && distanceBetween(context, unit, foe) <= (context.mode === 'small' ? 2 : 1)
    && (!context.battlefield || unitLineOfSight(context.battlefield, positionedUnit(context, unit), positionedUnit(context, foe))));
}
export function settleConcealment(context: ObservationContext, unit: Combatant, quiet: boolean): boolean {
  if (!quiet || !canReconceal(context, unit)) return false;
  delete unit.tacticalRevealed; return true;
}
export function concealmentLabel(context: ObservationContext, unit: Combatant): string | undefined {
  if (unit.rulesVersion !== 'v2' || !stalkCapable(unit)) return undefined;
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
/** 一次算出三个阵营各自看得见的单位；同一事件的战报裁剪与敌情记忆共用。 */
export function sideViews(context: ObservationContext): Map<Side, Set<string>> {
  return new Map((['ally', 'enemy', 'neutral'] as const).map((side) => [side, new Set(observedUnits(context, side).map((u) => u.id))]));
}
export function observeEvent(context: ObservationContext, entry: BattleLogEntry, views: ReadonlyMap<Side, ReadonlySet<string>> = sideViews(context)): BattleLogEntry {
  const ids = entry.participants ?? (entry.resolution ? [entry.resolution.attackerId, entry.resolution.defenderId] : []);
  const global = !ids.length && ['round', 'rule', 'objective', 'battle-end'].includes(entry.kind);
  const observedBy: Side[] = [], observedText: Partial<Record<Side, string>> = {};
  for (const side of ['ally', 'enemy', 'neutral'] as const) {
    const visible = views.get(side)!;
    if (global || ids.length && ids.every((id) => visible.has(id))) observedBy.push(side);
    else if (entry.resolution) {
      const victim = context.units.find((u) => u.id === entry.resolution!.defenderId && u.side === side);
      if (victim) observedText[side] = `${victim.name} 受到未定位攻击，损失${entry.resolution.finalDamage}，剩余${victim.hp}/${victim.base.hpMax}`;
    }
  }
  return { ...entry, observedBy, ...(Object.keys(observedText).length ? { observedText } : {}) };
}
export function observedLog(log: BattleLogEntry[], side: Side): BattleLogEntry[] {
  // 道具汇总在终章读取完整日志；战内仍逐条裁剪效果，不能借可见的使用者公开未见目标的结果。
  const publicEntry = ({ itemUse: _itemUse, ...entry }: BattleLogEntry): BattleLogEntry => entry;
  return log.flatMap((entry) => entry.observedBy?.includes(side) ? [entry.itemUse ? publicEntry(entry) : entry] : entry.observedText?.[side]
    ? [{ round: entry.round, kind: entry.kind, text: entry.observedText[side]! }]
    : !entry.observedBy && ['round', 'rule', 'objective', 'battle-end'].includes(entry.kind) ? [entry] : []);
}
