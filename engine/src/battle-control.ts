import type { ActiveCondition, Combatant, Side } from './types.js';
import type { Rng } from './rng.js';
import { phase2Traits } from './trait-level-model.js';

export const ACTIVATION_CONTROLS = new Set(['taunted', 'charmed', 'blinded', 'confused']);
export function activationControlDuration(condition: Pick<ActiveCondition,'id'|'dur'|'controlPending'>): string | undefined {
  return ACTIVATION_CONTROLS.has(condition.id) ? `${condition.dur}次正常激活${condition.controlPending ? '（待激活）' : ''}` : undefined;
}
export function controlCondition(unit: Combatant, id: string): ActiveCondition | undefined {
  return phase2Traits(unit) ? unit.conditions.find(c => c.id === id && c.dur > 0 && !c.controlPending) : undefined;
}
export function controlPolicy(unit: Combatant): 'charmed' | 'confused' | 'taunted' | undefined {
  return (['charmed', 'confused', 'taunted'] as const).find(id => controlCondition(unit, id));
}
/** 真实side不改；递归解析临时作战关系，有环时按原归属收敛。 */
export function combatSide(unit: Combatant, units: readonly Combatant[], visited = new Set<string>()): Side {
  const charm = controlCondition(unit, 'charmed');
  if (!charm || visited.has(unit.id)) return unit.side;
  const source = units.find(u => u.id === charm.sourceId && u.hp > 0 && !['dead','fled'].includes(u.status));
  if (!source) return charm.controlSide ?? unit.side;
  visited.add(unit.id); return combatSide(source, units, visited);
}
export function combatHostile(actor: Combatant, target: Combatant, units: readonly Combatant[]): boolean {
  if (actor.id === target.id) return false;
  return combatSide(actor, units) !== combatSide(target, units);
}
export const attackHostile = (actor: Combatant, target: Combatant, units: readonly Combatant[]): boolean => actor.id !== target.id && (controlPolicy(actor) === 'confused' || combatHostile(actor, target, units));
export function controlActionReason(actor: Combatant, target: Combatant | undefined, units: readonly Combatant[], kind: 'weapon' | 'skill', friendly = false, areaIds?: readonly string[], recipient = false): string | undefined {
  const policy = controlPolicy(actor);
  if (policy === 'confused') {
    if (kind !== 'weapon') return '混乱期间只能按本次已保存决定使用普通武器或防御等待';
    if (actor.controlActivation && (!target || target.id !== actor.controlActivation.targetId)) return '混乱本次激活的目标已固定';
  }
  if (policy === 'taunted' && !friendly && !recipient) {
    const source = units.find(u => u.id === controlCondition(actor, 'taunted')?.sourceId);
    const sourceId = controlCondition(actor, 'taunted')?.sourceId;
    if (sourceId && (!source || source.hp > 0 && !['dead','fled'].includes(source.status) && combatHostile(actor, source, units))
      && target?.id !== sourceId && !areaIds?.includes(sourceId)) return '受嘲讽约束，敌对行动必须指向施加者；可接近、固守或自保';
  }
  return undefined;
}
/** 来源失效与魅惑受伤解除不改变生命伤害、归属、XP或结局。 */
export function reconcileBattleControls(units: readonly Combatant[]): void {
  for (const unit of units) unit.conditions = unit.conditions.filter(c => {
    if (!ACTIVATION_CONTROLS.has(c.id) || !['taunted','charmed'].includes(c.id)) return true;
    const source = units.find(u => u.id === c.sourceId);
    return !!source && source.hp > 0 && !['dead','fled'].includes(source.status) && (c.id !== 'taunted' || combatSide(source, units) !== combatSide(unit, units));
  });
}
export function breakCharmOnDamage(units: readonly Combatant[], target: Combatant, source: Combatant | undefined, damage: number): void {
  const charm = phase2Traits(target) ? target.conditions.find(c => c.id === 'charmed' && c.dur > 0) : undefined;
  const caster = units.find(u => u.id === charm?.sourceId);
  if (damage > 0 && caster && source && combatSide(caster, units) === combatSide(source, units)) target.conditions = target.conditions.filter(c => c !== charm);
  reconcileBattleControls(units);
}
/** 正常激活唯一入口；候选构造与预览不抽随机数，决定随快照保存。 */
export function beginControlActivation(unit: Combatant, rng: Rng, candidates: () => readonly string[]): void {
  if (!phase2Traits(unit)) return;
  for (const c of unit.conditions) if (ACTIVATION_CONTROLS.has(c.id) && c.dur > 0) { delete c.controlPending; c.controlActive = true; }
  const sequence = (unit.controlActivation?.sequence ?? 0) + 1; delete unit.controlActivation;
  if (controlPolicy(unit) === 'confused') {
    const eligible = [...new Set(candidates())].filter(id => id !== unit.id).sort();
    unit.controlActivation = { sequence, ...(eligible.length ? { targetId: eligible[rng.d(eligible.length) - 1] } : {}) };
  }
}
export function finishControlActivation(unit: Combatant): void {
  for (const c of unit.conditions) if (ACTIVATION_CONTROLS.has(c.id) && c.controlActive) { if (!c.effectSourceId) c.dur--; delete c.controlActive; }
  unit.conditions = unit.conditions.filter(c => c.dur > 0);
}
export function validateBattleControlState(unit: Combatant): void {
  if (unit.controlModel !== undefined && unit.controlModel !== 'activation-controls-v1') throw Error('控制模型版本损坏');
  const d = unit.controlActivation;
  if (unit.looseFormationChoice !== undefined && !['loose','closed'].includes(unit.looseFormationChoice)
    || unit.looseChoiceLocked !== undefined && typeof unit.looseChoiceLocked !== 'boolean'
    || unit.movedDuringActivation !== undefined && typeof unit.movedDuringActivation !== 'boolean') throw Error('特质激活记录损坏');
  if (d && (!Number.isSafeInteger(d.sequence) || d.sequence < 1 || d.targetId !== undefined && typeof d.targetId !== 'string')) throw Error('控制激活决定损坏');
  for (const c of unit.conditions) if (c.controlSide !== undefined && !['ally','enemy','neutral'].includes(c.controlSide) || c.controlPending !== undefined && typeof c.controlPending !== 'boolean' || c.controlActive !== undefined && typeof c.controlActive !== 'boolean') throw Error('控制激活时钟损坏');
}

/** 反应攻击也消费同一策略，但不会创建激活或重选混乱目标。 */
export function controlReactionAllowed(actor: Combatant, target: Combatant, units: readonly Combatant[], distance: number): boolean {
  return !controlActionReason(actor, target, units, 'weapon') && (!controlCondition(actor, 'blinded') || distance <= 1);
}
