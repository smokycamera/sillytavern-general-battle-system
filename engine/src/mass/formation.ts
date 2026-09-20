import { ignoresFriendlyScreen } from '../loadout.js';
import type { Combatant } from '../types.js';
import { activeTraitIds } from '../trait-sources.js';
import { hasFlightAbility, isAirborne, sameLayer } from '../aerial.js';
/** 普通个体在会战依附编队；真实独立平台与飞行单位保留独立位置。 */
export function needsFormationHost(unit: Combatant): boolean {
  return unit.scale === 'hero' && (unit.body ?? 'human') === 'human' && unit.status === 'ready' && !hasFlightAbility(unit);
}
export const WINGS = ['左翼', '中军', '右翼'] as const;
export const RANKS = ['front', 'rear', 'reserve'] as const;
export interface FormationNode { id: string; side: 'ally' | 'enemy'; wing: typeof WINGS[number]; rank: typeof RANKS[number]; x: number; y: number }
export const FORMATION_NODES: FormationNode[] = (['enemy', 'ally'] as const).flatMap((side) => RANKS.flatMap((rank, depth) => WINGS.map((wing, x) => ({
  id: `${side}:${wing}:${rank}`, side, wing, rank, x, y: side === 'enemy' ? 2 - depth : 3 + depth,
}))));
export const FORMATION_EDGES = new Map(FORMATION_NODES.map((a) => [a.id, FORMATION_NODES.filter((b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1).map((b) => b.id)]));
export function formationNode(unit: Combatant): FormationNode {
  if (unit.rulesVersion === 'v2' && unit.formationPosition !== undefined) {
    validateFormationPosition(unit.formationPosition);
    return FORMATION_NODES.find((n) => n.id === unit.formationPosition)!;
  }
  const wing = unit.tags.find((t) => t.startsWith('zone:'))?.slice(5) ?? '中军';
  const rank = unit.tags.find((t) => t.startsWith('rank:'))?.slice(5) ?? 'front';
  const node = FORMATION_NODES.find((n) => n.side === unit.side && n.wing === wing && n.rank === rank);
  if (!node) throw new Error(`非法会战阵位 ${unit.side}/${wing}/${rank}`);
  return node;
}
export function formationDistance(a: Combatant, b: Combatant): number {
  const from = formationNode(a).id, target = formationNode(b).id;
  const queue: [string, number][] = [[from, 0]]; const seen = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const [id, distance] = queue[i]!;
    if (id === target) return Math.max(sameLayer(a, b) ? 0 : 1, distance);
    for (const neighbor of FORMATION_EDGES.get(id) ?? []) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push([neighbor, distance + 1]); }
  }
  return Infinity;
}
export function setFormation(unit: Combatant, node: FormationNode): void {
  if (unit.rulesVersion === 'v2' && (isAirborne(unit) || unit.formationPosition !== undefined)) { unit.formationPosition = node.id; return; }
  if (unit.side !== node.side) throw new Error('不能部署到敌方所有阵位');
  unit.tags = [...unit.tags.filter((t) => !t.startsWith('zone:') && !t.startsWith('rank:')), `zone:${node.wing}`, `rank:${node.rank}`];
}
export function validateFormationPosition(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !FORMATION_NODES.some((n) => n.id === value))) throw new Error('实际会战阵位损坏');
}
export function formationNodeDistance(a: FormationNode, b: FormationNode): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
export function formationCanOccupy(units: Combatant[], actor: Combatant, node: FormationNode, attached: Map<string, string>): boolean {
  const embedded = new Set(attached.values());
  const occupants = units.filter((u) => u.id !== actor.id && u.status === 'ready' && !embedded.has(u.id) && sameLayer(actor, u) && formationNode(u).id === node.id);
  return occupants.length < 3 && !occupants.some((u) => u.side !== actor.side);
}
export function formationScreened(actor: Combatant, target: Combatant, units: Combatant[]): boolean {
  if (isAirborne(actor) || isAirborne(target)) return false;
  const from = formationNode(actor), to = formationNode(target);
  return to.rank !== 'front' && units.some((u) => u.side === target.side && u.status === 'ready' && !isAirborne(u) && formationNode(u).wing === to.wing
    && formationNode(u).rank === 'front' && formationNode(u).y > Math.min(from.y, to.y) && formationNode(u).y < Math.max(from.y, to.y));
}
export function validateVanguardOrigin(value: unknown, side?: Combatant['side']): void {
  if (value !== undefined && (typeof value !== 'string' || !FORMATION_NODES.some((n) => n.id === value && (!side || n.side === side)))) throw new Error('先锋部署来源损坏或跨阵营');
}
export function restoreDeploymentPreference(unit: Combatant): void {
  validateVanguardOrigin(unit.vanguardOrigin, unit.side);
  if (unit.vanguardOrigin) setFormation(unit, FORMATION_NODES.find((n) => n.id === unit.vanguardOrigin)!);
  delete unit.vanguardOrigin;
}
/** 输入为部署副本，只读取己方占位；前出不得改变战前长期偏好。 */
export function deployVanguardFormation(units: Combatant[], attached: Map<string, string>): { id: string; from: FormationNode; to: FormationNode }[] {
  const changes: { id: string; from: FormationNode; to: FormationNode }[] = [];
  const embedded = new Set(attached.values());
  const count = (node: FormationNode, except: string) => units.filter((u) => u.id !== except && u.status === 'ready' && !embedded.has(u.id) && sameLayer(u, units.find((u) => u.id === except)!) && formationNode(u).id === node.id).length;
  for (const unit of [...units].sort((a, b) => a.id.localeCompare(b.id))) {
    if (unit.status !== 'ready' || unit.rulesVersion !== 'v2' || unit.vanguardOrigin || embedded.has(unit.id) || !activeTraitIds(unit).includes('vanguard')) continue;
    const from = formationNode(unit);
    const candidates = FORMATION_NODES.filter((node) => node.side === unit.side && (from.rank === 'front'
      ? from.wing === '中军' && node.rank === 'front' && node.wing !== '中军'
      : node.wing === from.wing && RANKS.indexOf(node.rank) === RANKS.indexOf(from.rank) - 1));
    const to = candidates.filter((n) => count(n, unit.id) < 3).sort((a, b) => count(a, unit.id) - count(b, unit.id) || a.x - b.x)[0] ?? from;
    if (to.id !== from.id) {
      unit.vanguardOrigin = from.id; setFormation(unit, to);
      const hero = units.find((u) => u.id === attached.get(unit.id));
      if (hero) { hero.vanguardOrigin = formationNode(hero).id; setFormation(hero, to); }
    }
    changes.push({ id: unit.id, from, to });
  }
  return changes;
}
export function formationShotReason(actor: Combatant, target: Combatant, units: Combatant[]): string | undefined {
  const weapon = actor.weapon;
  if (!weapon?.tags?.includes('ranged')) return '需要射击武器';
  const from = formationNode(actor), to = formationNode(target);
  const distance = formationDistance(actor, target);
  if (distance < (weapon.minRange ?? 0) || distance > (weapon.range ?? 3)) return `阵位距离${distance}不在武器射程内`;
  if (isAirborne(actor) || isAirborne(target)) return undefined;
  if (weapon.pointBlankPolicy === 'forbid' && units.some((u) => u.side !== actor.side && u.status === 'ready' && sameLayer(actor, u) && formationDistance(actor, u) <= 1)) return '被相邻敌人牵制，该武器不能抵近射击';
  const blocks = units.some((u) => u.id !== actor.id && u.status === 'ready' && u.side === actor.side && formationNode(u).wing === from.wing && formationNode(u).rank === 'front');
  if (from.rank === 'reserve' && from.wing === to.wing && blocks && !weapon.indirect && !ignoresFriendlyScreen(weapon)) return '前线遮挡预备队直射';
  if (weapon.indirect && blocks && !units.some((u) => u.side === actor.side && u.status === 'ready' && formationNode(u).rank === 'front' && Math.abs(formationNode(u).x - to.x) <= 1)) return '间接火力缺少前线观察者';
  return undefined;
}
