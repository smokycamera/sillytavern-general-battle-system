import { bodyMovement } from './body.js';
import type { Combatant, ConditionDef, Trait } from './types.js';
import type { Modifier, ResolveContext } from './bonus.js';
import { activeTraitIds, activeConditionIds, traitPrerequisiteReason } from './trait-sources.js';
import { isAirborne } from './aerial.js';
import { formationNode } from './mass/formation.js';

export interface TacticalPose {
  kind: 'brace'; mode: 'small' | 'mass'; width?: number;
  anchor: { x: number; y: number }; facing: { x: number; y: number };
}
export const SPEED_TIERS = ['迟缓', '缓行', '标准', '快速', '疾速'] as const;
export function movementLabel(unit: Combatant, tags: string[] = []): string {
  const points = movementPoints(unit, tags); return SPEED_TIERS[points - 1] + '·' + points + '格';
}
/** 训练先攻与地图移动分开；移动只读实际体量、负载、专长、状态和疲劳。 */
export function movementPoints(unit: Combatant, tags: string[] = []): number {
  if (unit.rulesVersion !== 'v2') return unit.body === 'vehicle' ? 2 : 3;
  const ids = activeTraitIds(unit), conditions = activeConditionIds(unit);
  const vehicle = unit.body === 'vehicle';
  const light = ['human', 'large'].includes(unit.body ?? 'human') && (unit.armor?.tier ?? 0) <= 2;
  const mobility = unit.mount === true || ids.includes('fast') || ids.includes('skirmisher') && light || ids.includes('mechanized') && vehicle || ids.includes('plains-runner') && tags.includes('plains') ? 1 : 0;
  const armor = !vehicle && (unit.armor?.tier ?? 0) >= 3 ? 1 : 0;
  const night = tags.includes('night') && !ids.includes('night-fighter') ? 1 : 0;
  return Math.max(1, Math.min(5, bodyMovement(unit) + mobility + Number(conditions.includes('hasted')) - Number(conditions.includes('slowed')) - armor - night - Math.floor(unit.fatigue / 2)));
}
export function formationMarchSteps(unit: Combatant, tags: string[] = []): number {
  if (isAirborne(unit)) return Math.max(1, Math.min(2, movementPoints(unit, tags) - 1));
  const traits = activeTraitIds(unit);
  if (tags.includes('forest') && !traits.includes('forest-lore') || tags.includes('mountain') && !traits.includes('mountain-born')) return 1;
  return movementPoints(unit, tags) >= (unit.body === 'vehicle' ? 3 : 4) ? 2 : 1;
}
/** 疲劳只在激活/阶段边界结算，避免途中追溯减少已经使用的移动额度。 */
export function settleFatigue(unit: Combatant, exertion: number): void {
  if (unit.rulesVersion !== 'v2') return;
  unit.fatigue = fatigueAfter(unit, exertion);
}
export function fatigueAfter(unit: Combatant, exertion: number): number {
  const resistance = activeTraitIds(unit).includes('fatigue-trained') ? 0.5 : 1;
  return Math.max(0, Math.min(4, unit.fatigue + (exertion > 0 ? exertion * 0.5 * resistance : -1)));
}
export function validateTacticalEffort(value: unknown): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2)) throw new Error('待结疲劳账本损坏');
}
export function validateTacticalPose(pose: TacticalPose): void {
  if (!pose || pose.kind !== 'brace' || !['small', 'mass'].includes(pose.mode)
    || pose.mode === 'small' && ![5, 7].includes(pose.width!)
    || !pose.anchor || !pose.facing || ![pose.anchor.x, pose.anchor.y, pose.facing.x, pose.facing.y].every(Number.isSafeInteger)
    || Math.abs(pose.facing.x) + Math.abs(pose.facing.y) !== 1
    || pose.anchor.x < 0 || pose.anchor.y < 0
    || pose.anchor.x >= (pose.mode === 'mass' ? 3 : pose.width!)
    || pose.anchor.y >= (pose.mode === 'mass' ? 6 : pose.width === 7 ? 13 : 7)) throw new Error('战术姿态数据损坏');
}
function position(unit: Combatant, space: Pick<TacticalPose, 'mode' | 'width'>) {
  if (space.mode === 'mass') { const node = formationNode(unit); return { x: node.x, y: node.y }; }
  return { x: unit.pos! % space.width!, y: Math.floor(unit.pos! / space.width!) };
}
/** 面向系统选定的威胁；不增加四方向选择器。 */
export function bracePose(unit: Combatant, threat: Combatant | undefined, mode: TacticalPose['mode'], width?: number): TacticalPose {
  const anchor = position(unit, { mode, width });
  const target = threat ? position(threat, { mode, width }) : { x: anchor.x, y: anchor.y + (unit.side === 'enemy' ? 1 : -1) };
  const dx = target.x - anchor.x, dy = target.y - anchor.y;
  const facing = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) || (unit.side === 'enemy' ? 1 : -1) };
  const pose: TacticalPose = { kind: 'brace', mode, ...(width ? { width } : {}), anchor, facing }; validateTacticalPose(pose); return pose;
}
export function postureActive(unit: Combatant, defs: Map<string, ConditionDef>): boolean {
  const pose = unit.tacticalPose; if (!pose || unit.rulesVersion !== 'v2' || unit.status !== 'ready' || unit.suppression || isAirborne(unit)) return false;
  if (unit.conditions.some((c) => c.dur > 0 && (defs.get(c.id)?.skipTurn || defs.get(c.id)?.preventAttack))) return false;
  const at = position(unit, pose); return at.x === pose.anchor.x && at.y === pose.anchor.y;
}
export function postureLabel(unit: Combatant, defs: Map<string, ConditionDef>): string | undefined {
  if (!unit.tacticalPose) return undefined;
  if (!postureActive(unit, defs)) return '固守受扰';
  const direction = unit.tacticalPose.facing;
  return `固守朝${direction.x > 0 ? '东' : direction.x < 0 ? '西' : direction.y > 0 ? '南' : '北'}`;
}
/** 全部攻击入口共用姿态防护，侧后方、移位、失能和装备失效即时撤销收益。 */
export function defensivePostureMods(unit: Combatant, ctx: ResolveContext, defs: Map<string, ConditionDef>, registry?: Map<string, Trait>): Modifier[] {
  if (!postureActive(unit, defs) || !ctx.defender) return [];
  const pose = unit.tacticalPose!, threat = position(ctx.defender, pose);
  const dx = threat.x - pose.anchor.x, dy = threat.y - pose.anchor.y;
  const forward = dx * pose.facing.x + dy * pose.facing.y, lateral = dx * pose.facing.y - dy * pose.facing.x;
  if (!(forward > 0 && Math.abs(lateral) <= forward)) return [];
  const mods: Modifier[] = [{ source: 'stance', sourceId: 'brace:def', stackGroup: 'posture:def', name: '正面固守', kind: 'def', type: 'flat', value: 2 }];
  for (const id of activeTraitIds(unit)) {
    if (traitPrerequisiteReason(unit, id)) continue;
    if (id === 'fortification' && ctx.fieldTags?.includes('siege')) {
      mods.push({ source: 'stance', sourceId: 'fortification:def', stackGroup: 'posture:def', name: '守城工事', kind: 'def', type: 'flat', value: 3 });
      if (ctx.ranged) mods.push({ source: 'stance', sourceId: 'fortification:ward', stackGroup: 'posture:ward', name: '守城工事', kind: 'ward', type: 'mult', value: 0.7 });
    }
    const mult = id === 'shield-wall' && ctx.ranged ? 0.6 : id === 'pike-wall' && ctx.charge && !ctx.ranged ? 0.5 : undefined;
    if (mult !== undefined) mods.push({ source: 'stance', sourceId: id + ':posture', stackGroup: 'posture:ward', name: registry?.get(id)?.name ?? (id === 'pike-wall' ? '拒马' : '盾墙'), kind: 'ward', type: 'mult', value: mult });
  }
  return mods;
}
/** 疏散由编队与装备条件决定，固守会收拢阵形；不增加另一种编队类型。 */
export function looseFormation(unit: Combatant): boolean {
  return unit.rulesVersion === 'v2' && activeTraitIds(unit).includes('loose-formation') && !traitPrerequisiteReason(unit, 'loose-formation')
    && unit.status === 'ready' && unit.hp > 1 && !unit.tacticalPose && !unit.suppression
    && !activeConditionIds(unit).includes('stunned');
}
