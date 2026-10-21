import { DEFAULT_SMALL_ROUND_LIMIT, defaultBattleObjective, type SmallBattle, needsFormationHost, recommendedFormationSlots, flightCapabilityReason, standardConditionMap, FORMATION_NODES, type BattlefieldSpec, type Combatant } from '../../engine/src/index.js';
import { activeBattleUnits } from '../../engine/src/battle-limits.js';
import { MAX_SCENE_UNITS, RECOMMENDED_UNITS, GROUPING_HINT } from './narrative-limits.js';
import {groundBlocked} from '../../engine/src/small/layers.js';
import { gridCostsToGoals, gridDistance, movementStepCost, prepareGridDeployment, neighbors } from '../../engine/src/small/spatial.js';

export function battleCapacityIssue(roster: Combatant[]): string | undefined {
  const count = activeBattleUnits(roster).length;
  return count > MAX_SCENE_UNITS ? `本场有${count}个参战单位，超过${MAX_SCENE_UNITS}张卡上限。请先减少本场名单；档案和人数保留。${GROUPING_HINT}` : undefined;
}

/** 为未指定阵位的编队分配实际空位；不重写明确部署，不修改长期档案。 */
export function prepareMassRoster(roster: Combatant[]): Combatant[] {
  const issue = battleCapacityIssue(roster); if (issue) throw new Error(issue);
  const v2 = roster.every(u => u.rulesVersion === 'v2');
  const units = structuredClone(roster), occupied = new Map<string, number>(), slots = recommendedFormationSlots(roster);
  const explicit = (u: Combatant) => !!u.formationPosition || u.tags.some((t) => t.startsWith('zone:')) && u.tags.some((t) => t.startsWith('rank:'));
  const ordered = [...units].sort((a, b) => Number(explicit(b)) - Number(explicit(a)) || a.id.localeCompare(b.id));
  for (const side of ['ally', 'enemy'] as const) {
    const group = activeBattleUnits(ordered).filter((u) => u.side === side);
    const hosts = group.filter(u => v2 && !needsFormationHost(u) && u.scale !== 'hero' && u.hp > 0 && u.status === 'ready'
      && ((u.body ?? 'human') !== 'human' || flightCapabilityReason(u, standardConditionMap()) !== undefined));
    const attachedHeroes = new Set(group.filter(needsFormationHost).sort((a,b) => a.id.localeCompare(b.id)).slice(0, hosts.length).map(u => u.id));
    const combatants = group.filter(u => !attachedHeroes.has(u.id));
    for (const [index, unit] of combatants.entries()) {
      const zone = unit.tags.find((t) => t.startsWith('zone:'))?.slice(5);
      const rank = unit.tags.find((t) => t.startsWith('rank:'))?.slice(5);
      const preferredWing = zone ?? ['左翼', '中军', '右翼'][Math.floor(index * 3 / Math.max(1, combatants.length))]!;
      const preferredRank = rank ?? (unit.weapon?.tags?.includes('ranged') ? 'rear' : unit.archetype === 'mobile' ? 'reserve' : 'front');
      const air = v2 && (unit.airborne ?? !flightCapabilityReason(unit, standardConditionMap()));
      const key = (id: string) => id + ':' + Number(air);
      const candidates = FORMATION_NODES.filter((n) => n.side === side
        && (!unit.formationPosition || n.id === unit.formationPosition) && (!zone || n.wing === zone) && (!rank || n.rank === rank));
      const node = candidates.filter((n) => (occupied.get(key(n.id)) ?? 0) < slots)
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
  return value === 'escort' || value === 'intercept' || value === 'siege' || value === 'control' || value === 'annihilation' ? value : 'auto';
}

/** Shared eligibility for model choices and final objective preparation. */
export function vipCandidates(roster: Combatant[], side: 'ally' | 'enemy'): Combatant[] {
  return roster.filter(u => u.side === side && u.hp > 0 && u.status === 'ready');
}

/** 只准备下一场任务；对象和规则随战场快照冻结。 */
export function prepareBattleObjective(field: BattlefieldSpec, roster: Combatant[], mode: BattleObjectiveMode, _protagonistId?: string, attackingSide: 'ally' | 'enemy' = 'ally', selectedVipId?: string): BattlefieldSpec {
  const binding=field.scene?.objectiveRegion,region=binding?field.scene?.regions.find(r=>r.id===binding.id):undefined;
  const targetCells=region?.access.filter(p=>!groundBlocked(field,p))??[];
  if(binding&&!targetCells.length)throw new Error('正文任务地点没有合法目标格');
  if (!['escort', 'intercept'].includes(mode)) {
    const siegeScene = field.generation?.scene ? ['city_siege','building_siege'].includes(field.generation.scene) : field.environment?.includes('siege');
    const siege = mode === 'siege' || mode === 'auto' && siegeScene;
    if (siege && binding?.relation === 'targets') return { ...field, objective: { kind: 'control', cell: neutralControlCell(field, roster, targetCells),
      cells: targetCells, attackingSide: binding.side !== 'neutral' ? binding.side : attackingSide, rounds: 2, limit: field.objective.limit } };
    if (siege && field.layerVersion && field.city?.core.length) return { ...field, objective: { kind: 'control', cell: field.city.core[0]!, cells: [...field.city.core], attackingSide, rounds: 2, limit: field.objective.limit } };
    if ((mode === 'control' || mode === 'auto' && binding?.relation === 'targets') && !siege) {
      const cells = binding?.relation === 'targets' ? targetCells : undefined;
      return { ...field, objective: { kind: 'control', cell: neutralControlCell(field, roster, cells),
        ...(cells ? { cells, ...(mode !== 'control' && binding!.side !== 'neutral' ? { attackingSide: binding!.side } : {}) } : {}), rounds: 2, limit: field.objective.limit } };
    }
    const next = defaultBattleObjective(field.width, field.height, siege ? ['siege'] : [], attackingSide);
    if (field.layerVersion && !siege) next.cell = field.city?.core[0] ?? field.objective.cell;
    if (siege && groundBlocked(field, next.cell)) next.cell = field.tiles.flatMap((_, p) => !groundBlocked(field, p) ? [p] : [])
      .sort((a, b) => gridDistance(field, a, next.cell) - gridDistance(field, b, next.cell) || a - b)[0] ?? next.cell;
    return { ...field, objective: { ...next, limit: field.objective.limit } };
  }
  const side = mode === 'intercept' ? 'enemy' : 'ally';
  const eligible = vipCandidates(roster, side);
  const escorted = eligible.find(u => u.id === selectedVipId) ?? eligible[0];
  if (!escorted) throw new Error(side === 'enemy' ? '拦截任务需要可参战的敌方护送对象' : '护送任务需要可参战的我方单位');
  if(binding?.relation==='exits_at'&&(binding.side!==side||binding.unitId&&binding.unitId!==escorted.id))throw new Error('正文出口所属部队与护送对象不一致');
  return { ...field, objective: { kind: 'escape', unitId: escorted.id,
    cell: escapeDestination(field, side, roster, escorted.id, binding?.relation === 'exits_at' ? targetCells : undefined),
    limit: field.objective.limit, defenderWins: true } };
}
/** Use saved individual posts without changing the roster or recalculating its deployment. */
function objectiveDeployment(field: BattlefieldSpec, roster: Combatant[]): Combatant[] {
  const active = activeBattleUnits(roster);
  return field.initialDeployment ? active.map(u => ({ ...u, ...field.initialDeployment![u.id] })) : prepareGridDeployment(field, active, 'objective-position');
}
/** Assess routes after opening doors, without opening them in the saved battle or bypassing walls. */
function objectiveDoorways(field: BattlefieldSpec): BattlefieldSpec {
  return { ...field, structures: field.structures?.map(s => s?.kind === 'gate' && s.hp > 0 ? { ...s, gateState: 'open' } : s) };
}
function objectiveGroundStarts(field: BattlefieldSpec, unit: Combatant): number[] {
  if (unit.elevation !== 1 || unit.airborne) return [unit.pos!];
  const platforms = [unit.pos!], seen = new Set(platforms), ground = new Set<number>();
  const walker = { ...unit, elevation: undefined };
  for (let i = 0; i < platforms.length; i++) for (const p of neighbors(field, platforms[i]!)) {
    if (!groundBlocked(field, p, walker)) ground.add(p);
    const s = field.structures?.[p];
    if (s?.hp && s.top && !seen.has(p)) { seen.add(p); platforms.push(p); }
  }
  return [...ground];
}
function neutralControlCell(field: BattlefieldSpec, roster: Combatant[], region?: number[]): number {
  const active = activeBattleUnits(roster);
  const sides = (['ally', 'enemy', 'neutral'] as const).filter(side => active.some(u => u.side === side));
  if (sides.length < 2) return region?.[0] ?? field.objective.cell;
  const deployed = objectiveDeployment(field, roster), routes = objectiveDoorways(field);
  const walker = { ...active[0]!, body: 'human' as const, traits: [], traitSources: [], airborne: false, elevation: undefined, mount: false };
  const costs = (side: Combatant['side']) => gridCostsToGoals(routes,deployed.filter(u=>u.side===side).flatMap(u=>objectiveGroundStarts(routes, { ...u, airborne: false })),p=>!groundBlocked(routes,p,walker),
    (p,from)=>movementStepCost(routes,from,walker,field.environment,p));
  const maps = sides.map(costs), center=Math.floor(field.height/2)*field.width+Math.floor(field.width/2);
  const candidates=(region ?? [...maps[0]!.keys()]).filter(p=>maps.every(map=>map.has(p))&&!groundBlocked(field,p,walker));
  if (!candidates.length) throw Error(`中立据点没有${sides.length === 3 ? '各方' : '双方'}步兵均可接近的位置`);
  if (region) {
    const x = region.reduce((s, p) => s + p % field.width, 0) / region.length, y = region.reduce((s, p) => s + Math.floor(p / field.width), 0) / region.length;
    return candidates.sort((a,b) => Math.abs(a%field.width-x)+Math.abs(Math.floor(a/field.width)-y)
      -Math.abs(b%field.width-x)-Math.abs(Math.floor(b/field.width)-y)||a-b)[0]!;
  }
  const distances = (p: number) => maps.map(map => map.get(p)!);
  const spread = (p: number) => Math.max(...distances(p)) - Math.min(...distances(p));
  return candidates.sort((a,b)=>spread(a)-spread(b)
    || Math.max(...distances(a))-Math.max(...distances(b)) || gridDistance(field,a,center)-gridDistance(field,b,center) || a-b)[0]!;
}
function oppositeEscapeEdge(field:BattlefieldSpec,side:'ally'|'enemy'):number {
  const edge=field.retreatEdges?.[side];
  if(edge?.length){const p=edge[Math.floor(edge.length/2)]!;if(edge.every(p=>p%field.width===0))return Math.floor(p/field.width)*field.width+field.width-1;
    if(edge.every(p=>p%field.width===field.width-1))return Math.floor(p/field.width)*field.width;
    return (Math.floor(p/field.width)===0?field.height-1:0)*field.width+p%field.width;}
  return (side==='enemy'?(field.height-1)*field.width:0)+Math.floor(field.width/2);
}
function escapeDestination(field: BattlefieldSpec, side: 'ally' | 'enemy', roster: Combatant[], vipId: string, region?: number[]): number {
  const vip = objectiveDeployment(field, roster).find(u => u.id === vipId)!;
  const routes = objectiveDoorways(field);
  const walker = { ...vip, elevation: undefined };
  const costs = gridCostsToGoals(routes, objectiveGroundStarts(routes, vip), p => !groundBlocked(routes, p, walker),
    (p, from) => movementStepCost(routes, from, walker, field.environment, p));
  const wanted = oppositeEscapeEdge(field, side), x = wanted % field.width, y = Math.floor(wanted / field.width);
  const boundary = field.tiles.flatMap((_, p) => p % field.width === 0 || p % field.width === field.width - 1 || p < field.width || p >= field.tiles.length - field.width ? [p] : []);
  const candidates = (region ?? boundary).filter(p => !groundBlocked(field, p) && costs.has(p));
  if (!candidates.length) throw Error('护送撤离点没有护送对象可到达的合法位置');
  const sameEdge = (p: number) => x === 0 ? p % field.width === 0 : x === field.width - 1 ? p % field.width === x
    : Math.floor(p / field.width) === y;
  const cx = region ? region.reduce((s, p) => s + p % field.width, 0) / region.length : x;
  const cy = region ? region.reduce((s, p) => s + Math.floor(p / field.width), 0) / region.length : y;
  return candidates.sort((a, b) => (region ? 0 : Number(sameEdge(b)) - Number(sameEdge(a)))
    || Math.abs(a % field.width - cx) + Math.abs(Math.floor(a / field.width) - cy)
      - Math.abs(b % field.width - cx) - Math.abs(Math.floor(b / field.width) - cy)
    || costs.get(a)! - costs.get(b)! || a - b)[0]!;
}

/** 默认模式只在准备下一战时计算，不转换单位身份或进行中的战斗。 */
export function recommendBattleMode(roster: Combatant[]): { mode: 'small' | 'mass'; reason: string } {
  const units = activeBattleUnits(roster);
  // 地图承载的是可操作实体，编队人数不等于格子数，也不能用师团等名称判定。
  if (units.length > RECOMMENDED_UNITS) return { mode: 'mass', reason: '参战单位超过32张，采用会战军令与阶段结算；人物身份保持不变' };
  return { mode: 'small', reason: '参战单位不超过32张，采用小战地图，保留具体移动与目标操作' };
}

/** 只延长尚未结束的旧默认小战，不改已判胜战果或其他自定义期限。 */
export function extendSmallRoundLimit(battle: SmallBattle): void {
  if (battle.battlefield?.objective.limit === 12 && !battle.isOver()) battle.battlefield.objective.limit = DEFAULT_SMALL_ROUND_LIMIT;
}

/** 更新未结束的旧默认占点战：不重判历史战果。 */
export function upgradeDefaultObjective(battle: SmallBattle): void {
  const field = battle.battlefield;
  if (!field || battle.isOver() || field.objective.kind !== 'control') return;
  field.objective = { ...field.objective, rounds: 2 };
}
