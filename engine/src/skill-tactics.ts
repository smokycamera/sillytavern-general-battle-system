import { conditionDamage } from './afflictions.js';
import { attackHostile, combatHostile, combatSide, controlPolicy, controlActionReason, controlCondition } from './battle-control.js';
import { hasteMagnitude, hasteAttackScale } from './haste.js';
import { V6_D20, V6_TW } from './rules.js';
import type { Combatant, ConditionDef, Weapon } from './types.js';
import type { ObservationContext } from './observation.js';
import { positionedUnit, canSpot, concealedUnit } from './observation.js';
import { previewAttack, previewScopeEpoch } from './damage.js';
import { standardConditionMap } from './conditions.js';
import { V4_D20, V4_TW, V5_D20, V5_TW } from './rules.js';
import { abilityTargetReason, abilityUsabilityReason, averageDice, weaponTargetReason } from './actions.js';
import { isRangedWeapon, weaponReloadKey } from './loadout.js';
import { skillWeapon } from './skill-runtime.js';
import { skillAttack } from './skill-attack.js';
import { gridWeapon } from './small/weapon-range.js';
import { gridAbility } from './small/skill-range.js';
import { heightDefense, standingTerrain } from './small/height-map.js';
import { gridDistance, reachableGridPaths, canOccupy, tileCost, meleeLineBlocker, unitLineOfSight } from './small/spatial.js';
import { formationDistance, formationNode, formationScreened, formationShotReason } from './mass/formation.js';
import { rangedScreen } from './guard-screen.js';
import { engagementWidth, sharedParticipants } from './exposure.js';
import { sameLayer } from './aerial.js';
import { movementPoints } from './tactics.js';
import { recoveryCapacity, lifestealAmount } from './recovery.js';
import { healingYield } from './combat-model.js';
import { memberHealth } from './member-health.js';
import { moraleRisk, moraleAttackMods } from './morale.js';
import { traitLevelsV16 } from './trait-level-model.js';
import { situationalTraitMods } from './situational-traits.js';
import { activeTraitIds } from './trait-sources.js';
import { meleeReach } from './melee.js';

const defaults = standardConditionMap();
const caches = new WeakMap<ObservationContext, WeakMap<Combatant, Map<Combatant | undefined, number>>>();
const extraCaches = new WeakMap<ObservationContext, WeakMap<Combatant, Map<Combatant | undefined, number>>>();
// 可达落点只取决于观测上下文与行动单位，与估值目标无关；同一估值上下文内复用。
const reachableCaches = new WeakMap<ObservationContext, WeakMap<Combatant, (number | undefined)[]>>();
const traitCacheStates = new WeakMap<ObservationContext, string>();
/** V16 来源/等级可在同一面板上下文内改变；身份缓存不能把旧等级继续当成现状。 */
function refreshTraitCaches(context: ObservationContext): void {
  if (context.rules?.traitLevelModel !== 'traits-levels-v1' && !context.units.some(traitLevelsV16)) return;
  const state = JSON.stringify([context.rules?.traitLevelModel, context.units.map(u => [u.id, u.traits, u.traitLevels, u.traitSources,
    u.gear?.map(g => [g.id, g.passive]), u.accessories, u.weapon?.id, u.armor?.id, u.shield?.id, u.traitLevelModel, u.itemModel, u.healingModel, u.level, u.hp, u.formation, u.recoverableWounded, u.conditions, u.abilities, u.resources])]);
  if (traitCacheStates.get(context) === state) return;
  traitCacheStates.set(context, state); caches.delete(context); extraCaches.delete(context); reachableCaches.delete(context);
}
// Within one read-only AI evaluation the condition source does not change; reuse its merged table.
const scopedDefinitions = new WeakMap<object, { epoch: number; defs: Map<string, ConditionDef> }>();
function definitionTable(context: ObservationContext): Map<string, ConditionDef> {
  const epoch = previewScopeEpoch(), owner = context.conditions ?? defaults, cached = scopedDefinitions.get(owner);
  if (epoch !== undefined && cached?.epoch === epoch) return cached.defs;
  const defs = new Map([...defaults].map(([id, def]) => [id, context.conditions?.get(id) ?? def]));
  if (epoch !== undefined) scopedDefinitions.set(owner, { epoch, defs });
  return defs;
}
const alive = (u: Combatant) => u.hp > 0 && !['dead', 'fled'].includes(u.status);
function flags(context: ObservationContext, unit: Combatant) {
  return unit.conditions.filter(c => c.dur > 0).map(c => (context.conditions ?? defaults).get(c.id));
}
function distance(context: ObservationContext, a: Combatant, b: Combatant) {
  return context.mode === 'mass' ? formationDistance(a, b) : context.battlefield
    ? gridDistance(context.battlefield, a.pos!, b.pos!) : Math.abs((a.pos ?? 0) - (b.pos ?? 0));
}
/** 等同于按（距目标、格号）稳定排序后取首项；每格只量一次，不为每次比较复制整名单位。 */
function nearestCell(context: ObservationContext, origin: Combatant, cells: (number | undefined)[], foe: Combatant) {
  let best: number | undefined, bestDistance = 0;
  cells.forEach((cell, index) => {
    const away = context.mode !== 'mass' && context.battlefield ? gridDistance(context.battlefield, cell!, foe.pos!) : distance(context, { ...origin, pos: cell }, foe);
    if (!index || ((away - bestDistance) || (cell ?? 0) - (best ?? 0)) < 0) { best = cell; bestDistance = away; }
  });
  return best;
}

/** 一次合法行动的可兑现生命收益；不推演敌军军令，不消耗随机数。
 * 小队可先移动后行动；会战调动另占军令，故只计算当前阵位。
 * 治疗算真实伤口，沉默/缴械之后仍保留另一种攻击及天生武器。
 */
export function actionPotential(context: ObservationContext, source: Combatant, onlyTarget?: Combatant, weaponOnly = false): number {
  refreshTraitCaches(context);
  if (source.status !== 'ready' || !alive(source) || flags(context, source).some(d => d?.skipTurn)) return 0;
  const cacheStore = weaponOnly ? extraCaches : caches;
  let cache = cacheStore.get(context); if (!cache) cacheStore.set(context, cache = new WeakMap());
  let values = cache.get(source); if (!values) cache.set(source, values = new Map());
  if (values.has(onlyTarget)) return values.get(onlyTarget)!;
  if (!onlyTarget && controlPolicy(source) === 'confused') {
    const selected=source.controlActivation?.targetId;
    const choices=context.units.filter(u=>u.id!==source.id && alive(u) && canSpot(context,source,u) && (!source.controlActivation || u.id===selected))
      .map(target=>({target,value:actionPotential(context,source,target,true)})).filter(c=>c.value>0);
    const expected=choices.length?choices.reduce((sum,c)=>sum+c.value*(combatHostile(source,c.target,context.units)?1:-1),0)/choices.length:0;
    const total=expected*(1+(!weaponOnly&&hasteMagnitude(source)>0?hasteAttackScale(source):0));values.set(onlyTarget,total);return total;
  }
  const origin = positionedUnit(context, source), field = context.battlefield;
  const foes = (onlyTarget ? [onlyTarget] : context.units.filter(u => attackHostile(source, u, context.units))).filter(alive);
  let reachableCache = reachableCaches.get(context); if (!reachableCache) reachableCaches.set(context, reachableCache = new WeakMap());
  let reachable = reachableCache.get(source);
  if (!reachable) {
    const canMove = !flags(context, source).some(d => d?.preventMove) && ![...(context.attached?.values() ?? [])].includes(source.id);
    reachable = field && context.mode === 'small' && canMove
      ? reachableGridPaths(field, origin.pos!, movementPoints(source, context.fieldTags), cell => canOccupy(field, context.units, origin, cell), cell => tileCost(field, cell, origin)).map(p => p.cells.at(-1)!)
      : [origin.pos];
    reachableCache.set(source, reachable);
  }
  // 有界战术启发：保留原位及各近敌方向的最近合法落点，避免为每项状态重复穷举整张地图。
  const positions = [...new Set([origin.pos, ...foes.slice().sort((a,b)=>distance(context,origin,a)-distance(context,origin,b)||a.id.localeCompare(b.id)).slice(0,3)
    .map(foe=>nearestCell(context,origin,reachable,foe))])];
  const rules = context.rules ?? (origin.damageModel==='wounds-v2'?(context.mode==='mass'?V6_TW:V6_D20):origin.damageModel==='wounds-v1'?(context.mode==='mass'?V5_TW:V5_D20):(context.mode === 'mass' ? V4_TW : V4_D20));
  const defs = definitionTable(context);
  let best = 0;
  for (const pos of positions) {
    const actor = { ...origin, pos }, moved = pos !== origin.pos;
    for (const raw of foes) {
      const target = positionedUnit(context, raw), dist = distance(context, actor, target);
      const sighted = canSpot(context, actor, target);
      const world = { ...context, units: context.units.map(u => u.id === actor.id ? actor : u.id === target.id ? target : u) };
      const shotBlocked = (weapon: Weapon | undefined, ranged: boolean) => {
        if (!sighted && !(weapon?.indirect && world.units.some(u=>!combatHostile(u, actor, context.units)&&canSpot(world,u,target)))) return true;
        if (ranged && rangedScreen(actor,target,weapon,world.units,{mode:context.mode,width:field?.width},defs)) return true;
        return context.mode === 'mass' ? ranged ? !!formationShotReason({ ...actor, weapon }, target, world.units) : formationScreened(actor, target, world.units)
          : !ranged && !!field && !!meleeLineBlocker(field,actor,target,world.units);
      };
      const evaluate = (opts: Partial<Parameters<typeof previewAttack>[0]>) => Math.min(memberHealth(target), previewAttack({
        attacker: actor, defender: target, rules, conditionDefs: defs, traitRegistry: context.traitRegistry,
        fieldTags: context.fieldTags, distance: dist,
        attackerTerrain: standingTerrain(field, actor), defenderTerrain: standingTerrain(field, target), heightRules: field?.spatialRulesVersion === 2, heightAdvantage: heightDefense(field, target, actor),
        ...opts,
        extraMods: [...(moved && opts.ranged ? [{ source: 'stance' as const, category: 'movement' as const, name: '移动射击估计', kind: 'atk' as const, type: 'flat' as const, value: -2 }] : []), ...(opts.extraMods ?? []),
          ...(traitLevelsV16(actor) ? [...moraleAttackMods(world, actor, context.traitRegistry), ...situationalTraitMods(world, actor, target, {
            ambush: concealedUnit(world, actor), magic: opts.abilityDamage?.delivery === 'magic', ranged: !!opts.ranged, weapon: opts.weaponOverride ?? actor.weapon,
            flanked: () => world.units.some(u => u.id !== actor.id && !combatHostile(u, actor, context.units) && u.status === 'ready' && sameLayer(u, target) && distance(world, u, target) <= 1),
          })] : [])],
      }).expectedDamage);
      for (const rawWeapon of [actor.weapon, actor.sidearm]) {
        if (!rawWeapon || flags(context, actor).some(d => d?.preventAttack) && rawWeapon.recipe?.mechanism !== 'natural') continue;
        const ranged = isRangedWeapon(rawWeapon);
        const weapon = field ? gridWeapon(rawWeapon, true, rules.armsModel) : !ranged && actor.combatModel === 'cohort-v2' ? { ...rawWeapon, range: meleeReach(rawWeapon) } : rawWeapon;
        if (weaponTargetReason({ space: context.mode, actor, target, units:world.units, weapon, ranged, distance: dist, reloadLeft: context.reload?.get(weaponReloadKey(actor, rawWeapon)), field }) || shotBlocked(weapon, ranged)) continue;
        const width = engagementWidth(actor, target, ranged, field, context.fieldTags);
        const attached = new Set(context.attached?.values() ?? []);
        const cohort = world.units.filter(u => !attached.has(u.id) && sameLayer(actor, u) && (context.mode === 'mass' ? formationNode(actor).id === formationNode(u).id : u.pos === actor.pos));
        best = Math.max(best, evaluate({ weaponOverride: weapon, ranged, participants: sharedParticipants(actor, cohort, width, target) }));
      }
      for (const rawAbility of weaponOnly || controlPolicy(actor)==='confused' ? [] : actor.abilities) {
        if (!rawAbility.effects.some(e => e.op === 'damage')) continue;
        const ability = field ? gridAbility(rawAbility) : rawAbility;
        if (abilityUsabilityReason(actor, ability) || abilityTargetReason({ space: context.mode, actor, ability, target, units:world.units, distance: dist, field })) continue;
        const weapon = skillWeapon(actor, ability, dist);
        if (!weapon && !sighted) continue;
        if (weapon && ((context.reload?.get(weaponReloadKey(actor, weapon)) ?? 0) > 0 || shotBlocked(weapon, isRangedWeapon(weapon)))) continue;
        const value = ability.effects.reduce((sum, e) => e.op === 'damage' ? sum + evaluate(skillAttack(world, actor, target, ability, e, rules)) : sum, 0);
        best = Math.max(best, Math.min(memberHealth(target), value));
      }
    }
    if (!weaponOnly && !onlyTarget) for (const ability of actor.abilities) {
      if (abilityUsabilityReason(actor, ability)) continue;
      for (const target of context.units.filter(u => !combatHostile(u, actor, context.units) && alive(u))) {
        if (field && !unitLineOfSight(field,actor,positionedUnit(context,target))) continue;
        if (abilityTargetReason({ space: context.mode, actor, ability: field ? gridAbility(ability) : ability, target, distance: distance(context, actor, positionedUnit(context, target)), field })) continue;
        const heal = ability.effects.reduce((sum, e) => e.op === 'heal' ? sum + healingYield(actor, target, e.amount ?? averageDice(e.dice), !!ability.itemSourceId, e.power) : sum, 0);
        best = Math.max(best, Math.min(recoveryCapacity(target), heal));
      }
    }
  }
  if (!weaponOnly && hasteMagnitude(source) > 0) best += actionPotential(context, source, onlyTarget, true) * hasteAttackScale(source);
  if (onlyTarget) best = Math.min(memberHealth(onlyTarget), best);
  values.set(onlyTarget, best); return best;
}

export function incomingPotential(context: ObservationContext, target: Combatant): number {
  return Math.min(memberHealth(target), context.units.filter(u => combatHostile(u, target, context.units) && alive(u)).reduce((n, u) => n + actionPotential(context, u, target), 0));
}
/** 仅比较一个状态变化的边际价值；复合控制不会把同一行动重复扣除。 */
export function tacticalStateValue(context: ObservationContext, target: Combatant): number {
  if(target.traitLevelModel==='traits-levels-v2')context={...context,units:context.units.map(u=>u.id===target.id?target:u)};
  const outgoing = actionPotential(context, target), incoming = incomingPotential(context, target);
  const risk = moraleRisk(context, target, (context.rules ?? V4_TW).morale.breakAt, context.traitRegistry).breakChance;
  const dot = target.conditions.reduce((n, c) => n + (c.dur > 0 ? (target.traitLevelModel === 'traits-levels-v2' ? conditionDamage(target, averageDice((context.conditions ?? defaults).get(c.id)?.dot?.dice), c) : averageDice((context.conditions ?? defaults).get(c.id)?.dot?.dice) * (c.affectedMembers ?? 1)) : 0), 0);
  const survival = incoming + dot >= memberHealth(target) ? outgoing * 0.5 : 0;
  const recovery = traitLevelsV16(target) && activeTraitIds(target).includes('lifesteal')
    ? Math.max(0, ...context.units.filter(u => combatHostile(u, target, context.units) && alive(u)).map(u => lifestealAmount(target, u, actionPotential(context, target, u)))) : 0;
  if(target.traitLevelModel!=='traits-levels-v2') return outgoing - incoming + recovery - survival - Math.min(memberHealth(target), dot) - risk * Math.max(outgoing, memberHealth(target) * 0.1);
  const allegiance = combatSide(target,context.units)===target.side?1:-1;
  return allegiance*(outgoing + recovery) - incoming - survival - Math.min(memberHealth(target), dot) - risk * Math.max(outgoing, memberHealth(target) * 0.1);
}
