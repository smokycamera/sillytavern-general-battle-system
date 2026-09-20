import type { Combatant, Trait } from './types.js';
import { activeConditionIds, activeTraitIds } from './trait-sources.js';
import { collectMods, resolveStack, type Modifier } from './bonus.js';
import { curveAt } from './data/curves.js';
import { traitRegistry } from './data/traits.js';
import { standardConditionMap } from './conditions.js';
import { canSpot, observedUnits, positionedUnit, type ObservationContext } from './observation.js';
import { formationDistance } from './mass/formation.js';
import { gridDistance, unitLineOfSight } from './small/spatial.js';
import type { Rng } from './rng.js';
import { isCohort, nominalLife } from './combat-model.js';
import { MEMBER_HEALTH_MODEL, memberHealthMax } from './member-health.js';

export interface MoraleState {
  terrorSeen: string[];
  routs: number;
  attempts: number;
  routedRound?: number;
  lastRallyRound?: number;
  ralliedRound?: number;
  cause?: 'terror' | 'morale';
  /** 个体士气能力只调整本场心理基准，不新增永久属性。 */
  personal?: number;
  damage?: number;
  damagePenalty?: number;
}
export const MAX_RALLY_ATTEMPTS = 3;

const emptyState = (): MoraleState => ({ terrorSeen: [], routs: 0, attempts: 0 });
export function validateMoraleState(value: unknown): void {
  if (value === undefined) return;
  const s = value as MoraleState;
  if (!s || typeof s !== 'object' || !Array.isArray(s.terrorSeen) || s.terrorSeen.length > 4096 || s.terrorSeen.some((id) => typeof id !== 'string' || !id)
    || new Set(s.terrorSeen).size !== s.terrorSeen.length || !Number.isInteger(s.routs) || s.routs < 0 || s.routs > 3 || !Number.isInteger(s.attempts) || s.attempts < 0 || s.attempts > MAX_RALLY_ATTEMPTS
    || [s.routedRound, s.lastRallyRound, s.ralliedRound].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n! < 0))
    || s.personal !== undefined && (!Number.isFinite(s.personal) || s.personal < 0 || s.personal > 100)
    || [s.damage, s.damagePenalty].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n! < 0))
    || s.cause !== undefined && !['terror', 'morale'].includes(s.cause)) throw new Error('惊退来源或重整机会记录损坏');
}
export function changeMorale(unit: Combatant, amount: number): number {
  const before = unit.morale ?? unit.moraleState?.personal ?? curveAt(unit.level).morale;
  const after = Math.max(0, Math.min(unit.base.moraleMax ?? 100, before + amount));
  if (unit.morale !== undefined) unit.morale = after;
  else { unit.moraleState ??= emptyState(); unit.moraleState.personal = after; }
  return after - before;
}
function damagePressure(unit: Combatant, damage: number): number {
  const maximum = unit.combatModel === MEMBER_HEALTH_MODEL ? memberHealthMax(unit)
    : unit.scale === 'hero' ? nominalLife(unit) : unit.base.hpMax;
  return Math.round(damage / Math.max(1, maximum) * (unit.scale === 'hero' ? 30 : 100));
}
/** 校正旧V4快照可追溯的受创项，不撤销死亡/撤离或历史战果。 */
export function reconcileDamageMorale(unit: Combatant): void {
  const state = unit.moraleState;
  if (unit.combatModel !== MEMBER_HEALTH_MODEL || unit.scale !== 'hero' || !state || state.damage === undefined || state.damagePenalty === undefined) return;
  const corrected = damagePressure(unit, state.damage), difference = state.damagePenalty - corrected;
  const current = unit.morale ?? state.personal ?? curveAt(unit.level).morale;
  const refund = Math.max(0, (unit.base.moraleMax ?? curveAt(unit.level).morale) - current);
  if (difference) changeMorale(unit, difference > 0 ? Math.min(difference, refund) : difference);
  state.damagePenalty = corrected;
}
/** 累计真实损伤占实际最大生命的比例，只扣新增压力，避免连发逐次取整。 */
export function moraleOnDamage(unit: Combatant, loss: number): void {
  if ((unit.scale === 'hero' && !isCohort(unit)) || loss <= 0) return;
  reconcileDamageMorale(unit);
  unit.moraleState ??= emptyState(); const state = unit.moraleState;
  state.damage = (state.damage ?? 0) + loss;
  const total = damagePressure(unit, state.damage), increment = total - (state.damagePenalty ?? 0);
  state.damagePenalty = total;
  if (increment > 0) changeMorale(unit, -increment);
}

export interface MoraleProfile {
  effective: number;
  fear: number;
  command: number;
  resilience: number;
  immune: boolean;
  attackPenalty: number;
  sources: { id: string; name: string; trait: string; traitId: string; value: number }[];
  auraMods: Modifier[];
}

/** 观测、距离与真实随队位置共同限制光环；查询不改档案或战斗随机状态。 */
export function moraleProfile(context: ObservationContext, unit: Combatant, registry = traitRegistry()): MoraleProfile {
  const conditions = standardConditionMap();
  if (context.conditions) for (const id of activeConditionIds(unit)) { const def = context.conditions.get(id); if (def) conditions.set(id, def); }
  const traits = activeTraitIds(unit).flatMap((id) => registry.get(id) ?? []);
  const immune = traits.some((t) => t.effects.some((e) => e.kind === 'immuneMorale'));
  const resilience = Math.max(0, traits.reduce((sum, trait) => sum + trait.effects.reduce((n, e) => n + (e.kind === 'stat' && e.stat === 'morale' ? e.value : 0), 0), 0));
  const sources: MoraleProfile['sources'] = [];
  const from = positionedUnit(context, unit), range = context.mode === 'small' ? 3 : 1;
  if (unit.rulesVersion === 'v2') for (const other of context.units) {
    if (other.id === unit.id || other.hp <= 0 || other.status !== 'ready' || activeConditionIds(other).some((id) => (context.conditions ?? conditions).get(id)?.skipTurn)) continue;
    // 失去宿主的普通随队人物不能从原先个人部署偏好继续指挥远处友军。
    const hostId = [...(context.attached ?? [])].find(([, id]) => id === other.id)?.[0];
    if (hostId && !context.units.some((u) => u.id === hostId && u.status === 'ready')) continue;
    const to = positionedUnit(context, other), field = context.battlefield;
    const distance = context.mode === 'mass' ? formationDistance(from, to) : field ? gridDistance(field, from.pos!, to.pos!) : Math.abs((from.pos ?? 0) - (to.pos ?? 0));
    if (distance > range || field && !unitLineOfSight(field, from, to) || !canSpot(context, { ...unit, status: 'ready' }, other)) continue;
    for (const id of activeTraitIds(other)) {
      const trait = registry.get(id); if (!trait) continue;
      for (const effect of trait.effects) {
        if (effect.kind !== 'moraleAura' || effect.scope === 'side' && other.side !== unit.side || effect.scope === 'enemySide' && (other.side === unit.side || immune)) continue;
        sources.push({ id: other.id, name: other.name, trait: trait.name, traitId: id, value: effect.value });
      }
    }
  }
  const fear = Math.max(0, ...sources.map((s) => -s.value)), command = Math.max(0, ...sources.map((s) => s.value));
  const auraMods: Modifier[] = sources.map((s) => ({ source: 'command', sourceId: `aura:${s.id}:${s.trait}`, stackGroup: s.value < 0 ? 'fear:morale' : 'command:morale', name: s.trait, kind: 'morale', type: 'flat', value: s.value }));
  // 个体不新增一套永久士气表，训练基准与个人韧性只用于本场心理对抗。
  const personal = unit.scale === 'hero' ? resilience : 0;
  const flat = resolveStack(collectMods(unit, { fieldTags: context.fieldTags }, conditions, auraMods, registry), 'morale', {}, { maxFlat: 100 }).flatTotal;
  const injury = unit.scale === 'hero' ? Math.round((1 - unit.hp / unit.base.hpMax) * 40) : 0;
  const effective = Math.max(0, Math.min(100, (unit.morale ?? unit.moraleState?.personal ?? curveAt(unit.level).morale) + personal + flat - injury));
  const attackPenalty = immune ? 0 : Math.min(2, Math.ceil(Math.max(0, fear - command - resilience) / 8));
  return { effective, fear, command, resilience, immune, attackPenalty, sources, auraMods };
}

export function moraleAttackMods(context: ObservationContext, unit: Combatant, registry?: Map<string, Trait>, knownContext = context): Modifier[] {
  const catalog = registry ?? traitRegistry();
  if (!context.units.some((other) => other.side !== unit.side && other.status === 'ready' && activeTraitIds(other).some((id) => catalog.get(id)?.effects.some((e) => e.kind === 'moraleAura' && e.scope === 'enemySide' && e.value < 0)))) return [];
  const known = new Set(observedUnits(knownContext, unit.side).map((u) => u.id));
  const pressure = moraleProfile({ ...context, units: context.units.filter((u) => known.has(u.id)) }, unit, catalog);
  return pressure.attackPenalty ? [{ source: 'condition', sourceId: 'morale:fear', stackGroup: 'condition:atk:flat:negative', name: '恐惧压制', kind: 'atk', type: 'flat', value: -pressure.attackPenalty }] : [];
}

export function moraleLabel(context: ObservationContext, unit: Combatant, registry?: Map<string, Trait>, breakAt = 25): string {
  const profile = moraleRisk(context, unit, breakAt, registry);
  if (!profile.sources.length && !profile.immune && unit.status !== 'routing' && !unit.moraleState?.routs && !(isCohort(unit) && unit.moraleState?.damagePenalty)) return '';
  return [unit.status === 'routing' ? `等待重整，剩余${Math.max(0, MAX_RALLY_ATTEMPTS - (unit.moraleState?.attempts ?? 0))}次机会，基础成功率${Math.round(profile.rallyChance * 100)}%且需要合法空位` : profile.breakChance > 0 && unit.status === 'ready' ? `下次士气结算惊退风险${Math.round(profile.breakChance * 100)}%` : '', profile.immune ? '不溃' : '', profile.fear ? `恐惧压力${profile.fear}` : '', profile.command ? `附近统率${profile.command}` : '', profile.attackPenalty ? `攻击降低${profile.attackPenalty}` : '', `有效士气${profile.effective}`].filter(Boolean).join('，');
}

export function moraleRisk(context: ObservationContext, unit: Combatant, breakAt: number, registry?: Map<string, Trait>) {
  const profile = moraleProfile(context, unit, registry), state = unit.moraleState;
  const terror = profile.sources.filter((s) => s.traitId === 'terror' && !state?.terrorSeen.includes(s.id));
  const threshold = 12 + Math.max(0, (state?.routs ?? 1) - 1) * 3;
  const bonus = Math.floor(profile.effective / 10) + (profile.command > 0 ? 2 : 0);
  const success = Math.max(0, Math.min(1, (21 + bonus - threshold) / 20));
  return { ...profile, terror,
    breakChance: profile.immune ? 0 : profile.effective <= breakAt ? 1 : terror.length && profile.effective <= 50 ? 1 - Math.max(0, Math.min(1, (21 + Math.floor(profile.effective / 10) - 12) / 20)) : 0,
    rallyChance: profile.immune ? 1 : profile.effective <= breakAt ? 0 : success, rallyDC: threshold, rallyBonus: bonus };
}
export interface MoraleDecision {
  kind: 'none' | 'resisted' | 'routed' | 'rallied' | 'failed' | 'fled';
  state?: MoraleState;
  text?: string;
  effective?: number;
}
/** 从同一阶段事实计算；调用方先准备全部结果，再提交位置和状态，避免光环顺序偏差。 */
export function decideMorale(context: ObservationContext, unit: Combatant, round: number, rng: Rng, breakAt: number, registry?: Map<string, Trait>): MoraleDecision {
  if (unit.rulesVersion !== 'v2' || unit.hp <= 0 || !['ready', 'routing'].includes(unit.status)) return { kind: 'none' };
  const risk = moraleRisk(context, unit, breakAt, registry), state = structuredClone(unit.moraleState ?? emptyState());
  if (unit.status === 'routing') {
    if (!state.routs) { state.routs = 1; state.routedRound = Math.max(0, round - 1); state.cause = 'morale'; }
    if (state.routedRound === round || state.lastRallyRound === round) return { kind: 'none' };
    state.lastRallyRound = round; state.attempts = Math.min(MAX_RALLY_ATTEMPTS, state.attempts + 1);
    const success = risk.immune || risk.rallyChance > 0 && rng.d(20) + risk.rallyBonus >= risk.rallyDC;
    if (success) { state.ralliedRound = round; return { kind: 'rallied', state, effective: risk.effective, text: `${unit.name} 重整成功，准备重返战线` }; }
    return { kind: state.attempts >= MAX_RALLY_ATTEMPTS ? 'fled' : 'failed', state, text: `${unit.name} 重整失败${state.attempts >= MAX_RALLY_ATTEMPTS ? '，机会耗尽，撤离战场' : `，仍在溃退，剩余${MAX_RALLY_ATTEMPTS - state.attempts}次机会`}` };
  }
  if (state.ralliedRound === round || risk.immune || activeConditionIds(unit).some((id) => context.conditions?.get(id)?.skipTurn)) return { kind: 'none' };
  let cause: 'terror' | 'morale' | undefined = risk.effective <= breakAt ? 'morale' : undefined;
  if (!cause && risk.terror.length && risk.effective <= 50) {
    state.terrorSeen = [...new Set([...state.terrorSeen, ...risk.terror.map((s) => s.id)])];
    if (rng.d(20) + Math.floor(risk.effective / 10) >= 12) return { kind: 'resisted', state, text: `${unit.name} 顶住恐怖，同一来源本战不会再次触发惊退` };
    cause = 'terror';
  }
  if (!cause) return { kind: 'none' };
  state.terrorSeen = [...new Set([...state.terrorSeen, ...risk.terror.map((s) => s.id)])];
  state.routs = Math.min(3, state.routs + 1); state.attempts = 0; state.routedRound = round; state.cause = cause;
  return { kind: state.routs >= 3 ? 'fled' : 'routed', state, text: `${unit.name} ${state.routs >= 3 ? '第三次溃退，彻底溃散离场' : cause === 'terror' ? '受到恐怖惊退，退出当前战线等待重整' : `有效士气${risk.effective}，士气崩溃，退出当前战线等待重整`}` };
}

export function moraleChangePreview(context: ObservationContext, unit: Combatant, amount: number, breakAt: number, registry?: Map<string, Trait>, conditions: Combatant['conditions'] = []) {
  const before = moraleRisk(context, unit, breakAt, registry), future = structuredClone(unit); future.conditions.push(...conditions); changeMorale(future, amount);
  const after = moraleRisk({ ...context, units: context.units.map((u) => u.id === unit.id ? future : u) }, future, breakAt, registry);
  return { moraleBefore: before.effective, moraleAfter: after.effective, breakChance: after.breakChance,
    ...(unit.status === 'routing' ? { rallyChance: after.rallyChance } : {}),
    value: (after.effective - before.effective) / 3 + (before.breakChance - after.breakChance) * 10 + (unit.status === 'routing' ? (after.rallyChance - before.rallyChance) * 10 : 0) };
}
