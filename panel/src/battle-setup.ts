import { DEFAULT_SMALL_ROUND_LIMIT, defaultBattleObjective, type SmallBattle, hasFlightAbility, isAirborne, needsFormationHost, flightCapabilityReason, standardConditionMap, FORMATION_NODES, type BattlefieldSpec, type Combatant } from '../../engine/src/index.js';
import { MAX_SCENE_UNITS, RECOMMENDED_UNITS, GROUPING_HINT } from './narrative-limits.js';

export function battleCapacityIssue(roster: Combatant[]): string | undefined {
  const count = roster.filter((u) => u.hp > 0 && u.status === 'ready').length;
  return count > MAX_SCENE_UNITS ? `本场有${count}个参战单位，超过${MAX_SCENE_UNITS}张卡上限。请先减少本场名单；档案和人数保留。${GROUPING_HINT}` : undefined;
}

/** 为未指定阵位的编队分配实际空位；不重写明确部署，不修改长期档案。 */
export function prepareMassRoster(roster: Combatant[]): Combatant[] {
  const issue = battleCapacityIssue(roster); if (issue) throw new Error(issue);
  const units = structuredClone(roster), occupied = new Map<string, number>();
  const explicit = (u: Combatant) => !!u.formationPosition || u.tags.some((t) => t.startsWith('zone:')) && u.tags.some((t) => t.startsWith('rank:'));
  const ordered = [...units].sort((a, b) => Number(explicit(b)) - Number(explicit(a)) || a.id.localeCompare(b.id));
  for (const side of ['ally', 'enemy'] as const) {
    const group = ordered.filter((u) => u.side === side), combatants = group.filter((u) => !needsFormationHost(u));
    for (const [index, unit] of combatants.entries()) {
      const zone = unit.tags.find((t) => t.startsWith('zone:'))?.slice(5);
      const rank = unit.tags.find((t) => t.startsWith('rank:'))?.slice(5);
      const preferredWing = zone ?? ['左翼', '中军', '右翼'][Math.floor(index * 3 / Math.max(1, combatants.length))]!;
      const preferredRank = rank ?? (unit.weapon?.tags?.includes('ranged') ? 'rear' : unit.archetype === 'mobile' ? 'reserve' : 'front');
      const air = unit.airborne ?? !flightCapabilityReason(unit, standardConditionMap());
      const key = (id: string) => id + ':' + Number(air);
      const candidates = FORMATION_NODES.filter((n) => n.side === side
        && (!unit.formationPosition || n.id === unit.formationPosition) && (!zone || n.wing === zone) && (!rank || n.rank === rank));
      const node = candidates.filter((n) => (occupied.get(key(n.id)) ?? 0) < 3)
        .sort((a, b) => Number(b.rank === preferredRank) - Number(a.rank === preferredRank)
          || Number(b.wing === preferredWing) - Number(a.wing === preferredWing)
          || (occupied.get(key(a.id)) ?? 0) - (occupied.get(key(b.id)) ?? 0) || a.y - b.y || a.x - b.x)[0];
      if (!node) throw new Error(`${side === 'ally' ? '我方' : '敌方'}阵位容量不足；请调整明确部署或减少本场名单，档案未改变`);
      occupied.set(key(node.id), (occupied.get(key(node.id)) ?? 0) + 1);
      unit.tags = [...unit.tags.filter((t) => !t.startsWith('zone:') && !t.startsWith('rank:')), 'zone:' + node.wing, 'rank:' + node.rank];
      if (unit.formationPosition) unit.formationPosition = node.id;
    }
  }
  return units;
}

export type BattleObjectiveMode = 'auto' | 'annihilation' | 'siege' | 'control' | 'escort' | 'intercept';
export function normalizeObjectiveMode(value: unknown): BattleObjectiveMode {
  return value === 'escort' || value === 'intercept' || value === 'siege' || value === 'annihilation' ? value : 'auto';
}

/** 只准备下一场任务；对象和规则随战场快照冻结。 */
export function prepareBattleObjective(field: BattlefieldSpec, roster: Combatant[], mode: BattleObjectiveMode, protagonistId?: string, attackingSide: 'ally' | 'enemy' = 'ally'): BattlefieldSpec {
  if (!['escort', 'intercept'].includes(mode)) {
    const siege = mode === 'siege' || (mode === 'auto' || mode === 'control') && field.environment?.includes('siege');
    return { ...field, objective: { ...defaultBattleObjective(field.width, field.height, siege ? ['siege'] : [], attackingSide), limit: field.objective.limit } };
  }
  const side = mode === 'intercept' ? 'enemy' : 'ally';
  const eligible = roster.filter((u) => u.side === side && u.hp > 0 && u.status === 'ready');
  const escorted = eligible.find((u) => u.id === protagonistId) ?? eligible[0];
  if (!escorted) throw new Error(side === 'enemy' ? '拦截任务需要可参战的敌方护送对象' : '护送任务需要可参战的我方单位');
  return { ...field, objective: { kind: 'escape', unitId: escorted.id,
    cell: (side === 'enemy' ? (field.height - 1) * field.width : 0) + Math.floor(field.width / 2),
    limit: field.objective.limit, defenderWins: true } };
}

/** 默认模式只在准备下一战时计算，不转换单位身份或进行中的战斗。 */
export function recommendBattleMode(roster: Combatant[]): { mode: 'small' | 'mass'; reason: string } {
  if (roster.some((u) => u.rulesVersion !== 'v2')) return {
    mode: roster.some((u) => u.scale === 'company') ? 'mass' : 'small', reason: '旧单位沿用原战斗规则',
  };
  const units = roster.filter((u) => u.hp > 0 && u.status === 'ready' && (u.side === 'ally' || u.side === 'enemy'));
  for (const side of ['ally', 'enemy']) {
    const group = units.filter((u) => u.side === side);
    const people = group.filter(needsFormationHost).length;
    const hosts = group.filter((u) => u.scale !== 'hero' && ((u.body ?? 'human') !== 'human' || !isAirborne(u) && !hasFlightAbility(u))).length;
    if (people > hosts) return { mode: 'small', reason: '有独立参战人物，采用逐单位行动的小战' };
  }
  // 地图承载的是可操作实体，编队人数不等于格子数，也不能用师团等名称判定。
  if (units.length > RECOMMENDED_UNITS) return { mode: 'mass', reason: '参战单位较多，采用编队军令与阶段结算' };
  return { mode: 'small', reason: '参战单位数量适合战术地图，保留具体移动与目标操作' };
}

/** 只延长尚未结束的旧默认小战，不改已判胜战果或其他自定义期限。 */
export function extendSmallRoundLimit(battle: SmallBattle): void {
  if (battle.battlefield?.objective.limit === 12 && !battle.isOver()) battle.battlefield.objective.limit = DEFAULT_SMALL_ROUND_LIMIT;
}

/** 更新未结束的旧默认占点战：不重判历史战果。 */
export function upgradeDefaultObjective(battle: SmallBattle, attackingSide: 'ally' | 'enemy' = 'ally'): void {
  const field = battle.battlefield;
  if (!field || battle.isOver() || field.objective.kind !== 'control' || field.objective.rounds > 2 || field.objective.attackingSide) return;
  field.objective = { ...defaultBattleObjective(field.width, field.height, battle.fieldTags, attackingSide), limit: field.objective.limit };
  battle.controlRounds = { ally: 0, enemy: 0 }; battle.controlHold = undefined;
}
