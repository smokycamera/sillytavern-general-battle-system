import { displayNumber } from './display-number.js';
import { equipmentBurden } from './equipment-load.js';
/**
 * 技能自带的施术者位移（突进 / 闪现 / 后撤）。
 *
 * - 突进（冲锋、冲刺）：出手前沿可走路线移动，地形照常计价，途中照常触发借机与警戒；以实际近战武器出手且原本不在
 *   接触距离、确实移动过时按冲锋结算（冲锋强化、拒马、践踏等照常）。
 * - 闪现（瞬移、传送）：出手前直接落到视线内的可落脚处，不经过路线、不触发反应、不跨越平台层。
 * - 后撤（撤步、脱离）：出手后沿可走路线拉开距离，不触发近战借机，仍受警戒射击。
 *
 * 位移不消耗本回合移动点；定身、眩晕时不能位移，减速时突进与后撤少走1格。只有位移的技能直接选择落点。
 */
import type { Ability, Combatant, ConditionDef, EffectOp } from './types.js';
import { bonusSteps } from './enhancements.js';
import { progressiveSkills } from './skill-model.js';

export type MoveEffect = Extract<EffectOp, { op: 'move' }>;
export type MoveMode = MoveEffect['mode'];

/** V40：闪现走L格，突进/后撤L+1格；旧规则保留原阶梯。路径、视线、反应与平台限制仍由执行器检查。 */
export function skillMoveReach(mode: MoveMode, power: number, model?: unknown): number {
  if (progressiveSkills(model)) return power + (mode === 'blink' ? 0 : 1);
  return mode === 'blink' ? 1 + Math.floor(power / 3) : 2 + Math.floor(power / 4);
}
export function moveEffects(ability: Pick<Ability, 'effects'>): { before?: MoveEffect; after?: MoveEffect } {
  const moves = ability.effects.filter((e): e is MoveEffect => e.op === 'move');
  return { before: moves.find(e => e.mode !== 'withdraw'), after: moves.find(e => e.mode === 'withdraw') };
}
export function movementOnlySkill(ability: Pick<Ability, 'effects'>): boolean {
  return ability.effects.length > 0 && ability.effects.every(e => e.op === 'move');
}
export function hasSkillMovement(ability: Pick<Ability, 'effects'>): boolean {
  return ability.effects.some(e => e.op === 'move');
}
/** 定身与失能不能位移；随队人物在会战里随所属编队行动。 */
export function moveBlockReason(actor: Combatant, conditions: { get(id: string): ConditionDef | undefined }): string | undefined {
  if (actor.conditions.some(c => c.dur > 0 && (conditions.get(c.id)?.preventMove || conditions.get(c.id)?.skipTurn))) return '定身或失能，不能位移';
  return undefined;
}
/** 实际可走格数：射程强化同样延长位移，减速时突进与后撤少1格（至少1格）。 */
export function effectiveMoveReach(actor: Combatant, ability: Pick<Ability, 'bonuses'>, effect: MoveEffect, conditions: { get(id: string): ConditionDef | undefined }): number {
  if (moveBlockReason(actor, conditions) || effect.mode === 'dash' && equipmentBurden(actor) === 2) return 0;
  const slowed = effect.mode !== 'blink' && actor.conditions.some(c => c.dur > 0 && c.id === 'slowed');
  return Math.max(1, effect.reach + bonusSteps(ability.bonuses, 'range', 5) - (slowed ? 1 : 0));
}
/** 会战阵位：突进与后撤一个阵位，闪现可达两层（技能可走3格以上时）。 */
export function massMoveReach(effect: MoveEffect): number {
  if (effect.massReach !== undefined) return effect.massReach;
  return effect.mode === 'blink' && effect.reach >= 3 ? 2 : 1;
}
/** 技能说明：只有位移的技能写“移动到落点”；以实际近战武器出手的突进才提冲锋。 */
export function moveEffectDescription(effect: MoveEffect, ability: Pick<Ability, 'effects' | 'damageBasis' | 'weaponUse'>): string {
  const movementOnly = movementOnlySkill(ability), cells = `至多${displayNumber(effect.reach)}格`;
  const melee = ability.damageBasis === 'weapon' && ability.weaponUse !== 'ranged';
  if (effect.mode === 'dash') return (movementOnly ? '突进' : '出手前突进') + cells + (melee ? '，接敌按冲锋结算' : '');
  if (effect.mode === 'blink') return (movementOnly ? '闪现' : '出手前闪现') + cells + '，不触发反应';
  return (movementOnly ? '后撤' : '出手后后撤') + cells + '，不触发近战借机';
}
