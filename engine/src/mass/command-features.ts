/**
 * V19 统帅 §3.3 会战换算：格子距离改为阵位距离，"2 格内"为同阵位或相邻；其余距离按同一比例（约 2 格 1 阵位）：
 * 4 格→2 阵位，3 格以内→1 阵位，3 格以上→2 阵位，第二线 2–3 格→1 阵位、"大 2 以上"→1 阵位以上。
 * "贴近同一敌人且不在同一侧"为"与已接敌友军攻击同一目标，且所在阵位不同"。
 */
import { activeTraitIds } from '../trait-sources.js';
import { isRangedWeapon, meleeWeapon } from '../loadout.js';
import { entrenched } from '../entrenchment.js';
import { commandAttacked, commandAttackers, commandStart, NEUTRAL_FEATURES, type CommandRound, type StyleFeatures } from '../command-v2.js';
import { FORMATION_NODES, formationNodeDistance, type FormationNode } from './formation.js';
import type { Combatant } from '../types.js';

export interface MassCommandContext {
  unit: Combatant;
  node: (unit: Combatant) => FormationNode;
  friends: Combatant[];
  foes: Combatant[];
  side: 'ally' | 'enemy';
  rounds: readonly CommandRound[];
  /** 自身武器的最大射程/触及（阵位）；敌方近战编队的触及。 */
  range: number;
  reach: (foe: Combatant) => number;
  incomingAt: (node: FormationNode) => number;
  health: number;
  /** 火力预算判定必倒（已下达的己方攻击击倒概率 ≥95%）的目标。 */
  doomed: (target: Combatant) => boolean;
}
export interface MassCommandOrder { destination: FormationNode; attack: boolean; ranged: boolean; stay: boolean; target?: Combatant; killChance?: number }

export function massCommandFeatures(ctx: MassCommandContext): (order: MassCommandOrder) => StyleFeatures {
  const { unit, friends, foes } = ctx, d = formationNodeDistance, start = ctx.node(unit);
  const allies = friends.filter(u => u.id !== unit.id);
  const nearestFoe = (node: FormationNode) => Math.min(Infinity, ...foes.map(f => d(node, ctx.node(f))));
  const meleeFoes = foes.filter(f => !isRangedWeapon(f.weapon) && !!meleeWeapon(f)).map(f => ({ at: ctx.node(f), reach: ctx.reach(f) }));
  const engaged = (u: Combatant) => foes.some(f => d(ctx.node(u), ctx.node(f)) <= 1);
  const frontline = (node: FormationNode) => nearestFoe(node) <= 2 && allies.some(a => d(node, ctx.node(a)) <= 1);
  const heroes = friends.filter(u => u.scale === 'hero');
  const core = (heroes.length ? heroes : friends).slice().sort((a, b) => b.hp - a.hp || a.id.localeCompare(b.id))[0];
  // 工兵：带工兵特质或持爆破武器的己方单位。
  const engineers = friends.filter(u => activeTraitIds(u).includes('siege-breaker') || u.weapon?.recipe?.mechanism === 'demolition');
  const attacked = commandAttacked(ctx.rounds, ctx.side === 'ally' ? 'enemy' : 'ally'), ownTargets = commandAttacked(ctx.rounds, ctx.side), hostile = commandAttackers(ctx.rounds, ctx.side);
  const hurtAllies = allies.filter(a => attacked.has(a.id));
  const startOf = (u: Combatant) => { const id = commandStart(ctx.rounds, u, ctx.node(u).id); return FORMATION_NODES.find(n => n.id === id); };
  const inFrontZone = (node: FormationNode | undefined, starts: boolean) => !!node && friends.some(o => { const at = starts ? startOf(o) : ctx.node(o); return !!at && d(node, at) <= 2; });
  const startFront = frontline(start), idle = !foes.some(f => d(start, ctx.node(f)) <= ctx.range), hpRatio = unit.hp / unit.base.hpMax, selfEngaged = engaged(unit);
  return (order) => {
    const landing = order.destination, move = landing.id !== start.id, target = order.target;
    const before = nearestFoe(start), after = nearestFoe(landing);
    const f: StyleFeatures = { ...NEUTRAL_FEATURES, move, attack: order.attack, ranged: order.ranged, stay: !move && order.stay,
      approach: Number.isFinite(before) && Number.isFinite(after) ? Math.min(1, Math.max(0, before - after)) : 0,
      exposure: Math.min(1, Math.max(0, ctx.incomingAt(landing) / Math.max(1, ctx.health))),
      retreat: move && after > before, closer: after < before, allyNear: allies.some(a => d(landing, ctx.node(a)) <= 1),
      frontline: frontline(landing), leavingFront: move && startFront && !frontline(landing),
      secondLine: allies.some(a => engaged(a) && d(landing, ctx.node(a)) === 1 && after >= nearestFoe(ctx.node(a)) + 1),
      nearCore: !!core && d(landing, ctx.node(core)) <= 1,
      safePath: [start, landing].every(node => meleeFoes.every(m => d(node, m.at) >= 2)),
      reinforce: move && hurtAllies.some(a => d(landing, ctx.node(a)) < d(start, ctx.node(a))),
      rangedUnit: isRangedWeapon(unit.weapon),
      safeRange: meleeFoes.every(m => d(landing, m.at) > m.reach + 1) && foes.some(e => d(landing, ctx.node(e)) <= ctx.range),
      inEnemyReach: meleeFoes.some(m => d(landing, m.at) <= m.reach),
      idle, hpRatio, engaged: selfEngaged };
    if (target && order.attack) {
      const at = ctx.node(target);
      Object.assign(f, {
        killChance: order.killChance ?? 0,
        flanked: allies.some(a => !isRangedWeapon(a.weapon) && d(ctx.node(a), at) <= 1),
        focused: ownTargets.has(target.id) && !ctx.doomed(target),
        backline: isRangedWeapon(target.weapon) || target.abilities.some(a => a.delivery === 'magic' && a.effects.some(e => e.op === 'damage')),
        fortified: entrenched(target),
        nearEngineer: engineers.some(e => d(ctx.node(e), at) <= 1),
        targetNearCore: !!core && d(ctx.node(core), at) <= 1,
        counter: hostile.has(target.id),
        intercept: !inFrontZone(startOf(target), true) && inFrontZone(at, false),
        flankMove: !order.ranged && allies.some(a => d(ctx.node(a), at) <= 1 && ctx.node(a).id !== landing.id),
      });
    }
    return f;
  };
}
