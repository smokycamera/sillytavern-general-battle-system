import { commanderScores, normalizeCommanderProfiles, type CommanderProfiles } from '../commander-profile.js';
import { validateAccessories } from '../items.js';
import { areaTargets, zoneTarget, placeZone, settleZones, validateAreas, ZONE_NAMES } from '../area-effects.js';
import { tbWeaponShortName } from '../weapon-name.js';
import { casualtyXp, initialXpStrength } from '../casualty-xp.js';
import { roundDamage } from '../probability.js';
import { prepareCombatModel, healingYield } from '../combat-model.js';
import { upgradeCombatSkills } from '../skill-upgrade.js';
import { normalizeTactic, type TacticalPreference } from '../tactical-preference.js';
import { calibrateAutocannon, calibrateWeaponHands } from '../gen/equipment.js';
import { rangedScreen, rangedScreenReason } from '../guard-screen.js';
import { spCapacity } from '../resources.js';
import type { EffectOp } from '../types.js';
import { skillWeapon, skillResourceChange, skillResourceCost, conjureSkillUnit, conjuredTemplate } from '../skill-runtime.js';
import { applySkillTrait } from '../skill-effects.js';
import { BattleFeedback, type FeedbackUnit } from '../battle-feedback.js';
import { restoreMassReport, type MassRoundReport, type MassPhase } from './feedback.js';
import { skillAttack } from '../skill-attack.js';
import { prepareCondition, applySkillCondition, dispelCandidates, applyDispel, pushPreview, pushStrength, skillEffectLines, skillEffectValue, conditionChance } from '../skill-effects.js';
import { applyWeaponConditions, poisonDamage, poisonFactor, conditionDamage } from '../afflictions.js';
import { isRangedWeapon, meleeWeapon, weaponReloadKey, weaponReloadTurns, validateMount, mountedShooting, mobileRangedWeapon, vehicleShooting } from '../loadout.js';
import { meleeReach } from '../melee.js';
import { MAX_RALLY_ATTEMPTS, moraleProfile, moraleAttackMods, decideMorale, changeMorale, validateMoraleState, moraleRisk, moraleChangePreview, reconcileDamageMorale } from '../morale.js';
import { applyHealthLoss, applyCombatDamage, applyRecovery, recoveryCapacity, regenerationAmount, validateWounded } from '../recovery.js';
import {hasMemberHealth,memberHealth,MEMBER_HEALTH_MODEL} from '../member-health.js';
import { diceAvg } from '../data/weapons.js';
/**
 * 军团管线（两军对垒）：指令 → 分阶段结算 → 士气与溃逃 → 疲劳。
 * 与小规模管线共用 Combatant 与伤害管线；连队的 hp 即兵员数。
 *
 * 回合结构：
 *   ① 双方面板下达指令（每单位一条，指挥点限制特殊指令）
 *   ② 冲锋阶段 → 近战阶段 → 齐射阶段（远程被贴身失效）
 *   ③ 士气阶段：重伤亡/濒溃/邻近溃逃连锁 → 检定失败则溃逃
 *   ④ 疲劳、重整、指挥点刷新
 */

import { deployVanguardFormation, validateVanguardOrigin, needsFormationHost } from './formation.js';
import type { Ability, BattleLogEntry, Combatant, RulePack, Side, Trait } from '../types.js';
import type { ConditionDef } from '../types.js';
import type { Rng } from '../rng.js';
import { SeededRng, liveRng, randomSeed } from '../rng.js';
import { rollDice } from '../dice.js';
import { isAirborne, sameLayer, hasFlightAbility, flightCapabilityReason, flightMaintenanceReason, aerialTargetReason, fallDamage, validateFlightState } from '../aerial.js';
import { sharedParticipants, engagementWidth } from '../exposure.js';
import { resolveAttack, isRangedCapable, recordAppliedDamage, applyResolutionDamage } from '../damage.js';
import { grantBarrier, decayBarrier, validateBarrier } from '../barrier.js';
import { ConditionRegistry } from '../conditions.js';
import { MASS_TW, counterMod, rulesById } from '../rules.js';
import { traitRuntimeMods, getTrait, fieldModsFor, collectMods, resolveStack } from '../bonus.js';
import { activeTraitIds, activeConditionIds, expireTraitSources, traitSourceActive } from '../trait-sources.js';
import { bracePose, formationMarchSteps, settleFatigue, fatigueAfter } from '../tactics.js';
import { environmentTags, macroTerrain } from '../environment.js';
import { traitRegistry as defaultTraitRegistry } from '../data/traits.js';
import { pointBlankModifier, abilityTargetReason, abilityUsabilityReason } from '../actions.js';
import { positionedUnit, observedUnits, observeEvent, observedLog, revealUnit, revealContacts, settleConcealment, canReconceal, validateConcealment, type ObservationContext } from '../observation.js';
import { FORMATION_NODES, RANKS, formationNode, formationDistance, formationShotReason, formationScreened, formationCanOccupy, formationNodeDistance, validateFormationPosition, setFormation } from './formation.js';
import { previewAttack, formatResolution, type AttackResolution, type AttackOpts } from '../damage.js';

export type OrderType =
  | 'takeoff'
  | 'land'
  | 'ability'
  | 'attack'
  | 'charge'
  | 'volley'
  | 'hold'
  | 'brace'
  | 'retreat'
  | 'shift-left'
  | 'shift-right'
  | 'rank-forward'
  | 'rank-back';

export interface Order {
  /** 自动临时决策在下轮重评；玩家明确军令可以持续继承。 */
  automatic?: boolean;
  abilityId?: string;
  abilityActorId?: string;
  unitId: string;
  type: OrderType;
  targetId?: string;
}

export interface MassBattleOpts {
  nonLethal?: boolean;
  combatants: Combatant[];
  /** 新会战的有限结束阈值；旧快照保留原20轮。普通界面不要求玩家配置。 */
  roundLimit?: 20 | 40;
  rules?: RulePack;
  rng?: Rng;
  seed?: string;
  extraConditions?: ConditionDef[];
  traitRegistry?: Map<string, Trait>;
  /** 战区（可选）：如 ['左翼','中军','右翼']；相邻关系用于溃逃连锁 */
  zones?: string[];
  /** 我方主指挥单位 id：阵亡/溃逃后指挥点刷新减半并失去手动指挥资格 */
  commanderId?: string;
  /** 战场环境标签（urban/siege/plains/night…），与 fieldMod 特质联动 */
  field?: { tags: string[] };
  /** 召唤落地回调：summon 效果由面板层生成单位并加入会战（引擎保持纯数值）。
   *  返回 null 表示无可用模板（召唤失败，仅记录意图）。 */
  summonUnit?: (templateId: string, side: Side, seed?: string) => Combatant | null;
}

const ZONE_ADJACENCY_DEFAULT: Record<string, string[]> = {
  左翼: ['中军'],
  中军: ['左翼', '右翼'],
  右翼: ['中军'],
};

/** 疲劳等级 → 状态条件 id */
const FATIGUE_COND = ['', 'fat-1', 'fat-2', 'fat-3', 'fat-4'];

export class MassBattle {
  readonly nonLethal: boolean;
  defeatedIds = new Set<string>();
  allyTactic: TacticalPreference = 'balanced';
  commanderProfiles: CommanderProfiles = {};
  private flightCauses = new Map<string, string>();
  previousOrders = new Map<string, Order>();
  resolvedRounds = new Set<number>();
  exposedHeroes = new Set<string>();
  lastPhases: string[] = [];
  frontControl: Record<string, 'ally' | 'enemy' | 'contested' | 'empty'> = {};
  private locked = false;
  private feedback?: BattleFeedback;
  private pendingReport?: MassRoundReport;
  private lastReport?: MassRoundReport;
  readonly combatants: Combatant[];
  readonly rules: RulePack;
  readonly rng: Rng;
  readonly conditions: ConditionRegistry;
  readonly traitRegistry: Map<string, Trait>;
  readonly seed: string;
  readonly roundLimit: 20 | 40;
  readonly zones?: string[];
  round = 0;
  log: BattleLogEntry[] = [];
  orders = new Map<string, Order>();
  cp: Record<'ally' | 'enemy', number> = { ally: 0, enemy: 0 };
  /** 本回合各单位的伤亡累计（士气检定用） */
  damageTaken = new Map<string, number>();
  /** 英雄嵌入：companyId → heroId */
  attached = new Map<string, string>();
  xpMinimum = new Map<string, number>();
  /** 本战固定的人均经验分母，不能用战后残员替代。 */
  xpInitialStrength = new Map<string, number>();
  xpGained = 0;
  /** 击杀记名经验：击破者 id → 累计值（战后按单位分配用） */
  xpByUnit = new Map<string, number>();
  /** 我方主指挥单位 id（指挥权门禁与阵亡惩罚用） */
  commanderId?: string;
  /** 主指挥是否已阵亡/溃逃 */
  commanderLost = false;
  /** 各单位累计溃逃次数（重整 DC 递增、三次溃散离场） */
  routCounts = new Map<string, number>();
  /** 战场环境标签 */
  readonly fieldTags: string[];
  /** 召唤落地回调 */
  readonly summonUnit?: (templateId: string, side: Side, seed?: string) => Combatant | null;
  /** 武器装填冷却：单位 id → 剩余装填回合 */
  reloadCd = new Map<string, number>();
  private started = false;

  constructor(opts: MassBattleOpts) {
    this.nonLethal = opts.nonLethal === true;
    if (opts.roundLimit !== undefined && ![20, 40].includes(opts.roundLimit)) throw new Error('会战轮次期限损坏');
    this.roundLimit = opts.roundLimit ?? 40;
    this.combatants = opts.combatants;
    this.xpMinimum = initialXpStrength(this.combatants);
    this.xpInitialStrength = initialXpStrength(this.combatants);
    for (const unit of this.combatants) unit.nonLethal = this.nonLethal;
    for (const unit of this.combatants) { calibrateAutocannon(unit.weapon); calibrateAutocannon(unit.sidearm); calibrateWeaponHands(unit.weapon); calibrateWeaponHands(unit.sidearm); }
    for (const unit of this.combatants) { validateConcealment(unit.tacticalRevealed); validateVanguardOrigin(unit.vanguardOrigin, unit.side); }
    this.rules = opts.rules ?? MASS_TW;
    if(this.rules.combatModel)for(const unit of this.combatants){prepareCombatModel(unit,this.rules);upgradeCombatSkills(unit);}
    for (const u of this.combatants) { validateFlightState(u.airborne); validateFormationPosition(u.formationPosition); validateWounded(u); validateBarrier(u.barrier); validateAreas(u); validateAccessories(u); validateMount(u); validateMoraleState(u.moraleState); }
    for (const unit of this.combatants) reconcileDamageMorale(unit);
    if (this.rules.resolutionVersion !== 'v2' && this.combatants.some((u) => u.airborne || u.formationPosition !== undefined)) throw new Error('空域位置需要V2会战规则');
    this.seed = opts.seed ?? randomSeed();
    this.rng = opts.rng ?? (opts.seed || this.rules.resolutionVersion === 'v2' ? new SeededRng(this.seed) : liveRng());
    this.conditions = new ConditionRegistry([
      ...FATIGUE_TIER_DEFS,
      ...(opts.extraConditions ?? []),
    ]);
    for (const u of this.combatants) if (u.airborne && flightMaintenanceReason(u, this.conditions)) throw new Error('空中存档记录缺少可维持的飞行能力');
    this.traitRegistry = opts.traitRegistry ?? (this.rules.resolutionVersion === 'v2' ? defaultTraitRegistry() : new Map());
    this.zones = opts.zones;
    this.commanderId = opts.commanderId;
    this.fieldTags = this.rules.resolutionVersion === 'v2' ? environmentTags(opts.field?.tags) : opts.field?.tags ?? [];
    this.summonUnit = opts.summonUnit;
  }

  private environmentContext<T extends Omit<AttackOpts, 'rng'>>(opts: T, world = this.combatants): T {
    if (this.rules.resolutionVersion !== 'v2') return opts;
    const terrain = macroTerrain(this.fieldTags);
    const units = world.map((u) => u.id === opts.attacker.id ? opts.attacker : u.id === opts.defender.id ? opts.defender : u);
    return { ...opts, extraMods: [...(opts.extraMods ?? []), ...moraleAttackMods(this.observationContext(units), opts.attacker, this.traitRegistry, this.observationContext(world))], fieldTags: this.fieldTags, attackerTerrain: isAirborne(opts.attacker) ? 'open' : terrain, defenderTerrain: isAirborne(opts.defender) ? 'open' : terrain, distance: formationDistance(opts.attacker, opts.defender),
      defenderEngaged: sameLayer(opts.attacker, opts.defender) && formationDistance(opts.attacker, opts.defender) <= 1 || units.some((u) => u.side !== opts.defender.side && u.status === 'ready' && !this.isAttached(u.id) && sameLayer(u, opts.defender) && formationDistance(u, opts.defender) <= 1) };
  }
  private resolveAttackWithEnvironment(opts: AttackOpts) {
    if (this.rules.resolutionVersion === 'v2') revealUnit(this.observationContext(), this.byId(opts.attacker.id));
    const result = resolveAttack(this.environmentContext(opts));
    if (this.rules.resolutionVersion === 'v2' && result.finalDamage > 0) revealUnit(this.observationContext(), this.byId(opts.defender.id));
    return result;
  }
  private previewAttackWithEnvironment(opts: Parameters<typeof previewAttack>[0], world = this.visibleCombatants(opts.attacker.side)) { return previewAttack(this.environmentContext(opts, world)); }
  isAttached(id: string): boolean { return [...this.attached.values()].includes(id); }
  private prepareFormation(): void {
    const units = structuredClone(this.combatants);
    for (const unit of units) {
      const node = formationNode(unit); if (node.side !== unit.side) throw new Error('开战部署不能位于敌方阵位');
      if (unit.airborne === undefined && !flightCapabilityReason(unit, this.conditions)) unit.airborne = true;
      if (hasFlightAbility(unit) && unit.formationPosition === undefined) unit.formationPosition = node.id;
    }
    const attached = new Map<string, string>();
    for (const hero of units.filter(needsFormationHost).sort((a, b) => a.id.localeCompare(b.id))) {
      const hosts = units.filter((u) => u.side === hero.side && u.scale !== 'hero' && u.status === 'ready' && !attached.has(u.id) && (!isAirborne(u) || (u.body ?? 'human') !== 'human'));
      const host = hosts.sort((a, b) => formationDistance(hero, a) - formationDistance(hero, b) || a.id.localeCompare(b.id))[0];
      if (!host) throw new Error('普通人物需要随队编队；无所在编队时请使用小战或明确独立平台');
      attached.set(host.id, hero.id); setFormation(hero, formationNode(host));
    }
    for (const node of FORMATION_NODES) for (const air of [false, true]) {
      if (units.filter((u) => u.status === 'ready' && ![...attached.values()].includes(u.id) && isAirborne(u) === air && formationNode(u).id === node.id).length > 3) throw new Error('宏观阵位每层容量为3支编队，请调整战前部署');
    }
    const vanguard = deployVanguardFormation(units, attached);
    this.attached = attached;
    for (const unit of this.combatants) { const placed = units.find((u) => u.id === unit.id)!; unit.tags = placed.tags; if (placed.airborne !== undefined) unit.airborne = placed.airborne; if (placed.formationPosition !== undefined) unit.formationPosition = placed.formationPosition; if (placed.vanguardOrigin) unit.vanguardOrigin = placed.vanguardOrigin; }
    for (const move of vanguard) this.recordEvent({ round: 1, kind: 'move', participants: [move.id], text: this.byId(move.id).name + (move.from.id === move.to.id ? ' 先锋部署：前出域已满或已位于先遣侧翼，保持阵位' : ` 先锋部署：前出至${move.to.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[move.to.rank]}`) });
  }
  private maneuverDestination(order: Order, units = this.combatants) {
    const actor = units.find((u) => u.id === order.unitId)!;
    let node = formationNode(actor);
    if (!['rank-forward', 'rank-back', 'shift-left', 'shift-right'].includes(order.type)) return node;
    const steps = ['rank-forward', 'rank-back'].includes(order.type) ? formationMarchSteps(actor, this.fieldTags) : 1;
    for (let step = 0; step < steps; step++) {
      const rankIndex = RANKS.indexOf(node.rank) + (order.type === 'rank-forward' ? -1 : order.type === 'rank-back' ? 1 : 0);
      const x = node.x + (order.type === 'shift-left' ? -1 : order.type === 'shift-right' ? 1 : 0);
      const dy = (order.type === 'rank-forward' ? -1 : order.type === 'rank-back' ? 1 : 0) * (actor.side === 'enemy' ? -1 : 1);
      const target = actor.formationPosition !== undefined ? FORMATION_NODES.find((n) => n.x === x && n.y === node.y + dy) : FORMATION_NODES.find((n) => n.side === actor.side && n.x === x && n.rank === RANKS[rankIndex]);
      if (!target || target.id === node.id || !formationCanOccupy(units, actor, target, this.attached)) break;
      node = target;
    }
    return node;
  }
  effectiveUnit(unit: Combatant, units = this.combatants): Combatant { return positionedUnit(this.observationContext(units), unit); }
  private flightOrderReason(unit: Combatant, airborne: boolean, units = this.combatants): string | undefined {
    if (isAirborne(unit) === airborne) return airborne ? '已经在空中' : '已经在地面';
    if (airborne) {
      const reason = flightCapabilityReason(unit, this.conditions); if (reason) return reason;
      if (this.attached.has(unit.id) && (unit.body ?? 'human') === 'human') return '该飞行编队不能承载随队者升空';
    }
    if (!formationCanOccupy(units, { ...unit, airborne }, formationNode(unit), this.attached)) return '同层落点容量不足或有敌方占位';
    return undefined;
  }
  private diveDestination(unit: Combatant, target: Combatant, units = this.combatants) {
    const from = formationNode(unit), to = formationNode(target);
    return FORMATION_NODES.filter((node) => formationNodeDistance(from, node) <= 1 && formationNodeDistance(node, to) === 1
      && formationCanOccupy(units, { ...unit, airborne: false }, node, this.attached))
      .sort((a, b) => formationNodeDistance(from, a) - formationNodeDistance(from, b) || a.y - b.y || a.x - b.x)[0];
  }
  /** 冲锋是一格真实接近；相邻缠斗没有助跑，落点仍受占位和地空层限制。 */
  private chargeDestination(unit: Combatant, target: Combatant, units = this.combatants) {
    if (formationDistance(unit, target) !== 2) return undefined;
    const from = formationNode(unit), to = formationNode(target);
    const arrival = isAirborne(unit) && !isAirborne(target) ? { ...unit, airborne: false } : unit;
    return FORMATION_NODES.filter((node) => formationNodeDistance(from, node) === 1 && formationNodeDistance(node, to) === 1
      && formationCanOccupy(units, unit, node, this.attached) && formationCanOccupy(units, arrival, node, this.attached))
      .sort((a, b) => Math.abs(a.x - from.x) - Math.abs(b.x - from.x) || a.y - b.y || a.x - b.x)[0];
  }
  private syncPassenger(host: Combatant): void {
    const hero = this.combatants.find((u) => u.id === this.attached.get(host.id)); if (!hero) return;
    if (host.formationPosition !== undefined) hero.formationPosition = host.formationPosition;
    else setFormation(hero, formationNode(host));
  }
  private landingOutcome(unit: Combatant, units = this.combatants) {
    const from = formationNode(unit), grounded = { ...unit, airborne: false };
    const landing = FORMATION_NODES.filter((node) => formationNodeDistance(from, node) <= 1 && formationCanOccupy(units, grounded, node, this.attached))
      .sort((a, b) => formationNodeDistance(from, a) - formationNodeDistance(from, b) || a.y - b.y || a.x - b.x)[0];
    return { landing, fallDamage: fallDamage(unit), forcedExit: !landing };
  }
  private abilityFlightPreview(actor: Combatant, target: Combatant, ability: Ability, units = this.combatants) {
    if (!isAirborne(target) || this.isAttached(target.id)) return undefined;
    const affected = structuredClone(target), controls = ability.effects.filter((e): e is Extract<Ability['effects'][number], { op: 'condition' }> =>
      e.op === 'condition' && !!(this.conditions.get(e.conditionId)?.skipTurn || this.conditions.get(e.conditionId)?.preventMove) && conditionChance(target, e) > 0);
    for (const effect of ability.effects) if (effect.op === 'dispel') applyDispel(affected, dispelCandidates(affected, effect));
    const dispelled = !!flightMaintenanceReason(affected, this.conditions);
    affected.conditions.push(...controls.map((e) => ({ id: e.conditionId, dur: e.dur })));
    if (!flightMaintenanceReason(affected, this.conditions)) return undefined;
    const damage = ability.effects.find((e) => e.op === 'damage');
    const known = this.visibleCombatants(actor.side, units);
    const preview = damage ? this.previewAttackWithEnvironment({ attacker: actor, defender: target, rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(known, actor, target, ability, damage) }, known) : undefined;
    const hit = preview?.anyHitChance ?? preview?.hitChance ?? 1;
    const fallChance = dispelled ? 1 : 1 - controls.reduce((chance, e) => chance * (1 - conditionChance(target, e) * (e.onDamage ? preview?.damageChance ?? 0 : e.onHit ? hit : 1)), 1);
    const result = this.landingOutcome(affected, this.visibleCombatants(actor.side, units));
    return { forcedLanding: result.landing, fallDamage: result.fallDamage, forcedExit: result.forcedExit, fallChance };
  }
  private applyFlightLoss(unit: Combatant, source?: Combatant): number {
    const damage=fallDamage(unit)*(hasMemberHealth(unit)?unit.formation!.memberHp:1),loss=applyCombatDamage(unit,damage,unit.hp);
    this.defeatUnit(unit, source); return loss;
  }
  private resolveFlightStates(): void {
    const fallen: Combatant[] = [];
    for (const unit of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id)).filter(isAirborne)) {
      const reason = flightMaintenanceReason(unit, this.conditions); if (!reason) continue;
      const outcome = this.landingOutcome(unit), source = this.combatants.find((u) => u.id === this.flightCauses.get(unit.id));
      unit.formationPosition ??= formationNode(unit).id; unit.airborne = false; delete unit.tacticalPose;
      if (outcome.landing) setFormation(unit, outcome.landing);
      const hp=memberHealth(unit), damage = this.applyFlightLoss(unit, source);
      if (!outcome.landing && unit.hp > 0) unit.status = 'fled';
      this.syncPassenger(unit); revealUnit(this.observationContext(), unit); fallen.push(unit);
      const hero = this.combatants.find((u) => u.id === this.attached.get(unit.id));
      if (hero && unit.hp > 0 && hero.status === 'ready') {
        const heroHp=hero.hp, loss = this.applyFlightLoss(hero, source); if (!outcome.landing && hero.hp > 0) hero.status = 'fled'; fallen.push(hero);
        this.recordEvent({ round: this.round, kind: 'condition', participants: [hero.id], damage:{sourceId:source?.id,targetId:hero.id,amount:heroHp-hero.hp,cause:'坠落'}, text: `${hero.name} 随运输平台迫降，损失${loss}` });
      }
      const location = outcome.landing ? `${outcome.landing.side === 'ally' ? '我方' : '敌方'}${outcome.landing.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[outcome.landing.rank]}` : '附近无落点，紧急迫降离场';
      this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], damage:{sourceId:source?.id,targetId:unit.id,amount:hp-memberHealth(unit),cause:'坠落',...(hasMemberHealth(unit)?{unit:'life' as const}:{})}, text: `${unit.name} ${reason}，迫降：${location}，坠落损失${damage}${hasMemberHealth(unit)?'生命':''}` });
    }

  }
  private settleMorale(): void {
    const units = structuredClone(this.combatants), context = this.observationContext(units);
    const decisions = [...units].sort((a, b) => a.id.localeCompare(b.id)).map((u) => ({ id: u.id, decision: decideMorale(context, u, this.round, this.rng, this.rules.morale.breakAt, this.traitRegistry) }));
    for (const { id, decision } of decisions) {
      if (decision.kind === 'none') continue;
      const unit = this.byId(id); if (decision.state) unit.moraleState = decision.state;
      if (decision.kind === 'routed') {
        unit.status = 'routing'; delete unit.tacticalPose;
        if (!this.isAttached(id)) {
          const from = formationNode(unit), to = FORMATION_NODES.find((n) => n.x === from.x && n.y === from.y + (unit.side === 'ally' ? 1 : -1));
          if (to && (to.side === unit.side || unit.formationPosition !== undefined) && formationCanOccupy(this.combatants, unit, to, this.attached)) {
            unit.formationPosition ??= from.id; setFormation(unit, to); this.syncPassenger(unit);
          }
        }
      } else if (decision.kind === 'fled') { unit.status = 'fled'; delete unit.tacticalPose; }
      else if (decision.kind === 'rallied') {
        const from = formationNode(unit), candidates = FORMATION_NODES.filter((n) => formationNodeDistance(from, n) <= 1 && (n.side === unit.side || unit.formationPosition !== undefined))
          .sort((a, b) => formationNodeDistance(from, a) - formationNodeDistance(from, b) || a.y - b.y || a.x - b.x);
        const destination = this.isAttached(id) ? from : candidates.find((n) => formationCanOccupy(this.combatants, unit, n, this.attached));
        if (!destination) {
          if (unit.moraleState!.attempts >= MAX_RALLY_ATTEMPTS) unit.status = 'fled';
          this.recordEvent({ round: this.round, kind: 'morale', participants: [id], text: `${unit.name} 无合法重整阵位，${unit.status === 'fled' ? '机会耗尽，撤离' : '仍在溃退'}` }); continue;
        }
        unit.status = 'ready'; if (destination.id !== from.id) { unit.formationPosition ??= from.id; setFormation(unit, destination); this.syncPassenger(unit); }
        changeMorale(unit, Math.max(0, this.rules.morale.breakAt + 15 - (decision.effective ?? 0)));
      }
      if (decision.text) this.recordEvent({ round: this.round, kind: 'morale', participants: [id], text: decision.text });
    }
    if (this.commanderId) this.checkCommanderLost(this.byId(this.commanderId));
  }
  private pruneArrivals(plans: Map<string, { node: typeof FORMATION_NODES[number]; airborne: boolean }>): void {
    let cancelled: boolean;
    do {
      cancelled = false;
      for (const node of FORMATION_NODES) for (const air of [false, true]) {
        const occupants = this.combatants.filter((u) => u.status === 'ready' && !this.isAttached(u.id)
          && (plans.get(u.id)?.node ?? formationNode(u)).id === node.id && (plans.get(u.id)?.airborne ?? isAirborne(u)) === air);
        if (occupants.length > 3 || new Set(occupants.map((u) => u.side)).size > 1) for (const u of occupants) if (plans.delete(u.id)) {
          cancelled = true; this.recordEvent({ round: this.round, kind: 'move', participants: [u.id], text: `${u.name} 落点或机动发生同层冲突，任务未执行` });
        }
      }
    } while (cancelled);
  }
  private takeoffThreats(actor: Combatant, units = this.combatants): Combatant[] {
    return units.filter((foe) => foe.side !== actor.side && foe.status === 'ready' && !this.isAttached(foe.id) && !isAirborne(foe) && formationDistance(foe, actor) <= 1
      && meleeWeapon(foe) && !foe.suppression && !foe.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && meleeWeapon(foe)?.recipe?.mechanism !== 'natural'));
  }
  private takeoffReactions(actor: Combatant, spent: Set<string>): void {
    for (const foe of this.takeoffThreats(actor).sort((a, b) => a.id.localeCompare(b.id))) {
      if (actor.status !== 'ready' || flightCapabilityReason(actor, this.conditions)) break;
      const weapon = meleeWeapon(foe);
      if (foe.side === actor.side || foe.status !== 'ready' || this.isAttached(foe.id) || isAirborne(foe) || formationDistance(foe, actor) > 1 || !weapon || foe.suppression || spent.has(foe.id)
        || foe.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && meleeWeapon(foe)?.recipe?.mechanism !== 'natural')) continue;
      spent.add(foe.id);
      const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: actor, rng: this.rng, rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
        weaponOverride: weapon, ranged: false, participants: sharedParticipants(foe, this.combatants.filter((u) => !isAirborne(u) && formationNode(u).id === formationNode(foe).id), engagementWidth(foe, actor, false, undefined, this.fieldTags), actor) });
      this.recordAttack(foe, actor, result, '起飞借机');
    }
  }
  private executeManeuvers(orders: Order[], exertion: Map<string, number>, reactions: Set<string>): void {
    const units = structuredClone(this.combatants), plans = new Map<string, { node: typeof FORMATION_NODES[number]; airborne: boolean }>();
    for (const order of orders) {
      if (this.v2OrderReason(order, units)) continue;
      const actor = this.byId(order.unitId), node = formationNode(actor);
      if (order.type === 'retreat') { actor.status = 'fled'; this.orderReceipt(order, '机动', 'executed'); continue; }
      if (order.type === 'takeoff' || order.type === 'land') plans.set(actor.id, { node, airborne: order.type === 'takeoff' });
      else { const destination = this.maneuverDestination(order, units); if (destination.id !== node.id) plans.set(actor.id, { node: destination, airborne: isAirborne(actor) }); }
    }
    this.pruneArrivals(plans);
    for (const [id, plan] of plans) {
      const actor = this.byId(id);
      if (plan.airborne && !isAirborne(actor)) {
        exertion.set(id, 1); this.takeoffReactions(actor, reactions);
        if (flightCapabilityReason(actor, this.conditions)) { plans.delete(id); this.recordEvent({ round: this.round, kind: 'move', participants: [id], text: `${actor.name} 起飞被反应中断，主任务已使用` }); }
      }
    }
    this.pruneArrivals(plans);
    for (const [id, plan] of plans) {
      const actor = this.byId(id); if (actor.status !== 'ready') continue;
      const changedLayer = isAirborne(actor) !== plan.airborne;
      if (changedLayer || actor.formationPosition !== undefined) { actor.formationPosition ??= formationNode(actor).id; actor.airborne = plan.airborne; }
      setFormation(actor, plan.node); this.syncPassenger(actor); exertion.set(id, 1);
      const intent = orders.find((o) => o.unitId === id); if (intent) this.orderReceipt(intent, '机动', 'executed');
      this.recordEvent({ round: this.round, kind: 'move', participants: [id], text: `${actor.name} ${changedLayer ? plan.airborne ? '起飞' : '降落' : '机动'}至${plan.node.side === 'ally' ? '我方' : '敌方'}${plan.node.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[plan.node.rank]}${plan.airborne ? '空域' : '地面'}` });
    }
  }
  private updateFrontControl(): void {
    for (const wing of ['左翼', '中军', '右翼']) {
      const sides = new Set(this.combatants.filter((u) => u.status === 'ready' && !this.isAttached(u.id) && !isAirborne(u) && formationNode(u).wing === wing && this.rankOf(u) === 'front').map((u) => u.side));
      this.frontControl[wing] = sides.size > 1 ? 'contested' : sides.has('ally') ? 'ally' : sides.has('enemy') ? 'enemy' : 'empty';
    }
  }
  private rangedWeaponFor(actor: Combatant, target: Combatant, units = this.combatants, mobileOnly: false | 'riding' | 'vehicle' = false) {
    const weapons = [actor.weapon, actor.sidearm].filter((weapon) =>
      isRangedWeapon(weapon) && (!mobileOnly || (mobileOnly === 'riding' ? mobileRangedWeapon(weapon) : vehicleShooting(actor, weapon))) && !(this.reloadCd.get(weaponReloadKey(actor, weapon)) ?? 0)
      && !formationShotReason({ ...actor, weapon }, target, units.filter((u) => !this.isAttached(u.id)))
      && !rangedScreen(actor, target, weapon, units.filter(u => !this.isAttached(u.id)), { mode: 'mass' }, this.conditionMap()));
    if (weapons.length < 2) return weapons[0];
    const world = units.map(unit => unit.id === actor.id ? actor : unit.id === target.id ? target : unit);
    // 两槽都能射击时按当前目标的实际收益选武器，不能固定优先主槽的弱武器。
    return weapons.map(weapon => {
      const options = this.orderAttackOptions({ unitId: actor.id, type: 'volley', targetId: target.id }, world, false, weapon);
      const preview = this.previewAttackWithEnvironment(options, world);
      return { weapon, score: preview.expectedDamage + (preview.conditionValue ?? 0) };
    }).sort((a, b) => b.score - a.score)[0]!.weapon;
  }
  private mountedShotDestination(actor: Combatant, target: Combatant, units = this.combatants) {
    if (!mountedShooting(actor) || formationDistance(actor, target) > 1 || !sameLayer(actor, target)
      || activeConditionIds(actor).some((id) => this.conditions.get(id)?.preventMove)) return undefined;
    const from = formationNode(actor), node = FORMATION_NODES.find((n) => n.x === from.x && n.y === from.y + (actor.side === 'enemy' ? -1 : 1));
    if (!node || !formationCanOccupy(units, actor, node, this.attached)) return undefined;
    const future = { ...actor, formationPosition: node.id };
    return this.rangedWeaponFor(future, target, units, 'riding') ? node : undefined;
  }
  private vehicleShotDestination(actor: Combatant, target: Combatant, units = this.combatants) {
    if (!vehicleShooting(actor) || activeConditionIds(actor).some((id) => id === 'slowed' || this.conditions.get(id)?.preventMove)) return undefined;
    // 已有合法射击就保持阵位；只有稳定装置允许在同一主任务内短移找射界。
    if (this.rangedWeaponFor(actor, target, units)) return undefined;
    const from = formationNode(actor), to = formationNode(target);
    return FORMATION_NODES.filter((n) => formationNodeDistance(from, n) === 1 && (n.side === actor.side || actor.formationPosition !== undefined)
      && formationCanOccupy(units, actor, n, this.attached) && this.rangedWeaponFor({ ...actor, formationPosition: n.id }, target, units, 'vehicle'))
      .sort((a, b) => formationNodeDistance(a, to) - formationNodeDistance(b, to) || a.y - b.y || a.x - b.x)[0];
  }
  private vehicleDepartureReactions(actor: Combatant, destination: typeof FORMATION_NODES[number], spent: Set<string>): void {
    for (const foe of this.takeoffThreats(actor).filter((u) => formationNodeDistance(formationNode(u), destination) > 1).sort((a, b) => a.id.localeCompare(b.id))) {
      if (actor.status !== 'ready') break;
      if (spent.has(foe.id)) continue;
      spent.add(foe.id);
      const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: actor, weaponOverride: meleeWeapon(foe), ranged: false, rng: this.rng,
        rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
        participants: sharedParticipants(foe, this.combatants.filter((u) => sameLayer(foe, u) && formationNode(u).id === formationNode(foe).id), engagementWidth(foe, actor, false, undefined, this.fieldTags), actor) });
      this.recordAttack(foe, actor, result, '车辆脱离借机');
    }
  }
  /** 固定规划时已知占位；阶段执行仍以当时真实快照校验。 */
  private planningUnits(order: Pick<Order, 'unitId'>): Combatant[] {
    const actor = this.combatants.find((u) => u.id === order.unitId);
    return actor ? this.visibleCombatants(actor.side) : [];
  }
  private v2OrderReason(order: Order, units = this.combatants): string | undefined {
    const u = units.find((c) => c.id === order.unitId);
    if (!u || u.status !== 'ready') return '单位不存在或无法行动';
    if (u.conditions.some((c) => this.conditions.get(c.id)?.skipTurn)) return '状态令本轮无法行动';
    if (this.isAttached(u.id)) return '随队人物不能另获独立主任务';
    if (u.bornRound !== undefined && u.bornRound >= this.round) return '新生单位下轮才能行动';
    const node = formationNode(u);
    if (order.type === 'ability') {
      const originalActor = units.find((c) => c.id === (order.abilityActorId ?? u.id));
      const actor = originalActor && this.effectiveUnit(originalActor, units);
      if (!actor || actor.status !== 'ready' || actor.id !== u.id && this.attached.get(u.id) !== actor.id) return '技能来源不属于此编队';
      const ability = actor.abilities.find((a) => a.id === order.abilityId);
      if (!ability) return '技能不存在';
      if (actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn)) return '技能来源本轮无法行动';
      const rawTarget = ability.target === 'self' ? actor : ability.target === 'zone' ? zoneTarget(this.observationContext(units),actor,order.targetId) : units.find((c) => c.id === order.targetId);
      const target = rawTarget && this.effectiveUnit(rawTarget, units);
      if (ability.target === 'zone' && !target) return '请指定地面阵位';
      if (target && ability.target !== 'zone' && !this.visibleCombatants(actor.side, units).some((u) => u.id === target.id)) return '尚未观测到目标';
      if (target && target.side !== actor.side && this.isAttached(target.id)) return '随队人物受编队掩护';
      const reason = abilityUsabilityReason(actor, ability) ?? abilityTargetReason({ actor, ability, target, distance: target ? formationDistance(actor, target) : undefined });
      if (reason) return reason;
      if (ability.weaponUse && target) {
        const weapon = skillWeapon(actor, ability, formationDistance(actor, target));
        if (this.rules.combatModel === MEMBER_HEALTH_MODEL && weapon && !isRangedWeapon(weapon) && formationScreened(actor, target, units)) return '目标受到前线掩护';
        if (weapon && isRangedWeapon(weapon)) {
          if ((this.reloadCd.get(weaponReloadKey(actor, weapon)) ?? 0) > 0) return '实际武器仍在装填';
          const shot = formationShotReason({ ...actor, weapon }, target, this.visibleCombatants(actor.side, units)); if (shot) return shot;
          const guard = rangedScreen(actor, target, weapon, this.visibleCombatants(actor.side, units).filter(u => !this.isAttached(u.id)), { mode: 'mass' }, this.conditionMap());
          if (guard) return rangedScreenReason(guard);
        }
      }
      if (ability.effects.every((e) => e.op === 'push') && target) {
        const effect = ability.effects[0] as Extract<EffectOp, { op: 'push' }>;
        const push = pushPreview(this.observationContext(units), actor, target, effect); if (push.reason) return push.reason;
      }
      if (ability.effects.some((e) => e.op === 'summon' && !conjuredTemplate(e.templateId)) && !this.summonUnit) return '召唤来源未接入';
      return undefined;
    }
    if (['takeoff', 'land'].includes(order.type)) return this.flightOrderReason(u, order.type === 'takeoff', units);
    if (order.type === 'brace' && isAirborne(u)) return '空中不能固守地面战线';
    if (['hold', 'brace', 'retreat'].includes(order.type)) return undefined;
    if (['attack', 'charge', 'volley'].includes(order.type) && (order.type==='volley' || meleeWeapon(u)?.recipe?.mechanism!=='natural') && u.conditions.some((c) => this.conditions.get(c.id)?.preventAttack)) return '当前状态禁止武器攻击';
    if (order.type === 'rank-forward' && u.formationPosition === undefined && node.rank === 'front') return '已在前线';
    if (order.type === 'rank-back' && u.formationPosition === undefined && node.rank === 'reserve') return '已在预备队';
    if (['shift-left', 'shift-right', 'rank-forward', 'rank-back'].includes(order.type) && activeConditionIds(u).some((id) => this.conditions.get(id)?.preventMove)) return '定身状态不能机动';
    if (['shift-left', 'shift-right', 'rank-forward', 'rank-back'].includes(order.type)) return this.maneuverDestination(order, units).id === node.id ? '机动路线受阻或已到边界' : undefined;
    const target = units.find((c) => c.id === order.targetId);
    if (!target && order.targetId) return '尚未观测到目标';
    if (!target || target.side === u.side || !['ready', 'routing', 'dying'].includes(target.status) || this.isAttached(target.id)) return '需要合法敌方独立编队';
    if (!this.visibleCombatants(u.side, units).some((c) => c.id === target.id)) return '尚未观测到目标';
    const aerial = aerialTargetReason(u, target, order.type === 'volley'); if (aerial) return aerial;
    if (order.type === 'volley') {
      if (this.rangedWeaponFor(u, target, units) || this.mountedShotDestination(u, target, this.visibleCombatants(u.side, units)) || this.vehicleShotDestination(u, target, this.visibleCombatants(u.side, units))) return undefined;
      const rangedWeapons = [u.weapon, u.sidearm].filter(isRangedWeapon);
      if (rangedWeapons.length && rangedWeapons.every((w) => (this.reloadCd.get(weaponReloadKey(u, w)) ?? 0) > 0)) return '武器装填中';
      const weapon = rangedWeapons.find((w) => !(this.reloadCd.get(weaponReloadKey(u, w)) ?? 0)) ?? u.weapon;
      const guard = rangedScreen(u, target, weapon, units.filter(c => !this.isAttached(c.id)), { mode: 'mass' }, this.conditionMap());
      if (guard) return rangedScreenReason(guard);
      return formationShotReason({ ...u, weapon }, target, units.filter((c) => !this.isAttached(c.id))) ?? '武器装填中';
    }
    if (order.type === 'attack' || order.type === 'charge') {
      if (!meleeWeapon(u)) return '近战任务需要实际近战武器，远程副武器不能挥砍';
      if (formationScreened(u, target, units)) return '目标受到前线掩护';
      if (isAirborne(u) && !isAirborne(target) && !this.diveDestination(u, target, units)) return '扑击缺少相邻合法地面落点';
      if (order.type === 'charge' && (u.suppression || u.archetype !== 'mobile' && !activeTraitIds(u).includes('charge-strong'))) return '缺少冲锋训练或正被压制';
      if (order.type === 'charge' && u.fatigue >= 2) return '冲锋前需要重整，疲劳必须低于2';
      if (order.type === 'charge' && activeConditionIds(u).some((id) => id === 'slowed' || this.conditions.get(id)?.preventMove)) return '减速或定身状态不能完成冲锋';
      if (order.type === 'charge' && formationDistance(u, target) < 2) return '已经接敌，没有冲锋助跑距离';
      if (order.type === 'charge' && !this.chargeDestination(u, target, this.visibleCombatants(u.side, units))) return '冲锋需要一格合法接近路线和相邻落点';
      if (formationDistance(u, target) > (order.type === 'charge' ? 2 : this.rules.combatModel === MEMBER_HEALTH_MODEL ? meleeReach(meleeWeapon(u)) : 1)) return '目标不在阵位可及范围';
      return undefined;
    }
    return '不支持的任务';
  }
  abilityOrderReason(unitId: string, abilityId: string, targetId?: string): string | undefined {
    const host = [...this.attached].find(([, hero]) => hero === unitId)?.[0] ?? unitId;
    const order: Order = { unitId: host, type: 'ability', abilityActorId: unitId, abilityId, targetId };
    return this.orders.has(host) ? '所属编队已有主任务，请先撤回' : this.v2OrderReason(order, this.planningUnits(order));
  }
  private recordEvent(entry: BattleLogEntry): void {
    for(const result of entry.resolutions?.length?entry.resolutions:[entry.resolution]) if(result&&result.hpAfter<=0) result.defenderStatus=this.nonLethal?'dying':'dead';
    entry.locations ??= Object.fromEntries((entry.participants ?? []).flatMap(id => { const u = this.combatants.find(c => c.id === id); return u ? [[id, FORMATION_NODES.findIndex(n => n.id === formationNode(this.effectiveUnit(u)).id)]] : []; }));
    this.log.push(this.rules.resolutionVersion === 'v2' ? observeEvent(this.observationContext(), entry) : entry);
    this.captureFeedback();
  }
  private feedbackUnits(): FeedbackUnit[] {
    return this.visibleCombatants('ally').map((u) => ({ id: u.id, name: u.name, side: u.side, scale: u.scale, hp: u.hp, status: u.status,
      morale: u.morale ?? u.base.moraleMax ?? 100, fatigue: u.fatigue,
      cell: FORMATION_NODES.findIndex((n) => n.id === formationNode(this.effectiveUnit(u)).id),
      resources: Object.fromEntries(Object.entries(u.resources).map(([key, value]) => [key, { value,
        name: key === 'SP' ? '战技点' : key === 'reserve' ? '预备兵力' : key.startsWith('item:') ? u.abilities.find((a) => a.cost?.resource === key)?.name ?? '消耗品次数' : '资源' }])),
      effects: [...new Set([...u.conditions.filter((c) => c.dur > 0).map((c) => this.conditions.get(c.id)?.name ?? '持续效果'),
        ...(u.traitSources ?? []).filter((source) => traitSourceActive(u, source)).map((source) => source.name),
        ...(u.suppression ? ['受压制'] : []), ...(u.tacticalPose ? ['固守'] : []), ...(isAirborne(u) ? ['空中'] : []),
        ...(this.exposedHeroes.has(u.id) ? ['随队人物已暴露'] : this.isAttached(u.id) ? ['随队掩护'] : []),
      ])].sort(),
    }));
  }
  private captureFeedback(): void { if (this.feedback) this.feedback.capture(this.pendingReport!.round, this.feedbackUnits()); }
  private finishPhase(phase: MassPhase): void {
    for(const result of settleZones(this.observationContext(),this.round,phase==='重整')) { this.recordEvent({round:this.round,kind:'condition',participants:[result.target.id],text:result.text}); this.defeatUnit(result.target,result.source); }
    if (!this.feedback || !this.pendingReport) return;
    this.captureFeedback(); this.feedback.finishActivation();
    const summary = this.feedback.activation();
    this.pendingReport.phases.push({ round: this.pendingReport.round, phase, changes: summary?.changes ?? [] });
  }
  private beginPhase(phase: MassPhase): void { this.feedback?.beginActivation(this.round, phase); }
  private orderReceipt(order: Order, phase: MassPhase, status: 'executed' | 'blocked', reason?: string): void {
    const receipt = this.pendingReport?.orders.find((p) => p.order.unitId === order.unitId);
    if (receipt) { receipt.phase = phase; receipt.status = status; receipt.reason = reason; }
  }
  roundReport(): MassRoundReport | undefined { return this.lastReport ? structuredClone(this.lastReport) : undefined; }
  visibleLog(side: Side): BattleLogEntry[] { return this.rules.resolutionVersion === 'v2' ? observedLog(this.log, side) : this.log; }
  observationContext(units = this.combatants): ObservationContext { return { units, mode: 'mass', fieldTags: this.fieldTags, conditions: this.conditions, attached: this.attached, rules: this.rules, traitRegistry: this.traitRegistry, reload: this.reloadCd }; }
  visibleCombatants(side: Side, units = this.combatants): Combatant[] {
    return this.rules.resolutionVersion === 'v2' ? observedUnits(this.observationContext(units), side) : units;
  }
  private skillAttackOptions(units: Combatant[], actor: Combatant, target: Combatant, ability: Ability, effect: Parameters<typeof skillAttack>[4]) {
    const base = skillAttack(this.observationContext(units), actor, target, ability, effect, this.rules);
    if (!ability.weaponUse || !base.weaponOverride) return base;
    const close = pointBlankModifier(base.weaponOverride, !!base.ranged, sameLayer(actor, target) && formationDistance(actor, target) <= 1 ? 0 : formationDistance(actor, target), actor);
    return { ...base, extraMods: [...this.stanceMods(actor, target, {}), ...(close ? [{ source: 'stance' as const, name: '抵近射击', kind: 'atk' as const, type: 'flat' as const, value: close }] : [])], defenderMods: this.defModsFor(target) };
  }
  private supportTargets(actor: Combatant, ability: Ability, primary: Combatant, units: Combatant[]): Combatant[] {
    if (ability.area) return areaTargets({...this.observationContext(units),units:this.visibleCombatants(actor.side,units)},actor,primary,ability,u=>!this.isAttached(u.id)
      && !abilityTargetReason({actor,ability,target:u,distance:formationDistance(actor,u)})
      && (this.rules.combatModel !== MEMBER_HEALTH_MODEL || !ability.weaponUse || isRangedWeapon(skillWeapon(actor, ability)) || !formationScreened(actor,u,units))
      && (!ability.weaponUse || !rangedScreen(actor,u,skillWeapon(actor,ability,formationDistance(actor,u)),units.filter(c=>!this.isAttached(c.id)),{mode:'mass'},this.conditionMap())));
    if (ability.shape !== 'burst' && !ability.effects.some((e) => e.op === 'damage' && e.shape === 'burst')) return [primary];
    const pivot = ability.recipe?.category === 'physical-area' && ability.damageBasis && !isRangedWeapon(skillWeapon(actor, ability)) ? actor : primary;
    return [primary, ...this.visibleCombatants(actor.side, units).filter((u) => u.id !== primary.id && u.side === primary.side && u.status === 'ready' && !this.isAttached(u.id)
      && formationDistance(pivot, u) <= 1 && !abilityTargetReason({ actor, ability, target: u, distance: formationDistance(actor, u) })
      && (this.rules.combatModel !== MEMBER_HEALTH_MODEL || !ability.weaponUse || isRangedWeapon(skillWeapon(actor, ability)) || !formationScreened(actor, u, units))
      && (!ability.weaponUse || !rangedScreen(actor, u, skillWeapon(actor, ability, formationDistance(actor, u)), units.filter(c => !this.isAttached(c.id)), { mode: 'mass' }, this.conditionMap())))
      .sort((a, b) => a.id.localeCompare(b.id))].slice(0, 2);
  }
  /** 与阶段执行共享武器/展开/特质/环境；预览不读取尚未执行的敌方军令。 */
  private orderAttackOptions(order: Order, units: Combatant[], projectMovement = true, usedWeapon?: Combatant['weapon']): Omit<AttackOpts, 'rng'> {
    const source = units.find((u) => u.id === order.unitId)!;
    const target = units.find((u) => u.id === order.targetId)!;
    const known = this.visibleCombatants(source.side, units);
    const withdrawal = projectMovement && order.type === 'volley' ? this.mountedShotDestination(source, target, known) : undefined;
    const vehicleMove = projectMovement && order.type === 'volley' ? this.vehicleShotDestination(source, target, known) : undefined;
    const approach = projectMovement && order.type === 'charge' ? this.chargeDestination(source, target, known) : withdrawal ?? vehicleMove;
    const landing = projectMovement && order.type !== 'volley' && isAirborne(source) && !isAirborne(target) ? approach ?? this.diveDestination(source, target, known) : undefined;
    const actor = approach || landing ? { ...source, ...(landing ? { airborne: false } : {}), formationPosition: (approach ?? landing)!.id } : source;
    const ranged = order.type === 'volley';
    const weapon = usedWeapon ?? (ranged ? this.rangedWeaponFor(actor, target, units, withdrawal ? 'riding' : vehicleMove ? 'vehicle' : false) : meleeWeapon(actor));
    const close = pointBlankModifier(weapon, ranged, sameLayer(actor, target) && formationDistance(actor, target) <= 1 ? 0 : formationDistance(actor, target), actor);
    return { attacker: actor, defender: target, rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
      weaponOverride: weapon, ranged, charge: order.type === 'charge',
      participants: sharedParticipants(actor, units.filter((u) => sameLayer(u, actor) && formationNode(u).id === formationNode(actor).id), engagementWidth(actor, target, ranged, undefined, this.fieldTags), target),
      extraMods: [...this.stanceMods(actor, target, { charge: order.type === 'charge' }), ...(close ? [{ source: 'stance' as const, name: '抵近射击', kind: 'atk' as const, type: 'flat' as const, value: close }] : [])],
      defenderMods: this.defModsFor(target) };
  }
  orderPreview(order: Order): { effects?: string[]; fallChance?: number; areaTargets?: string[]; areaTargetIds?: string[]; areaPreviews?: { targetId: string; hitChance: number; expectedDamage: number }[]; vehicleMove?: typeof FORMATION_NODES[number]; withdrawal?: typeof FORMATION_NODES[number]; weaponName?: string; approach?: typeof FORMATION_NODES[number]; moraleBefore?: number; moraleAfter?: number; breakChance?: number; rallyChance?: number; healing?: number; reason?: string; preview?: ReturnType<typeof previewAttack>; landing?: typeof FORMATION_NODES[number]; extraFatigue?: number; forcedLanding?: typeof FORMATION_NODES[number]; fallDamage?: number; forcedExit?: boolean; reactions?: string[]; layer?: 'air' | 'ground'; destination?: typeof FORMATION_NODES[number] } {
    const known = this.planningUnits(order), reason = this.v2OrderReason(order, known);
    if (reason) return { reason };
    if (['shift-left', 'shift-right', 'rank-forward', 'rank-back'].includes(order.type)) return { destination: this.maneuverDestination(order, known), layer: isAirborne(this.byId(order.unitId)) ? 'air' : 'ground' };
    if (order.type === 'brace' && this.byId(order.unitId).combatModel === MEMBER_HEALTH_MODEL && this.byId(order.unitId).shield) return {
      effects: ['地面前排平时即遮挡直射，弓弩和法杖可越过友军但仍受敌军遮挡；固守提高正面防御，持盾时额外保护同阵位队友；独立魔法技能、空中射击、曲射火炮等间接火力及侧射可绕过盾卫的额外保护。'],
    };
    if (order.type === 'takeoff' || order.type === 'land') { const actor = this.byId(order.unitId); return { destination: formationNode(actor), layer: order.type === 'takeoff' ? 'air' : 'ground', ...(order.type === 'takeoff' ? { reactions: this.takeoffThreats(actor, known).map((u) => u.name) } : {}) }; }
    if (order.type === 'ability') {
      const actor = this.effectiveUnit(this.byId(order.abilityActorId ?? order.unitId), known), ability = actor.abilities.find((a) => a.id === order.abilityId)!;
      const target = ability.target === 'self' ? actor : ability.target === 'zone' ? zoneTarget(this.observationContext(known),actor,order.targetId) : known.find((u) => u.id === order.targetId);
      const healing = ability.effects.find((e) => e.op === 'heal'), morale = ability.effects.find((e) => e.op === 'morale'), damage = ability.effects.find((e) => e.op === 'damage');
      const strike = target && damage ? this.previewAttackWithEnvironment({ attacker: actor, defender: this.effectiveUnit(target, known), rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(known, actor, target, ability, damage) }, known) : undefined;
      const area = target && (damage?.shape ?? ability.shape) === 'burst' ? this.supportTargets(actor, ability, target, known) : [];
      const areaPreviews = damage ? area.map((affected) => ({
        targetId: affected.id,
        ...this.previewAttackWithEnvironment({ attacker: actor, defender: this.effectiveUnit(affected, known), rules: this.rules,
          conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
          ...this.skillAttackOptions(known, actor, affected, ability, damage) }, known),
      })) : [];
      return target ? {
        effects: skillEffectLines(this.observationContext(known), actor, target, ability),
        ...(strike ? { preview: strike } : {}),
        ...(area.length ? { areaTargets: area.map((u) => u.name), areaTargetIds: area.map((u) => u.id), areaPreviews } : {}),
        ...this.abilityFlightPreview(actor, target, ability, known),
        ...(morale ? moraleChangePreview(this.observationContext(known), target, morale.amount, this.rules.morale.breakAt,
          this.traitRegistry, ability.effects.flatMap((e) => e.op === 'condition' ? [{ id: e.conditionId, dur: e.dur }] : [])) : {}),
        ...(healing ? { healing: Math.min(recoveryCapacity(target), healingYield(actor,target,healing.amount ?? diceAvg(healing.dice!),!!ability.itemSourceId)) } : {}),
      } : {};
    }
    const actor = this.byId(order.unitId), target = known.find((u) => u.id === order.targetId);
    const landing = ['attack', 'charge'].includes(order.type) && target && isAirborne(actor) && !isAirborne(target) ? this.diveDestination(actor, target, known) : undefined;
    const approach = order.type === 'charge' && target ? this.chargeDestination(actor, target, known) : undefined;
    if (!['attack', 'charge', 'volley'].includes(order.type)) return {};
    const attack = this.orderAttackOptions(order, known);
    const vehicleMove = order.type === 'volley' && target ? this.vehicleShotDestination(actor, target, known) : undefined;
    return { ...(vehicleMove ? { vehicleMove, reactions: this.takeoffThreats(actor, known).filter((u) => formationNodeDistance(formationNode(u), vehicleMove) > 1).map((u) => u.name) } : {}), preview: this.previewAttackWithEnvironment(attack, known), weaponName: attack.weaponOverride?.name,
      ...(approach ? { approach } : {}), ...(order.type === 'volley' && target && this.mountedShotDestination(actor, target, known) ? { withdrawal: this.mountedShotDestination(actor, target, known) } : {}), ...(landing ? { landing: approach ?? landing, extraFatigue: 1 } : {}) };
  }
  /** UI默认方案与自动军令共用；只读取当前可观察事实，不下令、不消耗RNG。 */
  private braceThreat(unit: Combatant, units = this.visibleCombatants(unit.side)): Combatant | undefined {
    return units.filter(other => other.side !== unit.side && other.status === 'ready' && !this.isAttached(other.id))
      .sort((a, b) => formationDistance(unit, a) - formationDistance(unit, b) || a.id.localeCompare(b.id))[0];
  }
  recommendedOrder(unitId: string): Order | undefined {
    return this.recommendV2Order(unitId);
  }
  private recommendV2Order(unitId: string, allowAbilities = true): Order | undefined {
    const u = this.combatants.find((u) => u.id === unitId);
    if (!u || u.status !== 'ready' || this.isAttached(u.id) || u.bornRound === this.round || this.isOver()) return undefined;
    const side = u.side, planning = this.visibleCombatants(side);
    const remembered = this.previousOrders.get(u.id);
    if (allowAbilities && remembered && !remembered.automatic && !this.v2OrderReason(remembered, planning)) return { ...remembered };
    const destinations = new Map<string, { node: typeof FORMATION_NODES[number]; airborne: boolean } | undefined>();
    const destinationOf = (order: Order) => {
      const key = JSON.stringify(order);
      if (!destinations.has(key)) {
        const preview = this.orderPreview(order), actor = this.byId(order.unitId);
        const node = preview.destination ?? preview.approach ?? preview.landing ?? preview.vehicleMove ?? preview.withdrawal;
        destinations.set(key, node ? { node, airborne: order.type === 'takeoff' || isAirborne(actor) && order.type !== 'land' && !preview.landing } : undefined);
      }
      return destinations.get(key);
    };
    // 已下达的己方任务可协调落点，不读取敌方尚未执行的军令。
    const canReserve = (order: Order) => {
      const destination = destinationOf(order); if (!destination) return true;
      const occupants = planning.filter(other => other.id !== unitId && other.status === 'ready' && !this.isAttached(other.id)).filter(other => {
        const assigned = other.side === side ? this.orders.get(other.id) : undefined;
        const future = assigned ? destinationOf(assigned) : undefined;
        return (future?.node ?? formationNode(other)).id === destination.node.id && (future?.airborne ?? isAirborne(other)) === destination.airborne;
      });
      return occupants.length < 3 && !occupants.some(other => other.side !== side);
    };
    const foes = planning.filter((t) => t.side !== side && ['ready', 'routing'].includes(t.status) && !this.isAttached(t.id));
    const candidates: { order: Order; score: number }[] = foes.flatMap((target) => (['volley', 'attack', 'charge'] as const).map((type) => ({ unitId: u.id, type, targetId: target.id })))
      .flatMap((order) => {
        const result = this.orderPreview(order);
        if (!result.preview) return [];
        const target = foes.find((foe) => foe.id === order.targetId)!;
        return [{ order, score: Math.min(memberHealth(target), result.preview.expectedDamage) + (result.preview.conditionValue ?? 0) }];
      });
    if (u.shield && !this.v2OrderReason({ unitId, type: 'brace' }, planning)) {
      const guard = { ...u, tacticalPose: bracePose(u, this.braceThreat(u, planning), 'mass') };
      const before = planning.map(other => {
        if (other.id === u.id) return { ...u, tacticalPose: undefined };
        const assigned = other.side === side ? this.orders.get(other.id) : undefined;
        if (!assigned || this.v2OrderReason(assigned, planning)) return other;
        return { ...other, tacticalPose: assigned.type === 'brace' ? bracePose(other, this.braceThreat(other, planning), 'mass') : undefined };
      });
      const after = before.map(other => other.id === u.id ? guard : other);
      let protectedDamage = 0, supportingDamage = 0;
      const supportingAttacks = new Map<string, number>();
      for (const foe of foes) {
        let saved = 0;
        for (const ally of planning.filter(other => other.side === side && other.id !== u.id && other.status === 'ready' && !this.isAttached(other.id))) {
          const weapon = this.rangedWeaponFor(foe, ally, before);
          if (!weapon || rangedScreen(foe, ally, weapon, after, { mode: 'mass' }, this.conditionMap())?.id !== u.id) continue;
          if (!supportingAttacks.has(ally.id)) {
            const value = Math.max(0, ...foes.flatMap(target => (['attack', 'volley'] as const).map(type => {
              const order: Order = { unitId: ally.id, type, targetId: target.id };
              return this.v2OrderReason(order, before) ? 0 : Math.min(memberHealth(target), this.previewAttackWithEnvironment(this.orderAttackOptions(order, before), before).expectedDamage);
            })));
            supportingAttacks.set(ally.id, value);
          }
          supportingDamage = Math.max(supportingDamage, supportingAttacks.get(ally.id)!);
          const attack = this.orderAttackOptions({ unitId: foe.id, type: 'volley', targetId: ally.id }, before, false, weapon);
          saved = Math.max(saved, this.previewAttackWithEnvironment(attack, before).expectedDamage);
        }
        protectedDamage += saved;
      }
      // 架盾只为队友争取实际输出窗口；全队同等火力时主动攻击优于互相固守。
      const protectionValue = Math.min(protectedDamage * 0.5, supportingDamage * 0.35);
      if (protectionValue > 0) candidates.push({ order: { unitId, type: 'brace' }, score: protectionValue });
    }
    // 只观察当前公开事实；不读取另一方尚未执行的军令。
    const reservedHealing = new Map<string, number>();
    for (const assigned of this.orders.values()) {
      if (assigned.unitId === unitId || assigned.type !== 'ability') continue;
      const source = planning.find(other => other.id === (assigned.abilityActorId ?? assigned.unitId) && other.side === side);
      if (!source || this.v2OrderReason(assigned, planning)) continue;
      const actor = this.effectiveUnit(source, planning), ability = actor.abilities.find(a => a.id === assigned.abilityId)!;
      const target = ability.target === 'self' ? actor : planning.find(other => other.id === assigned.targetId) ?? actor;
      for (const effect of ability.effects) if (effect.op === 'heal') for (const affected of this.supportTargets(actor, ability, target, planning)) {
        const amount = healingYield(actor, affected, effect.amount ?? diceAvg(effect.dice!), !!ability.itemSourceId);
        reservedHealing.set(affected.id, Math.min(recoveryCapacity(affected), (reservedHealing.get(affected.id) ?? 0) + amount));
      }
    }
    const skillContext = this.observationContext(planning);
    const sources = allowAbilities ? [u, ...planning.filter((hero) => hero.id === this.attached.get(u.id))].map((actor) => this.effectiveUnit(actor, planning)) : [];
    for (const actor of sources) for (const ability of actor.abilities) {
      const targets = ability.target === 'zone' ? planning.filter(u=>u.status==='ready') : ability.target === 'self' ? [actor] : ability.target === 'ally' ? planning.filter((u) => u.side === side
        && (['ready', 'routing'].includes(u.status) || u.status === 'dying' && ability.effects.some((e) => e.op === 'heal'))) : foes;
      for (const target of targets) {
        const order: Order = { unitId: u.id, type: 'ability', abilityActorId: actor.id, abilityId: ability.id, targetId: target.id };
        if (this.v2OrderReason(order, planning)) continue;
        let score = 0;
        const plannedHealing = new Map(reservedHealing);
        const damageForControl = ability.effects.find((e) => e.op === 'damage');
        const controlPreviews = new Map<string, ReturnType<MassBattle['previewAttackWithEnvironment']>>();
        const controlChance = (affected: Combatant, needsDamage: boolean) => {
          if (!damageForControl) return 1;
          if (!controlPreviews.has(affected.id)) controlPreviews.set(affected.id, this.previewAttackWithEnvironment({ attacker: actor, defender: affected, rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(planning, actor, affected, ability, damageForControl) }));
          const preview = controlPreviews.get(affected.id)!;
          return needsDamage ? preview.damageChance ?? (preview.expectedDamage > 0 ? preview.hitChance : 0) : preview.anyHitChance ?? preview.hitChance;
        };
        for (const effect of ability.effects) {
          if (effect.op === 'damage') for (const t of this.supportTargets(actor, ability, target, planning)) {
            const preview = this.previewAttackWithEnvironment({ attacker: actor, defender: t, rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(planning, actor, t, ability, effect) });
            score += preview.expectedDamage + (preview.conditionValue ?? 0);
          }
          if (effect.op === 'heal') for (const affected of this.supportTargets(actor, ability, target, planning)) {
            const reserved = plannedHealing.get(affected.id) ?? 0;
            const amount = Math.min(Math.max(0, recoveryCapacity(affected) - reserved), healingYield(actor, affected, effect.amount ?? diceAvg(effect.dice!), !!ability.itemSourceId));
            score += amount; plannedHealing.set(affected.id, reserved + amount);
          }
          if (effect.op === 'morale') for (const affected of this.supportTargets(actor, ability, target, planning)) score += moraleChangePreview({ ...this.observationContext(planning), units: planning }, affected, effect.amount, this.rules.morale.breakAt, this.traitRegistry, ability.effects.flatMap((e) => e.op === 'condition' ? [{ id: e.conditionId, dur: e.dur }] : [])).value * (affected.side === actor.side ? 1 : -1);
          if (effect.op === 'zone' || effect.op === 'barrier' || effect.op === 'push' || effect.op === 'dispel' || effect.op === 'trait') for (const affected of this.supportTargets(actor, ability, target, planning)) score += skillEffectValue(skillContext, actor, affected, { ...ability, effects: [effect] }, controlChance(affected, false));
          if (effect.op === 'summon') {
            const node = FORMATION_NODES.find((n) => n.side === actor.side && n.wing === formationNode(actor).wing && n.rank === 'reserve')!;
            const occupied = planning.filter((c) => c.status === 'ready' && !this.isAttached(c.id) && formationNode(c).id === node.id).length;
            const owned = planning.filter((c) => c.status === 'ready' && c.summonerId === actor.id).length;
            if (occupied + effect.count <= 3 && owned + effect.count <= 2) score += 8 * effect.count;
          }
        }
        for (const affected of this.supportTargets(actor, ability, target, planning)) score += skillEffectValue(skillContext, actor, affected, { ...ability, effects: ability.effects.filter(e => e.op === 'condition') }, controlChance(affected, false), controlChance(affected, true)) * Math.max(0, 1 - (controlPreviews.get(affected.id)?.expectedDamage ?? 0) / Math.max(1, memberHealth(affected)));
        const falling = this.abilityFlightPreview(actor, target, ability, planning); if (falling) score += falling.fallDamage * (falling.fallChance ?? 1);
        for (const affected of this.supportTargets(actor, ability, target, planning)) score += skillEffectValue(skillContext, actor, affected, { ...ability, effects: ability.effects.filter(e => e.op === 'resource') });
        score -= skillResourceCost(ability);
        if (score > 0) candidates.push({ order, score: score - 0.25 });
      }
    }
    const known = planning, currentRisk = moraleRisk({ ...this.observationContext(planning), units: known }, u, this.rules.morale.breakAt, this.traitRegistry).breakChance;
    if (currentRisk > 0) for (const type of ['rank-back', 'shift-left', 'shift-right'] as const) {
      const order: Order = { unitId: u.id, type }; if (this.v2OrderReason(order, planning)) continue;
      const future = { ...u, formationPosition: this.maneuverDestination(order, planning).id };
      const after = moraleRisk({ ...this.observationContext(planning), units: known.map((x) => x.id === u.id ? future : x) }, future, this.rules.morale.breakAt, this.traitRegistry);
      candidates.push({ order, score: (currentRisk - after.breakChance) * 12 - 1 });
    }
    const focus = [...foes].sort((a, b) => formationDistance(u, a) - formationDistance(u, b) || a.id.localeCompare(b.id)).slice(0, 4);
    const futureValue = (future: Combatant) => {
        // 火力展开同样按己方已预留落点估算，避免全队都把同一空阵位当成独占位置。
        const world = planning.map(c => {
          if (c.id === u.id) return future;
          const assigned = c.side === side ? this.orders.get(c.id) : undefined;
          const destination = assigned ? destinationOf(assigned) : undefined;
          return destination ? { ...c, formationPosition: destination.node.id, airborne: destination.airborne } : c;
        });
        return Math.max(0, ...focus.flatMap((target) => (['attack', 'volley'] as const).map((type) => {
          const order: Order = { unitId: u.id, type, targetId: target.id };
          return this.v2OrderReason(order, world) ? 0 : this.previewAttackWithEnvironment(this.orderAttackOptions(order, world), world).expectedDamage;
        })));
    };
    if (u.fatigue >= 2) {
      const rested = { ...u, conditions: [...u.conditions], fatigue: fatigueAfter(u, 0) };
      // V2直接由fatigue计算修正，休整预估不能再叠加旧版fat-*状态。
      // 比较休整对后续两个交战窗口的收益，避免力竭后永远重复低效攻击。
      const gain = (futureValue(rested) - futureValue(u)) * 1.5;
      if (gain > 0) candidates.push({ order: { unitId: u.id, type: 'hold' }, score: gain });
    }
    if (hasFlightAbility(u) || isAirborne(u) || isRangedWeapon(u.weapon) || isRangedWeapon(u.sidearm)) {
      const pinnedRanged = isRangedWeapon(u.weapon) && foes.some(target => {
        const volley: Order = { unitId: u.id, type: 'volley', targetId: target.id };
        return this.v2OrderReason(volley, planning)?.includes('牵制');
      });
      for (const type of ['rank-forward', 'rank-back', 'shift-left', 'shift-right'] as const) {
        const order: Order = { unitId: u.id, type }; if (this.v2OrderReason(order, planning)) continue;
        const destination = this.maneuverDestination(order, planning);
        const fire = futureValue({ ...u, formationPosition: destination.id, fatigue: fatigueAfter(u, 1) });
        // 被贴身压制的远程单位应优先脱离到后排重新建立射界；横移作为后排被堵时的次选。
        const disengage = pinnedRanged && fire > 0 ? (type === 'rank-back' ? 2 : type.startsWith('shift-') ? 1 : 0) : 0;
        candidates.push({ order, score: fire * 0.6 - 0.5 + disengage });
      }
      const transition: Order = { unitId: u.id, type: isAirborne(u) ? 'land' : 'takeoff' };
      if (!this.v2OrderReason(transition, planning)) {
        const future = { ...u, airborne: !isAirborne(u), formationPosition: formationNode(u).id, fatigue: fatigueAfter(u, 1) };
        let score = futureValue(future) * 0.6 - 0.5;
        if (transition.type === 'land' && formationNode(u).rank === 'front') score = Math.max(score, 2);
        if (transition.type === 'takeoff') score -= focus.filter((f) => !isAirborne(f) && formationDistance(u, f) <= 1 && !!meleeWeapon(f)).length * 2;
        candidates.push({ order: transition, score });
      }
    }
    if (canReconceal(this.observationContext(planning), u)) candidates.push({ order: { unitId: u.id, type: 'hold' }, score: 4 });
    const tactic = u.side === 'ally' ? this.allyTactic : 'balanced';
    if (tactic === 'aggressive') for (const candidate of candidates) if (['attack','volley','charge'].includes(candidate.order.type)) candidate.score += candidate.order.type === 'charge' ? 3 : 1.5;
    const eligible = tactic === 'defensive' ? candidates.filter(c => { const p = this.orderPreview(c.order); return !p.approach && !p.destination && !p.vehicleMove && !p.withdrawal && !['charge','rank-forward','rank-back','shift-left','shift-right','takeoff','land'].includes(c.order.type); }) : candidates;
    if (tactic === 'defensive' && !eligible.some(c => c.score > 0)) return {unitId:u.id,type:this.v2OrderReason({unitId:u.id,type:'brace'},planning)?'hold':'brace',automatic:true};
    const legal = eligible.filter(c => c.score > 0 && canReserve(c.order));
    const commandScores = commanderScores(legal.map(c => ({
      key: JSON.stringify(c.order), score: c.score,
      attack: ['attack', 'volley', 'charge'].includes(c.order.type) || c.order.type === 'ability' && !!c.order.targetId && this.byId(c.order.targetId).side !== side,
      ranged: c.order.type === 'volley' || c.order.type === 'ability' && (sources.find(a => a.id === (c.order.abilityActorId ?? c.order.unitId))?.abilities.find(a => a.id === c.order.abilityId)?.range?.max ?? 0) > 1, move: !!destinationOf(c.order) || c.order.type === 'charge',
      defend: c.order.type === 'brace' || c.order.type === 'hold',
    })), this.commanderProfiles[side === 'ally' ? 'ally' : 'enemy'], `${this.seed}:${this.round}:${u.id}`);
    const ranked = new Map(legal.map((c, i) => [c, commandScores[i]!]));
    const best = legal.sort((a, b) => ranked.get(b)! - ranked.get(a)! || JSON.stringify(a.order).localeCompare(JSON.stringify(b.order)))[0];
    let order: Order = best?.order ?? { unitId: u.id, type: formationNode(u).rank !== 'front' ? 'rank-forward' : 'brace' };
    if (!best && !foes.length && formationNode(u).rank === 'front') {
      // 沿三翼巡视，不读取未发现敌军的位置，也不永远在中军空等。
      const searchWing = [0, 1, 2, 1][(this.round - 1) % 4]!;
      const dx = searchWing - formationNode(u).x;
      if (dx) order = { unitId: u.id, type: dx < 0 ? 'shift-left' : 'shift-right' };
    }
    if (!best && formationNode(u).rank === 'front' && foes.length) {
      const nearest = [...foes].sort((a, b) => formationDistance(u, a) - formationDistance(u, b) || a.id.localeCompare(b.id))[0]!;
      // 选择共同接战翼，避免双方同时向对方旧位置移动而反复换位。
      const meeting = Math.floor((formationNode(nearest).x + formationNode(u).x) / 2);
      const dx = meeting - formationNode(u).x;
      if (dx) order = { unitId: u.id, type: dx < 0 ? 'shift-left' : 'shift-right' };
    }
    if (!best && (isAirborne(u) || u.formationPosition !== undefined)) {
      const patrol = [...FORMATION_NODES].sort((a, b) => a.y - b.y || (a.y % 2 ? b.x - a.x : a.x - b.x));
      const destination = foes.length ? formationNode([...foes].sort((a, b) => formationDistance(u, a) - formationDistance(u, b))[0]!) : patrol[(this.round - 1) % patrol.length]!;
      const moves = (['rank-forward', 'rank-back', 'shift-left', 'shift-right'] as const).map((type) => ({ unitId: u.id, type }))
        .filter((o) => !this.v2OrderReason(o, planning) && canReserve(o)).sort((a, b) => formationNodeDistance(this.maneuverDestination(a, planning), destination) - formationNodeDistance(this.maneuverDestination(b, planning), destination));
      if (isRangedWeapon(u.weapon) && (u.weapon?.range ?? 0) > 2 && foes.length) {
        // 装填或暂时无射界时仍保持射距，不能按近战巡逻逻辑主动挤向敌人。
        const desired = Math.min(u.weapon!.range ?? 3, 4);
        const spacing = (candidate: Order) => {
          const future = candidate.type === 'hold' ? u : { ...u, formationPosition: this.maneuverDestination(candidate, planning).id };
          const distance = Math.min(...foes.map((foe) => formationDistance(future, foe)));
          return Math.abs(distance - desired) + Math.max(0, 2 - distance) * 2;
        };
        order = [{ unitId: u.id, type: 'hold' } as Order, ...moves].sort((a, b) => spacing(a) - spacing(b))[0]!;
        if (order.type === 'hold' && !this.v2OrderReason({ unitId: u.id, type: 'brace' }, planning)) order.type = 'brace';
      } else if (foes.length && !isAirborne(u)) {
        const from = formationNode(u), to = destination;
        // 两军分别趋向相邻会合点，不能同时穿过对方旧前线再反向追逐。
        const horizontal = Math.abs(from.x - to.x) >= Math.abs(from.y - to.y);
        const low = Math.floor(((horizontal ? from.x + to.x : from.y + to.y) - 1) / 2);
        const own = (horizontal ? from.x < to.x : from.y < to.y) ? low : low + 1;
        const meeting = horizontal ? { x: own, y: Math.floor((from.y + to.y) / 2) } : { x: Math.floor((from.x + to.x) / 2), y: own };
        const distance = (node: typeof from) => Math.abs(node.x - meeting.x) + Math.abs(node.y - meeting.y);
        const approach = moves.filter(move => distance(this.maneuverDestination(move, planning)) < distance(from))
          .sort((a, b) => distance(this.maneuverDestination(a, planning)) - distance(this.maneuverDestination(b, planning)))[0];
        order = formationNodeDistance(from, to) <= 1 || !approach ? { unitId: u.id, type: 'brace' } : approach;
      } else order = moves[0] ?? { unitId: u.id, type: 'hold' };
    }
    return this.v2OrderReason(order, planning) || !canReserve(order) ? undefined : { ...order, automatic: true };
  }
  private autoV2Orders(side: 'ally' | 'enemy', reserved: readonly string[] = []): number {
    let count = 0;
    const protectedUnits = new Set(reserved);
    for (const u of [...this.readyUnits(side)].sort((a, b) => a.id.localeCompare(b.id))) {
      if (this.orders.has(u.id) || protectedUnits.has(u.id)) continue;
      const order = this.recommendedOrder(u.id);
      if (order && this.issue(order).ok) count++;
    }
    return count;
  }
  get planningLocked(): boolean { return this.locked; }
  /** 整批验证后替换，失败时不撤销旧军令；用于明确确认的改令和草案提交。 */
  replaceOrders(orders: Order[], expectedRound = this.round): { ok: boolean; reason?: string } {
    if (this.rules.resolutionVersion !== 'v2' || !this.started || this.isOver() || this.locked || expectedRound !== this.round)
      return { ok: false, reason: '计划已锁定、会战结束或轮次已变化' };
    if (new Set(orders.map((o) => o.unitId)).size !== orders.length) return { ok: false, reason: '同一编队不能提交多个主任务' };
    for (const order of orders) {
      const reason = this.v2OrderReason(order, this.planningUnits(order));
      if (reason) return { ok: false, reason: (this.combatants.find((u) => u.id === order.unitId)?.name ?? '指定编队') + '：' + reason };
    }
    for (const order of orders) this.orders.set(order.unitId, { ...order });
    return { ok: true };
  }
  private resolveV2Round(expectedRound: number): void {
    if (!this.started || this.locked || this.isOver() || expectedRound !== this.round || this.resolvedRounds.has(expectedRound)) throw new Error('回合已结束、已执行或计划版本过期');
    this.autoV2Orders('enemy');
    // 缺少我方军令时保持原地；面板自动军令开关决定是否补齐进攻任务。
    for (const u of this.readyUnits('ally')) if (!this.isAttached(u.id) && !this.orders.has(u.id)) this.orders.set(u.id, { unitId: u.id, type: 'hold', automatic: true });
    const plans = [...this.orders.values()].sort((a, b) => a.unitId.localeCompare(b.unitId));
    this.pendingReport = { round: this.round, total: { round: this.round, changes: [] }, phases: [],
      orders: plans.filter((p) => this.byId(p.unitId).side === 'ally').map((order) => ({ order: { ...order }, phase: '计划锁定', status: 'locked' })),
      frontBefore: { ...this.frontControl }, frontAfter: {} };
    this.feedback = new BattleFeedback(this.round, this.feedbackUnits()); this.beginPhase('计划锁定');
    this.locked = true; this.lastPhases = ['计划锁定']; this.damageTaken.clear();
    const exertion = new Map<string, number>(), reactions = new Set<string>(); this.flightCauses.clear();
    for (const unit of this.combatants) {
      delete unit.tacticalPose;
      if (plans.some((p) => p.unitId === unit.id && p.type === 'brace' && !this.v2OrderReason(p))) unit.tacticalPose = bracePose(unit, this.braceThreat(unit), 'mass');
    }
    for (const order of plans.filter((p) => ['hold', 'brace'].includes(p.type))) { const reason = this.v2OrderReason(order); this.orderReceipt(order, '计划锁定', reason ? 'blocked' : 'executed', reason); }
    this.finishPhase('计划锁定');
    const attacks = (phase: string, phaseUnits: Combatant[], orders: Order[]) => {
      const arrivals = new Map<string, { node: typeof FORMATION_NODES[number]; airborne: boolean }>();
      const requestedMoves = new Set<string>(), dives = new Set<string>(), charges = new Set<string>(), withdrawals = new Set<string>(), vehicleMoves = new Set<string>();
      for (const order of orders) {
        if (this.v2OrderReason(order, phaseUnits)) continue;
        const actor = phaseUnits.find((u) => u.id === order.unitId)!, target = phaseUnits.find((u) => u.id === order.targetId)!;
        const diving = order.type !== 'volley' && isAirborne(actor) && !isAirborne(target);
        const withdrawal = order.type === 'volley' ? this.mountedShotDestination(actor, target, phaseUnits) : undefined;
        const vehicleMove = order.type === 'volley' ? this.vehicleShotDestination(actor, target, phaseUnits) : undefined;
        if (order.type === 'charge' || diving || withdrawal || vehicleMove) {
          requestedMoves.add(actor.id);
          const node = order.type === 'charge' ? this.chargeDestination(actor, target, phaseUnits) : withdrawal ?? vehicleMove ?? this.diveDestination(actor, target, phaseUnits);
          if (node) { arrivals.set(actor.id, { node, airborne: isAirborne(actor) && !diving }); if (diving) dives.add(actor.id); if (order.type === 'charge') charges.add(actor.id); if (withdrawal) withdrawals.add(actor.id); if (vehicleMove) vehicleMoves.add(actor.id); }
          else this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id], text: actor.name + ' 接近路线受阻，任务未执行' });
        }
      }
      this.pruneArrivals(arrivals);
      for (const [id, plan] of arrivals) if (vehicleMoves.has(id)) {
        const actor = this.byId(id); exertion.set(id, 1); this.vehicleDepartureReactions(actor, plan.node, reactions);
        if (actor.status !== 'ready' || actor.suppression || activeConditionIds(actor).some((c) => this.conditions.get(c)?.skipTurn || this.conditions.get(c)?.preventMove)) arrivals.delete(id);
      }
      this.pruneArrivals(arrivals);
      for (const [id, { node, airborne }] of arrivals) {
        const actor = this.byId(id); actor.formationPosition ??= formationNode(actor).id; actor.airborne = airborne; setFormation(actor, node); this.syncPassenger(actor);
        exertion.set(id, (charges.has(id) ? 2 : 1) + Number(dives.has(id)));
        this.recordEvent({ round: this.round, kind: 'move', participants: [id], text: `${actor.name} ${charges.has(id) ? '冲锋接近' : withdrawals.has(id) ? '骑射后撤' : vehicleMoves.has(id) ? '行进射击' : '扑击降落'}至${node.side === 'ally' ? '我方' : '敌方'}${node.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[node.rank]}${dives.has(id) ? '，降落额外疲劳1' : ''}` });
      }
      revealContacts(this.observationContext());
      phaseUnits = structuredClone(this.combatants);
      const results: { actorId: string; targetId: string; result: AttackResolution }[] = [];
      for (const order of orders) {
        if (requestedMoves.has(order.unitId) && !arrivals.has(order.unitId)) continue;
        if (order.type === 'charge' && (!charges.has(order.unitId) || !arrivals.has(order.unitId))) continue;
        // 冲锋已支付真实接近；此处以最终近战范围复核，保留冲锋修正但不能再要求第二次助跑。
        if (this.v2OrderReason(order.type === 'charge' ? { ...order, type: 'attack' } : order, phaseUnits)) continue;
        const actor = phaseUnits.find((u) => u.id === order.unitId)!;
        const target = phaseUnits.find((u) => u.id === order.targetId)!;
        if (order.type !== 'volley' && isAirborne(actor) && !isAirborne(target) && !dives.has(actor.id)) continue;
        const weapon = order.type === 'volley' ? this.rangedWeaponFor(actor, target, phaseUnits, withdrawals.has(actor.id) ? 'riding' : vehicleMoves.has(actor.id) ? 'vehicle' : false) : meleeWeapon(actor);
        if (!weapon) continue;
        this.orderReceipt(order, '交战', 'executed');
        exertion.set(actor.id, (order.type === 'charge' ? 2 : 1) + Number(dives.has(actor.id)));
        for (let n = 0; n < Math.min(3, weapon?.attacks ?? 1); n++) {
          const result = this.resolveAttackWithEnvironment({ ...this.orderAttackOptions(order, phaseUnits, false, weapon), defender: structuredClone(target), rng: this.rng });
          results.push({ actorId: actor.id, targetId: target.id, result });
        }
        if (weaponReloadTurns(weapon) && order.type === 'volley') this.reloadCd.set(weaponReloadKey(actor, weapon), weaponReloadTurns(weapon) + 1);
      }
      for (const { actorId, targetId, result } of results) {
        const target = this.byId(targetId);
        const loss=applyResolutionDamage(target,result);if(this.rules.combatModel)recordAppliedDamage(result,loss);result.text = formatResolution(result, target);
        this.recordAttack(this.byId(actorId), target, result, phase);
      }
    };
    try {
      this.lastPhases.push('支援'); this.beginPhase('支援');
      const support = structuredClone(this.combatants);
      const changes: (() => void)[] = [];
      const resourceDeltas = new Map<string, { unitId: string; resource: string; amount: number; capped: boolean }>();
      const pushed = new Map<string, { node: typeof FORMATION_NODES[number]; airborne: boolean; sourceId: string; force: number }>();
      const stagedBirths: Combatant[] = [];
      for (const order of plans.filter((p) => p.type === 'ability')) {
        const reason = this.v2OrderReason(order, support);
        if (reason) { this.orderReceipt(order, '支援', 'blocked', reason); this.recordEvent({ round: this.round, kind: 'ability', participants: [order.unitId], text: '支援未执行：' + reason }); continue; }
        const actor = this.effectiveUnit(support.find((u) => u.id === (order.abilityActorId ?? order.unitId))!, support);
        const ability = actor.abilities.find((a) => a.id === order.abilityId)!;
        const target = ability.target === 'self' ? actor : this.effectiveUnit((ability.target === 'zone' ? zoneTarget(this.observationContext(support),actor,order.targetId) : support.find((u) => u.id === order.targetId)) ?? actor, support);
        const hits = new Map<string, AttackResolution>();
        const resourceTargets = new Map<string, Combatant>();
        const born: Combatant[] = [];
        let invalid = false;
        for (const effect of ability.effects) if (effect.op === 'summon') {
          if (effect.count < 1 || effect.count > 2 || this.combatants.filter((u) => u.summonerId === actor.id && u.status === 'ready').length + effect.count > 2) { invalid = true; break; }
          for (let n = 0; n < effect.count; n++) {
            const id = `mass:${this.seed}:summon:${actor.id}:${this.round}:${n}`;
            let unit: Combatant | null | undefined;
            try { unit = conjureSkillUnit(effect.templateId, actor.side, id, 'mass') ?? this.summonUnit?.(effect.templateId, actor.side, id); } catch { invalid = true; break; }
            const node = FORMATION_NODES.find((node) => node.side === actor.side && node.wing === formationNode(actor).wing && node.rank === 'reserve')!;
            if (!unit || unit.scale === 'hero' || [...this.combatants, ...stagedBirths, ...born].filter((u) => !this.isAttached(u.id) && u.status === 'ready' && formationNode(u).id === node.id).length >= 3) { invalid = true; break; }
            prepareCombatModel(unit, this.rules); if(this.rules.combatModel)upgradeCombatSkills(unit);
            unit.id = id; unit.summonerId = actor.id; unit.bornRound = this.round; setFormation(unit, node); born.push(unit);
          }
        }
        if (invalid) {
          this.orderReceipt(order, '支援', 'blocked', '召唤容量或落点不足，未扣费');
          this.recordEvent({ round: this.round, kind: 'ability', participants: [order.unitId], text: '召唤容量或落点不足，未扣费' });
          if (order.automatic) {
            const fallback = this.recommendV2Order(order.unitId, false);
            if (fallback) {
              plans[plans.indexOf(order)] = fallback; this.orders.set(order.unitId, fallback);
              const receipt = this.pendingReport?.orders.find(p => p.order.unitId === order.unitId);
              if (receipt) receipt.order = { ...fallback };
              if (fallback.type === 'brace') this.byId(order.unitId).tacticalPose = bracePose(this.byId(order.unitId), this.braceThreat(this.byId(order.unitId)), 'mass');
              if (fallback.type === 'hold' || fallback.type === 'brace') this.orderReceipt(fallback, '支援', 'executed');
              this.recordEvent({ round: this.round, kind: 'ability', participants: [order.unitId], text: `${this.byId(order.unitId).name} 召唤失败，重新选择本轮任务` });
            }
          }
          continue;
        }
        stagedBirths.push(...born);
        this.orderReceipt(order, '支援', 'executed');
        const actualActor = this.byId(actor.id);
        revealUnit(this.observationContext(), actualActor);
        if (ability.cost) actualActor.resources[ability.cost.resource]! -= ability.cost.amount;
        const key = ability.cooldownGroup ?? ability.id;
        const state = actualActor.abilityState.find((s) => s.abilityId === key) ?? { abilityId: key, cdLeft: 0, used: 0 };
        if (!actualActor.abilityState.includes(state)) actualActor.abilityState.push(state);
        state.used++; state.cdLeft = (ability.cooldown ?? 0) + 1;
        const skillArm = ability.weaponUse ? skillWeapon(actor, ability, formationDistance(actor, target)) : undefined;
        if (skillArm && isRangedWeapon(skillArm) && weaponReloadTurns(skillArm)) this.reloadCd.set(weaponReloadKey(actor, skillArm), weaponReloadTurns(skillArm) + 1);
        for (const effect of ability.effects) {
          if (effect.op === 'zone') { changes.push(()=>placeZone(this.observationContext(),this.byId(actor.id),target,effect,this.round,ability.id)); }
          else if (effect.op === 'damage') for (const affected of this.supportTargets(actor, ability, target, support)) {
            const result = this.resolveAttackWithEnvironment({ attacker: actor, defender: structuredClone(affected), rng: this.rng, rules: this.rules, conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
              ...this.skillAttackOptions(support, actor, affected, ability, effect) });
            hits.set(affected.id, result);
            changes.push(() => { const t = this.byId(affected.id);const loss=applyResolutionDamage(t,result);if(this.rules.combatModel)recordAppliedDamage(result,loss);result.text = formatResolution(result, t); this.recordAttack(actualActor, t, result, '支援'); });
          } else if (effect.op === 'heal') for (const affected of this.supportTargets(actor, ability, target, support)) {
            const amount = Math.min(recoveryCapacity(affected), healingYield(actor,affected,effect.amount ?? rollDice(effect.dice!, this.rng).total,!!ability.itemSourceId));
            changes.push(() => { const t = this.byId(affected.id); if (t.hp > 0 || t.status === 'dying') {
              const before = memberHealth(t),restored=applyRecovery(t, amount);
              if (t.status === 'dying' && t.hp > 0) t.status = 'ready';
              this.recordEvent({ round: this.round, kind: 'ability', participants: [actor.id,t.id], text: `${actor.name} 使用【${ability.name}】治疗 ${restored} → ${t.name} 生命 ${before}→${memberHealth(t)}` });
            } });
          } else if (effect.op === 'barrier') for (const affected of this.supportTargets(actor, ability, target, support)) changes.push(() => {
            const unit = this.byId(affected.id); grantBarrier(unit, effect.amount, effect.dur, actor.id);
            this.recordEvent({ round: this.round, kind: 'ability', participants: [actor.id, unit.id], text: `${unit.name} 获得屏障，可吸收${unit.barrier?.remaining ?? 0}点伤害，持续${effect.dur}轮` });
          });
          else if (effect.op === 'morale') for (const affected of this.supportTargets(actor, ability, target, support)) changes.push(() => changeMorale(this.byId(affected.id), effect.amount));
          else if (effect.op === 'condition') for (const affected of effect.shape === 'burst' ? this.supportTargets(actor, ability, target, support) : [target]) {
            const hit = hits.get(affected.id);
            if (effect.onDamage && !(hit && hit.finalDamage > 0)) continue;
            if (effect.onHit && (!hit?.hit || hit.hpAfter <= 0)) continue;
            const outcome = prepareCondition(actor, affected, effect, this.rng);
            changes.push(() => {
              const unit = this.byId(affected.id); if(effect.onDamage && !(hits.get(affected.id)?.finalDamage ?? 0)) return; applySkillCondition(unit, outcome.condition);
              if (outcome.condition && (this.conditions.get(effect.conditionId)?.skipTurn || this.conditions.get(effect.conditionId)?.preventMove)) this.flightCauses.set(unit.id, actor.id);
              this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, unit.id], text: outcome.text });
            });
          } else if (effect.op === 'trait') for (const affected of this.supportTargets(actor, ability, target, support)) {
            changes.push(() => { const unit = this.byId(affected.id); if (unit.hp > 0) this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, unit.id], text: applySkillTrait(actor, unit, ability, effect, this.seed + ':' + this.round) }); });
          } else if (effect.op === 'push') for (const affected of this.supportTargets(actor, ability, target, support)) {
            const hit = hits.get(affected.id); if (effect.onHit && (!hit?.hit || hit.hpAfter <= 0)) continue;
            const result = pushPreview(this.observationContext(support), actor, affected, effect);
            if (result.nodeId) {
              const prior = pushed.get(affected.id), force = pushStrength(actor, effect);
              if (!prior || force > prior.force) pushed.set(affected.id, { node: FORMATION_NODES.find((n) => n.id === result.nodeId)!, airborne: isAirborne(affected), sourceId: actor.id, force });
            } else changes.push(() => this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id, affected.id], text: affected.name + '：' + result.reason }));
          } else if (effect.op === 'dispel') for (const affected of this.supportTargets(actor, ability, target, support)) {
            const chosen = dispelCandidates(affected, effect);
            changes.push(() => {
              const unit = this.byId(affected.id); applyDispel(unit, chosen);
              if (chosen.length) this.flightCauses.set(unit.id, actor.id);
              this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, affected.id], text: affected.name + ' 解除' + chosen.map((c) => c.name).join('、') });
            });
          } else if (effect.op === 'resource') for (const affected of this.supportTargets(actor, ability, target, support)) {
            if (!resourceTargets.has(affected.id)) {
              const paid = { ...affected, resources: { ...affected.resources } };
              if (affected.id === actor.id && ability.cost) paid.resources[ability.cost.resource] = (paid.resources[ability.cost.resource] ?? 0) - ability.cost.amount;
              resourceTargets.set(affected.id, paid);
            }
            const paid = resourceTargets.get(affected.id)!, amount = skillResourceChange(paid, effect);
            paid.resources[effect.resource] = (paid.resources[effect.resource] ?? 0) + amount;
            const key = JSON.stringify([affected.id, effect.resource]), prior = resourceDeltas.get(key);
            resourceDeltas.set(key, { unitId: affected.id, resource: effect.resource,
              amount: (prior?.amount ?? 0) + amount, capped: !!prior?.capped || effect.maximum === 'training' });
          }
        }
        changes.push(() => {for(const unit of born)unit.nonLethal=this.nonLethal;this.combatants.push(...born);});
        exertion.set(actor.id, 1);
        this.recordEvent({ round: this.round, kind: 'ability', participants: [actor.id], text: `${actor.name} 的【${ability.name}】占用所属编队本轮主任务` });
      }
      changes.forEach((apply) => apply());
      for (const delta of resourceDeltas.values()) {
        const unit = this.byId(delta.unitId), before = unit.resources[delta.resource] ?? 0;
        unit.resources[delta.resource] = Math.max(0, Math.min(delta.capped && delta.amount > 0 ? Math.max(before, (delta.resource === 'SP' ? spCapacity(unit) : 6 + Math.floor(unit.level / 2))) : Infinity, before + delta.amount));
        this.recordEvent({ round: this.round, kind: 'ability', participants: [unit.id], text: unit.name + ' ' + delta.resource + ' ' + before + '→' + unit.resources[delta.resource] });
      }
      for (const [id] of pushed) if (this.byId(id).hp <= 0 || this.byId(id).status === 'fled') pushed.delete(id);
      this.pruneArrivals(pushed);
      for (const [id, movement] of pushed) {
        const unit = this.byId(id); unit.formationPosition = movement.node.id; delete unit.tacticalPose; this.syncPassenger(unit);
        revealUnit(this.observationContext(), unit);
        this.recordEvent({ round: this.round, kind: 'move', participants: [movement.sourceId, id], text: unit.name + ' 被推至' + movement.node.wing + '/' + movement.node.rank + '，不触发借机或额外碰撞伤害' });
      }
      this.resolveFlightStates();
      this.finishPhase('支援');
      this.lastPhases.push('机动'); this.beginPhase('机动');
      this.executeManeuvers(plans, exertion, reactions);
      revealContacts(this.observationContext());
      this.finishPhase('机动');
      this.lastPhases.push('交战'); this.beginPhase('交战');
      attacks('交战', structuredClone(this.combatants), plans.filter((p) => ['attack', 'charge', 'volley'].includes(p.type)));
      this.resolveFlightStates();
      this.finishPhase('交战');
      this.lastPhases.push('重整'); this.beginPhase('重整');
      this.settleMorale();
      for (const u of this.combatants) {
        if (settleConcealment(this.observationContext(), u, plans.some((p) => p.unitId === u.id && p.type === 'hold') && !exertion.get(u.id) && !this.damageTaken.get(u.id))) this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 在掩护中休整，重新潜伏` });
        settleFatigue(u, exertion.get(u.id) ?? 0);
        for (const s of u.abilityState) s.cdLeft = Math.max(0, s.cdLeft - 1);
        for (const condition of u.conditions) {
          if (condition.id === 'poisoned' && !poisonFactor(u)) { condition.dur = 0; continue; }
          const dot = this.conditions.get(condition.id)?.dot;
          if (dot && u.status === 'ready') {
            const rolled = rollDice(dot.dice, this.rng).total;
            let damage = this.rules.combatModel ? roundDamage(conditionDamage(u,rolled,condition),this.rng) : condition.id === 'poisoned' ? poisonDamage(u, rolled * (condition.magnitude ?? 1)) : condition.magnitude !== undefined ? Math.max(0, Math.round(rolled * condition.magnitude / (u.scale === 'hero' ? 1 : 4))) : Math.max(0, Math.floor(rolled / (u.scale === 'hero' ? 1 : 10)));
            const lost=hasMemberHealth(u)?applyCombatDamage(u,damage,condition.affectedMembers??10):applyHealthLoss(u,damage); if(this.rules.combatModel)damage=lost;
            this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], damage: {sourceId:condition.sourceId,targetId:u.id,amount:lost,cause:dot.label ?? this.conditions.get(condition.id)!.name,...(hasMemberHealth(u)?{unit:'life' as const}:{})}, text: `${u.name} ${dot.label}损失${damage}${hasMemberHealth(u)?'生命':''}` });
            this.defeatUnit(u, this.combatants.find((source) => source.id === condition.sourceId));
          }
        }
        const regeneration = regenerationAmount(u, this.traitRegistry, this.conditionMap());
        for (const condition of u.conditions) if (condition.dur !== undefined) condition.dur--;
        u.conditions = u.conditions.filter((c) => c.dur === undefined || c.dur > 0);
        if (u.status === 'ready' && regeneration > 0) {
          const restored = applyRecovery(u, regeneration);
          if (restored) this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 再生 +${restored} → ${u.scale === 'hero' ? '生命' : '人数'} ${u.hp}${u.scale !== 'hero' ? `，剩余可救伤兵${u.recoverableWounded ?? 0}` : ''}` });
        }
        this.checkCommanderLost(u);
      }
      for (const [hostId, heroId] of this.attached) {
        const host = this.byId(hostId), hero = this.byId(heroId);
        if (host.status === 'ready' || hero.hp <= 0 || hero.status === 'dead' || this.exposedHeroes.has(heroId)) continue;
        if (host.status === 'routing') { this.syncPassenger(host); continue; }
        if (host.status === 'fled') { hero.status = 'fled'; continue; }
        this.exposedHeroes.add(heroId);
        const retreat = this.combatants.some((u) => u.id !== hostId && u.side === hero.side && !this.isAttached(u.id) && u.status === 'ready' && this.rankOf(u) === 'reserve');
        const hpBefore=hero.hp;
        hero.hp = retreat ? Math.max(1, Math.floor(hero.hp * 0.75)) : 0; hero.status = retreat ? 'fled' : this.nonLethal ? 'dying' : 'dead';
        this.recordEvent({ round: this.round, kind: 'death', participants: [hero.id], damage:{targetId:hero.id,amount:hpBefore-hero.hp,cause:'随队暴露'}, text: `${hero.name} 随队暴露：${retreat ? '预备队掩护，受伤撤出' : this.nonLethal ? '无退路，濒死失能' : '无退路，阵亡'}` });
      }
      for (const [id, left] of this.reloadCd) { if (left <= 1) this.reloadCd.delete(id); else this.reloadCd.set(id, left - 1); }
      this.previousOrders = new Map(plans.filter((p) => !['ability', 'takeoff', 'land'].includes(p.type)).map((p) => [p.unitId, p]));
      for (const unit of this.combatants) { expireTraitSources(unit, 'rounds'); decayBarrier(unit); }
      this.resolveFlightStates(); this.updateFrontControl(); this.finishPhase('重整');
      if (this.pendingReport && this.feedback) {
        this.pendingReport.total = this.feedback.rounds()[0]!;
        this.pendingReport.frontAfter = { ...this.frontControl };
        for (const receipt of this.pendingReport.orders) if (receipt.status === 'locked') {
          receipt.status = 'blocked'; receipt.phase = receipt.order.type === 'ability' ? '支援' : ['attack', 'volley', 'charge'].includes(receipt.order.type) ? '交战' : '机动';
          receipt.reason = this.v2OrderReason(receipt.order) ?? '前序阶段后路线或落点受阻';
        }
        this.lastReport = structuredClone(this.pendingReport);
      }
      this.orders.clear(); this.resolvedRounds.add(this.round); this.round++; this.refreshCp();
      this.recordEvent({ round: this.round - 1, kind: 'round', text: this.lastPhases.join(' → ') });
    } finally { this.locked = false; this.feedback = undefined; this.pendingReport = undefined; }
  }

  byId(id: string): Combatant {
    const u = this.combatants.find((c) => c.id === id);
    if (!u) throw new Error(`单位不存在: ${id}`);
    return u;
  }

  sideUnits(side: 'ally' | 'enemy'): Combatant[] {
    return this.combatants.filter((c) => c.side === side);
  }

  readyUnits(side: 'ally' | 'enemy'): Combatant[] {
    return this.combatants.filter((c) => c.side === side && c.status === 'ready');
  }

  start(): void {
    if (this.started) return;
    if (this.rules.resolutionVersion === 'v2') this.prepareFormation();
    this.started = true;
    this.round = 1;
    this.updateFrontControl();
    this.refreshCp();
    if (this.rules.resolutionVersion === 'v2') revealContacts(this.observationContext());
    this.recordEvent({ round: 1, kind: 'round', text: `—— 会战开始（${this.zones ? this.zones.join('/') : '单一战线'}）——` });
  }

  /** 指挥点：基础 2 + 幸存单位数一半；我方主指挥阵亡后减半（至少1） */
  refreshCp(): void {
    for (const side of ['ally', 'enemy'] as const) {
      this.cp[side] = 2 + Math.floor(this.readyUnits(side).length / 2);
    }
    if (this.commanderLost) this.cp.ally = Math.max(1, Math.floor(this.cp.ally / 2));
  }

  /** 我方是否允许手动指挥：主指挥在位（未设主指挥时默认允许；阵亡/溃逃后失去资格） */
  get manualCommandAllowed(): boolean {
    if (!this.commanderId) return true;
    if (this.commanderLost) return false;
    const c = this.combatants.find((x) => x.id === this.commanderId);
    return !!c && c.status === 'ready';
  }

  zoneOf(u: Combatant): string {
    if (this.rules.resolutionVersion === 'v2') return formationNode(u).wing;
    return this.zones ? (u.tags.find((t) => t.startsWith('zone:'))?.slice(5) ?? this.zones[Math.floor(this.zones.length / 2)]!) : 'main';
  }

  /** 阵列层级：前排承接近战，后排适合射击，预备队需先前移才能交战。 */
  rankOf(u: Combatant): 'front' | 'rear' | 'reserve' {
    if (this.rules.resolutionVersion === 'v2') return formationNode(u).rank;
    const rank = u.tags.find((t) => t.startsWith('rank:'))?.slice(5);
    return rank === 'rear' || rank === 'reserve' ? rank : 'front';
  }

  /** 近战可达性：同翼/邻翼之外，后排和预备队在同翼仍有前排时受其掩护。 */
  canMeleeReach(a: Combatant, b: Combatant): boolean {
    if (this.rules.resolutionVersion === 'v2') return formationDistance(a, b) <= (this.rules.combatModel === MEMBER_HEALTH_MODEL ? meleeReach(meleeWeapon(a)) : 1) && !this.isAttached(b.id)
      && (this.rules.combatModel !== MEMBER_HEALTH_MODEL || !!meleeWeapon(a) && !formationScreened(a, b, this.combatants));
    if (!this.isNear(a, b)) return false;
    if (this.rankOf(b) === 'front') return true;
    return !this.readyUnits(b.side as 'ally' | 'enemy').some(
      (u) => u.id !== b.id && this.zoneOf(u) === this.zoneOf(b) && this.rankOf(u) === 'front',
    );
  }

  /** 下达指令（面板调用）。特殊指令消耗指挥点。 */
  issue(order: Order): { ok: boolean; reason?: string } {
    if (this.rules.resolutionVersion === 'v2') {
      if (!this.started || this.isOver()) return { ok: false, reason: '会战未开始或已结束' };
      if (this.locked || this.orders.has(order.unitId)) return { ok: false, reason: '该编队已有主任务，先撤回再改令' };
      const reason = this.v2OrderReason(order, this.planningUnits(order));
      if (reason) return { ok: false, reason };
      this.orders.set(order.unitId, { ...order }); return { ok: true };
    }
    const u = this.byId(order.unitId);
    if (u.status !== 'ready') return { ok: false, reason: `${u.name} 无法接受指令（${u.status}）` };
    if (this.orders.has(order.unitId)) return { ok: false, reason: '该单位已有指令' };
    const cost = order.type === 'charge' || order.type === 'retreat' || order.type === 'shift-left' || order.type === 'shift-right' ? 1 : 0;
    if (cost > 0 && this.cp[u.side as 'ally' | 'enemy'] < cost) return { ok: false, reason: '指挥点不足' };

    if ((order.type === 'attack' || order.type === 'charge') && !order.targetId)
      return { ok: false, reason: '需要指定目标' };
    // 翼门禁：近战/冲锋只能打同翼或相邻翼的目标（远程齐射/魔法不受翼限制）
    if ((order.type === 'attack' || order.type === 'charge') && order.targetId) {
      const target = this.byId(order.targetId);
      if (target.side === u.side) return { ok: false, reason: '不能攻击友军' };
      if (target.status === 'ready' && !this.canMeleeReach(u, target)) {
        return { ok: false, reason: `${target.name} 不在本机翼可及前线，或正受前排掩护` };
      }
    }
    if (order.type === 'volley') {
      if (!order.targetId) return { ok: false, reason: '需要指定目标' };
      if (u.engagedWith.length > 0) return { ok: false, reason: '被贴身缠斗，无法齐射' };
      if (!isRangedCapable(u)) return { ok: false, reason: '该单位不具备射击能力（需远程武器）' };
      if (this.byId(order.targetId).side === u.side) return { ok: false, reason: '不能向友军齐射' };
    }
    if (order.type === 'charge' && u.archetype !== 'mobile' && !activeTraitIds(u).includes('charge-strong')) {
      return { ok: false, reason: '只有机动单位（或带冲锋特质）可以冲锋' };
    }
    if ((order.type === 'attack' || order.type === 'charge' || order.type === 'volley') && this.rankOf(u) === 'reserve') {
      return { ok: false, reason: '预备队必须先执行「前移」才能交战' };
    }
    if ((order.type === 'shift-left' || order.type === 'shift-right' || order.type === 'rank-forward' || order.type === 'rank-back') && u.engagedWith.length) {
      return { ok: false, reason: '接战中的单位不能变阵，需先撤退脱离' };
    }
    if (order.type === 'shift-left' || order.type === 'shift-right') {
      if (!this.zones?.length) return { ok: false, reason: '当前战场未启用左中右翼位' };
      const current = this.zones.indexOf(this.zoneOf(u));
      const next = current + (order.type === 'shift-left' ? -1 : 1);
      if (current < 0 || next < 0 || next >= this.zones.length) {
        return { ok: false, reason: `${u.name} 已在边翼，无法继续横移` };
      }
    }
    if (order.type === 'rank-forward' && this.rankOf(u) === 'front') {
      return { ok: false, reason: `${u.name} 已在前排` };
    }
    if (order.type === 'rank-back' && this.rankOf(u) === 'reserve') {
      return { ok: false, reason: `${u.name} 已在预备队` };
    }
    this.orders.set(order.unitId, order);
    this.cp[u.side as 'ally' | 'enemy'] -= cost;
    return { ok: true };
  }

  /** 撤销指令（返还指挥点） */
  revoke(unitId: string): void {
    if (this.rules.resolutionVersion === 'v2') { if (!this.locked) this.orders.delete(unitId); return; }
    const o = this.orders.get(unitId);
    if (!o) return;
    if (o.type === 'charge' || o.type === 'retreat' || o.type === 'shift-left' || o.type === 'shift-right') {
      const u = this.byId(unitId);
      this.cp[u.side as 'ally' | 'enemy'] += 1;
    }
    this.orders.delete(unitId);
  }

  /** 英雄嵌入连队：攻击 +1、士气检定 +2 */
  attachHero(heroId: string, companyId: string): void {
    if (this.rules.resolutionVersion === 'v2') {
      const hero = this.byId(heroId), company = this.byId(companyId);
      if (this.locked || hero.side !== company.side || hero.scale !== 'hero' || company.scale === 'hero' || this.isAttached(heroId) || this.attached.has(companyId)) throw new Error('随队关系非法或已经占用');
      this.attached.set(companyId, heroId); setFormation(hero, formationNode(company)); return;
    }
    this.byId(heroId);
    this.byId(companyId);
    this.attached.set(companyId, heroId);
  }

  /** 执行一个完整回合：冲锋 → 近战 → 齐射 → 支援 → 士气 → 疲劳 */
  resolveRound(expectedRound = this.round): void {
    if (this.rules.resolutionVersion === 'v2') {
      const before = structuredClone(this.toSnapshot());
      const previousDamage = new Map(this.damageTaken);
      try { this.resolveV2Round(expectedRound); }
      catch (error) {
        const restored = MassBattle.fromSnapshot(before, { traitRegistry: this.traitRegistry, summonUnit: this.summonUnit });
        // 保留外部引用与自定义执行器；种子状态、账本和整轮事实一同撤回。
        const originalUnits = this.combatants;
        const oldRng = this.rng;
        const unitsById = new Map(originalUnits.map((u) => [u.id, u]));
        originalUnits.splice(0, originalUnits.length, ...restored.combatants.map((u) => {
          const original = unitsById.get(u.id);
          if (!original) return u;
          for (const key of Object.keys(original)) if (!(key in u)) delete (original as unknown as Record<string, unknown>)[key];
          return Object.assign(original, u);
        }));
        if (oldRng instanceof SeededRng && typeof before.rngState === 'number') oldRng.setState(before.rngState);
        Object.assign(this, restored, { combatants: originalUnits, rng: oldRng, damageTaken: previousDamage, conditions: this.conditions });
        throw error;
      }
      return;
    }
    if (!this.started) throw new Error('会战尚未开始');
    this.damageTaken.clear();
    // 回合开始：装填递减（上一回合发射的重武器，reload=1 即隔回合开火）
    for (const [id, rl] of [...this.reloadCd]) {
      if (rl <= 1) this.reloadCd.delete(id);
      else this.reloadCd.set(id, rl - 1);
    }
    const routedThisRound = new Set<string>();

    const chargeOrders = [...this.orders.values()].filter((o) => o.type === 'charge');
    const meleeOrders = [...this.orders.values()].filter((o) => o.type === 'attack');
    const volleyOrders = [...this.orders.values()].filter((o) => o.type === 'volley');
    const retreatOrders = [...this.orders.values()].filter((o) => o.type === 'retreat');
    const braced = new Set([...this.orders.values()].filter((o) => o.type === 'brace').map((o) => o.unitId));
    const maneuverOrders = [...this.orders.values()].filter((o) =>
      o.type === 'shift-left' || o.type === 'shift-right' || o.type === 'rank-forward' || o.type === 'rank-back',
    );

    // ---- 机动与变阵阶段 ----
    for (const o of maneuverOrders) this.resolveManeuver(o);

    // ---- 冲锋阶段 ----
    for (const o of chargeOrders) {
      const u = this.byId(o.unitId);
      if (u.status !== 'ready' || !o.targetId) continue;
      const t = this.byId(o.targetId);
      if (t.status !== 'ready') continue;
      // 骑射反击齐射：目标未接战、具射击资格且机动/游击 → 冲锋落地前先吃一轮箭
      if (
        t.engagedWith.length === 0 &&
        isRangedCapable(t) &&
        (t.archetype === 'mobile' || activeTraitIds(t).includes('skirmisher'))
      ) {
        const owMods = this.stanceMods(t, u, {});
        const ow = this.resolveAttackWithEnvironment({
          attacker: t, defender: u, rng: this.rng, rules: this.rules,
          conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
          extraMods: owMods, defenderMods: this.defModsFor(u), ranged: true,
        });
        this.recordAttack(t, u, ow, '骑射反击');
        if (u.status !== 'ready') continue; // 冲锋者被射垮
      }
      const mods = this.stanceMods(u, t, { charge: true, braced: braced.has(t.id) });
      // 冲锋落地即近战：射击单位按近战上下文结算——有副武器换刀剑（免罚），无则主武器挥击吃 -2
      const res = this.resolveAttackWithEnvironment({
        attacker: u, defender: t, rng: this.rng, rules: this.rules,
        conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
        extraMods: mods, defenderMods: this.defModsFor(t), charge: true,
        ranged: false, weaponOverride: u.sidearm && !isRangedWeapon(u.sidearm) ? u.sidearm : undefined,
      });
      this.recordAttack(u, t, res, '冲锋·' + (tbWeaponShortName(isRangedCapable(u) && u.sidearm && !isRangedWeapon(u.sidearm) ? u.sidearm : u.weapon) || '武器'));
      this.engage(u, t);
    }

    // ---- 近战阶段（速射武器多段结算） ----
    for (const o of meleeOrders) {
      const u = this.byId(o.unitId);
      if (u.status !== 'ready' || !o.targetId) continue;
      const t = this.byId(o.targetId);
      if (t.status !== 'ready') continue;
      const mods = this.stanceMods(u, t, { braced: braced.has(t.id) });
      // 近战按近战上下文结算：射击单位换副武器（免罚）或主武器挥击吃 -2（远近双全豁免）；
      // 多段数随实际挥舞的武器
      const useSide = isRangedCapable(u) && !!u.sidearm && !isRangedWeapon(u.sidearm);
      const swingWeapon = useSide ? u.sidearm : u.weapon;
      const times = Math.max(1, swingWeapon?.attacks ?? 1);
      const meleeLabel = '近战·' + (tbWeaponShortName(swingWeapon) || '武器');
      for (let i = 0; i < times && t.status === 'ready'; i++) {
        const res = this.resolveAttackWithEnvironment({
          attacker: u, defender: t, rng: this.rng, rules: this.rules,
          conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
          extraMods: mods, defenderMods: this.defModsFor(t),
          ranged: false, weaponOverride: u.sidearm,
        });
        this.recordAttack(u, t, res, times > 1 ? `${meleeLabel} ${i + 1}/${times}` : meleeLabel);
      }
      this.engage(u, t);
    }

    // ---- 齐射阶段（重炮装填中则跳过；速射多段） ----
    for (const o of volleyOrders) {
      const u = this.byId(o.unitId);
      if (u.status !== 'ready' || !o.targetId) continue;
      if (u.engagedWith.length > 0) continue; // 被贴身失效
      const rl = this.reloadCd.get(u.id) ?? 0;
      if (rl > 0) {
        this.recordEvent({ round: this.round, kind: 'attack', participants: [u.id], text: `${u.name} 装填中（剩 ${rl} 回合），本回合无法齐射` });
        continue;
      }
      const t = this.byId(o.targetId);
      if (t.status !== 'ready') continue;
      const mods = this.stanceMods(u, t, {});
      const times = Math.max(1, u.weapon?.attacks ?? 1);
      for (let i = 0; i < times && t.status === 'ready'; i++) {
        const res = this.resolveAttackWithEnvironment({
          attacker: u, defender: t, rng: this.rng, rules: this.rules,
          conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
          extraMods: mods, defenderMods: this.defModsFor(t), ranged: true,
        });
        this.recordAttack(u, t, res, times > 1 ? `齐射${i + 1}/${times}` : '');
      }
      const reload = u.weapon?.reload ?? 0;
      if (reload > 0) this.reloadCd.set(u.id, reload + 1); // +1 缓冲：回合开始的递减在下一回合才生效
    }

    // ---- 支援阶段（跨刻度技能：轨道炮/舰炮/魔法——自动释放无消耗的进攻性技能） ----
    this.autoSupport();

    // ---- 撤退 ----
    for (const o of retreatOrders) {
      const u = this.byId(o.unitId);
      if (u.status !== 'ready') continue;
      for (const eid of [...u.engagedWith]) {
        const e = this.byId(eid);
        e.engagedWith = e.engagedWith.filter((x) => x !== u.id);
      }
      u.engagedWith = [];
      this.recordEvent({ round: this.round, kind: 'morale', participants: [u.id], text: `${u.name} 脱离接战，后撤重整` });
    }
    for (const o of this.orders.values()) {
      if (o.type === 'hold') this.recordEvent({ round: this.round, kind: 'move', text: `${this.byId(o.unitId).name} 原地待命` });
      if (o.type === 'brace') this.recordEvent({ round: this.round, kind: 'move', text: `${this.byId(o.unitId).name} 在前线固守` });
    }

    // ---- 士气阶段 ----
    // 触发条件：单回合重伤亡 / 累计伤亡过三成 / 濒临崩溃；多条件叠加 DC 更高
    for (const u of this.combatants) {
      if (u.status !== 'ready' || u.scale !== 'company') continue;
      const taken = this.damageTaken.get(u.id) ?? 0;
      const hpPct = u.hp / Math.max(1, u.base.hpMax);
      const heavyLoss = taken >= u.base.hpMax * 0.15;
      const cumulative = 1 - hpPct >= 0.3;
      const nearBreak = hpPct <= this.rules.morale.breakAt / 100;
      if (heavyLoss || cumulative || nearBreak) {
        const causes = [heavyLoss ? '重伤亡' : '', cumulative ? '累计伤亡' : '', nearBreak ? '濒临崩溃' : '']
          .filter(Boolean)
          .join('且');
        // 多因叠加 DC 更高（baseDC 由规则包定义，默认 10）
        const dc = causes.includes('且') ? this.rules.morale.baseDC + 2 : this.rules.morale.baseDC;
        if (this.moraleCheck(u, dc, causes)) {
          routedThisRound.add(u.id);
        }
      }
    }
    // 溃逃连锁：邻近（同区或相邻区）且累计受损过三成的同阵营单位追加检定
    // —— 主检定通过不代表稳住：目睹友军崩溃是独立的士气压力源
    const chained = new Set<string>();
    for (const rid of routedThisRound) {
      const routed = this.byId(rid);
      for (const u of this.combatants) {
        if (u.side !== routed.side || u.id === rid || chained.has(u.id)) continue;
        if (u.status !== 'ready' || u.scale !== 'company') continue;
        if (u.hp / Math.max(1, u.base.hpMax) > 0.7) continue;
        if (!this.isNear(u, routed)) continue;
        chained.add(u.id);
        if (this.moraleCheck(u, this.rules.morale.baseDC + 2, `目睹${routed.name}溃逃`)) {
          routedThisRound.add(u.id);
        }
      }
    }

    // ---- 疲劳与重整 ----
    for (const u of this.combatants) {
      if (u.status !== 'ready') continue;
      if (u.engagedWith.length > 0) {
        const resist = this.flagValue(u, 'fatigue-resist') ?? 1;
        u.fatigue = Math.min(4, u.fatigue + (resist < 1 ? 0.5 : 1));
        this.applyFatigue(u);
      } else if (u.fatigue > 0) {
        u.fatigue = Math.max(0, u.fatigue - 1); // 脱战恢复
        this.applyFatigue(u);
      }
    }
    // 溃逃单位的重整尝试：DC 随溃逃次数递增，溃散三次即彻底退出战场
    for (const u of this.combatants) {
      if (u.status !== 'routing') continue;
      const cnt = this.routCounts.get(u.id) ?? 1;
      if (cnt >= 3) {
        u.status = 'fled';
        this.recordEvent({ round: this.round, kind: 'morale', participants: [u.id], text: `${u.name} 彻底溃散，退出战场` });
        continue;
      }
      const dc = this.rules.morale.baseDC + 2 + (cnt - 1) * 3;
      const roll = rollDice(`1d${this.rules.morale.dieMax}`, this.rng);
      if (roll.total + Math.floor((u.morale ?? 0) / 10) >= dc) {
        u.status = 'ready';
        this.recordEvent({ round: this.round, kind: 'morale', participants: [u.id], text: `${u.name} 重整旗鼓，重返战线` });
      } else {
        this.recordEvent({ round: this.round, kind: 'morale', participants: [u.id], text: `${u.name} 仍在溃逃` });
      }
    }

    this.orders.clear();
    // 技能冷却递减
    for (const u of this.combatants) for (const s of u.abilityState) if (s.cdLeft > 0) s.cdLeft -= 1;
    this.round += 1;
    this.refreshCp();
    this.recordEvent({ round: this.round, kind: 'round', text: `—— 第 ${this.round} 回合 ——` });
  }

  /** 支援阶段：自动释放无消耗技能。
   *  进攻技能集火血量比最低的敌军；治疗技能在友军重伤（血量比<50%）时支援
   *  最重伤员；召唤只受技能本身的冷却/次数约束，不再额外掷一个隐藏概率。 */
  private autoSupport(): void {
    for (const u of this.combatants) {
      if (u.status !== 'ready') continue;
      for (const a of u.abilities) {
        if (a.cost) continue; // 军团无资源池，消耗型技能不自动释放
        const dmg = a.effects.some((e) => e.op === 'damage');
        const heal = a.effects.some((e) => e.op === 'heal');
        const summon = a.effects.some((e) => e.op === 'summon');
        if (!dmg && !heal && !summon) continue;
        const st = u.abilityState.find((s) => s.abilityId === a.id) ?? { abilityId: a.id, cdLeft: 0, used: 0 };
        if (!u.abilityState.some((s) => s.abilityId === a.id)) u.abilityState.push(st);
        if (st.cdLeft > 0) continue;
        if (a.usesPerBattle !== undefined && st.used >= a.usesPerBattle) continue;
        if (dmg) {
          const foes = this.readyUnits(u.side === 'ally' ? 'enemy' : 'ally');
          if (!foes.length) continue;
          const tgt = [...foes].sort(
            (x, y) => x.hp / Math.max(1, x.base.hpMax) - y.hp / Math.max(1, y.base.hpMax),
          )[0]!;
          this.useAbility(u.id, a.id, tgt.id);
        } else if (heal) {
          // 治疗/补充兵员：优先最重伤员（血量比<50%）；全员健康则不浪费冷却位
          if (a.target === 'self') {
            if (u.hp / Math.max(1, u.base.hpMax) >= 0.5) continue;
            this.useAbility(u.id, a.id, undefined);
          } else {
            const wounded = this.combatants
              .filter((c) => c.side === u.side && c.status === 'ready' && c.hp / Math.max(1, c.base.hpMax) < 0.5)
              .sort((x, y) => x.hp / Math.max(1, x.base.hpMax) - y.hp / Math.max(1, y.base.hpMax));
            if (!wounded.length) continue;
            this.useAbility(u.id, a.id, wounded[0]!.id);
          }
        } else {
          this.useAbility(u.id, a.id, undefined);
        }
      }
    }
  }

  /** 军团技能（支援阶段自动 / 面板手动）：伤害走统一管线，士气/治疗/状态直接结算 */
  useAbility(unitId: string, abilityId: string, targetId?: string): { ok: boolean; reason?: string } {
    if (this.rules.resolutionVersion === 'v2') {
      const host = [...this.attached].find(([, hero]) => hero === unitId)?.[0] ?? unitId;
      return this.issue({ unitId: host, type: 'ability', abilityActorId: unitId, abilityId, targetId });
    }
    const u = this.byId(unitId);
    if (u.status !== 'ready') return { ok: false, reason: `${u.name} 无法行动（${u.status}）` };
    const ability = u.abilities.find((a) => a.id === abilityId);
    if (!ability) return { ok: false, reason: `${u.name} 没有技能 ${abilityId}` };
    const chosenTarget = ability.target === 'self' ? u : targetId ? this.byId(targetId) : ability.target === 'ally' ? u : undefined;
    const unavailable = abilityUsabilityReason(u, ability);
    if (unavailable) return { ok: false, reason: unavailable };
    const invalidTarget = abilityTargetReason({
      actor: u,
      ability,
      target: chosenTarget,
      distance: chosenTarget ? this.abilityDistance(u, chosenTarget) : undefined,
    });
    if (invalidTarget) return { ok: false, reason: invalidTarget };

    // 所有合法性检查完成后才创建状态、扣资源，非法施法不会污染存档。
    const stateId = ability.cooldownGroup ?? abilityId;
    const state = u.abilityState.find((s) => s.abilityId === stateId) ?? { abilityId: stateId, cdLeft: 0, used: 0 };
    if (!u.abilityState.some((s) => s.abilityId === stateId)) u.abilityState.push(state);
    if (ability.cost) u.resources[ability.cost.resource]! -= ability.cost.amount;
    state.used += 1;

    const logBits = [`${this.zoneOf(u)}｜${u.name} 发动【${ability.name}】`];
    for (const eff of ability.effects) {
      const t = chosenTarget;
      switch (eff.op) {
        case 'damage': {
          if (!t || t.status !== 'ready') break;
          const cast = (def: Combatant) =>
            this.resolveAttackWithEnvironment({
              attacker: u, defender: def, rng: this.rng, rules: this.rules,
              conditionDefs: this.conditionMap(), traitRegistry: this.traitRegistry,
              abilityDamage: { baseDice: eff.baseDice, apDice: eff.apDice, channel: ability.channel, penetration: ability.penetration },
              extraMods: this.stanceMods(u, def, {}), defenderMods: this.defModsFor(def),
              ranged: eff.tag === 'ranged' ? true : undefined,
            });
          const res = cast(t);
          // 伤害文本不进技能条目：recordAttack 已单独记 attack 条目（含完整结算），
          // 此处重复会让结算卡双重显示、回合纪要重复计数
          this.recordAttack(u, t, res, '支援');
          // 覆盖形态：蔓延到同侧另一支敌军（威力已按 0.8 档校准）
          if (eff.shape === 'burst') {
            const others = this.readyUnits(t.side as 'ally' | 'enemy').filter((f) => f.id !== t!.id);
            if (others.length) {
              const res2 = cast(others[0]!);
              this.recordAttack(u, others[0]!, res2, '支援·覆盖');
            }
          }
          break;
        }
        case 'morale': {
          const mt = t ?? u;
          if (mt.morale !== undefined) {
            const before = mt.morale;
            mt.morale = Math.max(0, Math.min(mt.base.moraleMax ?? 100, mt.morale + eff.amount));
            logBits.push(`${mt.name} 士气 ${before}→${mt.morale}`);
          }
          break;
        }
        case 'heal': {
          const ht = t ?? u;
          const amount = eff.amount ?? rollDice(eff.dice!, this.rng).total;
          const before = ht.hp;
          ht.hp = Math.min(ht.base.hpMax, ht.hp + amount);
          logBits.push(`${ht.name} 补充兵力 ${before}→${ht.hp}`);
          break;
        }
        case 'condition': {
          const ct = t ?? u;
          ct.conditions.push({ id: eff.conditionId, dur: eff.dur });
          logBits.push(`${ct.name} 获得【${eff.conditionId}】${eff.dur}回合`);
          break;
        }
        case 'summon': {
          // 召唤落地：面板注入的 summonUnit 回调生成单位并加入会战，分配战区。
          const tmpl = eff.templateId;
          if (this.summonUnit) {
            const count = Math.max(1, eff.count || 1);
            for (let n = 0; n < count; n++) {
              const spawned = this.summonUnit(tmpl, u.side);
              if (!spawned) {
                logBits.push(`（召唤失败：模板 ${tmpl} 无可用单位）`);
                break;
              }
              spawned.status = 'ready';
              // 分配战区：默认中军，随召唤者侧就近
              const zone = this.zoneOf(this.byId(u.id));
              if (this.zones && !spawned.tags.some((x) => x.startsWith('zone:'))) {
                spawned.tags = [...spawned.tags, `zone:${zone}`];
              }
              spawned.engagedWith = [];
              spawned.nonLethal=this.nonLethal;this.combatants.push(spawned);
              logBits.push(`【召唤】${spawned.name} 加入战场（${spawned.hp}/${spawned.base.hpMax} 兵力）`);
            }
          } else {
            logBits.push(`（召唤请求：${tmpl}×${eff.count}）`);
          }
          break;
        }
        default:
          break; // resource 由面板层处理
      }
    }
    if (ability.cooldown) state.cdLeft = ability.cooldown;
    this.recordEvent({ round: this.round, kind: 'ability', text: logBits.join('\n') });
    return { ok: true };
  }

  /** 将翼位映射成技能射程使用的离散距离；未启用翼位系统时视为同一战区。 */
  private abilityDistance(a: Combatant, b: Combatant): number {
    if (this.rules.resolutionVersion === 'v2') return formationDistance(a, b);
    if (!this.zones?.length) return 0;
    const ai = this.zones.indexOf(this.zoneOf(a));
    const bi = this.zones.indexOf(this.zoneOf(b));
    if (ai < 0 || bi < 0) return 0;
    return Math.abs(ai - bi);
  }

  /** 组装态势修正：克制矩阵、疲劳、固守反制、英雄嵌入、战场环境 */
  private stanceMods(u: Combatant, t: Combatant, o: { charge?: boolean; braced?: boolean }): import('../bonus.js').Modifier[] {
    const mods: import('../bonus.js').Modifier[] = [];
    const counter = counterMod(this.rules, u.archetype, t.archetype);
    if (counter !== 0) {
      mods.push({ source: 'stance', name: '兵种克制', kind: 'atk', type: 'flat', value: counter });
    }
    if (o.charge && o.braced) {
      mods.push({ source: 'stance', name: '固守反制', kind: 'atk', type: 'flat', value: -2 });
    }
    const heroId = this.attached.get(u.id);
    if (heroId && this.byId(heroId).status === 'ready') {
      mods.push({ source: 'hero', name: `将领·${this.byId(heroId).name}`, kind: 'atk', type: 'flat', value: 1 });
    }
    if (this.rules.resolutionVersion !== 'v2') mods.push(...fieldModsFor(u, this.fieldTags, this.traitRegistry).filter((m) => m.kind === 'atk'));
    return mods;
  }

  private resolveManeuver(o: Order): void {
    const u = this.byId(o.unitId);
    if (u.status !== 'ready' || u.engagedWith.length) return;
    if (o.type === 'shift-left' || o.type === 'shift-right') {
      if (!this.zones?.length) return;
      const from = this.zoneOf(u);
      const idx = this.zones.indexOf(from);
      const next = idx + (o.type === 'shift-left' ? -1 : 1);
      if (idx < 0 || next < 0 || next >= this.zones.length) {
        this.recordEvent({ round: this.round, kind: 'move', participants: [u.id], text: `${u.name} 尝试转移战区，但已在边翼` });
        return;
      }
      const to = this.zones[next]!;
      u.tags = [...u.tags.filter((t) => !t.startsWith('zone:')), `zone:${to}`];
      this.recordEvent({ round: this.round, kind: 'move', participants: [u.id], text: `${u.name} 转移战区：${from}→${to}` });
      return;
    }
    const before = this.rankOf(u);
    const ranks = ['front', 'rear', 'reserve'] as const;
    const idx = ranks.indexOf(before);
    const next = idx + (o.type === 'rank-forward' ? -1 : 1);
    if (next < 0 || next >= ranks.length) {
      this.recordEvent({ round: this.round, kind: 'move', participants: [u.id], text: `${u.name} 无法继续${o.type === 'rank-forward' ? '前移' : '后撤'}变阵` });
      return;
    }
    const after = ranks[next]!;
    u.tags = [...u.tags.filter((t) => !t.startsWith('rank:')), `rank:${after}`];
    const label = { front: '前排', rear: '后排', reserve: '预备队' } as const;
    this.recordEvent({ round: this.round, kind: 'move', participants: [u.id], text: `${u.name} 变阵：${label[before]}→${label[after]}` });
  }

  /** 防御方战场环境修正（守城工事 def 类等） */
  private defModsFor(t: Combatant): import('../bonus.js').Modifier[] {
    return this.rules.resolutionVersion === 'v2' ? [] : fieldModsFor(t, this.fieldTags, this.traitRegistry).filter((m) => m.kind === 'def');
  }

  private recordAttack(u: Combatant, t: Combatant, res: import('../damage.js').AttackResolution, label = ''): void {
    this.recordEvent({
      round: this.round,
      kind: 'attack',
      text: `${this.zoneOf(u)}｜${label ? `${label}｜` : ''}${res.text}`,
      resolution: res,
    });
    if (res.finalDamage > 0) {
      this.damageTaken.set(t.id, (this.damageTaken.get(t.id) ?? 0) + (this.rules.resolutionVersion === 'v2' ? res.hpBefore - res.hpAfter : res.finalDamage));
    }
    if (this.rules.resolutionVersion === 'v2') {
      applyWeaponConditions(t, res.onHitConditions);
      if (res.onHitConditions?.some((condition) => this.conditions.get(condition.id)?.skipTurn || this.conditions.get(condition.id)?.preventMove)) this.flightCauses.set(t.id, u.id);
    }
    this.defeatUnit(t, u);
  }
  private defeatUnit(t: Combatant, u?: Combatant): void {
    if(this.rules.resolutionVersion==='v2') {
      const earned=casualtyXp(t,this.xpMinimum);
      if(t.side==='enemy')this.xpGained+=earned;
      const owner=u?.summonerId??u?.id;
      if(owner&&earned&&u?.side!==t.side&&u?.side!=='neutral')this.xpByUnit.set(owner,(this.xpByUnit.get(owner)??0)+earned);
    }
    if (t.hp <= 0 && t.status !== 'dead' && !(this.nonLethal && t.status === 'dying')) {
      if(this.rules.resolutionVersion==='v2')this.defeatedIds.add(t.id);
      t.status = this.nonLethal ? 'dying' : 'dead';
      this.recordEvent({ round: this.round, kind: 'death', participants: [t.id], text: `${t.name} ${this.nonLethal ? '濒死，非致命失能' : this.rules.resolutionVersion === 'v2' && t.scale === 'hero' ? '阵亡' : '全军覆没'}` });
      if (this.rules.resolutionVersion !== 'v2' && t.side === 'enemy' && !this.defeatedIds.has(t.id) ) {
        this.defeatedIds.add(t.id);
        this.xpGained += t.xpValue ?? 0;
        const owner = u?.id;
        if (owner) this.xpByUnit.set(owner, (this.xpByUnit.get(owner) ?? 0) + (t.xpValue ?? 0));
      }
      this.checkCommanderLost(t);
      for (const eid of [...t.engagedWith]) {
        const e = this.byId(eid);
        e.engagedWith = e.engagedWith.filter((x) => x !== t.id);
      }
      t.engagedWith = [];
    }
  }

  /**
   * 自动列阵（引擎侧启发式，面板「自动军令/敌方自动」共用）：
   * 具射击资格 → 齐射；机动 → 冲锋；其余攻击。
   * 目标选择：已接战单位优先打接战对象，未接战者按序轮转分散火力
   * （避免全军集火单个连队导致交换比失真）。指令已占或不可发的单位跳过。
   * 返回成功下达的指令数。
   */
  autoOrders(side: 'ally' | 'enemy', reserved: readonly string[] = []): number {
    if (this.rules.resolutionVersion === 'v2') return this.autoV2Orders(side, reserved);
    let issued = 0;
    const units = this.readyUnits(side);
    units.forEach((u, i) => {
      if (this.orders.has(u.id)) return;
      const rank = this.rankOf(u);
      if (rank === 'reserve' || (rank === 'rear' && !isRangedCapable(u))) {
        if (this.issue({ unitId: u.id, type: 'rank-forward' }).ok) issued += 1;
        return;
      }
      const foeSide = side === 'ally' ? 'enemy' : 'ally';
      const foes = this.readyUnits(foeSide);
      if (!foes.length) return;
      const engaged = u.engagedWith
        .map((id) => this.byId(id))
        .filter((t) => t.status === 'ready');
      // 默认目标：优先已接战对手 → 同翼/相邻翼 → 轮转（远景兜底，仅远程可及若无可及目标）
      const prefer0: Order['type'] = isRangedCapable(u) ? 'volley' : u.archetype === 'mobile' ? 'charge' : 'attack';
      const meleeTargets = foes.filter((f) => this.canMeleeReach(u, f));
      if (prefer0 !== 'volley' && !engaged.length && !meleeTargets.length) {
        // 与敌军隔着一个翼位时，自动军令先横移接近；没有翼位系统则原地待命。
        if (this.zones?.length) {
          const from = this.zones.indexOf(this.zoneOf(u));
          const closest = foes
            .map((f) => this.zones!.indexOf(this.zoneOf(f)))
            .filter((idx) => idx >= 0)
            .sort((a, b) => Math.abs(a - from) - Math.abs(b - from))[0];
          const shift = closest !== undefined && closest < from ? 'shift-left' : closest !== undefined && closest > from ? 'shift-right' : undefined;
          if (shift && this.issue({ unitId: u.id, type: shift }).ok) issued += 1;
          else if (this.issue({ unitId: u.id, type: 'hold' }).ok) issued += 1;
        } else if (this.issue({ unitId: u.id, type: 'hold' }).ok) {
          issued += 1;
        }
        return;
      }
      const near = prefer0 !== 'volley' ? meleeTargets : foes;
      let t = engaged[0] ?? near[i % Math.max(1, near.length)] ?? foes[i % foes.length]!;
      let prefer: Order['type'] = prefer0;
      // 机动载具的冲锋倾向：未接战的机动+射击单位四成概率弃齐射、借机动冲锋砸阵
      // ——打破全远程编制站桩对射，并触发骑射反击与接战缠斗；指挥点不足时退回齐射
      if (prefer === 'volley' && u.archetype === 'mobile' && engaged.length === 0 && this.rng.next() < 0.4) {
        prefer = 'charge';
      }
      const r = this.issue({ unitId: u.id, type: prefer, targetId: t.id });
      if (r.ok) {
        issued += 1;
        return;
      }
      const fallback: Order['type'] = prefer === 'charge' && isRangedCapable(u) ? 'volley' : 'attack';
      if (this.issue({ unitId: u.id, type: fallback, targetId: t.id }).ok) issued += 1;
    });
    return issued;
  }

  /** 主指挥阵亡/溃逃：标记并施加指挥点惩罚（面板据此切换自动军令） */
  private checkCommanderLost(u: Combatant): void {
    if (this.rules.resolutionVersion === 'v2') {
      if (u.id !== this.commanderId) return;
      const hostId = [...this.attached].find(([, id]) => id === u.id)?.[0];
      this.commanderLost = u.status !== 'ready' || !!hostId && this.byId(hostId).status !== 'ready'; return;
    }
    if (this.commanderLost || !this.commanderId || u.id !== this.commanderId) return;
    if (u.status === 'dead' || u.status === 'dying' || u.status === 'routing' || u.status === 'fled') {
      this.commanderLost = true;
      this.recordEvent({
        round: this.round,
        kind: 'morale',
        text: `主帅 ${u.name} 倒下——我军失去统一指挥，指挥点减半，军令转为自行其是`,
      });
      this.refreshCp();
    }
  }

  private engage(a: Combatant, b: Combatant): void {
    if (a.tags.includes('flying') || b.tags.includes('flying')) return; // 飞行不占线
    if (!a.engagedWith.includes(b.id)) a.engagedWith.push(b.id);
    if (!b.engagedWith.includes(a.id)) b.engagedWith.push(a.id);
  }

  private isNear(a: Combatant, b: Combatant): boolean {
    if (!this.zones) return true;
    const za = this.zoneOf(a);
    const zb = this.zoneOf(b);
    if (za === zb) return true;
    const adj = ZONE_ADJACENCY_DEFAULT[za] ?? [];
    return adj.includes(zb);
  }

  /** 临时增减益只改变当前有效士气，不烘焙到长期档案。 */
  effectiveMorale(u: Combatant): number {
    if (this.rules.resolutionVersion === 'v2') return moraleProfile(this.observationContext(), u, this.traitRegistry).effective;
    const flat = resolveStack(collectMods(u, {}, this.conditionMap(), [...this.auraModsFor(u), ...fieldModsFor(u, this.fieldTags, this.traitRegistry)], this.traitRegistry), 'morale', {}, { maxFlat: 100 }).flatTotal;
    return Math.max(0, Math.min(100, (u.morale ?? 0) + flat));
  }

  /** 士气检定：d20 + 士气/10 + 修正 vs DC。返回是否溃逃。 */
  moraleCheck(u: Combatant, dc: number, cause: string): boolean {
    if (this.hasTraitEffect(u, 'immuneMorale')) {
      this.recordEvent({ round: this.round, kind: 'morale', participants: [u.id], text: `${u.name} 不溃——无视士气检定（${cause}）` });
      return false;
    }
    const legacyMods = [
      ...traitRuntimeMods(u.traits, this.traitRegistry, u),
      ...this.auraModsFor(u),
      ...fieldModsFor(u, this.fieldTags, this.traitRegistry).filter((m) => m.kind === 'morale'),
    ];
    const flat = u.rulesVersion === 'v2'
      ? resolveStack(collectMods(u, {}, this.conditionMap(), [...this.auraModsFor(u), ...fieldModsFor(u, this.fieldTags, this.traitRegistry)], this.traitRegistry), 'morale', {}, { maxFlat: 100 }).flatTotal
      : legacyMods.filter((m) => m.kind === 'morale' && m.type === 'flat').reduce((s, m) => s + m.value, 0);
    const r = rollDice(`1d${this.rules.morale.dieMax}`, this.rng);
    const total = r.total + (u.rulesVersion === 'v2' ? Math.floor(Math.max(0, (u.morale ?? 0) + flat) / 10) : Math.floor((u.morale ?? 0) / 10) + flat);
    if (total < dc) {
      u.status = 'routing';
      this.routCounts.set(u.id, (this.routCounts.get(u.id) ?? 0) + 1);
      // 溃逃折损：溃兵沿途散落，编制减员一成
      if (u.scale === 'company') u.hp = Math.max(1, Math.round(u.hp * 0.9));
      this.checkCommanderLost(u);
      for (const eid of [...u.engagedWith]) {
        const e = this.byId(eid);
        e.engagedWith = e.engagedWith.filter((x) => x !== u.id);
      }
      u.engagedWith = [];
      this.recordEvent({ round: this.round, kind: 'routing', participants: [u.id], text: `${u.name} 士气崩溃（${cause}）：d20[${r.kept.join(',')}]${flat ? (flat > 0 ? '+' : '') + flat : ''}=${total} < ${dc}，溃逃！` });
      return true;
    }
    this.recordEvent({ round: this.round, kind: 'morale', participants: [u.id], text: `${u.name} 顶住了（${cause}）：士气检定 ${total} ≥ ${dc}` });
    return false;
  }

  /** 恐惧/恐怖/统率光环对该单位的士气修正 */
  private auraModsFor(u: Combatant): import('../bonus.js').Modifier[] {
    if (this.rules.resolutionVersion === 'v2') return moraleProfile(this.observationContext(), u, this.traitRegistry).auraMods;
    const out: import('../bonus.js').Modifier[] = [];
    for (const other of this.combatants) {
      if (other.id === u.id || other.status === 'dead' || other.status === 'routing') continue;
      for (const id of activeTraitIds(other)) {
        const t = getTrait(id, this.traitRegistry);
        if (!t) continue;
        for (const e of t.effects) {
          if (e.kind !== 'moraleAura') continue;
          const applies =
            (e.scope === 'enemySide' && other.side !== u.side) ||
            (e.scope === 'side' && other.side === u.side);
          if (applies) {
            out.push({ source: 'stance', name: `${t.name}·${other.name}`, kind: 'morale', type: 'flat', value: e.value });
          }
        }
      }
    }
    return out;
  }

  private hasTraitEffect(u: Combatant, kind: string): boolean {
    for (const id of activeTraitIds(u)) {
      const t = getTrait(id, this.traitRegistry);
      if (t?.effects.some((e) => e.kind === kind)) return true;
    }
    return false;
  }

  private flagValue(u: Combatant, flag: string): number | undefined {
    for (const id of activeTraitIds(u)) {
      const t = getTrait(id, this.traitRegistry);
      for (const e of t?.effects ?? []) {
        if (e.kind === 'flag' && e.flag === flag) return e.value ?? 1;
      }
    }
    return undefined;
  }

  /** 疲劳等级同步为状态条件（走既有加成管线，含防御端） */
  private applyFatigue(u: Combatant): void {
    const tier = Math.min(4, Math.floor(u.fatigue));
    const want = FATIGUE_COND[tier]!;
    u.conditions = u.conditions.filter((c) => !c.id.startsWith('fat-'));
    if (want) u.conditions.push({ id: want, dur: 99 });
  }

  forcedWinner?: 'ally' | 'enemy' | 'draw';
  finishBattle(reason: 'ceasefire' | 'surrender'): void {
    if (this.isOver()) return;
    this.forcedWinner = reason === 'surrender' ? 'enemy' : 'draw';
    this.orders.clear();
    this.recordEvent({ round: this.round, kind: 'battle-end', text: reason === 'surrender' ? '我方投降，敌方获胜；保留实际伤亡，存活者不视为死亡或成功撤离' : '玩家停止交战，按当前伤亡结算为停战；倒地者未被补杀，未判定俘虏或敌方投降' });
  }
  private remainingUnits(side: 'ally' | 'enemy'): Combatant[] {
    return this.combatants.filter((u) => u.side === side && (u.status === 'ready' || this.rules.resolutionVersion === 'v2' && u.status === 'routing'));
  }
  isOver(): boolean {
    if (this.forcedWinner) return true;
    if (this.rules.resolutionVersion === 'v2') return this.round > this.roundLimit || (['ally', 'enemy'] as const).some((side) => !this.remainingUnits(side).some((u) => !this.isAttached(u.id)));
    for (const side of ['ally', 'enemy'] as const) {
      if (this.remainingUnits(side).length === 0) return true;
    }
    return false;
  }

  winner(): 'ally' | 'enemy' | 'draw' | undefined {
    if (this.forcedWinner) return this.forcedWinner;
    if (!this.isOver()) return undefined;
    const a = this.remainingUnits('ally').filter((u) => this.rules.resolutionVersion !== 'v2' || !this.isAttached(u.id)).length;
    const e = this.remainingUnits('enemy').filter((u) => this.rules.resolutionVersion !== 'v2' || !this.isAttached(u.id)).length;
    if (a > 0 && e > 0) return 'draw';
    if (a > 0) return 'ally';
    if (e > 0) return 'enemy';
    return 'draw';
  }

  endingReason(): 'round-limit' | 'forces-broken' | undefined {
    if (!this.isOver()) return undefined;
    return this.rules.resolutionVersion === 'v2' && this.round > this.roundLimit
      && (['ally', 'enemy'] as const).every((side) => this.readyUnits(side).some((u) => !this.isAttached(u.id)))
      ? 'round-limit' : 'forces-broken';
  }

  private conditionMap(): Map<string, ConditionDef> {
    const m = new Map<string, ConditionDef>();
    for (const c of this.conditions.all()) m.set(c.id, c);
    return m;
  }

  // ---------- 快照（面板持久化战斗记录用） ----------

  /** 导出可 JSON 序列化的完整会战状态（关闭面板后恢复战场与战报）。
   *  含种子随机状态：种子源战斗恢复后掷骰序列与快照时刻一致（审计回放）。 */
  toSnapshot(): Record<string, unknown> {
    return {
      v: 1, allyTactic: this.allyTactic, commanderProfiles: this.commanderProfiles, nonLethal: this.nonLethal, defeatedIds: [...this.defeatedIds],
      previousOrders: [...this.previousOrders], resolvedRounds: [...this.resolvedRounds], exposedHeroes: [...this.exposedHeroes],
      lastPhases: this.lastPhases, frontControl: this.frontControl, ...(this.lastReport ? { roundReport: structuredClone(this.lastReport) } : {}),
      combatants: this.combatants,
      rulesId: this.rules.id,
      seed: this.seed,
      rngState: this.rng instanceof SeededRng ? this.rng.getState() : undefined,
      round: this.round,
      roundLimit: this.roundLimit,
      log: this.log,
      orders: [...this.orders.values()],
      cp: this.cp,
      attached: [...this.attached],
      xpGained: this.xpGained, xpMinimum: [...this.xpMinimum], xpInitialStrength: [...this.xpInitialStrength],
      xpByUnit: [...this.xpByUnit],
      commanderId: this.commanderId,
      commanderLost: this.commanderLost,
      forcedWinner: this.forcedWinner,
      routCounts: [...this.routCounts],
      fieldTags: this.fieldTags,
      reloadCd: [...this.reloadCd],
      zones: this.zones,
      started: this.started,
    };
  }

  /** 从快照重建会战（回调与注册表由调用方重新挂回） */
  static fromSnapshot(
    snap: Record<string, any>,
    opts: { traitRegistry?: Map<string, Trait>; summonUnit?: (templateId: string, side: Side) => Combatant | null } = {},
  ): MassBattle {
    const lifeBefore = new Map((snap.combatants as Combatant[]).map(unit => [unit.id, {
      hp: unit.hp, maximum: unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp, pressure: unit.moraleState?.damagePenalty,
    }]));
    // 掷骰可复现：快照带 rngState（种子源）时逐步还原；旧快照/crypto 源退真随机
    const rng: Rng =
      typeof snap.rngState === 'number'
        ? (() => {
            const r = new SeededRng(typeof snap.seed === 'string' ? snap.seed : 'replay');
            r.setState(snap.rngState as number);
            return r;
          })()
        : liveRng();
    const b = new MassBattle({
      nonLethal: snap.nonLethal === true,
      combatants: snap.combatants,
      roundLimit: snap.roundLimit ?? 20,
      rules: rulesById(snap.rulesId),
      seed: snap.seed ?? randomSeed(),
      rng,
      traitRegistry: opts.traitRegistry,
      zones: snap.zones,
      commanderId: snap.commanderId,
      summonUnit: opts.summonUnit,
      field: { tags: snap.fieldTags ?? [] },
    });
    b.allyTactic = normalizeTactic(snap.allyTactic);
    b.commanderProfiles = normalizeCommanderProfiles(snap.commanderProfiles);
    b.round = snap.round ?? 1;
    b.previousOrders = new Map(snap.previousOrders ?? []); b.resolvedRounds = new Set(snap.resolvedRounds ?? []); b.exposedHeroes = new Set(snap.exposedHeroes ?? []);
    b.lastPhases = snap.lastPhases ?? []; b.frontControl = snap.frontControl ?? {};
    b.lastReport = restoreMassReport(snap.roundReport, b.round, b.combatants);
    b.log = [...(snap.log ?? [])];
    for (const unit of b.combatants) {
      const before = lifeBefore.get(unit.id), maximum = unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp;
      if (before?.maximum !== undefined && before.maximum !== maximum) b.recordEvent({ round: b.round, kind: 'condition', participants: [unit.id],
        text: `${unit.name} 单体生命上限调整：${before.maximum}→${maximum}${unit.scale === 'hero' ? `，当前生命${before.hp}→${unit.hp}` : '，编制不变'}；规则归一化，不计战斗伤害` });
      if (before?.pressure !== undefined && before.pressure !== unit.moraleState?.damagePenalty) b.recordEvent({ round: b.round, kind: 'condition', participants: [unit.id],
        text: `${unit.name} 受创士气压力按实际最大生命校准：${before.pressure}→${unit.moraleState?.damagePenalty}` });
    }
    b.orders = new Map((snap.orders ?? []).map((o: Order) => [o.unitId, o]));
    b.cp = snap.cp ?? b.cp;
    b.attached = new Map(snap.attached ?? []);
    b.xpMinimum = new Map([...initialXpStrength(b.combatants), ...(snap.xpMinimum ?? [])]);
    b.xpInitialStrength = new Map(snap.xpInitialStrength ?? []);
    b.xpGained = snap.xpGained ?? 0;
    b.xpByUnit = new Map(snap.xpByUnit ?? []);
    b.defeatedIds = new Set(snap.defeatedIds ?? b.combatants.filter(u=>u.status==='dead').map(u=>u.id));
    if(!snap.xpMinimum)for(const id of b.defeatedIds)b.xpMinimum.set(id,0);
    b.commanderLost = !!snap.commanderLost;
    if (['ally', 'enemy', 'draw'].includes(snap.forcedWinner)) b.forcedWinner = snap.forcedWinner;
    b.routCounts = new Map(snap.routCounts ?? []);
    b.reloadCd = new Map(snap.reloadCd ?? []);
    (b as unknown as { started: boolean }).started = !!snap.started;
    return b;
  }
}

/** 疲劳 tiers：全面战争式全属性衰减 */
const FATIGUE_TIER_DEFS: ConditionDef[] = [
  { id: 'fat-1', name: '轻度疲劳', desc: '战斗消耗开始显现', mods: [] },
  {
    id: 'fat-2', name: '中度疲劳', desc: '攻击/防御 -1',
    mods: [
      { source: 'condition', name: '中度疲劳', kind: 'atk', type: 'flat', value: -1 },
      { source: 'condition', name: '中度疲劳', kind: 'def', type: 'flat', value: -1 },
    ],
  },
  {
    id: 'fat-3', name: '重度疲劳', desc: '攻击/防御 -2',
    mods: [
      { source: 'condition', name: '重度疲劳', kind: 'atk', type: 'flat', value: -2 },
      { source: 'condition', name: '重度疲劳', kind: 'def', type: 'flat', value: -2 },
    ],
  },
  {
    id: 'fat-4', name: '力竭', desc: '攻击/防御 -3、速度 -2',
    mods: [
      { source: 'condition', name: '力竭', kind: 'atk', type: 'flat', value: -3 },
      { source: 'condition', name: '力竭', kind: 'def', type: 'flat', value: -3 },
      { source: 'condition', name: '力竭', kind: 'spd', type: 'flat', value: -2 },
    ],
  },
];
