import type { Combatant, ConditionDef, Weapon } from './types.js';
import { isAirborne } from './aerial.js';
import { isRangedWeapon, ignoresFriendlyScreen } from './loadout.js';
import { MEMBER_HEALTH_MODEL } from './member-health.js';
import { formationNode } from './mass/formation.js';
import { postureActive } from './tactics.js';

export interface GuardSpace { mode: 'small' | 'mass'; width?: number }
function coordinates(unit: Combatant, space: GuardSpace) {
  if (space.mode === 'mass') return formationNode(unit);
  return { x: unit.pos! % space.width!, y: Math.floor(unit.pos! / space.width!) };
}

/** V4持盾固守形成实际射击屏障；沿用姿态快照、方向和失效条件。 */
export function shieldGuardActive(unit: Combatant, defs: Map<string, ConditionDef>): boolean {
  return unit.combatModel === MEMBER_HEALTH_MODEL && !!unit.shield && postureActive(unit, defs);
}

/** 仅使用调用方提供的可见单位。屏障保护同格及身后两格内队友，不遮住盾卫自身。 */
export function shieldScreen(attacker: Combatant, target: Combatant, weapon: Weapon | undefined,
  units: Combatant[], space: GuardSpace, defs: Map<string, ConditionDef>): Combatant | undefined {
  if (attacker.side === target.side || !isRangedWeapon(weapon) || weapon?.indirect || isAirborne(attacker) || isAirborne(target)) return undefined;
  const from = coordinates(attacker, space), to = coordinates(target, space);
  const dx = to.x - from.x, dy = to.y - from.y, lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return undefined;
  return units.filter(guard => {
    if (guard.id === target.id || guard.side !== target.side || !shieldGuardActive(guard, defs)
      || guard.tacticalPose!.mode !== space.mode || space.mode === 'small' && guard.tacticalPose!.width !== space.width) return false;
    const at = coordinates(guard, space), facing = guard.tacticalPose!.facing;
    const backX = to.x - at.x, backY = to.y - at.y;
    if (Math.abs(backX) + Math.abs(backY) > 2 || backX * facing.x + backY * facing.y > 0) return false;
    // 同格双盾不能互相屏蔽，必须仍能直接攻击前排盾卫。
    if (!backX && !backY && shieldGuardActive(target, defs)) return false;
    const frontX = from.x - at.x, frontY = from.y - at.y;
    const forward = frontX * facing.x + frontY * facing.y, lateral = frontX * facing.y - frontY * facing.x;
    if (forward <= 0 || Math.abs(lateral) > forward) return false;
    const gx = at.x - from.x, gy = at.y - from.y, along = gx * dx + gy * dy;
    const cross = gx * dy - gy * dx;
    return along > 0 && along <= lengthSquared && cross * cross <= lengthSquared * 0.25;
  }).sort((a, b) => {
    const aa = coordinates(a, space), bb = coordinates(b, space);
    return Math.abs(aa.x - from.x) + Math.abs(aa.y - from.y) - Math.abs(bb.x - from.x) - Math.abs(bb.y - from.y) || a.id.localeCompare(b.id);
  })[0];
}

export function shieldScreenReason(guard: Combatant): string {
  return `目标受${guard.name}持盾固守遮挡；先攻击或压制盾卫，或换射角、使用间接火力`;
}

/** V4直射按真实占位遮挡；弓弩/法杖越过友军，曲射越过单位，地形视线由攻击入口检查。 */
export function rangedScreen(attacker: Combatant, target: Combatant, weapon: Weapon | undefined,
  units: Combatant[], space: GuardSpace, defs: Map<string, ConditionDef>): Combatant | undefined {
  if (attacker.combatModel !== MEMBER_HEALTH_MODEL || !isRangedWeapon(weapon) || weapon?.indirect
    || isAirborne(attacker) || isAirborne(target)) return undefined;
  const from = coordinates(attacker, space), to = coordinates(target, space);
  const dx = to.x - from.x, dy = to.y - from.y, lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return undefined;
  const bypassFriends = ignoresFriendlyScreen(weapon);
  const blockers = units.filter(unit => {
    if (bypassFriends && unit.side === attacker.side) return false;
    if (unit.id === attacker.id || unit.id === target.id || isAirborne(unit) || unit.hp <= 0 || !['ready', 'routing'].includes(unit.status)) return false;
    const at = coordinates(unit, space), x = at.x - from.x, y = at.y - from.y;
    const along = x * dx + y * dy, cross = x * dy - y * dx;
    return along > 0 && along < lengthSquared && cross * cross <= lengthSquared * 0.25;
  });
  return blockers.sort((a, b) => {
    const aa = coordinates(a, space), bb = coordinates(b, space);
    return (aa.x - bb.x) * dx + (aa.y - bb.y) * dy || a.id.localeCompare(b.id);
  })[0] ?? shieldScreen(attacker, target, weapon, units, space, defs);
}

export function rangedScreenReason(blocker: Combatant): string {
  return `直射被${blocker.name}遮挡；前排地面单位自动遮线，可换射角、先处理前排或使用间接火力`;
}
