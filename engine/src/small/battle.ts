import { spendAbility } from '../ability-state.js';
import { assertBattleCapacity } from '../battle-limits.js';
import { smallBattleResult } from '../battle-result.js';
import { prepareGridDeployment } from './spatial.js';
import { unitHeight, heightDefense, heightReach, standingTerrain, surfaceHeightAt, reportsHeights } from './height-map.js';
import { bonusMultiplier } from '../enhancements.js';
import { regionalOrder } from './team-tactics.js';
import { groundBlocked, isElevated, intactStructure, canClimbFrom, meleeHeightReason, meleeContact, structureDefense, structureDurability, damageStructure, weaponBreachBudget, STRUCTURE_NAMES } from './layers.js';
import { tacticalSkillCost, tacticalRestValue } from '../skill-economy.js';
import { isEnduranceModel, fatiguePenalty, abilityCost, prepareResourceModel, recoverSp, skillExertion, resourceRound } from '../resources.js';
import { actionPotential } from '../skill-tactics.js';
import { hasteMagnitude, hasteAttackScale } from '../haste.js';
import { commanderScores, normalizeCommanderProfiles, type CommanderProfiles } from '../commander-profile.js';
import { validateAccessories } from '../items.js';
import { areaTargets, zoneTarget, placeZone, settleZones, validateAreas, ZONE_NAMES } from '../area-effects.js';
import { tbWeaponShortName } from '../weapon-name.js';
import { grantBarrier, decayBarrier, validateBarrier } from '../barrier.js';
import { casualtyXp, initialXpStrength } from '../casualty-xp.js';
import { roundDamage } from '../probability.js';
import { prepareCombatModel, healingYield } from '../combat-model.js';
import { prepareArmsModel } from '../arms.js';
import { upgradeCombatSkills } from '../skill-upgrade.js';
import { normalizeTactic, type TacticalPreference } from '../tactical-preference.js';
import { calibrateAutocannon, calibrateWeaponHands } from '../gen/equipment.js';
import { gridAbility } from './skill-range.js';
import { gridWeapon, gridWeaponRange } from './weapon-range.js';
import { rangedScreen, rangedScreenReason } from '../guard-screen.js';
import { engagementWidth } from '../exposure.js';
import { skillWeapon, skillResourceChange, conjureSkillUnit, conjuredTemplate, summonedMemberLife } from '../skill-runtime.js';
import { applySkillTrait, isPositiveCondition } from '../skill-effects.js';
import { skillAttack } from '../skill-attack.js';
import { prepareCondition, applySkillCondition, dispelCandidates, applyDispel, applyPush, pushPreview, skillEffectLines, skillEffectValue, summonValue, conditionChance } from '../skill-effects.js';
import { applyWeaponConditions, poisonDamage, poisonFactor, conditionDamage } from '../afflictions.js';
import { isRangedWeapon, weaponReloadKey, weaponReloadTurns, meleeWeapon, validateMount, mountedShooting, steadyMovingShot } from '../loadout.js';
import { moraleProfile, moraleAttackMods, decideMorale, changeMorale, validateMoraleState, moraleRisk, moraleChangePreview, reconcileDamageMorale, recoverEntryMorale } from '../morale.js';
import { applyHealthLoss, applyCombatDamage, applyRecovery, recoveryCapacity, regenerationAmount, validateWounded } from '../recovery.js';
import {hasMemberHealth,memberHealth,memberHealthMax,MEMBER_HEALTH_MODEL} from '../member-health.js';
/**
 * 小规模战斗管线：先攻队列 → 交替行动 → 回合末结算。
 * 个体/小队/编队通用；单挑即 1v1 的本类实例。
 */

import type { BattleLogEntry, Combatant, EffectOp, RulePack, Side, Trait } from '../types.js';
import type { ConditionDef } from '../types.js';
import type { Rng } from '../rng.js';
import { SeededRng, liveRng, randomSeed } from '../rng.js';
import { cloneData } from '../clone.js';
import { parseDice, rollDice } from '../dice.js';
import { resolveAttack, previewAttack, penetrationContext, isRangedCapable, armorDR, qualityGapDR, beginPreviewScope, endPreviewScope, type AttackResolution, type AttackOpts } from '../damage.js';
import { sharedParticipants } from '../exposure.js';
import { diceAvg, rebuildDice } from '../data/weapons.js';
import { ConditionRegistry } from '../conditions.js';
import { LITE_D20, counterMod, rulesById } from '../rules.js';
import { getTrait, hasFlag, fieldModsFor, collectMods, resolveStack } from '../bonus.js';
import { BattleFeedback, type FeedbackUnit, type RoundFeedback } from '../battle-feedback.js';
import { activeTraitIds, activeConditionIds, expireTraitSources, traitSourceActive } from '../trait-sources.js';
import { bracePose, movementPoints, settleFatigue, addTacticalEffort, validateTacticalEffort } from '../tactics.js';
import { rangedTargetDistance, isAirborne, sameLayer, flightCapabilityReason, flightMaintenanceReason, fallDamage, validateFlightState } from '../aerial.js';
import { environmentTags } from '../environment.js';
import { traitRegistry as defaultTraitRegistry } from '../data/traits.js';
import { meleeLineBlocker, terrainTacticalValue, canOccupy, cellLabel, reportPlaceLabel, deployOnGrid, findGridPath, reachableGridPaths, gridCostsToGoals, gridDistance, lineOfSight, unitLineOfSight, neighbors, movementStepCost, retreatCells, validateField, type BattlefieldSpec, type GridPath } from './spatial.js';
import { canSpot, observedUnits, observeEvent, observedLog, revealUnit, revealContacts, settleConcealment, canReconceal, validateConcealment, type ObservationContext } from '../observation.js';
import {
  abilityTargetReason,
  abilityRangeDistance,
  abilityHeightReach,
  abilityUsabilityReason,
  estimateExpectedDamage,
  estimateHitChance,
  fallbackAbilityRange,
  pointBlankModifier,
  turnEconomy,
  weaponRangeSpec,
  weaponTargetReason,
  type ActionOption,
  type TurnEconomy,
} from '../actions.js';

export interface SmallBattleOpts {
  nonLethal?: boolean;
  battlefield?: BattlefieldSpec;
  combatants: Combatant[];
  rules?: RulePack;
  rng?: Rng;
  /** 提供则掷骰可复现（审计回放/测试） */
  seed?: string;
  extraConditions?: ConditionDef[];
  traitRegistry?: Map<string, Trait>;
  /** 战场环境标签（urban/siege/plains/night…），与 fieldMod 特质联动 */
  field?: { tags: string[] };
  /** 召唤落地回调：summon 效果由面板层生成单位并加入战斗（引擎保持纯数值，不引造怪器）。
   *  返回 null 表示无可用模板（召唤失败，仅记录意图）。 */
  summonUnit?: (templateId: string, side: Side, seed?: string) => Combatant | null;
}

export interface AbilityUseResult {
  ok: boolean;
  reason?: string;
  resolutions: AttackResolution[];
  heal?: number;
  log: string;
}

export interface SmallAttackOpts extends Partial<AttackOpts> {
  bypassTurn?: boolean;
  /** auto=贴身时优先副武器；primary/sidearm 供玩家在确认面板明确选择。 */
  weaponMode?: 'auto' | 'primary' | 'sidearm';
}

interface WeaponContext {
  weapon: Combatant['weapon'];
  ranged: boolean;
  useSidearm: boolean;
  reason?: string;
  pointBlankPenalty: number;
  landing?: boolean;
}

/** 开战阵位（一维战场 0~5）：我方左列、敌方右列 */
const START_POS: Record<'ally' | 'enemy' | 'neutral', Record<string, number>> = {
  ally: { infantry: 2, mobile: 1, ranged: 0 },
  enemy: { infantry: 3, mobile: 4, ranged: 5 },
  neutral: { infantry: 2, mobile: 1, ranged: 0 },
};

/** 距离带名称：0=接战 1=近距 2~3=中距 4+=远距 */
export function bandLabel(d: number): string {
  if (d <= 0) return '接战';
  if (d === 1) return '近距';
  if (d <= 3) return '中距';
  return '远距';
}

/** 骰面减半重建（溅射威力用）：保持骰型、均值取半 */
function halveDice(expr: string): string {
  return rebuildDice(diceAvg(expr) * 0.5, parseDice(expr).sides);
}

export class SmallBattle {
  readonly nonLethal: boolean;
  allyTactic: TacticalPreference = 'balanced';
  commanderProfiles: CommanderProfiles = {};
  readonly battlefield?: BattlefieldSpec;
  movementSpent = new Map<string, number>();
  reactionSpent = new Set<string>();
  overwatch = new Set<string>();
  /** 阵营共享的近距离搜查记录；只由实际可见的己方位置更新。 */
  private searchCoverage: Partial<Record<Side, number[]>> = {};
  /** 仅在自动行动选择期间存在：战场只读，同一阵营的观测结果复用到执行前。 */
  private observationMemo?: Map<Combatant['side'], Combatant[]>;
  controlRounds = { ally: 0, enemy: 0 };
  controlHold?: { side: 'ally' | 'enemy'; sinceRound: number; lastCountedRound?: number };
  objectiveWinner?: 'ally' | 'enemy' | 'draw';
  defeatedIds = new Set<string>();
  readonly combatants: Combatant[];
  readonly rules: RulePack;
  readonly rng: Rng;
  readonly conditions: ConditionRegistry;
  readonly traitRegistry: Map<string, Trait>;
  readonly seed: string;
  /** 召唤落地回调（模板 id + 阵营 → 新单位；null=无模板） */
  readonly summonUnit?: (templateId: string, side: Side, seed?: string) => Combatant | null;
  round = 0;
  turnOrder: string[] = [];
  turnIndex = 0;
  log: BattleLogEntry[] = [];
  /** 本战累计获得经验（击杀入账） */
  xpMinimum = new Map<string, number>();
  /** 开战实到人数，独立于随伤亡下降的防重复奖励最低值。 */
  xpInitialStrength = new Map<string, number>();
  xpGained = 0;
  /** 击杀记名经验：击杀者 id → 累计值（战后按单位分配用） */
  xpByUnit = new Map<string, number>();
  /** 本回合已移动的单位（移动后射击惩罚判定用），回合开始清空 */
  movedThisTurn = new Set<string>();
  /** 本回合已消耗主行动的单位；移动额度与主行动独立。 */
  actedThisTurn = new Set<string>();
  hasteSpent = new Map<string, number>();
  hasteMovement = new Map<string, number>();
  hasteSelected = new Set<string>();
  hasteOverwatch = new Map<string, number>();
  hasteAvailable(actorId: string): boolean {
    const actor = this.byId(actorId);
    return actor.status === 'ready' && this.isTurnOf(actorId) && hasteMagnitude(actor) > 0 && this.hasteSpent.get(actorId) !== this.round
      && !actor.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn);
  }
  selectHaste(actorId: string, selected: boolean): void {
    if (selected && !this.hasteAvailable(actorId)) throw Error('本轮没有可用加速动作');
    if (selected) this.hasteSelected.add(actorId); else this.hasteSelected.delete(actorId);
  }
  private usingHaste(actorId: string): boolean { return this.hasteAvailable(actorId) && (this.hasteSelected.has(actorId) || this.actedThisTurn.has(actorId)); }
  private nonSkillActionAvailable(actorId: string): boolean { return !this.byId(actorId).conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn) && (!this.actedThisTurn.has(actorId) || this.hasteAvailable(actorId)); }
  private spendAction(actorId: string, haste = this.usingHaste(actorId)): void {
    if (haste) { this.hasteSpent.set(actorId, this.round); this.hasteSelected.delete(actorId); }
    else this.actedThisTurn.add(actorId);
  }
  private activateHasteMovement(actorId: string): void {
    if (!this.hasteSelected.has(actorId) || !this.hasteAvailable(actorId)) return;
    this.hasteMovement.set(actorId, this.movementBudget(actorId));
    this.hasteSpent.set(actorId, this.round); this.hasteSelected.delete(actorId);
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: this.byId(actorId).name + ' 使用加速动作，获得一次额外机动' });
  }
  reloadReason(actorId: string, sidearm = false): string | undefined {
    const actor = this.byId(actorId), weapon = sidearm ? actor.sidearm : actor.weapon;
    if (!this.isTurnOf(actorId) || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId) || actor.conditions.some(c => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack))) return '当前不能装填';
    return !weapon || !(this.reloadCd.get(weaponReloadKey(actor, weapon)) ?? 0) ? '武器不需要装填' : undefined;
  }
  reloadWeapon(actorId: string, sidearm = false): void {
    const reason = this.reloadReason(actorId, sidearm); if (reason) throw Error(reason);
    const actor = this.byId(actorId), key = weaponReloadKey(actor, sidearm ? actor.sidearm : actor.weapon);
    this.reloadCd.set(key, Math.max(0, this.reloadCd.get(key)! - 1)); this.spendAction(actorId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actorId], text: actor.name + ' 主动装填，剩余装填时间减少1轮' });
  }
  /** 战场环境标签 */
  readonly fieldTags: string[];
  /** 武器装填冷却：单位 id → 剩余装填回合 */
  reloadCd = new Map<string, number>();
  private started = false;
  private feedback?: BattleFeedback;

  constructor(opts: SmallBattleOpts) {
    this.nonLethal = opts.nonLethal === true;
    if (opts.battlefield) validateField(opts.battlefield);
    this.battlefield = opts.battlefield ? structuredClone(opts.battlefield) : undefined;
    this.combatants = opts.combatants;
    this.xpMinimum = initialXpStrength(this.combatants);
    this.xpInitialStrength = initialXpStrength(this.combatants);
    for (const unit of this.combatants) unit.nonLethal = this.nonLethal;
    for (const unit of this.combatants) { calibrateAutocannon(unit.weapon); calibrateAutocannon(unit.sidearm); calibrateWeaponHands(unit.weapon); calibrateWeaponHands(unit.sidearm); }
    for (const unit of this.combatants) {
      validateConcealment(unit.tacticalRevealed); validateFlightState(unit.airborne); validateWounded(unit); validateBarrier(unit.barrier); validateAreas(unit); validateAccessories(unit); validateMount(unit); validateMoraleState(unit.moraleState);
      if (unit.elevation !== undefined && (unit.elevation !== 1 || !this.battlefield?.layerVersion || unit.airborne || unit.pos !== undefined && !intactStructure(this.battlefield, unit.pos)?.top)) throw Error('平台站位数据不合法');
      if (unit.formationPosition !== undefined) throw new Error('实际会战阵位不能放入小战存档记录');
      if (unit.vanguardOrigin !== undefined) throw new Error('会战先锋来源不能放入小战存档记录');
    }
    this.rules = opts.rules ?? LITE_D20;
    if(this.rules.combatModel)for(const unit of this.combatants){prepareCombatModel(unit,this.rules);upgradeCombatSkills(unit);reconcileDamageMorale(unit);}
    for (const unit of this.combatants) { prepareResourceModel(unit, this.rules); prepareArmsModel(unit, this.rules); validateTacticalEffort(unit.tacticalEffort, unit.resourceModel); }
    if (this.combatants.some((u) => u.airborne) && (!this.battlefield || this.rules.resolutionVersion !== 'v2')) throw new Error('空中状态需要V2二维战场');
    this.seed = opts.seed ?? randomSeed();
    this.rng = opts.rng ?? (opts.seed || this.rules.resolutionVersion === 'v2' ? new SeededRng(this.seed) : liveRng());
    this.conditions = new ConditionRegistry(opts.extraConditions ?? []);
    for (const unit of this.combatants) if (unit.airborne && flightMaintenanceReason(unit, this.conditions)) throw new Error('空中存档记录缺少可维持的飞行能力');
    this.traitRegistry = opts.traitRegistry ?? (this.rules.resolutionVersion === 'v2' ? defaultTraitRegistry() : new Map());
    const tags = opts.field?.tags ?? this.battlefield?.environment ?? [];
    this.fieldTags = this.rules.resolutionVersion === 'v2' ? environmentTags(tags) : tags;
    if (this.battlefield && this.rules.resolutionVersion === 'v2') this.battlefield.environment = [...this.fieldTags];
    this.summonUnit = opts.summonUnit;
  }

  get unitMap(): Map<string, Combatant> {
    return new Map(this.combatants.map((c) => [c.id, c]));
  }
  private environmentContext<T extends Omit<AttackOpts, 'rng'>>(opts: T): T {
    if (this.rules.resolutionVersion !== 'v2') return opts;
    opts={...opts,...(this.battlefield?.spatialRulesVersion===2?{heightRules:true,attackerHeight:unitHeight(this.battlefield,opts.attacker),defenderHeight:unitHeight(this.battlefield,opts.defender),heightAdvantage:heightDefense(this.battlefield,opts.defender,opts.attacker)}:{})};
    const units = this.combatants.map((u) => u.id === opts.attacker.id ? opts.attacker : u.id === opts.defender.id ? opts.defender : u);
    return { ...opts, extraMods: [...(opts.extraMods ?? []), ...moraleAttackMods(this.observationContext(units), opts.attacker, this.traitRegistry, this.observationContext())], localTerrain: !!this.battlefield?.layerVersion, defenderMods: [...(opts.defenderMods ?? []), ...(this.battlefield?.layerVersion ? [{ source: 'stance' as const, sourceId: 'structure:def', stackGroup: 'posture:def', name: '阵地掩护', kind: 'def' as const, type: 'flat' as const, value: structureDefense(this.battlefield, opts.defender, opts.attacker, !!opts.ranged) }] : [])], fieldTags: this.fieldTags, attackerTerrain: standingTerrain(this.battlefield, opts.attacker), defenderTerrain: standingTerrain(this.battlefield, opts.defender), distance: this.dist(opts.attacker, opts.defender),
      defenderEngaged: this.combatants.some((u) => u.side !== opts.defender.side && u.status === 'ready' && meleeContact(this.battlefield, u, opts.defender) && this.dist(u, opts.defender) <= (this.battlefield ? 1 : 0)) };
  }
  private resolveAttackWithEnvironment(opts: AttackOpts) {
    if (this.rules.resolutionVersion === 'v2') revealUnit(this.observationContext(), this.byId(opts.attacker.id));
    const result = resolveAttack(this.environmentContext(opts)), field = this.battlefield;
    if (reportsHeights(field) && opts.attacker.pos !== undefined && opts.defender.pos !== undefined && !isAirborne(opts.attacker) && !isAirborne(opts.defender))
      Object.assign(result, { attackerHeight: unitHeight(field, opts.attacker), defenderHeight: unitHeight(field, opts.defender) });
    if (this.rules.resolutionVersion === 'v2' && result.finalDamage > 0) revealUnit(this.observationContext(), this.byId(opts.defender.id));
    return result;
  }
  private previewAttackWithEnvironment(opts: Parameters<typeof previewAttack>[0]) { return previewAttack(this.environmentContext(opts)); }

  byId(id: string): Combatant {
    const u = this.combatants.find((c) => c.id === id);
    if (!u) throw new Error(`单位不存在: ${id}`);
    return u;
  }

  /** 开始战斗：布阵、掷先攻并排序 */
  start(): void {
    if (this.started) return;
    assertBattleCapacity(this.combatants, 'small');
    if (this.battlefield) {
      const prepared = prepareGridDeployment(this.battlefield, this.combatants, this.seed, this.conditions, this.rules.resolutionVersion === 'v2');
      this.combatants.forEach((c, i) => { c.pos = prepared[i]!.pos; c.elevation = prepared[i]!.elevation; if (prepared[i]!.airborne !== undefined) c.airborne = prepared[i]!.airborne; });
    }
    this.started = true;
    this.round = 1;
    for (const unit of this.combatants) {
      const restored = recoverEntryMorale(unit);
      if (restored) this.recordEvent({ round: 1, kind: 'morale', participants: [unit.id], text: `${unit.name} 开战前整顿，士气 0→${restored}` });
    }
    for (const c of this.combatants) {
      if (c.pos === undefined) {
        const side = (c.side === 'enemy' ? 'enemy' : 'ally') as 'ally' | 'enemy';
        c.pos = START_POS[side][c.archetype ?? 'infantry'] ?? 2;
      }
    }
    if (this.rules.resolutionVersion === 'v2') revealContacts(this.observationContext());
    const rolls = this.combatants
      .filter((c) => c.status === 'ready')
      .map((c) => {
        const r = rollDice('1d20', this.rng);
        const speed = c.rulesVersion === 'v2' ? resolveStack(collectMods(c, { fieldTags: this.fieldTags }, this.conditionDefMap(), [], this.traitRegistry), 'spd', {}).flatTotal : 0;
        const init = r.total + c.base.spd + speed;
        return { id: c.id, init, die: r.kept[0] ?? 0 };
      })
      .sort((a, b) => b.init - a.init || b.die - a.die);
    this.turnOrder = rolls.map((r) => r.id);
    this.turnIndex = 0;
    if (this.battlefield && this.rules.resolutionVersion === 'v2') { this.feedback = new BattleFeedback(this.round, this.feedbackUnits()); this.beginFeedbackActivation(); }
    this.recordEvent({
      round: 1,
      kind: 'initiative', participants: this.combatants.map((u) => u.id),
      text: `先攻顺序：${rolls.map((r) => `${this.byId(r.id).name} ${r.init}`).join(' > ')}`,
    });
    this.recordEvent({
      round: 1,
      kind: 'move',
      participants: this.combatants.map((u) => u.id), text: `布阵：${this.combatants
        .filter((c) => c.status !== 'dead')
        .map((c) => this.battlefield && c.pos !== undefined ? `${c.name} ${reportPlaceLabel(this.battlefield, c.pos, c)}` : `${c.name}@${c.pos ?? '?'}`)
        .join('，')}`,
    });
    this.advanceToNextActor();
    if (this.turnIndex >= this.turnOrder.length && !this.isOver()) this.endTurn();
  }

  get active(): Combatant | undefined {
    const id = this.turnOrder[this.turnIndex];
    return id ? this.byId(id) : undefined;
  }

  /** 当前回合是否轮到该单位 */
  isTurnOf(id: string): boolean {
    return this.turnOrder[this.turnIndex] === id;
  }

  /** 两单位距离 = 坐标差绝对值 */
  dist(a: Combatant, b: Combatant): number {
    if (this.battlefield) return Math.max(sameLayer(a, b) ? 0 : 1, gridDistance(this.battlefield, a.pos!, b.pos!));
    const pa = a.pos ?? START_POS[a.side === 'enemy' ? 'enemy' : 'ally'][a.archetype ?? 'infantry'] ?? 2;
    const pb = b.pos ?? START_POS[b.side === 'enemy' ? 'enemy' : 'ally'][b.archetype ?? 'infantry'] ?? 2;
    return Math.abs(pa - pb);
  }

  /** 与最近存活敌人的距离（无敌人返回 Infinity） */
  distToNearestFoe(u: Combatant): number {
    const foes = this.visibleCombatants(u.side).filter((c) => c.side !== u.side && c.status === 'ready');
    return foes.length ? Math.min(...foes.map((f) => this.dist(u, f))) : Infinity;
  }

  /** 当前单位的移动/主行动额度；UI 与自动行动均读取这里。 */
  getTurnEconomy(actorId: string): TurnEconomy {
    const actor = this.byId(actorId);
    return turnEconomy({
      isTurn: !this.started || this.isTurnOf(actorId),
      ready: actor.status === 'ready',
      moved: this.battlefield ? this.movementLeft(actorId) <= 0 : this.movedThisTurn.has(actorId),
      acted: !this.nonSkillActionAvailable(actorId),
    });
  }

  movementBudget(actorId: string): number { return movementPoints(this.byId(actorId), this.fieldTags); }
  flightRisks(actorId: string, airborne: boolean): string[] {
    if (!airborne) return [];
    const actor=this.byId(actorId);
    return this.visibleCombatants(actor.side).filter(foe=>foe.side!==actor.side&&foe.status==='ready'&&!isAirborne(foe)&&this.dist(actor,foe)===1&&!foe.suppression&&!this.reactionSpent.has(foe.id))
      .filter(foe=>{const weapon=meleeWeapon(foe);return weapon&&!this.weaponContext(foe,actor,{weaponMode:weapon===foe.sidearm?'sidearm':'primary'}).reason;}).map(foe=>foe.name+'可能借机一次');
  }
  flightReason(actorId: string, airborne: boolean): string | undefined {
    const actor = this.byId(actorId);
    if (!this.battlefield || this.rules.resolutionVersion !== 'v2' || actor.rulesVersion !== 'v2' || actor.status !== 'ready' || !this.isTurnOf(actorId) || this.isOver()) return '当前不能改变空地状态';
    if (isAirborne(actor) === airborne) return airborne ? '已经在空中' : '已经在地面';
    if (this.movementLeft(actorId) < 1) return '起落需要1点移动';
    if (airborne) {
      const reason = flightCapabilityReason(actor, this.conditions); if (reason) return reason;
    }
    if (!canOccupy(this.battlefield, this.visibleCombatants(actor.side), { ...actor, airborne, elevation: undefined }, actor.pos!)) return '当前格没有合法落点或同层容量已满';
    return undefined;
  }
  changeFlight(actorId: string, airborne: boolean, attackMovement = false): void {
    const reason = this.flightReason(actorId, airborne); if (reason) throw new Error(reason);
    const actor = this.byId(actorId);
    if (!attackMovement) this.activateHasteMovement(actorId);
    this.movementSpent.set(actorId, (this.movementSpent.get(actorId) ?? 0) + 1); this.movedThisTurn.add(actorId); delete actor.tacticalPose;
    if (airborne) for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
      const weapon = this.rules.resolutionVersion === 'v2' ? meleeWeapon(foe) : foe.sidearm ?? (!isRangedCapable(foe) ? foe.weapon : undefined);
      if (actor.status !== 'ready' || flightCapabilityReason(actor, this.conditions)) break;
      if (foe.side === actor.side || foe.status !== 'ready' || isAirborne(foe) || this.dist(actor, foe) !== 1 || !weapon || foe.suppression || this.reactionSpent.has(foe.id)) continue;
      const context = this.weaponContext(foe, actor, { weaponMode: weapon === foe.sidearm ? 'sidearm' : 'primary' }); if (context.reason) continue;
      this.reactionSpent.add(foe.id); this.overwatch.delete(foe.id);
      const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: actor, rng: this.rng, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry,
        ranged: false, weaponOverride: weapon, ...this.attackModifiers(foe, actor, context) });
      if (result.hit) this.applyOnHitTraits(foe, actor, result); this.checkDeath(actor, foe);
      this.recordEvent({ round: this.round, kind: 'attack', text: '起飞借机｜' + result.text, resolution: result });
    }
    actor.airborne = airborne && !flightCapabilityReason(actor, this.conditions);
    if (actor.airborne || !airborne) delete actor.elevation;
    revealContacts(this.observationContext());
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: `${actor.name} ${actor.airborne ? '起飞' : airborne ? '起飞被中断' : '降落'}，消耗1点移动` });
    this.checkGridObjective(false);
  }
  private landingOutcome(unit: Combatant, units = this.combatants) {
    const field = this.battlefield!, origin = unit.pos!, grounded = { ...unit, airborne: false, elevation: undefined };
    const cell = field.tiles.map((_, n) => n).filter((n) => gridDistance(field, origin, n) <= 2 && canOccupy(field, units, grounded, n))
      .sort((a, b) => gridDistance(field, origin, a) - gridDistance(field, origin, b) || a - b)[0];
    return { fallDamage: fallDamage(unit), landingCell: cell, forcedExit: cell === undefined };
  }
  private abilityFlightPreview(actor: Combatant, target: Combatant, ability: Combatant['abilities'][number]) {
    if (!this.battlefield || !isAirborne(target)) return undefined;
    const effects = ability.effects.filter((e): e is Extract<EffectOp, { op: 'condition' }> => e.op === 'condition'
      && !!(this.conditions.get(e.conditionId)?.skipTurn || this.conditions.get(e.conditionId)?.preventMove) && conditionChance(target, e) > 0);
    const affected = structuredClone(target);
    for (const effect of ability.effects) if (effect.op === 'dispel') applyDispel(affected, dispelCandidates(affected, effect));
    const dispelled = !!flightMaintenanceReason(affected, this.conditions);
    if (!effects.length && !dispelled) return undefined;
    const damage = ability.effects.find((e) => e.op === 'damage');
    const preview = damage ? this.previewAttackWithEnvironment({ attacker: actor, defender: target, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(actor, target, ability, damage) }) : undefined;
    const hit = preview?.anyHitChance ?? preview?.hitChance ?? 1;
    const fallChance = dispelled ? 1 : 1 - effects.reduce((chance, e) => chance * (1 - conditionChance(target, e) * (e.onDamage ? preview?.damageChance ?? 0 : e.onHit ? hit : 1)), 1);
    return { ...this.landingOutcome(target, this.visibleCombatants(actor.side)), fallChance };
  }
  private flightCauses = new Map<string, string>();
  private resolveFlightStates(): void {
    const field = this.battlefield; if (!field || this.rules.resolutionVersion !== 'v2') return;
    for (const unit of this.combatants.filter(isAirborne)) {
      const reason = flightMaintenanceReason(unit, this.conditions); if (!reason) continue;
      const { landingCell: cell, fallDamage: damage } = this.landingOutcome(unit);
      const alreadyDefeated = unit.status === 'dead' || unit.status === 'dying' || unit.hp <= 0;
      unit.airborne = false; delete unit.tacticalPose;
      if (alreadyDefeated) { if (cell !== undefined) unit.pos = cell; revealUnit(this.observationContext(), unit); continue; }
      const hp = memberHealth(unit), members = unit.hp; applyCombatDamage(unit,damage*(hasMemberHealth(unit)?unit.formation!.memberHp:1),unit.hp);
      if (cell !== undefined) unit.pos = cell;
      if (hp > memberHealth(unit)) this.checkDeath(unit, this.combatants.find((u) => u.id === this.flightCauses.get(unit.id)));
      if (cell === undefined) unit.status = unit.hp > 0 ? 'fled' : this.nonLethal ? 'dying' : 'dead';
      revealUnit(this.observationContext(), unit);
      this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], damage: {sourceId:this.flightCauses.get(unit.id),targetId:unit.id,amount:hp-memberHealth(unit),cause:'坠落',...(hasMemberHealth(unit)?{unit:'life' as const,members:members-unit.hp}:{})}, text: `${unit.name} ${reason}，${cell === undefined ? '附近无落点，紧急迫降离场' : '迫降至' + cellLabel(field, cell)}，坠落损失${hp-memberHealth(unit)}${hasMemberHealth(unit)?'生命':''}` });
    }
    this.flightCauses.clear();
  }
  private recordEvent(entry: BattleLogEntry): void {
    for(const result of entry.resolutions?.length?entry.resolutions:[entry.resolution]) if(result&&result.hpAfter<=0) result.defenderStatus=this.nonLethal?'dying':'dead';
    entry.locations ??= Object.fromEntries((entry.participants ?? []).flatMap(id => { const u = this.combatants.find(c => c.id === id); return u?.pos === undefined ? [] : [[id, u.pos]]; }));
    this.log.push(this.rules.resolutionVersion === 'v2' ? observeEvent(this.observationContext(), entry) : entry);
    this.captureFeedback();
  }
  private feedbackUnits(): FeedbackUnit[] {
    return this.visibleCombatants('ally').map((u) => ({
      id: u.id, name: u.name, side: u.side, scale: u.scale, hp: u.hp, status: u.status,
      morale: u.morale ?? u.base.moraleMax ?? 100, fatigue: u.fatigue, cell: u.pos,
      resources: Object.fromEntries(Object.entries(u.resources).map(([key, value]) => [key, {
        name: key === 'SP' ? '战技点' : key === 'reserve' ? '预备兵力' : key.startsWith('item:') ? u.abilities.find((a) => a.cost?.resource === key)?.name ?? '消耗品次数' : '资源',
        value,
      }])),
      effects: [...new Set([
        ...u.conditions.filter((c) => c.dur > 0).map((c) => this.conditions.get(c.id)?.name ?? '持续效果'),
        ...(u.traitSources ?? []).filter((source) => traitSourceActive(u, source)).map((source) => source.name),
        ...(u.suppression ? ['受压制'] : []), ...(u.tacticalPose ? ['固守'] : []),
        ...(isAirborne(u) ? ['空中'] : []), ...(this.overwatch.has(u.id) ? ['警戒'] : []),
      ])].sort(),
    }));
  }
  private captureFeedback(): void { this.feedback?.capture(this.round, this.feedbackUnits(), { ...this.controlRounds, winner: this.objectiveWinner }); }
  private beginFeedbackActivation(): void {
    this.captureFeedback();
    this.feedback?.beginActivation(this.round, this.visibleCombatants('ally').find((u) => u.id === this.active?.id)?.name);
  }
  activationFeedback() { return this.feedback?.activation(); }
  roundFeedback(): RoundFeedback[] { return this.feedback?.rounds() ?? []; }
  visibleLog(side: Side): BattleLogEntry[] { return this.rules.resolutionVersion === 'v2' ? observedLog(this.log, side) : this.log; }
  observationContext(units = this.combatants): ObservationContext { return { units, mode: 'small', fieldTags: this.fieldTags, conditions: this.conditions, battlefield: this.battlefield, rules: this.rules, traitRegistry: this.traitRegistry, reload: this.reloadCd }; }
  visibleCombatants(side: Combatant['side']): Combatant[] {
    if (this.rules.resolutionVersion !== 'v2') return this.combatants;
    const memo = this.observationMemo, known = memo?.get(side) ?? observedUnits(this.observationContext(), side);
    if (!memo) return known;
    memo.set(side, known); return [...known];
  }
  cellVisible(side: Side, cell: number): boolean {
    if (this.rules.resolutionVersion !== 'v2') return true;
    return this.combatants.some((u) => u.side === side && u.status === 'ready' && canSpot(this.observationContext(), u, { ...u, id: '', traits: [], traitSources: [], side: side === 'enemy' ? 'ally' : 'enemy', pos: cell, airborne: false, elevation: this.battlefield && intactStructure(this.battlefield, cell)?.top ? 1 : undefined }));
  }
  movementLeft(actorId: string, includeHaste = true): number {
    const unit = this.byId(actorId);
    if (unit.conditions.some((c) => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventMove))) return 0;
    return Math.max(0, this.movementBudget(unit.id) + (this.hasteMovement.get(actorId) ?? 0) + (includeHaste && this.hasteSelected.has(actorId) && this.hasteAvailable(actorId) ? this.movementBudget(actorId) : 0) - (this.movementSpent.get(actorId) ?? 0));
  }
  reachableCells(actorId: string): GridPath[] {
    const field = this.battlefield; if (!field) return [];
    const actor = this.byId(actorId);
    if (actor.status !== 'ready' || (this.started && !this.isTurnOf(actorId))) return [];
    const known = this.visibleCombatants(actor.side);
    return reachableGridPaths(field, actor.pos!, this.movementLeft(actorId), (n) => canOccupy(field, known, actor, n), (n, from) => movementStepCost(field, n, actor, this.fieldTags, from));
  }
  private sightReason(actor: Combatant, target: Combatant, indirect = false): string | undefined {
    if (this.rules.resolutionVersion === 'v2') {
      const context = this.observationContext();
      if (actor.side !== target.side && !this.visibleCombatants(actor.side).some((u) => u.id === target.id)) return '尚未观测到目标';
      if (actor.side !== target.side && !canSpot(context, actor, target) && !indirect) return '当前单位无法观测目标';
      if (indirect && !context.units.some((u) => u.side === actor.side && u.status === 'ready' && canSpot(context, u, target))) return '间接火力缺少可见目标的观察者';
    }
    if (!this.battlefield || unitLineOfSight(this.battlefield, actor, target)) return undefined;
    if (indirect && this.combatants.some((u) => u.side === actor.side && u.status === 'ready' && unitLineOfSight(this.battlefield!, u, target))) return undefined;
    return indirect ? '间接火力缺少可见目标的观察者' : '硬遮挡阻断视线';
  }
  private chargePath(actor: Combatant, target: Combatant): GridPath | undefined {
    if (!this.battlefield) return undefined;
    if (this.battlefield.layerVersion && !isAirborne(actor) && (meleeHeightReason(this.battlefield, actor, target) || ['deep_water', 'shallow_water', 'swamp'].includes(this.battlefield.tiles[actor.pos!]!))) return undefined;
    return neighbors(this.battlefield, target.pos!).map((cell) => findGridPath(this.battlefield!, actor.pos!, cell, (n) => canOccupy(this.battlefield!, this.visibleCombatants(actor.side), actor, n), (n, from) => movementStepCost(this.battlefield!, n, actor, this.fieldTags, from)))
      .filter((p): p is GridPath => !!p && (!this.battlefield!.layerVersion || isAirborne(actor) || p.cells.every(n => !['deep_water', 'shallow_water', 'swamp'].includes(this.battlefield!.tiles[n]!) && !this.battlefield!.overlays?.[n]?.includes('rubble') && intactStructure(this.battlefield!, n)?.kind !== 'fortification')) && p.cost + (isAirborne(actor) && !isAirborne(target) ? 1 : 0) <= this.movementLeft(actor.id, false) && (sameLayer(actor, target) || canOccupy(this.battlefield!, this.visibleCombatants(actor.side), { ...actor, airborne: false }, p.cells.at(-1)!)))
      .sort((a, b) => a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!)[0];
  }
  private summonReason(actor: Combatant, ability: Combatant['abilities'][number]): string | undefined {
    if (actor.rulesVersion !== 'v2' || !ability.effects.some((e) => e.op === 'summon')) return undefined;
    if (!this.battlefield || !this.summonUnit && ability.effects.some((e) => e.op === 'summon' && !conjuredTemplate(e.templateId))) return '当前战场缺少召唤落点适配';
    const count = ability.effects.reduce((sum, e) => sum + (e.op === 'summon' ? e.count : 0), 0);
    const alive = this.combatants.filter((u) => u.summonerId === actor.id && u.status === 'ready').length;
    if (!Number.isInteger(count) || count < 1 || count > 2 || alive + count > 2) return '召唤在场上限为2，不能超额创建';
    if (!neighbors(this.battlefield, actor.pos!).some((cell) => canOccupy(this.battlefield!, this.combatants, actor, cell))) return '没有合法召唤落点';
    return undefined;
  }
  pathPreview(actorId: string, cell: number): { path?: GridPath; reason?: string; risks: string[] } {
    const field = this.battlefield; if (!field) return { reason: '不是二维战斗', risks: [] };
    const actor = this.byId(actorId);
    if (actor.status !== 'ready' || (this.started && !this.isTurnOf(actorId)) || this.isOver()) return { reason: '当前单位不能移动', risks: [] };
    const known = this.visibleCombatants(actor.side);
    const path = findGridPath(field, actor.pos!, cell, (n) => canOccupy(field, known, actor, n), (n, from) => movementStepCost(field, n, actor, this.fieldTags, from));
    if (!path) return { reason: '路径受阻或落点容量不足', risks: [] };
    if (path.cost > this.movementLeft(actorId)) return { reason: '移动点不足', risks: [] };
    const risks = known.filter((u) => u.side !== actor.side && u.status === 'ready' && !this.reactionSpent.has(u.id) && !u.suppression && !u.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack)
      && path.cells.slice(1).some((n, i) => {
        const previous = path.cells[i]!, ridingAway = mountedShooting(actor) && (Math.floor(n / field.width) - Math.floor(previous / field.width)) * (actor.side === 'enemy' ? -1 : 1) > 0;
        return !ridingAway && !!meleeWeapon(u) && meleeContact(field,u,{...actor,pos:previous}) && gridDistance(field, u.pos!, previous) === 1 && (gridDistance(field, u.pos!, n) > 1||!meleeContact(field,u,{...actor,pos:n}))
          || this.overwatch.has(u.id) && !this.weaponContext(u, { ...actor, pos: n }).reason;
      }))
      .map((u) => u.name + '可能反应一次');
    return { path, risks };
  }
  moveTo(actorId: string, cell: number, attackMovement = false): void {
    const preview = this.pathPreview(actorId, cell);
    if (!preview.path) throw new Error(preview.reason ?? '不能移动');
    const actor = this.byId(actorId); const field = this.battlefield!;
    for (const next of preview.path.cells.slice(1)) {
      if (actor.status !== 'ready' || actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventMove)) break;
      const stepCost = movementStepCost(field, next, actor, this.fieldTags);
      if (gridDistance(field, actor.pos!, next) !== 1 || stepCost > this.movementLeft(actorId)) break;
      if (!canOccupy(field, this.combatants, actor, next)) break;
      if (!attackMovement) this.activateHasteMovement(actorId);
      const previous = actor.pos!, heights = reportsHeights(field) && !isAirborne(actor);
      const fromHeight = heights ? surfaceHeightAt(field, previous, actor) : undefined;
      delete actor.tacticalPose;
      actor.pos = next;
      this.movementSpent.set(actorId, (this.movementSpent.get(actorId) ?? 0) + stepCost);
      this.movedThisTurn.add(actorId);
      this.settleAreaEffects(); if (actor.status !== 'ready') break;
      this.checkGridObjective(false);
      if (this.rules.resolutionVersion === 'v2') revealContacts(this.observationContext());
      const toHeight = heights ? surfaceHeightAt(field, next, actor) : undefined;
      this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id], move: { from: previous, to: next, ...(heights ? { fromHeight, toHeight } : {}) },
        text: `${actor.name} ${cellLabel(field, previous)}${fromHeight !== toHeight ? '(高度' + fromHeight + ')' : ''}→${reportPlaceLabel(field, next, actor)}` });
      for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
        if (actor.status !== 'ready') break;
        if (foe.side === actor.side || foe.status !== 'ready' || foe.suppression || this.reactionSpent.has(foe.id) || foe.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && meleeWeapon(foe)?.recipe?.mechanism !== 'natural')) continue;
        const reactionWeapon = this.rules.resolutionVersion === 'v2' ? meleeWeapon(foe) : foe.sidearm ?? (!isRangedCapable(foe) ? foe.weapon : undefined);
        const ridingAway = mountedShooting(actor) && (Math.floor(next / field.width) - Math.floor(previous / field.width)) * (actor.side === 'enemy' ? -1 : 1) > 0;
        const opportunity = !ridingAway && !!reactionWeapon && meleeContact(field,foe,{...actor,pos:previous}) && gridDistance(field, foe.pos!, previous) === 1 && (gridDistance(field, foe.pos!, next) > 1||!meleeContact(field,foe,actor));
        const watching = this.overwatch.has(foe.id) && !this.weaponContext(foe, actor).reason;
        if (!opportunity && !watching) continue;
        this.reactionSpent.add(foe.id); this.overwatch.delete(foe.id);
        const context = this.weaponContext(foe, actor, { weaponMode: opportunity ? reactionWeapon === foe.sidearm ? 'sidearm' : 'primary' : 'auto' });
        const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: actor, rng: this.rng, rules: this.rules,
          conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry,
          ...this.attackModifiers(foe, actor, context),
          actionDamageScale: !opportunity ? this.hasteOverwatch.get(foe.id) ?? 1 : 1,
          ranged: !opportunity && context.ranged, weaponOverride: opportunity ? reactionWeapon : context.weapon });
        this.recordEvent({ round: this.round, kind: 'attack', text: (opportunity ? '借机' : '警戒') + '反应｜' + result.text, resolution: result });
        if (result.hit) this.applyOnHitTraits(foe, actor, result);
        if (!opportunity && context.ranged && weaponReloadTurns(context.weapon)) this.reloadCd.set(weaponReloadKey(foe, context.weapon), weaponReloadTurns(context.weapon) + 1);
        this.checkDeath(actor, foe); this.resolveFlightStates();
      }
    }
    this.checkGridObjective(false);
  }
  braceReason(actorId: string): string | undefined {
    const actor = this.byId(actorId);
    if (!this.battlefield || actor.rulesVersion !== 'v2' || !this.isTurnOf(actorId) || actor.status !== 'ready' || this.isOver()) return '当前单位不能固守';
    if (!this.nonSkillActionAvailable(actorId)) return '本回合主行动已使用';
    if (isAirborne(actor)) return '空中不能固守，先降落';
    if (actor.suppression || actor.conditions.some((c) => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && meleeWeapon(actor)?.recipe?.mechanism !== 'natural'))) return '受压制或失能时不能维持稳固姿态';
    return undefined;
  }
  braceDescription(actorId: string): string {
    const unit = this.byId(actorId);
    return '面向最近可见威胁，正面防御提高2；移动或下次行动结束姿态。'
      + (unit.combatModel === MEMBER_HEALTH_MODEL && unit.shield ? '地面前排平时即遮挡直射；大体型可越过更小友军，弓弩和法杖可越过友军，仍受敌军遮挡；持盾固守额外保护同格队友，独立魔法技能、空中射击、曲射火炮等间接火力及侧射可绕过盾卫的额外保护。' : '持盾/长柄专长按装备前提生效。');
  }
  brace(actorId: string): void {
    const reason = this.braceReason(actorId); if (reason) throw new Error(reason);
    const actor = this.byId(actorId);
    const threat = this.combatants.filter((u) => u.side !== actor.side && u.status === 'ready' && !this.sightReason(actor, u))
      .sort((a, b) => this.dist(actor, a) - this.dist(actor, b) || a.id.localeCompare(b.id))[0];
    actor.tacticalPose = bracePose(actor, threat, 'small', this.battlefield!.width);
    this.spendAction(actorId); this.overwatch.delete(actorId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, ...(threat ? [threat.id] : [])], text: `${actor.name} 固守${threat ? '，面向' + threat.name : ''}：${this.braceDescription(actorId)}` });
  }
  setOverwatch(actorId: string): void {
    const actor = this.byId(actorId);
    const reason = this.overwatchReason(actorId); if (reason) throw new Error(reason);
    if (this.usingHaste(actorId)) this.hasteOverwatch.set(actorId, hasteAttackScale(actor)); else this.hasteOverwatch.delete(actorId);
    this.spendAction(actorId); this.overwatch.add(actorId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id], text: `${actor.name} 警戒：共用一次反应额度` });
  }
  overwatchReason(actorId: string): string | undefined {
    const actor = this.byId(actorId);
    if (!this.battlefield || !this.isTurnOf(actorId) || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId) || this.reactionSpent.has(actorId) || actor.suppression) return '当前没有警戒行动/反应额度';
    if (!actor.weapon && !actor.sidearm) return '没有可用于警戒的武器';
    if (actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && meleeWeapon(actor)?.recipe?.mechanism !== 'natural')) return '当前状态禁止武器反应';
    return undefined;
  }
  suppress(actorId: string, targetId: string): void {
    const reason = this.suppressReason(actorId, targetId); if (reason) throw new Error(reason);
    const actor = this.byId(actorId); const target = this.byId(targetId);
    actor.resources.SP = (actor.resources.SP ?? 0) - 1; target.suppression = 2;
    addTacticalEffort(actor, 1);
    revealUnit(this.observationContext(), actor); revealUnit(this.observationContext(), target);
    this.spendAction(actorId); this.overwatch.delete(targetId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, target.id], text: `${actor.name} 压制 ${target.name}：未结算生命伤害，目标反应停用、命中-2` });
  }
  suppressReason(actorId: string, targetId?: string): string | undefined {
    const actor = this.byId(actorId), target = this.combatants.find((u) => u.id === targetId);
    if (!target || target.side === actor.side || target.status !== 'ready') return '选择可压制的敌方目标';
    const context = this.weaponContext(actor, target);
    if (!this.battlefield || !this.isTurnOf(actorId) || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId) || !context.ranged || context.reason) return context.reason ?? '压制需要合法射击与主行动';
    if (actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack)) return '当前状态禁止射击';
    if ((actor.resources.SP ?? 0) < 1) return '压制需要1点战术资源';
    if (target.body === 'vehicle' && penetrationContext({ attacker: actor, defender: target,rules:this.rules }).factor === 0) return '火力对封闭车体不构成压制威胁';
    return undefined;
  }
  /** Shared pure validation used by the inspector, AI and execution. */
  structurePreview(actorId: string, cell: number, mode = 'primary', from?: number): { reason?: string; damage: number; coefficient?: number; actions?: number } {
    const actor = { ...this.byId(actorId), ...(from === undefined ? {} : { pos: from }) }, field = this.battlefield;
    const fail = (reason: string) => ({ reason, damage: 0 });
    if (!field?.layerVersion || actor.pos === undefined || !this.isTurnOf(actorId) || actor.status !== 'ready' || this.isOver() || !this.nonSkillActionAvailable(actorId)) return fail('当前没有可用的破障行动');
    if (mode !== 'primary' && mode !== 'sidearm' && !mode.startsWith('ability:')) return fail('未知破障方式');
    const target = intactStructure(field, cell); if (!target) return fail('此格没有完好的可破坏结构');
    const ability = mode.startsWith('ability:') ? actor.abilities.find(a => a.id === mode.slice(8)) : undefined;
    if (mode.startsWith('ability:') && !ability) return fail('技能不存在');
    const usesWeapon = !ability || ability.damageBasis === 'weapon';
    const weapon = ability ? usesWeapon ? skillWeapon(actor, ability) : undefined : mode === 'sidearm' ? actor.sidearm : actor.weapon;
    if (usesWeapon && !weapon) return fail('没有可用武器');
    if (actor.conditions.some(c => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn
      || usesWeapon && weapon?.recipe?.mechanism !== 'natural' && this.conditions.get(c.id)?.preventAttack
      || ability?.delivery === 'magic' && this.conditions.get(c.id)?.preventMagic))) return fail('当前状态禁止攻击结构');
    const probe: Combatant = { ...actor, id: '@structure', traits: [], traitSources: [], side: actor.side === 'enemy' ? 'ally' : 'enemy', pos: cell, elevation: undefined, airborne: false };
    const distance = gridDistance(field, actor.pos, cell);
    const ranged = usesWeapon ? isRangedWeapon(weapon) : ability?.delivery !== 'melee';
    if (!ranged && (isElevated(actor) || isAirborne(actor))) return fail('高处近战破障须先下至合法地面');
    let budget = 0, coefficient = 1;
    if (usesWeapon) {
      const adapted = gridWeapon(weapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel);
      const range = weaponRangeSpec(adapted, ranged);
      if (distance < range.min || distance > range.max) return fail('结构不在武器射程内');
      if ((this.reloadCd.get(weaponReloadKey(actor, weapon)) ?? 0) > 0) return fail('武器尚在装填');
      const breakdown = weaponBreachBudget(actor, weapon); budget = breakdown.damage; coefficient = breakdown.coefficient;
    }
    if (ability) {
      if (!ability.effects.some(e => e.op === 'damage') || ability.target === 'self' || ability.target === 'ally' || ability.damageBasis === 'shield') return fail('此技能没有可用于破障的直接伤害');
      if (this.actedThisTurn.has(actorId) || this.hasteSelected.has(actorId)) return fail('破障施法需要未使用的主行动');
      const reason = abilityUsabilityReason(actor, ability); if (reason) return fail(reason);
      const range = fallbackAbilityRange(actor, gridAbility(ability), true);
      if (range && (distance < range.min || distance > range.max)) return fail('结构不在技能射程内');
      const level = ability.power ?? ability.recipe?.power ?? 1;
      if (usesWeapon) {
        // A low-tier technique cannot amplify a high-tier weapon without its tier cap.
        // Generated weaponDamageMult already contains generic signed enhancements.
        const cap = Math.min(1, structureDurability('wall', level) / structureDurability('wall', weapon!.level ?? weapon!.recipe?.power ?? 1));
        const channel = bonusMultiplier(ability.bonuses, 'damage', weapon?.channel) / bonusMultiplier(ability.bonuses, 'damage');
        const single = this.rules.singleWeaponSkillMultiplier !== undefined && actor.damageModel === 'wounds-v2'
          && ability.shape !== 'burst' && !ability.customized && !ability.fixedPower && /^skill-v6\./.test(ability.effectVersion ?? '')
          ? this.rules.singleWeaponSkillMultiplier / 2.2 : 1;
        budget *= cap * (ability.weaponDamageMult ?? bonusMultiplier(ability.bonuses, 'damage')) * channel * single;
      } else {
        coefficient = ability.channel === 'thermal' ? .65 : 1;
        budget = structureDurability('wall', level) / 5 * coefficient * bonusMultiplier(ability.bonuses, 'damage', ability.channel);
      }
    } else budget *= this.usingHaste(actorId) ? hasteAttackScale(actor) : 1;
    if (!canSpot(this.observationContext(), actor, probe)) {
      if (!(usesWeapon && weapon?.indirect && knownStructureObserver(this, actor, cell))) return fail('障碍阻断结构射线');
    }
    const known = this.visibleCombatants(actor.side).filter(u => isElevated(u) === isElevated(actor));
    if (usesWeapon && ranged) {
      const screen = rangedScreen(actor, probe, weapon, known, { mode: 'small', width: field.width, battlefield: field }, this.conditionDefMap());
      if (screen) return fail(rangedScreenReason(screen));
      if (weapon?.pointBlankPolicy === 'forbid' && known.some(u => u.side !== actor.side && u.status === 'ready' && meleeContact(field, u, actor) && gridDistance(field, actor.pos!, u.pos!) <= 1)) return fail('被相邻敌军牵制，无法展开重火力');
    } else if (!ranged) {
      const blocker = meleeLineBlocker(field, actor, probe, known);
      if (blocker) return fail('近战破障被' + blocker.name + '阻挡');
    }
    if (!Number.isFinite(budget) || Math.round(budget) <= 0) return fail('当前攻击不足以造成结构损伤');
    // Deterministic action budget, no unit casualty rolls, criticals, afflictions or structure XP.
    return { damage: Math.min(target.hp, Math.round(budget)), coefficient, actions: Math.ceil(target.hp / Math.round(budget)) };
  }
  attackStructure(actorId: string, cell: number, mode = 'primary'): void {
    const preview = this.structurePreview(actorId, cell, mode); if (preview.reason) throw Error(preview.reason);
    const field = this.battlefield!, actor = this.byId(actorId), target = intactStructure(field, cell)!;
    const ability = mode.startsWith('ability:') ? actor.abilities.find(a => a.id === mode.slice(8)) : undefined;
    const weapon = ability ? ability.damageBasis === 'weapon' ? skillWeapon(actor, ability) : undefined : mode === 'sidearm' ? actor.sidearm : actor.weapon;
    const label = STRUCTURE_NAMES[target.kind], before = target.hp;
    if (ability) {
      const cost = abilityCost(actor, ability);
      if (cost) actor.resources[cost.resource] = resourceRound((actor.resources[cost.resource] ?? 0) - cost.amount);
      spendAbility(actor, ability);
      addTacticalEffort(actor, skillExertion(actor, ability)); this.spendAction(actorId, false);
    } else { addTacticalEffort(actor, 1); this.spendAction(actorId); }
    if (weapon && (!ability || ability.damageBasis === 'weapon') && isRangedWeapon(weapon) && weaponReloadTurns(weapon)) this.reloadCd.set(weaponReloadKey(actor, weapon), weaponReloadTurns(weapon) + 1);
    const result = damageStructure(field, cell, preview.damage);
    revealUnit(this.observationContext(), actor); delete actor.tacticalPose;
    this.recordEvent({ round: this.round, kind: ability ? 'ability' : 'attack', participants: [actorId], text: `${actor.name} ${ability ? '使用【' + ability.name + '】' : '破障'}→${cellLabel(field, cell)} ${label} L${target.level}：结构耐久 ${before}→${target.hp}${result.destroyed ? '，形成突破口' : ''}（不结算单位伤害）` });
    this.resolveGroundStates(actor);
    revealContacts(this.observationContext()); this.checkGridObjective(false);
  }
  gateReason(actorId: string, cell: number): string | undefined {
    const field = this.battlefield, actor = this.byId(actorId), door = field && intactStructure(field, cell);
    if (!field?.layerVersion || !door || door.kind !== 'gate') return '此处没有可操作的门';
    if (!this.isTurnOf(actorId) || this.isOver() || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId)) return '开关门需要主行动';
    if (actor.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn)) return '失能状态不能操作门';
    if (isAirborne(actor) || isElevated(actor) || actor.pos === undefined || gridDistance(field, actor.pos, cell) > 1) return '须在门旁地面操作';
    // Inner-side capture may take control; the exterior cannot remotely unlock a defended closed gate.
    // Between two walls each gate's inner side is where its stairs are: the passage for the outer gate, the town for the inner one.
    const innerSide = field.city?.terrace?.length && door.access?.length ? door.access : field.city?.inside;
    if (field.generation?.scene !== 'interior' && door.owner !== undefined && door.owner !== actor.side && !innerSide?.includes(actor.pos)) return '须从内部夺取门控位置';
    if (this.visibleCombatants(actor.side).some(u => u.side !== actor.side && u.status === 'ready' && !isAirborne(u) && !isElevated(u) && gridDistance(field, u.pos!, cell) <= 1)) return '门区仍有敌军争夺，无法操作';
    if (door.gateState === 'open' && this.combatants.some(u => u.pos === cell && !isAirborne(u) && !isElevated(u) && u.hp > 0 && ['ready', 'routing'].includes(u.status))) return '门洞有人，不能关门';
    return undefined;
  }
  toggleGate(actorId: string, cell: number): void {
    const reason = this.gateReason(actorId, cell); if (reason) throw Error(reason);
    const field = this.battlefield!, door = intactStructure(field, cell)!, actor = this.byId(actorId);
    door.gateState = door.gateState === 'open' ? 'closed' : 'open'; door.owner = actor.side === 'enemy' ? 'enemy' : 'ally';
    field.terrainRevision = (field.terrainRevision ?? 0) + 1; this.spendAction(actorId);
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: `${actor.name} ${door.gateState === 'open' ? '打开' : '关闭'} ${cellLabel(field, cell)}门，消耗主行动` });
    revealContacts(this.observationContext());
  }
  climbMovementCost(actorId: string): number { return Math.min(2, this.movementBudget(actorId)); }
  climbReason(actorId: string, cell: number, from?: number): string | undefined {
    const field = this.battlefield, actor = { ...this.byId(actorId), ...(from === undefined ? {} : { pos: from }) };
    if (!field?.layerVersion || !this.isTurnOf(actorId) || actor.status !== 'ready' || this.isOver() || !this.nonSkillActionAvailable(actorId)) return '攀登需要主行动';
    if (this.movementLeft(actorId) < this.climbMovementCost(actorId)) return `攀登需要${this.climbMovementCost(actorId)}点移动`;
    if (!canClimbFrom(field, actor, cell)) return '须沿梯道，或具备登城特质从墙外攀登';
    const arrival: Combatant = { ...actor, pos: cell, elevation: isElevated(actor) ? undefined : 1 };
    if (!canOccupy(field, this.visibleCombatants(actor.side), arrival, cell)) return '落点被敌军占据或容量不足；须先清除守军';
    return undefined;
  }
  climb(actorId: string, cell: number): void {
    const reason = this.climbReason(actorId, cell); if (reason) throw Error(reason);
    const actor = this.byId(actorId), field = this.battlefield!, climbCost = this.climbMovementCost(actorId);
    // Hidden occupants stop entry without revealing their identity through previews.
    const arrival: Combatant = { ...actor, pos: cell, elevation: isElevated(actor) ? undefined : 1 };
    if (!canOccupy(field, this.combatants, arrival, cell)) { this.spendAction(actorId); this.movementSpent.set(actorId, (this.movementSpent.get(actorId) ?? 0) + climbCost); this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: actor.name + ' 攀登遇到阻挡，未能进入' }); return; }
    this.spendAction(actorId); this.movementSpent.set(actorId, (this.movementSpent.get(actorId) ?? 0) + climbCost);
    const origin = { ...actor };
    // Leaving a threatened level cannot evade an already available melee reaction.
    for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
      if (actor.status !== 'ready') break;
      const melee = meleeWeapon(foe);
      if (foe.side === actor.side || foe.status !== 'ready' || !melee || !sameLayer(foe, origin) || this.dist(foe, origin) !== 1
        || this.reactionSpent.has(foe.id) || foe.suppression) continue;
      const mode = melee === foe.sidearm ? 'sidearm' : 'primary';
      if (this.weaponContext(foe, actor, { weaponMode: mode }).reason) continue;
      this.resolveClimbReaction(foe, actor, mode, false);
    }
    if (actor.status !== 'ready') return;
    actor.elevation = arrival.elevation; actor.pos = cell; this.movedThisTurn.add(actorId); delete actor.tacticalPose;
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: `${actor.name} ${isElevated(actor) ? '登上城防平台' : '下至地面'} ${cellLabel(field, cell)}${reportsHeights(field) ? '(高度' + unitHeight(field, actor) + ')' : ''}，消耗主行动与${climbCost}移动` });
    this.settleAreaEffects(); revealContacts(this.observationContext());
    for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
      if (actor.status !== 'ready') break;
      if (foe.side !== actor.side && foe.status === 'ready' && !foe.suppression && this.overwatch.has(foe.id)
        && !this.reactionSpent.has(foe.id) && !this.weaponContext(foe, actor).reason) this.resolveClimbReaction(foe, actor, 'auto', true);
    }
    this.checkGridObjective(false);
  }
  private resolveClimbReaction(foe: Combatant, actor: Combatant, weaponMode: 'primary' | 'sidearm' | 'auto', watching: boolean): void {
    const context = this.weaponContext(foe, actor, { weaponMode });
    this.reactionSpent.add(foe.id); this.overwatch.delete(foe.id);
    const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: actor, rng: this.rng, rules: this.rules,
      conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.attackModifiers(foe, actor, context),
      actionDamageScale: watching ? this.hasteOverwatch.get(foe.id) ?? 1 : 1, ranged: context.ranged, weaponOverride: context.weapon });
    this.recordEvent({ round: this.round, kind: 'attack', text: (watching ? '警戒' : '借机') + '反应｜' + result.text, resolution: result });
    if (result.hit) this.applyOnHitTraits(foe, actor, result);
    if (context.ranged && weaponReloadTurns(context.weapon)) this.reloadCd.set(weaponReloadKey(foe, context.weapon), weaponReloadTurns(context.weapon) + 1);
    this.checkDeath(actor, foe); this.resolveFlightStates();
  }
  /** Wall/bridge collapse and expiring movement traits cannot leave a unit in an impossible cell. */
  private resolveGroundStates(source?: Combatant): void {
    const field = this.battlefield; if (!field?.layerVersion) return;
    for (const unit of this.combatants.filter(u => !isAirborne(u) && u.hp > 0 && ['ready', 'routing'].includes(u.status))) {
      if (!groundBlocked(field, unit.pos!, unit)) continue;
      const originalHeight=unitHeight(field,unit);
      const origin = unit.pos!, ground = { ...unit, elevation: undefined };
      // Rescue can traverse nearby water, never teleport through an intact wall, cliff or enemy.
      const rescue = { ...ground, traits: [...ground.traits, 'water-crossing'] };
      const candidates = reachableGridPaths(field, origin, 2, n => canOccupy(field, this.combatants, rescue, n), () => 1)
        .filter(path => canOccupy(field, this.combatants, ground, path.cells.at(-1)!)&&(field.spatialRulesVersion!==2||unitHeight(field,{...ground,pos:path.cells.at(-1)!})<=originalHeight))
        .sort((a, b) => a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!).map(path => path.cells.at(-1)!);
      const wasHigh = isElevated(unit); unit.elevation = undefined;
      if (candidates.length) unit.pos = candidates[0];
      else { unit.status = 'fled'; this.recordEvent({ round: this.round, kind: 'move', participants: [unit.id], text: unit.name + ' 失去立足点，无法就近落地，退出本次战斗' }); continue; }
      const drop=field.spatialRulesVersion===2?Math.max(1,originalHeight-unitHeight(field,unit)):1;
      const loss = applyCombatDamage(unit, Math.max(1, Math.round(memberHealth(unit) * (wasHigh ? Math.min(.4,.15*drop) : .1))), hasMemberHealth(unit) ? unit.hp : 1);
      this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], text: `${unit.name} ${wasHigh ? '随结构塌落' : '落水撤向近岸'}至${cellLabel(field, unit.pos!)}，损失${loss}生命` });
      this.checkDeath(unit, source);
    }
  }

  private checkGridObjective(roundEnd: boolean): void {
    const goal = this.battlefield?.objective; if (!goal || this.objectiveWinner) return;
    if (goal.kind === 'escape') {
      const unit = this.combatants.find((u) => u.id === goal.unitId);
      if (unit?.status === 'ready' && !isAirborne(unit) && unit.pos === goal.cell) this.objectiveWinner = unit.side === 'enemy' ? 'enemy' : 'ally';
      else if (goal.defenderWins && unit && (unit.status === 'dead' || unit.status === 'fled' || roundEnd && this.round >= goal.limit)) {
        this.objectiveWinner = unit.side === 'enemy' ? 'ally' : 'enemy';
      }
    } else if (goal.kind === 'control' && goal.cells && goal.attackingSide && this.battlefield?.layerVersion) {
      const occupants = this.combatants.filter(u => u.status === 'ready' && !isAirborne(u) && !isElevated(u) && goal.cells!.includes(u.pos!) && !u.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn));
      const attacker = goal.attackingSide ?? 'ally', hasAttacker = occupants.some(u => u.side === attacker), contested = occupants.some(u => u.side !== attacker);
      if (!hasAttacker) { this.controlRounds = { ally: 0, enemy: 0 }; this.controlHold = undefined; }
      else {
        if (!this.controlHold || this.controlHold.side !== attacker) this.controlHold = { side: attacker, sinceRound: this.round };
        if (roundEnd && !contested && this.round > this.controlHold.sinceRound && this.controlHold.lastCountedRound !== this.round) {
          this.controlRounds[attacker]++; this.controlHold.lastCountedRound = this.round;
          if (this.controlRounds[attacker] >= goal.rounds) this.objectiveWinner = attacker;
        }
      }
    } else if (goal.kind === 'control') {
      const cells = goal.cells ?? [goal.cell];
      const eligible = this.combatants.filter(u=>u.status==='ready'&&!isAirborne(u)&&!isElevated(u)&&!u.conditions.some(c=>c.dur>0&&this.conditions.get(c.id)?.skipTurn));
      const occupants = eligible.filter(u=>cells.includes(u.pos!));
      const sides = new Set(eligible.filter(u=>cells.some(p=>gridDistance(this.battlefield!,u.pos!,p)<=1)).map(u=>u.side));
      const owner = (['ally', 'enemy'] as const).find((side) => (!goal.attackingSide || goal.attackingSide === side)
        && occupants.some((u) => u.side === side) && sides.size === 1 && sides.has(side));
      if (!owner) { this.controlRounds = { ally: 0, enemy: 0 }; this.controlHold = undefined; }
      else {
        if (this.controlHold?.side !== owner) {
          this.controlRounds = { ally: 0, enemy: 0 }; this.controlHold = { side: owner, sinceRound: this.round };
        }
        // 占点当轮不足完整一轮；按全体单位轮末计一次，保存恢复不重置或补算。
        if (roundEnd && this.round > this.controlHold.sinceRound && this.controlHold.lastCountedRound !== this.round) {
          this.controlRounds[owner]++; this.controlHold.lastCountedRound = this.round;
          if (this.controlRounds[owner] >= goal.rounds) this.objectiveWinner = owner;
        }
      }
    }
    if (roundEnd && this.round >= goal.limit && !this.objectiveWinner) this.objectiveWinner = goal.kind === 'control' && goal.attackingSide
      ? goal.attackingSide === 'ally' ? 'enemy' : 'ally' : 'draw';
    if (this.objectiveWinner) this.recordEvent({ round: this.round, kind: 'battle-end', text: smallBattleResult(this) ?? `任务结束：${this.objectiveWinner}` });
  }

  private weaponContext(
    actor: Combatant,
    target: Combatant,
    opts: Pick<SmallAttackOpts, 'charge' | 'ranged' | 'weaponMode'> = {},
    shieldingUnits = this.visibleCombatants(actor.side),
  ): WeaponContext {
    const distance = this.dist(actor, target);
    const primaryRanged = this.rules.resolutionVersion === 'v2' ? isRangedWeapon(actor.weapon) : opts.ranged ?? isRangedCapable(actor);
    const mode = opts.weaponMode ?? 'auto';
    let useSidearm = !!actor.sidearm && (
      mode === 'sidearm' || (mode === 'auto' && primaryRanged && (!!opts.charge || distance === 0))
    );
    if (mode === 'sidearm' && !actor.sidearm) {
      return { weapon: undefined, ranged: false, useSidearm: false, reason: actor.name + ' 没有副武器', pointBlankPenalty: 0 };
    }
    if (this.rules.resolutionVersion === 'v2' && mode === 'auto') {
      if (opts.charge) useSidearm = meleeWeapon(actor) === actor.sidearm && !!actor.sidearm;
      else {
        const adapt = (w: Combatant['weapon']) => this.battlefield ? gridWeapon(w, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel) : w;
        const primaryReason = weaponTargetReason({ actor, target, weapon: adapt(actor.weapon), ranged: primaryRanged, distance, reloadLeft: this.reloadCd.get(actor.id) ?? 0, field: this.battlefield });
        const secondaryReason = actor.sidearm && weaponTargetReason({ actor, target, weapon: adapt(actor.sidearm), ranged: isRangedWeapon(actor.sidearm), distance, reloadLeft: this.reloadCd.get(weaponReloadKey(actor, actor.sidearm)) ?? 0, field: this.battlefield });
        useSidearm = !!actor.sidearm && !secondaryReason && (!!primaryReason || primaryRanged && !isRangedWeapon(actor.sidearm) && meleeContact(this.battlefield, actor, target) && distance <= (this.battlefield ? 1 : 0));
      }
    }
    const originalWeapon = useSidearm ? actor.sidearm : actor.weapon;
    const weapon = this.battlefield ? gridWeapon(originalWeapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel) : originalWeapon;
    const ranged = this.rules.resolutionVersion === 'v2' ? isRangedWeapon(originalWeapon) : useSidearm ? isRangedWeapon(originalWeapon) : primaryRanged;
    const blocked = actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && weapon?.recipe?.mechanism !== 'natural');
    let reason = (blocked ? '当前状态禁止武器攻击' : undefined) ?? weaponTargetReason({
      actor,
      target,
      weapon,
      ranged,
      distance,
      reloadLeft: this.reloadCd.get(weaponReloadKey(actor, originalWeapon)) ?? 0,
      charge: !!opts.charge,
      field: this.battlefield,
    });
    if (this.rules.resolutionVersion === 'v2' && !this.visibleCombatants(actor.side).some((u) => u.id === target.id)) reason = opts.charge ? '冲锋目标尚未观测到（视线或距离受限）' : '尚未观测到目标（视线或距离受限）';
    if (!reason && this.battlefield && !opts.charge) reason = this.sightReason(actor, target, weapon?.indirect);
    if (!reason && this.battlefield && !ranged && !opts.charge && this.rules.combatModel === MEMBER_HEALTH_MODEL) {
      const blocker = meleeLineBlocker(this.battlefield, actor, target, shieldingUnits);
      if (blocker) reason = `近战攻击被${blocker.name}阻挡；长兵器可越过友军，不能越过存活敌军`;
    }
    if (!reason && this.battlefield && !ranged) reason = meleeHeightReason(this.battlefield, actor, target);
    if (!reason && this.battlefield && ranged) {
      const guard = rangedScreen(actor, target, weapon, shieldingUnits, { mode: 'small', width: this.battlefield.width, battlefield: this.battlefield }, this.conditionDefMap());
      if (guard) reason = rangedScreenReason(guard);
    }
    if (!reason && this.battlefield && ranged && weapon?.pointBlankPolicy === 'forbid' && this.combatants.some((u) => u.side !== actor.side && u.status === 'ready' && meleeContact(this.battlefield, actor, u) && this.dist(actor, u) === 1)) reason = '被相邻敌人牵制，该武器不能抵近射击';
    if (!reason && this.rules.resolutionVersion === 'v2' && opts.charge && (fatiguePenalty(actor) > 0 || actor.suppression || activeConditionIds(actor).some((id) => id === 'slowed' || this.conditions.get(id)?.preventMove))) reason = '疲劳、压制、减速或定身令冲锋无法完成';
    if (!reason && this.battlefield && opts.charge && !this.chargePath(actor, target)) reason = '冲锋没有可用上限内的合法路径与相邻落点';
    const landing = isAirborne(actor) && !isAirborne(target) && !ranged;
    if (!reason && landing && !opts.charge && (!this.battlefield || this.movementLeft(actor.id) < 1 || !canOccupy(this.battlefield, this.visibleCombatants(actor.side), { ...actor, airborne: false }, actor.pos!))) reason = '扑击需要1点降落移动与当前格的合法地面落点';
    return {
      weapon,
      ranged,
      useSidearm,
      landing,
      reason,
      pointBlankPenalty: pointBlankModifier(weapon, ranged, this.battlefield && meleeContact(this.battlefield, actor, target) && distance === 1 ? 0 : distance, actor),
    };
  }

  private moveReason(actor: Combatant, dir: 'advance' | 'withdraw'): string | undefined {
    if (this.battlefield) return this.reachableCells(actor.id).some((p) => p.cost > 0) ? undefined : '没有可用上限内的可移动落点';
    const foes = this.combatants.filter((c) => c.side !== actor.side && c.status === 'ready');
    if (!foes.length) return '没有可供参照的敌人';
    const nearest = [...foes].sort((a, b) => this.dist(actor, a) - this.dist(actor, b))[0]!;
    if (dir === 'advance' && this.dist(actor, nearest) === 0) return '已与最近敌人接战，无法再逼近';
    const towardEnemyLine = actor.side === 'enemy' ? -1 : 1;
    const toward = Math.sign((nearest.pos ?? 2) - (actor.pos ?? 2)) || towardEnemyLine;
    const delta = dir === 'advance' ? toward : -toward;
    const before = actor.pos ?? 2;
    const after = Math.max(0, Math.min(5, before + delta));
    if (after !== before) return undefined;
    const canEdgeDisengage = dir === 'withdraw'
      && !hasFlag(actor, 'mounted-archer', this.traitRegistry)
      && !activeTraitIds(actor).includes('skirmisher')
      && foes.some((foe) => this.dist(foe, actor) === 0);
    if (canEdgeDisengage) return undefined;
    return dir === 'advance' ? '已抵近战线最前端' : '已退至战场边缘';
  }

  private attackModifiers(attacker: Combatant, target: Combatant, context: WeaponContext, opts: SmallAttackOpts = {}) {
    const attackerId = attacker.id;
    const rangedAttack = context.ranged;
    // 克制矩阵 → 态势修正；战场环境（fieldMod 特质）攻方加值注入
    const counter = counterMod(this.rules, attacker.archetype, target.archetype);
    const extraMods = [...(opts.extraMods ?? [])];
    if (counter !== 0) {
      extraMods.push({
        source: 'stance',
        name: '兵种克制',
        kind: 'atk',
        type: 'flat',
        value: counter,
      });
    }
    if (this.rules.resolutionVersion !== 'v2') extraMods.push(...fieldModsFor(attacker, this.fieldTags, this.traitRegistry).filter((m) => m.kind === 'atk'));
    if (context.pointBlankPenalty) {
      extraMods.push({ source: 'stance', name: '抵近射击', kind: 'atk', type: 'flat', value: context.pointBlankPenalty });
    }
    const defenderMods = this.rules.resolutionVersion === 'v2' ? [] : fieldModsFor(target, this.fieldTags, this.traitRegistry).filter((m) => m.kind === 'def');
    if (!isAirborne(target) && this.battlefield?.tiles[target.pos!] === 'cover' && this.dist(attacker, target) > 1) defenderMods.push({ source: 'stance', name: '掩体', kind: 'def', type: 'flat', value: 2 });
    if (attacker.suppression) extraMods.push({ source: 'condition', name: '受压制', kind: 'atk', type: 'flat', value: -2 });
    // 移动后射击惩罚（骑射免疫）；副武器换击/冲锋近战不算射击
    if (
      rangedAttack &&
      !opts.charge &&
      this.movedThisTurn.has(attackerId) &&
      !(this.rules.resolutionVersion === 'v2' ? steadyMovingShot(attacker, context.weapon) : hasFlag(attacker, 'mounted-archer', this.traitRegistry))
    ) {
      extraMods.push({ source: 'stance', name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
    }

    const width = engagementWidth(attacker, target, context.ranged, this.battlefield, this.fieldTags);
    const participants = this.battlefield || this.rules.combatModel ? sharedParticipants(attacker, this.combatants.filter((u) => u.pos === attacker.pos && sameLayer(u, attacker)), width, target) : width;
    return { extraMods, defenderMods, participants };
  }

  /** 当前公开属性下的无随机数攻击预览；实际结算仍走 resolveAttack。 */
  private weaponPreview(actor: Combatant, target: Combatant, context: WeaponContext): NonNullable<ActionOption['preview']> {
    if (this.rules.resolutionVersion === 'v2') {
      const arrival = context.landing ? { ...actor, airborne: false } : actor;
      return { ...this.previewAttackWithEnvironment({ attacker: arrival, defender: target, rules: this.rules,
        conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon,
        ranged: context.ranged, actionDamageScale: this.usingHaste(actor.id) ? hasteAttackScale(actor) : 1, ...this.attackModifiers(arrival, target, context) }), ...(context.landing ? { movementCost: 1, lands: true } : {}) };
    }
    const movedPenalty = context.ranged
      && this.movedThisTurn.has(actor.id)
      && !hasFlag(actor, 'mounted-archer', this.traitRegistry)
      ? -2
      : 0;
    const netAtk = actor.base.atk
      + counterMod(this.rules, actor.archetype, target.archetype)
      + movedPenalty
      + context.pointBlankPenalty;
    const hitChance = estimateHitChance(this.rules, netAtk, target.base.def);
    const armorReduction = Math.min(0.9, armorDR(target, this.rules, this.traitRegistry) + qualityGapDR(actor, target, context.weapon));
    return {
      hitChance,
      expectedDamage: estimateExpectedDamage({
        baseDice: context.weapon?.baseDice,
        apDice: context.weapon?.apDice,
        armorReduction,
        hitChance,
        attacks: context.weapon?.attacks,
      }),
      ...(movedPenalty ? { movePenalty: movedPenalty } : {}),
      ...(context.pointBlankPenalty ? { pointBlankPenalty: context.pointBlankPenalty } : {}),
    };
  }

  /** 面板/AI 的结构化动作菜单；不可用项保留并附原因。 */
  getActionOptions(actorId: string): ActionOption[] {
    const actor = this.byId(actorId);
    const economy = this.getTurnEconomy(actorId);
    const actorReason = actor.status !== 'ready'
      ? actor.name + ' 无法行动（' + actor.status + '）'
      : this.started && !this.isTurnOf(actorId)
        ? '现在不是 ' + actor.name + ' 的回合'
        : undefined;
    const foes = this.visibleCombatants(actor.side).filter((c) => c.side !== actor.side && c.status !== 'dead' && c.status !== 'fled');
    const attackTargets = foes.map((target) => {
      const context = this.weaponContext(actor, target, { weaponMode: 'primary' });
      const reason = actorReason ?? (!economy.actionAvailable ? '本回合主行动已使用' : undefined) ?? context.reason;
      return {
        targetId: target.id,
        enabled: !reason,
        ...(reason ? { reason } : {}),
        distance: this.dist(actor, target),
        rangeDistance: context.ranged ? rangedTargetDistance(actor, target, this.dist(actor, target)) : this.dist(actor, target),
        ...(context.ranged && heightReach(this.battlefield, actor, target) ? { heightReach: heightReach(this.battlefield, actor, target) } : {}),
        ...(!context.reason ? { preview: this.weaponPreview(actor, target, context) } : {}),
      };
    });
    const sidearmTargets = actor.sidearm ? foes.map((target) => {
      const context = this.weaponContext(actor, target, { weaponMode: 'sidearm' });
      const reason = actorReason ?? (!economy.actionAvailable ? '本回合主行动已使用' : undefined) ?? context.reason;
      return {
        targetId: target.id,
        enabled: !reason,
        ...(reason ? { reason } : {}),
        distance: this.dist(actor, target),
        rangeDistance: context.ranged ? rangedTargetDistance(actor, target, this.dist(actor, target)) : this.dist(actor, target),
        ...(context.ranged && heightReach(this.battlefield, actor, target) ? { heightReach: heightReach(this.battlefield, actor, target) } : {}),
        ...(!context.reason ? { preview: this.weaponPreview(actor, target, context) } : {}),
      };
    }) : [];
    const chargeTargets = foes.map((target) => {
      const context = this.weaponContext(actor, target, { charge: true });
      const reason = actorReason
        ?? (!economy.actionAvailable ? '本回合主行动已使用' : undefined)
        ?? (!economy.moveAvailable ? '本回合移动额度已使用' : undefined)
        ?? context.reason;
      const path = this.battlefield && !reason ? this.chargePath(actor, target) : undefined;
      const arrival = path ? { ...actor, pos: path.cells.at(-1)!, ...(context.landing ? { airborne: false } : {}) } : actor;
      const preview = !reason && this.rules.resolutionVersion === 'v2' ? this.previewAttackWithEnvironment({ attacker: arrival, defender: target, rules: this.rules,
        conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon, ranged: false, charge: true, actionDamageScale: this.usingHaste(actorId) ? hasteAttackScale(actor) : 1,
        ...this.attackModifiers(arrival, target, context, { charge: true }) }) : undefined;
      return { targetId: target.id, enabled: !reason, ...(reason ? { reason } : {}), distance: this.dist(actor, target), ...(preview ? { preview: { ...preview, movementCost: (path?.cost ?? 0) + Number(!!context.landing), lands: context.landing } } : {}) };
    });
    const options: ActionOption[] = [
      {
        id: 'weapon', kind: 'weapon', label: actor.weapon?.name ?? '武器攻击',
        enabled: attackTargets.some((target) => target.enabled),
        ...(!attackTargets.some((target) => target.enabled) ? { reason: attackTargets[0]?.reason ?? actorReason ?? '没有合法目标' } : {}),
        targets: attackTargets,
        range: weaponRangeSpec(this.battlefield ? gridWeapon(actor.weapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel) : actor.weapon, isRangedCapable(actor)),
        preview: {
          ...(this.movedThisTurn.has(actor.id) && isRangedCapable(actor) && !(actor.rulesVersion === 'v2' && steadyMovingShot(actor, actor.weapon)) ? { movePenalty: -2 } : {}),
        },
      },
      ...(actor.sidearm ? [{
        id: 'weapon:sidearm', kind: 'weapon' as const, label: actor.sidearm.name,
        enabled: sidearmTargets.some((target) => target.enabled),
        ...(!sidearmTargets.some((target) => target.enabled) ? { reason: sidearmTargets[0]?.reason ?? actorReason ?? '没有合法目标' } : {}),
        targets: sidearmTargets,
        range: weaponRangeSpec(this.battlefield ? gridWeapon(actor.sidearm, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel) : actor.sidearm, this.rules.resolutionVersion === 'v2' && isRangedWeapon(actor.sidearm)),
      }] : []),
      {
        id: 'charge', kind: 'charge', label: '冲锋',
        enabled: chargeTargets.some((target) => target.enabled),
        ...(!chargeTargets.some((target) => target.enabled) ? { reason: chargeTargets[0]?.reason ?? actorReason ?? '没有合法目标' } : {}),
        targets: chargeTargets,
      },
    ];
    for (const ability of actor.abilities) {
      const usability = abilityUsabilityReason(actor, ability) ?? this.summonReason(actor, ability);
      const candidates = ability.target === 'enemy'
        ? foes
        : ability.target === 'ally'
          ? this.combatants.filter((c) => c.side === actor.side && c.status !== 'dead' && c.status !== 'fled')
          : ability.target === 'self'
            ? [actor]
            : ability.effects.some(e=>e.op==='zone') && this.battlefield ? this.battlefield.tiles.flatMap((_tile,cell)=>{ const at=zoneTarget(this.observationContext(),actor,'cell:'+cell); return at && this.cellVisible(actor.side,cell)?[at]:[]; }) : [];
      const targets = candidates.map((target) => {
        const targetReason = this.skillTargetReason(actor, ability, target);
        const reason = actorReason ?? (ability.itemSourceId ? !economy.actionAvailable ? '本回合行动已使用' : undefined : this.hasteSelected.has(actorId) ? '加速动作不能使用技能' : this.actedThisTurn.has(actorId) ? '本回合主行动已使用' : undefined) ?? usability ?? targetReason;
        const damage = ability.effects.find((e) => e.op === 'damage');
        const healing = ability.effects.find((e) => e.op === 'heal');
        const moraleEffect = ability.effects.find((e) => e.op === 'morale');
        const landing = !reason ? this.abilityFlightPreview(actor, target, ability) : undefined;
        const effects = !reason && this.rules.resolutionVersion === 'v2' ? skillEffectLines({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, actor, target, ability) : [];
        const preview = !reason && this.rules.resolutionVersion === 'v2' && damage ? this.previewAttackWithEnvironment({ attacker: actor, defender: target, rules: this.rules,
          conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ranged: damage.tag === 'ranged' ? true : undefined,
          ...this.skillAttackOptions(actor, target, ability, damage) })
          : healing && !reason ? { healing: Math.min(recoveryCapacity(target), healingYield(actor,target,healing.amount ?? diceAvg(healing.dice!),!!ability.itemSourceId)) } : moraleEffect && !reason ? moraleChangePreview({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, target, moraleEffect.amount, this.rules.morale.breakAt, this.traitRegistry, ability.effects.flatMap((e) => e.op === 'condition' ? [{ id: e.conditionId, dur: e.dur }] : [])) : undefined;
        const area = (damage?.shape ?? ability.shape) === 'burst' && !reason ? this.abilityDamageTargets(actor, target, ability, true) : [];
        const areaPreviews = damage && this.rules.resolutionVersion === 'v2' ? area.map((affected) => ({
          targetId: affected.id, ...this.previewAttackWithEnvironment({ attacker: actor, defender: affected, rules: this.rules,
            conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(actor, affected, ability, damage) }),
        })) : [];
        return { targetId: target.id, enabled: !reason, ...(reason ? { reason } : {}), distance: this.dist(actor, target), rangeDistance: abilityRangeDistance(actor, this.battlefield ? gridAbility(ability) : ability, target, this.dist(actor, target)), ...(abilityHeightReach(actor, ability, target, this.dist(actor, target), this.battlefield) ? { heightReach: abilityHeightReach(actor, ability, target, this.dist(actor, target), this.battlefield) } : {}), ...(preview || landing || effects.length ? { preview: { ...preview, ...landing, ...(effects.length ? { effects } : {}), ...(area.length ? { areaTargets: area.map((u) => u.name), areaTargetIds: area.map((u) => u.id), areaPreviews } : {}) } } : {}) };
      });
      const targetlessReason = actorReason ?? (ability.itemSourceId ? !economy.actionAvailable ? '本回合行动已使用' : undefined : this.hasteSelected.has(actorId) ? '加速动作不能使用技能' : this.actedThisTurn.has(actorId) ? '本回合主行动已使用' : undefined) ?? usability;
      const enabled = candidates.length ? targets.some((target) => target.enabled) : !targetlessReason;
      options.push({
        id: ability.id,
        kind: 'ability',
        label: ability.name,
        enabled,
        ...(!enabled ? { reason: targets[0]?.reason ?? targetlessReason ?? '没有合法目标' } : {}),
        ...(targets.length ? { targets } : {}),
        range: fallbackAbilityRange(actor, this.battlefield ? gridAbility(ability) : ability, !!this.battlefield),
        ...(ability.cost
          ? { preview: { resource: { name: ability.itemSourceId ? '物品' : ability.cost.resource, cost: abilityCost(actor, ability)!.amount, available: actor.resources[ability.cost.resource] ?? 0 } } }
          : {}),
      });
    }
    const advanceReason = actorReason ?? (!economy.moveAvailable ? '本回合移动额度已使用' : undefined) ?? this.moveReason(actor, 'advance');
    const withdrawReason = actorReason ?? (!economy.moveAvailable ? '本回合移动额度已使用' : undefined) ?? this.moveReason(actor, 'withdraw');
    const retreatDistance = this.distToNearestFoe(actor);
    const retreatReason = actorReason
      ?? (!economy.actionAvailable ? '本回合主行动已使用' : undefined)
      ?? (retreatDistance < 2 ? '距离不足，先脱离接触再撤离' : undefined)
      ?? (this.battlefield && !retreatCells(this.battlefield, actor.side).includes(actor.pos!) ? '先移动到己方地图边缘再撤离' : undefined);
    options.push(
      { id: 'advance', kind: 'move', label: '前进', enabled: !advanceReason, ...(advanceReason ? { reason: advanceReason } : {}) },
      { id: 'withdraw', kind: 'move', label: '后撤', enabled: !withdrawReason, ...(withdrawReason ? { reason: withdrawReason } : {}) },
      { id: 'retreat', kind: 'retreat', label: '撤离', enabled: !retreatReason, ...(retreatReason ? { reason: retreatReason } : {}) },
      { id: 'end-turn', kind: 'end-turn', label: '结束回合', enabled: !actorReason, ...(actorReason ? { reason: actorReason } : {}) },
    );
    if (this.battlefield) {
      const reason = this.braceReason(actorId);
      options.push({ id: 'brace', kind: 'brace', label: '固守', enabled: !reason, ...(reason ? { reason } : {}) });
    }
    return options;
  }

  /**
   * 武器攻击。containment: 默认仅当前行动者可用（bypass 供面板 GM 工具）。
   * 距离规则：近战需 dist ≤ 武器触及；射击读取武器的 minRange/maxRange/贴身策略。
   * 本回合移动过则射击 −2（骑射特质免疫）；冲锋需 dist≥2 且机动/冲锋特质，自动贴至目标。
   */
  attack(attackerId: string, targetId: string, opts: SmallAttackOpts = {}): AttackResolution {
    const attacker = this.byId(attackerId);
    const target = this.byId(targetId);
    if (!opts.bypassTurn && this.started && !this.isTurnOf(attackerId)) {
      throw new Error(`现在不是 ${attacker.name} 的回合`);
    }
    if (attacker.status !== 'ready') throw new Error(`${attacker.name} 无法行动（${attacker.status}）`);
    if (!opts.bypassTurn && !this.nonSkillActionAvailable(attackerId)) throw new Error('本回合主行动已使用');
    if (!this.battlefield && !opts.bypassTurn && opts.charge && this.movedThisTurn.has(attackerId)) throw new Error('本回合移动额度已使用，无法再冲锋');

    const hasteAction = !opts.bypassTurn && this.usingHaste(attackerId);
    const hasteScale = hasteAction ? hasteAttackScale(attacker) : 1;
    const d = this.dist(attacker, target);
    const context = this.weaponContext(attacker, target, opts);
    if (context.reason) throw new Error(context.reason);
    delete attacker.tacticalPose;
    if ((this.battlefield || attacker.resourceModel) && attacker.rulesVersion === 'v2' && !opts.bypassTurn) addTacticalEffort(attacker, opts.charge ? 2 : 1);
    if (opts.charge && this.battlefield) {
      const path = this.chargePath(attacker, target)!;
      this.moveTo(attacker.id, path.cells.at(-1)!, true);
      if (attacker.status !== 'ready' || this.dist(attacker, target) > 1 || attacker.conditions.some((c) => this.conditions.get(c.id)?.skipTurn)) {
        this.spendAction(attacker.id, hasteAction);
        return { attackerId: attacker.id, defenderId: target.id, attackerName: attacker.name, defenderName: target.name,
          hit: false, crit: false, netAtk: 0, targetDef: target.base.def, atkDetail: '', drPercent: 0, baseAfterDR: 0, apTotal: 0,
          dmgMult: 1, wardMult: 1, finalDamage: 0, hpBefore: target.hp, hpAfter: target.hp, defenderStatus: target.status, text: '冲锋途中被反应中断，未发生攻击' };
      }
    }
    if (context.landing && isAirborne(attacker)) this.changeFlight(attacker.id, false, true);
    const activeWeapon = context.weapon;
    const rangedAttack = context.ranged;

    // 多段攻击（速射武器 attacks>1）：逐段独立命中与结算，目标失去战斗力即止
    // （濒死可被补刀终结，转 dead 后停手）；多段数随实际使用的武器
    const times = Math.max(1, activeWeapon?.attacks ?? 1);
    let last: AttackResolution | undefined;
    const shots: AttackResolution[] = [];
    for (let i = 0; i < times; i++) {
      if (target.status !== 'ready' && target.status !== 'dying' && target.status !== 'routing') break;
      if (i > 0 && this.weaponContext(attacker, target, { ...opts, charge: false }).reason) break;
      const { extraMods, defenderMods, participants } = this.attackModifiers(attacker, target, context, opts);
      const res = this.resolveAttackWithEnvironment({
        attacker,
        defender: target,
        participants,
        actionDamageScale: hasteScale,
        rng: this.rng,
        rules: this.rules,
        conditionDefs: this.conditionDefMap(),
        traitRegistry: this.traitRegistry,
        extraMods,
        defenderMods,
        charge: opts.charge,
        ranged: rangedAttack,
        weaponOverride: context.useSidearm ? attacker.sidearm : undefined,
        advantage: opts.advantage,
      });
      last = res;
      shots.push(res);
      // 冲锋贴身：无论命中与否都冲至目标坐标
      if (opts.charge && !this.battlefield) {
        attacker.pos = target.pos;
        this.movedThisTurn.add(attackerId);
      }
      // 命中特效特质（毒击等）
      if (res.hit && (this.rules.resolutionVersion === 'v2' || res.finalDamage > 0)) {
        this.applyOnHitTraits(attacker, target, res);
      }
      const wpnShort = activeWeapon ? tbWeaponShortName(activeWeapon) : '';
      const prefix = wpnShort ? (times > 1 ? `［${wpnShort}·${i + 1}/${times}］` : `［${wpnShort}］`) : (times > 1 ? `［${i + 1}/${times}］` : '');
      this.recordEvent({ round: this.round, kind: 'attack', text: prefix + res.text, resolution: res });
      this.checkDeath(target, attacker);
      this.checkInjury(target, res.finalDamage); this.resolveFlightStates();
    }

    // 发射后进入装填（+1 缓冲：抵消本回合结束后的首次递减，reload=1 即隔回合发射）；
    // 只写入实际发射的武器槽，另一槽的计时保持独立。
    const reload = weaponReloadTurns(activeWeapon);
    this.resolveFlightStates();
    if (reload > 0 && rangedAttack) this.reloadCd.set(weaponReloadKey(attacker, activeWeapon), reload + 1);
    if (!opts.bypassTurn) this.spendAction(attackerId, hasteAction);
    if (shots.length < 2) return last!;
    const first = shots[0]!, total = shots.reduce((sum,r)=>sum+r.finalDamage,0);
    return { ...last!, hit: shots.some(r=>r.hit), crit: shots.some(r=>r.crit), hpBefore: first.hpBefore, hpAfter: last!.hpAfter,
      membersBefore: first.membersBefore, membersAfter: last!.membersAfter, defenderStatus: target.status, finalDamage: total,
      directDamage: shots.reduce((s,r)=>s+(r.directDamage??0),0), splashDamage: shots.reduce((s,r)=>s+(r.splashDamage??0),0),
      barrierAbsorbed: shots.reduce((s,r)=>s+(r.barrierAbsorbed??0),0), packetCount: shots.reduce((s,r)=>s+(r.packetCount??1),0),packetHits:shots.reduce((s,r)=>s+(r.packetHits??Number(r.hit)),0),packetRolls:shots.flatMap(r=>r.packetRolls??[{hit:r.hit,crit:r.crit,damage:r.finalDamage}]),
      text: `${attacker.name}→${target.name}：${shots.length}发合计伤害${total}${first.membersBefore!==undefined&&last!.membersAfter!==undefined?`，减员${first.membersBefore-last!.membersAfter}，余员${last!.membersAfter}`:''}` };
  }

  /**
   * 移动一格：向最近敌人逼近 / 远离。后撤时被贴身（距离0）的敌人获得一次借机攻击，
   * 带「游击」或「骑射」特质的单位免疫——骑射放风筝的攻防核心。
   */
  move(actorId: string, dir: 'advance' | 'withdraw', opts: { bypassTurn?: boolean } = {}): void {
    if (this.battlefield) {
      const actor = this.byId(actorId);
      const destinations = this.reachableCells(actorId).filter((p) => p.cost > 0).sort((a, b) => {
        const score = (path: GridPath) => Math.min(...this.combatants.filter((u) => u.side !== actor.side && u.status === 'ready').map((u) => gridDistance(this.battlefield!, path.cells.at(-1)!, u.pos!)));
        return (dir === 'advance' ? 1 : -1) * (score(a) - score(b)) || a.cost - b.cost;
      });
      if (!destinations.length) throw new Error('没有可移动落点');
      this.moveTo(actorId, destinations[0]!.cells.at(-1)!); return;
    }
    const actor = this.byId(actorId);
    if (!opts.bypassTurn && this.started && !this.isTurnOf(actorId)) {
      throw new Error(`现在不是 ${actor.name} 的回合`);
    }
    if (actor.status !== 'ready') throw new Error(`${actor.name} 无法行动（${actor.status}）`);
    if (!opts.bypassTurn && this.movedThisTurn.has(actorId)) throw new Error('本回合移动额度已使用');

    const foes = this.combatants.filter((c) => c.side !== actor.side && c.status === 'ready');
    if (!foes.length) throw new Error('没有可供参照的敌人');
    let nearest = foes[0]!;
    for (const f of foes) {
      if (this.dist(actor, f) < this.dist(actor, nearest)) nearest = f;
    }
    if (dir === 'advance' && this.dist(actor, nearest) === 0) {
      throw new Error('已与最近敌人接战，无法再逼近');
    }
    // 前进 = 朝最近敌人方向；同位时按阵营默认战线方向（我方右侧为敌）
    const towardEnemyLine = actor.side === 'enemy' ? -1 : 1;
    const toward = Math.sign((nearest.pos ?? 2) - (actor.pos ?? 2)) || towardEnemyLine;
    const delta = dir === 'advance' ? toward : -toward;
    const before = actor.pos ?? 2;
    const after = Math.max(0, Math.min(5, before + delta));

    // 借机攻击：后撤离开接战（距离0）时触发
    const canProvoke =
      dir === 'withdraw' &&
      !hasFlag(actor, 'mounted-archer', this.traitRegistry) &&
      !activeTraitIds(actor).includes('skirmisher');
    const provoked = canProvoke ? foes.filter((e) => this.dist(e, actor) === 0) : [];

    if (after === before) {
      if (dir === 'withdraw' && provoked.length > 0) {
        // 贴边脱离：退无可退且被贴身——侧身穿过敌阵是唯一空档。
        // 承接全部借机攻击后拉开 1 格（占用本回合移动，后续射击带移动惩罚）
        const disengagePos = Math.max(0, Math.min(5, before - delta));
        actor.pos = disengagePos;
        this.movedThisTurn.add(actorId);
        this.recordEvent({
          round: this.round,
          kind: 'move',
          participants: [actor.id], text: `${actor.name} 贴边脱离缠斗：位置${before}→${disengagePos}`,
        });
        this.opportunityAttacks(actor, provoked);
        return;
      }
      throw new Error(dir === 'advance' ? '已抵近战线最前端' : '已退至战场边缘');
    }

    actor.pos = after;
    this.movedThisTurn.add(actorId);
    this.recordEvent({
      round: this.round,
      kind: 'move',
      participants: [actor.id], text: `${actor.name} ${dir === 'advance' ? `逼近${nearest.name}` : '后撤拉开距离'}：位置${before}→${after}`,
    });

    this.opportunityAttacks(actor, provoked);
  }

  /** 借机攻击序列： provoke 方对 actor 的近身挥击（actor 致死则中断） */
  private opportunityAttacks(actor: Combatant, provoked: Combatant[]): void {
    for (const e of provoked) {
      if (actor.status !== 'ready') break; // 借机攻击致死则停止
      const res = this.resolveAttackWithEnvironment({
        attacker: e,
        defender: actor,
        rng: this.rng,
        rules: this.rules,
        conditionDefs: this.conditionDefMap(),
        traitRegistry: this.traitRegistry,
        ranged: false, // 借机攻击视为近身挥击；带副武器者换刀剑（免"武器不善近战"罚）
        weaponOverride: e.sidearm,
      });
      this.recordEvent({ round: this.round, kind: 'attack', text: `借机攻击｜${res.text}`, resolution: res });
      this.checkDeath(actor, e);
    }
  }

  /**
   * 撤离战场：与所有存活敌人距离 ≥2 才能脱身；成功后状态 fled、移出轮转。
   * 撤离不等于溃败——小规模战斗中 fled 单位视为退出战斗（isOver 判失去战斗力）。
   */
  retreat(actorId: string, opts: { bypassTurn?: boolean } = {}): void {
    const actor = this.byId(actorId);
    if (this.battlefield && !retreatCells(this.battlefield, actor.side).includes(actor.pos!)) throw new Error('先移动到己方地图边缘再撤离');
    if (!opts.bypassTurn && this.started && !this.isTurnOf(actorId)) {
      throw new Error(`现在不是 ${actor.name} 的回合`);
    }
    if (actor.status !== 'ready') throw new Error(`${actor.name} 无法行动（${actor.status}）`);
    if (!opts.bypassTurn && !this.nonSkillActionAvailable(actorId)) throw new Error('本回合主行动已使用');
    const foes = this.combatants.filter((c) => c.side !== actor.side && c.status === 'ready');
    const minD = foes.length ? Math.min(...foes.map((f) => this.dist(actor, f))) : Infinity;
    if (minD < 2) {
      throw new Error(`距离不足（最近敌人仅 ${bandLabel(minD === Infinity ? 99 : minD)}），先脱离接触再撤离`);
    }
    if (!opts.bypassTurn) this.spendAction(actorId);
    actor.status = 'fled';
    this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id], text: `${actor.name} 撤离战场` });
    this.checkGridObjective(false);
  }

  private skillAttackOptions(actor: Combatant, target: Combatant, ability: Combatant['abilities'][number], effect: Parameters<typeof skillAttack>[4], plannedMove = false) {
    const base = skillAttack(this.observationContext(), actor, target, ability, effect, this.rules);
    if (!ability.weaponUse || !base.weaponOverride) return base;
    const context = this.weaponContext(actor, target, { weaponMode: base.weaponOverride.id === actor.sidearm?.id ? 'sidearm' : 'primary' });
    const modifiers = this.attackModifiers(actor, target, context);
    if (plannedMove && context.ranged && !this.movedThisTurn.has(actor.id) && !steadyMovingShot(actor, context.weapon)) modifiers.extraMods.push({ source: 'stance', name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
    return { ...base, ...modifiers };
  }
  private skillTargetReason(actor: Combatant, ability: Combatant['abilities'][number], target: Combatant): string | undefined {
    if (this.battlefield?.layerVersion && ability.delivery === 'melee') { const height = meleeHeightReason(this.battlefield, actor, target); if (height) return height; }
    ability = this.battlefield ? gridAbility(ability) : ability;
    if (ability.target === 'zone') return !this.battlefield || !this.cellVisible(actor.side,target.pos!) ? '请指定可见的地面位置' : abilityTargetReason({actor,ability,target,distance:this.dist(actor,target),field:this.battlefield}) ?? (unitLineOfSight(this.battlefield,actor,target) ? undefined : '这里被障碍物遮挡');
    const reason = abilityTargetReason({ actor, ability, target, distance: this.dist(actor, target), field: this.battlefield })
      ?? (this.battlefield && !ability.weaponUse ? this.sightReason(actor, target) : undefined);
    if (reason) return reason;
    if (this.battlefield && target.status === 'dying' && ability.effects.some(e => e.op === 'heal')
      && !canOccupy(this.battlefield, this.visibleCombatants(actor.side), target, target.pos!)) return '濒死单位所在格没有起身空间，请先让出救援位置';
    if (ability.weaponUse) {
      const weapon = skillWeapon(actor, ability, this.dist(actor, target));
      const context = this.weaponContext(actor, target, { weaponMode: weapon?.id === actor.sidearm?.id ? 'sidearm' : 'primary' });
      if (context.reason) return context.reason;
    }
    if (ability.effects.every((e) => e.op === 'push')) return pushPreview({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, actor, target, ability.effects[0] as Extract<EffectOp, { op: 'push' }>).reason;
    return undefined;
  }
  private abilityDamageTargets(actor: Combatant, target: Combatant, ability: Combatant['abilities'][number], burst: boolean): Combatant[] {
    if (ability.area) return areaTargets({ ...this.observationContext(), units: this.visibleCombatants(actor.side) },actor,target,ability,u=>!this.skillTargetReason(actor,ability,u));
    if (!burst) return [target];
    ability = this.battlefield ? gridAbility(ability) : ability;
    const pivot = ability.recipe?.category === 'physical-area' && ability.damageBasis && !isRangedWeapon(skillWeapon(actor, ability)) ? actor : target;
    return [target, ...this.visibleCombatants(actor.side).filter((u) => u.id !== target.id && u.side === target.side && u.status === 'ready' && this.dist(u, pivot) <= 1
      && !this.skillTargetReason(actor, ability, u))
      .sort((a, b) => a.id.localeCompare(b.id))].slice(0, 2);
  }
  /** 使用技能 */
  useAbility(actorId: string, abilityId: string, targetId?: string, opts: { bypassTurn?: boolean } = {}): AbilityUseResult {
    const actor = this.byId(actorId);
    if (!opts.bypassTurn && this.started && !this.isTurnOf(actorId)) {
      throw new Error(`现在不是 ${actor.name} 的回合`);
    }
    if (actor.status !== 'ready') {
      return { ok: false, reason: `${actor.name} 无法行动（${actor.status}）`, resolutions: [], log: '' };
    }
    if (actor.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn))
      return { ok: false, reason: '当前状态无法行动', resolutions: [], log: '' };
    const originalAbility = actor.abilities.find((a) => a.id === abilityId);
    const ability = originalAbility && (this.battlefield ? gridAbility(originalAbility) : originalAbility);
    if (!ability) throw new Error(`${actor.name} 没有技能 ${abilityId}`);
    if (ability.target === 'self' && targetId && targetId !== actor.id) {
      return { ok: false, reason: '该技能只能对自己施放', resolutions: [], log: '' };
    }
    const chosenTarget = ability.target === 'self'
      ? actor
      : targetId
        ? ability.target === 'zone' ? zoneTarget(this.observationContext(),actor,targetId) : this.byId(targetId)
        : ability.target === 'ally' ? actor : undefined;
    if (ability.target === 'zone' && !chosenTarget) return { ok:false, reason:'请指定有效地面位置', resolutions:[], log:'' };
    const usabilityReason = abilityUsabilityReason(actor, ability);
    if (usabilityReason) return { ok: false, reason: usabilityReason, resolutions: [], log: '' };
    const targetReason = chosenTarget ? this.skillTargetReason(actor, ability, chosenTarget) : abilityTargetReason({ actor, ability });
    if (targetReason) return { ok: false, reason: targetReason, resolutions: [], log: '' };
    const summonError = this.summonReason(actor, ability);
    if (summonError) return { ok: false, reason: summonError, resolutions: [], log: '' };
    const summons: Combatant[] = [];
    if (actor.rulesVersion === 'v2' && ability.effects.every((e) => e.op === 'push') && chosenTarget) {
      const effect = ability.effects[0] as Extract<EffectOp, { op: 'push' }>; const pushed = pushPreview(this.observationContext(), actor, chosenTarget, effect);
      if (pushed.reason) return { ok: false, reason: pushed.reason, resolutions: [], log: '' };
    }
    if (actor.rulesVersion === 'v2' && this.battlefield) {
      for (const effect of ability.effects) {
        if (effect.op !== 'summon') continue;
        for (let i = 0; i < effect.count; i++) {
          const id = `${this.seed}:summon:${actor.id}:${ability.definitionId ?? ability.id}:${this.round}:${summons.length}`;
          let unit: Combatant | null | undefined;
          try { unit = conjureSkillUnit(effect.templateId, actor.side, id, 'small', ability.bonuses, this.rules.damageModel) ?? this.summonUnit?.(effect.templateId, actor.side, id); }
          catch { return { ok: false, reason: '召唤模板生成失败，未扣费', resolutions: [], log: '' }; }
          if (!unit) return { ok: false, reason: '召唤模板不可用，未扣费', resolutions: [], log: '' };
          prepareCombatModel(unit, this.rules, summonedMemberLife(unit)); if(this.rules.combatModel)upgradeCombatSkills(unit); prepareResourceModel(unit,this.rules); prepareArmsModel(unit,this.rules);
          unit.id = id; unit.summonerId = actor.id; unit.bornRound = this.round;
          if (conjuredTemplate(effect.templateId)) unit.name = `${actor.name}的${unit.name}`;
          const cell = neighbors(this.battlefield, actor.pos!).find((n) => canOccupy(this.battlefield!, [...this.combatants, ...summons], unit, n));
          if (cell === undefined || this.combatants.some((u) => u.id === unit.id)) return { ok: false, reason: '召唤落点或身份冲突，整次未扣费', resolutions: [], log: '' };
          unit.pos = cell; summons.push(unit);
        }
      }
    }
    if (!opts.bypassTurn && (ability.itemSourceId ? !this.nonSkillActionAvailable(actorId) : this.actedThisTurn.has(actorId) || this.hasteSelected.has(actorId))) {
      return { ok: false, reason: '本回合主行动已使用', resolutions: [], log: '' };
    }
    const hasteAction = !opts.bypassTurn && !!ability.itemSourceId && this.usingHaste(actorId);
    if (this.rules.resolutionVersion === 'v2') revealUnit(this.observationContext(), actor);
    // 扣费与计数
    const cost = abilityCost(actor, ability);
    if (cost) actor.resources[cost.resource] = actor.resourceModel && cost.resource === 'SP' ? resourceRound((actor.resources[cost.resource] ?? 0) - cost.amount) : (actor.resources[cost.resource] ?? 0) - cost.amount;
    spendAbility(actor, ability);

    const castTargets = chosenTarget ? this.abilityDamageTargets(actor, chosenTarget, ability, ability.shape === 'burst' || ability.effects.some((e) => 'shape' in e && e.shape === 'burst')) : [actor];
    const effectTargets = (area: boolean) => area ? castTargets : [chosenTarget ?? actor];
    const resolutions: AttackResolution[] = [];
    let summonsSubmitted = false;
    let heal = 0;
    const logBits: string[] = [`${actor.name} 使用【${ability.name}】`];
    // 技能内部会立即产生阵亡、迫降、任务结束等派生事件；结算完成后把这些事件排在技能本体之后，保持因果顺序。
    const consequentEventStart = this.log.length;

    for (const eff of ability.effects) {
      switch (eff.op) {
        case 'zone': { if (chosenTarget) { placeZone(this.observationContext(),actor,chosenTarget,eff,this.round,ability.id); logBits.push('布置'+ZONE_NAMES[eff.kind]+'，持续'+eff.dur+'轮'); } break; }
        case 'barrier': {
          for (const target of effectTargets(ability.shape === 'burst')) { grantBarrier(target, eff.amount, eff.dur, actor.id, eff.defensePower ?? ability.power); logBits.push(`${target.name} 获得屏障，可吸收${target.barrier?.remaining ?? 0}点伤害，持续${eff.dur}轮`); }
          break;
        }
        case 'damage': {
          const target = chosenTarget;
          if (!target || target.status === 'dead') break;
          if (this.rules.resolutionVersion === 'v2') {
            for (const affected of effectTargets(eff.shape === 'burst')) {
              const result = this.resolveAttackWithEnvironment({ attacker: actor, defender: affected, rng: this.rng, rules: this.rules,
                conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(actor, affected, ability, eff) });
              applyWeaponConditions(affected, result.onHitConditions); resolutions.push(result); logBits.push(result.text); this.checkDeath(affected, actor); this.checkInjury(affected, result.finalDamage);
            }
            break;
          }
          const cast = (def: Combatant, dice: { baseDice: string; apDice?: string }, tagged: boolean) =>
            this.resolveAttackWithEnvironment({
              attacker: actor,
              defender: def,
              rng: this.rng,
              rules: this.rules,
              conditionDefs: this.conditionDefMap(),
              traitRegistry: this.traitRegistry,
              abilityDamage: { ...dice, channel: ability.channel, penetration: ability.penetration },
              ranged: tagged ? true : undefined,
            });
          const res = cast(target, eff, eff.tag === 'ranged');
          resolutions.push(res);
          logBits.push(res.text);
          this.checkDeath(target, actor);
          this.checkInjury(target, res.finalDamage);
          // 覆盖形态：烈焰/爆风向主目标身侧蔓延——溅射主目标 1 格内至多 2 个敌人（威力减半）；
          // 无可蔓延对象时火力集中于主目标（保留第二段全额结算，与单体威力校准一致）
          if (eff.shape === 'burst') {
            const splash = this.combatants
              .filter(
                (c) => c.side !== actor.side && c.id !== target.id && c.status === 'ready' && this.dist(c, target) <= 1
                  &&(this.battlefield?.spatialRulesVersion!==2||Math.abs(unitHeight(this.battlefield,c)-unitHeight(this.battlefield,target))<=1&&unitLineOfSight(this.battlefield,target,c)),
              )
              .sort((a, b) => this.dist(a, target) - this.dist(b, target) || a.hp - b.hp)
              .slice(0, 2);
            if (splash.length > 0) {
              const half = { baseDice: halveDice(eff.baseDice), ...(eff.apDice ? { apDice: halveDice(eff.apDice) } : {}) };
              for (const s of splash) {
                const rs = cast(s, half, eff.tag === 'ranged');
                resolutions.push(rs);
                logBits.push(`（溅射）${rs.text}`);
                this.checkDeath(s, actor);
                this.checkInjury(s, rs.finalDamage);
              }
            } else if (target.status === 'ready' && this.rules.resolutionVersion !== 'v2') {
              const res2 = cast(target, eff, eff.tag === 'ranged');
              resolutions.push(res2);
              logBits.push(`（覆盖）${res2.text}`);
              this.checkDeath(target, actor);
              this.checkInjury(target, res2.finalDamage);
            }
          }
          break;
        }
        case 'heal': {
          const primary = chosenTarget ?? actor;
          for (const target of this.rules.resolutionVersion === 'v2' ? effectTargets(ability.shape === 'burst') : [primary]) {
            if (this.battlefield && target.status === 'dying' && !canOccupy(this.battlefield, this.combatants, target, target.pos!)) {
              logBits.push(`${target.name} 所在格没有起身空间，未恢复`); continue;
            }
            const amount = healingYield(actor,target,eff.amount ?? rollDice(eff.dice!, this.rng).total,!!ability.itemSourceId);
            const restored=applyRecovery(target, amount);heal+=restored;
            if (target.status === 'dying' && target.hp > 0) target.status = 'ready';
            logBits.push('治疗 ' + restored + ' → ' + target.name + ' 生命 ' + (memberHealth(target)-restored) + '→' + memberHealth(target));
          }
          break;
        }
        case 'trait': {
          for (const target of effectTargets(eff.shape === 'burst')) logBits.push(applySkillTrait(actor, target, ability, eff, this.seed + ':' + this.round));
          break;
        }
        case 'condition': {
          const primary = chosenTarget ?? actor;
          if (this.rules.resolutionVersion !== 'v2') { primary.conditions.push({ id: eff.conditionId, dur: eff.dur }); logBits.push(`${primary.name} 获得【${this.conditions.get(eff.conditionId)?.name ?? eff.conditionId}】${eff.dur}回合`); break; }
          for (const target of effectTargets(eff.shape === 'burst')) {
            if (eff.onDamage && !resolutions.some((r) => r.defenderId === target.id && r.finalDamage > 0)) { logBits.push(target.name + ' 未受损，持续伤害未触发'); continue; }
            if (eff.onHit && !resolutions.some((r) => r.defenderId === target.id && r.hit)) { logBits.push(target.name + ' 未被命中，附带控制未触发'); continue; }
            const outcome = prepareCondition(actor, target, eff, this.rng);
            if (outcome.condition && target.id === this.active?.id && isPositiveCondition(eff.conditionId)) outcome.condition.skipNextDecay = true;
            applySkillCondition(target, outcome.condition); logBits.push(outcome.text);
            if (outcome.condition && (this.conditions.get(eff.conditionId)?.skipTurn || this.conditions.get(eff.conditionId)?.preventMove)) this.flightCauses.set(target.id, actor.id);
          }
          break;
        }
        case 'push': {
          if (this.rules.resolutionVersion !== 'v2' || !chosenTarget) break;
          for (const target of effectTargets(ability.shape === 'burst')) {
            if (eff.onHit && !resolutions.some((r) => r.defenderId === target.id && r.hit)) continue;
            const result = applyPush(this.observationContext(), actor, target, eff);
            if(result.fallDamage){this.checkDeath(target,actor);this.checkInjury(target,result.fallDamage);}
            logBits.push(target.name + '：' + (result.reason ?? (eff.direction === 'towards' ? '拉至' : '推至') + result.label));
          }
          break;
        }
        case 'dispel': {
          if (this.rules.resolutionVersion !== 'v2' || !chosenTarget) break;
          for (const target of effectTargets(ability.shape === 'burst')) {
            const chosen = dispelCandidates(target, eff); applyDispel(target, chosen);
            if (chosen.length) this.flightCauses.set(target.id, actor.id);
            logBits.push(target.name + (chosen.length ? ' 解除' + chosen.map((c) => c.name).join('、') : ' 没有可解除的效果'));
          }
          break;
        }
        case 'resource': {
          for (const target of ability.recipe || ability.itemSourceId || ability.equipmentSourceId ? effectTargets(ability.shape === 'burst') : [actor]) {
            const amount = skillResourceChange(target, eff); target.resources[eff.resource] = (target.resources[eff.resource] ?? 0) + amount;
            logBits.push(target.name + ' ' + eff.resource + (amount >= 0 ? '+' : '') + amount);
          }
          break;
        }
        case 'morale': {
          const primary = chosenTarget ?? actor;
          const targets = this.rules.resolutionVersion === 'v2' ? effectTargets(ability.shape === 'burst') : [primary];
          for (const target of targets) if (target.morale !== undefined || target.rulesVersion === 'v2') { changeMorale(target, eff.amount); logBits.push(`${target.name} 士气${eff.amount >= 0 ? '+' : ''}${eff.amount} → ${moraleProfile(this.observationContext(), target, this.traitRegistry).effective}`); }
          break;
        }
        case 'summon': {
          if (actor.rulesVersion === 'v2') {
            if (!summonsSubmitted) { for(const unit of summons)unit.nonLethal=this.nonLethal; this.combatants.push(...summons); }
            summonsSubmitted = true;
            logBits.push(`调入预备 ${summons.length} 个单位，下轮行动，不进入永久库存`);
            break;
          }
          // 召唤落地：面板注入的 summonUnit 回调生成单位并加入战斗。
          // 模板 id → 真实单位；生成单位带行动轮次与阵位，立即参战。
          const tmpl = eff.templateId;
          if (this.summonUnit) {
            const spawned = this.summonUnit(tmpl, actor.side);
            if (spawned) {
              const count = Math.max(1, eff.count || 1);
              for (let n = 0; n < count; n++) {
                const u = n === 0 ? spawned : this.summonUnit(tmpl, actor.side);
                if (!u) break;
                // 召唤单位是「临场友军」：补一维阵位（贴召唤者）、进先攻轮转、状态就绪
                if (u.pos === undefined) u.pos = Math.max(0, Math.min(5, (actor.pos ?? 2) + 1));
                u.status = 'ready';
                u.nonLethal=this.nonLethal; this.combatants.push(u);
                // 给它插入先攻队列：位置放在当前行动者之后（本轮即可行动）
                const idx = this.turnIndex + 1;
                this.turnOrder.splice(Math.min(idx, this.turnOrder.length), 0, u.id);
                logBits.push(`【召唤】${u.name} 降临战场（${u.hp}/${u.base.hpMax} HP，阵位${u.pos}）`);
              }
            } else {
              logBits.push(`（召唤失败：模板 ${tmpl} 无可用单位）`);
            }
          } else {
            logBits.push(`（召唤请求：${tmpl}×${eff.count}）`);
          }
          break;
        }
      }
    }

    const usedWeapon = ability.weaponUse && chosenTarget ? skillWeapon(actor, ability, this.dist(actor, chosenTarget)) : undefined;
    if (usedWeapon && isRangedWeapon(usedWeapon) && weaponReloadTurns(usedWeapon)) this.reloadCd.set(weaponReloadKey(actor, usedWeapon), weaponReloadTurns(usedWeapon) + 1);
    this.settleAreaEffects(); this.resolveFlightStates(); this.flightCauses.clear(); this.checkGridObjective(false);
    const consequentEvents = this.log.splice(consequentEventStart);
    const text = logBits.join('\n');
    this.recordEvent({ round: this.round, kind: 'ability', participants: [actor.id, ...(chosenTarget ? [chosenTarget.id] : []), ...resolutions.map((r) => r.defenderId)], text, resolution: resolutions[0], resolutions });
    this.log.push(...consequentEvents);
    if ((this.battlefield || actor.resourceModel) && actor.rulesVersion === 'v2' && !opts.bypassTurn) addTacticalEffort(actor, skillExertion(actor, ability));
    if (!opts.bypassTurn) { if (ability.itemSourceId) this.spendAction(actorId, hasteAction); else this.actedThisTurn.add(actorId); }
    return { ok: true, resolutions, heal, log: text };
  }

  /**
   * 结束当前回合：结算行动者的回合末效果，推进到下一行动者；轮空即新回合。
   * 时序约定：DOT 与死亡判定在单位回合开始；状态时长/冷却/再生在其回合结束递减；
   * 被眩晕跳过的单位视作"回合已过"，同样结算开始与结束效果。
   */
  endTurn(): void {
    if (!this.started) throw new Error('战斗尚未开始');
    if (this.rules.resourceModel && this.isOver()) return;
    const ended = this.active;
    if (ended && (ended.status === 'ready' || ended.status === 'routing')) this.settleUnit(ended);
    this.captureFeedback();
    this.feedback?.finishActivation();

    this.turnIndex += 1;
    this.advanceToNextActor();
    while (this.turnIndex >= this.turnOrder.length && !this.isOver()) {
      this.settleAreaEffects(true); this.checkGridObjective(true);
      for (const unit of this.combatants) { expireTraitSources(unit, 'rounds'); decayBarrier(unit); }
      this.resolveFlightStates();
      this.captureFeedback();
      if (this.objectiveWinner) return;
      this.round += 1;
      for (const unit of this.combatants) if (unit.bornRound !== undefined && unit.bornRound < this.round && !this.turnOrder.includes(unit.id)) this.turnOrder.push(unit.id);
      this.recordEvent({ round: this.round, kind: 'round', text: `—— 第 ${this.round} 回合 ——` });
      this.turnIndex = 0;
      this.advanceToNextActor();
    }
  }

  /**
   * 自动行动（面板「自动回合」用）：utility 评分择优，替代旧的固定优先级。
   * 候选与估值：
   *   - 进攻技能/普攻：期望伤害（吃目标护甲DR估计）×命中率估计，
   *     加斩杀线（期望≥目标HP）、集火残血、威胁偏置；技能扣资源机会成本；
   *   - 治疗技能：友方血量缺口×0.9，濒死急救大额加成——修复「奶妈永不奶」；
   *   - 开场增益/敌方减益/召唤：小额基础分，自然排在进攻之下；
   *   同分 ±0.5 抖动防死循环。全部不可行时退回移动启发（风筝/逼近/待命）。
   * 濒死敌在无 ready 敌时会被补刀——「不围殴濒死」是演出偏好，但不该让战斗僵持。
   */
  autoAction(unitId: string): void {
    const current = this.byId(unitId);
    if (this.isTurnOf(unitId) && current.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn)) { this.recordEvent({ round: this.round, kind: 'condition', participants: [unitId], text: current.name + ' 眩晕，跳过回合' }); this.endTurn(); return; }
    if (this.battlefield) { try { this.autoGridAction(unitId); } finally { this.observationMemo = undefined; endPreviewScope(); } return; }
    const u = this.byId(unitId);
    if (u.status !== 'ready' || !this.isTurnOf(unitId)) return;
    // 索敌优先 ready；只剩濒死敌时列入补刀目标
    const readyFoes = this.combatants.filter((c) => c.side !== u.side && c.status === 'ready');
    const foes = readyFoes.length
      ? readyFoes
      : this.combatants.filter((c) => c.side !== u.side && c.status === 'dying');

    if (foes.length) {
      if (this.planAutoAction(u, foes)) {
        if (this.hasteAvailable(unitId) && !this.isOver()) this.planAutoAction(u, foes.filter(f => ['ready', 'dying'].includes(f.status)));
        this.endTurn();
        return;
      }
      // 无可行攻击动作 → 移动启发：射手被贴身且无副武器 → 后撤风筝；射程外 → 前进逼近
      const rangedCap = isRangedCapable(u);
      const range = weaponRangeSpec(u.weapon, rangedCap);
      const nearest = [...foes].sort((a, b) => this.dist(u, a) - this.dist(u, b))[0]!;
      const dn = this.dist(u, nearest);
      const wantDir: 'advance' | 'withdraw' | undefined =
        rangedCap && dn < range.min && !u.sidearm ? 'withdraw' : dn > range.max ? 'advance' : undefined;
      if (wantDir) {
        try {
          this.move(unitId, wantDir);
          // 移动额度与主行动独立：移动后重新查询一次，可射击/施法则在同回合完成。
          if (u.status === 'ready' && !this.actedThisTurn.has(unitId)) this.planAutoAction(u, foes);
        } catch {
          /* 退无可退/顶到边缘则原地待命 */
        }
      }
    }
    this.endTurn();
  }

  /** utility 评分：构建候选动作列表，按分择优尝试执行；返回是否执行了任一动作 */
  private autoGridAction(unitId: string, reconsidered = false, failedAbilities = new Set<string>()): void {
    const unit = this.byId(unitId); const field = this.battlefield!;
    const actionBefore = `${this.actedThisTurn.has(unitId)}:${this.hasteSpent.get(unitId)}`;
    if (!this.isTurnOf(unitId) || unit.status !== 'ready' || this.isOver()) return;
    if (!isAirborne(unit) && !this.flightReason(unitId, true)) {
      // 地面绕行明显更贵时先升空；歼灭战以最近已知敌人的邻格为目标（扑击前保持机动优势）
      const known = this.visibleCombatants(unit.side);
      const nearestFoe = field.objective.kind === 'annihilation'
        ? known.filter((u) => u.side !== unit.side && ['ready', 'routing'].includes(u.status))
            .sort((a, b) => gridDistance(field, unit.pos!, a.pos!) - gridDistance(field, unit.pos!, b.pos!) || a.id.localeCompare(b.id))[0]
        : undefined;
      const goalCells = field.objective.kind === 'annihilation' ? (nearestFoe ? neighbors(field, nearestFoe.pos!) : []) : [field.objective.cell];
      if (goalCells.length && !goalCells.includes(unit.pos!)) {
        const air = { ...unit, airborne: true };
        const cheapest = (actor: Combatant) => Math.min(...goalCells.map((g) => findGridPath(field, unit.pos!, g, (n) => canOccupy(field, known, actor, n), (n, from) => movementStepCost(field, n, actor, this.fieldTags, from))?.cost ?? Infinity));
        if (!this.flightRisks(unitId,true).length && cheapest(air) + 1 < cheapest(unit)) this.changeFlight(unitId, true);
      }
      if (unit.status !== 'ready') { if (!this.isOver()) this.endTurn(); return; }
    }
    // Read-only evaluation: observations and preview samples are reused until an action is chosen.
    this.observationMemo = new Map(); beginPreviewScope();
    const plans: { score: number; path: GridPath; offensive?: boolean; selfDefenseScore?: number; targetId?: string; abilityId?: string; weaponMode?: SmallAttackOpts['weaponMode']; cell?: number; structureMode?: string; kind: 'structure' | 'gate' | 'climb' | 'weapon' | 'charge' | 'ability' | 'brace' | 'hold' | 'land' | 'reload' | 'haste-move' | 'haste-flight' }[] = [];
    const knownUnits = this.visibleCombatants(unit.side);
    const objective = field.objective;
    const escorted = objective.kind === 'escape' && objective.unitId !== unitId
      ? knownUnits.find((u) => u.id === objective.unitId && u.side === unit.side) : undefined;
    const escortPath = escorted ? findGridPath(field, escorted.pos!, objective.cell,
      (n) => canOccupy(field, knownUnits.filter((u) => u.id !== unitId), escorted, n), (n, from) => movementStepCost(field, n, escorted, this.fieldTags, from)) : undefined;
    const escortCorridor = new Set(escorted ? [objective.cell, ...(escortPath?.cells.slice(1) ?? [])] : []);
    const foes = knownUnits.filter((u) => u.side !== unit.side && ['ready', 'routing'].includes(u.status));
    const hasFear = foes.some((u) => activeTraitIds(u).some((id) => this.traitRegistry.get(id)?.effects.some((e) => e.kind === 'moraleAura' && e.scope === 'enemySide')));
    const rangedRole = isRangedWeapon(unit.weapon) && gridWeaponRange(unit.weapon, true, this.rules.armsModel) > 2;
    const meleeThreats = foes.filter((foe) => foe.status === 'ready' && meleeWeapon(foe) && (meleeContact(field, unit, foe) || isAirborne(foe)));
    const safeDistance = Math.min(gridWeaponRange(unit.weapon, true, this.rules.armsModel), meleeThreats.length
      ? Math.max(4, ...meleeThreats.map((foe) => movementPoints(foe, this.fieldTags) + 2)) : gridWeaponRange(unit.weapon, true, this.rules.armsModel));
    const allowed = (cell: number) => canOccupy(field, knownUnits, unit, cell);
    const searchCell = objective.kind === 'annihilation' && !foes.length ? this.searchDestination(unit, knownUnits) : unit.pos!;
    const order = regionalOrder(field, unit, knownUnits, this.commanderProfiles[unit.side === 'ally' ? 'ally' : 'enemy']);
    if (order && field.city?.defender === unit.side && objective.kind === 'control'
      && this.controlRounds[unit.side === 'ally' ? 'enemy' : 'ally'] > 0) {
      order.goals = objective.cells ?? [objective.cell]; order.role = 'core'; order.phase = 'core-threat';
    }
    const elevatedActor: Combatant = { ...unit, elevation: 1 };
    const firingPositions = rangedRole && unit.side === field.city?.defender ? field.tiles.flatMap((_,pos) => {
      if (!intactStructure(field,pos)?.top || !canOccupy(field,knownUnits,elevatedActor,pos)) return [];
      const actor={...elevatedActor,pos};
      const hasFire = foes.length ? foes.some(target=>!this.weaponContext(actor,target,{weaponMode:'primary'}).reason)
        : field.tiles.some((_,cell)=>!field.city!.inside.includes(cell)&&!field.city!.frontline.includes(cell)&&!groundBlocked(field,cell)
          && gridDistance(field,pos,cell)<=gridWeaponRange(actor.weapon, true, this.rules.armsModel)&&unitLineOfSight(field,actor,{...actor,pos:cell,elevation:undefined,side:unit.side==='ally'?'enemy':'ally'}));
      return hasFire?[pos]:[];
    }) : [];
    const wallRoutes = gridCostsToGoals(field,firingPositions,p=>canOccupy(field,knownUnits,elevatedActor,p),(p,from)=>movementStepCost(field,p,elevatedActor,this.fieldTags,from));
    const climbApproaches = isElevated(unit) ? firingPositions : [...wallRoutes.keys()].flatMap(p=>neighbors(field,p).filter(n=>canOccupy(field,knownUnits,unit,n)&&!this.climbReason(unitId,p,n)));
    const goals = climbApproaches.length && !order?.phase.includes('threat') ? climbApproaches : order ? order.goals : objective.kind !== 'annihilation' ? [objective.cell]
      : foes.length ? field.tiles.flatMap((_, cell) => {
        if (!allowed(cell)) return [];
        const actor = { ...unit, pos: cell };
        return foes.some(target => rangedRole
          ? [actor.weapon, actor.sidearm].some(weapon => isRangedWeapon(weapon) && !weaponTargetReason({ actor, target,
              weapon: gridWeapon(weapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel), ranged: true, distance: this.dist(actor, target), field }) && !this.sightReason(actor, target, weapon?.indirect)
            && !rangedScreen(actor, target, weapon, knownUnits, { mode: 'small', width: field.width, battlefield: field }, this.conditionDefMap()))
          : this.dist(actor, target) <= gridWeaponRange(meleeWeapon(actor), this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel)
            && !this.sightReason(actor, target) && (meleeContact(field, actor, target) || isAirborne(actor))) ? [cell] : [];
      }) : [searchCell];
    const routeCosts = gridCostsToGoals(field, goals, allowed, (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from));
    const positionScore = (path: GridPath) => {
      const cell = path.cells.at(-1)!;
      const destinationDistance = order ? Math.min(...goals.map(p => gridDistance(field, cell, p))) : objective.kind === 'annihilation'
        ? foes.length ? Math.min(...foes.map((foe) => gridDistance(field, cell, foe.pos!))) : gridDistance(field, cell, searchCell)
        : gridDistance(field, cell, objective.cell);
      const nearest = foes.length ? Math.min(...foes.map((foe) => gridDistance(field, cell, foe.pos!))) : Infinity;
      // 远程保持有效射程；近战逼近、占领与护送仍以各自目标为准。
      const route = routeCosts.get(cell);
      const cohesion = field.layerVersion ? (this.commanderProfiles[unit.side === 'ally' ? 'ally' : 'enemy']?.preferences?.cohesion ?? 2) : 2;
      const allies = knownUnits.filter(u => u.side === unit.side && u.id !== unitId && u.status === 'ready' && sameLayer(unit, u));
      const coordination = field.layerVersion && allies.length ? -(cohesion - 2) * .35 * Math.min(6, Math.max(0, Math.min(...allies.map(u => gridDistance(field, cell, u.pos!))) - 2))
        - Math.max(0, cohesion - 1) * .2 * allies.filter(u => u.pos === cell).length : 0;
      const spacing = rangedRole && foes.length && objective.kind === 'annihilation'
        ? -Math.abs(nearest - safeDistance) * 1.5 - (route ?? destinationDistance) * 2
        : -(route ?? destinationDistance) * 1.5;
      const exposure = rangedRole ? meleeThreats.reduce((sum, foe) => sum + Math.max(0, movementPoints(foe, this.fieldTags) + 2 - gridDistance(field, cell, foe.pos!)) * 2, 0) : 0;
      // Old frozen maps/replays keep their previous positional tie-breaker.
      return spacing - exposure + coordination + (field.layerVersion || field.generation?.version === 4 ? terrainTacticalValue(field, cell, unit, foes) : field.tiles[cell] === 'cover' ? .5 : 0)
        - path.cost * 0.1 - (field.layerVersion ? meleeThreats.filter(f => gridDistance(field, unit.pos!, f.pos!) <= 1 && gridDistance(field, cell, f.pos!) > 1).length : this.pathPreview(unitId, cell).risks.length) * 2
        - (hasFear ? moraleRisk({ ...this.observationContext(), units: knownUnits.map((u) => u.id === unit.id ? { ...unit, pos: cell } : u) }, { ...unit, pos: cell }, this.rules.morale.breakAt, this.traitRegistry).breakChance * 6 : 0);
    };
    const incomingReduction = (before: Combatant, after: Combatant) => {
      const threats = foes.filter((f) => !this.sightReason(before, f))
        .sort((a, b) => this.dist(before, a) - this.dist(before, b) || a.id.localeCompare(b.id)).slice(0, 3);
      let reduction = 0;
      for (const foe of threats) {
        let best = 0;
        for (const charge of [false, true]) {
          const context = this.weaponContext(foe, before, { charge }); if (context.reason) continue;
          const path = charge ? this.chargePath(foe, before) : undefined;
          const attacker = path ? { ...foe, pos: path.cells.at(-1)! } : foe;
          const params = { attacker, defender: before, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ranged: context.ranged, charge, weaponOverride: context.weapon, ...this.attackModifiers(attacker, before, context, { charge }) };
          best = Math.max(best, this.previewAttackWithEnvironment(params).expectedDamage - this.previewAttackWithEnvironment({ ...params, defender: after }).expectedDamage);
        }
        reduction += best;
      }
      return reduction;
    };
    const incoming = (actor: Combatant): number => foes.reduce((total,foe) => {
      const context = this.weaponContext(foe,actor);
      if (context.reason) return total;
      return total + Math.min(memberHealth(actor),this.previewAttackWithEnvironment({attacker:foe,defender:actor,rules:this.rules,conditionDefs:this.conditionDefMap(),traitRegistry:this.traitRegistry,
        weaponOverride:context.weapon,ranged:context.ranged,...this.attackModifiers(foe,actor,context)}).expectedDamage);
    },0);
    const arrivals = new Map<GridPath, {actor:Combatant; loss:number; survival:number}>();
    const arrivalAfterReactions = (path: GridPath) => {
      const cached=arrivals.get(path);if(cached)return cached;
      if (!path.cost || !foes.length) return {actor:{...cloneData(unit),pos:path.cells.at(-1)!},loss:0,survival:1};
      const results: Combatant[]=[];let loss=0,alive=0;
      for(let sample=0;sample<8;sample++) {
        const copy=cloneData(unit), spent=new Set(this.reactionSpent),rng=new SeededRng('route-risk:'+sample);
        for(const cell of path.cells.slice(1)) {
          const previous=copy.pos!;copy.pos=cell;delete copy.tacticalPose;
          for(const foe of foes) {
            if(copy.hp<=0||spent.has(foe.id)||foe.status!=='ready'||foe.suppression||foe.conditions.some(c=>c.dur>0&&(this.conditions.get(c.id)?.skipTurn||this.conditions.get(c.id)?.preventAttack&&meleeWeapon(foe)?.recipe?.mechanism!=='natural')))continue;
            const weapon=meleeWeapon(foe),ridingAway=mountedShooting(copy)&&(Math.floor(cell/field.width)-Math.floor(previous/field.width))*(copy.side==='enemy'?-1:1)>0;
            const opportunity=!ridingAway&&weapon&&meleeContact(field,foe,{...copy,pos:previous})&&gridDistance(field,foe.pos!,previous)===1&&(gridDistance(field,foe.pos!,cell)>1||!meleeContact(field,foe,copy));
            const watching=this.overwatch.has(foe.id)&&!this.weaponContext(foe,copy).reason;
            if(!opportunity&&!watching)continue;
            spent.add(foe.id);
            const context=this.weaponContext(foe,copy,{weaponMode:opportunity?weapon===foe.sidearm?'sidearm':'primary':'auto'});
            resolveAttack(this.environmentContext({attacker:cloneData(foe),defender:copy,rng,rules:this.rules,conditionDefs:this.conditionDefMap(),traitRegistry:this.traitRegistry,
              weaponOverride:opportunity?weapon:context.weapon,ranged:!opportunity&&context.ranged,actionDamageScale:!opportunity?this.hasteOverwatch.get(foe.id)??1:1,...this.attackModifiers(foe,copy,context)}));
          }
          if(copy.hp<=0)break;
        }
        copy.pos=path.cells.at(-1)!;loss+=memberHealth(unit)-memberHealth(copy);alive+=Number(copy.hp>0);results.push(copy);
      }
      results.sort((a,b)=>memberHealth(a)-memberHealth(b));
      const result={actor:results[Math.floor(results.length/2)]!,loss:loss/8,survival:alive/8};arrivals.set(path,result);return result;
    };
    const supportingAttacks = new Map<string, number>();
    const supportingAttackValue = (ally: Combatant) => {
      if (!supportingAttacks.has(ally.id)) {
        let value = 0;
        for (const target of foes) for (const weaponMode of ['primary', 'sidearm'] as const) {
          const context = this.weaponContext(ally, target, { weaponMode }); if (context.reason) continue;
          const preview = this.previewAttackWithEnvironment({ attacker: ally, defender: target, rules: this.rules,
            conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon,
            ranged: context.ranged, ...this.attackModifiers(ally, target, context) });
          value = Math.max(value, Math.min(memberHealth(target), preview.expectedDamage));
        }
        supportingAttacks.set(ally.id, value);
      }
      return supportingAttacks.get(ally.id)!;
    };
    const shieldProtectionValue = (guard: Combatant) => {
      if (!guard.shield) return 0;
      const before = knownUnits.map(other => other.id === unitId ? { ...guard, tacticalPose: undefined } : other);
      const after = knownUnits.map(other => other.id === unitId ? guard : other);
      let value = 0, supportingDamage = 0;
      for (const foe of foes) {
        let protectedDamage = 0;
        for (const ally of knownUnits.filter(other => other.side === unit.side && other.id !== unitId && other.status === 'ready')) {
          for (const weaponMode of ['primary', 'sidearm'] as const) {
            const context = this.weaponContext(foe, ally, { weaponMode }, before);
            if (context.reason || !context.ranged || rangedScreen(foe, ally, context.weapon, after, { mode: 'small', width: field.width, battlefield: field }, this.conditionDefMap())?.id !== unitId) continue;
            supportingDamage = Math.max(supportingDamage, supportingAttackValue(ally));
            protectedDamage = Math.max(protectedDamage, this.previewAttackWithEnvironment({ attacker: foe, defender: ally, rules: this.rules,
              conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon, ranged: true, ...this.attackModifiers(foe, ally, context) }).expectedDamage);
          }
        }
        value += protectedDamage;
      }
      // 掩护的价值受队友可兑现的火力限制，不能把多名敌人的潜在伤害全算成架盾收益。
      return Math.min(value * 0.5, supportingDamage * 0.35);
    };
    let restValue = 0;
    if (unit.resourceModel && !this.actedThisTurn.has(unitId) && !this.movedThisTurn.has(unitId) && this.hasteSpent.get(unitId) !== this.round) {
      const context = { ...this.observationContext(), units: knownUnits };
      if (!this.reactionSpent.has(unitId)) restValue = tacticalRestValue(context, unit);
    }
    const reachable = this.reachableCells(unitId);
    // Stage 1: cheap regional/position scoring; stage 2: costly damage/skill previews at bounded locations.
    const scored = field.layerVersion ? new Map(reachable.map(path => [path, positionScore(path)])) : undefined;
    const shortlist = field.layerVersion ? [...reachable].sort((a, b) => scored!.get(b)! - scored!.get(a)! || a.cost - b.cost).slice(0, 12) : reachable;
    if (field.layerVersion && !shortlist.some(p => p.cost === 0)) shortlist.push(reachable.find(p => p.cost === 0)!);
    for (const path of shortlist.filter(Boolean)) {
      const projected = arrivalAfterReactions(path), actor = projected.actor;
      if (actor.hp <= 0 || projected.survival < .5) continue;
      const skillContext = { ...this.observationContext(), units: knownUnits.map(u => u.id === actor.id ? actor : u) };
      // 协同单位在通路旁支援，不用自身占位堵住己方护送对象；敌方仍可拦截。
      if (escortCorridor.has(actor.pos!)) continue;
      const baseScore = (scored?.get(path) ?? positionScore(path)) - projected.loss * 1.5 - (1-projected.survival)*memberHealth(unit) - incoming(actor)*.3;
      if (field.layerVersion && this.nonSkillActionAvailable(unitId)) {
        const structural = [...new Set([...(order?.breach === undefined ? [] : [order.breach]), ...neighbors(field, actor.pos!).filter(p => {
          const structure = intactStructure(field, p);
          return !!structure && structure.kind !== 'bridge' && structure.owner !== unit.side
            && (structure.kind === 'building' || !field.city || unit.side !== field.city.defender);
        })])];
        for (const cell of structural) {
          const structure = intactStructure(field, cell); if (!structure) continue;
          const assigned = cell === order?.breach;
          const enemyCover = ['cover', 'fortification'].includes(structure.kind) && foes.some(f => f.pos === cell && !isAirborne(f));
          const beyond = Math.min(...neighbors(field, cell).filter(p => p !== actor.pos && allowed(p)).map(p => routeCosts.get(p) ?? Infinity));
          const routeGain = (routeCosts.get(actor.pos!) ?? Infinity) - (beyond + Math.min(2, this.movementBudget(unitId)));
          if (!assigned && !enemyCover && !(routeGain > 2)) continue;
          const modes = ['primary', ...(unit.sidearm ? ['sidearm'] : []), ...unit.abilities.filter(a => a.effects.some(e => e.op === 'damage')).map(a => 'ability:' + a.id)];
          for (const mode of modes) {
            const preview = this.structurePreview(unitId, cell, mode, actor.pos);
            if (preview.reason || preview.damage <= 0) continue;
            // A shortcut must repay its attack actions; do not demolish random city blocks.
            if (!assigned && !enemyCover && routeGain <= (preview.actions ?? Infinity) * this.movementBudget(unitId)) continue;
            const priority = assigned ? 18 : 3;
            const coefficient = 1 + ((this.commanderProfiles[unit.side === 'ally' ? 'ally' : 'enemy']?.preferences?.breach ?? 2) - 2) * .15;
            const progress = Math.min(1, preview.damage / structure.hpMax);
            plans.push({ kind: 'structure', path, cell, structureMode: mode, offensive: true, score: baseScore + coefficient * (priority + progress * 32 + (preview.damage >= structure.hp ? 12 : 0)) - (mode.startsWith('ability:') ? tacticalSkillCost(skillContext, actor, unit.abilities.find(a => a.id === mode.slice(8))!) : 0) });
          }
        }
        if (path.cost + this.climbMovementCost(unitId) <= this.movementLeft(unitId)) for (const cell of neighbors(field, actor.pos!)) {
          if (this.climbReason(unitId, cell, actor.pos)) continue;
          const arrival: Combatant = { ...actor, pos: cell, elevation: isElevated(actor) ? undefined : 1 };
          const goalDistance = Math.min(...goals.map(p => gridDistance(field, cell, p)));
          const currentDistance = Math.min(...goals.map(p => gridDistance(field, actor.pos!, p)));
          const assault = unit.side !== field.city?.defender && !isElevated(unit) && cell === order?.breach;
          const fireRoute = !isElevated(unit) && wallRoutes.has(cell);
          if (fireRoute || assault || goalDistance < currentDistance || isElevated(unit) && !foes.some(f => unitLineOfSight(field, unit, f))) plans.push({ kind: 'climb', path, cell, score: baseScore + (fireRoute ? 16-Math.min(8,wallRoutes.get(cell)!) : assault ? 32 : 8) + currentDistance - goalDistance });
        }
        if (path.cost === 0) for (const cell of neighbors(field, actor.pos!)) {
          const door = intactStructure(field, cell);
          if (!door || this.gateReason(unitId, cell)) continue;
          if (door.gateState === 'closed' && unit.side !== field.city?.defender) plans.push({ kind: 'gate', path, cell, score: baseScore + 15 });
          else if (door.gateState === 'open' && unit.side === field.city?.defender && !knownUnits.some(u => u.side === unit.side && !field.city?.inside.includes(u.pos!) && gridDistance(field, u.pos!, cell) <= 2)) plans.push({ kind: 'gate', path, cell, score: baseScore + 12 });
        }
      }
      if (isAirborne(unit) && path.cost + 1 <= this.movementLeft(unitId) && canOccupy(field, this.visibleCombatants(unit.side), { ...actor, airborne: false }, actor.pos!)) plans.push({ score: baseScore + (objective.kind !== 'annihilation' && actor.pos === field.objective.cell ? 6 : 0.1), path, kind: 'land' });
      plans.push({ score: baseScore + (path.cost === 0 ? restValue : 0) + (foes.length && path.cost === 0 && canReconceal(this.observationContext(), unit) ? 4 : 0), path, kind: 'hold' });
      if (!this.nonSkillActionAvailable(unitId)) continue;
      if (!this.braceReason(unitId)) {
        const threats = foes.filter((f) => !this.sightReason(actor, f)).sort((a, b) => this.dist(actor, a) - this.dist(actor, b) || a.id.localeCompare(b.id)).slice(0, 3);
        const braced = { ...actor, tacticalPose: bracePose(actor, threats[0], 'small', field.width) };
        const avoided = incomingReduction(actor, braced);
        const protectedDamage = shieldProtectionValue(braced);
        if (avoided > 0 || protectedDamage > 0) plans.push({ score: baseScore + avoided * 0.3 + protectedDamage, selfDefenseScore: avoided * 0.3, path, kind: 'brace' });
      }
      for (const target of foes) for (const weaponMode of (actor.sidearm ? ['primary', 'sidearm'] : ['primary']) as ('primary' | 'sidearm')[]) {
        const context = this.weaponContext(actor, target, { weaponMode });
        if (context.reason || context.landing && path.cost + 1 > this.movementLeft(unitId)) continue;
        const arrival = context.landing ? { ...actor, airborne: false } : actor;
        const mods = this.attackModifiers(arrival, target, context);
        if (path.cost > 0 && context.ranged && !this.movedThisTurn.has(unitId) && !steadyMovingShot(actor, context.weapon)) mods.extraMods.push({ source: 'stance', name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
        const preview = this.previewAttackWithEnvironment({ attacker: arrival, defender: target, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon, ranged: context.ranged, actionDamageScale: this.usingHaste(unitId) ? hasteAttackScale(unit) : 1, ...mods });
        // 预览已经包含整轮速射；再次乘段数会高估自动武器并压低技能的选择机会。
        const volleyDamage = Math.min(memberHealth(target), preview.expectedDamage);
        plans.push({ score: baseScore + volleyDamage + (preview.conditionValue ?? 0) + (volleyDamage >= memberHealth(target) ? 4 : 0), offensive: volleyDamage + (preview.conditionValue ?? 0) > 0, path, targetId: target.id, weaponMode, kind: 'weapon' });
      }
      for (const ability of actor.abilities) {
        if (!ability.itemSourceId && (this.actedThisTurn.has(unitId) || this.hasteSelected.has(unitId))) continue;
        if (failedAbilities.has(ability.id) || abilityUsabilityReason(actor, ability) || this.summonReason(actor, ability)) continue;
        const candidates = ability.target === 'zone' ? this.visibleCombatants(actor.side).filter(u=>u.status==='ready') : ability.target === 'self' ? [actor] : ability.target === 'enemy' ? foes : this.combatants.filter((target) => target.side === actor.side
          && (['ready', 'routing'].includes(target.status) || target.status === 'dying' && ability.effects.some((e) => e.op === 'heal')));
        for (const target of candidates) {
          if (this.skillTargetReason(actor, ability, target)) continue;
          let benefit = 0, expectedDamage = 0;
          const damageForControl = ability.effects.find((e) => e.op === 'damage');
          const controlPreviews = new Map<string, ReturnType<SmallBattle['previewAttackWithEnvironment']>>();
          const controlChance = (affected: Combatant, needsDamage: boolean) => {
            if (!damageForControl) return 1;
            if (!controlPreviews.has(affected.id)) controlPreviews.set(affected.id, this.previewAttackWithEnvironment({ attacker: actor, defender: affected, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(actor, affected, ability, damageForControl, path.cost > 0) }));
            const preview = controlPreviews.get(affected.id)!;
            return needsDamage ? preview.damageChance ?? (preview.expectedDamage > 0 ? preview.hitChance : 0) : preview.anyHitChance ?? preview.hitChance;
          };
          for (const effect of ability.effects) {
            if (effect.op === 'damage') for (const affected of this.abilityDamageTargets(actor, target, ability, effect.shape === 'burst')) {
              const preview = this.previewAttackWithEnvironment({ attacker: actor, defender: affected, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(actor, affected, ability, effect, path.cost > 0) });
              benefit += preview.expectedDamage + (preview.conditionValue ?? 0);
              if (affected.side !== actor.side) expectedDamage += preview.expectedDamage;
            }
            if (effect.op === 'heal') for (const affected of this.abilityDamageTargets(actor, target, ability, ability.shape === 'burst')) benefit += Math.min(recoveryCapacity(affected), healingYield(actor,affected,effect.amount ?? diceAvg(effect.dice!),!!ability.itemSourceId));
            if (effect.op === 'summon') benefit += summonValue(skillContext, actor, ability, effect);
            if (effect.op === 'zone' || effect.op === 'barrier' || effect.op === 'push' || effect.op === 'dispel' || effect.op === 'trait') for (const affected of this.abilityDamageTargets(actor, target, ability, ability.shape === 'burst')) benefit += skillEffectValue(skillContext, actor, affected, { ...ability, effects: [effect] }, controlChance(affected, false));
            if (effect.op === 'morale') for (const affected of this.abilityDamageTargets(actor, target, ability, ability.shape === 'burst')) benefit += moraleChangePreview({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, affected, effect.amount, this.rules.morale.breakAt, this.traitRegistry, ability.effects.flatMap((e) => e.op === 'condition' ? [{ id: e.conditionId, dur: e.dur }] : [])).value * (affected.side === actor.side ? 1 : -1);
          }
          for (const affected of this.abilityDamageTargets(actor, target, ability, ability.shape === 'burst')) benefit += skillEffectValue(skillContext, actor, affected, { ...ability, effects: ability.effects.filter(e => e.op === 'condition') }, controlChance(affected, false), controlChance(affected, true)) * Math.max(0, 1 - (controlPreviews.get(affected.id)?.expectedDamage ?? 0) / Math.max(1, memberHealth(affected)));
          const landing = this.abilityFlightPreview(actor, target, ability);
          if (landing) benefit += Math.min(target.hp, landing.fallDamage) * (landing.fallChance ?? 1);
          for (const affected of ability.recipe || ability.itemSourceId || ability.equipmentSourceId ? this.abilityDamageTargets(actor, target, ability, ability.shape === 'burst') : [actor]) benefit += skillEffectValue(skillContext, actor, affected, { ...ability, effects: ability.effects.filter(e => e.op === 'resource') });
          const cost = tacticalSkillCost(skillContext, actor, ability, expectedDamage);
          if (benefit > cost) plans.push({ score: baseScore + benefit - cost, offensive: target.side !== actor.side, path, targetId: target.id, abilityId: ability.id, kind: 'ability' });
        }
      }
    }
    if (this.nonSkillActionAvailable(unitId)) for (const target of foes) {
      const context = this.weaponContext(unit, target, { charge: true });
      const path = context.reason ? undefined : this.chargePath(unit, target);
      if (!path) continue;
      const projected=arrivalAfterReactions(path);
      if(projected.actor.hp<=0||projected.survival<.5)continue;
      const arrival = { ...projected.actor, pos: path.cells.at(-1)!, ...(context.landing ? { airborne: false } : {}) };
      if (escortCorridor.has(arrival.pos)) continue;
      const preview = this.previewAttackWithEnvironment({ attacker: arrival, defender: target, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry,
        weaponOverride: context.weapon, ranged: false, charge: true, actionDamageScale: this.usingHaste(unitId) ? hasteAttackScale(unit) : 1, ...this.attackModifiers(arrival, target, context, { charge: true }) });
      plans.push({ score: positionScore(path) - projected.loss*1.5 - (1-projected.survival)*memberHealth(unit) - incoming(arrival)*.3 + Math.min(memberHealth(target), preview.expectedDamage) + (preview.expectedDamage >= memberHealth(target) ? 4 : 0), offensive: preview.expectedDamage > 0, path, targetId: target.id, kind: 'charge' });
    }
    if (this.nonSkillActionAvailable(unitId)) {
      const stay: GridPath = { cells: [unit.pos!], cost: 0 };
      for (const sidearm of [false, true]) if (!this.reloadReason(unitId, sidearm)) {
        if ((this.reloadCd.get(weaponReloadKey(unit, sidearm ? unit.sidearm : unit.weapon)) ?? 0) <= 1 && (this.actedThisTurn.has(unitId) || !this.hasteAvailable(unitId))) continue;
        const reload = new Map(this.reloadCd); reload.delete(weaponReloadKey(unit, sidearm ? unit.sidearm : unit.weapon));
        const value = actionPotential({ ...this.observationContext(), units: knownUnits, reload }, unit, undefined, true);
        plans.push({ kind: 'reload', weaponMode: sidearm ? 'sidearm' : 'primary', path: stay, score: positionScore(stay) + value * 0.5 });
      }
      if (this.actedThisTurn.has(unitId) && this.hasteAvailable(unitId)) {
        const extraPaths = reachableGridPaths(field, unit.pos!, this.movementLeft(unitId) + this.movementBudget(unitId), allowed, (n, from) => movementStepCost(field, n, unit, this.fieldTags, from));
        for (const path of extraPaths.filter(p => p.cost > this.movementLeft(unitId))) plans.push({ kind: 'haste-move', path, score: positionScore(path) - 0.25 });
        const flying = { ...unit, airborne: !isAirborne(unit) };
        if ((isAirborne(unit) || !flightCapabilityReason(unit, this.conditions)) && canOccupy(field, knownUnits, flying, flying.pos!)) {
          const value = incomingReduction(unit, flying) * 0.5 + (isAirborne(unit) && objective.kind !== 'annihilation' && unit.pos === field.objective.cell ? 6 : 0);
          if (value > 0) plans.push({ kind: 'haste-flight', path: stay, score: positionScore(stay) + value });
        }
      }
    }
    const tactic = unit.side === 'ally' ? this.allyTactic : 'balanced';
    // 逃脱任务的防守方若已经占住出口，不应为了普通位置评分主动让路。
    // 仍保留原地攻击/固守/警戒；若出口上的动作全部非法，再回退到普通候选。
    const defendsEscape = objective.kind === 'escape'
      && this.combatants.some(other => other.id === objective.unitId && other.side !== unit.side);
    // 单纯自保不能推进战斗：存在有效进攻时，仅保留固守的队友掩护收益。
    // 无法还击或玩家明确选择固守时，仍允许靠姿态减轻当前威胁。
    if (!this.actedThisTurn.has(unitId) && tactic !== 'defensive' && plans.some(plan => plan.offensive)) for (const plan of plans) plan.score -= plan.selfDefenseScore ?? 0;
    if (tactic === 'aggressive') for (const plan of plans) if (['weapon','charge'].includes(plan.kind)) plan.score += plan.kind === 'charge' ? 3 : 1.5;
    // 固守只影响自动决策；护送对象抵达出口仍优先，手动命令不受限制。
    const eligible = tactic === 'defensive' && !(objective.kind === 'escape' && objective.unitId === unitId) ? plans.filter(plan => plan.path.cost === 0) : plans;
    const anchored = defendsEscape && unit.pos === objective.cell
      ? eligible.filter(plan => plan.path.cells.at(-1) === objective.cell)
      : [];
    const candidates = anchored.length ? anchored : eligible.length ? eligible : plans;
    const completesEscort = (plan: typeof plans[number]) => objective.kind === 'escape' && objective.unitId === unitId
      && plan.path.cells.at(-1) === objective.cell && (!isAirborne(unit) || plan.kind === 'land');
    const commandScores = commanderScores(candidates.map(plan => ({
      key: JSON.stringify(field.layerVersion ? [plan.kind, plan.path.cells, plan.targetId, plan.abilityId, plan.weaponMode, plan.cell, plan.structureMode] : [plan.kind, plan.path.cells, plan.targetId, plan.abilityId, plan.weaponMode]), score: plan.score,
      attack: !!plan.offensive, breach: plan.kind === 'structure', ranged: plan.kind === 'structure' ? plan.structureMode?.startsWith('ability:') ? unit.abilities.find(a => a.id === plan.structureMode!.slice(8))?.delivery !== 'melee' : isRangedWeapon(plan.structureMode === 'sidearm' ? unit.sidearm : unit.weapon) : plan.kind === 'weapon' ? isRangedWeapon(plan.weaponMode === 'sidearm' ? unit.sidearm : unit.weapon) : plan.kind === 'ability' && (unit.abilities.find(a => a.id === plan.abilityId)?.range?.max ?? 0) > 1,
      move: plan.path.cost > 0, defend: plan.kind === 'brace' || plan.kind === 'hold' || plan.kind === 'ability' && !!unit.abilities.find(a => a.id === plan.abilityId)?.effects.some(e => e.op === 'barrier' || e.op === 'heal' || e.op === 'dispel' && e.polarity === 'negative' || e.op === 'condition' && ['blessed','encouraged'].includes(e.conditionId)),
    })), this.commanderProfiles[unit.side === 'ally' ? 'ally' : 'enemy'], `${this.seed}:${this.round}:${unitId}`, !!field.layerVersion);
    const ranked = new Map(candidates.map((plan, i) => [plan, commandScores[i]!]));
    const best = candidates.sort((a, b) => Number(completesEscort(b)) - Number(completesEscort(a))
      || ranked.get(b)! - ranked.get(a)! || a.path.cost - b.path.cost || (a.targetId ?? '').localeCompare(b.targetId ?? ''))[0];
    this.observationMemo = undefined; endPreviewScope();
    if (best) {
      if (best.kind === 'haste-move' || best.kind === 'haste-flight') this.selectHaste(unitId, true);
      if (best.path.cost > 0 && best.kind !== 'charge') {
        this.moveTo(unitId, best.path.cells.at(-1)!);
        const changed = unit.pos !== best.path.cells.at(-1) || this.visibleCombatants(unit.side).some(other => !knownUnits.some(known => known.id === other.id));
        if (changed && !reconsidered && unit.status === 'ready' && !this.isOver() && !this.actedThisTurn.has(unitId)) {
          this.autoGridAction(unitId, true, failedAbilities); return;
        }
      }
      if (unit.status === 'ready' && !this.isOver()) {
        if (best.kind === 'structure' && best.cell !== undefined && !this.structurePreview(unitId, best.cell, best.structureMode).reason) this.attackStructure(unitId, best.cell, best.structureMode);
        else if (best.kind === 'climb' && best.cell !== undefined && !this.climbReason(unitId, best.cell)) this.climb(unitId, best.cell);
        else if (best.kind === 'gate' && best.cell !== undefined && !this.gateReason(unitId, best.cell)) this.toggleGate(unitId, best.cell);
        else if (best.kind === 'weapon' && best.targetId && !this.weaponContext(unit, this.byId(best.targetId), { weaponMode: best.weaponMode }).reason) this.attack(unitId, best.targetId, { weaponMode: best.weaponMode });
        else if (best.kind === 'charge' && best.targetId) this.attack(unitId, best.targetId, { charge: true });
        else if (best.kind === 'ability' && best.abilityId) {
          const result = this.useAbility(unitId, best.abilityId, best.targetId);
          if (!result.ok && !this.actedThisTurn.has(unitId)) {
            failedAbilities.add(best.abilityId);
            this.autoGridAction(unitId, reconsidered, failedAbilities); return;
          }
        }
        else if (best.kind === 'haste-move') { /* 额外机动已在上方执行。 */ }
        else if (best.kind === 'haste-flight') this.changeFlight(unitId, !isAirborne(unit));
        else if (best.kind === 'reload') this.reloadWeapon(unitId, best.weaponMode === 'sidearm');
        else if (best.kind === 'land' && !this.flightReason(unitId, false)) this.changeFlight(unitId, false);
        else if (best.kind === 'brace' && !this.braceReason(unitId)) this.brace(unitId);
        else if (!(isEnduranceModel(unit.resourceModel) && best.kind === 'hold') && !(best.path.cost === 0 && canReconceal(this.observationContext(), unit)) && !this.overwatchReason(unitId)) this.setOverwatch(unitId);
      }
    }
    // 扑击脱离：落地后仍贴近持械地面近战且还能起飞时升空规避（起飞借机是已知代价）
    if (best?.kind !== 'land' && !(unit.resourceModel && best?.kind === 'hold') && !isAirborne(unit) && unit.status === 'ready' && !this.isOver() && !this.flightReason(unitId, true)
      && this.combatants.some((foe) => foe.side !== unit.side && foe.status === 'ready' && !isAirborne(foe) && !!meleeWeapon(foe) && this.dist(unit, foe) === 1)) {
      this.changeFlight(unitId, true);
    }
    if (!this.isOver() && unit.status === 'ready' && this.nonSkillActionAvailable(unitId) && actionBefore !== `${this.actedThisTurn.has(unitId)}:${this.hasteSpent.get(unitId)}`) { this.autoGridAction(unitId, true, failedAbilities); return; }
    if (!this.isOver()) this.endTurn();
  }

  private searchDestination(unit: Combatant, known: Combatant[]): number {
    const field = this.battlefield!;
    const coverage = this.searchCoverage[unit.side] ??= Array(field.tiles.length).fill(0);
    const observers = known.filter(other => other.side === unit.side && other.status === 'ready');
    for (let cell = 0; cell < field.tiles.length; cell++) {
      // 两格内才足以排查潜伏者；远处看得见地形不等于排除了伏兵。
      if (observers.some(observer => gridDistance(field, observer.pos!, cell) <= 2
        && unitLineOfSight(field, observer, { ...observer, pos: cell, airborne: false }))) coverage[cell] = this.round;
    }
    const reachable = gridCostsToGoals(field, [unit.pos!], cell => canOccupy(field, known, unit, cell), (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from));
    const owner = (cell:number) => [...observers].sort((a,b)=>gridDistance(field,a.pos!,cell)-gridDistance(field,b.pos!,cell)||a.id.localeCompare(b.id))[0]?.id;
    const assigned = [...reachable.keys()].filter(p=>owner(p)===unit.id && (coverage[p]??0)<this.round-1);
    return (assigned.length?assigned:[...reachable.keys()]).sort((a, b) => (coverage[a] ?? 0) - (coverage[b] ?? 0)
      || reachable.get(a)! - reachable.get(b)! || a - b)[0] ?? unit.pos!;
  }
  searchedCells(side: Side): number[] { return (this.searchCoverage[side]??[]).flatMap((round,cell)=>round>0&&this.round-round<=3?[cell]:[]); }

  private planAutoAction(u: Combatant, foes: Combatant[]): boolean {
    if (!this.nonSkillActionAvailable(u.id)) return false;
    interface Candidate {
      score: number;
      run: () => boolean;
    }
    const cands: Candidate[] = [];
    const jitter = () => this.rng.next() - 0.5;
    const readyFoes = foes.filter((f) => f.status === 'ready');

    // —— 估值辅助 ——
    const hitChanceOf = (f: Combatant): number => {
      if (this.rules.resolutionVersion === 'v2') return this.weaponPreview(u, f, this.weaponContext(u, f)).hitChance ?? 0;
      const netAtk = u.base.atk + counterMod(this.rules, u.archetype, f.archetype);
      if (this.rules.hitMode === 'tw') {
        const diff = netAtk - (f.base.def - this.rules.tw.defOffset);
        return Math.max(this.rules.tw.min, Math.min(this.rules.tw.max, this.rules.tw.base + diff * this.rules.tw.perDiff));
      }
      // d20 近似：P(1d20 + atk ≥ def)，天然1/20 兜底
      const needed = f.base.def - netAtk;
      return Math.max(0.05, Math.min(0.95, (21 - needed) / 20));
    };
    const expDamage = (baseDice: string, apDice: string | undefined, f: Combatant): number => {
      if (this.rules.resolutionVersion === 'v2') return (diceAvg(baseDice) + (apDice ? diceAvg(apDice) : 0)) * penetrationContext({ attacker: u, defender: f,rules:this.rules }).factor;
      const dr = Math.min(0.9, armorDR(f, this.rules, this.traitRegistry) + qualityGapDR(u, f));
      return Math.max(1, diceAvg(baseDice) * (1 - dr) + (apDice ? diceAvg(apDice) : 0));
    };
    const threatOf = (f: Combatant): number =>
      (f.base.atk + diceAvg(f.weapon?.baseDice ?? '1d6') + diceAvg(f.weapon?.apDice ?? '1d2')) / 2;
    const offenseScore = (expDmg: number, f: Combatant): number =>
      expDmg * hitChanceOf(f) +
      (expDmg >= f.hp ? 8 : 0) + // 斩杀线：终结残敌
      (1 - f.hp / Math.max(1, f.base.hpMax)) * 3 + // 集火残血
      threatOf(f) / 2; // 威胁优先

    // —— 普攻候选（射程/装填门禁与 attack() 同构）——
    const weaponTargets = foes.filter((f) => !this.weaponContext(u, f).reason);
    for (const f of weaponTargets) {
      const context = this.weaponContext(u, f);
      const weapon = context.weapon;
      const times = Math.max(1, weapon?.attacks ?? 1);
      const exp = expDamage(weapon?.baseDice ?? '1d6', weapon?.apDice, f) * times;
      cands.push({
        score: offenseScore(exp, f) + jitter(),
        run: () => {
          try {
            this.attack(u.id, f.id);
            return true;
          } catch {
            return false; // 缴械等异常 → 尝试下一候选
          }
        },
      });
    }

    // —— 技能候选（冷却/次数/资源门禁；射程门禁与 useAbility 同构）——
    for (const a of u.abilities) {
      if ((!a.itemSourceId && (this.actedThisTurn.has(u.id) || this.hasteSelected.has(u.id))) || !this.abilityUsable(u, a)) continue;
      const damageEff = a.effects.find((e): e is Extract<EffectOp, { op: 'damage' }> => e.op === 'damage');
      const healEff = a.effects.find((e): e is Extract<EffectOp, { op: 'heal' }> => e.op === 'heal');
      const cost = (abilityCost(u, a)?.amount ?? 0) * 0.5; // 资源机会成本

      if (damageEff) {
        for (const f of foes) {
          if (abilityTargetReason({ actor: u, ability: a, target: f, distance: this.dist(u, f), field: this.battlefield })) continue;
          let exp = expDamage(damageEff.baseDice, damageEff.apDice, f);
          if (damageEff.shape === 'burst') {
            // 覆盖形态：邻近敌人的溅射期望（威力减半，至多两目标）
            const splash = foes.filter((x) => x.id !== f.id && this.dist(x, f) <= 1).length;
            exp += expDamage(damageEff.baseDice, damageEff.apDice, f) * 0.5 * Math.min(2, splash);
          }
          cands.push({
            score: offenseScore(exp, f) - cost + jitter(),
            run: () => this.useAbility(u.id, a.id, f.id).ok,
          });
        }
      }

      if (healEff && a.target !== 'enemy') {
        // 治疗候选：友方（含自己）血量比 <50%，或濒死（治疗可拉回 ready）
        const allies = this.combatants.filter(
          (c) => c.side === u.side && (c.status === 'ready' || c.status === 'dying'),
        );
        for (const t of allies) {
          if (a.target === 'self' && t.id !== u.id) continue;
          if (abilityTargetReason({ actor: u, ability: a, target: t, distance: this.dist(u, t), field: this.battlefield })) continue;
          const dying = t.status === 'dying';
          const hpPct = t.hp / Math.max(1, t.base.hpMax);
          if (!dying && hpPct >= 0.5) continue;
          const effective = Math.min(recoveryCapacity(t), healEff.amount ?? diceAvg(healEff.dice!));
          cands.push({
            score: effective * 0.9 + (dying ? 15 : 0) + (hpPct < 0.25 ? 5 : 0) - cost + jitter(),
            run: () => this.useAbility(u.id, a.id, a.target === 'self' ? undefined : t.id).ok,
          });
        }
      }

      if (!damageEff && !healEff) {
        // 增益/减益/士气/召唤：小额基础分，不与强进攻竞争
        const conditionEff = a.effects.find((e): e is Extract<EffectOp, { op: 'condition' }> => e.op === 'condition');
        const moraleEff = a.effects.find((e): e is Extract<EffectOp, { op: 'morale' }> => e.op === 'morale');
        const summonEff = a.effects.some((e) => e.op === 'summon');
        const readyAllies = this.combatants.filter((c) => c.side === u.side && c.status === 'ready').length;
        if (summonEff) {
          // 兵力劣势时叫援军；只受技能自身冷却/次数约束，不再叠加隐藏概率
          if (readyFoes.length > readyAllies) {
            cands.push({
              score: 5 + jitter(),
              run: () => this.useAbility(u.id, a.id, undefined).ok,
            });
          }
        } else if (conditionEff) {
          const def = this.conditions.get(conditionEff.conditionId);
          const mods = def?.mods ?? [];
          const net = mods.reduce((s, m) => s + (m.type === 'mult' ? 0 : m.value), 0);
          const isDebuff = !!def?.skipTurn || !!def?.preventAttack || !!def?.dot || net < 0;
          const isBuff = !isDebuff && (net > 0 || mods.some((m) => m.type === 'mult' && m.value < 1));
          if ((a.target === 'self' || a.target === 'ally') && isBuff) {
            if (this.round <= 2 && !u.conditions.some((c) => c.id === conditionEff.conditionId)) {
              cands.push({
                score: 4 - cost + jitter(),
                run: () => this.useAbility(u.id, a.id, a.target === 'self' ? undefined : u.id).ok,
              });
            }
          } else if (a.target === 'enemy' && isDebuff) {
            // 敌方减益：挑威胁最高且未挂的目标（前3回合）
            const t = foes
              .filter((f) => !f.conditions.some((c) => c.id === conditionEff.conditionId))
              .sort((x, y) => threatOf(y) - threatOf(x))[0];
            if (t && this.round <= 3) {
              cands.push({
                score: 4 + threatOf(t) / 2 - cost + jitter(),
                run: () => this.useAbility(u.id, a.id, t.id).ok,
              });
            }
          }
        } else if (moraleEff && moraleEff.amount > 0 && u.morale !== undefined) {
          if (this.round <= 2 && u.morale < (u.base.moraleMax ?? 100) * 0.8) {
            cands.push({
              score: 4 - cost + jitter(),
              run: () => this.useAbility(u.id, a.id, undefined).ok,
            });
          }
        }
      }
    }

    cands.sort((x, y) => y.score - x.score);
    for (const c of cands) {
      if (c.run()) return true;
    }
    return false;
  }

  /** 技能可用性：冷却/每战次数/资源三重门禁 */
  private abilityUsable(u: Combatant, a: Combatant['abilities'][number]): boolean {
    return !abilityUsabilityReason(u, a);
  }

  /** 推进 turnIndex 直到落在可行动单位上（回合开始效果在此结算） */
  private advanceToNextActor(): void {
    while (this.turnIndex < this.turnOrder.length) {
      const u = this.active;
      if (!u) break;
      if (u.status === 'ready' || u.status === 'routing') this.beginFeedbackActivation();
      if (u.status !== 'ready' && u.status !== 'routing') {
        this.captureFeedback(); this.feedback?.finishActivation();
        this.turnIndex += 1;
        continue;
      }
      this.beginTurn(u);
      this.captureFeedback();
      if (u.status !== 'ready') {
        if (u.status === 'routing') this.settleUnit(u);
        this.feedback?.finishActivation();
        this.turnIndex += 1;
        continue;
      }
      const stunned = u.conditions.some((c) => this.conditions.get(c.id)?.skipTurn);
      if (stunned) {
        this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 眩晕，跳过回合` });
        this.settleUnit(u);
        this.captureFeedback(); this.feedback?.finishActivation();
        this.turnIndex += 1;
        continue;
      }
      break;
    }
  }

  private settleMorale(unit: Combatant): void {
    if (this.rules.resolutionVersion !== 'v2') return;
    const decision = decideMorale(this.observationContext(), unit, this.round, this.rng, this.rules.morale.breakAt, this.traitRegistry);
    if (decision.kind === 'none') return;
    if (decision.state) unit.moraleState = decision.state;
    if (decision.kind === 'routed' || decision.kind === 'failed') {
      unit.status = 'routing'; delete unit.tacticalPose; this.overwatch.delete(unit.id); this.reactionSpent.add(unit.id);
    } else if (decision.kind === 'fled') { unit.status = 'fled'; delete unit.tacticalPose; this.overwatch.delete(unit.id); }
    else if (decision.kind === 'rallied') { unit.status = 'ready'; changeMorale(unit, Math.max(0, this.rules.morale.breakAt + 15 - (decision.effective ?? 0))); }
    if (decision.text) this.recordEvent({ round: this.round, kind: 'morale', participants: [unit.id], text: decision.text });
    if (decision.kind === 'routed' || decision.kind === 'failed') this.moveRoutingUnit(unit);
  }

  /** Each failed rally grants one retreat move; repeated settlements in a round grant none. */
  private moveRoutingUnit(unit: Combatant): void {
    const field = this.battlefield, start = unit.pos;
    if (!field || start === undefined || unit.conditions.some(c => {
      const def = this.conditions.get(c.id); return c.dur > 0 && (def?.skipTurn || def?.preventMove);
    })) return;
    const allowed = (cell: number) => cell === start || canOccupy(field, this.combatants, unit, cell);
    const cost = (cell: number, from: number) => movementStepCost(field, cell, unit, this.fieldTags, from);
    const rearRow = unit.side === 'ally' ? field.height - 1 : 0;
    const goals = Array.from({ length: field.width }, (_, x) => rearRow * field.width + x);
    const remaining = gridCostsToGoals(field, goals, allowed, cost);
    const distance = (cell: number) => remaining.get(cell) ?? Math.abs(Math.floor(cell / field.width) - rearRow) * 2;
    const path = reachableGridPaths(field, start, this.movementBudget(unit.id), allowed, cost)
      .filter(p => distance(p.cells.at(-1)!) < distance(start))
      .sort((a, b) => distance(a.cells.at(-1)!) - distance(b.cells.at(-1)!) || a.cost - b.cost)[0];
    if (!path) return;
    unit.pos = path.cells.at(-1)!; this.movedThisTurn.add(unit.id);
    this.recordEvent({ round: this.round, kind: 'morale', participants: [unit.id], text: `${unit.name} 溃退：${cellLabel(field, start)}→${cellLabel(field, unit.pos)}` });
  }

  /** 回合开始效果：清移动标记、装填递减、持续伤害与死亡判定 */
  private beginTurn(u: Combatant): void {
    delete u.tacticalPose;
    delete u.tacticalEffort;
    this.movementSpent.delete(u.id); this.reactionSpent.delete(u.id); this.overwatch.delete(u.id); this.hasteOverwatch.delete(u.id);
    this.movedThisTurn.delete(u.id);
    this.actedThisTurn.delete(u.id); this.hasteSelected.delete(u.id); this.hasteMovement.delete(u.id);
    for (const key of new Set([u.id, weaponReloadKey(u, u.sidearm)])) {
      const rl = this.reloadCd.get(key) ?? 0;
      if (rl > 0) {
        if (rl <= 1) this.reloadCd.delete(key);
        else this.reloadCd.set(key, rl - 1);
      }
    }
    let dotSource: Combatant | undefined;
    for (const c of [...u.conditions]) {
      if (this.rules.resolutionVersion === 'v2' && c.id === 'poisoned' && !poisonFactor(u)) { u.conditions = u.conditions.filter((condition) => condition !== c); continue; }
      const def = this.conditions.get(c.id);
      if (def?.dot) {
        const r = rollDice(def.dot.dice, this.rng);
        let damage = this.rules.combatModel ? roundDamage(conditionDamage(u,r.total,c),this.rng) : this.rules.resolutionVersion === 'v2' && c.id === 'poisoned' ? poisonDamage(u, r.total * (c.magnitude ?? 1)) : Math.max(0, Math.round(r.total * (c.magnitude ?? 1)));
        const members=u.hp,lost=hasMemberHealth(u)?applyCombatDamage(u,damage,c.affectedMembers??10):applyHealthLoss(u, damage, this.rules.resolutionVersion === 'v2'); if(this.rules.combatModel)damage=lost;
        this.recordEvent({
          round: this.round,
          kind: 'condition',
          damage: {sourceId:c.sourceId,targetId:u.id,amount:lost,cause:def.dot.label ?? def.name,...(hasMemberHealth(u)?{unit:'life' as const,members:members-u.hp}:{})},
          participants: [u.id], text: `${u.name} ${def.dot.label ?? def.name} -${damage} → ${hasMemberHealth(u)?'总生命':'HP'} ${memberHealth(u)}`,
        });
        this.checkDeath(u, this.combatants.find(source=>source.id===c.sourceId));
        if (u.hp <= 0) { dotSource = this.combatants.find((source) => source.id === c.sourceId); break; }
      }
    }
    if (u.hp <= 0) this.checkDeath(u, dotSource);
    this.resolveFlightStates();
    this.settleMorale(u);
  }

  /** 回合结束效果：状态时长递减/过期、冷却递减、再生 */
  private settleUnit(u: Combatant): void {
    const regeneration = this.rules.resolutionVersion === 'v2' ? regenerationAmount(u, this.traitRegistry, this.conditionDefMap()) : 0;
    if (this.rules.resolutionVersion === 'v2' && settleConcealment(this.observationContext(), u, !this.actedThisTurn.has(u.id) && !this.movedThisTurn.has(u.id))) this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 在掩护中休整，重新潜伏` });
    const modernResources = isEnduranceModel(u.resourceModel);
    const incapacitated = u.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn);
    const fullRest = !incapacitated && !u.suppression && this.hasteSpent.get(u.id) !== this.round && !this.actedThisTurn.has(u.id) && !this.movedThisTurn.has(u.id) && !this.reactionSpent.has(u.id) && !(u.tacticalEffort ?? 0);
    if ((this.battlefield || modernResources) && u.rulesVersion === 'v2') {
      const moveLimit = modernResources ? Math.max(1, this.movementBudget(u.id)) : Math.max(4, this.movementBudget(u.id));
      const moved = this.movementSpent.get(u.id) ?? 0;
      const effort = (u.tacticalEffort ?? 0) + (modernResources ? Math.floor(moved / moveLimit) : Number(moved >= moveLimit));
      if (!modernResources || u.status === 'ready') settleFatigue(u, effort, fullRest);
      delete u.tacticalEffort;
    }
    recoverSp(u, fullRest, incapacitated);
    if (u.suppression) u.suppression = Math.max(0, u.suppression - 1);
    const expired: string[] = [];
    for (const c of [...u.conditions]) {
      if (c.skipNextDecay) { delete c.skipNextDecay; continue; }
      c.dur -= 1;
      if (c.dur <= 0) {
        u.conditions = u.conditions.filter((x) => x !== c);
        expired.push(this.conditions.get(c.id)?.name ?? c.id);
      }
    }
    if (expired.length) {
      this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 状态结束：${expired.join('、')}` });
    }
    for (const s of u.abilityState) if (s.cdLeft > 0) s.cdLeft -= 1;
    const regen = this.rules.resolutionVersion === 'v2' ? regeneration : this.regenOf(u);
    if (regen > 0 && u.hp > 0 && recoveryCapacity(u)>0) {
      const restored = applyRecovery(u, regen);
      this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 再生 +${restored} → ${u.scale === 'hero' ? '生命' : '人数'} ${u.hp}${u.scale !== 'hero' && u.rulesVersion === 'v2' ? `，剩余可救伤兵${u.recoverableWounded ?? 0}` : ''}` });
    }
  }

  /** 死亡与经验入账 */
  private settleAreaEffects(boundary=false): void {
    this.resolveGroundStates();
    for (const result of settleZones(this.observationContext(),this.round,boundary,this.rng)) {
      if(result.control&&result.source)this.flightCauses.set(result.target.id,result.source.id);
      this.recordEvent({round:this.round,kind:'condition',participants:[result.target.id,...(result.source?[result.source.id]:[])],text:result.text});
      this.checkDeath(result.target,result.source); this.checkInjury(result.target,result.damage);
    }
  }
  private checkDeath(unit: Combatant, killer?: Combatant): void {
    if(this.rules.resolutionVersion==='v2') {
      const earned=casualtyXp(unit,this.xpMinimum);
      if(unit.side==='enemy')this.xpGained+=earned;
      const owner=killer?.summonerId??killer?.id;
      if(owner&&earned&&killer?.side!==unit.side&&killer?.side!=='neutral')this.xpByUnit.set(owner,(this.xpByUnit.get(owner)??0)+earned);
    }
    if (unit.hp > 0 || unit.status === 'dead' || this.nonLethal && unit.status === 'dying') return;
    if(this.rules.resolutionVersion==='v2')this.defeatedIds.add(unit.id);
    // 与会战一致：生命归零即阵亡，不依赖战斗结束后不可能发生的再次补刀。
    unit.status = this.nonLethal ? 'dying' : 'dead';
    this.recordEvent({
      round: this.round,
      kind: 'death',
      participants: [unit.id, ...(killer ? [killer.id] : [])], text: `${unit.name} ${this.nonLethal ? '濒死，非致命失能' : unit.scale === 'hero' ? '阵亡' : '被击败'}${killer ? `（${killer.name}）` : ''}`,
    });
    if (unit.side === 'enemy' && this.rules.resolutionVersion !== 'v2' && !this.defeatedIds.has(unit.id)) {
      this.defeatedIds.add(unit.id);
      this.xpGained += unit.xpValue ?? 0;
      if (killer) this.xpByUnit.set(killer.id, (this.xpByUnit.get(killer.id) ?? 0) + (unit.xpValue ?? 0));
    }
    this.checkGridObjective(false);
  }

  /** 单发重击判定：单击伤害 ≥ maxHP×规则包阈值 → 挂「重伤」（攻-2/速-1，3回合）。
   *  濒死/已重伤不重复挂；持续伤害不触发（只认单次命中）。 */
  private checkInjury(target: Combatant, dmg: number): void {
    if (target.status !== 'ready' || dmg <= 0) return;
    if (target.conditions.some((c) => c.id === 'wounded')) return;
    const threshold = Math.ceil(memberHealthMax(target) * (this.rules.injuryThreshold ?? 0.4));
    if (dmg >= threshold) {
      target.conditions.push({ id: 'wounded', dur: 3 });
      this.recordEvent({
        round: this.round,
        kind: 'condition',
        participants: [target.id], text: `${target.name} 被重创，陷入【重伤】（攻击/速度受损，3回合）`,
      });
    }
  }

  private applyOnHitTraits(attacker: Combatant, target: Combatant, result?: AttackResolution): void {
    if (this.rules.resolutionVersion === 'v2') {
      applyWeaponConditions(target, result?.onHitConditions);
      if (result?.onHitConditions?.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventMove)) this.flightCauses.set(target.id, attacker.id);
      return;
    }
    for (const id of activeTraitIds(attacker)) {
      const t = getTrait(id, this.traitRegistry);
      if (!t) continue;
      for (const e of t.effects) {
        if (e.kind === 'onHitCondition' && !target.conditions.some((c) => c.id === e.conditionId)) {
          target.conditions.push({ id: e.conditionId, dur: e.dur });
        }
      }
    }
  }

  private regenOf(u: Combatant): number {
    let v = 0;
    for (const id of activeTraitIds(u)) {
      const t = getTrait(id, this.traitRegistry);
      if (!t) continue;
      for (const e of t.effects) if (e.kind === 'regen') v = Math.max(v, e.perRound);
    }
    return v;
  }

  /** 战斗是否结束：一方无 ready 单位（濒死/死亡/溃逃/撤离均视为失去战斗力） */
  finishBattle(reason: 'ceasefire' | 'surrender'): void {
    if (this.isOver()) return;
    this.objectiveWinner = reason === 'surrender' ? 'enemy' : 'draw';
    this.finalizeCasualties();
    this.recordEvent({ round: this.round, kind: 'battle-end', text: reason === 'surrender' ? '我方投降，敌方获胜；保留实际伤亡，存活者不视为死亡或成功撤离' : '玩家停止交战，按当前伤亡结算为停战；倒地者未被补杀，未判定俘虏或敌方投降' });
  }

  /** 兼容旧战场中尚未结清的零生命濒死状态；不重复发放击败经验。 */
  finalizeCasualties(): void {
    if (this.nonLethal || !this.isOver()) return;
    for (const unit of this.combatants) if (unit.hp <= 0 && unit.status === 'dying') {
      unit.status = 'dead';
      this.recordEvent({round:this.round,kind:'death',participants:[unit.id],text:`${unit.name} 阵亡（生命归零）`});
    }
  }

  isOver(): boolean {
    if (this.objectiveWinner) return true;
    for (const side of ['ally', 'enemy'] as const) {
      if (!this.combatants.some((c) => c.side === side && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing'))) return true;
    }
    return false;
  }

  /** 胜方（未结束时为 undefined） */
  winner(): 'ally' | 'enemy' | 'draw' | undefined {
    if (this.objectiveWinner) return this.objectiveWinner;
    if (!this.isOver()) return undefined;
    const allyReady = this.combatants.some((c) => c.side === 'ally' && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing'));
    const enemyReady = this.combatants.some((c) => c.side === 'enemy' && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing'));
    if (allyReady && enemyReady) return 'draw';
    if (allyReady) return 'ally';
    if (enemyReady) return 'enemy';
    return 'draw';
  }

  private conditionDefMap(): Map<string, ConditionDef> {
    const m = new Map<string, ConditionDef>();
    for (const c of this.conditions.all()) m.set(c.id, c);
    return m;
  }

  // ---------- 快照（面板持久化战斗记录用） ----------

  /** 导出可 JSON 序列化的完整战斗状态（关闭面板后恢复战场与战报）。
   *  含种子随机状态：种子源战斗恢复后掷骰序列与快照时刻一致（审计回放）。 */
  toSnapshot(): Record<string, unknown> {
    return {
      v: 1, allyTactic: this.allyTactic, commanderProfiles: this.commanderProfiles, nonLethal: this.nonLethal,
      battlefield: this.battlefield,
      searchCoverage: this.searchCoverage,
      ...(this.feedback ? { feedback: this.feedback.snapshot() } : {}),
      movementSpent: [...this.movementSpent], reactionSpent: [...this.reactionSpent], overwatch: [...this.overwatch],
      controlRounds: this.controlRounds, controlHold: this.controlHold, objectiveWinner: this.objectiveWinner,
      defeatedIds: [...this.defeatedIds],
      combatants: this.combatants,
      rulesId: this.rules.id,
      seed: this.seed,
      rngState: this.rng instanceof SeededRng ? this.rng.getState() : undefined,
      round: this.round,
      turnOrder: this.turnOrder,
      turnIndex: this.turnIndex,
      log: this.log,
      xpGained: this.xpGained, xpMinimum: [...this.xpMinimum], xpInitialStrength: [...this.xpInitialStrength],
      xpByUnit: [...this.xpByUnit],
      movedThisTurn: [...this.movedThisTurn],
      actedThisTurn: [...this.actedThisTurn],
      hasteOverwatch: [...this.hasteOverwatch], hasteSpent: [...this.hasteSpent], hasteMovement: [...this.hasteMovement], hasteSelected: [...this.hasteSelected],
      fieldTags: this.fieldTags,
      reloadCd: [...this.reloadCd],
      started: this.started,
    };
  }

  /** 从快照重建战斗（回调与注册表由调用方重新挂回） */
  static fromSnapshot(
    snap: Record<string, any>,
    opts: { traitRegistry?: Map<string, Trait>; summonUnit?: (templateId: string, side: Side) => Combatant | null } = {},
  ): SmallBattle {
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
    const b = new SmallBattle({
      nonLethal: snap.nonLethal === true,
      battlefield: snap.battlefield,
      combatants: snap.combatants,
      rules: rulesById(snap.rulesId),
      seed: snap.seed ?? randomSeed(),
      rng,
      traitRegistry: opts.traitRegistry,
      summonUnit: opts.summonUnit,
      field: { tags: snap.fieldTags ?? snap.battlefield?.environment ?? [] },
    });
    b.allyTactic = normalizeTactic(snap.allyTactic);
    b.commanderProfiles = normalizeCommanderProfiles(snap.commanderProfiles);
    b.round = snap.round ?? 1;
    b.searchCoverage = structuredClone(snap.searchCoverage ?? {});
    b.movementSpent = new Map(snap.movementSpent ?? []); b.reactionSpent = new Set(snap.reactionSpent ?? []);
    b.overwatch = new Set(snap.overwatch ?? []); b.controlRounds = snap.controlRounds ?? { ally: 0, enemy: 0 };
    b.objectiveWinner = snap.objectiveWinner; b.controlHold = snap.controlHold ? { ...snap.controlHold } : undefined;
    b.defeatedIds = new Set(snap.defeatedIds ?? []);
    b.turnOrder = snap.turnOrder ?? b.turnOrder;
    b.turnIndex = snap.turnIndex ?? 0;
    b.log = [...(snap.log ?? [])];
    for (const unit of b.combatants) {
      const before = lifeBefore.get(unit.id), maximum = unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp;
      if (before?.maximum !== undefined && before.maximum !== maximum) b.recordEvent({ round: b.round, kind: 'condition', participants: [unit.id],
        text: `${unit.name} 单体生命上限调整：${before.maximum}→${maximum}${unit.scale === 'hero' ? `，当前生命${before.hp}→${unit.hp}` : '，编制不变'}；规则归一化，不计战斗伤害` });
      if (before?.pressure !== undefined && before.pressure !== unit.moraleState?.damagePenalty) b.recordEvent({ round: b.round, kind: 'condition', participants: [unit.id],
        text: `${unit.name} 受创士气压力按实际最大生命校准：${before.pressure}→${unit.moraleState?.damagePenalty}` });
    }
    b.xpMinimum = new Map([...initialXpStrength(b.combatants), ...(snap.xpMinimum ?? [])]);
    b.xpInitialStrength = new Map(snap.xpInitialStrength ?? []);
    if(!snap.xpMinimum)for(const id of b.defeatedIds)b.xpMinimum.set(id,0);
    b.xpGained = snap.xpGained ?? 0;
    b.xpByUnit = new Map(snap.xpByUnit ?? []);
    b.movedThisTurn = new Set(snap.movedThisTurn ?? []);
    b.actedThisTurn = new Set(snap.actedThisTurn ?? []);
    b.hasteOverwatch = new Map(snap.hasteOverwatch ?? []);
    b.hasteSpent = new Map(snap.hasteSpent ?? []); b.hasteMovement = new Map(snap.hasteMovement ?? []); b.hasteSelected = new Set(snap.hasteSelected ?? []);
    if ([...b.hasteSpent].some(([id, round]) => !b.combatants.some(u => u.id === id) || !Number.isInteger(round) || round < 1 || round > b.round) || [...b.hasteMovement].some(([id, amount]) => !b.combatants.some(u => u.id === id) || !Number.isInteger(amount) || amount < 0 || amount > 5)) throw Error('加速动作记录损坏');
    if ([...b.hasteSelected].some(id => !b.combatants.some(u => u.id === id)) || [...b.hasteOverwatch].some(([id, scale]) => !b.combatants.some(u => u.id === id) || !Number.isFinite(scale) || scale < 0 || scale > 1)) throw Error('加速动作记录损坏');
    b.reloadCd = new Map(snap.reloadCd ?? []);
    (b as unknown as { started: boolean }).started = !!snap.started;
    b.finalizeCasualties();
    if (b.started && b.battlefield && b.rules.resolutionVersion === 'v2') {
      b.feedback = new BattleFeedback(b.round, b.feedbackUnits(), snap.feedback);
      if (!b.feedback.snapshot().activation) b.beginFeedbackActivation();
    }
    return b;
  }
}

/** 便捷工厂：从模板批量造 Combatant（面板/测试用） */
export function makeCombatant(partial: Partial<Combatant> & Pick<Combatant, 'id' | 'name' | 'side'>): Combatant {
  const base: Combatant['base'] = { atk: 3, def: 12, spd: 2, hpMax: 20, ...(partial.base ?? {}) };
  const { base: _b, hp: _h, ...rest } = partial;
  return {
    scale: 'hero',
    level: 1,
    tags: [],
    base,
    hp: partial.hp ?? base.hpMax,
    conditions: [],
    abilities: [],
    abilityState: [],
    resources: {},
    traits: [],
    engagedWith: [],
    status: 'ready',
    fatigue: 0,
    ...rest,
  };
}

function knownStructureObserver(battle: SmallBattle, actor: Combatant, cell: number): boolean { return battle.visibleCombatants(actor.side).some(u => u.side === actor.side && u.status === 'ready' && canSpot(battle.observationContext(), u, { ...u, side: actor.side === 'enemy' ? 'ally' : 'enemy', traits: [], traitSources: [], pos: cell, elevation: undefined, airborne: false })); }
