import { displayNumber } from './display-number.js';
import { progression } from './progression.js';
import { armorTransmission } from './power-anchors.js';
import { combatHostile, combatSide } from './battle-control.js';
import { ACTIVATION_CONTROLS } from './battle-control.js';
import { phase2Value } from './phase2-traits.js';
import { resolveHealingBudget } from './healing.js';
import { abilityCost } from './resources.js';
import { flightCapabilityReason, isAirborne } from './aerial.js';
import { prepareCombatModel } from './combat-model.js';
import { memberHealth,hasMemberHealth } from './member-health.js';
import { recoveryCapacity, regenerationAmount,applyCombatDamage } from './recovery.js';
import { unitHeight,surfaceHeightAt } from './small/height-map.js';
import { zoneAmount, zonePenetration, zoneEffectDescription } from './zone-skills.js';
import type { Ability, ActiveCondition, Combatant, EffectOp } from './types.js';
import type { Rng } from './rng.js';
import { activeTraitIds, bodyRank, traitSourceActive, grantTraitSource, traitPrerequisiteReason, effectiveTraitLevel } from './trait-sources.js';
import { traitLevelsV16, gradedTraitEnabled, prepareTraitLevelModel, phase2Traits } from './trait-level-model.js';
import { canonicalTraitId, sourceTraitLevel } from './trait-parameters.js';
import { traitsV13 } from './trait-model.js';
import { canEntrench, entrench, entrenched } from './entrenchment.js';
import { traitRegistry, validTraitLevel } from './data/traits.js';
import { skillResourceChange, summonProfile, conjureSkillUnit, summonedMemberLife } from './skill-runtime.js';
import { standardConditionMap } from './conditions.js';
import { conditionMods, collectMods, resolveStack } from './bonus.js';
import { poisonFactor, conditionExposure } from './afflictions.js';
import { isCohort, personnel } from './combat-model.js';
import { isArmsV2 } from './arms-model.js';
import { positionedUnit, revealUnit, type ObservationContext } from './observation.js';
import { canOccupy, terrainCellLabel } from './small/spatial.js';
import { formationNode, FORMATION_NODES, formationCanOccupy } from './mass/formation.js';
import { actionPotential, incomingPotential, tacticalStateValue } from './skill-tactics.js';
import { grantBarrier, barrierGradeMultiplier } from './barrier.js';
import { moveEffectDescription } from './skill-movement.js';
import { moraleChangePreview } from './morale.js';

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
  if (def?.preventAttack) details.push('不能用手持武器攻击');
  if (def?.skipTurn) details.push('跳过行动');
  if (def?.dot) details.push('受到持续' + (def.dot.label ?? def.name) + '，按当前战斗规则结算');
  if (effect.conditionId === 'hasted') details.push('移动点 +1；每轮额外1次非技能动作，额外攻击按半次普通攻击预算随效力折算，同类不叠加');
  if (effect.conditionId === 'slowed') details.push('移动点 -1（最低1），会战不能冲锋');
  if (['empowered', 'weakened', 'vulnerable', 'blessed'].includes(effect.conditionId)) details.push('仅修正可造成的伤害，不绕过防护');
  if (effect.conditionId === 'blessed' && phase2Traits(target)) details.push('旧版祝福效果，保留原减伤与期限');
  if (effect.conditionId === 'blessed' && effect.defensePower !== undefined) details.push(`防御规格L${effect.defensePower}`);
  return details.join('、') || def?.desc || effect.conditionId;
}
const positive = new Set(['empowered', 'inspired', 'blessed', 'encouraged', 'confident', 'hasted']);
export function isPositiveCondition(id: string): boolean { return positive.has(id); }
const negative = new Set(['taunted','charmed','blinded','confused','inaccurate', 'exposed', 'poisoned', 'bleeding', 'burning', 'silenced', 'stunned', 'restrained', 'disarmed', 'fearful', 'slowed', 'cursed', 'demoralized', 'weakened', 'vulnerable', 'wounded']);
export function conditionImmunity(target: Combatant, id: string): string | undefined {
  if (id === 'charmed' && target.scale !== 'hero' && !isArmsV2(target.armsModel)) return '魅惑首版仅支持未随队独立个体，不支持编队';
  if (id === 'poisoned' && !poisonFactor(target)) return target.body === 'vehicle' ? '封闭车体免疫中毒' : '非生物免疫中毒';
  if (id === 'fearful' && activeTraitIds(target).includes('steadfast')) return '不溃抵抗惊惧';
  if (['bleeding', 'fearful'].includes(id) && target.rulesVersion === 'v2' && activeTraitIds(target).includes('inorganic')) return '非生物免疫' + (id === 'bleeding' ? '流血' : '惊惧');
  return undefined;
}
/** 坚韧只帮助抵抗这些控制效果；伤害、中毒与士气照常。 */
const CONTROL_CONDITIONS = new Set(['taunted','charmed','blinded','confused','stunned', 'restrained', 'silenced', 'disarmed', 'slowed', 'fearful']);
export function controlBonus(target: Combatant, conditionId?: string): number {
  const tenacity = conditionId && CONTROL_CONDITIONS.has(conditionId) && target.rulesVersion === 'v2' && activeTraitIds(target).includes('tenacity') ? phase2Value(target, 'tenacity', 'controlResistance', 4) : 0;
  // R25 人多难迷：编队现员每翻一倍，抵抗魅惑+1。
  const crowd = conditionId === 'charmed' && target.scale !== 'hero' && isArmsV2(target.armsModel) ? Math.floor(Math.log2(Math.max(1, personnel(target)))) : 0;
  return Math.floor(target.level / 2) + bodyRank(target) - 1 + tenacity + crowd;
}
export function conditionChance(target: Combatant, effect: ConditionEffect): number {
  if (target.hp <= 0 || ['dead', 'fled'].includes(target.status) || conditionImmunity(target, effect.conditionId)) return 0;
  if (effect.saveDC === undefined) {
    if (positive.has(effect.conditionId)) {
      const same = target.conditions.filter((c) => c.id === effect.conditionId && c.dur >= effect.dur && (c.defensePower ?? 0) >= (effect.defensePower ?? 0)).map((c) => (c.potency ?? 2) * (c.magnitude ?? 1));
      if (!effect.defensePower && (target.traitSources ?? []).some((s) => traitSourceActive(target, s) && s.conditionIds?.includes(effect.conditionId))) same.push(2);
      if (same.some((value) => value >= (effect.potency ?? 2) * (effect.magnitude ?? 1))) return 0;
    }
    return 1;
  }
  if (target.conditions.some((c) => c.id === effect.conditionId && c.dur > 0)) return 0;
  return Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => n === 1 || n !== 20 && n + controlBonus(target, effect.conditionId) < effect.saveDC!).length / 20;
}
export function prepareCondition(actor: Combatant, target: Combatant, effect: ConditionEffect, rng: Rng, units: readonly Combatant[] = [actor,target]): { condition?: ActiveCondition; text: string } {
  const name = definitions.get(effect.conditionId)?.name ?? effect.conditionId;
  if (!conditionChance(target, effect)) return { text: `${target.name}：${conditionImmunity(target, effect.conditionId) ?? '已有同类效果或已离场'}，未追加${name}` };
  if (effect.saveDC !== undefined) {
    const bonus = controlBonus(target, effect.conditionId), roll = rng.d(20), total = roll + bonus;
    if (roll === 20 || roll !== 1 && total >= effect.saveDC) return { text: `${target.name} 抵抗${name}（${roll}+${displayNumber(bonus)}对抗${displayNumber(effect.saveDC)}）` };
  }
  return { condition: { id: effect.conditionId, dur: effect.dur, sourceId: actor.id, ...(effect.damageChannel ? {damageChannel:effect.damageChannel} : {}), ...(ACTIVATION_CONTROLS.has(effect.conditionId) && phase2Traits(target) ? { controlPending: true, ...(effect.conditionId === 'charmed' ? { controlSide: combatSide(actor,units) } : {}) } : {}), ...(effect.conditionId === 'blessed' && effect.defensePower !== undefined ? { defensePower: effect.defensePower } : {}), ...(isCohort(target)&&target.scale!=='hero'&&definitions.get(effect.conditionId)?.dot?{affectedMembers:conditionExposure(actor,target,effect.shape==='burst')}:{}), ...(effect.potency !== undefined ? { potency: effect.potency } : {}), ...(effect.magnitude !== undefined ? { magnitude: effect.magnitude } : {}) }, text: `${target.name} 获得${name}，持续${effect.dur}次状态结算` };
}
export function applySkillCondition(target: Combatant, condition?: ActiveCondition): void {
  if (!condition || target.hp <= 0) return;
  // 不同规格各自到期；低阶长效守护不能延长高阶短效守护。
  const existing = target.conditions.find((c) => c.id === condition.id && c.dur > 0 && c.defensePower === condition.defensePower
    && (!phase2Traits(target) || !positive.has(condition.id) || c.sourceId === condition.sourceId && c.potency === condition.potency && c.magnitude === condition.magnitude));
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
    .map((id) => ({ kind: 'condition', id, name: (definitions.get(id)?.name ?? id) + (phase2Traits(target) ? '（一次移除此类全部来源）' : '') }));
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
export interface PushPreview { reason?: string; cell?: number; nodeId?: string; label?: string;fallDamage?:number;groundLanding?:boolean }
export function pushStrength(actor: Combatant, effect: PushEffect): number { return effect.physical ? Math.min(effect.force, bodyRank(actor) + 1) : effect.force; }
export function pushPreview(context: ObservationContext, actor: Combatant, target: Combatant, effect: PushEffect): PushPreview {
  if (target.hp <= 0 || target.status === 'dead' || target.status === 'fled') return { reason: '目标已离场' };
  if ([...(context.attached?.values() ?? [])].includes(target.id)) return { reason: '随队人物不能独立推离所属编队' };
  const force = pushStrength(actor, effect);
  if (target.rulesVersion === 'v2' && activeTraitIds(target).includes('tenacity') && force <= phase2Value(target, 'tenacity', 'pushLimit', 99)) return { reason: '坚韧，不受击退或拉拽' };
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
    if (!node || !formationCanOccupy(context.units, unit, node, context.attached ?? new Map(), context.formationSlots ?? 3)) return { reason: '推离位置受阻，不产生碰撞伤害' };
    return { nodeId: node.id, label: `${node.side === 'ally' ? '我方' : '敌方'}${node.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[node.rank]}` };
  }
  if (!field) return { reason: '位移技能需要二维战场' };
  const x = to.x + step.x, y = to.y + step.y, cell = y * field.width + x;
  const groundLanding=field.spatialRulesVersion===2&&!isAirborne(unit)&&unit.elevation===1&&!field.structures?.[cell]?.top;
  const landing=groundLanding?{...unit,elevation:undefined}:unit;
  if (x < 0 || x >= field.width || y < 0 || y >= field.height || !canOccupy(field, context.units, landing, cell)) return { reason: '推离位置受阻，不产生碰撞伤害' };
  const drop=field.spatialRulesVersion===2&&!isAirborne(unit)?unitHeight(field,unit)-surfaceHeightAt(field,cell,landing):0;
  if(drop< -1)return {reason:'高差阻断推拉，无法把目标推上陡台'};
  const fallDamage=drop>1?Math.max(1,Math.round(memberHealth(target)*Math.min(.3,.1*drop))):undefined;
  return { cell, label: terrainCellLabel(field, cell, landing)+(fallDamage?` · 坠落伤害${displayNumber(fallDamage)}生命`:''),...(fallDamage?{fallDamage}:{}),...(groundLanding?{groundLanding:true}:{}) };
}
export function applyPush(context: ObservationContext, actor: Combatant, target: Combatant, effect: PushEffect): PushPreview {
  const result = pushPreview(context, actor, target, effect);
  if (result.reason) return result;
  if (result.cell !== undefined) target.pos = result.cell;
  if(result.groundLanding)delete target.elevation;
  if(result.fallDamage)applyCombatDamage(target,result.fallDamage,hasMemberHealth(target)?target.hp:1);
  if (result.nodeId) target.formationPosition = result.nodeId;
  delete target.tacticalPose; revealUnit(context, target); return result;
}
/** 授予等级与持续期独立；执行、可用性、说明和 AI 共用。旧强 id 只在 V16 投影。 */
export function skillTraitGrant(target: Combatant, ability: Pick<Ability, 'power'>, effect: Extract<EffectOp, { op: 'trait' }>): { id: string; level?: number } {
  const modern = traitLevelsV16(target), id = modern ? canonicalTraitId(effect.traitId, phase2Traits(target)) : effect.traitId;
  const level = gradedTraitEnabled(target, id) ? effect.level ?? sourceTraitLevel(effect.traitId, validTraitLevel(ability.power) ? ability.power : modern ? 1 : 5) : undefined;
  return { id, ...(level === undefined ? {} : { level }) };
}
export function skillTraitReason(target: Combatant, effect: Extract<EffectOp, { op: 'trait' }>, ability: Pick<Ability, 'power'> = {}): string | undefined {
  const prerequisite = traitPrerequisiteReason(target, effect.traitId); if (prerequisite) return prerequisite;
  // V13 工事是阵地：已有工事但离开了阵地时，可以在新位置重新构筑。
  if (effect.traitId === 'fortification' && traitsV13(target) && !entrenched(target) && canEntrench(target)) return undefined;
  const grant = skillTraitGrant(target, ability, effect);
  if (traitLevelsV16(target) && gradedTraitEnabled(target, grant.id)) {
    for (let round = 0; round < effect.dur; round++) if (effectiveTraitLevel(target, grant.id, undefined, round) < grant.level!) return undefined;
    return '已有同等或更强且覆盖整个持续期的能力来源';
  }
  if (target.traits.includes(effect.traitId) || (target.traitSources ?? []).some((s) => traitSourceActive(target, s) && s.traitIds.includes(effect.traitId)
    && (s.duration.kind !== 'rounds' || (s.remaining ?? 0) >= effect.dur))) return '已有同等或更持久的能力来源';
  return undefined;
}
export function applySkillTrait(actor: Combatant, target: Combatant, ability: Ability, effect: Extract<EffectOp, { op: 'trait' }>, castId: string): string {
  const reason = skillTraitReason(target, effect, ability), grant = skillTraitGrant(target, ability, effect), name = traitRegistry().get(grant.id)!.name;
  if (reason) return `${target.name}：${reason}`;
  // 授予专精时按技能或道具自身的等级定级；只在 V15 记录，旧规则一律按 L5，快照也保持原样。
  const level = grant.level;
  const sourceId = 'skill:' + castId + ':' + actor.id + ':' + ability.id + ':' + effect.traitId;
  const replay = target.traitSources?.some(s => s.id === sourceId);
  grantTraitSource(target, { id: sourceId, name: ability.name,
    kind: 'blessing', traitIds: [grant.id], duration: { kind: 'rounds', count: effect.dur }, battleOnly: true, ...(level !== undefined ? { traitLevels: { [grant.id]: level } } : {}) });
  if (replay && traitLevelsV16(target)) return `${target.name}：该来源已处理，不重复授予或重建`;
  if (effect.traitId === 'fortification') entrench(target, target.pos !== undefined ? 'small' : 'mass');
  return `${target.name} 获得${name}${level === undefined ? '' : 'L' + level}，至多${effect.dur}轮，战斗归档时结束`;
}
export function skillEffectLines(context: ObservationContext, actor: Combatant, target: Combatant, ability: Ability): string[] {
  return ability.effects.flatMap((effect) => {
    if (effect.op === 'summon') {
      const p = summonProfile(effect.templateId, context.mode, ability.bonuses);
      return p ? [`召唤${p.group ? `一支${p.members}人编队` : '一个个体'}（L${p.power}，${p.range > 1 ? '远程距离' + p.range : '近战'}），下轮行动`] : [];
    }
    if (effect.op === 'zone') return [zoneEffectDescription(effect)];
    // 突进、闪现的落点由预览单独写出；这里只补出手后的后撤。
    if (effect.op === 'move') return effect.mode === 'withdraw' ? [moveEffectDescription(effect, ability)] : [];
    if (effect.op === 'barrier') { const grade = barrierGradeMultiplier(target, effect.defensePower ?? ability.power); return [`屏障吸收${displayNumber(Math.max(1, Math.round(effect.amount * grade)))}点伤害，持续${effect.dur}轮`]; }
    if (effect.op === 'trait') { const grant = skillTraitGrant(target, ability, effect); return [skillTraitReason(target, effect, ability) ?? `获得${traitRegistry().get(grant.id)?.name}${grant.level === undefined ? '' : 'L' + grant.level}，持续${effect.dur}轮`]; }
    if (effect.op === 'resource') return [`${effect.resource==='SP'?'精力':effect.resource}${displayNumber(skillResourceChange(target, effect))}`];
    if (effect.op === 'condition') return [`${effect.onDamage ? '造成损伤后' : effect.onHit ? '命中后' : ''}${definitions.get(effect.conditionId)?.name ?? effect.conditionId}：${skillConditionDescription(effect, target)}，${Math.round(conditionChance(target, effect) * 100)}%生效，${effect.dur}轮`];
    if (effect.op === 'push') { const pushed = pushPreview(context, actor, target, effect); return [(effect.onHit ? '命中后' : '') + (pushed.reason ?? (effect.direction === 'towards' ? '拉至' : '推至') + pushed.label)]; }
    if (effect.op === 'dispel') { const entries = dispelCandidates(target, effect); return [entries.length ? '解除' + entries.map((e) => e.name).join('、') : '没有可解除的效果']; }
    return [];
  });
}
/** 远期逐轮折扣并受可见生存压力限制；不增加逐轮搜索次数。 */
function futureWeight(context: ObservationContext, target: Combatant, duration: number, from = 0): number {
  const pressure = incomingPotential(context, target) / Math.max(1, memberHealth(target));
  const discount = 0.65 * Math.max(0.25, 1 - pressure * 0.5);
  let value = 0; for (let n = from; n < Math.min(10, duration); n++) value += Math.pow(discount, n);
  return value;
}
export function summonValue(context: ObservationContext, actor: Combatant, ability: Ability, effect: Extract<EffectOp, { op: 'summon' }>): number {
  const unit = conjureSkillUnit(effect.templateId, actor.side, 'preview-summon:' + actor.id, context.mode, ability.bonuses, actor.damageModel, actor.numericModel);
  // 外部召唤模板没有只读规格，保留既有保守估值，不能为评分调用生成回调。
  if (!unit) return 8 * effect.count;
  if (!context.rules) return 0;
  prepareCombatModel(unit, context.rules, summonedMemberLife(unit));
  prepareTraitLevelModel(unit, context.rules);
  unit.pos = actor.pos; unit.formationPosition = actor.formationPosition;
  const world = { ...context, units: [...context.units, unit] };
  return (actionPotential(world, unit) * 1.25 + memberHealth(unit) * 0.15) * effect.count;
}
export function skillEffectValue(context: ObservationContext, actor: Combatant, target: Combatant, ability: Ability, hitChance = 1, damageChance = hitChance): number {
  const resources = { ...target.resources };
  const cost = abilityCost(actor, ability);
  if (target.id === actor.id && cost) resources[cost.resource] = Math.max(0, (resources[cost.resource] ?? 0) - cost.amount);
  const polarity = combatHostile(actor, target, context.units) ? -1 : 1;
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
        applySkillCondition(future, { id: effect.conditionId, dur: effect.dur - horizon, sourceId:actor.id, ...(effect.conditionId === 'charmed' ? { controlSide: combatSide(actor, context.units) } : {}), potency: effect.potency, magnitude: effect.magnitude, defensePower: effect.defensePower,
          ...(isCohort(target) && target.scale !== 'hero' && definitions.get(effect.conditionId)?.dot ? { affectedMembers: conditionExposure(actor, target, effect.shape === 'burst') } : {}) });
        return [{ unit: branch.unit, probability: branch.probability * (1 - chance) }, { unit: future, probability: branch.probability * chance }].filter(b => b.probability > 0);
      }).sort((a, b) => b.probability - a.probability).slice(0, 16);
    }
    const duration = horizon ? Math.min(...controls.filter(e => e.dur > 1).map(e => e.dur)) : 1;
    controlValue += branches.reduce((sum, b) => sum + b.probability * (tacticalStateValue(context, b.unit) - before) * (horizon ? futureWeight(context, b.unit, duration, 1) : 1), 0) * polarity;
  }
  return ability.effects.reduce((sum, effect) => {
    if (effect.op === 'zone') {
      const friendly=target.side===actor.side, ctx={damageChannel:effect.kind==='poison'?undefined:effect.kind==='fire'?'thermal' as const:'kinetic' as const,attacker:target,defender:actor,area:true,engaged:target.engagedWith.length>0};
      const ward=progression(target)?resolveStack(collectMods(target,ctx,definitions,[],context.traitRegistry ?? traitRegistry()),'ward',ctx).multTotal:1;
      const transmission=progression(target)?effect.kind==='poison'?poisonFactor(target):armorTransmission(target,effect.kind==='fire'?'thermal':'kinetic',zonePenetration(effect)):1;
      return sum+(effect.kind==='smoke'?2*effect.dur/3:effect.kind==='healing'?(friendly?Math.min(recoveryCapacity(target),effect.healingModel ? resolveHealingBudget({ source: actor, target, power: effect.power, baseAmount: zoneAmount(effect), delivery: 'zone', recoveryModel: effect.itemEffectModel ? undefined : context.rules?.recoveryModel ?? actor.recoveryModel, rules: context.rules }) : zoneAmount(effect)):0):friendly?effect.kind==='trap'?0:-8*ward*transmission:(4+effect.power)*zoneAmount(effect)/(4+effect.power*3)*ward*transmission); }
    if (effect.op === 'barrier') {
      if (context.rules?.overmatch && (effect.defensePower ?? ability.power)) {
        const future = structuredClone(target); grantBarrier(future, effect.amount, effect.dur, actor.id, effect.defensePower ?? ability.power);
        return sum + Math.max(0, tacticalStateValue(context, future) - tacticalStateValue(context, target)) * polarity;
      }
      return sum + Math.min(Math.max(0, Math.max(1, Math.round(effect.amount * barrierGradeMultiplier(target, effect.defensePower ?? ability.power))) - (target.barrier?.remaining ?? 0)), incomingPotential(context, target)) * polarity;
    }
    if (effect.op === 'trait') {
      if (skillTraitReason(target, effect, ability)) return sum;
      // 在其他来源到期的各个分段评估，短高长低的后续收益不能在当前轮被吞掉。
      const grant = skillTraitGrant(target, ability, effect);
      if (traitLevelsV16(target) && gradedTraitEnabled(target, grant.id)) {
        const boundaries = [...new Set([0, ...(target.traitSources ?? []).filter(s => traitSourceActive(target, s) && s.duration.kind === 'rounds' && s.remaining! < effect.dur).map(s => s.remaining!), effect.dur])].sort((a, b) => a - b);
        let value = 0;
        for (let i = 0; i < boundaries.length - 1; i++) {
          const from = boundaries[i]!, until = boundaries[i + 1]!;
          const before = structuredClone(target);
          for (const source of before.traitSources ?? []) if (source.duration.kind === 'rounds') source.remaining = Math.max(0, source.remaining! - from);
          const future = structuredClone(before);
          grantTraitSource(future, { id: 'preview:' + effect.traitId, name: ability.name, kind: 'blessing', traitIds: [grant.id], traitLevels: { [grant.id]: grant.level! }, duration: { kind: 'rounds', count: effect.dur - from }, battleOnly: true });
          const beforeWorld = { ...context, units: context.units.map(u => u.id === before.id ? before : u) }, afterWorld = { ...context, units: context.units.map(u => u.id === future.id ? future : u) };
          let difference = tacticalStateValue(afterWorld, future) - tacticalStateValue(beforeWorld, before);
          if (grant.id === 'commander') for (const ally of context.units.filter(u => u.side === target.side && u.id !== target.id)) {
            const prior = moraleChangePreview(beforeWorld, ally, 0, context.rules?.morale.breakAt ?? 25, context.traitRegistry);
            const after = moraleChangePreview(afterWorld, ally, 0, context.rules?.morale.breakAt ?? 25, context.traitRegistry);
            difference += (after.moraleBefore - prior.moraleBefore) / 3 + (prior.breakChance - after.breakChance) * 10;
          }
          value += Math.max(0, difference * polarity) * futureWeight(context, future, until, from);
        }
        return sum + value;
      }
      const future = structuredClone(target);
      grantTraitSource(future, { id: 'preview:' + effect.traitId, name: ability.name, kind: 'blessing', traitIds: [grant.id], duration: { kind: 'rounds', count: effect.dur }, battleOnly: true });
      if (traitLevelsV16(target) && effect.traitId === 'fortification') entrench(future, future.pos !== undefined ? 'small' : 'mass');
      const regeneration = Math.min(recoveryCapacity(target), Math.max(0, regenerationAmount(future, context.traitRegistry) - regenerationAmount(target, context.traitRegistry)));
      let futureValue = tacticalStateValue(context, future);
      if (!isAirborne(target) && flightCapabilityReason(target, context.conditions) && !flightCapabilityReason(future, context.conditions)) {
        const flying = { ...future, airborne: true };
        futureValue += Math.max(0, tacticalStateValue(context, flying) - futureValue) * 0.65;
      }
      const difference = (regeneration + futureValue - tacticalStateValue(context, target)) * polarity;
      return sum + Math.max(0, difference) * futureWeight(context, future, effect.dur);
    }
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
