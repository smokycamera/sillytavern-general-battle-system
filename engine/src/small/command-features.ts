/** V19 统帅 §3.4：小战候选的风格特征。只用己方已知单位和本轮记录，不读隐藏信息。 */
import { activeTraitIds } from '../trait-sources.js';
import { isRangedWeapon, meleeWeapon } from '../loadout.js';
import { entrenched } from '../entrenchment.js';
import { commandAttacked, commandAttackers, commandStart, NEUTRAL_FEATURES, type CommandRound, type StyleFeatures } from '../command-v2.js';
import { intactStructure, meleeContact } from './layers.js';
import { gridDistance, type BattlefieldSpec } from './spatial.js';
import type { Combatant } from '../types.js';

export interface SmallCommandContext {
  field: BattlefieldSpec;
  unit: Combatant;
  /** 本方（当前作战阵营）与敌方：可见、在场的单位。 */
  friends: Combatant[];
  foes: Combatant[];
  side: 'ally' | 'enemy';
  rounds: readonly CommandRound[];
  movement: number;
  /** 自身武器的最大射程/触及；敌方近战单位的触及。 */
  range: number;
  reach: (foe: Combatant) => number;
  /** 落点来袭期望伤害（已乘来袭估值系数）。 */
  incomingAt: (cell: number) => number;
  health: number;
}
export interface SmallCommandPlan { cells: number[]; landing: number; attack: boolean; ranged: boolean; breach: boolean; stay: boolean; target?: Combatant; killChance?: number }

/** 一次决策内共用的几何事实；每个候选只做查表和少量距离计算。 */
export function smallCommandFeatures(ctx: SmallCommandContext): (plan: SmallCommandPlan) => StyleFeatures {
  const { field, unit, friends, foes } = ctx, start = unit.pos!, d = (a: number, b: number) => gridDistance(field, a, b);
  const allies = friends.filter(u => u.id !== unit.id);
  const nearestCache = new Map<number, number>();
  const nearestFoe = (cell: number) => {
    if (!nearestCache.has(cell)) nearestCache.set(cell, Math.min(Infinity, ...foes.map(f => d(cell, f.pos!))));
    return nearestCache.get(cell)!;
  };
  const meleeFoes = foes.filter(f => !isRangedWeapon(f.weapon) && !!meleeWeapon(f)).map(f => ({ at: f.pos!, reach: ctx.reach(f) }));
  const engaged = (u: Combatant) => foes.some(f => d(u.pos!, f.pos!) <= 1);
  const frontline = (cell: number) => nearestFoe(cell) <= 4 && allies.some(a => d(cell, a.pos!) === 1);
  // 核心单位：本方当前生命最高的英雄（同分取 id 小的）；没有英雄时为人数最多的编队。
  const heroes = friends.filter(u => u.scale === 'hero');
  const core = (heroes.length ? heroes : friends).slice().sort((a, b) => b.hp - a.hp || a.id.localeCompare(b.id))[0];
  const engineers = friends.filter(u => activeTraitIds(u).includes('siege-breaker'));
  const attacked = commandAttacked(ctx.rounds, ctx.side === 'ally' ? 'enemy' : 'ally'), ownTargets = commandAttacked(ctx.rounds, ctx.side), hostile = commandAttackers(ctx.rounds, ctx.side);
  const hurtAllies = allies.filter(a => attacked.has(a.id));
  const startOf = (u: Combatant) => commandStart(ctx.rounds, u, u.pos) as number | undefined;
  const inFrontZone = (cell: number | undefined, starts: boolean) => cell !== undefined && friends.some(o => { const at = starts ? startOf(o) : o.pos; return at !== undefined && d(cell, at) <= 4; });
  const x = (cell: number) => cell % field.width, y = (cell: number) => Math.floor(cell / field.width);
  const meleeUnit = !isRangedWeapon(unit.weapon);
  const startFront = frontline(start), idle = !foes.some(f => d(start, f.pos!) <= ctx.range), hpRatio = unit.hp / unit.base.hpMax, selfEngaged = engaged(unit);
  return (plan) => {
    const landing = plan.landing, move = landing !== start, target = plan.target;
    const before = nearestFoe(start), after = nearestFoe(landing);
    const f: StyleFeatures = { ...NEUTRAL_FEATURES, move, attack: plan.attack, ranged: plan.ranged, breach: plan.breach, stay: !move && plan.stay,
      approach: Number.isFinite(before) && Number.isFinite(after) ? Math.min(1, Math.max(0, (before - after) / Math.max(1, ctx.movement))) : 0,
      exposure: Math.min(1, Math.max(0, ctx.incomingAt(landing) / Math.max(1, ctx.health))),
      retreat: move && after > before, closer: after < before, allyNear: allies.some(a => d(landing, a.pos!) <= 2),
      frontline: frontline(landing), leavingFront: move && startFront && !frontline(landing),
      secondLine: allies.some(a => engaged(a) && d(landing, a.pos!) >= 2 && d(landing, a.pos!) <= 3 && after >= nearestFoe(a.pos!) + 2),
      nearCore: !!core && d(landing, core.pos!) <= 2,
      safePath: plan.cells.every(cell => meleeFoes.every(m => d(cell, m.at) >= 3)),
      flankMove: move && meleeUnit && foes.some(e => d(landing, e.pos!) === 1 && allies.some(a => d(a.pos!, e.pos!) === 1
        && (x(landing) - x(e.pos!)) * (x(a.pos!) - x(e.pos!)) + (y(landing) - y(e.pos!)) * (y(a.pos!) - y(e.pos!)) <= 0)),
      reinforce: move && hurtAllies.some(a => d(landing, a.pos!) < d(start, a.pos!)),
      rangedUnit: !meleeUnit,
      safeRange: meleeFoes.every(m => d(landing, m.at) > m.reach + 1) && foes.some(e => d(landing, e.pos!) <= ctx.range),
      inEnemyReach: meleeFoes.some(m => d(landing, m.at) <= m.reach),
      idle, hpRatio, engaged: selfEngaged };
    if (target && plan.attack) Object.assign(f, {
      killChance: plan.killChance ?? 0,
      flanked: allies.some(a => meleeContact(field, a, target) && d(a.pos!, target.pos!) <= 1),
      focused: ownTargets.has(target.id),
      backline: isRangedWeapon(target.weapon) || target.abilities.some(a => a.delivery === 'magic' && a.effects.some(e => e.op === 'damage')),
      fortified: entrenched(target) || ['cover', 'fortification'].includes(intactStructure(field, target.pos!)?.kind ?? ''),
      nearEngineer: engineers.some(e => d(e.pos!, target.pos!) <= 3),
      targetNearCore: !!core && d(core.pos!, target.pos!) <= 3,
      counter: hostile.has(target.id),
      intercept: !inFrontZone(startOf(target), true) && inFrontZone(target.pos, false),
    });
    return f;
  };
}
