import type { Combatant, Weapon } from './types.js';
import type { ObservationContext } from './observation.js';
import { positionedUnit, canSpot } from './observation.js';
import { previewAttack } from './damage.js';
import { standardConditionMap } from './conditions.js';
import { V4_D20, V4_TW } from './rules.js';
import { abilityTargetReason, abilityUsabilityReason, averageDice, weaponTargetReason } from './actions.js';
import { isRangedWeapon, weaponReloadKey } from './loadout.js';
import { skillWeapon } from './skill-runtime.js';
import { skillAttack } from './skill-attack.js';
import { gridWeapon } from './small/weapon-range.js';
import { gridAbility } from './small/skill-range.js';
import { gridDistance, reachableGridPaths, canOccupy, tileCost, meleeLineBlocker, unitLineOfSight } from './small/spatial.js';
import { formationDistance, formationNode, formationScreened, formationShotReason } from './mass/formation.js';
import { rangedScreen } from './guard-screen.js';
import { engagementWidth, sharedParticipants } from './exposure.js';
import { sameLayer } from './aerial.js';
import { movementPoints } from './tactics.js';
import { recoveryCapacity } from './recovery.js';
import { healingYield } from './combat-model.js';
import { memberHealth } from './member-health.js';
import { moraleRisk } from './morale.js';
import { meleeReach } from './melee.js';

const defaults = standardConditionMap();
const caches = new WeakMap<ObservationContext, WeakMap<Combatant, Map<Combatant | undefined, number>>>();
const alive = (u: Combatant) => u.hp > 0 && !['dead', 'fled'].includes(u.status);
function flags(context: ObservationContext, unit: Combatant) {
  return unit.conditions.filter(c => c.dur > 0).map(c => (context.conditions ?? defaults).get(c.id));
}
function distance(context: ObservationContext, a: Combatant, b: Combatant) {
  return context.mode === 'mass' ? formationDistance(a, b) : context.battlefield
    ? gridDistance(context.battlefield, a.pos!, b.pos!) : Math.abs((a.pos ?? 0) - (b.pos ?? 0));
}

/** 一次合法行动的可兑现生命收益；不推演敌军军令，不消耗随机数。
 * 小队可先移动后行动；会战调动另占军令，故只计算当前阵位。
 * 治疗算真实伤口，沉默/缴械之后仍保留另一种攻击及天生武器。
 */
export function actionPotential(context: ObservationContext, source: Combatant, onlyTarget?: Combatant): number {
  if (source.status !== 'ready' || !alive(source) || flags(context, source).some(d => d?.skipTurn)) return 0;
  let cache = caches.get(context); if (!cache) caches.set(context, cache = new WeakMap());
  let values = cache.get(source); if (!values) cache.set(source, values = new Map());
  if (values.has(onlyTarget)) return values.get(onlyTarget)!;
  const origin = positionedUnit(context, source), field = context.battlefield;
  const foes = (onlyTarget ? [onlyTarget] : context.units.filter(u => u.side !== source.side)).filter(alive);
  const canMove = !flags(context, source).some(d => d?.preventMove) && ![...(context.attached?.values() ?? [])].includes(source.id);
  const reachable = field && context.mode === 'small' && canMove
    ? reachableGridPaths(field, origin.pos!, movementPoints(source, context.fieldTags), cell => canOccupy(field, context.units, origin, cell), cell => tileCost(field, cell, origin)).map(p => p.cells.at(-1)!)
    : [origin.pos];
  // 有界战术启发：保留原位及各近敌方向的最近合法落点，避免为每项状态重复穷举整张地图。
  const positions = [...new Set([origin.pos, ...foes.slice().sort((a,b)=>distance(context,origin,a)-distance(context,origin,b)||a.id.localeCompare(b.id)).slice(0,3)
    .map(foe=>reachable.slice().sort((a,b)=>distance(context,{...origin,pos:a},foe)-distance(context,{...origin,pos:b},foe)||(a??0)-(b??0))[0])])];
  const rules = context.rules ?? (context.mode === 'mass' ? V4_TW : V4_D20);
  const defs = new Map([...defaults].map(([id, def]) => [id, context.conditions?.get(id) ?? def]));
  let best = 0;
  for (const pos of positions) {
    const actor = { ...origin, pos }, moved = pos !== origin.pos;
    for (const raw of foes) {
      const target = positionedUnit(context, raw), dist = distance(context, actor, target);
      const sighted = canSpot(context, actor, target);
      const world = { ...context, units: context.units.map(u => u.id === actor.id ? actor : u.id === target.id ? target : u) };
      const shotBlocked = (weapon: Weapon | undefined, ranged: boolean) => {
        if (!sighted && !(weapon?.indirect && world.units.some(u=>u.side===actor.side&&canSpot(world,u,target)))) return true;
        if (ranged && rangedScreen(actor,target,weapon,world.units,{mode:context.mode,width:field?.width},defs)) return true;
        return context.mode === 'mass' ? ranged ? !!formationShotReason({ ...actor, weapon }, target, world.units) : formationScreened(actor, target, world.units)
          : !ranged && !!field && !!meleeLineBlocker(field,actor,target,world.units);
      };
      const evaluate = (opts: Partial<Parameters<typeof previewAttack>[0]>) => Math.min(memberHealth(target), previewAttack({
        attacker: actor, defender: target, rules, conditionDefs: defs, traitRegistry: context.traitRegistry,
        fieldTags: context.fieldTags, distance: dist,
        attackerTerrain: field?.tiles[actor.pos!], defenderTerrain: field?.tiles[target.pos!],
        extraMods: moved && opts.ranged ? [{ source: 'stance', name: '移动射击估计', kind: 'atk', type: 'flat', value: -2 }] : [], ...opts,
      }).expectedDamage);
      for (const rawWeapon of [actor.weapon, actor.sidearm]) {
        if (!rawWeapon || flags(context, actor).some(d => d?.preventAttack) && rawWeapon.recipe?.mechanism !== 'natural') continue;
        const ranged = isRangedWeapon(rawWeapon);
        const weapon = field ? gridWeapon(rawWeapon) : !ranged && actor.combatModel === 'cohort-v2' ? { ...rawWeapon, range: meleeReach(rawWeapon) } : rawWeapon;
        if (weaponTargetReason({ actor, target, weapon, ranged, distance: dist, reloadLeft: context.reload?.get(weaponReloadKey(actor, rawWeapon)) }) || shotBlocked(weapon, ranged)) continue;
        const width = engagementWidth(actor, target, ranged, field, context.fieldTags);
        const attached = new Set(context.attached?.values() ?? []);
        const cohort = world.units.filter(u => !attached.has(u.id) && sameLayer(actor, u) && (context.mode === 'mass' ? formationNode(actor).id === formationNode(u).id : u.pos === actor.pos));
        best = Math.max(best, evaluate({ weaponOverride: weapon, ranged, participants: sharedParticipants(actor, cohort, width, target) }));
      }
      for (const rawAbility of actor.abilities) {
        if (!rawAbility.effects.some(e => e.op === 'damage')) continue;
        const ability = field ? gridAbility(rawAbility) : rawAbility;
        if (abilityUsabilityReason(actor, ability) || abilityTargetReason({ actor, ability, target, distance: dist })) continue;
        const weapon = skillWeapon(actor, ability, dist);
        if (!weapon && !sighted) continue;
        if (weapon && ((context.reload?.get(weaponReloadKey(actor, weapon)) ?? 0) > 0 || shotBlocked(weapon, isRangedWeapon(weapon)))) continue;
        const value = ability.effects.reduce((sum, e) => e.op === 'damage' ? sum + evaluate(skillAttack(world, actor, target, ability, e, rules)) : sum, 0);
        best = Math.max(best, Math.min(memberHealth(target), value));
      }
    }
    if (!onlyTarget) for (const ability of actor.abilities) {
      if (abilityUsabilityReason(actor, ability)) continue;
      for (const target of context.units.filter(u => u.side === actor.side && alive(u))) {
        if (field && !unitLineOfSight(field,actor,positionedUnit(context,target))) continue;
        if (abilityTargetReason({ actor, ability: field ? gridAbility(ability) : ability, target, distance: distance(context, actor, positionedUnit(context, target)) })) continue;
        const heal = ability.effects.reduce((sum, e) => e.op === 'heal' ? sum + healingYield(actor, target, e.amount ?? averageDice(e.dice), !!ability.itemSourceId) : sum, 0);
        best = Math.max(best, Math.min(recoveryCapacity(target), heal));
      }
    }
  }
  values.set(onlyTarget, best); return best;
}

export function incomingPotential(context: ObservationContext, target: Combatant): number {
  return Math.min(memberHealth(target), context.units.filter(u => u.side !== target.side && alive(u)).reduce((n, u) => n + actionPotential(context, u, target), 0));
}
/** 仅比较一个状态变化的边际价值；复合控制不会把同一行动重复扣除。 */
export function tacticalStateValue(context: ObservationContext, target: Combatant): number {
  const outgoing = actionPotential(context, target), incoming = incomingPotential(context, target);
  const risk = moraleRisk(context, target, (context.rules ?? V4_TW).morale.breakAt, context.traitRegistry).breakChance;
  const dot = target.conditions.reduce((n, c) => n + (c.dur > 0 ? averageDice((context.conditions ?? defaults).get(c.id)?.dot?.dice) * (c.affectedMembers ?? 1) : 0), 0);
  return outgoing - incoming - Math.min(memberHealth(target), dot) - risk * Math.max(outgoing, memberHealth(target) * 0.1);
}
