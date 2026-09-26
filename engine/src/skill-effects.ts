import { recoveryCapacity } from './recovery.js';
import { zoneAmount, zoneEffectDescription } from './zone-skills.js';
import type { Ability, ActiveCondition, Combatant, EffectOp } from './types.js';
import type { Rng } from './rng.js';
import { activeTraitIds, bodyRank, traitSourceActive, grantTraitSource, traitPrerequisiteReason } from './trait-sources.js';
import { traitRegistry } from './data/traits.js';
import { skillResourceChange } from './skill-runtime.js';
import { standardConditionMap } from './conditions.js';
import { conditionMods } from './bonus.js';
import { poisonFactor, conditionExposure } from './afflictions.js';
import { isCohort } from './combat-model.js';
import { positionedUnit, revealUnit, type ObservationContext } from './observation.js';
import { canOccupy, terrainCellLabel } from './small/spatial.js';
import { formationNode, FORMATION_NODES, formationCanOccupy } from './mass/formation.js';
import { actionPotential, incomingPotential, tacticalStateValue } from './skill-tactics.js';

type ConditionEffect = Extract<EffectOp, { op: 'condition' }>;
type PushEffect = Extract<EffectOp, { op: 'push' }>;
type DispelEffect = Extract<EffectOp, { op: 'dispel' }>;
const definitions = standardConditionMap();
/** 与结算共用状态修正，避免把效力百分比误当成实际属性增幅。 */
export function skillConditionDescription(effect: ConditionEffect, target: Combatant): string {
  const def = definitions.get(effect.conditionId);
  const immunity = conditionImmunity(target, effect.conditionId);
  if (immunity) return immunity;
  const mods = conditionMods([{ id: effect.conditionId, dur: effect.dur, potency: effect.potency, magnitude: effect.magnitude }], definitions, target);
  const labels = { atk: '攻击命中', def: '防御', dmg: '造成伤害', ward: '受到伤害', spd: '先攻速度', morale: '有效士气' };
  const details = mods.map(mod => {
    const value = Number((mod.type === 'mult' ? (mod.value - 1) * 100 : mod.value).toFixed(2));
    return labels[mod.kind] + (value >= 0 ? ' +' : ' ') + value + (mod.type === 'mult' ? '%' : '');
  });
  if (def?.preventMove) details.push('不能移动、起飞或冲锋');
  if (def?.preventMagic) details.push('不能使用魔法技能');
  if (def?.preventAttack) details.push('不能使用手持武器攻击，天生武器仍可用');
  if (def?.skipTurn) details.push('跳过行动');
  if (def?.dot) details.push('受到持续' + (def.dot.label ?? def.name) + '，按当前战斗规则结算');
  if (effect.conditionId === 'hasted') details.push('移动点 +1（受移动上限限制），会战可提升纵深调动距离');
  if (effect.conditionId === 'slowed') details.push('移动点 -1（最低1），会战不能冲锋');
  if (['empowered', 'weakened', 'vulnerable', 'blessed'].includes(effect.conditionId)) details.push('仅修正可造成的伤害，不绕过防护');
  return details.join('、') || def?.desc || effect.conditionId;
}
const positive = new Set(['empowered', 'inspired', 'blessed', 'encouraged', 'confident', 'hasted']);
export function isPositiveCondition(id: string): boolean { return positive.has(id); }
const negative = new Set(['inaccurate', 'exposed', 'poisoned', 'bleeding', 'burning', 'silenced', 'stunned', 'restrained', 'disarmed', 'fearful', 'slowed', 'cursed', 'demoralized', 'weakened', 'vulnerable', 'wounded']);
export function conditionImmunity(target: Combatant, id: string): string | undefined {
  if (id === 'poisoned' && !poisonFactor(target)) return '封闭车体免疫中毒';
  if (id === 'fearful' && activeTraitIds(target).includes('steadfast')) return '不溃抵抗惊惧';
  return undefined;
}
export function controlBonus(target: Combatant): number { return Math.floor(target.level / 2) + bodyRank(target) - 1; }
export function conditionChance(target: Combatant, effect: ConditionEffect): number {
  if (target.hp <= 0 || ['dead', 'fled'].includes(target.status) || conditionImmunity(target, effect.conditionId)) return 0;
  if (effect.saveDC === undefined) {
    if (positive.has(effect.conditionId)) {
      const same = target.conditions.filter((c) => c.id === effect.conditionId && c.dur >= effect.dur).map((c) => (c.potency ?? 2) * (c.magnitude ?? 1));
      if ((target.traitSources ?? []).some((s) => traitSourceActive(target, s) && s.conditionIds?.includes(effect.conditionId))) same.push(2);
      if (same.some((value) => value >= (effect.potency ?? 2) * (effect.magnitude ?? 1))) return 0;
    }
    return 1;
  }
  if (target.conditions.some((c) => c.id === effect.conditionId && c.dur > 0)) return 0;
  return Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => n === 1 || n !== 20 && n + controlBonus(target) < effect.saveDC!).length / 20;
}
export function prepareCondition(actor: Combatant, target: Combatant, effect: ConditionEffect, rng: Rng): { condition?: ActiveCondition; text: string } {
  const name = definitions.get(effect.conditionId)?.name ?? effect.conditionId;
  if (!conditionChance(target, effect)) return { text: `${target.name}：${conditionImmunity(target, effect.conditionId) ?? '已有同类效果或已离场'}，未追加${name}` };
  if (effect.saveDC !== undefined) {
    const roll = rng.d(20), total = roll + controlBonus(target);
    if (roll === 20 || roll !== 1 && total >= effect.saveDC) return { text: `${target.name} 抵抗${name}（${roll}+${controlBonus(target)}对抗${effect.saveDC}）` };
  }
  return { condition: { id: effect.conditionId, dur: effect.dur, sourceId: actor.id, ...(isCohort(target)&&target.scale!=='hero'&&definitions.get(effect.conditionId)?.dot?{affectedMembers:conditionExposure(actor,target,effect.shape==='burst')}:{}), ...(effect.potency !== undefined ? { potency: effect.potency } : {}), ...(effect.magnitude !== undefined ? { magnitude: effect.magnitude } : {}) }, text: `${target.name} 获得${name}，持续${effect.dur}次状态结算` };
}
export function applySkillCondition(target: Combatant, condition?: ActiveCondition): void {
  if (!condition || target.hp <= 0) return;
  const existing = target.conditions.find((c) => c.id === condition.id && c.dur > 0);
  if (!existing) target.conditions.push({ ...condition });
  else if (positive.has(condition.id)) {
    const stronger = (condition.potency ?? 2) * (condition.magnitude ?? 1) > (existing.potency ?? 2) * (existing.magnitude ?? 1);
    existing.dur = Math.max(existing.dur, condition.dur);
    if (condition.skipNextDecay) existing.skipNextDecay = true;
    if (stronger) { existing.potency = condition.potency; existing.magnitude = condition.magnitude; }
  }
}
export interface DispelCandidate { kind: 'condition' | 'source' | 'barrier'; id: string; name: string }
export function dispelCandidates(target: Combatant, effect: DispelEffect): DispelCandidate[] {
  const group = effect.polarity === 'positive' ? positive : negative;
  const conditions: DispelCandidate[] = [...new Set(target.conditions.filter((c) => c.dur > 0 && group.has(c.id)).map((c) => c.id))]
    .sort((a, b) => Number(['stunned', 'restrained'].includes(b)) - Number(['stunned', 'restrained'].includes(a)) || a.localeCompare(b))
    .map((id) => ({ kind: 'condition', id, name: definitions.get(id)?.name ?? id }));
  const sources: DispelCandidate[] = (target.traitSources ?? []).filter((s) => s.kind !== 'equipment' && traitSourceActive(target, s)
    && (effect.polarity === 'positive' && s.kind === 'blessing' || s.conditionIds?.some((id) => group.has(id))))
    .sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ kind: 'source', id: s.id, name: s.name }));
  return [...conditions, ...sources, ...(effect.polarity==='positive' && target.barrier ? [{kind:'barrier' as const,id:'barrier',name:'屏障'}] : [])].slice(0, effect.count);
}
export function applyDispel(target: Combatant, chosen: DispelCandidate[]): void {
  for (const entry of chosen) {
    if (entry.kind === 'barrier') delete target.barrier;
    else if (entry.kind === 'condition') target.conditions = target.conditions.filter((c) => c.id !== entry.id);
    else { const source = target.traitSources?.find((s) => s.id === entry.id); if (source) source.revoked = true; }
  }
}
export interface PushPreview { reason?: string; cell?: number; nodeId?: string; label?: string }
export function pushStrength(actor: Combatant, effect: PushEffect): number { return effect.physical ? Math.min(effect.force, bodyRank(actor) + 1) : effect.force; }
export function pushPreview(context: ObservationContext, actor: Combatant, target: Combatant, effect: PushEffect): PushPreview {
  if (target.hp <= 0 || target.status === 'dead' || target.status === 'fled') return { reason: '目标已离场' };
  if ([...(context.attached?.values() ?? [])].includes(target.id)) return { reason: '随队人物不能独立推离所属编队' };
  const force = pushStrength(actor, effect);
  if (bodyRank(target) + Number(!!target.tacticalPose) > force) return { reason: '目标体量或稳固姿态超过推力' };
  const source = positionedUnit(context, actor), unit = positionedUnit(context, target);
  const field = context.battlefield;
  const from = context.mode === 'mass' ? formationNode(source) : { x: field ? source.pos! % field.width : source.pos ?? 0, y: field ? Math.floor(source.pos! / field.width) : 0 };
  const to = context.mode === 'mass' ? formationNode(unit) : { x: field ? unit.pos! % field.width : unit.pos ?? 0, y: field ? Math.floor(unit.pos! / field.width) : 0 };
  const dx = to.x - from.x, dy = to.y - from.y;
  const step = Math.abs(dy) >= Math.abs(dx) ? { x: 0, y: Math.sign(dy) || (target.side === 'enemy' ? -1 : 1) } : { x: Math.sign(dx), y: 0 };
  if (effect.direction === 'towards') { step.x *= -1; step.y *= -1; }
  if (context.mode === 'mass') {
    const node = FORMATION_NODES.find((n) => n.x === to.x + step.x && n.y === to.y + step.y);
    if (!node || !formationCanOccupy(context.units, unit, node, context.attached ?? new Map())) return { reason: '推离位置受阻，不产生碰撞伤害' };
    return { nodeId: node.id, label: `${node.side === 'ally' ? '我方' : '敌方'}${node.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[node.rank]}` };
  }
  if (!field) return { reason: '位移技能需要二维战场' };
  const x = to.x + step.x, y = to.y + step.y, cell = y * field.width + x;
  if (x < 0 || x >= field.width || y < 0 || y >= field.height || !canOccupy(field, context.units, unit, cell)) return { reason: '推离位置受阻，不产生碰撞伤害' };
  return { cell, label: terrainCellLabel(field, cell, target) };
}
export function applyPush(context: ObservationContext, actor: Combatant, target: Combatant, effect: PushEffect): PushPreview {
  const result = pushPreview(context, actor, target, effect);
  if (result.reason) return result;
  if (result.cell !== undefined) target.pos = result.cell;
  if (result.nodeId) target.formationPosition = result.nodeId;
  delete target.tacticalPose; revealUnit(context, target); return result;
}
export function skillTraitReason(target: Combatant, effect: Extract<EffectOp, { op: 'trait' }>): string | undefined {
  const prerequisite = traitPrerequisiteReason(target, effect.traitId); if (prerequisite) return prerequisite;
  if (target.traits.includes(effect.traitId) || (target.traitSources ?? []).some((s) => traitSourceActive(target, s) && s.traitIds.includes(effect.traitId)
    && (s.duration.kind !== 'rounds' || (s.remaining ?? 0) >= effect.dur))) return '已有同等或更持久的能力来源';
  return undefined;
}
export function applySkillTrait(actor: Combatant, target: Combatant, ability: Ability, effect: Extract<EffectOp, { op: 'trait' }>, castId: string): string {
  const reason = skillTraitReason(target, effect), name = traitRegistry().get(effect.traitId)!.name;
  if (reason) return `${target.name}：${reason}`;
  grantTraitSource(target, { id: 'skill:' + castId + ':' + actor.id + ':' + ability.id + ':' + effect.traitId, name: ability.name,
    kind: 'blessing', traitIds: [effect.traitId], duration: { kind: 'rounds', count: effect.dur }, battleOnly: true });
  return `${target.name} 获得${name}，至多${effect.dur}轮，战斗归档时结束`;
}
export function skillEffectLines(context: ObservationContext, actor: Combatant, target: Combatant, ability: Ability): string[] {
  return ability.effects.flatMap((effect) => {
    if (effect.op === 'zone') return [zoneEffectDescription(effect)];
    if (effect.op === 'barrier') return [`屏障最多吸收${effect.amount}点伤害，持续${effect.dur}轮；重复施放取较强保护`];
    if (effect.op === 'trait') return [skillTraitReason(target, effect) ?? `${traitRegistry().get(effect.traitId)?.name}持续${effect.dur}轮，战斗归档时结束`];
    if (effect.op === 'resource') return [`${effect.resource==='SP'?'精力':effect.resource}变化${skillResourceChange(target, effect)}，受当前资源与上限约束`];
    if (effect.op === 'damage' && ability.areaExposure && target.scale !== 'hero') return [isCohort(actor)?'范围伤害按参战规模与成员耐久折算；疏散可减轻伤害':`每编队至多${Math.min(target.hp, ability.areaExposure)}名成员暴露；疏散可减轻范围伤害`];
    if (effect.op === 'condition') return [`${effect.onDamage ? '造成损伤后' : effect.onHit ? '命中后' : ''}${definitions.get(effect.conditionId)?.name ?? effect.conditionId}：${skillConditionDescription(effect, target)}；${Math.round(conditionChance(target, effect) * 100)}%生效机会，持续${effect.dur}次状态结算${effect.magnitude !== undefined ? '（效力' + Math.round(effect.magnitude * 100) + '%）' : ''}`];
    if (effect.op === 'push') { const pushed = pushPreview(context, actor, target, effect); return [(effect.onHit ? '命中后' : '') + (pushed.reason ?? (effect.direction === 'towards' ? '拉至' : '推至') + pushed.label)]; }
    if (effect.op === 'dispel') { const entries = dispelCandidates(target, effect); return [entries.length ? '解除' + entries.map((e) => e.name).join('、') : '没有可解除的效果']; }
    return [];
  });
}
export function skillEffectValue(context: ObservationContext, actor: Combatant, target: Combatant, ability: Ability, hitChance = 1, damageChance = hitChance): number {
  const resources = { ...target.resources };
  if (target.id === actor.id && ability.cost) resources[ability.cost.resource] = Math.max(0, (resources[ability.cost.resource] ?? 0) - ability.cost.amount);
  const polarity = target.side === actor.side ? 1 : -1;
  // 对同一目标一起估值。眩晕已阻止的攻击，不再重复计作缴械/沉默收益。
  // 至多保留16种成功组合；极端自定义多状态技能舍弃低概率分支，保守估值。
  let controlValue = 0;
  const controls = ability.effects.filter((e): e is ConditionEffect => e.op === 'condition');
  if (target.combatModel !== 'cohort-v2') controlValue = controls.reduce((sum, effect) => sum + conditionChance(target, effect) * (effect.onDamage ? damageChance : effect.onHit ? hitChance : 1) * (['restrained','stunned'].includes(effect.conditionId) ? 5 : 2) * (effect.potency ?? 1), 0);
  else if (controls.length) for (const horizon of [0, 1]) {
    if (horizon && controls.every(e => e.dur <= 1)) continue;
    const initial = { ...target, conditions: target.conditions.map(c => ({ ...c, dur: c.dur - horizon })).filter(c => c.dur > 0) };
    const before = tacticalStateValue(context, initial);
    let branches = [{ unit: initial, probability: 1 }];
    for (const effect of controls.filter(e => e.dur > horizon)) {
      branches = branches.flatMap(branch => {
        const chance = conditionChance(branch.unit, effect) * (effect.onDamage ? damageChance : effect.onHit ? hitChance : 1);
        if (!chance) return [branch];
        const future = { ...branch.unit, conditions: branch.unit.conditions.map(c => ({ ...c })) };
        applySkillCondition(future, { id: effect.conditionId, dur: effect.dur - horizon, potency: effect.potency, magnitude: effect.magnitude,
          ...(isCohort(target) && target.scale !== 'hero' && definitions.get(effect.conditionId)?.dot ? { affectedMembers: conditionExposure(actor, target, effect.shape === 'burst') } : {}) });
        return [{ unit: branch.unit, probability: branch.probability * (1 - chance) }, { unit: future, probability: branch.probability * chance }].filter(b => b.probability > 0);
      }).sort((a, b) => b.probability - a.probability).slice(0, 16);
    }
    controlValue += branches.reduce((sum, b) => sum + b.probability * (tacticalStateValue(context, b.unit) - before), 0) * polarity * (horizon ? 0.5 : 1);
  }
  return ability.effects.reduce((sum, effect) => {
    if (effect.op === 'zone') { const friendly=target.side===actor.side; return sum+(effect.kind==='smoke'?2*effect.dur/3:effect.kind==='healing'?(friendly?Math.min(recoveryCapacity(target),zoneAmount(effect)):0):friendly?effect.kind==='trap'?0:-8:(4+effect.power)*zoneAmount(effect)/(4+effect.power*3)); }
    if (effect.op === 'barrier') return sum + Math.min(Math.max(0, effect.amount - (target.barrier?.remaining ?? 0)), incomingPotential(context, target)) * polarity;
    if (effect.op === 'trait') return sum + (skillTraitReason(target, effect) ? 0 : 3 + Math.min(3, effect.dur / 3));
    if (effect.op === 'resource') {
      const before = { ...target, resources: { ...resources } };
      const change = skillResourceChange({ ...target, resources }, effect);
      resources[effect.resource] = (resources[effect.resource] ?? 0) + change;
      const unlocked = change ? actionPotential(context, { ...target, resources: { ...resources } }) - actionPotential(context, before) : 0;
      return sum + (change * 1.5 + unlocked * 0.75) * polarity;
    }
    if (effect.op === 'push') return sum + (pushPreview(context, actor, target, effect).reason ? 0 : 3 * (effect.onHit ? hitChance : 1));
    if (effect.op === 'dispel') {
      const chosen = dispelCandidates(target, effect); if (!chosen.length) return sum;
      const future = { ...target, conditions: target.conditions.map(c => ({ ...c })), traitSources: target.traitSources?.map(s => ({ ...s })) };
      applyDispel(future, chosen);
      return sum + (tacticalStateValue(context, future) - tacticalStateValue(context, target)) * polarity;
    }
    return sum;
  }, controlValue);
}
