import { displayNumber } from '../display-number.js';
import { grantEntryWornBarrier, resetWornBarrier } from '../worn-barrier.js';
import { prepareRevivalBattle, tryRevive } from '../revival.js';
import { isArmsV2, armsStatusLabels, shieldUsable, denialReady, denialModifiers, beginArmsActivation, noteArmsFire, armsWeaponReason, validateArmsState, isSprayer, spendSprayerFuel } from '../arms.js';
import { sprayerFear, sprayerTank } from '../sprayer.js';
import { stackingRevision } from '../progression.js';
import { progression, GEAR_G } from '../progression.js';
import { ACTIVATION_CONTROLS, validateBattleControlState, controlReactionAllowed, controlPolicy, beginControlActivation, finishControlActivation, reconcileBattleControls, breakCharmOnDamage } from '../battle-control.js';
import { attackHostile, combatHostile, combatSide, controlActionReason, controlCondition } from '../battle-control.js';
import { straightGridPath } from '../phase2-traits.js';
import { healingEffectGroups } from '../healing.js';
import { spendAbility } from '../ability-state.js';
import { itemUseLog } from '../item-use-log.js';
import { assertBattleCapacity } from '../battle-limits.js';
import { smallBattleResult } from '../battle-result.js';
import { prepareGridDeployment, deploymentDepth } from './spatial.js';
import { unitHeight, heightDefense, heightReach, standingTerrain, surfaceHeightAt, reportsHeights } from './height-map.js';
import { bonusMultiplier } from '../enhancements.js';
import { regionalOrder, intentOrder, type UnitIntent } from './team-tactics.js';
import { findIntentRoute, intentPlace, intentRouteFailure } from './intent-path.js';
import { restoreOutdoorWallPlatforms } from './outdoor-wall-platforms.js';
import { groundBlocked, isElevated, intactStructure, canClimbFrom, meleeHeightReason, meleeContact, structureDefense, structureDurability, damageStructure, weaponBreachBudget, structureTraitMultiplier, STRUCTURE_NAMES } from './layers.js';
import { tacticalSkillCost, tacticalRestValue } from '../skill-economy.js';
import { isEnduranceModel, fatiguePenalty, abilityCost, prepareResourceModel, recoverSp, skillExertion, resourceRound } from '../resources.js';
import { actionPotential } from '../skill-tactics.js';
import { hasteMagnitude, hasteAttackScale } from '../haste.js';
import { commanderScores, normalizeCommanderProfiles, type CommanderProfiles, type CommanderProfile, type CommandChoice } from '../commander-profile.js';
import { isCommandV2, commandProfile, commandQuality, commandCohesion, commandScores, commandOpening, beginCommandRound, noteCommandAttack, readCommandRounds, styleActive, commandAttacked, commandAttackers, commandScale, COMMAND_KNOBS, COMMAND_STYLES, COORDINATED_CONTROLS, type CommandRound } from '../command-v2.js';
import { smallCommandFeatures } from './command-features.js';
import { killProbability } from '../fire-budget.js';
import { validateGear, quickItemAction, itemUseAbility, itemEmergency, ITEM_EMERGENCY_DISCOUNT } from '../items.js';
import { prepareItemModel, validateItemModel, itemsV15 } from '../item-model.js';
import { prepareTraitLevelModel, validateTraitLevelModel } from '../trait-level-model.js';
import { areaTargets, canAnchorArea, zoneTarget, placeZone, settleZones, validateAreas, ZONE_NAMES, zoneEndText, type BattleZone } from '../area-effects.js';
import { tbWeaponShortName } from '../weapon-name.js';
import { grantBarrier, validateBarrier, barrierSourceKey } from '../barrier.js';
import { expireRoundEffects } from '../effect-expiry.js';
import { casualtyXp, initialXpStrength } from '../casualty-xp.js';
import { roundDamage } from '../probability.js';
import { prepareCombatModel, healingYield } from '../combat-model.js';
import { prepareArmsModel } from '../arms.js';
import { prepareTraitModel, validateTraitModel, validateEntrenchment, traitsV13 } from '../trait-model.js';
import { prepareSkillModel, validateSkillModel, singleWeaponSkillScale, independentSkillDamageScale } from '../skill-model.js';
import { entrench, entrenched } from '../entrenchment.js';
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
import { moveEffects, movementOnlySkill, hasSkillMovement, moveBlockReason, effectiveMoveReach, type MoveEffect, type MoveMode } from '../skill-movement.js';
import { prepareCondition, applySkillCondition, dispelCandidates, applyDispel, applyPush, pushPreview, skillEffectLines, areaSkillEffectLines, skillEffectValue, summonValue, conditionChance } from '../skill-effects.js';
import { applyWeaponConditions, poisonDamage, poisonFactor, conditionDamage, conditionDamageSources } from '../afflictions.js';
import { isRangedWeapon, weaponReloadKey, weaponReloadTurns, meleeWeapon, validateMount, mountedShooting, steadyMovingShot, agileDisengage } from '../loadout.js';
import { moraleProfile, moraleAttackMods, decideMorale, changeMorale, validateMoraleState, moraleRisk, moraleChangePreview, reconcileDamageMorale, recoverEntryMorale } from '../morale.js';
import { emptyDiplomacy, restoreDiplomacy } from '../diplomacy.js';
import { applyHealthLoss, applyCombatDamage, applyRecovery, recoveryCapacity, regenerationAmount, settleRegeneration, validateWounded, settleWoundedOnDeath, lifestealRecovery, beginLifestealRound } from '../recovery.js';
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
import { resolveAttack, previewAttack, penetrationContext, isRangedCapable, armorDR, qualityGapDR, beginPreviewScope, endPreviewScope, previewScopeEpoch, type AttackResolution, type AttackOpts } from '../damage.js';
import { sharedParticipants } from '../exposure.js';
import { diceAvg, rebuildDice } from '../data/weapons.js';
import { ConditionRegistry } from '../conditions.js';
import { LITE_D20, counterMod, rulesById } from '../rules.js';
import { getTrait, hasFlag, fieldModsFor, collectMods, resolveStack } from '../bonus.js';
import { situationalTraitMods } from '../situational-traits.js';
import { BattleFeedback, type FeedbackUnit, type RoundFeedback } from '../battle-feedback.js';
import { activeTraitIds, activeConditionIds, traitSourceActive } from '../trait-sources.js';
import { movementFraction, bracePose, movementPoints, settleFatigue, addTacticalEffort, validateTacticalEffort } from '../tactics.js';
import { rangedTargetDistance, isAirborne, sameLayer, flightCapabilityReason, flightMaintenanceReason, fallDamage, validateFlightState } from '../aerial.js';
import { environmentTags } from '../environment.js';
import { traitRegistry as defaultTraitRegistry } from '../data/traits.js';
import { meleeLineBlocker, terrainTacticalValue, canOccupy, cellLabel, reportPlaceLabel, deployOnGrid, findGridPath, reachableGridPaths, gridCostsToGoals, gridDistance, lineOfSight, unitLineOfSight, neighbors, movementNeighbors, movementStepCost, retreatCells, validateField, type BattlefieldSpec, type GridPath } from './spatial.js';
import { canSpot, concealedUnit, observedUnits, observeEvent, sideViews, observedLog, revealUnit, revealContacts, settleConcealment, canReconceal, validateConcealment, type ObservationContext } from '../observation.js';
import { noteSightings, noteClue, liveTraces, liveClues, restoreIntel, intelView, CLUE_RANGE, SPREAD_ROUNDS, type IntelBook, type IntelView } from '../intel.js';
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
import { baseMechanism } from '../data/weapons.js';

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

/** V19 §2.2 控制候选：生效概率、生效后施加的状态与推拉落点。 */
interface CommandControl { p: number; conditions: import('../types.js').ActiveCondition[]; cell?: number }
/** AI 估算假想落点时的观测：某个单位、或某阵营的已知单位，能否看见站在那里的目标。 */
interface HypotheticalSight { sees(observer: Combatant, target: Combatant): boolean; side(side: Side, target: Combatant): boolean }
interface WeaponContext {
  weapon: Combatant['weapon'];
  ranged: boolean;
  useSidearm: boolean;
  reason?: string;
  pointBlankPenalty: number;
  landing?: boolean;
}

/** 走回上次出发格的额外代价，约等于少前进一格（位置评分里每格路程 1.5）。 */
const BACKTRACK_COST = 1.5;
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
  /** 致命规则，战中经 setNonLethal 切换；单位上的 nonLethal 与之同步，供减员记账使用。 */
  get nonLethal(): boolean { return this.nonLethalRule; }
  private nonLethalRule: boolean;
  /** 改回致命时已经濒死的单位：倒在非致命阶段，战斗结束时不按旧战场补记阵亡。 */
  private sparedIds = new Set<string>();
  allyTactic: TacticalPreference = 'balanced';
  /** 玩家逐个单位设置的AI托管（单位 id → true 托管 / false 手动）；未列出的单位按面板默认。引擎只负责随战斗保存。 */
  allyAiControl = new Map<string, boolean>();
  commanderProfiles: CommanderProfiles = {};
  /** Optional diagnostic observer. Detached values only; never persisted or used by decisions. */
  aiTrace?: (event: Record<string, unknown>) => void;
  readonly battlefield?: BattlefieldSpec;
  movementSpent = new Map<string, number>();
  reactionSpent = new Set<string>();
  overwatch = new Set<string>();
  /** 阵营共享的近距离搜查记录；只由实际可见的己方位置更新。 */
  private searchCoverage: Partial<Record<Side, number[]>> = {};
  /** 阵营共享敌情记忆：最后目击与未定位来袭线索，只由各阵营当时的实际观测写入。 */
  private intel: IntelBook = {};
  /** 每个单位本次与上一次激活开始时所在格；AI 据此识别“走回上次出发的格子”。 */
  private activationStarts = new Map<string, { at: number; before?: number }>();
  /** V19 §1 本轮与上一轮的指挥记录：攻击过的目标、来袭者、回合开始时的位置。 */
  private commandRounds: CommandRound[] = [];
  /** 仅在同步只读菜单查询或自动行动选择期间存在；执行前释放。 */
  private observationMemo?: Map<Combatant['side'], Combatant[]>;
  /** Routes belong to one read-only query/decision, keyed by actor and movement budget. */
  private gridPathsMemo?: WeakMap<Combatant, Map<number, { paths: GridPath[]; byCell: Map<number, GridPath> }>>;
  controlRounds = { ally: 0, enemy: 0, neutral: 0 };
  controlHold?: { side: Side; sinceRound: number; lastCountedRound?: number };
  private controlReport?: BattleLogEntry['objective'];
  objectiveWinner?: Side | 'draw';
  diplomacy = emptyDiplomacy();
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
  private nonSkillActionAvailable(actorId: string): boolean { return (controlPolicy(this.byId(actorId)) !== 'charmed' || this.controlledExecution.has(actorId)) && !this.byId(actorId).conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn) && (!this.actedThisTurn.has(actorId) || this.hasteAvailable(actorId)); }
  private spendAction(actorId: string, haste = this.usingHaste(actorId)): void {
    if (haste) { this.hasteSpent.set(actorId, this.round); this.hasteSelected.delete(actorId); }
    else this.actedThisTurn.add(actorId);
  }
  private activateHasteMovement(actorId: string): void {
    if (!this.hasteSelected.has(actorId) || !this.hasteAvailable(actorId)) return;
    this.hasteMovement.set(actorId, this.movementBudget(actorId));
    this.hasteSpent.set(actorId, this.round); this.hasteSelected.delete(actorId);
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: this.byId(actorId).name + ' 使用加速动作' });
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
    this.nonLethalRule = opts.nonLethal === true;
    if (opts.battlefield) validateField(opts.battlefield);
    this.battlefield = opts.battlefield ? structuredClone(opts.battlefield) : undefined;
    if (this.battlefield) restoreOutdoorWallPlatforms(this.battlefield);
    this.combatants = opts.combatants;
    this.xpMinimum = initialXpStrength(this.combatants, true);
    this.xpInitialStrength = initialXpStrength(this.combatants, true);
    for (const unit of this.combatants) unit.nonLethal = this.nonLethal;
    for (const unit of this.combatants) { calibrateAutocannon(unit.weapon); calibrateAutocannon(unit.sidearm); calibrateWeaponHands(unit.weapon); calibrateWeaponHands(unit.sidearm); }
    for (const unit of this.combatants) {
      validateConcealment(unit.tacticalRevealed); validateFlightState(unit.airborne); validateWounded(unit); validateArmsState(unit); validateBarrier(unit.barrier); validateAreas(unit); validateGear(unit); validateMount(unit); validateMoraleState(unit.moraleState);
      if (unit.elevation !== undefined && (unit.elevation !== 1 || !this.battlefield?.layerVersion || unit.airborne || unit.pos !== undefined && !intactStructure(this.battlefield, unit.pos)?.top)) throw Error('平台站位数据不合法');
      if (unit.formationPosition !== undefined) throw new Error('实际会战阵位不能放入小战存档记录');
      if (unit.vanguardOrigin !== undefined) throw new Error('会战先锋来源不能放入小战存档记录');
    }
    this.rules = opts.rules ?? LITE_D20;
    for (const unit of this.combatants) { validateSkillModel(unit.skillModel); prepareSkillModel(unit, this.rules); }
    if(this.rules.combatModel)for(const unit of this.combatants){prepareCombatModel(unit,this.rules);upgradeCombatSkills(unit);reconcileDamageMorale(unit);}
    for (const unit of this.combatants) { prepareResourceModel(unit, this.rules); prepareArmsModel(unit, this.rules); prepareTraitModel(unit, this.rules); validateTraitModel(unit.traitModel); validateEntrenchment(unit.entrenchedAt); validateTacticalEffort(unit.tacticalEffort, unit.resourceModel); validateItemModel(unit.itemModel); prepareItemModel(unit, this.rules); validateTraitLevelModel(unit.traitLevelModel); prepareTraitLevelModel(unit, this.rules); prepareRevivalBattle(unit); }
    if (this.combatants.some((u) => u.airborne) && (!this.battlefield || this.rules.resolutionVersion !== 'v2')) throw new Error('空中状态需要二维战场');
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
    opts={...opts,...(['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '') ? { moved: opts.moved ?? (this.movedThisTurn.has(opts.attacker.id) || opts.attacker.movedDuringActivation) } : {}),...(this.battlefield?.spatialRulesVersion===2?{heightRules:true,attackerHeight:unitHeight(this.battlefield,opts.attacker),defenderHeight:unitHeight(this.battlefield,opts.defender),heightAdvantage:heightDefense(this.battlefield,opts.defender,opts.attacker)}:{})};
    const units = this.combatants.map((u) => u.id === opts.attacker.id ? opts.attacker : u.id === opts.defender.id ? opts.defender : u), context = this.observationContext(units);
    const situational = situationalTraitMods(context, opts.attacker, opts.defender, { ambush: (opts as { ambush?: boolean }).ambush ?? concealedUnit(context, opts.attacker),
      magic: opts.abilityDamage?.delivery === 'magic', ranged: !!opts.ranged, weapon: opts.weaponOverride ?? opts.attacker.weapon,
      flanked: () => units.some((u) => !combatHostile(u, opts.attacker, units) && u.id !== opts.attacker.id && u.status === 'ready' && meleeContact(this.battlefield, u, opts.defender) && this.dist(u, opts.defender) <= (this.battlefield ? 1 : 0)) });
    return { ...opts, extraMods: [...(opts.extraMods ?? []), ...moraleAttackMods(context, opts.attacker, this.traitRegistry, this.observationContext()), ...situational], localTerrain: !!this.battlefield?.layerVersion, defenderMods: [...(opts.defenderMods ?? []), ...(this.battlefield?.layerVersion ? [{ source: 'stance' as const, sourceId: 'structure:def', stackGroup: 'posture:def', category: 'cover' as const, name: '阵地掩护', kind: 'def' as const, type: 'flat' as const, value: structureDefense(this.battlefield, opts.defender, opts.attacker, !!opts.ranged) }] : [])], fieldTags: this.fieldTags, attackerTerrain: standingTerrain(this.battlefield, opts.attacker), defenderTerrain: standingTerrain(this.battlefield, opts.defender), distance: this.dist(opts.attacker, opts.defender),
      defenderEngaged: this.combatants.some((u) => combatHostile(u, opts.defender, units) && u.status === 'ready' && meleeContact(this.battlefield, u, opts.defender) && this.dist(u, opts.defender) <= (this.battlefield ? 1 : 0)) };
  }
  private resolveAttackWithEnvironment(opts: AttackOpts) {
    // 偷袭看出手前是否仍在潜伏，出手即暴露。
    const ambush = this.rules.resolutionVersion === 'v2' && concealedUnit(this.observationContext(), this.byId(opts.attacker.id));
    if (this.rules.resolutionVersion === 'v2' && !(isArmsV2(this.rules.armsModel) && ambush && (opts.weaponOverride ?? opts.attacker.weapon)?.recipe?.mechanism === 'crossbow')) revealUnit(this.observationContext(), this.byId(opts.attacker.id));
    const result = resolveAttack(this.environmentContext({ ...opts, ambush } as AttackOpts)), field = this.battlefield;
    if (!opts.abilityDamage || opts.abilityDamage.weaponBased) noteArmsFire(this.byId(opts.attacker.id), opts.weaponOverride ?? opts.attacker.weapon);
    breakCharmOnDamage(this.combatants, opts.defender, opts.attacker, result.hpBefore - result.hpAfter);
    if (reportsHeights(field) && opts.attacker.pos !== undefined && opts.defender.pos !== undefined && !isAirborne(opts.attacker) && !isAirborne(opts.defender))
      Object.assign(result, { attackerHeight: unitHeight(field, opts.attacker), defenderHeight: unitHeight(field, opts.defender) });
    if (this.rules.resolutionVersion === 'v2' && result.finalDamage > 0) revealUnit(this.observationContext(), this.byId(opts.defender.id));
    if (this.rules.resolutionVersion === 'v2' && result.hit) this.applyLifesteal(this.byId(opts.attacker.id), opts.defender, result.hpBefore - result.hpAfter);
    if (result.spray && result.hpBefore > result.hpAfter) { const fear = sprayerFear(this.observationContext(), opts.defender, result.spray, opts.attacker.id, this.rng); if (fear) result.text += '；' + fear; }
    if (result.hit && result.crit && !opts.autoHit) { const tank = this.ruptureTank(opts.defender, this.byId(opts.attacker.id)); if (tank) result.text += '；' + tank; }
    return result;
  }
  /** R16 喷射扇形：主目标在前，按扇形几何取同阵营单位，最多6个；烟幕不阻挡波及。 */
  private sprayVictims(attacker: Combatant, target: Combatant, units = this.combatants): Combatant[] {
    const cone = { area: { shape: 'cone', radius: 2, maxTargets: 6 } } as Combatant['abilities'][number];
    return areaTargets({ ...this.observationContext(), units }, attacker, target, cone, u => u.id !== attacker.id && sameLayer(u, target));
  }
  private sprays(weapon?: Combatant['weapon']): boolean { return isArmsV2(this.rules.armsModel) && !!this.battlefield && isSprayer(weapon); }
  /** R16 油箱爆炸：英雄对自己和1格内所有单位（含友军）结算一次本武器伤害，燃料清零；编队对自身另外波及3个名额，燃料−1。 */
  private ruptureTank(holder: Combatant, cause: Combatant): string | undefined {
    const tank = sprayerTank(holder, this.round); if (!tank) return undefined;
    holder.tankRupturedRound = this.round;
    spendSprayerFuel(holder, tank, holder.scale === 'hero' ? Infinity : 1);
    const victims = holder.scale === 'hero' ? this.combatants.filter(u => u.hp > 0 && ['ready', 'dying', 'routing'].includes(u.status) && sameLayer(u, holder) && this.dist(u, holder) <= 1) : [holder];
    const texts = [holder.name + '的燃料罐被击穿爆炸'];
    for (const victim of victims) {
      const blast = resolveAttack(this.environmentContext({ attacker: holder, defender: victim, weaponOverride: tank, ranged: true, autoHit: true, ...(holder.scale === 'hero' ? {} : { participants: 3 }),
        rng: this.rng, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry }));
      texts.push(blast.text); this.checkDeath(victim, cause);
    }
    return texts.join('；');
  }
  private applyLifesteal(attacker: Combatant, target: Combatant, lifeDamage: number): void {
    const restored = lifestealRecovery(attacker, target, lifeDamage, this.round);
    if (restored) this.recordEvent({ round: this.round, kind: 'condition', participants: [attacker.id], text: `${attacker.name} 吸血，回复${displayNumber(restored)}${hasMemberHealth(attacker) || attacker.scale === 'hero' ? '生命' : '名可救伤兵'}` });
  }
  private previewAttackWithEnvironment(opts: Parameters<typeof previewAttack>[0]) { return previewAttack(this.environmentContext(opts)); }

  byId(id: string): Combatant {
    const u = this.combatants.find((c) => c.id === id);
    if (!u) throw new Error(`单位不存在: ${id}`);
    return u;
  }

  /** 开始战斗：布阵、掷先攻并排序 */
  start(): void {
    for (const unit of this.combatants) delete unit.regenerationRemainder;
    if (this.started) return;
    for (const unit of this.combatants) { prepareRevivalBattle(unit, true); resetWornBarrier(unit); }
    assertBattleCapacity(this.combatants, 'small');
    if (this.battlefield) {
      const prepared = prepareGridDeployment(this.battlefield, this.combatants, this.seed, this.conditions, this.rules.resolutionVersion === 'v2');
      this.combatants.forEach((c, i) => { c.pos = prepared[i]!.pos; c.elevation = prepared[i]!.elevation; if (prepared[i]!.airborne !== undefined) c.airborne = prepared[i]!.airborne; });
    }
    this.started = true;
    if (isArmsV2(this.rules.armsModel)) for (const u of this.combatants) if (u.shield && !shieldUsable(u) && u.shieldDurability?.remaining !== 0) this.recordEvent({round:1,kind:'condition',participants:[u.id],text:u.name+'的'+(u.shield.name??'盾牌')+'挂在背上'});
    this.round = 1;
    for (const unit of this.combatants) { const text = grantEntryWornBarrier(unit, this.rules); if (text) this.recordEvent({round:1,kind:'condition',participants:[unit.id],text}); }
    for (const unit of this.combatants) beginLifestealRound(unit, this.round, true);
    for (const unit of this.combatants) {
      const restored = recoverEntryMorale(unit);
      if (restored) this.recordEvent({ round: 1, kind: 'morale', participants: [unit.id], text: `${unit.name} 开战前整顿，士气 0→${displayNumber(restored)}` });
    }
    for (const c of this.combatants) {
      if (c.pos === undefined) {
        c.pos = START_POS[c.side][c.archetype ?? 'infantry'] ?? 2;
      }
    }
    if (this.rules.resolutionVersion === 'v2') revealContacts(this.observationContext());
    // V13 工事：开战位置即阵地。
    for (const unit of this.combatants) entrench(unit, 'small');
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
    if (isCommandV2(this.rules)) {
      this.commandRounds = beginCommandRound([], 1, this.combatants, u => u.pos);
      for (const text of commandOpening(this.commanderProfiles, [...new Set(this.combatants.map(u => u.side))])) this.recordEvent({ round: 1, kind: 'rule', text });
    }
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
    const pa = a.pos ?? START_POS[a.side][a.archetype ?? 'infantry'] ?? 2;
    const pb = b.pos ?? START_POS[b.side][b.archetype ?? 'infantry'] ?? 2;
    return Math.abs(pa - pb);
  }

  /** 与最近存活敌人的距离（无敌人返回 Infinity） */
  distToNearestFoe(u: Combatant): number {
    const foes = this.visibleCombatants(u.side).filter((c) => combatHostile(c, u, this.combatants) && c.status === 'ready');
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

  movementBudget(actorId: string): number { const unit = this.byId(actorId), movement = movementPoints(unit, this.fieldTags); return movement + (unit.numericModel && movement > 0 ? unit.movementRemainder ?? 0 : 0); }
  flightRisks(actorId: string, airborne: boolean): string[] {
    if (!airborne) return [];
    const actor=this.byId(actorId);
    return this.visibleCombatants(actor.side).filter(foe=>combatHostile(foe, actor, this.combatants)&&foe.status==='ready'&&!isAirborne(foe)&&this.dist(actor,foe)===1&&!foe.suppression&&!this.reactionSpent.has(foe.id))
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
    this.movementSpent.set(actorId, (this.movementSpent.get(actorId) ?? 0) + 1); if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) actor.movedDuringActivation = true; this.movedThisTurn.add(actorId); delete actor.tacticalPose;
    if (airborne) for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
      const weapon = this.rules.resolutionVersion === 'v2' ? meleeWeapon(foe) : foe.sidearm ?? (!isRangedCapable(foe) ? foe.weapon : undefined);
      if (actor.status !== 'ready' || flightCapabilityReason(actor, this.conditions)) break;
      if (!controlReactionAllowed(foe, actor, this.combatants, this.dist(foe,actor)) || !combatHostile(foe, actor, this.combatants) || foe.status !== 'ready' || isAirborne(foe) || this.dist(actor, foe) !== 1 || !weapon || foe.suppression || this.reactionSpent.has(foe.id)) continue;
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
    for (const effect of healingEffectGroups(ability)) if (effect.op === 'dispel') applyDispel(affected, dispelCandidates(affected, effect));
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
      const lostHealth = hp - memberHealth(unit), lostMembers = members - unit.hp;
      if (cell !== undefined) unit.pos = cell;
      if (lostHealth > 0) this.checkDeath(unit, this.combatants.find((u) => u.id === this.flightCauses.get(unit.id)));
      if (cell === undefined) unit.status = unit.hp > 0 ? 'fled' : this.nonLethal ? 'dying' : 'dead';
      revealUnit(this.observationContext(), unit);
      this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], damage: {sourceId:this.flightCauses.get(unit.id),targetId:unit.id,amount:lostHealth,cause:'坠落',...(hasMemberHealth(unit)?{unit:'life' as const,members:lostMembers}:{})}, text: `${unit.name} ${reason}，${cell === undefined ? '附近无落点，紧急迫降离场' : '迫降至' + cellLabel(field, cell)}，坠落损失${displayNumber(lostHealth)}${hasMemberHealth(unit)?'生命':''}` });
    }
    this.flightCauses.clear();
  }
  private recordEvent(entry: BattleLogEntry): void {
    reconcileBattleControls(this.combatants);
    if (isCommandV2(this.rules)) noteCommandAttack(this.commandRounds, entry, this.combatants, true);
    for(const result of entry.resolutions?.length?entry.resolutions:[entry.resolution]) if(result&&result.hpAfter<=0) result.defenderStatus=this.nonLethal?'dying':'dead';
    entry.locations ??= Object.fromEntries((entry.participants ?? []).flatMap(id => { const u = this.combatants.find(c => c.id === id); return u?.pos === undefined ? [] : [[id, u.pos]]; }));
    if (this.rules.resolutionVersion !== 'v2') this.log.push(entry);
    else {
      const context = this.observationContext(), views = sideViews(context);
      this.log.push(observeEvent(context, entry, views));
      this.noteIntel(entry, views);
    }
    const depleted = new Set((entry.resolutions?.length ? entry.resolutions : entry.resolution ? [entry.resolution] : []).filter(r => r.barrierAbsorbed).map(r => r.defenderId));
    for (const id of depleted) {
      const unit = this.byId(id);
      if (!unit.barrier) this.recordEvent({ round: this.round, kind: 'condition', participants: [id], text: `${unit.name} 屏障耗尽` });
    }
    this.captureFeedback();
  }
  /** 阵营共享敌情：本事件里各阵营看得见的敌军刷新最后目击；看不见来源的命中留下来袭线索。 */
  private noteIntel(entry: BattleLogEntry, views: ReadonlyMap<Side, ReadonlySet<string>>): void {
    if (!this.battlefield) return;
    noteSightings(this.intel, this.combatants, views, entry.round,
      (u) => ({ cell: u.pos, ...(isAirborne(u) ? { layer: 'air' as const } : isElevated(u) ? { layer: 'top' as const } : {}) }), (u) => movementPoints(u, this.fieldTags));
    for (const result of entry.resolutions?.length ? entry.resolutions : [entry.resolution]) {
      const victim = result && this.combatants.find((u) => u.id === result.defenderId);
      if (!victim || victim.pos === undefined || victim.side === this.combatants.find((u) => u.id === result!.attackerId)?.side || views.get(victim.side)?.has(result!.attackerId)) continue;
      noteClue(this.intel, victim.side, { round: entry.round, victimId: victim.id, cell: victim.pos });
    }
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
        ...armsStatusLabels(u), ...(isAirborne(u) ? ['空中'] : []), ...(this.overwatch.has(u.id) ? ['警戒'] : []),
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
  /** 一名不潜伏的地面敌兵站在该格时本阵营能否看见；地图未观察遮罩与AI搜索用同一判定。 */
  cellVisible(side: Side, cell: number): boolean {
    if (this.rules.resolutionVersion !== 'v2') return true;
    const context = this.observationContext(), probe = this.sightProbe(side, cell);
    return this.combatants.some((u) => u.side === side && u.status === 'ready' && canSpot(context, u, probe));
  }
  /** 整张地图一次算完的 cellVisible。 */
  visibleCells(side: Side): boolean[] {
    const field = this.battlefield; if (!field) return [];
    if (this.rules.resolutionVersion !== 'v2') return field.tiles.map(() => true);
    const context = this.observationContext(), observers = this.combatants.filter((u) => u.side === side && u.status === 'ready');
    return field.tiles.map((_, cell) => { const probe = this.sightProbe(side, cell); return observers.some((u) => canSpot(context, u, probe)); });
  }
  private sightProbe(side: Side, cell: number): Combatant {
    return makeCombatant({ id: '', name: '', side: side === 'enemy' ? 'ally' : 'enemy', pos: cell, airborne: false,
      elevation: this.battlefield && intactStructure(this.battlefield, cell)?.top ? 1 : undefined });
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
    return this.gridPaths(actor, this.movementLeft(actorId)).paths;
  }
  private gridPaths(actor: Combatant, budget: number): { paths: GridPath[]; byCell: Map<number, GridPath> } {
    let budgets = this.gridPathsMemo?.get(actor), entry = budgets?.get(budget);
    if (!entry) {
      const field = this.battlefield!, known = this.visibleCombatants(actor.side);
      const paths = reachableGridPaths(field, actor.pos!, budget, n => canOccupy(field, known, actor, n),
        (n, from) => movementStepCost(field, n, actor, this.fieldTags, from), actor);
      entry = { paths, byCell: new Map(paths.map(p => [p.cells.at(-1)!, p])) };
      if (this.gridPathsMemo) {
        if (!budgets) { budgets = new Map(); this.gridPathsMemo.set(actor, budgets); }
        budgets.set(budget, entry);
      }
    }
    return entry;
  }
  /** sight：AI 估算假想落点时由调用方判断谁能在那里看见目标（只用已知单位）；缺省按此刻的实际观测。 */
  private sightReason(actor: Combatant, target: Combatant, indirect = false, sight?: HypotheticalSight): string | undefined {
    if (this.rules.resolutionVersion === 'v2' && sight) {
      // 攻击者自己看得见就同时满足“阵营已观测”；直射看不见即不能打，只有曲射才需要别的观察者。
      const own = !combatHostile(actor, target, this.combatants) || sight.sees(actor, target);
      if (!own && !indirect) return '当前单位无法观测目标';
      if (!own && !sight.side(actor.side, target)) return '间接火力缺少可见目标的观察者';
    } else if (this.rules.resolutionVersion === 'v2') {
      const context = this.observationContext();
      if (combatHostile(actor, target, this.combatants) && !this.visibleCombatants(actor.side).some((u) => u.id === target.id)) return '尚未观测到目标';
      if (combatHostile(actor, target, this.combatants) && !canSpot(context, actor, target) && !indirect) return '当前单位无法观测目标';
      if (indirect && !context.units.some((u) => !combatHostile(u, actor, this.combatants) && u.status === 'ready' && canSpot(context, u, target))) return '间接火力缺少可见目标的观察者';
    }
    if (!this.battlefield || unitLineOfSight(this.battlefield, actor, target)) return undefined;
    if (indirect && this.combatants.some((u) => !combatHostile(u, actor, this.combatants) && u.status === 'ready' && unitLineOfSight(this.battlefield!, u, target))) return undefined;
    return indirect ? '间接火力缺少可见目标的观察者' : '硬遮挡阻断视线';
  }
  private chargePath(actor: Combatant, target: Combatant): GridPath | undefined {
    const field = this.battlefield; if (!field) return undefined;
    if (field.layerVersion && !isAirborne(actor) && (meleeHeightReason(field, actor, target) || ['deep_water', 'shallow_water', 'swamp'].includes(field.tiles[actor.pos!]!))) return undefined;
    const known = this.visibleCombatants(actor.side), budget = this.movementLeft(actor.id, false);
    // Validate charging terrain after the normal shortest-route search, preserving its ties.
    const paths = this.gridPaths(actor, budget).byCell;
    return neighbors(field, target.pos!).map(cell => paths.get(cell))
      .filter((p): p is GridPath => !!p && (!field.layerVersion || isAirborne(actor) || p.cells.every(n => !['deep_water', 'shallow_water', 'swamp'].includes(field.tiles[n]!) && !field.overlays?.[n]?.includes('rubble') && intactStructure(field, n)?.kind !== 'fortification')) && p.cost + (isAirborne(actor) && !isAirborne(target) ? 1 : 0) <= budget && (sameLayer(actor, target) || canOccupy(field, known, { ...actor, airborne: false }, p.cells.at(-1)!)))
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
  /** R2 拒止：本次移动的起点与这一步的出发格都在2格外、这一步进入2格内。 */
  private denialSources(actor: Combatant, origin: number, from: number, to: number, spent = this.reactionSpent, units = this.visibleCombatants(actor.side)): Combatant[] {
    if (!this.battlefield || !isArmsV2(this.rules.armsModel) || isAirborne(actor)) return [];
    const arrival = {...actor,pos:to};
    return units.filter(holder => combatHostile(holder,actor,this.combatants) && denialReady(holder,this.conditionDefMap()) && !spent.has(holder.id)
      && !(holder.denialTriggered?.round === this.round && holder.denialTriggered.targets.includes(actor.id))
      && gridDistance(this.battlefield!,holder.pos!,origin)>2 && gridDistance(this.battlefield!,holder.pos!,from)>2 && gridDistance(this.battlefield!,holder.pos!,to)<=2 && sameLayer(holder,arrival)
      && canSpot(this.observationContext(),holder,arrival) && !this.weaponContext(holder,arrival,{weaponMode:meleeWeapon(holder)===holder.sidearm?'sidearm':'primary'}).reason);
  }
  private resolveDenials(actor: Combatant, origin: number, from: number, charging: boolean): void {
    for (const holder of this.denialSources(actor,origin,from,actor.pos!,this.reactionSpent,this.combatants).sort((a,b)=>a.id.localeCompare(b.id))) {
      if (actor.status !== 'ready') break;
      const watching = this.overwatch.has(holder.id);
      this.reactionSpent.add(holder.id); this.overwatch.delete(holder.id);
      if (holder.denialTriggered?.round !== this.round) holder.denialTriggered = {round:this.round,targets:[]};
      holder.denialTriggered!.targets.push(actor.id);
      const before = actor.scale === 'hero' ? memberHealth(actor) : actor.hp, weapon = meleeWeapon(holder)!;
      const result = this.resolveAttackWithEnvironment({attacker:holder,defender:actor,rng:this.rng,rules:this.rules,conditionDefs:this.conditionDefMap(),traitRegistry:this.traitRegistry,ranged:false,weaponOverride:weapon,opportunity:true,actionDamageScale:watching?this.hasteOverwatch.get(holder.id)??1:1,extraMods:denialModifiers(actor,charging,watching)});
      const interrupted = charging && (actor.scale === 'hero' ? result.finalDamage>0 : actor.hp<before);
      if (interrupted) actor.chargeInterrupted = true;
      this.recordEvent({round:this.round,kind:'attack',participants:[holder.id,actor.id],text:(watching?'警戒拒止反应｜':'拒止反应｜')+result.text+(interrupted?'；'+actor.name+'的冲锋被拒止，失去冲锋加成':''),resolution:result});
      if (result.hit) this.applyOnHitTraits(holder,actor,result); this.checkDeath(actor,holder);
    }
  }
  pathPreview(actorId: string, cell: number): { path?: GridPath; reason?: string; risks: string[] } {
    const field = this.battlefield; if (!field) return { reason: '不是二维战斗', risks: [] };
    const actor = this.byId(actorId);
    if (actor.status !== 'ready' || (this.started && !this.isTurnOf(actorId)) || this.isOver()) return { reason: '当前单位不能移动', risks: [] };
    const known = this.visibleCombatants(actor.side);
    const path = findGridPath(field, actor.pos!, cell, (n) => canOccupy(field, known, actor, n), (n, from) => movementStepCost(field, n, actor, this.fieldTags, from), actor);
    if (!path) return { reason: '路径受阻或落点容量不足', risks: [] };
    if (path.cost > this.movementLeft(actorId)) return { reason: '移动点不足', risks: [] };
    const denialRisks = isArmsV2(this.rules.armsModel) ? known.filter(holder => path.cells.slice(1).some((to,i)=>this.denialSources(actor,path.cells[0]!,path.cells[i]!,to,this.reactionSpent,known).some(u=>u.id===holder.id))).map(u=>u.name+'可能拒止一次') : [];
    const risks = known.filter((u) => combatHostile(u, actor, this.combatants) && u.status === 'ready' && !this.reactionSpent.has(u.id) && !u.suppression && !u.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack)
      && path.cells.slice(1).some((n, i) => {
        const previous = path.cells[i]!, ridingAway = agileDisengage(actor) || mountedShooting(actor) && deploymentDepth(field, actor.side, n) < deploymentDepth(field, actor.side, previous);
        return !ridingAway && !!meleeWeapon(u) && meleeContact(field,u,{...actor,pos:previous}) && gridDistance(field, u.pos!, previous) === 1 && (gridDistance(field, u.pos!, n) > 1||!meleeContact(field,u,{...actor,pos:n}))
          || this.overwatch.has(u.id) && !this.weaponContext(u, { ...actor, pos: n }).reason;
      }))
      .map((u) => u.name + '可能反应一次');
    return { path, risks: [...new Set([...risks,...denialRisks])] };
  }
  moveTo(actorId: string, cell: number, attackMovement = false): void {
    if (['charmed','confused'].includes(controlPolicy(this.byId(actorId)) ?? '') && !this.controlledExecution.has(actorId)) throw Error('控制期间由受约束AI行动');
    const preview = this.pathPreview(actorId, cell);
    if (!preview.path) throw new Error(preview.reason ?? '不能移动');
    this.walkPath(actorId, preview.path, { spend: true, haste: !attackMovement, opportunity: true, charging: attackMovement });
  }
  /** 沿已规划路线逐格移动，逐格结算区域、目标、侦察与反应。普通移动消耗移动点；技能位移按路线自带格数，
   *  不动用移动点；后撤（opportunity=false）不触发近战借机，仍受警戒。 */
  private walkPath(actorId: string, path: GridPath, opts: { spend: boolean; haste: boolean; opportunity: boolean; charging?: boolean; skill?: { verb: string; phase: 'before' | 'after' } }): void {
    const actor = this.byId(actorId); const field = this.battlefield!;
    let budget = path.cost;
    for (const next of path.cells.slice(1)) {
      if (actor.status !== 'ready' || actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventMove)) break;
      const stepCost = opts.spend ? movementStepCost(field, next, actor, this.fieldTags) : movementStepCost(field, next, actor, this.fieldTags, actor.pos);
      if (!movementNeighbors(field, actor.pos!, actor).includes(next) || stepCost > (opts.spend ? this.movementLeft(actorId) : budget)) break;
      if (!canOccupy(field, this.combatants, actor, next)) break;
      if (opts.haste) this.activateHasteMovement(actorId);
      const previous = actor.pos!, heights = reportsHeights(field) && !isAirborne(actor);
      const fromHeight = heights ? surfaceHeightAt(field, previous, actor) : undefined;
      delete actor.tacticalPose;
      actor.pos = next;
      if (opts.spend) this.movementSpent.set(actorId, (this.movementSpent.get(actorId) ?? 0) + stepCost); else budget -= stepCost;
      if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) actor.movedDuringActivation = true; this.movedThisTurn.add(actorId);
      this.settleAreaEffects(); if (actor.status !== 'ready') break;
      this.checkGridObjective(false);
      if (this.rules.resolutionVersion === 'v2') revealContacts(this.observationContext());
      const toHeight = heights ? surfaceHeightAt(field, next, actor) : undefined;
      this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id], move: { from: previous, to: next, ...(heights ? { fromHeight, toHeight } : {}), ...(opts.skill ? { skill: opts.skill.phase } : {}) },
        text: `${actor.name} ${opts.skill ? opts.skill.verb + ' ' : ''}${cellLabel(field, previous)}${fromHeight !== toHeight ? '(高度' + fromHeight + ')' : ''}→${reportPlaceLabel(field, next, actor)}` });
      this.resolveDenials(actor,path.cells[0]!,previous,!!opts.charging);
      for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
        if (actor.status !== 'ready') break;
        if (!controlReactionAllowed(foe, actor, this.combatants, this.dist(foe,actor)) || !combatHostile(foe, actor, this.combatants) || foe.status !== 'ready' || foe.suppression || this.reactionSpent.has(foe.id) || foe.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && baseMechanism(meleeWeapon(foe)) !== 'natural')) continue;
        const reactionWeapon = this.rules.resolutionVersion === 'v2' ? meleeWeapon(foe) : foe.sidearm ?? (!isRangedCapable(foe) ? foe.weapon : undefined);
        const ridingAway = !opts.opportunity || agileDisengage(actor) || mountedShooting(actor) && deploymentDepth(field, actor.side, next) < deploymentDepth(field, actor.side, previous);
        const opportunity = !ridingAway && !!reactionWeapon && meleeContact(field,foe,{...actor,pos:previous}) && gridDistance(field, foe.pos!, previous) === 1 && (gridDistance(field, foe.pos!, next) > 1||!meleeContact(field,foe,actor));
        const watching = this.overwatch.has(foe.id) && !this.weaponContext(foe, actor).reason;
        if (!opportunity && !watching) continue;
        this.reactionSpent.add(foe.id); this.overwatch.delete(foe.id);
        const context = this.weaponContext(foe, actor, { weaponMode: opportunity ? reactionWeapon === foe.sidearm ? 'sidearm' : 'primary' : 'auto' });
        // R16 警戒喷射同样覆盖扇形、消耗燃料。
        const spray = !opportunity && this.sprays(context.weapon);
        for (const victim of spray ? this.sprayVictims(foe, actor) : [actor]) {
          const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: victim, rng: this.rng, rules: this.rules,
            conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry,
            ...this.attackModifiers(foe, victim, context),
            actionDamageScale: !opportunity ? this.hasteOverwatch.get(foe.id) ?? 1 : 1,
            opportunity, ranged: !opportunity && context.ranged, weaponOverride: opportunity ? reactionWeapon : context.weapon });
          this.recordEvent({ round: this.round, kind: 'attack', text: (opportunity ? '借机' : '警戒') + '反应｜' + result.text, resolution: result });
          if (result.hit) this.applyOnHitTraits(foe, victim, result);
          this.checkDeath(victim, foe);
        }
        if (spray) spendSprayerFuel(foe, context.weapon);
        if (!opportunity && context.ranged && weaponReloadTurns(context.weapon)) this.reloadCd.set(weaponReloadKey(foe, context.weapon), weaponReloadTurns(context.weapon) + 1);
        this.resolveFlightStates();
      }
    }
    this.checkGridObjective(false);
  }
  braceReason(actorId: string): string | undefined {
    const actor = this.byId(actorId);
    if (!this.battlefield || actor.rulesVersion !== 'v2' || !this.isTurnOf(actorId) || actor.status !== 'ready' || this.isOver()) return '当前单位不能固守';
    if (!this.nonSkillActionAvailable(actorId)) return '本回合主行动已使用';
    if (isAirborne(actor)) return '空中不能固守，先降落';
    if (actor.suppression || actor.conditions.some((c) => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && baseMechanism(meleeWeapon(actor)) !== 'natural'))) return '受压制或失能时不能维持稳固姿态';
    return undefined;
  }
  braceDescription(actorId: string): string {
    const unit = this.byId(actorId);
    return '正面防御+2，移动或下次行动时解除' + (unit.combatModel === MEMBER_HEALTH_MODEL && unit.shield ? '；持盾时掩护同格队友' : '') + '。';
  }
  brace(actorId: string): void {
    const reason = this.braceReason(actorId); if (reason) throw new Error(reason);
    const actor = this.byId(actorId);
    const threat = this.combatants.filter((u) => combatHostile(u, actor, this.combatants) && u.status === 'ready' && !this.sightReason(actor, u))
      .sort((a, b) => this.dist(actor, a) - this.dist(actor, b) || a.id.localeCompare(b.id))[0];
    actor.tacticalPose = bracePose(actor, threat, 'small', this.battlefield!.width,this.battlefield!.height);
    this.spendAction(actorId); this.overwatch.delete(actorId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, ...(threat ? [threat.id] : [])], text: `${actor.name} 固守${threat ? '，面向' + threat.name : ''}` });
  }
  setOverwatch(actorId: string): void {
    const actor = this.byId(actorId);
    const reason = this.overwatchReason(actorId); if (reason) throw new Error(reason);
    if (this.usingHaste(actorId)) this.hasteOverwatch.set(actorId, hasteAttackScale(actor)); else this.hasteOverwatch.delete(actorId);
    this.spendAction(actorId); this.overwatch.add(actorId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id], text: `${actor.name} 警戒：共用一次反应额度` });
  }
  overwatchDescription(actorId: string): string {
    return denialReady(this.byId(actorId), this.conditionDefMap())
      ? '敌人进入2格触及范围时，拒止命中+2；范围内移动也可触发警戒攻击。与自动拒止、借机共用一次反应。'
      : '敌人在武器攻击范围内移动时反应攻击，占用本轮反应。';
  }
  overwatchReason(actorId: string): string | undefined {
    const actor = this.byId(actorId);
    if (!this.battlefield || !this.isTurnOf(actorId) || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId) || this.reactionSpent.has(actorId) || actor.suppression) return '当前没有警戒行动/反应额度';
    if (!actor.weapon && !actor.sidearm) return '没有可用于警戒的武器';
    if ([actor.weapon,actor.sidearm].filter(Boolean).every(w=>armsWeaponReason(actor,w))) return armsWeaponReason(actor,actor.weapon??actor.sidearm);
    if (actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && baseMechanism(meleeWeapon(actor)) !== 'natural')) return '当前状态禁止武器反应';
    return undefined;
  }
  suppress(actorId: string, targetId: string): void {
    const reason = this.suppressReason(actorId, targetId); if (reason) throw new Error(reason);
    const actor = this.byId(actorId); const target = this.byId(targetId);
    actor.resources.SP = (actor.resources.SP ?? 0) - 1; target.suppression = 2;
    addTacticalEffort(actor, 1);
    revealUnit(this.observationContext(), actor); revealUnit(this.observationContext(), target);
    this.spendAction(actorId); this.overwatch.delete(targetId);
    this.recordEvent({ round: this.round, kind: 'condition', participants: [actor.id, target.id], text: `${actor.name} 压制 ${target.name}，未造成伤亡` });
  }
  suppressReason(actorId: string, targetId?: string): string | undefined {
    const actor = this.byId(actorId), target = this.combatants.find((u) => u.id === targetId);
    if (!target || !combatHostile(target, actor, this.combatants) || target.status !== 'ready') return '选择可压制的敌方目标';
    const controlled = controlActionReason(actor,target,this.combatants,'skill'); if (controlled) return controlled;
    const context = this.weaponContext(actor, target);
    if (!this.battlefield || !this.isTurnOf(actorId) || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId) || !context.ranged || context.reason) return context.reason ?? '压制需要合法射击与主行动';
    if (actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack)) return '当前状态禁止射击';
    if ((actor.resources.SP ?? 0) < 1) return '压制需要1点战术资源';
    if (target.body === 'vehicle' && penetrationContext({ attacker: actor, defender: target,rules:this.rules }).factor === 0) return '火力对封闭车体不构成压制威胁';
    return undefined;
  }
  /** Shared pure validation used by the inspector, AI and execution. */
  structurePreview(actorId: string, cell: number, mode = 'primary', from?: number | Pick<Combatant, 'pos' | 'elevation' | 'airborne'>): { reason?: string; damage: number; coefficient?: number; actions?: number } {
    const actor = { ...this.byId(actorId), ...(typeof from === 'number' ? { pos: from } : from) }, field = this.battlefield;
    const fail = (reason: string) => ({ reason, damage: 0 });
    if (!field?.layerVersion || actor.pos === undefined || !this.isTurnOf(actorId) || actor.status !== 'ready' || this.isOver() || !this.nonSkillActionAvailable(actorId)) return fail('当前没有可用的破障行动');
    if (mode !== 'primary' && mode !== 'sidearm' && !mode.startsWith('ability:')) return fail('未知破障方式');
    const controlled = controlActionReason(actor,undefined,this.combatants,'weapon'); if (controlled) return fail(controlled);
    if (controlCondition(actor,'blinded') && this.dist(actor,{...actor,pos:cell}) > 1) return fail('致盲只能直接选择1格内目标');
    const target = intactStructure(field, cell); if (!target) return fail('此格没有完好的可破坏结构');
    const ability = mode.startsWith('ability:') ? actor.abilities.find(a => a.id === mode.slice(8)) : undefined;
    if (mode.startsWith('ability:') && !ability) return fail('技能不存在');
    const usesWeapon = !ability || ability.damageBasis === 'weapon';
    const weapon = ability ? usesWeapon ? skillWeapon(actor, ability) : undefined : mode === 'sidearm' ? actor.sidearm : actor.weapon;
    if (usesWeapon && !weapon) return fail('没有可用武器');
    const weaponReason = usesWeapon && armsWeaponReason(actor, weapon); if (weaponReason) return fail(weaponReason);
    if (actor.conditions.some(c => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn
      || usesWeapon && baseMechanism(weapon) !== 'natural' && this.conditions.get(c.id)?.preventAttack
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
      const breakdown = weaponBreachBudget(actor, weapon, {ranged, skillDelivery:ability?.delivery, moved:this.movedThisTurn.has(actorId), fieldTags:this.fieldTags, localTerrain:true, terrain:field.tiles[actor.pos!], damageChannel:ability?.channel ?? weapon?.channel}); budget = breakdown.damage; coefficient = breakdown.coefficient;
    }
    if (ability) {
      if (!ability.effects.some(e => e.op === 'damage') || ability.target === 'self' || ability.target === 'ally' || ability.damageBasis === 'shield') return fail('此技能没有可用于破障的直接伤害');
      if (this.actedThisTurn.has(actorId) || this.hasteSelected.has(actorId)) return fail('破障施法需要未使用的主行动');
      const reason = abilityUsabilityReason(actor, ability); if (reason) return fail(reason);
      const range = fallbackAbilityRange(actor, gridAbility(ability, actor.armsModel), true);
      if (range && (distance < range.min || distance > range.max)) return fail('结构不在技能射程内');
      const level = ability.power ?? ability.recipe?.power ?? 1;
      if (usesWeapon) {
        // A low-tier technique cannot amplify a high-tier weapon without its tier cap.
        // Generated weaponDamageMult already contains generic signed enhancements.
        const cap = Math.min(1, structureDurability('wall', level) / structureDurability('wall', weapon!.level ?? weapon!.recipe?.power ?? 1));
        const channel = bonusMultiplier(ability.bonuses, 'damage', weapon?.channel) / bonusMultiplier(ability.bonuses, 'damage');
        const single = singleWeaponSkillScale(actor, ability, this.rules);
        budget *= cap * (ability.weaponDamageMult ?? bonusMultiplier(ability.bonuses, 'damage')) * channel * single;
      } else {
        coefficient = ability.channel === 'thermal' ? .65 : 1;
        budget = structureDurability('wall', level) / 5 * coefficient * bonusMultiplier(ability.bonuses, 'damage', ability.channel) * independentSkillDamageScale(actor, ability, this.rules);
      }
    } else budget *= this.usingHaste(actorId) ? hasteAttackScale(actor) : 1;
    if (stackingRevision(actor) && !usesWeapon) budget *= structureTraitMultiplier(actor,undefined,{ranged,skillDelivery:ability?.delivery,fieldTags:this.fieldTags,localTerrain:true,terrain:field.tiles[actor.pos!],damageChannel:ability?.channel});
    if (!canSpot(this.observationContext(), actor, probe)) {
      if (!(usesWeapon && weapon?.indirect && knownStructureObserver(this, actor, cell))) return fail('障碍阻断结构射线');
    }
    const known = this.visibleCombatants(actor.side).filter(u => isElevated(u) === isElevated(actor));
    if (usesWeapon && ranged) {
      const screen = rangedScreen(actor, probe, weapon, known, { mode: 'small', width: field.width, battlefield: field }, this.conditionDefMap());
      if (screen) return fail(rangedScreenReason(screen));
      if (weapon?.pointBlankPolicy === 'forbid' && known.some(u => combatHostile(u, actor, this.combatants) && u.status === 'ready' && meleeContact(field, u, actor) && gridDistance(field, actor.pos!, u.pos!) <= 1)) return fail('被相邻敌军牵制，无法展开重火力');
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
    if (weapon && (!ability || ability.damageBasis === 'weapon')) { spendSprayerFuel(actor, weapon); noteArmsFire(actor, weapon); }
    const result = damageStructure(field, cell, preview.damage);
    revealUnit(this.observationContext(), actor); delete actor.tacticalPose;
    this.recordEvent({ round: this.round, kind: ability ? 'ability' : 'attack', participants: [actorId],
      structure: { cell, kind: target.kind, level: target.level, hpBefore: before, hpAfter: target.hp, hpMax: target.hpMax, destroyed: result.destroyed },
      text: `${actor.name} ${ability ? '使用【' + ability.name + '】' : '破障'}→${cellLabel(field, cell)} ${label} L${target.level}：结构耐久 ${displayNumber(before)}→${displayNumber(target.hp)}${result.destroyed ? '，形成突破口' : ''}` });
    this.resolveGroundStates(actor);
    revealContacts(this.observationContext()); this.checkGridObjective(false);
  }
  gateReason(actorId: string, cell: number): string | undefined {
    const field = this.battlefield, actor = this.byId(actorId), door = field && intactStructure(field, cell);
    if (!field?.layerVersion || !door || door.kind !== 'gate') return '此处没有可操作的门';
    if (!this.isTurnOf(actorId) || this.isOver() || actor.status !== 'ready' || !this.nonSkillActionAvailable(actorId)) return '开关门需要主行动';
    if (actor.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn)) return '失能状态不能操作门';
    return this.gatePositionReason(actor, cell, this.visibleCombatants(actor.side), this.combatants);
  }
  /** Topological access is also used for future route steps; action availability stays in gateReason. */
  private gatePositionReason(actor: Combatant, cell: number, known: Combatant[], occupants = known): string | undefined {
    const field = this.battlefield!, door = intactStructure(field, cell);
    if (!field.layerVersion || door?.kind !== 'gate') return '此处没有可操作的门';
    if (isAirborne(actor) || isElevated(actor) || actor.pos === undefined || gridDistance(field, actor.pos, cell) > 1) return '须在门旁地面操作';
    // Inner-side capture may take control; the exterior cannot remotely unlock a defended closed gate.
    // Between two walls each gate's inner side is where its stairs are: the passage for the outer gate, the town for the inner one.
    const innerSide = field.city?.terrace?.length && door.access?.length ? door.access : field.city?.inside;
    if (field.generation?.scene !== 'interior' && door.owner !== undefined && door.owner !== actor.side && !innerSide?.includes(actor.pos)) return '须从内部夺取门控位置';
    if (known.some(u => combatHostile(u, actor, this.combatants) && u.status === 'ready' && !isAirborne(u) && !isElevated(u) && gridDistance(field, u.pos!, cell) <= 1)) return '门区仍有敌军争夺，无法操作';
    if (door.gateState === 'open' && occupants.map(u => u.id === actor.id ? actor : u).some(u => u.pos === cell && !isAirborne(u) && !isElevated(u) && u.hp > 0 && ['ready', 'routing'].includes(u.status))) return '门洞有人，不能关门';
    return undefined;
  }
  toggleGate(actorId: string, cell: number): void {
    const reason = this.gateReason(actorId, cell); if (reason) throw Error(reason);
    const field = this.battlefield!, door = intactStructure(field, cell)!, actor = this.byId(actorId);
    door.gateState = door.gateState === 'open' ? 'closed' : 'open'; door.owner = actor.side;
    field.terrainRevision = (field.terrainRevision ?? 0) + 1; this.spendAction(actorId);
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], gate: { cell, state: door.gateState }, text: `${actor.name} ${door.gateState === 'open' ? '打开' : '关闭'} ${cellLabel(field, cell)}门，消耗主行动` });
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
      if (!controlReactionAllowed(foe, actor, this.combatants, this.dist(foe,actor)) || !combatHostile(foe, actor, this.combatants) || foe.status !== 'ready' || !melee || !sameLayer(foe, origin) || this.dist(foe, origin) !== 1
        || this.reactionSpent.has(foe.id) || foe.suppression) continue;
      const mode = melee === foe.sidearm ? 'sidearm' : 'primary';
      if (this.weaponContext(foe, actor, { weaponMode: mode }).reason) continue;
      this.resolveClimbReaction(foe, actor, mode, false);
    }
    if (actor.status !== 'ready') return;
    actor.elevation = arrival.elevation; actor.pos = cell; if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) actor.movedDuringActivation = true; this.movedThisTurn.add(actorId); delete actor.tacticalPose;
    this.recordEvent({ round: this.round, kind: 'move', participants: [actorId], text: `${actor.name} ${isElevated(actor) ? '登上城防平台' : '下至地面'} ${cellLabel(field, cell)}${reportsHeights(field) ? '(高度' + unitHeight(field, actor) + ')' : ''}，消耗主行动与${climbCost}移动` });
    this.settleAreaEffects(); revealContacts(this.observationContext());
    for (const foe of [...this.combatants].sort((a, b) => a.id.localeCompare(b.id))) {
      if (actor.status !== 'ready') break;
      if (combatHostile(foe, actor, this.combatants) && foe.status === 'ready' && !foe.suppression && this.overwatch.has(foe.id)
        && !this.reactionSpent.has(foe.id) && !this.weaponContext(foe, actor).reason) this.resolveClimbReaction(foe, actor, 'auto', true);
    }
    this.checkGridObjective(false);
  }
  private resolveClimbReaction(foe: Combatant, actor: Combatant, weaponMode: 'primary' | 'sidearm' | 'auto', watching: boolean): void {
    const context = this.weaponContext(foe, actor, { weaponMode });
    if (!controlReactionAllowed(foe, actor, this.combatants, this.dist(foe,actor))) return;
    this.reactionSpent.add(foe.id); this.overwatch.delete(foe.id);
    const spray = watching && this.sprays(context.weapon);
    for (const victim of spray ? this.sprayVictims(foe, actor) : [actor]) {
      const result = this.resolveAttackWithEnvironment({ attacker: foe, defender: victim, rng: this.rng, rules: this.rules,
        conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.attackModifiers(foe, victim, context),
        actionDamageScale: watching ? this.hasteOverwatch.get(foe.id) ?? 1 : 1, ranged: context.ranged, weaponOverride: context.weapon });
      this.recordEvent({ round: this.round, kind: 'attack', text: (watching ? '警戒' : '借机') + '反应｜' + result.text, resolution: result });
      if (result.hit) this.applyOnHitTraits(foe, victim, result);
      this.checkDeath(victim, foe);
    }
    if (spray) spendSprayerFuel(foe, context.weapon);
    if (context.ranged && weaponReloadTurns(context.weapon)) this.reloadCd.set(weaponReloadKey(foe, context.weapon), weaponReloadTurns(context.weapon) + 1);
    this.resolveFlightStates();
  }
  /** Wall/bridge collapse and expiring movement traits cannot leave a unit in an impossible cell. */
  private resolveGroundStates(source?: Combatant): void {
    const field = this.battlefield; if (!field?.layerVersion) return;
    for (const unit of this.combatants.filter(u => !isAirborne(u))) {
      if (!groundBlocked(field, unit.pos!, unit)) continue;
      // 伤亡与已撤离单位不再结算落地伤害，但不能继续引用已经塌毁的平台。
      if (unit.hp <= 0 || !['ready', 'routing'].includes(unit.status)) { delete unit.elevation; continue; }
      const originalHeight=unitHeight(field,unit);
      const origin = unit.pos!, ground = { ...unit, elevation: undefined };
      // Rescue can traverse nearby water, never teleport through an intact wall, cliff or enemy.
      const rescue = { ...ground, traits: [...ground.traits, 'water-crossing'] };
      const candidates = reachableGridPaths(field, origin, 2, n => canOccupy(field, this.combatants, rescue, n), () => 1, rescue)
        .filter(path => canOccupy(field, this.combatants, ground, path.cells.at(-1)!)&&(field.spatialRulesVersion!==2||unitHeight(field,{...ground,pos:path.cells.at(-1)!})<=originalHeight))
        .sort((a, b) => a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!).map(path => path.cells.at(-1)!);
      const wasHigh = isElevated(unit); unit.elevation = undefined;
      if (candidates.length) unit.pos = candidates[0];
      else { unit.status = 'fled'; this.recordEvent({ round: this.round, kind: 'move', participants: [unit.id], text: unit.name + ' 失去立足点，无法就近落地，退出本次战斗' }); continue; }
      const drop=field.spatialRulesVersion===2?Math.max(1,originalHeight-unitHeight(field,unit)):1;
      const loss = applyCombatDamage(unit, Math.max(1, Math.round(memberHealth(unit) * (wasHigh ? Math.min(.4,.15*drop) : .1))), hasMemberHealth(unit) ? unit.hp : 1);
      this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], text: `${unit.name} ${wasHigh ? '随结构塌落' : '落水撤向近岸'}至${cellLabel(field, unit.pos!)}，损失${displayNumber(loss)}生命` });
      this.checkDeath(unit, source);
    }
  }

  private recordControlObjective(next: NonNullable<BattleLogEntry['objective']>): void {
    const previous = this.controlReport;
    this.controlReport = next;
    if (previous && previous.cell === next.cell && previous.side === next.side && previous.contested === next.contested && previous.progress === next.progress && previous.required === next.required) return;
    if (!previous && !next.side && !next.contested && !next.progress) return;
    const point = cellLabel(this.battlefield!, next.cell) + '目标点';
    const side = next.side === 'ally' ? '我方' : next.side === 'enemy' ? '敌方' : '第三方';
    const progress = `连续控制${next.progress}/${next.required}轮`;
    const text = next.contested ? `${point}发生争夺，${next.side ? '暂停计时，' + side + progress : '占领中断，进度重置为0/' + next.required + '轮'}`
      : next.side ? `${side}${previous?.contested ? '恢复控制' : previous?.side === next.side ? '控制' : '开始占领'}${point}，${progress}`
      : `${point}失去占领，进度重置为0/${next.required}轮`;
    this.recordEvent({ round: this.round, kind: 'objective', objective: next, text });
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
      if (!hasAttacker) { this.controlRounds = { ally: 0, enemy: 0, neutral: 0 }; this.controlHold = undefined; }
      else {
        if (!this.controlHold || this.controlHold.side !== attacker) this.controlHold = { side: attacker, sinceRound: this.round };
        if (roundEnd && !contested && this.round > this.controlHold.sinceRound && this.controlHold.lastCountedRound !== this.round) {
          this.controlRounds[attacker]++; this.controlHold.lastCountedRound = this.round;
          if (this.controlRounds[attacker] >= goal.rounds) this.objectiveWinner = attacker;
        }
      }
      this.recordControlObjective({ cell: goal.cell, side: hasAttacker ? attacker : undefined, contested: hasAttacker && contested, progress: this.controlRounds[attacker], required: goal.rounds });
    } else if (goal.kind === 'control') {
      const cells = goal.cells ?? [goal.cell];
      const eligible = this.combatants.filter(u=>u.status==='ready'&&!isAirborne(u)&&!isElevated(u)&&!u.conditions.some(c=>c.dur>0&&this.conditions.get(c.id)?.skipTurn));
      const occupants = eligible.filter(u=>cells.includes(u.pos!));
      const sides = new Set(eligible.filter(u=>cells.some(p=>gridDistance(this.battlefield!,u.pos!,p)<=1)).map(u=>u.side));
      const owner = (['ally', 'enemy', 'neutral'] as const).find((side) => (!goal.attackingSide || goal.attackingSide === side)
        && occupants.some((u) => u.side === side) && sides.size === 1 && sides.has(side));
      if (!owner) { this.controlRounds = { ally: 0, enemy: 0, neutral: 0 }; this.controlHold = undefined; }
      else {
        if (this.controlHold?.side !== owner) {
          this.controlRounds = { ally: 0, enemy: 0, neutral: 0 }; this.controlHold = { side: owner, sinceRound: this.round };
        }
        // 占点当轮不足完整一轮；按全体单位轮末计一次，保存恢复不重置或补算。
        if (roundEnd && this.round > this.controlHold.sinceRound && this.controlHold.lastCountedRound !== this.round) {
          this.controlRounds[owner]++; this.controlHold.lastCountedRound = this.round;
          if (this.controlRounds[owner] >= goal.rounds) this.objectiveWinner = owner;
        }
      }
      this.recordControlObjective({ cell: goal.cell, side: owner, contested: occupants.length > 0 && sides.size > 1
        && (!goal.attackingSide || occupants.some(u => u.side === goal.attackingSide)), progress: owner ? this.controlRounds[owner] : 0, required: goal.rounds });
    }
    if (roundEnd && this.round >= goal.limit && !this.objectiveWinner) this.objectiveWinner = goal.kind === 'control' && goal.attackingSide
      ? goal.attackingSide === 'ally' ? 'enemy' : 'ally' : 'draw';
    if (this.objectiveWinner) this.recordEvent({ round: this.round, kind: 'battle-end', text: smallBattleResult(this) ?? `任务结束：${this.objectiveWinner}` });
  }

  private weaponContext(
    actor: Combatant,
    target: Combatant,
    opts: Pick<SmallAttackOpts, 'charge' | 'ranged' | 'weaponMode'> & { controlRecipient?: boolean } = {},
    shieldingUnits = this.visibleCombatants(actor.side),
    sight?: HypotheticalSight,
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
        const primaryReason = armsWeaponReason(actor, actor.weapon) ?? weaponTargetReason({ actor, target, units: this.combatants, controlRecipient: opts.controlRecipient, weapon: adapt(actor.weapon), ranged: primaryRanged, distance, reloadLeft: this.reloadCd.get(actor.id) ?? 0, field: this.battlefield });
        const secondaryReason = actor.sidearm && (armsWeaponReason(actor, actor.sidearm) ?? weaponTargetReason({ actor, target, units: this.combatants, controlRecipient: opts.controlRecipient, weapon: adapt(actor.sidearm), ranged: isRangedWeapon(actor.sidearm), distance, reloadLeft: this.reloadCd.get(weaponReloadKey(actor, actor.sidearm)) ?? 0, field: this.battlefield }));
        useSidearm = !!actor.sidearm && !secondaryReason && (!!primaryReason || primaryRanged && !isRangedWeapon(actor.sidearm) && meleeContact(this.battlefield, actor, target) && distance <= (this.battlefield ? 1 : 0));
      }
    }
    const originalWeapon = useSidearm ? actor.sidearm : actor.weapon;
    const weapon = this.battlefield ? gridWeapon(originalWeapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel) : originalWeapon;
    const ranged = this.rules.resolutionVersion === 'v2' ? isRangedWeapon(originalWeapon) : useSidearm ? isRangedWeapon(originalWeapon) : primaryRanged;
    const blocked = actor.conditions.some((c) => this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventAttack && baseMechanism(weapon) !== 'natural');
    let reason = (blocked ? '当前状态禁止武器攻击' : undefined) ?? armsWeaponReason(actor, originalWeapon) ?? weaponTargetReason({
      actor,
      target,
      weapon,
      ranged,
      distance,
      reloadLeft: this.reloadCd.get(weaponReloadKey(actor, originalWeapon)) ?? 0,
      units: this.combatants, controlRecipient: opts.controlRecipient,
      charge: !!opts.charge,
      field: this.battlefield,
    });
    if (this.rules.resolutionVersion === 'v2' && (sight ? opts.charge && !sight.sees(actor, target) && !sight.side(actor.side, target) : !this.visibleCombatants(actor.side).some((u) => u.id === target.id))) reason = opts.charge ? '冲锋目标尚未观测到（视线或距离受限）' : '尚未观测到目标（视线或距离受限）';
    if (['blinded','charmed','confused'].some(id => controlCondition(actor, id)) && !canSpot(this.observationContext(), actor, target)) reason = '必须以自身感知直接观测目标';
    if (!reason && this.battlefield && !opts.charge) reason = this.sightReason(actor, target, weapon?.indirect, sight);
    if (!reason && this.battlefield && !ranged && !opts.charge && this.rules.combatModel === MEMBER_HEALTH_MODEL) {
      const blocker = meleeLineBlocker(this.battlefield, actor, target, shieldingUnits);
      if (blocker) reason = `近战攻击被${blocker.name}阻挡；长兵器可越过友军，不能越过存活敌军`;
    }
    if (!reason && this.battlefield && !ranged) reason = meleeHeightReason(this.battlefield, actor, target);
    if (!reason && this.battlefield && ranged) {
      const guard = rangedScreen(actor, target, weapon, shieldingUnits, { mode: 'small', width: this.battlefield.width, battlefield: this.battlefield }, this.conditionDefMap());
      if (guard) reason = rangedScreenReason(guard);
    }
    if (!reason && this.battlefield && ranged && weapon?.pointBlankPolicy === 'forbid' && this.combatants.some((u) => combatHostile(u, actor, this.combatants) && u.status === 'ready' && meleeContact(this.battlefield, actor, u) && this.dist(actor, u) === 1)) reason = '被相邻敌人牵制，该武器不能抵近射击';
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
    const foes = this.combatants.filter((c) => combatHostile(c, actor, this.combatants) && c.status === 'ready');
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
    if (opts.charge && opts.chargeStraight === undefined) opts = { ...opts, chargeStraight: !this.battlefield || straightGridPath(this.chargePath(attacker, target)?.cells ?? [], this.battlefield.width) };
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
    if (!isAirborne(target) && this.battlefield?.tiles[target.pos!] === 'cover' && this.dist(attacker, target) > 1) defenderMods.push({ source: 'stance', category: 'cover' as const, name: '掩体', kind: 'def', type: 'flat', value: 2 });
    if (attacker.suppression) extraMods.push({ source: 'condition', name: '受压制', kind: 'atk', type: 'flat', value: -2 });
    // 移动后射击惩罚（骑射免疫）；副武器换击/冲锋近战不算射击
    if (
      rangedAttack &&
      !opts.charge &&
      this.movedThisTurn.has(attackerId) &&
      !(this.rules.resolutionVersion === 'v2' ? steadyMovingShot(attacker, context.weapon) : hasFlag(attacker, 'mounted-archer', this.traitRegistry))
    ) {
      extraMods.push({ source: 'stance', category: 'movement' as const, name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
    }

    const width = engagementWidth(attacker, target, context.ranged, this.battlefield, this.fieldTags);
    const participants = this.battlefield || this.rules.combatModel ? sharedParticipants(attacker, this.combatants.filter((u) => u.pos === attacker.pos && sameLayer(u, attacker)), width, target, context.ranged) : width;
    return { chargeDistance: opts.chargeDistance, chargeStraight: opts.chargeStraight, extraMods, defenderMods, participants };
  }

  /** 当前公开属性下的无随机数攻击预览；实际结算仍走 resolveAttack。 */
  private weaponPreview(actor: Combatant, target: Combatant, context: WeaponContext): NonNullable<ActionOption['preview']> {
    if (this.rules.resolutionVersion === 'v2') {
      const arrival = context.landing ? { ...actor, airborne: false } : actor;
      const preview = (defender: Combatant) => this.previewAttackWithEnvironment({ attacker: arrival, defender, rules: this.rules,
        conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon,
        ranged: context.ranged, actionDamageScale: this.usingHaste(actor.id) ? hasteAttackScale(actor) : 1, ...this.attackModifiers(arrival, defender, context) });
      // R16 喷射：列出扇形内各目标及各自的预览。
      const cone = this.sprays(context.weapon) ? this.sprayVictims(arrival, target, this.visibleCombatants(actor.side)) : [];
      return { ...preview(target), ...(context.landing ? { movementCost: 1, lands: true } : {}),
        ...(cone.length > 1 ? { areaTargets: cone.map(u => u.name), areaTargetIds: cone.map(u => u.id), areaPreviews: cone.map(u => ({ targetId: u.id, ...preview(u) })) } : {}) };
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

  /** 同步只读查询共用观测、路线和抽样参数；回调内不得执行动作、修改战场或等待异步操作。 */
  withReadOnlyQueries<T>(query: () => T): T {
    // Menu queries also evaluate every charge target. Share one bounded route search
    // and table serialization across those previews, just as AI evaluation does.
    // Keep an enclosing evaluation's caches; only dispose scopes created here.
    const ownObservation = !this.observationMemo, ownRoutes = !this.gridPathsMemo;
    const ownPreviews = previewScopeEpoch() === undefined;
    if (ownObservation) this.observationMemo = new Map();
    if (ownRoutes) this.gridPathsMemo = new WeakMap();
    if (ownPreviews) beginPreviewScope();
    try { return query(); }
    finally {
      if (ownObservation) this.observationMemo = undefined;
      if (ownRoutes) this.gridPathsMemo = undefined;
      if (ownPreviews) endPreviewScope();
    }
  }
  /** 面板/AI 的结构化动作菜单；不可用项保留并附原因。 */
  getActionOptions(actorId: string): ActionOption[] {
    return this.withReadOnlyQueries(() => this.buildActionOptions(actorId));
  }
  private buildActionOptions(actorId: string): ActionOption[] {
    const actor = this.byId(actorId);
    const economy = this.getTurnEconomy(actorId);
    const actorReason = controlPolicy(actor)==='charmed' && !this.controlledExecution.has(actorId) ? '魅惑期间由受约束AI行动' : actor.status !== 'ready'
      ? actor.name + ' 无法行动（' + actor.status + '）'
      : this.started && !this.isTurnOf(actorId)
        ? '现在不是 ' + actor.name + ' 的回合'
        : undefined;
    const foes = this.visibleCombatants(actor.side).filter((c) => combatHostile(c, actor, this.combatants) && c.status !== 'dead' && c.status !== 'fled');
    const weaponFoes = this.visibleCombatants(actor.side).filter(c => attackHostile(actor,c,this.combatants) && !['dead','fled'].includes(c.status));
    const attackTargets = weaponFoes.map((target) => {
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
    const sidearmTargets = actor.sidearm ? weaponFoes.map((target) => {
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
        ...this.attackModifiers(arrival, target, context, { charge: true, ...(isArmsV2(this.rules.armsModel) ? {chargeDistance:path ? path.cells.length-1 : this.dist(actor,target), chargeStraight:path && this.battlefield ? straightGridPath(path.cells,this.battlefield.width) : true} : {}) }) }) : undefined;
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
    for (const listedAbility of actor.abilities) {
      const ability = listedAbility;
      const usability = abilityUsabilityReason(actor, ability) ?? this.summonReason(actor, ability);
      const candidates = ability.target === 'enemy'
        ? foes
        : ability.target === 'ally'
          ? this.combatants.filter((c) => !combatHostile(c, actor, this.combatants) && c.status !== 'dead' && c.status !== 'fled')
          : ability.target === 'self'
            ? [actor]
            : movementOnlySkill(ability) && this.battlefield ? (() => { const context = this.observationContext(); return this.skillLandingCells(actor, ability).flatMap((cell) => { const at = zoneTarget(context, actor, 'cell:' + cell); return at ? [at] : []; }); })()
            : ability.effects.some(e=>e.op==='zone') && this.battlefield ? (() => { const context=this.observationContext(), view=this.visibleCells(actor.side); return this.battlefield!.tiles.flatMap((_tile,cell)=>{ const at=view[cell]&&zoneTarget(context,actor,'cell:'+cell); return at?[at]:[]; }); })() : [];
      const targets = candidates.map((target) => {
        // V15 编队用道具按件数折算；预览与实际使用同一份派生行动。
        const itemUse = this.itemUse(actor, listedAbility, target), ability = itemUse.ability;
        const targetReason = this.skillTargetReason(actor, ability, target);
        const reason = actorReason ?? (quickItemAction(actor, ability) ? !economy.actionAvailable ? '本回合行动已使用' : undefined : this.hasteSelected.has(actorId) ? ability.itemSourceId ? '加速动作只能使用喝、敷类道具' : '加速动作不能使用技能' : this.actedThisTurn.has(actorId) ? '本回合主行动已使用' : undefined) ?? usability ?? targetReason ?? itemUse.reason;
        const damage = ability.effects.find((e) => e.op === 'damage');
        const healing = ability.effects.find((e) => e.op === 'heal');
        const moraleEffect = ability.effects.find((e) => e.op === 'morale');
        const landing = !reason ? this.abilityFlightPreview(actor, target, ability) : undefined;
        // 带突进/闪现的技能从落点出手：预览、范围与描述都按到位后的施术者计算。
        const move = !reason && !movementOnlySkill(ability) ? this.skillMovePlan(actor, ability, target).move : undefined;
        const caster = move ? { ...actor, pos: move.to } : actor;
        const area = (this.rules.areaTargetingModel === 'impact-v1' && ability.area || (damage?.shape ?? ability.shape) === 'burst') && !reason ? this.abilityDamageTargets(caster, target, ability, true) : [];
        const supportArea = canAnchorArea(ability, this.rules) && area.length > 0 && !damage;
        const effects = !reason && this.rules.resolutionVersion === 'v2' ? [...(move && this.battlefield ? [(move.mode === 'dash' ? '先突进至' : '先闪现至') + reportPlaceLabel(this.battlefield, move.to, actor) + (move.charge ? '，以冲锋接敌' : '')] : []),
          ...(supportArea ? areaSkillEffectLines({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, caster, area, ability)
            : skillEffectLines({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, caster, target, ability))] : [];
        const preview = !reason && this.rules.resolutionVersion === 'v2' && damage ? this.previewAttackWithEnvironment({ attacker: caster, defender: target, rules: this.rules,
          conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ranged: damage.tag === 'ranged' ? true : undefined,
          ...this.skillAttackOptions(caster, target, ability, damage, !!move, move?.charge) })
          : healing && !reason ? { healing: (supportArea ? area : [target]).reduce((sum, affected) => sum + Math.min(recoveryCapacity(affected), healingYield(actor, affected, healing.amount ?? diceAvg(healing.dice!), !!ability.itemSourceId, healing.power)), 0) } : moraleEffect && !reason ? moraleChangePreview({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, target, moraleEffect.amount, this.rules.morale.breakAt, this.traitRegistry, ability.effects.flatMap((e) => e.op === 'condition' ? [{ id: e.conditionId, dur: e.dur }] : [])) : undefined;
        const areaPreviews = damage && this.rules.resolutionVersion === 'v2' ? area.map((affected) => ({
          targetId: affected.id, ...this.previewAttackWithEnvironment({ attacker: caster, defender: affected, rules: this.rules,
            conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(caster, affected, ability, damage, !!move, move?.charge && affected.id === target.id) }),
        })) : [];
        return { targetId: target.id, enabled: !reason, ...(reason ? { reason } : {}), distance: this.dist(actor, target), rangeDistance: abilityRangeDistance(actor, this.battlefield ? gridAbility(ability, actor.armsModel) : ability, target, this.dist(actor, target)), ...(abilityHeightReach(actor, ability, target, this.dist(actor, target), this.battlefield) ? { heightReach: abilityHeightReach(actor, ability, target, this.dist(actor, target), this.battlefield) } : {}), ...(preview || landing || effects.length ? { preview: { ...preview, ...landing, ...(effects.length ? { effects } : {}), ...(area.length ? { areaTargets: area.map((u) => u.name), areaTargetIds: area.map((u) => u.id), areaPreviews } : {}) } } : {}) };
      });
      const targetlessReason = actorReason ?? (quickItemAction(actor, ability) ? !economy.actionAvailable ? '本回合行动已使用' : undefined : this.hasteSelected.has(actorId) ? ability.itemSourceId ? '加速动作只能使用喝、敷类道具' : '加速动作不能使用技能' : this.actedThisTurn.has(actorId) ? '本回合主行动已使用' : undefined) ?? usability;
      const enabled = candidates.length ? targets.some((target) => target.enabled) : !targetlessReason;
      options.push({
        id: ability.id,
        kind: 'ability',
        label: ability.name,
        enabled,
        ...(!enabled ? { reason: targets[0]?.reason ?? targetlessReason ?? '没有合法目标' } : {}),
        ...(targets.length ? { targets } : {}),
        range: fallbackAbilityRange(actor, this.battlefield ? gridAbility(ability, actor.armsModel) : ability, !!this.battlefield),
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
    if (controlPolicy(attacker) === 'charmed' && !this.controlledExecution.has(attackerId)) throw Error('魅惑期间由受约束AI行动');
    if (!opts.bypassTurn && this.started && !this.isTurnOf(attackerId)) {
      throw new Error(`现在不是 ${attacker.name} 的回合`);
    }
    if (attacker.status !== 'ready') throw new Error(`${attacker.name} 无法行动（${attacker.status}）`);
    if (!opts.bypassTurn && !this.nonSkillActionAvailable(attackerId)) throw new Error('本回合主行动已使用');
    if (!this.battlefield && !opts.bypassTurn && opts.charge && this.movedThisTurn.has(attackerId)) throw new Error('本回合移动额度已使用，无法再冲锋');

    const hasteAction = !opts.bypassTurn && this.usingHaste(attackerId);
    const hasteScale = hasteAction ? hasteAttackScale(attacker) : 1;
    const d = this.dist(attacker, target);
    if(opts.charge && !this.battlefield && isArmsV2(this.rules.armsModel))opts={...opts,chargeDistance:d,chargeStraight:true};
    const context = this.weaponContext(attacker, target, opts);
    if (context.reason) throw new Error(context.reason);
    delete attacker.tacticalPose;
    if ((this.battlefield || attacker.resourceModel) && attacker.rulesVersion === 'v2' && !opts.bypassTurn) addTacticalEffort(attacker, opts.charge ? 2 : 1);
    if (opts.charge && this.battlefield) {
      delete attacker.chargeInterrupted;
      opts = { ...opts, chargeDistance: this.chargePath(attacker,target)!.cells.length-1, chargeStraight: straightGridPath(this.chargePath(attacker, target)!.cells, this.battlefield.width) };
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
    // R16 喷射武器一次覆盖扇形内各目标，逐个判定命中；其余武器只打主目标。
    const victims = this.sprays(activeWeapon) ? this.sprayVictims(attacker, target) : [target];
    for (const victim of victims) {
      for (let i = 0; i < times; i++) {
        if (victim.status !== 'ready' && victim.status !== 'dying' && victim.status !== 'routing') break;
        if (i > 0 && this.weaponContext(attacker, victim, { ...opts, charge: false }).reason) break;
        const { extraMods, defenderMods, participants } = this.attackModifiers(attacker, victim, context, opts);
        const res = this.resolveAttackWithEnvironment({
          attacker,
          defender: victim,
          participants,
          actionDamageScale: hasteScale,
          rng: this.rng,
          rules: this.rules,
          conditionDefs: this.conditionDefMap(),
          traitRegistry: this.traitRegistry,
          extraMods,
          defenderMods,
          charge: opts.charge, chargeStraight: opts.chargeStraight, chargeDistance: opts.chargeDistance,
          ranged: rangedAttack,
          weaponOverride: context.useSidearm ? attacker.sidearm : undefined,
          advantage: opts.advantage,
        });
        last = res;
        shots.push(res);
        // 冲锋贴身：无论命中与否都冲至目标坐标
        if (opts.charge && !this.battlefield) {
          attacker.pos = victim.pos;
          if (['traits-levels-v2','traits-items-v1','traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) attacker.movedDuringActivation = true; this.movedThisTurn.add(attackerId);
        }
        // 命中特效特质（毒击等）
        if (res.hit && (this.rules.resolutionVersion === 'v2' || res.finalDamage > 0)) {
          this.applyOnHitTraits(attacker, victim, res);
        }
        const wpnShort = activeWeapon ? tbWeaponShortName(activeWeapon) : '';
        const prefix = wpnShort ? (times > 1 ? `［${wpnShort}·${i + 1}/${times}］` : `［${wpnShort}］`) : (times > 1 ? `［${i + 1}/${times}］` : '');
        this.recordEvent({ round: this.round, kind: 'attack', text: prefix + res.text, resolution: res });
        this.checkDeath(victim, attacker);
        this.checkInjury(victim, res.finalDamage); this.resolveFlightStates();
      }
    }
    if (this.sprays(activeWeapon)) spendSprayerFuel(attacker, activeWeapon);

    // 发射后进入装填（+1 缓冲：抵消本回合结束后的首次递减，reload=1 即隔回合发射）；
    // 只写入实际发射的武器槽，另一槽的计时保持独立。
    const reload = weaponReloadTurns(activeWeapon);
    this.resolveFlightStates();
    if (reload > 0 && rangedAttack) this.reloadCd.set(weaponReloadKey(attacker, activeWeapon), reload + 1);
    if (!opts.bypassTurn) this.spendAction(attackerId, hasteAction);
    if (victims.length > 1) return shots[0]!;
    if (shots.length < 2) return last!;
    const first = shots[0]!, total = shots.reduce((sum,r)=>sum+r.finalDamage,0);
    return { ...last!, hit: shots.some(r=>r.hit), crit: shots.some(r=>r.crit), hpBefore: first.hpBefore, hpAfter: last!.hpAfter,
      membersBefore: first.membersBefore, membersAfter: last!.membersAfter, defenderStatus: target.status, finalDamage: total,
      directDamage: shots.reduce((s,r)=>s+(r.directDamage??0),0), splashDamage: shots.reduce((s,r)=>s+(r.splashDamage??0),0),
      barrierAbsorbed: shots.reduce((s,r)=>s+(r.barrierAbsorbed??0),0), packetCount: shots.reduce((s,r)=>s+(r.packetCount??1),0),packetHits:shots.reduce((s,r)=>s+(r.packetHits??Number(r.hit)),0),packetRolls:shots.flatMap(r=>r.packetRolls??[{hit:r.hit,crit:r.crit,damage:r.finalDamage}]),
      text: `${attacker.name}→${target.name}：${shots.length}发合计伤害${displayNumber(total)}${first.membersBefore!==undefined&&last!.membersAfter!==undefined?`，减员${first.membersBefore-last!.membersAfter}，余员${last!.membersAfter}`:''}` };
  }

  /**
   * 移动一格：向最近敌人逼近 / 远离。后撤时被贴身（距离0）的敌人获得一次借机攻击，
   * 带「游击」或「骑射」特质的单位免疫——骑射放风筝的攻防核心。
   */
  move(actorId: string, dir: 'advance' | 'withdraw', opts: { bypassTurn?: boolean } = {}): void {
    if (this.battlefield) {
      const actor = this.byId(actorId);
      const destinations = this.reachableCells(actorId).filter((p) => p.cost > 0).sort((a, b) => {
        const score = (path: GridPath) => Math.min(...this.combatants.filter((u) => combatHostile(u, actor, this.combatants) && u.status === 'ready').map((u) => gridDistance(this.battlefield!, path.cells.at(-1)!, u.pos!)));
        return (dir === 'advance' ? 1 : -1) * (score(a) - score(b)) || a.cost - b.cost;
      });
      if (!destinations.length) throw new Error('没有可移动落点');
      this.moveTo(actorId, destinations[0]!.cells.at(-1)!); return;
    }
    const actor = this.byId(actorId);
    if (controlPolicy(actor) === 'charmed' && !this.controlledExecution.has(actorId)) throw Error('魅惑期间由受约束AI行动');
    if (!opts.bypassTurn && this.started && !this.isTurnOf(actorId)) {
      throw new Error(`现在不是 ${actor.name} 的回合`);
    }
    if (actor.status !== 'ready') throw new Error(`${actor.name} 无法行动（${actor.status}）`);
    if (!opts.bypassTurn && this.movedThisTurn.has(actorId)) throw new Error('本回合移动额度已使用');

    const foes = this.combatants.filter((c) => combatHostile(c, actor, this.combatants) && c.status === 'ready');
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
        if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) actor.movedDuringActivation = true; this.movedThisTurn.add(actorId);
        this.recordEvent({
          round: this.round,
          kind: 'move',
          participants: [actor.id], text: `${actor.name} 贴边脱离缠斗：位置${displayNumber(before)}→${disengagePos}`,
        });
        this.opportunityAttacks(actor, provoked);
        return;
      }
      throw new Error(dir === 'advance' ? '已抵近战线最前端' : '已退至战场边缘');
    }

    actor.pos = after;
    if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) actor.movedDuringActivation = true; this.movedThisTurn.add(actorId);
    this.recordEvent({
      round: this.round,
      kind: 'move',
      participants: [actor.id], text: `${actor.name} ${dir === 'advance' ? `逼近${nearest.name}` : '后撤拉开距离'}：位置${displayNumber(before)}→${displayNumber(after)}`,
    });

    this.opportunityAttacks(actor, provoked);
  }

  /** 借机攻击序列： provoke 方对 actor 的近身挥击（actor 致死则中断） */
  private opportunityAttacks(actor: Combatant, provoked: Combatant[]): void {
    for (const e of provoked) {
      if (!controlReactionAllowed(e, actor, this.combatants, this.dist(e,actor))) continue;
      if (actor.status !== 'ready') break; // 借机攻击致死则停止
      const res = this.resolveAttackWithEnvironment({
        attacker: e,
        defender: actor,
        rng: this.rng,
        rules: this.rules,
        conditionDefs: this.conditionDefMap(),
        traitRegistry: this.traitRegistry,
        opportunity: true, ranged: false, // 借机攻击视为近身挥击；带副武器者换刀剑（免"武器不善近战"罚）
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
    const foes = this.combatants.filter((c) => combatHostile(c, actor, this.combatants) && c.status === 'ready');
    const minD = foes.length ? Math.min(...foes.map((f) => this.dist(actor, f))) : Infinity;
    if (minD < 2) {
      throw new Error(`距离不足（最近敌人仅 ${bandLabel(minD === Infinity ? 99 : minD)}），先脱离接触再撤离`);
    }
    if (!opts.bypassTurn) this.spendAction(actorId);
    actor.status = 'fled';
    this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id], text: `${actor.name} 撤离战场` });
    this.checkGridObjective(false);
  }

  private skillAttackOptions(actor: Combatant, target: Combatant, ability: Combatant['abilities'][number], effect: Parameters<typeof skillAttack>[4], plannedMove = false, charge = false) {
    const base = skillAttack(this.observationContext(), actor, target, ability, effect, this.rules);
    if (!ability.weaponUse || !base.weaponOverride) return base;
    const context = this.weaponContext(actor, target, { weaponMode: base.weaponOverride.id === actor.sidearm?.id ? 'sidearm' : 'primary' });
    const modifiers = this.attackModifiers(actor, target, context, charge ? { charge } : {});
    if (plannedMove && context.ranged && !this.movedThisTurn.has(actor.id) && !steadyMovingShot(actor, context.weapon)) modifiers.extraMods.push({ source: 'stance', category: 'movement' as const, name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
    return { ...base, ...modifiers, ...(charge ? { charge } : {}) };
  }
  /** 技能目标是否可选；带突进/闪现的技能在原位够不着时，以位移后的落点判断。只有位移的技能选择落点。 */
  private skillTargetReason(actor: Combatant, ability: Combatant['abilities'][number], target: Combatant): string | undefined {
    if (ability.effects.some(e => e.op === 'condition' && e.conditionId === 'charmed') && target.scale !== 'hero' && !isArmsV2(this.rules.armsModel)) return '魅惑首版仅支持未随队独立个体';
    if (['blinded','charmed','confused'].some(id => controlCondition(actor, id)) && target.id !== actor.id && !canSpot(this.observationContext(), actor, target)) return '必须以自身感知直接观测目标';
    if (movementOnlySkill(ability)) return this.skillLandingReason(actor, ability, target);
    const direct = this.skillTargetReasonAt(actor, ability, target);
    if (!direct || !moveEffects(ability).before) return direct;
    const plan = this.skillMovePlan(actor, ability, target);
    return plan.reason ? direct + '；' + plan.reason : undefined;
  }
  /** 沿可走路线在 reach 格内可到的位置（只看本阵营已知单位；执行时逐格按实际占位走）。 */
  private skillPaths(actor: Combatant, reach: number): GridPath[] {
    const field = this.battlefield!, known = this.visibleCombatants(actor.side);
    return reachableGridPaths(field, actor.pos!, reach, (n) => canOccupy(field, known, actor, n), (n, from) => movementStepCost(field, n, actor, this.fieldTags, from), actor);
  }
  /** 闪现落点：reach 格内、施术者视线可及、按自身空地层可落脚的位置；不跨平台层。 */
  private skillBlinkCells(actor: Combatant, reach: number): number[] {
    const field = this.battlefield!, known = this.visibleCombatants(actor.side);
    return field.tiles.flatMap((_tile, cell) => cell !== actor.pos && gridDistance(field, actor.pos!, cell) <= reach && canOccupy(field, known, actor, cell)
      && unitLineOfSight(field, actor, { ...actor, pos: cell }) ? [cell] : []);
  }
  /** 出手前位移（突进/闪现）：原位已能出手则不动；否则取最近的、能对目标出手的落点。 */
  skillMovePlan(actor: Combatant, ability: Combatant['abilities'][number], target: Combatant): { reason?: string; move?: { mode: MoveMode; to: number; path?: GridPath; charge: boolean } } {
    const effect = moveEffects(ability).before;
    if (!effect || !this.skillTargetReasonAt(actor, ability, target)) return {};
    const field = this.battlefield;
    if (!field || actor.pos === undefined) return { reason: '位移技能需要二维战场' };
    const blocked = moveBlockReason(actor, this.conditions); if (blocked) return { reason: blocked };
    const reach = effectiveMoveReach(actor, ability, effect, this.conditions);
    // 只检查技能射程附近的落点；接触技能只看目标身边。
    const span = fallbackAbilityRange(actor, gridAbility(ability, actor.armsModel), true).max + 2;
    const near = (cell: number) => gridDistance(field, cell, target.pos!) <= span;
    const candidates: GridPath[] = effect.mode === 'dash' ? this.skillPaths(actor, reach).filter((p) => p.cost > 0 && near(p.cells.at(-1)!))
      : this.skillBlinkCells(actor, reach).filter(near).map((cell) => ({ cells: [actor.pos!, cell], cost: gridDistance(field, actor.pos!, cell) }));
    const best = candidates.sort((a, b) => a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!)
      .find((p) => !this.skillTargetReasonAt({ ...actor, pos: p.cells.at(-1)! }, ability, target));
    if (!best) return { reason: (effect.mode === 'dash' ? '突进' : '闪现') + reach + '格内没有能对目标出手的落点' };
    // 以实际近战武器从非接触距离突进接敌、路线没有涉水碎石等阻滞，且未疲劳/受压制/减速，按冲锋结算。
    const weapon = ability.damageBasis === 'weapon' ? skillWeapon(actor, ability) : undefined;
    const clearRun = !field.layerVersion || isAirborne(actor) || best.cells.every((n) => !['deep_water', 'shallow_water', 'swamp'].includes(field.tiles[n]!)
      && !field.overlays?.[n]?.includes('rubble') && intactStructure(field, n)?.kind !== 'fortification');
    const charge = effect.mode === 'dash' && !!weapon && !isRangedWeapon(weapon) && combatHostile(target, actor, this.combatants) && this.dist(actor, target) >= 2 && clearRun
      && !fatiguePenalty(actor) && !actor.suppression && !actor.conditions.some((c) => c.dur > 0 && c.id === 'slowed');
    return { move: { mode: effect.mode, to: best.cells.at(-1)!, ...(effect.mode === 'dash' ? { path: best } : {}), charge } };
  }
  /** 出手后后撤：可走范围内离已知敌人最远（其次相邻敌人最少）的落点；拉不开距离就留在原地。指定落点时只校验可达。 */
  skillWithdrawPath(actor: Combatant, ability: Combatant['abilities'][number], effect: MoveEffect, cell?: number): { reason?: string; path?: GridPath } {
    const field = this.battlefield;
    if (!field || actor.pos === undefined) return { reason: '位移技能需要二维战场' };
    const blocked = moveBlockReason(actor, this.conditions); if (blocked) return { reason: blocked };
    const paths = this.skillPaths(actor, effectiveMoveReach(actor, ability, effect, this.conditions)).filter((p) => p.cost > 0);
    if (cell !== undefined) { const path = paths.find((p) => p.cells.at(-1) === cell); return path ? { path } : { reason: '后撤可走范围内到不了这里' }; }
    const foes = this.visibleCombatants(actor.side).filter((u) => combatHostile(u, actor, this.combatants) && u.status === 'ready' && u.pos !== undefined);
    if (!foes.length) return {};
    const nearest = (at: number) => Math.min(...foes.map((f) => gridDistance(field, at, f.pos!)));
    const adjacent = (at: number) => foes.filter((f) => gridDistance(field, at, f.pos!) <= 1).length;
    // 同样远时朝己方后方撤，而不是横移到侧翼。
    const edge = retreatCells(field, actor.side), home = (at: number) => edge.length ? Math.min(...edge.map((c) => gridDistance(field, at, c))) : 0;
    const best = paths.sort((a, b) => nearest(b.cells.at(-1)!) - nearest(a.cells.at(-1)!) || adjacent(a.cells.at(-1)!) - adjacent(b.cells.at(-1)!)
      || home(a.cells.at(-1)!) - home(b.cells.at(-1)!) || a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!)[0];
    return best && nearest(best.cells.at(-1)!) > nearest(actor.pos) ? { path: best } : {};
  }
  /** 只有位移的技能：落点须在本技能的位移方式与格数之内。 */
  private skillLandingReason(actor: Combatant, ability: Combatant['abilities'][number], target: Combatant): string | undefined {
    const { before, after } = moveEffects(ability), effect = before ?? after!;
    const field = this.battlefield;
    if (!field || actor.pos === undefined || target.pos === undefined || !/^cell:\d+$/.test(target.id)) return '请在二维战场上指定落点';
    const blocked = moveBlockReason(actor, this.conditions); if (blocked) return blocked;
    const reach = effectiveMoveReach(actor, ability, effect, this.conditions);
    if (effect.mode === 'blink') return this.skillBlinkCells(actor, reach).includes(target.pos) ? undefined : '闪现只能落到' + reach + '格内视线可及的落脚处';
    return effect.mode === 'withdraw' ? this.skillWithdrawPath(actor, ability, effect, target.pos).reason
      : this.skillPaths(actor, reach).some((p) => p.cost > 0 && p.cells.at(-1) === target.pos) ? undefined : '突进可走' + reach + '格内到不了这里';
  }
  /** 只有位移的技能可选的落点。 */
  private skillLandingCells(actor: Combatant, ability: Combatant['abilities'][number]): number[] {
    const { before, after } = moveEffects(ability), effect = before ?? after!;
    if (!this.battlefield || actor.pos === undefined || moveBlockReason(actor, this.conditions)) return [];
    const reach = effectiveMoveReach(actor, ability, effect, this.conditions);
    return effect.mode === 'blink' ? this.skillBlinkCells(actor, reach) : this.skillPaths(actor, reach).filter((p) => p.cost > 0).map((p) => p.cells.at(-1)!);
  }
  /** 不考虑技能位移、按施术者当前位置判断目标是否可选。 */
  private skillTargetReasonAt(actor: Combatant, ability: Combatant['abilities'][number], target: Combatant, recipient = false): string | undefined {
    const areaAnchor = !recipient && canAnchorArea(ability, this.rules);
    const areaRecipient = recipient && this.rules.areaTargetingModel === 'impact-v1' && !ability.weaponUse && ability.requires !== 'melee' && ability.requires !== 'shield';
    if (this.battlefield?.layerVersion && ability.delivery === 'melee') { const height = meleeHeightReason(this.battlefield, actor, target); if (height) return height; }
    ability = this.battlefield ? gridAbility(ability, actor.armsModel) : ability;
    if (ability.target === 'zone') return !this.battlefield || !this.cellVisible(actor.side,target.pos!) ? '请指定可见的地面位置' : abilityTargetReason({actor,ability,target,distance:this.dist(actor,target),field:this.battlefield}) ?? (unitLineOfSight(this.battlefield,actor,target) ? undefined : '这里被障碍物遮挡');
    const controlAreaIds = !recipient && controlPolicy(actor) === 'taunted' && (ability.area || ability.shape === 'burst' || ability.effects.some(e => e.op === 'damage' && e.shape === 'burst')) ? this.abilityDamageTargets(actor, target, ability, true).map(u => u.id) : undefined;
    const reason = abilityTargetReason({ actor, ability, target, distance: this.dist(actor, target), field: this.battlefield, units: this.combatants, controlAreaIds, controlRecipient: recipient, areaRecipient, areaAnchor })
      ?? (this.battlefield && !ability.weaponUse && !areaRecipient ? this.sightReason(actor, target) : undefined);
    if (reason) return reason;
    if (!areaAnchor && this.battlefield && target.status === 'dying' && ability.effects.some(e => e.op === 'heal')
      && !canOccupy(this.battlefield, this.visibleCombatants(actor.side), target, target.pos!)) return '濒死单位所在格没有起身空间，请先让出救援位置';
    if (ability.weaponUse) {
      const weapon = skillWeapon(actor, ability, this.dist(actor, target));
      const context = this.weaponContext(actor, target, { weaponMode: weapon?.id === actor.sidearm?.id ? 'sidearm' : 'primary', controlRecipient: true });
      if (context.reason) return context.reason;
    }
    if (areaAnchor && !this.abilityDamageTargets(actor, target, ability, true).length) return '范围内没有可生效的目标';
    if (!areaAnchor && ability.effects.every((e) => e.op === 'push')) return pushPreview({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, actor, target, ability.effects[0] as Extract<EffectOp, { op: 'push' }>).reason;
    return undefined;
  }
  /** 道具的派生行动供预览、确认框、AI 与执行共用；范围治疗按实际波及伤员计算件数。 */
  itemUse(actor: Combatant, ability: Combatant['abilities'][number], target?: Combatant): ReturnType<typeof itemUseAbility> {
    const healingTargets = target && ability.itemSourceId && (ability.area || ability.shape === 'burst') && ability.effects.every(e => e.op === 'heal')
      ? this.abilityDamageTargets(actor, target, ability, true) : undefined;
    return itemUseAbility(actor, ability, target, healingTargets);
  }
  private abilityDamageTargets(actor: Combatant, target: Combatant, ability: Combatant['abilities'][number], burst: boolean): Combatant[] {
    if (ability.area) return areaTargets({ ...this.observationContext(), units: this.visibleCombatants(actor.side) },actor,target,ability,u=>!this.skillTargetReasonAt(actor,ability,u,true));
    if (!burst) return [target];
    ability = this.battlefield ? gridAbility(ability, actor.armsModel) : ability;
    const pivot = ability.recipe?.category === 'physical-area' && ability.damageBasis && !isRangedWeapon(skillWeapon(actor, ability)) ? actor : target;
    const primary = this.rules.skillTargetModel !== 'area-anchor-v1' || !this.skillTargetReasonAt(actor, ability, target, true) ? [target] : [];
    return [...primary, ...this.visibleCombatants(actor.side).filter((u) => u.id !== target.id && !combatHostile(u, target, this.combatants)
      && (u.status === 'ready' || this.rules.skillTargetModel === 'area-anchor-v1' && ability.target === 'ally' && u.status === 'dying' && ability.effects.some(e => e.op === 'heal')) && this.dist(u, pivot) <= 1
      && (!this.battlefield || this.rules.areaTargetingModel !== 'impact-v1' || sameLayer(pivot, u) && unitLineOfSight(this.battlefield, pivot, u)) && !this.skillTargetReasonAt(actor, ability, u, true))
      .sort((a, b) => a.id.localeCompare(b.id))].slice(0, 2);
  }
  /** 执行技能位移：突进/后撤沿路线逐格走（后撤不触发近战借机），闪现直接落位；返回战报短句。
   *  phase 标在移动记录上：出手前的位移由战报并入其后的技能行，出手后的后撤照常排在技能之后。 */
  private executeSkillMove(actor: Combatant, mode: MoveMode, cell: number, path: GridPath | undefined, phase: 'before' | 'after'): string {
    const field = this.battlefield!, from = actor.pos!;
    if (mode === 'dash') { delete actor.chargeInterrupted; actor.chargeDistance = path ? path.cells.length-1 : 0; }
    if (mode !== 'blink') {
      if (!path) return '位移路线已失效，原地出手';
      this.walkPath(actor.id, path, { spend: false, haste: false, opportunity: mode === 'dash', charging: mode === 'dash', skill: { verb: mode === 'dash' ? '突进' : '后撤', phase } });
      return actor.pos === from ? '位移受阻，未能离开原位' : (mode === 'dash' ? '突进' : '后撤') + '至' + reportPlaceLabel(field, actor.pos!, actor);
    }
    if (!canOccupy(field, this.combatants, actor, cell)) return '闪现落点已被占据，未能位移';
    const heights = reportsHeights(field) && !isAirborne(actor);
    const fromHeight = heights ? surfaceHeightAt(field, from, actor) : undefined;
    delete actor.tacticalPose; actor.pos = cell; if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) actor.movedDuringActivation = true; this.movedThisTurn.add(actor.id);
    const toHeight = heights ? surfaceHeightAt(field, cell, actor) : undefined;
    this.recordEvent({ round: this.round, kind: 'move', participants: [actor.id], move: { from, to: cell, ...(heights ? { fromHeight, toHeight } : {}), skill: phase },
      text: `${actor.name} 闪现 ${cellLabel(field, from)}${fromHeight !== toHeight ? '(高度' + fromHeight + ')' : ''}→${reportPlaceLabel(field, cell, actor)}` });
    this.settleAreaEffects(); this.checkGridObjective(false);
    if (this.rules.resolutionVersion === 'v2') revealContacts(this.observationContext());
    return '闪现至' + reportPlaceLabel(field, cell, actor);
  }
  /** 使用技能 */
  useAbility(actorId: string, abilityId: string, targetId?: string, opts: { bypassTurn?: boolean } = {}): AbilityUseResult {
    const actor = this.byId(actorId);
    if (controlPolicy(actor) === 'charmed' && !this.controlledExecution.has(actorId)) return { ok: false, reason: '魅惑期间由受约束AI行动', resolutions: [], log: '' };
    if (!opts.bypassTurn && this.started && !this.isTurnOf(actorId)) {
      throw new Error(`现在不是 ${actor.name} 的回合`);
    }
    if (actor.status !== 'ready') {
      return { ok: false, reason: `${actor.name} 无法行动（${actor.status}）`, resolutions: [], log: '' };
    }
    if (actor.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn))
      return { ok: false, reason: '当前状态无法行动', resolutions: [], log: '' };
    const originalAbility = actor.abilities.find((a) => a.id === abilityId);
    const listed = originalAbility && (this.battlefield ? gridAbility(originalAbility, actor.armsModel) : originalAbility);
    if (!listed) throw new Error(`${actor.name} 没有技能 ${abilityId}`);
    if (listed.target === 'self' && targetId && targetId !== actor.id) {
      return { ok: false, reason: '该技能只能对自己施放', resolutions: [], log: '' };
    }
    const chosenTarget = listed.target === 'self'
      ? actor
      : targetId
        ? listed.target === 'zone' ? zoneTarget(this.observationContext(),actor,targetId) : this.byId(targetId)
        : listed.target === 'ally' ? actor : undefined;
    if (listed.target === 'zone' && !chosenTarget) return { ok:false, reason:'请指定有效地面位置', resolutions:[], log:'' };
    // V15：编队使用每人一份的道具时，按件数得到本次实际消耗与效果。
    const itemUse = this.itemUse(actor, listed, chosenTarget);
    if (itemUse.reason) return { ok: false, reason: itemUse.reason, resolutions: [], log: '' };
    const ability = itemUse.ability;
    const usabilityReason = abilityUsabilityReason(actor, ability);
    if (usabilityReason) return { ok: false, reason: usabilityReason, resolutions: [], log: '' };
    const targetReason = chosenTarget ? this.skillTargetReason(actor, ability, chosenTarget) : abilityTargetReason({ actor, ability });
    if (targetReason) return { ok: false, reason: targetReason, resolutions: [], log: '' };
    const summonError = this.summonReason(actor, ability);
    if (summonError) return { ok: false, reason: summonError, resolutions: [], log: '' };
    const summons: Combatant[] = [];
    if (actor.rulesVersion === 'v2' && !canAnchorArea(ability, this.rules) && ability.effects.every((e) => e.op === 'push') && chosenTarget) {
      const effect = ability.effects[0] as Extract<EffectOp, { op: 'push' }>; const pushed = pushPreview(this.observationContext(), actor, chosenTarget, effect);
      if (pushed.reason) return { ok: false, reason: pushed.reason, resolutions: [], log: '' };
    }
    if (actor.rulesVersion === 'v2' && this.battlefield) {
      for (const effect of healingEffectGroups(ability)) {
        if (effect.op !== 'summon') continue;
        for (let i = 0; i < effect.count; i++) {
          const id = `${this.seed}:summon:${actor.id}:${ability.definitionId ?? ability.id}:${this.round}:${summons.length}`;
          let unit: Combatant | null | undefined;
          try { unit = conjureSkillUnit(effect.templateId, actor.side, id, 'small', ability.bonuses, this.rules.damageModel, this.rules.numericModel) ?? this.summonUnit?.(effect.templateId, actor.side, id); }
          catch { return { ok: false, reason: '召唤模板生成失败，未扣费', resolutions: [], log: '' }; }
          if (!unit) return { ok: false, reason: '召唤模板不可用，未扣费', resolutions: [], log: '' };
          prepareSkillModel(unit, this.rules); prepareCombatModel(unit, this.rules, summonedMemberLife(unit)); if(this.rules.combatModel)upgradeCombatSkills(unit); prepareResourceModel(unit,this.rules); prepareArmsModel(unit,this.rules); prepareTraitModel(unit,this.rules); prepareItemModel(unit,this.rules); prepareTraitLevelModel(unit,this.rules); prepareRevivalBattle(unit,true); resetWornBarrier(unit); const entryBarrier = grantEntryWornBarrier(unit,this.rules); if(entryBarrier)this.recordEvent({round:this.round,kind:'condition',participants:[unit.id],text:entryBarrier}); beginLifestealRound(unit,this.round,true);
          unit.id = id; unit.summonerId = actor.id; unit.bornRound = this.round;
          if (conjuredTemplate(effect.templateId)) unit.name = `${actor.name}的${unit.name}`;
          const cell = neighbors(this.battlefield, actor.pos!).find((n) => canOccupy(this.battlefield!, [...this.combatants, ...summons], unit, n));
          if (cell === undefined || this.combatants.some((u) => u.id === unit.id)) return { ok: false, reason: '召唤落点或身份冲突，整次未扣费', resolutions: [], log: '' };
          unit.pos = cell; summons.push(unit);
        }
      }
    }
    if (!opts.bypassTurn && (quickItemAction(actor, ability) ? !this.nonSkillActionAvailable(actorId) : this.actedThisTurn.has(actorId) || this.hasteSelected.has(actorId))) {
      return { ok: false, reason: '本回合主行动已使用', resolutions: [], log: '' };
    }
    const hasteAction = !opts.bypassTurn && quickItemAction(actor, ability) && this.usingHaste(actorId);
    // 位移在扣费前规划：找不到落点时整次不扣费。
    const movementOnly = movementOnlySkill(ability);
    const movePlan = chosenTarget && !movementOnly ? this.skillMovePlan(actor, ability, chosenTarget) : {};
    if (movePlan.reason) return { ok: false, reason: movePlan.reason, resolutions: [], log: '' };
    // 不位移的V38技能按扣费前的资格锁定接受者，避免支付SP后把施术者临时加入范围回能。
    const plannedTargets = this.rules.skillTargetModel === 'area-anchor-v1' && chosenTarget && !movementOnly && !movePlan.move
      ? this.abilityDamageTargets(actor, chosenTarget, ability, ability.shape === 'burst' || ability.effects.some(e => 'shape' in e && e.shape === 'burst')) : undefined;
    if (this.rules.resolutionVersion === 'v2') revealUnit(this.observationContext(), actor);
    // 扣费与计数
    const cost = abilityCost(actor, ability);
    if (cost) actor.resources[cost.resource] = actor.resourceModel && cost.resource === 'SP' ? resourceRound((actor.resources[cost.resource] ?? 0) - cost.amount) : (actor.resources[cost.resource] ?? 0) - cost.amount;
    spendAbility(actor, ability);

    const logBits: string[] = [`${actor.name} 使用【${ability.name}】`];
    if (ability.itemSourceId && cost) logBits.push(`消耗${displayNumber(cost.amount)}件，剩余${displayNumber(actor.resources[cost.resource])}件`);
    // 出手前的突进/闪现逐格记入日志（标为技能位移，战报把它们并到技能名之后），技能本体随后记录；只有位移的技能在这里走完。
    let interrupted: string | undefined, charge = false;
    if (movementOnly && chosenTarget) {
      const { before, after } = moveEffects(ability), effect = before ?? after!;
      const moved = this.executeSkillMove(actor, effect.mode, chosenTarget.pos!, effect.mode === 'blink' ? undefined
        : effect.mode === 'withdraw' ? this.skillWithdrawPath(actor, ability, effect, chosenTarget.pos).path : this.skillPaths(actor, effectiveMoveReach(actor, ability, effect, this.conditions)).find((p) => p.cost > 0 && p.cells.at(-1) === chosenTarget.pos), 'before');
      logBits.push(moved);
    } else if (movePlan.move) {
      const move = movePlan.move, moved = this.executeSkillMove(actor, move.mode, move.to, move.path, 'before');
      if (actor.status !== 'ready' || actor.pos !== move.to || actor.conditions.some((c) => c.dur > 0 && (this.conditions.get(c.id)?.skipTurn || this.conditions.get(c.id)?.preventMove && move.mode === 'dash'))) interrupted = '位移途中受阻或被反应打断，技能未生效';
      else if (chosenTarget && this.skillTargetReasonAt(actor, ability, chosenTarget)) interrupted = '到位后目标已不可选，技能未生效';
      charge = move.charge && !interrupted;
      // 被打断时没有冲锋，日志不写“冲锋”。
      logBits.push(moved + (charge ? '，冲锋' : ''));
    }
    if (interrupted) logBits.push(interrupted);

    const castTargets = chosenTarget && !interrupted && !movementOnly ? plannedTargets ?? this.abilityDamageTargets(actor, chosenTarget, ability, ability.shape === 'burst' || ability.effects.some((e) => 'shape' in e && e.shape === 'burst')) : [actor];
    const effectTargets = (area: boolean) => area || this.rules.areaTargetingModel === 'impact-v1' && ability.area ? castTargets : [chosenTarget ?? actor];
    const resolutions: AttackResolution[] = [];
    let summonsSubmitted = false;
    let heal = 0;
    // 技能内部会立即产生阵亡、迫降、任务结束等派生事件；结算完成后把这些事件排在技能本体之后，保持因果顺序。
    const consequentEventStart = this.log.length;

    for (const eff of interrupted || movementOnly ? [] : ability.effects) {
      switch (eff.op) {
        case 'move': break;
        case 'zone': { if (chosenTarget) { placeZone(this.observationContext(),actor,chosenTarget,eff,this.round,ability.id); logBits.push((this.battlefield ? '在'+reportPlaceLabel(this.battlefield,chosenTarget.pos!,chosenTarget) : '')+'布置'+ZONE_NAMES[eff.kind]+'，持续'+eff.dur+'轮'); } break; }
        case 'barrier': {
          for (const target of effectTargets(ability.shape === 'burst')) { grantBarrier(target, eff.amount, eff.dur, actor.id, eff.defensePower ?? ability.power, barrierSourceKey(actor.id, ability)); logBits.push(`${target.name} 获得屏障，可吸收${displayNumber(target.barrier?.remaining ?? 0)}点伤害，持续${eff.dur}轮`); }
          break;
        }
        case 'damage': {
          const target = chosenTarget;
          if (!target || target.status === 'dead') break;
          if (this.rules.resolutionVersion === 'v2') {
            for (const affected of effectTargets(eff.shape === 'burst')) {
              const result = this.resolveAttackWithEnvironment({ attacker: actor, defender: affected, rng: this.rng, rules: this.rules,
                conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(actor, affected, ability, eff, false, charge && affected.id === chosenTarget?.id) });
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
                (c) => combatHostile(c, actor, this.combatants) && c.id !== target.id && c.status === 'ready' && this.dist(c, target) <= 1
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
            const amount = healingYield(actor, target, eff.amount ?? rollDice(eff.dice!, this.rng).total, !!ability.itemSourceId, eff.power);
            const restored=applyRecovery(target, amount);heal+=restored;
            if (target.status === 'dying' && target.hp > 0) target.status = 'ready';
            logBits.push('治疗 ' + displayNumber(restored) + ' → ' + target.name + ' 生命 ' + displayNumber((memberHealth(target)-restored)) + '→' + displayNumber(memberHealth(target)));
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
            const outcome = prepareCondition(actor, target, eff, this.rng, this.combatants);
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
            logBits.push(target.name + ' ' + eff.resource + (amount >= 0 ? '+' : '') + displayNumber(amount));
          }
          break;
        }
        case 'morale': {
          const primary = chosenTarget ?? actor;
          const targets = this.rules.resolutionVersion === 'v2' ? effectTargets(ability.shape === 'burst') : [primary];
          for (const target of targets) if (target.morale !== undefined || target.rulesVersion === 'v2') {
            changeMorale(target, eff.amount);
            logBits.push(target.moraleLocked ? `${target.name} 满士气锁定，士气不变` : `${target.name} 士气${eff.amount >= 0 ? '+' : ''}${displayNumber(eff.amount)} → ${displayNumber(moraleProfile(this.observationContext(), target, this.traitRegistry).effective)}`);
          }
          break;
        }
        case 'summon': {
          if (actor.rulesVersion === 'v2') {
            if (!summonsSubmitted) {
              for(const unit of summons)unit.nonLethal=this.nonLethal; this.combatants.push(...summons);
              logBits.push('召唤 '+summons.map(unit => `${unit.name}（${reportPlaceLabel(this.battlefield!,unit.pos!,unit)}）`).join('、'));
            }
            summonsSubmitted = true;
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
                logBits.push(`【召唤】${u.name} 降临战场（${displayNumber(u.hp)}/${displayNumber(u.base.hpMax)} HP，阵位${u.pos}）`);
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

    const usedWeapon = ability.weaponUse && chosenTarget && !interrupted ? skillWeapon(actor, ability, this.dist(actor, chosenTarget)) : undefined;
    if (usedWeapon && isRangedWeapon(usedWeapon) && weaponReloadTurns(usedWeapon)) this.reloadCd.set(weaponReloadKey(actor, usedWeapon), weaponReloadTurns(usedWeapon) + 1);
    this.settleAreaEffects(); this.resolveFlightStates(); this.flightCauses.clear(); this.checkGridObjective(false);
    const consequentEvents = this.log.splice(consequentEventStart);
    const text = logBits.join('\n');
    const itemLog = itemUseLog(actor, ability, cost?.amount);
    if (itemLog) itemLog.effects = logBits.slice(ability.itemSourceId && cost ? 2 : 1);
    this.recordEvent({ round: this.round, kind: 'ability', participants: [actor.id, ...(chosenTarget ? [chosenTarget.id] : []), ...resolutions.map((r) => r.defenderId)], text, resolution: resolutions[0], resolutions, ...(itemLog ? { itemUse: itemLog } : {}) });
    this.log.push(...consequentEvents);
    // 出手后后撤：排在技能本体之后，不触发近战借机。
    const withdraw = moveEffects(ability).after;
    if (withdraw && (!movementOnly || moveEffects(ability).before) && !interrupted && actor.status === 'ready' && !this.isOver()) {
      const retreat = this.skillWithdrawPath(actor, ability, withdraw);
      if (retreat.path) this.executeSkillMove(actor, 'withdraw', retreat.path.cells.at(-1)!, retreat.path, 'after');
    }
    if ((this.battlefield || actor.resourceModel) && actor.rulesVersion === 'v2' && !opts.bypassTurn) addTacticalEffort(actor, skillExertion(actor, ability) + (charge ? 1 : 0));
    if (!opts.bypassTurn) { if (quickItemAction(actor, ability)) this.spendAction(actorId, hasteAction); else this.actedThisTurn.add(actorId); }
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
    if (ended && ['charmed','confused'].includes(controlPolicy(ended) ?? '') && !this.controlledExecution.has(ended.id)) { this.autoAction(ended.id); return; }
    if (ended && (ended.status === 'ready' || ended.status === 'routing')) this.settleUnit(ended);
    this.captureFeedback();
    this.feedback?.finishActivation();

    this.turnIndex += 1;
    this.advanceToNextActor();
    while (this.turnIndex >= this.turnOrder.length && !this.isOver()) {
      this.settleAreaEffects(true); this.checkGridObjective(true);
      for (const unit of this.combatants) for (const text of expireRoundEffects(unit)) this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], text });
      this.resolveFlightStates();
      this.captureFeedback();
      if (this.objectiveWinner) return;
      this.round += 1;
      if (isCommandV2(this.rules)) this.commandRounds = beginCommandRound(this.commandRounds, this.round, this.combatants, u => u.pos);
      for (const unit of this.combatants) beginLifestealRound(unit, this.round);
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
  private controlledExecution = new Set<string>();
  private confusedWeaponPlan(actor: Combatant, target: Combatant): GridPath | undefined {
    if (target.hp <= 0 || ['dead','fled'].includes(target.status)) return undefined;
    if (!this.weaponContext(actor, target).reason) return { cells: [actor.pos!], cost: 0 };
    if (!this.battlefield) return undefined;
    return this.reachableCells(actor.id).filter(p => !this.weaponContext({ ...actor, pos: p.cells.at(-1)!, movedDuringActivation: p.cost > 0 }, target).reason).sort((a,b) => a.cost - b.cost)[0];
  }
  private executeConfusedAction(actor: Combatant): void {
    if (actor.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn)) { this.endTurn(); return; }
    const target = this.combatants.find(u => u.id === actor.controlActivation?.targetId);
    const plan = target && this.confusedWeaponPlan(actor, target);
    if (target && plan && canSpot(this.observationContext(), actor, target)) {
      if (plan.cost > 0) this.moveTo(actor.id, plan.cells.at(-1)!);
      if (actor.status === 'ready' && !this.weaponContext(actor, target).reason) {
        this.attack(actor.id, target.id);
        if (this.hasteAvailable(actor.id) && target.hp > 0 && !this.weaponContext(actor, target).reason) { this.hasteSelected.add(actor.id); this.attack(actor.id, target.id); }
      }
    }
    if (this.isTurnOf(actor.id)) this.endTurn();
  }
  chooseLooseFormation(unitId: string, choice: 'loose' | 'closed'): { ok: boolean; reason?: string } {
    const unit = this.byId(unitId);
    if (!['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '') || !activeTraitIds(unit).includes('loose-formation')) return { ok: false, reason: '没有可切换的散兵特质' };
    if (this.started && (!this.isTurnOf(unitId) || this.actedThisTurn.has(unitId) || this.movedThisTurn.has(unitId) || unit.looseChoiceLocked)) return { ok: false, reason: '只能在自身正常激活开始时选择一次疏散/收拢' };
    unit.looseFormationChoice = choice; if (this.started) unit.looseChoiceLocked = true; return { ok: true };
  }
  private actionIntent?: UnitIntent;
  private intentActive = false;
  private intentUseDone = false;
  private intentKnown(unit: Combatant): Combatant[] {
    const known = this.visibleCombatants(unit.side);
    return [...known, ...liveTraces(this.intel, unit.side, this.round, new Set(known.map(u => u.id)))
      .flatMap(t => t.seen && t.cell !== undefined ? [{ ...t.seen, pos: t.cell }] : [])];
  }
  /** Complete as much of the directed route as this activation permits, then fight in place.
   * Each step uses the normal engine executor, including reactions, capacity and action costs. */
  private followIntent(unit: Combatant, intent: UnitIntent): void {
    if (intent.mode === 'use_ability' && this.intentUseDone) return;
    const field = this.battlefield!, blocked = new Set<number>();
    let reportedBlocked = false;
    const feedback = (reason: string, temporary: boolean) => this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id],
      intentFailure: { unitId: unit.id, ...(intent.cell !== undefined ? { cell: intent.cell } : {}), temporary },
      text: `${unit.name} 指令未完成${intent.cell === undefined ? '' : '（目标' + cellLabel(field, intent.cell) + '）'}：${reason}` });
    const structureCommand = intent.mode === 'attack' && !intent.targetId && intent.cell !== undefined;
    const structureModes = ['primary', ...(unit.sidearm ? ['sidearm'] : []), ...unit.abilities.filter(a => a.effects.some(e => e.op === 'damage')).map(a => 'ability:' + a.id)];
    const structureMode = (actor: Combatant) => structureModes.map(mode => ({ mode, ...this.structurePreview(unit.id, intent.cell!, mode, actor) }))
      .filter(p => !p.reason).sort((a, b) => b.damage - a.damage)[0]?.mode;
    for (let step = 0; step < field.tiles.length * 2 && this.isTurnOf(unit.id) && unit.status === 'ready' && !this.isOver(); step++) {
      if (structureCommand && (!intactStructure(field, intent.cell!) || !this.nonSkillActionAvailable(unit.id))) break;
      const known = this.visibleCombatants(unit.side), remembered = this.intentKnown(unit);
      const target = remembered.find(u => u.id === intent.targetId && (intent.mode === 'use_ability' ? ['ready', 'routing', 'dying'].includes(u.status) : u.side !== unit.side && ['ready', 'routing'].includes(u.status)));
      const ability = intent.mode === 'use_ability' ? unit.abilities.find(a => a.id === intent.abilityId) : undefined;
      const cast = () => {
        const result = this.useAbility(unit.id, ability!.id, ability!.target === 'zone' ? 'cell:' + target!.pos : target!.id);
        if (result.ok) this.intentUseDone = true;
        if (!result.ok) this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], text: `${unit.name} 无法按指令使用${ability!.name}：${result.reason}` });
      };
      if (ability && target && !this.skillTargetReason(unit, this.itemUse(unit, ability, target).ability, target)) { cast(); break; }
      const support = known.find(u => u.id === intent.supportId && u.side === unit.side && ['ready', 'routing'].includes(u.status));
      const gateCommand = intent.mode === 'open_gate' || intent.mode === 'close_gate';
      const door = gateCommand && intactStructure(field, intent.cell!);
      if (gateCommand && (!door || door.kind !== 'gate' || door.gateState === (intent.mode === 'open_gate' ? 'open' : 'closed'))) break;
      const destination = gateCommand || structureCommand || intent.cell === undefined ? undefined : intentPlace(field, unit, intent.cell) ?? { cell: intent.cell, layer: 'ground' as const };
      const attackPosition = (actor: Combatant) => !!target && [actor.weapon, ...(actor.sidearm ? [actor.sidearm] : [])].some(weapon => {
        const ranged = isRangedWeapon(weapon), adapted = gridWeapon(weapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel);
        // 扑击的接敌格按落地后的状态判定，不能把目标头顶当作可攻击落点。
        const landing = isAirborne(actor) && !isAirborne(target) && !ranged;
        const strike = landing ? { ...actor, airborne: false, elevation: undefined } : actor;
        if (landing && !canOccupy(field, known, strike, strike.pos!)) return false;
        return !weaponTargetReason({ actor: strike, target, weapon: adapted, ranged, distance: this.dist(strike, target), field, units: known })
          && (ranged || meleeContact(field, strike, target)) && (weapon?.indirect
            ? known.some(observer => observer.side === unit.side && observer.status === 'ready' && canSpot(this.observationContext(known), observer, target))
            : unitLineOfSight(field, strike, target))
          && (!ranged || !rangedScreen(strike, target, weapon, known, { mode: 'small', width: field.width, battlefield: field }, this.conditionDefMap()));
      });
      const goal = (actor: Combatant) => gateCommand ? !this.gatePositionReason(actor, intent.cell!, known)
        : structureCommand ? structureMode(actor) !== undefined
        : intent.mode === 'attack' ? attackPosition(actor)
        : intent.mode === 'use_ability' ? !!ability && !!target && !abilityTargetReason({ actor, ability: gridAbility(this.itemUse(actor, ability, target).ability, actor.armsModel), target,
            distance: this.dist(actor, target), field, units: known }) && unitLineOfSight(field, actor, target)
        : intent.mode === 'support' ? !!support && sameLayer(actor, support) && gridDistance(field, actor.pos!, support.pos!) <= 1 && actor.pos !== support.pos
        : !!destination && actor.pos === destination.cell && isElevated(actor) === (destination.layer === 'platform');
      if (goal(unit)) {
        if (structureCommand) { this.attackStructure(unit.id, intent.cell!, structureMode(unit)!); continue; }
        if (gateCommand && !this.gateReason(unit.id, intent.cell!)) this.toggleGate(unit.id, intent.cell!);
        if (ability && target) cast();
        break;
      }
      if (!gateCommand && !structureCommand && (['attack', 'use_ability'].includes(intent.mode) && !target || intent.mode === 'support' && !support || !['attack', 'support', 'use_ability'].includes(intent.mode) && !destination)) break;
      const toward = gateCommand || structureCommand ? intent.cell : intent.mode === 'attack' || intent.mode === 'use_ability' ? target?.pos : intent.mode === 'support' ? support?.pos : destination?.cell;
      let reachable: Combatant[] = [];
      let route = findIntentRoute(field, unit, known, goal, (actor, cell) => !this.gatePositionReason(actor, cell, known),
        this.movementBudget(unit.id), this.climbMovementCost(unit.id), this.fieldTags, blocked, undefined, actors => { reachable = actors; });
      if (!route && !reportedBlocked) {
        feedback(intentRouteFailure(field, unit, known, reachable, toward, this.visibleCells(unit.side), (actor, cell) => !this.gatePositionReason(actor, cell, known)), false);
        reportedBlocked = true;
      }
      // An occupied assigned cell still needs to be approached, then cleared or vacated.
      if (!route && destination && !canOccupy(field, known, { ...unit, elevation: destination.layer === 'platform' ? 1 : undefined }, destination.cell))
        route = findIntentRoute(field, unit, known, actor => isElevated(actor) === (destination.layer === 'platform') && gridDistance(field, actor.pos!, destination.cell) === 1,
          (actor, cell) => !this.gatePositionReason(actor, cell, known), this.movementBudget(unit.id), this.climbMovementCost(unit.id), this.fieldTags, blocked);
      if (!route && toward !== undefined) route = findIntentRoute(field, unit, known, goal, (actor, cell) => !this.gatePositionReason(actor, cell, known),
        this.movementBudget(unit.id), this.climbMovementCost(unit.id), this.fieldTags, blocked, actor => gridDistance(field, actor.pos!, toward));
      if (!route) break;
      const next = route[0]; if (!next) break;
      const before = unit.pos, beforeLayer = unit.elevation;
      if (next.kind === 'open') {
        const reason = this.gateReason(unit.id, next.cell); if (reason) { if (!reportedBlocked) feedback(reason, true); break; }
        this.toggleGate(unit.id, next.cell); continue;
      }
      if (next.kind === 'climb') {
        const reason = this.climbReason(unit.id, next.cell); if (reason) { if (!reportedBlocked) feedback(reason, true); break; }
        this.climb(unit.id, next.cell);
      } else {
        const cost = movementStepCost(field, next.cell, unit, this.fieldTags, unit.pos);
        if (cost > this.movementLeft(unit.id)) { if (!reportedBlocked) feedback('路线可通行，本轮剩余移动额度不足', true); break; }
        this.walkPath(unit.id, { cells: [unit.pos!, next.cell], cost }, { spend: true, haste: true, opportunity: true });
      }
      if (before === unit.pos && beforeLayer === unit.elevation) {
        blocked.add(next.cell + (next.layer === 'platform' ? field.tiles.length : 0));
        if (next.kind === 'climb') break;
      }
    }
  }
  autoAction(unitId: string, intent?: UnitIntent): void {
    this.actionIntent = intent;
    this.intentUseDone = false;
    // A task that became impossible during the round must not release movement back to the city AI.
    const referenced = intent && (intent.mode === 'attack' && !intent.targetId && intent.cell !== undefined ? !!this.battlefield?.structures?.[intent.cell]
      : ['attack', 'use_ability'].includes(intent.mode) ? this.combatants.some(u => u.id === intent.targetId)
      : intent.mode === 'support' ? this.combatants.some(u => u.id === intent.supportId && u.side === this.byId(unitId).side)
      : ['open_gate', 'close_gate'].includes(intent.mode) && intent.cell !== undefined && this.battlefield?.structures?.[intent.cell]?.kind === 'gate');
    this.intentActive = !!this.battlefield && (!!referenced || !!intentOrder(this.battlefield, this.byId(unitId), intent, intent ? this.intentKnown(this.byId(unitId)) : []));
    try {
      const dispersionUnit = this.byId(unitId);
      if (!dispersionUnit.looseChoiceLocked) this.chooseLooseFormation(unitId, this.combatants.some(u => combatHostile(u, dispersionUnit, this.combatants) && u.status === 'ready' && this.dist(dispersionUnit, u) <= 1) ? 'closed' : 'loose');
      const current = this.byId(unitId);
      if (controlPolicy(current) === 'confused') { this.controlledExecution.add(unitId); try { this.executeConfusedAction(current); } finally { this.controlledExecution.delete(unitId); } return; }
      if (controlPolicy(current) === 'charmed' && !this.controlledExecution.has(unitId)) { this.controlledExecution.add(unitId); try { this.autoAction(unitId); } finally { this.controlledExecution.delete(unitId); } return; }
      if (this.isTurnOf(unitId) && current.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn)) { this.recordEvent({ round: this.round, kind: 'condition', participants: [unitId], text: current.name + ' 眩晕，跳过回合' }); this.endTurn(); return; }
      if (this.battlefield) { try { this.autoGridAction(unitId); } finally { this.observationMemo = undefined; this.gridPathsMemo = undefined; endPreviewScope(); } return; }
      const u = this.byId(unitId);
      if (u.status !== 'ready' || !this.isTurnOf(unitId)) return;
      // 索敌优先 ready；只剩濒死敌时列入补刀目标
      const readyFoes = this.combatants.filter((c) => combatHostile(c, u, this.combatants) && c.status === 'ready');
      const foes = readyFoes.length
        ? readyFoes
        : this.combatants.filter((c) => combatHostile(c, u, this.combatants) && c.status === 'dying');

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
    } finally { this.actionIntent = undefined; this.intentActive = false; this.intentUseDone = false; }
  }

  /** utility 评分：构建候选动作列表，按分择优尝试执行；返回是否执行了任一动作 */
  private autoGridAction(unitId: string, reconsidered = false, failedAbilities = new Set<string>()): void {
    const unit = this.byId(unitId); const field = this.battlefield!;
    const actionBefore = `${this.actedThisTurn.has(unitId)}:${this.hasteSpent.get(unitId)}`;
    if (!this.isTurnOf(unitId) || unit.status !== 'ready' || this.isOver()) return;
    if (this.intentActive) this.followIntent(unit, this.actionIntent!);
    if (!this.isTurnOf(unitId) || unit.status !== 'ready' || this.isOver()) { if (!this.isOver() && this.isTurnOf(unitId)) this.endTurn(); return; }
    if (this.intentActive && this.actionIntent!.mode === 'attack' && !this.actionIntent!.targetId) { this.endTurn(); return; }
    if (this.intentActive && this.actionIntent!.mode === 'use_ability') {
      if (!this.intentUseDone || !this.nonSkillActionAvailable(unitId)) { this.endTurn(); return; }
      // The explicit use is one action. Spend any legal remainder in place without repeating it.
      failedAbilities.add(this.actionIntent!.abilityId!);
    }
    if (!this.intentActive && !isAirborne(unit) && !this.flightReason(unitId, true)) {
      // 地面绕行明显更贵时先升空；歼灭战以最近已知敌人的邻格为目标（扑击前保持机动优势）
      const known = this.visibleCombatants(unit.side);
      const nearestFoe = field.objective.kind === 'annihilation'
        ? known.filter((u) => combatHostile(u, unit, this.combatants) && ['ready', 'routing'].includes(u.status))
            .sort((a, b) => gridDistance(field, unit.pos!, a.pos!) - gridDistance(field, unit.pos!, b.pos!) || a.id.localeCompare(b.id))[0]
        : undefined;
      const goalCells = field.objective.kind === 'annihilation' ? (nearestFoe ? neighbors(field, nearestFoe.pos!) : []) : [field.objective.cell];
      if (goalCells.length && !goalCells.includes(unit.pos!)) {
        const air = { ...unit, airborne: true };
        const cheapest = (actor: Combatant) => Math.min(...goalCells.map((g) => findGridPath(field, unit.pos!, g, (n) => canOccupy(field, known, actor, n), (n, from) => movementStepCost(field, n, actor, this.fieldTags, from), actor)?.cost ?? Infinity));
        if (!this.flightRisks(unitId,true).length && cheapest(air) + 1 < cheapest(unit)) this.changeFlight(unitId, true);
      }
      if (unit.status !== 'ready') { if (!this.isOver()) this.endTurn(); return; }
    }
    // Read-only evaluation: observations and preview samples are reused until an action is chosen.
    this.observationMemo = new Map(); this.gridPathsMemo = new WeakMap(); beginPreviewScope(true);
    const plans: { score: number; path: GridPath; offensive?: boolean; selfDefenseScore?: number; targetId?: string; abilityId?: string; weaponMode?: SmallAttackOpts['weaponMode']; cell?: number; structureMode?: string; kind: 'structure' | 'gate' | 'climb' | 'weapon' | 'charge' | 'ability' | 'brace' | 'overwatch' | 'hold' | 'land' | 'reload' | 'haste-move' | 'haste-flight';
      /** V19：技能位移后的落点、对主目标的伤害预览、控制效果的生效概率与生效后的目标。 */
      landing?: number; preview?: { expectedDamage: number; variance?: number }; control?: CommandControl }[] = [];
    const knownUnits = this.visibleCombatants(unit.side);
    // V19 §1、§2：按当前作战阵营取指挥档案；来袭估值系数乘在来袭、反应与工事估值上（常规为 1）。
    const commandV2 = isCommandV2(this.rules), profile = commandV2 ? commandProfile(this.commanderProfiles, unit, this.combatants) : this.commanderProfiles[unit.side];
    const quality = commandV2 ? commandQuality(profile!.ability) : undefined, threat = quality?.incoming ?? 1;
    const objective = field.objective;
    const escorted = !this.intentActive && objective.kind === 'escape' && objective.unitId !== unitId
      ? knownUnits.find((u) => u.id === objective.unitId && !combatHostile(u, unit, this.combatants)) : undefined;
    const escortPath = escorted ? findGridPath(field, escorted.pos!, objective.cell,
      (n) => canOccupy(field, knownUnits.filter((u) => u.id !== unitId), escorted, n), (n, from) => movementStepCost(field, n, escorted, this.fieldTags, from), escorted) : undefined;
    const escortCorridor = new Set(escorted ? [objective.cell, ...(escortPath?.cells.slice(1) ?? [])] : []);
    const foes = knownUnits.filter((u) => combatHostile(u, unit, this.combatants) && ['ready', 'routing'].includes(u.status));
    const hasFear = foes.some((u) => activeTraitIds(u).some((id) => this.traitRegistry.get(id)?.effects.some((e) => e.kind === 'moraleAura' && e.scope === 'enemySide')));
    const rangedRole = isRangedWeapon(unit.weapon) && gridWeaponRange(unit.weapon, true, this.rules.armsModel) > 2;
    const meleeThreats = foes.filter((foe) => foe.status === 'ready' && meleeWeapon(foe) && (meleeContact(field, unit, foe) || isAirborne(foe)));
    const safeDistance = Math.min(gridWeaponRange(unit.weapon, true, this.rules.armsModel), meleeThreats.length
      ? Math.max(4, ...meleeThreats.map((foe) => movementPoints(foe, this.fieldTags) + 2)) : gridWeaponRange(unit.weapon, true, this.rules.armsModel));
    const allowed = (cell: number) => canOccupy(field, knownUnits, unit, cell);
    const lastOrigin = this.activationStarts.get(unitId)?.before;
    const hunt = !this.intentActive && objective.kind === 'annihilation' && !foes.length ? this.huntPlan(unit, knownUnits) : undefined;
    // 刚看见的敌人多半还在原处：追索时把它们算进落点危险，避免冲上去一看又退回来。
    const presumed = hunt ? this.presumedFoes(unit.side, knownUnits) : [];
    // V13 工事：据守单位离开阵地就失去工事。离开的代价按威胁最大的已知敌人（含刚失去视线的）打它一次时工事挡下的伤害估；
    // F1 看不见敌人时照常搜索；离开阵地的代价只在有已知或刚失联的敌人时计入。被压制时不计这项代价。
    const onWorks = traitsV13(unit) && entrenched(unit);
    const outgunned = onWorks && foes.some((foe) => foe.status === 'ready' && !this.weaponContext(foe, unit).reason)
      && !foes.some((foe) => (['primary', 'sidearm'] as const).some((weaponMode) => (weaponMode === 'primary' || unit.sidearm) && !this.weaponContext(unit, foe, { weaponMode }).reason));
    const worksValue = onWorks && !outgunned ? [...foes, ...presumed].filter((foe) => foe.status === 'ready').reduce((best, foe) => {
      const weapon = foe.weapon ?? foe.sidearm, opts = { attacker: foe, defender: unit, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: weapon, ranged: isRangedWeapon(weapon) };
      return Math.max(best, this.previewAttackWithEnvironment({ ...opts, defender: { ...unit, entrenchedAt: undefined } }).expectedDamage - this.previewAttackWithEnvironment(opts).expectedDamage);
    }, 0) * threat : 0;
    const worksCost = (cell: number) => worksValue > 0 && cell !== unit.entrenchedAt ? worksValue : 0;
    // 射手追线索时停在两三格外、看得到线索格的位置，由视野先确认，不直接踩进最后目击点。
    const lookout = (cell: number) => unitLineOfSight(field, { ...unit, pos: cell, airborne: false, elevation: undefined }, { ...unit, side: unit.side === 'enemy' ? 'ally' : 'enemy', pos: hunt!.focus, airborne: false, elevation: undefined });
    const standoff = hunt?.lead && rangedRole ? field.tiles.flatMap((_, cell) => [2, 3].includes(gridDistance(field, cell, hunt.focus)) && allowed(cell) && lookout(cell) ? [cell] : []) : [];
    const huntGoals = standoff.length ? standoff : hunt?.goals ?? [unit.pos!];
    // 估算自己在假想落点会不会挨打时，看已知敌人能否在那里看见自己；此刻藏在暗处不代表走过去也看不见。
    const sightContext = this.observationContext(), seen = new Map<string, boolean>(), spotters = [...knownUnits, ...presumed];
    const place = (u: Combatant) => `${u.pos}:${isAirborne(u) ? 'air' : isElevated(u) ? 'top' : 'ground'}`;
    const sightAt: HypotheticalSight = {
      sees: (observer, target) => {
        const key = `${observer.id}@${place(observer)}>${target.id}@${place(target)}${target.tacticalRevealed ? ':revealed' : ''}`;
        if (!seen.has(key)) seen.set(key, canSpot(sightContext, observer, target));
        return seen.get(key)!;
      },
      side: (side, target) => spotters.some((o) => o.side === side && o.status === 'ready' && sightAt.sees(o, target)),
    };
    const intentKnown = this.actionIntent ? this.intentKnown(unit) : knownUnits;
    const intended = intentOrder(field, unit, this.actionIntent, intentKnown, rangedRole);
    let order = intended ?? (this.intentActive ? undefined : regionalOrder(field, unit, knownUnits, profile, commandV2));
    if (!intended && order && field.city?.defender === unit.side && objective.kind === 'control'
      && Object.entries(this.controlRounds).some(([side, rounds]) => side !== unit.side && rounds > 0)) {
      order.goals = objective.cells ?? [objective.cell]; order.role = 'core'; order.phase = 'core-threat';
    }
    // V19 守点：防区是锚点不是笼子。驻守、占据的防区和夺点目标（守方）周围一次激活能回到的格子都算防区内，位置不因离开防区扣分；
    // 敌人站上防区格时取消这段活动范围，必须上点争夺或把它打下来；被够不着的射手攻击时出击（见 holdSortie）。对称夺点仍要站在点上。
    if (commandV2 && !order && objective.kind === 'control' && objective.attackingSide && combatSide(unit, this.combatants) === (objective.attackingSide === 'ally' ? 'enemy' : 'ally'))
      order = { role: rangedRole ? 'fire' : 'front', goals: objective.cells ?? [objective.cell], hold: true, phase: 'intact' };
    const zone = !this.intentActive && commandV2 && order?.hold && !isElevated(unit) && !isAirborne(unit) ? order.goals : undefined;
    const contested = !!zone && foes.some(foe => zone.includes(foe.pos!));
    const zoneCosts = zone && !contested ? gridCostsToGoals(field, zone, allowed, (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from), unit) : undefined;
    const area = zoneCosts ? field.tiles.flatMap((_, cell) => (zoneCosts.get(cell) ?? Infinity) <= this.movementBudget(unitId) ? [cell] : []) : [];
    const sortie = area.includes(unit.pos!) ? this.holdSortie(unit, zone!, area, foes, knownUnits) : undefined;
    if (sortie) order = { role: 'front', goals: sortie, phase: 'sortie' };
    const holdLeash = zoneCosts && !sortie ? this.movementBudget(unitId) : 0;
    const elevatedActor: Combatant = { ...unit, elevation: 1 };
    const firingPositions = !this.intentActive && rangedRole && unit.side === field.city?.defender ? field.tiles.flatMap((_,pos) => {
      if (!intactStructure(field,pos)?.top || !canOccupy(field,knownUnits,elevatedActor,pos)) return [];
      const actor={...elevatedActor,pos};
      const hasFire = foes.length ? foes.some(target=>!this.weaponContext(actor,target,{weaponMode:'primary'}).reason)
        : field.tiles.some((_,cell)=>!field.city!.inside.includes(cell)&&!field.city!.frontline.includes(cell)&&!groundBlocked(field,cell)
          && gridDistance(field,pos,cell)<=gridWeaponRange(actor.weapon, true, this.rules.armsModel)&&unitLineOfSight(field,actor,{...actor,pos:cell,elevation:undefined,side:unit.side==='ally'?'enemy':'ally'}));
      return hasFire?[pos]:[];
    }) : [];
    const wallRoutes = gridCostsToGoals(field,firingPositions,p=>canOccupy(field,knownUnits,elevatedActor,p),(p,from)=>movementStepCost(field,p,elevatedActor,this.fieldTags,from),elevatedActor);
    const climbApproaches = isElevated(unit) ? firingPositions : [...wallRoutes.keys()].flatMap(p=>neighbors(field,p).filter(n=>canOccupy(field,knownUnits,unit,n)&&!this.climbReason(unitId,p,n)));
    const goals = !this.intentActive && climbApproaches.length && !order?.phase.includes('threat') ? climbApproaches : order ? order.goals : objective.kind !== 'annihilation' ? [objective.cell]
      : foes.length ? field.tiles.flatMap((_, cell) => {
        if (!allowed(cell)) return [];
        const actor = { ...unit, pos: cell };
        return foes.some(target => rangedRole
          ? [actor.weapon, actor.sidearm].some(weapon => isRangedWeapon(weapon) && !weaponTargetReason({ actor, target,
              weapon: gridWeapon(weapon, this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel), ranged: true, distance: this.dist(actor, target), field }) && !this.sightReason(actor, target, weapon?.indirect)
            && !rangedScreen(actor, target, weapon, knownUnits, { mode: 'small', width: field.width, battlefield: field }, this.conditionDefMap()))
          : this.dist(actor, target) <= gridWeaponRange(meleeWeapon(actor), this.rules.combatModel === MEMBER_HEALTH_MODEL, this.rules.armsModel)
            && !this.sightReason(actor, target) && (meleeContact(field, actor, target) || isAirborne(actor))) ? [cell] : [];
      }) : huntGoals;
    const routeCosts = gridCostsToGoals(field, goals, allowed, (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from), unit);
    const positionParts = this.aiTrace ? new Map<GridPath, Record<string, number>>() : undefined;
    const positionScore = (path: GridPath) => {
      const cell = path.cells.at(-1)!;
      const destinationDistance = order ? Math.min(...goals.map(p => gridDistance(field, cell, p))) : objective.kind === 'annihilation'
        ? foes.length ? Math.min(...foes.map((foe) => gridDistance(field, cell, foe.pos!))) : Math.min(...huntGoals.map((p) => gridDistance(field, cell, p)))
        : gridDistance(field, cell, objective.cell);
      const nearest = foes.length ? Math.min(...foes.map((foe) => gridDistance(field, cell, foe.pos!))) : Infinity;
      // 远程保持有效射程；近战逼近、占领与护送仍以各自目标为准。
      const route = routeCosts.get(cell);
      const cohesion = field.layerVersion ? (commandV2 ? commandCohesion(profile!) : profile?.preferences?.cohesion ?? 2) : 2;
      const allies = knownUnits.filter(u => !combatHostile(u, unit, this.combatants) && u.id !== unitId && u.status === 'ready' && sameLayer(unit, u));
      const coordination = field.layerVersion && allies.length ? -(cohesion - 2) * .35 * Math.min(6, Math.max(0, Math.min(...allies.map(u => gridDistance(field, cell, u.pos!))) - 2))
        - Math.max(0, cohesion - 1) * .2 * allies.filter(u => u.pos === cell).length : 0;
      const spacing = rangedRole && foes.length && objective.kind === 'annihilation'
        ? -Math.abs(nearest - safeDistance) * 1.5 - Math.max(0, (route ?? destinationDistance) - holdLeash) * 2
        : -Math.max(0, (route ?? destinationDistance) - holdLeash) * 1.5;
      const exposure = rangedRole ? meleeThreats.reduce((sum, foe) => sum + Math.max(0, movementPoints(foe, this.fieldTags) + 2 - gridDistance(field, cell, foe.pos!)) * 2, 0) : 0;
      // 走回上次激活出发的格子要多付约一格进度的代价：真有威胁照样后撤，分差很小的来回踱步被压住。
      const backtrack = field.layerVersion && cell === lastOrigin && cell !== unit.pos ? BACKTRACK_COST : 0;
      // Old frozen maps/replays keep their previous positional tie-breaker.
      const terrain = field.layerVersion || field.generation?.version === 4 ? terrainTacticalValue(field, cell, unit, foes) : field.tiles[cell] === 'cover' ? .5 : 0;
      const travel = path.cost * 0.1;
      const departure = (field.layerVersion ? meleeThreats.filter(f => gridDistance(field, unit.pos!, f.pos!) <= 1 && gridDistance(field, cell, f.pos!) > 1).length : this.pathPreview(unitId, cell).risks.length) * 2;
      const fear = hasFear ? moraleRisk({ ...this.observationContext(), units: knownUnits.map((u) => u.id === unit.id ? { ...unit, pos: cell } : u) }, { ...unit, pos: cell }, this.rules.morale.breakAt, this.traitRegistry).breakChance * 6 : 0;
      positionParts?.set(path, { spacing, exposure, backtrack, coordination, terrain, travel, departure, fear });
      return spacing - exposure - backtrack + coordination + terrain - travel - departure - fear;
    };
    const incomingReduction = (before: Combatant, after: Combatant) => {
      const threats = foes.filter((f) => !this.sightReason(before, f))
        .sort((a, b) => this.dist(before, a) - this.dist(before, b) || a.id.localeCompare(b.id)).slice(0, 3);
      let reduction = 0;
      for (const foe of threats) {
        let best = 0;
        for (const charge of [false, true]) {
          const context = this.weaponContext(foe, before, { charge }, undefined, sightAt); if (context.reason) continue;
          const path = charge ? this.chargePath(foe, before) : undefined;
          const attacker = path ? { ...foe, pos: path.cells.at(-1)! } : foe;
          const params = { attacker, defender: before, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ranged: context.ranged, charge, weaponOverride: context.weapon, ...this.attackModifiers(attacker, before, context, { charge }) };
          best = Math.max(best, this.previewAttackWithEnvironment(params).expectedDamage - this.previewAttackWithEnvironment({ ...params, defender: after }).expectedDamage);
        }
        reduction += best;
      }
      return reduction * threat;
    };
    // 闪现与后撤不触发近战借机：退回位置评分里离开接触的估计代价（与 positionScore 同一口径）。
    const leaveRefund = (cell: number) => (field.layerVersion ? meleeThreats.filter(f => gridDistance(field, unit.pos!, f.pos!) <= 1 && gridDistance(field, cell, f.pos!) > 1).length
      : this.pathPreview(unitId, cell).risks.length) * 2;
    const incoming = (actor: Combatant): number => threat * [...foes, ...presumed].reduce((total,foe) => {
      const context = this.weaponContext(foe,actor,{},undefined,sightAt);
      if (context.reason) return total;
      return total + Math.min(memberHealth(actor),this.previewAttackWithEnvironment({attacker:foe,defender:actor,rules:this.rules,conditionDefs:this.conditionDefMap(),traitRegistry:this.traitRegistry,
        weaponOverride:context.weapon,ranged:context.ranged,...this.attackModifiers(foe,actor,context)}).expectedDamage);
    },0);
    const arrivals = new Map<string | GridPath, {actor:Combatant; loss:number; survival:number}>();
    const arrivalAfterReactions = (path: GridPath, charging = false) => {
      const key = isArmsV2(this.rules.armsModel) ? path.cells.join(',') + charging : path;
      const cached=arrivals.get(key);if(cached)return cached;
      if (!path.cost || !foes.length) return {actor:{...cloneData(unit),pos:path.cells.at(-1)!},loss:0,survival:1};
      const results: Combatant[]=[];let loss=0,alive=0;
      for(let sample=0;sample<8;sample++) {
        const copy=cloneData(unit), spent=new Set(this.reactionSpent),rng=new SeededRng('route-risk:'+sample);
        copy.pos=path.cells[0]!;
        for(const cell of path.cells.slice(1)) {
          const previous=copy.pos!;copy.pos=cell;delete copy.tacticalPose;
          for(const foe of foes) {
            if(copy.hp<=0||spent.has(foe.id)||foe.status!=='ready'||foe.suppression||foe.conditions.some(c=>c.dur>0&&(this.conditions.get(c.id)?.skipTurn||this.conditions.get(c.id)?.preventAttack&&baseMechanism(meleeWeapon(foe))!=='natural')))continue;
            const weapon=meleeWeapon(foe),ridingAway=agileDisengage(copy)||mountedShooting(copy)&&deploymentDepth(field,copy.side,cell)<deploymentDepth(field,copy.side,previous);
            const opportunity=!ridingAway&&weapon&&meleeContact(field,foe,{...copy,pos:previous})&&gridDistance(field,foe.pos!,previous)===1&&(gridDistance(field,foe.pos!,cell)>1||!meleeContact(field,foe,copy));
            const watching=this.overwatch.has(foe.id)&&!this.weaponContext(foe,copy,{},undefined,sightAt).reason;
            const denial=this.denialSources(copy,path.cells[0]!,previous,cell,spent,foes).some(u=>u.id===foe.id);
            if(!opportunity&&!watching&&!denial)continue;
            spent.add(foe.id);
            const context=this.weaponContext(foe,copy,{weaponMode:opportunity||denial?weapon===foe.sidearm?'sidearm':'primary':'auto'},undefined,sightAt);
            const beforeLoss=copy.scale==='hero'?memberHealth(copy):copy.hp;
            resolveAttack(this.environmentContext({attacker:cloneData(foe),defender:copy,rng,rules:this.rules,conditionDefs:this.conditionDefMap(),traitRegistry:this.traitRegistry,
              weaponOverride:opportunity||denial?weapon:context.weapon,ranged:!opportunity&&!denial&&context.ranged,actionDamageScale:!opportunity?this.hasteOverwatch.get(foe.id)??1:1,...this.attackModifiers(foe,copy,context),extraMods:[...this.attackModifiers(foe,copy,context).extraMods,...(denial?denialModifiers(copy,charging,this.overwatch.has(foe.id)):[])]}));
            if(denial&&charging&&(copy.scale==='hero'?memberHealth(copy)<beforeLoss:copy.hp<beforeLoss))copy.chargeInterrupted=true;
          }
          if(copy.hp<=0)break;
        }
        copy.pos=path.cells.at(-1)!; if(path.cost>0 && isArmsV2(this.rules.armsModel))copy.movedDuringActivation=true;loss+=memberHealth(unit)-memberHealth(copy);alive+=Number(copy.hp>0);results.push(copy);
      }
      results.sort((a,b)=>memberHealth(a)-memberHealth(b));
      const result={actor:results[Math.floor(results.length/2)]!,loss:threat*loss/8,survival:alive/8};arrivals.set(key,result);return result;
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
        for (const ally of knownUnits.filter(other => !combatHostile(other, unit, this.combatants) && other.id !== unitId && other.status === 'ready')) {
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
    // V19 §2.2 配合预判的对象：眩晕、定身、致盲、缴械、混乱、魅惑、嘲讽、破绽、易伤，或把目标推拉进己方拒止范围。
    const holders = quality?.cooperation ? knownUnits.filter(u => u.id !== unitId && !combatHostile(u, unit, this.combatants) && denialReady(u, this.conditionDefMap())) : [];
    const coordinatedControl = (context: ObservationContext, caster: Combatant, target: Combatant, ability: Combatant['abilities'][number], chance: (affected: Combatant, needsDamage: boolean) => number) => {
      const conditions = ability.effects.filter((e): e is Extract<EffectOp, { op: 'condition' }> => e.op === 'condition' && COORDINATED_CONTROLS.has(e.conditionId));
      const push = conditions.length ? undefined : ability.effects.find((e): e is Extract<EffectOp, { op: 'push' }> => e.op === 'push');
      const cell = push ? pushPreview(context, caster, target, push).cell : undefined;
      if (!conditions.length && (cell === undefined || !holders.some(h => gridDistance(field, h.pos!, cell) <= 2))) return undefined;
      const first = conditions[0];
      const p = first ? conditionChance(target, first) * (first.onDamage ? chance(target, true) : first.onHit ? chance(target, false) : 1) : push!.onHit ? chance(target, false) : 1;
      return { p, conditions: conditions.map(e => ({ id: e.conditionId, dur: e.dur, sourceId: caster.id, potency: e.potency, magnitude: e.magnitude, defensePower: e.defensePower })), ...(cell === undefined ? {} : { cell }) };
    };
    let restValue = 0;
    if (unit.resourceModel && !this.actedThisTurn.has(unitId) && !this.movedThisTurn.has(unitId) && this.hasteSpent.get(unitId) !== this.round) {
      const context = { ...this.observationContext(), units: knownUnits };
      if (!this.reactionSpent.has(unitId)) restValue = tacticalRestValue(context, unit);
    }
    const overwatchValue = order?.hold || unit.side === 'ally' && this.allyTactic === 'defensive'
      ? this.holdOverwatchValue(unit, foes, knownUnits, sightAt) : 0;
    const reachable = this.intentActive ? [{ cells: [unit.pos!], cost: 0 }] : this.reachableCells(unitId);
    // Stage 1: cheap regional/position scoring; stage 2: costly damage/skill previews at bounded locations.
    const scored = field.layerVersion ? new Map(reachable.map(path => [path, positionScore(path)])) : undefined;
    const shortlist = field.layerVersion ? [...reachable].sort((a, b) => scored!.get(b)! - scored!.get(a)! || a.cost - b.cost).slice(0, 12) : reachable;
    if (field.layerVersion && !shortlist.some(p => p.cost === 0)) shortlist.push(reachable.find(p => p.cost === 0)!);
    const tracePositions: Record<string, unknown>[] | undefined = this.aiTrace ? [] : undefined;
    for (const path of shortlist.filter(Boolean)) {
      const projected = arrivalAfterReactions(path), actor = projected.actor;
      if (actor.hp <= 0 || projected.survival < .5) {
        this.aiTrace?.(structuredClone({ stage: 'generation-filter', mode: 'small', unitId, round: this.round, path, reason: 'arrival-survival', hp: actor.hp, survival: projected.survival }));
        continue;
      }
      const skillContext = { ...this.observationContext(), units: knownUnits.map(u => u.id === actor.id ? actor : u) };
      // 协同单位在通路旁支援，不用自身占位堵住己方护送对象；敌方仍可拦截。
      if (!this.intentActive && escortCorridor.has(actor.pos!)) continue;
      const positionValue = scored?.get(path) ?? positionScore(path), incomingValue = incoming(actor), worksPenalty = worksCost(actor.pos!);
      const baseScore = positionValue - projected.loss * 1.5 - threat*(1-projected.survival)*memberHealth(unit) - incomingValue*.3 - worksPenalty;
      tracePositions?.push({ path: structuredClone(path), positionValue, positionComponents: positionParts?.get(path), reactionLoss: projected.loss, survival: projected.survival, incoming: incomingValue, worksPenalty, baseScore });
      if (!this.intentActive && field.layerVersion && this.nonSkillActionAvailable(unitId)) {
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
            const coefficient = 1 + ((profile?.preferences?.breach ?? 2) - 2) * .15;
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
          else if (door.gateState === 'open' && unit.side === field.city?.defender && !knownUnits.some(u => !combatHostile(u, unit, this.combatants) && !field.city?.inside.includes(u.pos!) && gridDistance(field, u.pos!, cell) <= 2)) plans.push({ kind: 'gate', path, cell, score: baseScore + 12 });
        }
      }
      if (isAirborne(unit) && path.cost + 1 <= this.movementLeft(unitId) && canOccupy(field, this.visibleCombatants(unit.side), { ...actor, airborne: false }, actor.pos!)) plans.push({ score: baseScore + (objective.kind !== 'annihilation' && actor.pos === field.objective.cell ? 6 : 0.1), path, kind: 'land' });
      plans.push({ score: baseScore + (path.cost === 0 ? restValue : 0) + (foes.length && path.cost === 0 && canReconceal(this.observationContext(), unit) ? 4 : 0), path, kind: 'hold' });
      if (!this.nonSkillActionAvailable(unitId)) continue;
      if (path.cost === 0 && overwatchValue > 0) plans.push({ score: baseScore + overwatchValue, path, kind: 'overwatch' });
      if (!this.braceReason(unitId)) {
        const threats = foes.filter((f) => !this.sightReason(actor, f)).sort((a, b) => this.dist(actor, a) - this.dist(actor, b) || a.id.localeCompare(b.id)).slice(0, 3);
        const braced = { ...actor, tacticalPose: bracePose(actor, threats[0], 'small', field.width,field.height) };
        const avoided = incomingReduction(actor, braced);
        const protectedDamage = shieldProtectionValue(braced);
        if (avoided > 0 || protectedDamage > 0) plans.push({ score: baseScore + avoided * 0.3 + protectedDamage, selfDefenseScore: avoided * 0.3, path, kind: 'brace' });
      }
      for (const target of foes) for (const weaponMode of (actor.sidearm ? ['primary', 'sidearm'] : ['primary']) as ('primary' | 'sidearm')[]) {
        const context = this.weaponContext(actor, target, { weaponMode });
        if (context.reason || context.landing && path.cost + 1 > this.movementLeft(unitId)) {
          this.aiTrace?.(structuredClone({ stage: 'generation-filter', mode: 'small', unitId, round: this.round, kind: 'weapon', path, targetId: target.id, weaponMode, reason: context.reason ?? 'landing-movement' }));
          continue;
        }
        const arrival = context.landing ? { ...actor, airborne: false } : actor;
        const mods = this.attackModifiers(arrival, target, context);
        if (path.cost > 0 && context.ranged && !this.movedThisTurn.has(unitId) && !steadyMovingShot(actor, context.weapon)) mods.extraMods.push({ source: 'stance', category: 'movement' as const, name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
        const preview = this.previewAttackWithEnvironment({ attacker: arrival, defender: target, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon, ranged: context.ranged, actionDamageScale: this.usingHaste(unitId) ? hasteAttackScale(unit) : 1, ...mods });
        // 预览已经包含整轮速射；再次乘段数会高估自动武器并压低技能的选择机会。
        // R16 喷射：以这名敌人为扇形方向，价值是扇形内各目标的预览期望伤害之和（只看可见单位）。
        const sprayDamage = this.sprays(context.weapon) ? this.sprayVictims(arrival, target, knownUnits).filter(v => v.id !== target.id).reduce((sum, v) => {
          const victimMods = this.attackModifiers(arrival, v, context);
          if (path.cost > 0 && context.ranged && !this.movedThisTurn.has(unitId) && !steadyMovingShot(actor, context.weapon)) victimMods.extraMods.push({ source: 'stance', category: 'movement' as const, name: '移动射击', kind: 'atk', type: 'flat', value: -2 });
          return sum + Math.min(memberHealth(v), this.previewAttackWithEnvironment({ attacker: arrival, defender: v, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon, ranged: context.ranged, actionDamageScale: this.usingHaste(unitId) ? hasteAttackScale(unit) : 1, ...victimMods }).expectedDamage);
        }, 0) : 0;
        const volleyDamage = Math.min(memberHealth(target), preview.expectedDamage) + sprayDamage;
        plans.push({ score: baseScore + volleyDamage + (preview.conditionValue ?? 0) + (volleyDamage >= memberHealth(target) ? 4 : 0), offensive: volleyDamage + (preview.conditionValue ?? 0) > 0, path, targetId: target.id, weaponMode, kind: 'weapon', preview });
      }
      for (const listedAbility of actor.abilities) {
        const ability = listedAbility;
        if (this.intentActive && hasSkillMovement(ability)) continue;
        if (!quickItemAction(actor, ability) && (this.actedThisTurn.has(unitId) || this.hasteSelected.has(unitId))) continue;
        if (failedAbilities.has(ability.id) || abilityUsabilityReason(actor, ability) || this.summonReason(actor, ability)) continue;
        if (movementOnlySkill(ability)) continue;
        const candidates = ability.target === 'zone' ? this.visibleCombatants(actor.side).filter(u=>u.status==='ready') : ability.target === 'self' ? [actor] : ability.target === 'enemy' ? foes : this.combatants.filter((target) => !combatHostile(target, actor, this.combatants)
          && (['ready', 'routing'].includes(target.status) || target.status === 'dying' && ability.effects.some((e) => e.op === 'heal')));
        const withdraw = moveEffects(ability).after, retreats = new Map<number, number>();
        // 出手后后撤：按后撤落点与原地的位置评分、受击估计之差计入（与是否值得用这招一起比较）。
        const retreatValue = (from: Combatant): number => {
          if (!withdraw) return 0;
          if (!retreats.has(from.pos!)) {
            const landing = this.skillWithdrawPath(from, ability, withdraw).path?.cells.at(-1);
            retreats.set(from.pos!, landing === undefined ? 0 : positionScore({ cells: [from.pos!, landing], cost: 0 }) + leaveRefund(landing) - incoming({ ...from, pos: landing }) * .3 - worksCost(landing)
              - (positionScore({ cells: [from.pos!], cost: 0 }) - incoming(from) * .3 - worksCost(from.pos!)));
          }
          return retreats.get(from.pos!)!;
        };
        for (const target of candidates) {
          // V15 编队用道具按件数折算；与实际使用同一份派生行动。
          const itemUse = this.itemUse(actor, listedAbility, target);
          if (itemUse.reason) continue;
          const ability = itemUse.ability;
          // 突进/闪现只从当前位置估算：从落点出手，计入途中反应、落点受击与冲锋。
          let caster = actor, moveScore: number | undefined, move: ReturnType<SmallBattle['skillMovePlan']>['move'];
          if (this.skillTargetReasonAt(actor, ability, target)) {
            // 突进/闪现：先走到这个位置、再从这里位移出手；只看位移加射程够得着的目标。
            const before = moveEffects(ability).before;
            if (!before || gridDistance(field, actor.pos!, target.pos!) > before.reach + fallbackAbilityRange(actor, gridAbility(ability, actor.armsModel), true).max + 1) continue;
            move = this.skillMovePlan(actor, ability, target).move; if (!move) continue;
            const dash = move.path ? arrivalAfterReactions(move.path,move.charge) : { actor: { ...cloneData(unit), pos: move.to }, loss: 0, survival: 1 };
            const survival = projected.survival * dash.survival;
            if (dash.actor.hp <= 0 || survival < .5) continue;
            // 编队的人数与成员生命分组须取自同一份副本，不能只换人数：取两段路线里伤得更重的那一份。
            caster = hasMemberHealth(actor) ? { ...(memberHealth(dash.actor) < memberHealth(actor) ? dash.actor : actor), pos: move.to }
              : { ...actor, hp: Math.min(actor.hp, dash.actor.hp), pos: move.to };
            moveScore = positionScore({ cells: [unit.pos!, move.to], cost: path.cost }) + (move.mode === 'blink' && path.cost === 0 ? leaveRefund(move.to) : 0) - (projected.loss + dash.loss) * 1.5
              - threat * (1 - survival) * memberHealth(unit) - incoming(caster) * .3 - worksCost(move.to);
          }
          const moved = path.cost > 0 || !!move, casterContext = move ? { ...skillContext, units: skillContext.units.map(u => u.id === caster.id ? caster : u) } : skillContext;
          let benefit = 0, expectedDamage = 0, mainPreview: ReturnType<SmallBattle['previewAttackWithEnvironment']> | undefined;
          const damageForControl = ability.effects.find((e) => e.op === 'damage');
          const controlPreviews = new Map<string, ReturnType<SmallBattle['previewAttackWithEnvironment']>>();
          const controlChance = (affected: Combatant, needsDamage: boolean) => {
            if (!damageForControl) return 1;
            if (!controlPreviews.has(affected.id)) controlPreviews.set(affected.id, this.previewAttackWithEnvironment({ attacker: caster, defender: affected, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(caster, affected, ability, damageForControl, moved, !!move?.charge && affected.id === target.id) }));
            const preview = controlPreviews.get(affected.id)!;
            return needsDamage ? preview.damageChance ?? (preview.expectedDamage > 0 ? preview.hitChance : 0) : preview.anyHitChance ?? preview.hitChance;
          };
          for (const effect of healingEffectGroups(ability)) {
            if (effect.op === 'damage') for (const affected of this.abilityDamageTargets(caster, target, ability, effect.shape === 'burst')) {
              const preview = this.previewAttackWithEnvironment({ attacker: caster, defender: affected, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, ...this.skillAttackOptions(caster, affected, ability, effect, moved, !!move?.charge && affected.id === target.id) });
              benefit += preview.expectedDamage + (preview.conditionValue ?? 0);
              if (affected.side !== actor.side) expectedDamage += preview.expectedDamage;
              if (affected.id === target.id) mainPreview ??= preview;
            }
            if (effect.op === 'heal') for (const affected of this.abilityDamageTargets(caster, target, ability, ability.shape === 'burst')) benefit += Math.min(recoveryCapacity(affected), healingYield(actor, affected, effect.amount ?? diceAvg(effect.dice!), !!ability.itemSourceId, effect.power));
            if (effect.op === 'summon') benefit += summonValue(casterContext, caster, ability, effect);
            if (effect.op === 'zone' || effect.op === 'barrier' || effect.op === 'push' || effect.op === 'dispel' || effect.op === 'trait') for (const affected of this.abilityDamageTargets(caster, target, ability, ability.shape === 'burst')) benefit += skillEffectValue(casterContext, caster, affected, { ...ability, effects: [effect] }, controlChance(affected, false));
            if (effect.op === 'morale') for (const affected of this.abilityDamageTargets(caster, target, ability, ability.shape === 'burst')) benefit += moraleChangePreview({ ...this.observationContext(), units: this.visibleCombatants(actor.side) }, affected, effect.amount, this.rules.morale.breakAt, this.traitRegistry, ability.effects.flatMap((e) => e.op === 'condition' ? [{ id: e.conditionId, dur: e.dur }] : [])).value * (affected.side === actor.side ? 1 : -1);
          }
          for (const affected of this.abilityDamageTargets(caster, target, ability, ability.shape === 'burst')) benefit += skillEffectValue(casterContext, caster, affected, { ...ability, effects: ability.effects.filter(e => e.op === 'condition') }, controlChance(affected, false), controlChance(affected, true)) * Math.max(0, 1 - (controlPreviews.get(affected.id)?.expectedDamage ?? 0) / Math.max(1, memberHealth(affected)));
          const landing = this.abilityFlightPreview(caster, target, ability);
          if (landing) benefit += Math.min(target.hp, landing.fallDamage) * (landing.fallChance ?? 1);
          for (const affected of ability.recipe || ability.itemSourceId || ability.equipmentSourceId ? this.abilityDamageTargets(caster, target, ability, ability.shape === 'burst') : [caster]) benefit += skillEffectValue(casterContext, caster, affected, { ...ability, effects: ability.effects.filter(e => e.op === 'resource') });
          // V15：治疗品对濒死或伤重的目标放开使用。
          const cost = tacticalSkillCost(skillContext, actor, ability, expectedDamage)
            * (ability.itemSourceId && itemsV15(actor) && ability.effects.some((e) => e.op === 'heal') && itemEmergency(target) ? ITEM_EMERGENCY_DISCOUNT : 1);
          this.aiTrace?.({ stage: 'ability-value', mode: 'small', unitId, round: this.round, abilityId: ability.id, targetId: target.id, cell: actor.pos, benefit, cost, generated: benefit > cost });
          const control = quality?.cooperation && combatHostile(target, actor, this.combatants) ? coordinatedControl(casterContext, caster, target, ability, controlChance) : undefined;
          if (benefit > cost) plans.push({ score: (moveScore ?? baseScore) + benefit - cost + retreatValue(caster), offensive: combatHostile(target, actor, this.combatants), path, targetId: target.id, abilityId: ability.id, kind: 'ability',
            ...(mainPreview ? { preview: mainPreview } : {}), ...(move ? { landing: move.to } : {}), ...(control ? { control } : {}) });
        }
      }
      // 单纯位移技能：只从当前位置估算；先按位置评分粗筛，再对少数落点计算途中反应与落点受击。用后仍可走剩余移动点。
      if (!this.intentActive && path.cost === 0 && !this.actedThisTurn.has(unitId) && !this.hasteSelected.has(unitId)) for (const listed of actor.abilities) {
        if (!movementOnlySkill(listed) || failedAbilities.has(listed.id)) continue;
        const itemUse = this.itemUse(actor, listed);
        if (itemUse.reason || abilityUsabilityReason(actor, itemUse.ability)) continue;
        const ability = itemUse.ability;
        const { before, after } = moveEffects(ability), effect = (before ?? after)!;
        const reach = effectiveMoveReach(actor, ability, effect, this.conditions);
        if (!reach || moveBlockReason(actor, this.conditions)) continue;
        const landings = effect.mode === 'blink' ? this.skillBlinkCells(actor, reach).map((cell) => ({ cell, route: undefined as GridPath | undefined }))
          : this.skillPaths(actor, reach).filter((p) => p.cost > 0).map((p) => ({ cell: p.cells.at(-1)!, route: p as GridPath | undefined }));
        const cost = tacticalSkillCost(skillContext, actor, ability);
        const shortlist = landings.map((l) => ({ ...l, pre: positionScore({ cells: [actor.pos!, l.cell], cost: 0 }) + (effect.mode === 'dash' ? 0 : leaveRefund(l.cell)) - worksCost(l.cell) }))
          .filter((l) => !escortCorridor.has(l.cell)).sort((a, b) => b.pre - a.pre || a.cell - b.cell).slice(0, 6);
        for (const landing of shortlist) {
          // 后撤只受警戒射击，按无借机估算；突进途中照常估算借机与警戒。
          const projected = effect.mode === 'dash' && landing.route ? arrivalAfterReactions(landing.route,true) : { actor: { ...cloneData(unit), pos: landing.cell }, loss: 0, survival: 1 };
          if (projected.actor.hp <= 0 || projected.survival < .5) continue;
          const score = landing.pre - projected.loss * 1.5 - threat * (1 - projected.survival) * memberHealth(unit) - incoming({ ...projected.actor, pos: landing.cell }) * .3 - cost;
          plans.push({ score, path, targetId: 'cell:' + landing.cell, abilityId: ability.id, kind: 'ability', landing: landing.cell });
        }
      }
    }
    if (!this.intentActive && this.nonSkillActionAvailable(unitId)) for (const target of foes) {
      const context = this.weaponContext(unit, target, { charge: true });
      const path = context.reason ? undefined : this.chargePath(unit, target);
      if (!path) continue;
      const projected=arrivalAfterReactions(path,true);
      if(projected.actor.hp<=0||projected.survival<.5)continue;
      const arrival = { ...projected.actor, pos: path.cells.at(-1)!, ...(context.landing ? { airborne: false } : {}) };
      if (escortCorridor.has(arrival.pos)) continue;
      const preview = this.previewAttackWithEnvironment({ attacker: arrival, defender: target, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry,
        weaponOverride: context.weapon, ranged: false, charge: true, actionDamageScale: this.usingHaste(unitId) ? hasteAttackScale(unit) : 1, ...this.attackModifiers(arrival, target, context, { charge: true, ...(isArmsV2(this.rules.armsModel) ? {chargeDistance:path.cells.length-1, chargeStraight:straightGridPath(path.cells,field.width)} : {}) }) });
      plans.push({ score: positionScore(path) - projected.loss*1.5 - threat*(1-projected.survival)*memberHealth(unit) - incoming(arrival)*.3 - worksCost(arrival.pos!) + Math.min(memberHealth(target), preview.expectedDamage) + (preview.expectedDamage >= memberHealth(target) ? 4 : 0), offensive: preview.expectedDamage > 0, path, targetId: target.id, kind: 'charge', preview });
    }
    if (this.nonSkillActionAvailable(unitId)) {
      const stay: GridPath = { cells: [unit.pos!], cost: 0 };
      for (const sidearm of [false, true]) if (!this.reloadReason(unitId, sidearm)) {
        if ((this.reloadCd.get(weaponReloadKey(unit, sidearm ? unit.sidearm : unit.weapon)) ?? 0) <= 1 && (this.actedThisTurn.has(unitId) || !this.hasteAvailable(unitId))) continue;
        const reload = new Map(this.reloadCd); reload.delete(weaponReloadKey(unit, sidearm ? unit.sidearm : unit.weapon));
        const value = actionPotential({ ...this.observationContext(), units: knownUnits, reload }, unit, undefined, true);
        plans.push({ kind: 'reload', weaponMode: sidearm ? 'sidearm' : 'primary', path: stay, score: positionScore(stay) + value * 0.5 });
      }
      if (!this.intentActive && this.actedThisTurn.has(unitId) && this.hasteAvailable(unitId)) {
        const extraPaths = reachableGridPaths(field, unit.pos!, this.movementLeft(unitId) + this.movementBudget(unitId), allowed, (n, from) => movementStepCost(field, n, unit, this.fieldTags, from), unit);
        for (const path of extraPaths.filter(p => p.cost > this.movementLeft(unitId))) plans.push({ kind: 'haste-move', path, score: positionScore(path) - 0.25 - worksCost(path.cells.at(-1)!) });
        const flying = { ...unit, airborne: !isAirborne(unit) };
        if ((isAirborne(unit) || !flightCapabilityReason(unit, this.conditions)) && canOccupy(field, knownUnits, flying, flying.pos!)) {
          const value = incomingReduction(unit, flying) * 0.5 + (isAirborne(unit) && objective.kind !== 'annihilation' && unit.pos === field.objective.cell ? 6 : 0);
          if (value > 0) plans.push({ kind: 'haste-flight', path: stay, score: positionScore(stay) + value - worksValue });
        }
      }
    }
    const tactic = unit.side === 'ally' ? this.allyTactic : 'balanced';
    // After two quiet rounds, a healthy attacker can commit through one affordable
    // reaction. Charging it as a recurring loss otherwise makes mutual denial an
    // endless wait. Keep the sampled survival penalty and the damaged arrival.
    if (commandV2 && this.round >= 3 && tactic !== 'defensive' && !order?.hold
      && !this.actedThisTurn.has(unitId) && !commandAttacked(this.commandRounds, combatSide(unit, this.combatants)).size)
      for (const plan of plans) if (plan.offensive && plan.targetId && plan.path.cost > 0 && (plan.preview?.expectedDamage ?? 0) > 0) {
        const arrival = arrivalAfterReactions(plan.path, plan.kind === 'charge');
        if (arrival.survival >= .875 && arrival.loss <= memberHealth(unit) * .35)
          plan.score += arrival.loss * 1.5;
      }
    // 逃脱任务的防守方若已经占住出口，不应为了普通位置评分主动让路。
    // 仍保留原地攻击/固守/警戒；若出口上的动作全部非法，再回退到普通候选。
    const defendsEscape = objective.kind === 'escape'
      && this.combatants.some(other => other.id === objective.unitId && combatHostile(other, unit, this.combatants));
    // 单纯自保不能推进战斗：存在有效进攻时，仅保留固守的队友掩护收益。
    // 无法还击或玩家明确选择固守时，仍允许靠姿态减轻当前威胁。
    if (!this.actedThisTurn.has(unitId) && tactic !== 'defensive' && plans.some(plan => plan.offensive)) for (const plan of plans) plan.score -= plan.selfDefenseScore ?? 0;
    if (tactic === 'aggressive') for (const plan of plans) if (['weapon','charge'].includes(plan.kind)) plan.score += plan.kind === 'charge' ? 3 : 1.5;
    // 固守只影响自动决策；护送对象抵达出口仍优先，手动命令不受限制。
    const eligible = tactic === 'defensive' && !(objective.kind === 'escape' && objective.unitId === unitId) ? plans.filter(plan => plan.path.cost === 0) : plans;
    const anchored = defendsEscape && unit.pos === objective.cell
      ? eligible.filter(plan => plan.path.cells.at(-1) === objective.cell)
      : [];
    const focused = this.intentActive && this.actionIntent?.targetId ? eligible.filter(plan => plan.offensive && plan.targetId === this.actionIntent!.targetId) : [];
    const candidates = focused.length ? focused : anchored.length ? anchored : eligible.length ? eligible : plans;
    const completesEscort = (plan: typeof plans[number]) => objective.kind === 'escape' && objective.unitId === unitId
      && plan.path.cells.at(-1) === objective.cell && (!isAirborne(unit) || plan.kind === 'land');
    const choice = (plan: typeof plans[number]) => ({
      key: JSON.stringify(field.layerVersion ? [plan.kind, plan.path.cells, plan.targetId, plan.abilityId, plan.weaponMode, plan.cell, plan.structureMode] : [plan.kind, plan.path.cells, plan.targetId, plan.abilityId, plan.weaponMode]), score: plan.score,
      attack: !!plan.offensive, breach: plan.kind === 'structure', ranged: plan.kind === 'structure' ? plan.structureMode?.startsWith('ability:') ? unit.abilities.find(a => a.id === plan.structureMode!.slice(8))?.delivery !== 'melee' : isRangedWeapon(plan.structureMode === 'sidearm' ? unit.sidearm : unit.weapon) : plan.kind === 'weapon' ? isRangedWeapon(plan.weaponMode === 'sidearm' ? unit.sidearm : unit.weapon) : plan.kind === 'ability' && !movementOnlySkill(unit.abilities.find(a => a.id === plan.abilityId) ?? { effects: [] }) && (unit.abilities.find(a => a.id === plan.abilityId)?.range?.max ?? 0) > 1,
      move: plan.path.cost > 0 || plan.kind === 'ability' && hasSkillMovement(unit.abilities.find(a => a.id === plan.abilityId) ?? { effects: [] }), defend: plan.kind === 'brace' || plan.kind === 'hold' || plan.kind === 'overwatch' || plan.kind === 'ability' && !!unit.abilities.find(a => a.id === plan.abilityId)?.effects.some(e => e.op === 'barrier' || e.op === 'heal' || e.op === 'dispel' && e.polarity === 'negative' || e.op === 'condition' && ['blessed','encouraged'].includes(e.conditionId)),
    });
    const turnKey = `${this.seed}:${this.round}:${unitId}`;
    const scoreTrace = this.aiTrace ? (event: object) => this.aiTrace!({ stage: 'scores', mode: 'small', unitId, round: this.round, ...event }) : undefined;
    const commandScoresList = commandV2 ? this.commandV2Scores(unit, candidates, choice, profile!, quality!, turnKey, foes, knownUnits, sightAt, (cell) => incoming({ ...unit, pos: cell }), scoreTrace)
      : commanderScores(candidates.map(choice), profile, turnKey, !!field.layerVersion, scoreTrace);
    const ranked = new Map(candidates.map((plan, i) => [plan, commandScoresList[i]!]));
    const best = candidates.sort((a, b) => Number(completesEscort(b)) - Number(completesEscort(a))
      || ranked.get(b)! - ranked.get(a)! || a.path.cost - b.path.cost || (a.targetId ?? '').localeCompare(b.targetId ?? ''))[0];
    this.aiTrace?.(structuredClone({ stage: 'decision', mode: 'small', unitId, side: unit.side, round: this.round, reconsidered,
      tactic, known: knownUnits.map(u => ({ id: u.id, side: u.side, pos: u.pos, hp: u.hp, status: u.status })),
      resources: unit.resources, movementLeft: this.movementLeft(unitId), acted: this.actedThisTurn.has(unitId),
      onWorks, worksValue, huntGoals, goals, regionalOrder: order, reachable: reachable.length, shortlist: shortlist.map(p => p.cells),
      positions: tracePositions, plans: plans.map(p => ({ ...p, eligible: eligible.includes(p), candidate: ranked.has(p), finalScore: ranked.get(p) })), best }));
    this.observationMemo = undefined; this.gridPathsMemo = undefined; endPreviewScope();
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
          // 单纯位移不占移动点：落位后照常用剩余移动点走位。
          if (result.ok && movementOnlySkill(unit.abilities.find(a => a.id === best.abilityId) ?? { effects: [] }) && unit.status === 'ready' && !this.isOver() && this.movementLeft(unitId) > 0) {
            this.autoGridAction(unitId, true, failedAbilities); return;
          }
        }
        else if (best.kind === 'haste-move') { /* 额外机动已在上方执行。 */ }
        else if (best.kind === 'haste-flight') this.changeFlight(unitId, !isAirborne(unit));
        else if (best.kind === 'reload') this.reloadWeapon(unitId, best.weaponMode === 'sidearm');
        else if (best.kind === 'land' && !this.flightReason(unitId, false)) this.changeFlight(unitId, false);
        else if (best.kind === 'brace' && !this.braceReason(unitId)) this.brace(unitId);
        else if (best.kind === 'overwatch' && !this.overwatchReason(unitId)) this.setOverwatch(unitId);
        else if (!(isEnduranceModel(unit.resourceModel) && best.kind === 'hold') && !(best.path.cost === 0 && canReconceal(this.observationContext(), unit)) && !this.overwatchReason(unitId)) this.setOverwatch(unitId);
      }
    }
    // 扑击脱离：落地后仍贴近持械地面近战且还能起飞时升空规避（起飞借机是已知代价）
    if (!this.intentActive && best?.kind !== 'land' && !(unit.resourceModel && best?.kind === 'hold') && !isAirborne(unit) && unit.status === 'ready' && !this.isOver() && !this.flightReason(unitId, true)
      && this.visibleCombatants(unit.side).some((foe) => combatHostile(foe, unit, this.combatants) && foe.status === 'ready' && !isAirborne(foe) && !!meleeWeapon(foe) && this.dist(unit, foe) === 1)) {
      this.changeFlight(unitId, true);
    }
    if (!this.isOver() && unit.status === 'ready' && this.nonSkillActionAvailable(unitId) && actionBefore !== `${this.actedThisTurn.has(unitId)}:${this.hasteSpent.get(unitId)}`) { this.autoGridAction(unitId, true, failedAbilities); return; }
    if (!this.isOver()) this.endTurn();
  }

  /** V19 守点出击：防区活动范围内的单位被射手攻击过（本轮或上一轮），从活动范围内哪一格都打不到它，而且敌方近战一次激活内都打不到防区时，
   *  去打两次激活内够得到的那名射手，返回能攻击它的落点；射手倒下、看不见或敌方近战逼近时回到防区。 */
  private holdSortie(unit: Combatant, zone: number[], area: number[], foes: Combatant[], known: Combatant[]): number[] | undefined {
    const field = this.battlefield!, side = combatSide(unit, this.combatants), arms = this.rules.armsModel;
    const reach = Math.max(gridWeaponRange(unit.weapon, true, arms), gridWeaponRange(unit.sidearm, true, arms));
    if (!reach || foes.some(f => f.status === 'ready' && !isRangedWeapon(f.weapon) && !!meleeWeapon(f)
      && zone.some(cell => gridDistance(field, cell, f.pos!) <= movementPoints(f, this.fieldTags) + gridWeaponRange(meleeWeapon(f), true, arms)))) return undefined;
    const shooters = commandAttackers(this.commandRounds, side), allowed = (cell: number) => canOccupy(field, known, unit, cell);
    let best: { cells: number[]; cost: number } | undefined;
    for (const shooter of foes.filter(f => shooters.has(f.id) && isRangedWeapon(f.weapon) && area.every(cell => gridDistance(field, cell, f.pos!) > reach)).sort((a, b) => a.id.localeCompare(b.id))) {
      const cells = field.tiles.flatMap((_, cell) => gridDistance(field, cell, shooter.pos!) <= reach && allowed(cell) && !this.weaponContext({ ...unit, pos: cell }, shooter).reason ? [cell] : []);
      const cost = cells.length ? gridCostsToGoals(field, cells, allowed, (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from), unit).get(unit.pos!) : undefined;
      if (cost !== undefined && cost <= 2 * this.movementBudget(unit.id) && (!best || cost < best.cost)) best = { cells, cost };
    }
    return best?.cells;
  }
  /** V19：§2.2 配合预判、§3 风格行为项、§2.3 大师方案比较。只读估值，不消耗战斗随机数。 */
  /** One possible reaction against an observed enemy's legal next move; never sum several shots. */
  private holdOverwatchValue(actor: Combatant, foes: Combatant[], known: Combatant[], sight: HypotheticalSight): number {
    if (this.overwatch.has(actor.id) || this.overwatchReason(actor.id)) return 0;
    const field = this.battlefield!, defs = this.conditionDefMap();
    const reach = Math.max(gridWeaponRange(actor.weapon, true, this.rules.armsModel), gridWeaponRange(actor.sidearm, true, this.rules.armsModel));
    const threats = foes.filter(foe => foe.status === 'ready' && !foe.conditions.some(c => c.dur > 0 && (defs.get(c.id)?.skipTurn || defs.get(c.id)?.preventMove))
      && this.dist(actor, foe) <= reach + movementPoints(foe, this.fieldTags))
      .sort((a, b) => this.dist(actor, a) - this.dist(actor, b) || a.id.localeCompare(b.id)).slice(0, 3);
    let value = 0;
    for (const foe of threats) {
      const paths = reachableGridPaths(field, foe.pos!, movementPoints(foe, this.fieldTags), cell => canOccupy(field, known, foe, cell),
        (cell, from) => movementStepCost(field, cell, foe, this.fieldTags, from), foe)
        .filter(path => path.cost > 0 && gridDistance(field, actor.pos!, path.cells.at(-1)!) <= reach)
        .sort((a, b) => a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!);
      for (const path of paths) {
        const target = { ...foe, pos: path.cells.at(-1)!, tacticalPose: undefined, entrenchedAt: undefined, movedDuringActivation: true };
        if (!controlReactionAllowed(actor, target, known, this.dist(actor, target))) continue;
        const context = this.weaponContext(actor, target, {}, known, sight);
        if (context.reason || context.landing) continue;
        const denial = denialReady(actor, defs) && this.dist(actor, foe) > 2 && this.dist(actor, target) <= 2 && sameLayer(actor, target);
        const mods = this.attackModifiers(actor, target, context);
        const options = { attacker: actor, defender: target, rules: this.rules, conditionDefs: defs, traitRegistry: this.traitRegistry,
          weaponOverride: context.weapon, ranged: context.ranged, actionDamageScale: this.usingHaste(actor.id) ? hasteAttackScale(actor) : 1, ...mods };
        const watched = this.previewAttackWithEnvironment({ ...options, extraMods: [...mods.extraMods, ...(denial ? denialModifiers(target, false, true) : [])] }).expectedDamage;
        // Entering a pike's reach already permits automatic denial; credit only the extra benefit.
        const automatic = denial ? this.previewAttackWithEnvironment({ ...options, actionDamageScale: 1, extraMods: [...mods.extraMods, ...denialModifiers(target, false, false)] }).expectedDamage : 0;
        this.aiTrace?.({ stage: 'overwatch-preview', unitId: actor.id, targetId: target.id, cell: target.pos, watched, automatic });
        value = Math.max(value, Math.min(memberHealth(target), watched) - Math.min(memberHealth(target), automatic));
        break;
      }
    }
    return value * .5;
  }

  private commandV2Scores<P extends { score: number; path: GridPath; kind: string; offensive?: boolean; targetId?: string; landing?: number; preview?: { expectedDamage: number; variance?: number }; control?: CommandControl }>(
    unit: Combatant, candidates: P[], choice: (plan: P) => CommandChoice, profile: CommanderProfile, quality: ReturnType<typeof commandQuality>, turnKey: string,
    foes: Combatant[], known: Combatant[], sight: HypotheticalSight, incomingAt: (cell: number) => number, trace?: (event: object) => void): number[] {
    const field = this.battlefield!, own = combatSide(unit, this.combatants);
    // 本轮尚未行动的己方单位，按先攻顺序。
    const pending = this.turnOrder.slice(this.turnIndex + 1).flatMap(id => {
      const ally = known.find(u => u.id === id);
      return ally && ally.status === 'ready' && ally.pos !== undefined && combatSide(ally, this.combatants) === own && !ally.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn) ? [ally] : [];
    });
    const budget = 3 * (foes.length + 1); let previews = 0;
    const routes = new Map<string, GridPath[]>(), none = { value: 0, damage: 0, condition: 0 };
    // §2.2 f(友军, 目标)：原地能打就用原地，否则本次激活可达、能合法攻击、路径代价最小的一格（同代价取格号小的），在那里预览一次。
    const followUp = (ally: Combatant, target: Combatant) => {
      let options = routes.get(ally.id);
      if (!options) {
        const movement = ally.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.preventMove) ? 0 : this.movementBudget(ally.id);
        options = [...this.gridPaths(ally, movement).paths].sort((a, b) => a.cost - b.cost || a.cells.at(-1)! - b.cells.at(-1)!);
        routes.set(ally.id, options);
      }
      const reach = Math.max(gridWeaponRange(ally.weapon, true, this.rules.armsModel), gridWeaponRange(ally.sidearm, true, this.rules.armsModel));
      for (const route of options) {
        const cell = route.cells.at(-1)!;
        if (gridDistance(field, cell, target.pos!) > reach) continue;
        const at = route.cost ? { ...ally, pos: cell, movedDuringActivation: true } : ally;
        for (const weaponMode of (ally.sidearm ? ['primary', 'sidearm'] : ['primary']) as ('primary' | 'sidearm')[]) {
          const context = this.weaponContext(at, target, { weaponMode }, known, sight);
          if (context.reason) continue;
          // 预算用完时不再预览，相关候选不加分。
          if (previews >= budget) return undefined;
          previews++;
          const preview = this.previewAttackWithEnvironment({ attacker: at, defender: target, rules: this.rules, conditionDefs: this.conditionDefMap(), traitRegistry: this.traitRegistry, weaponOverride: context.weapon, ranged: context.ranged, ...this.attackModifiers(at, target, context) });
          return { value: Math.min(memberHealth(target), preview.expectedDamage) + (preview.conditionValue ?? 0), damage: preview.expectedDamage, condition: preview.conditionValue ?? 0 };
        }
      }
      return none;
    };
    const follows = new Map<string, ReturnType<typeof followUp>>();
    const followNow = (ally: Combatant, target: Combatant) => { const key = ally.id + '>' + target.id; if (!follows.has(key)) follows.set(key, followUp(ally, target)); return follows.get(key); };
    // §2.2 下一个对目标 f>0 的友军；加分 = 配合预判系数 × P × Δ。生效后的目标只取决于状态和推拉落点，同样的控制只预览一次。
    if (quality.cooperation) for (const plan of candidates) {
      const target = plan.control ? foes.find(f => f.id === plan.targetId) : undefined;
      const ally = target && pending.find(a => (followNow(a, target)?.value ?? 0) > 0);
      if (!ally) continue;
      const key = ally.id + '>' + target.id + ':' + JSON.stringify([plan.control!.conditions.map(c => [c.id, c.dur, c.potency, c.magnitude]), plan.control!.cell]);
      if (!follows.has(key)) {
        const after = { ...target, conditions: target.conditions.map(c => ({ ...c })), ...(plan.control!.cell === undefined ? {} : { pos: plan.control!.cell }) };
        for (const condition of plan.control!.conditions) applySkillCondition(after, condition);
        follows.set(key, followUp(ally, after));
      }
      const after = follows.get(key);
      if (after) plan.score += quality.cooperation * plan.control!.p * (after.value - followNow(ally, target)!.value);
    }
    const style = COMMAND_STYLES[profile.style], exposure = style.exposure === 'mid' || style.exposure === 'low', incoming = new Map<number, number>();
    const features = styleActive(profile.style) ? smallCommandFeatures({ field, unit, friends: known.filter(u => u.status === 'ready' && u.pos !== undefined && combatSide(u, this.combatants) === own),
      foes, side: own, rounds: this.commandRounds, movement: this.movementBudget(unit.id), range: Math.max(gridWeaponRange(unit.weapon, true, this.rules.armsModel), gridWeaponRange(unit.sidearm, true, this.rules.armsModel)),
      reach: foe => gridWeaponRange(meleeWeapon(foe), true, this.rules.armsModel), health: memberHealth(unit),
      incomingAt: cell => { if (!exposure) return 0; if (!incoming.has(cell)) incoming.set(cell, incomingAt(cell)); return incoming.get(cell)!; } }) : undefined;
    const scores = commandScores(candidates.map(plan => {
      const option = choice(plan), target = plan.targetId ? foes.find(f => f.id === plan.targetId) : undefined;
      return { ...option, ...(features ? { features: features({ cells: plan.landing === undefined ? plan.path.cells : [...plan.path.cells, plan.landing], landing: plan.landing ?? plan.path.cells.at(-1)!,
        attack: option.attack, ranged: option.ranged, breach: !!option.breach, stay: plan.kind === 'hold' || plan.kind === 'brace' || plan.kind === 'overwatch', target, killChance: target && plan.preview ? killProbability([plan.preview], memberHealth(target)) : 0 }) } : {}) };
    }), profile, turnKey, trace);
    // §2.3 大师：与最高分相差不超过比较阈值的候选（最多3个），加上下一个友军的最佳后续攻击 V(c)。
    if (quality.compare && pending.length) {
      const scale = commandScale(candidates.map(plan => plan.score)), order = candidates.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
      const top = order.filter(i => scores[i]! >= scores[order[0]!]! - COMMAND_KNOBS.masterCompare * scale).slice(0, 3);
      const ally = pending[0]!, follow = new Map(foes.map(target => [target.id, followNow(ally, target)]));
      if (top.length > 1 && [...follow.values()].every(Boolean)) {
        const best = (except?: string) => Math.max(0, ...foes.filter(target => target.id !== except).map(target => follow.get(target.id)!.value));
        for (const i of top) {
          const plan = candidates[i]!, target = plan.offensive && plan.preview ? foes.find(f => f.id === plan.targetId) : undefined;
          if (!target) { scores[i] = scores[i]! + best(); continue; }
          const kill = killProbability([plan.preview!], memberHealth(target)), next = follow.get(target.id)!;
          scores[i] = scores[i]! + Math.max(best(target.id), (1 - kill) * (Math.min(Math.max(0, memberHealth(target) - plan.preview!.expectedDamage), next.damage) + next.condition));
        }
      }
    }
    this.aiTrace?.({ stage: 'command-previews', mode: 'small', unitId: unit.id, round: this.round, ability: profile.ability, previews, budget });
    return scores;
  }

  /** 看不见敌军时的去向，只用本阵营已知事实：最后目击 → 未定位来袭的方向 → 朝敌方来向扫视近两轮没看过的地格；
   *  白天开阔地全图在望仍无敌踪时，才回到两格近距搜查潜伏者。 */
  private huntPlan(unit: Combatant, known: Combatant[]): { goals: number[]; focus: number; lead: boolean } {
    const field = this.battlefield!, side = unit.side;
    // 每次盲区决策照旧刷新两格搜查记录（地图上的已搜索标记）；它的目标只在最后一档使用。
    const close = this.searchDestination(unit, known), view = this.visibleCells(side);
    const memory = this.intel[side] ??= { traces: [], clues: [] };
    const viewed = memory.viewed?.length === view.length ? memory.viewed : memory.viewed = Array<number>(view.length).fill(0);
    view.forEach((seen, cell) => { if (seen) viewed[cell] = this.round; });
    const reach = gridCostsToGoals(field, [unit.pos!], (cell) => canOccupy(field, known, unit, cell), (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from), unit);
    const cost = (cell: number) => reach.get(cell) ?? 1000 + gridDistance(field, unit.pos!, cell);
    const unseen = (cell: number) => !view[cell] && !groundBlocked(field, cell);
    const fresh = (cell: number) => unseen(cell) && viewed[cell]! <= Math.max(0, this.round - 2);
    const nearest = (cells: number[], score = cost) => cells.reduce((best, cell) => score(cell) < score(best) || score(cell) === score(best) && cell < best ? cell : best);
    const leads: { focus: number; age: number }[] = [];
    for (const trace of liveTraces(this.intel, side, this.round, new Set(known.map((u) => u.id)))) {
      if (trace.cell === undefined) continue;
      const age = this.round - trace.round, origin = trace.cell;
      // 最后目击点一旦亲眼查过没人就记下，之后不再因它暂时出了视野而折回。
      if (view[origin]) trace.checked = true;
      if (!trace.checked) { leads.push({ focus: origin, age }); continue; }
      if (age > SPREAD_ROUNDS) continue;
      // 查过无人：搜它这几轮走得到、近两轮又没看过的地方，离目击点越近越先查。
      const radius = (age + 1) * Math.max(1, trace.mp ?? 3);
      const cells = field.tiles.flatMap((_, cell) => fresh(cell) && gridDistance(field, origin, cell) <= radius ? [cell] : []);
      if (cells.length) leads.push({ focus: nearest(cells, (cell) => gridDistance(field, origin, cell) + cost(cell) / 2), age });
    }
    for (const clue of liveClues(this.intel, side, this.round)) {
      if (clue.cell === undefined) continue;
      const victim = makeCombatant({ id: '', name: '', side, pos: clue.cell, airborne: false });
      const cells = field.tiles.flatMap((_, cell) => unseen(cell) && cell !== clue.cell && gridDistance(field, cell, clue.cell!) <= CLUE_RANGE
        && unitLineOfSight(field, { ...victim, pos: cell, side: side === 'enemy' ? 'ally' : 'enemy' }, victim) ? [cell] : []);
      if (cells.length) leads.push({ focus: nearest(cells), age: this.round - clue.round });
    }
    // 新线索优先：每旧一轮相当于多走两格。
    const lead = leads.sort((a, b) => cost(a.focus) + a.age * 2 - cost(b.focus) - b.age * 2 || a.focus - b.focus)[0];
    if (lead) return { goals: [lead.focus], focus: lead.focus, lead: true };
    // 敌方从其撤离边一侧进场，每轮至多推进约三格：先扫它们此时可能已到达、近两轮又没看过的地格。
    const edge = [...new Set(this.combatants.filter(u => u.side !== side).flatMap(u => retreatCells(field, u.side)))];
    const edgeDistance = new Map<number, number>(), fromEdge = (cell: number) => {
      if (!edge.length) return 0;
      if (!edgeDistance.has(cell)) edgeDistance.set(cell, Math.min(...edge.map((p) => gridDistance(field, cell, p))));
      return edgeDistance.get(cell)!;
    };
    const open = [...reach.keys()].filter(fresh);
    const likely = open.filter((cell) => fromEdge(cell) <= 3 * (this.round + 1));
    const sweep = likely.length ? likely : open;
    if (!sweep.length) return { goals: [close], focus: close, lead: false };
    const focus = nearest(sweep, (cell) => cost(cell) + fromEdge(cell) / 2);
    return { goals: [focus], focus, lead: false };
  }
  // F2 推定敌人只沿用离开视野时的属性。
  private presumedFoes(side: Side, known: Combatant[]): Combatant[] {
    return liveTraces(this.intel, side, this.round, new Set(known.map((u) => u.id))).flatMap((trace) => {
      const unit = trace.cell === undefined || trace.checked || trace.routing || this.round - trace.round > 1 ? undefined : trace.seen;
      return unit ? [{ ...unit, pos: trace.cell, status: 'ready' as const, airborne: trace.layer === 'air', elevation: trace.layer === 'top' ? 1 : undefined }] : [];
    });
  }
  /** 面板用：本阵营记得、此刻看不见的敌军最后位置，以及近几轮的未定位来袭。 */
  enemyIntel(side: Side, known: readonly Combatant[] = this.visibleCombatants(side)): IntelView {
    if (!this.battlefield || this.isOver()) return { traces: [], clues: [] };
    return intelView(this.intel, side, this.round, new Set(known.map((u) => u.id)), (id) => this.combatants.find((u) => u.id === id)?.name);
  }
  private searchDestination(unit: Combatant, known: Combatant[]): number {
    const field = this.battlefield!;
    const coverage = this.searchCoverage[unit.side] ??= Array(field.tiles.length).fill(0);
    const observers = known.filter(other => !combatHostile(other, unit, this.combatants) && other.status === 'ready');
    for (let cell = 0; cell < field.tiles.length; cell++) {
      // 两格内才足以排查潜伏者；远处看得见地形不等于排除了伏兵。
      if (observers.some(observer => gridDistance(field, observer.pos!, cell) <= 2
        && unitLineOfSight(field, observer, { ...observer, pos: cell, airborne: false }))) coverage[cell] = this.round;
    }
    const reachable = gridCostsToGoals(field, [unit.pos!], cell => canOccupy(field, known, unit, cell), (cell, from) => movementStepCost(field, cell, unit, this.fieldTags, from), unit);
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
      if ((!quickItemAction(u, a) && (this.actedThisTurn.has(u.id) || this.hasteSelected.has(u.id))) || !this.abilityUsable(u, a)) continue;
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
          (c) => !combatHostile(c, u, this.combatants) && (c.status === 'ready' || c.status === 'dying'),
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
        const readyAllies = this.combatants.filter((c) => !combatHostile(c, u, this.combatants) && c.status === 'ready').length;
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
    const goals = retreatCells(field, unit.side);
    const remaining = gridCostsToGoals(field, goals, allowed, cost, unit);
    const distance = (cell: number) => remaining.get(cell) ?? deploymentDepth(field, unit.side, cell) * 2;
    const path = reachableGridPaths(field, start, this.movementBudget(unit.id), allowed, cost, unit)
      .filter(p => distance(p.cells.at(-1)!) < distance(start))
      .sort((a, b) => distance(a.cells.at(-1)!) - distance(b.cells.at(-1)!) || a.cost - b.cost)[0];
    if (!path) return;
    unit.pos = path.cells.at(-1)!; if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '')) unit.movedDuringActivation = true; this.movedThisTurn.add(unit.id);
    this.recordEvent({ round: this.round, kind: 'morale', participants: [unit.id], text: `${unit.name} 溃退：${cellLabel(field, start)}→${cellLabel(field, unit.pos)}` });
  }

  /** 回合开始效果：清移动标记、装填递减、持续伤害与死亡判定 */
  private beginTurn(u: Combatant): void {
    const previous = this.activationStarts.get(u.id);
    if (u.pos !== undefined) this.activationStarts.set(u.id, { at: u.pos, ...(previous ? { before: previous.at } : {}) });
    delete u.tacticalPose;
    delete u.tacticalEffort;
    this.movementSpent.delete(u.id); this.reactionSpent.delete(u.id); this.overwatch.delete(u.id); this.hasteOverwatch.delete(u.id);
    delete u.chargeInterrupted; delete u.chargeDistance;
    beginArmsActivation(u);
    this.movedThisTurn.delete(u.id); delete u.movedDuringActivation; delete u.looseChoiceLocked;
    this.actedThisTurn.delete(u.id); this.hasteSelected.delete(u.id); this.hasteMovement.delete(u.id);
    for (const key of new Set([u.id, weaponReloadKey(u, u.sidearm)])) {
      const rl = this.reloadCd.get(key) ?? 0;
      if (rl > 0) {
        if (rl <= 1) this.reloadCd.delete(key);
        else this.reloadCd.set(key, rl - 1);
      }
    }
    let dotSource: Combatant | undefined;
    for (const c of conditionDamageSources(u)) {
      if (this.rules.resolutionVersion === 'v2' && c.id === 'poisoned' && !poisonFactor(u)) { u.conditions = u.conditions.filter((condition) => condition !== c); continue; }
      const def = this.conditions.get(c.id);
      if (def?.dot) {
        const r = rollDice(def.dot.dice, this.rng);
        let damage = this.rules.combatModel ? roundDamage(conditionDamage(u,r.total,c),this.rng) : this.rules.resolutionVersion === 'v2' && c.id === 'poisoned' ? poisonDamage(u, r.total * (c.magnitude ?? 1)) : Math.max(0, Math.round(r.total * (c.magnitude ?? 1)));
        const members=u.hp,lost=hasMemberHealth(u)?applyCombatDamage(u,damage,c.affectedMembers??10):applyHealthLoss(u, damage, this.rules.resolutionVersion === 'v2'); if(this.rules.combatModel)damage=lost;
        breakCharmOnDamage(this.combatants, u, this.combatants.find(source=>source.id===c.sourceId), lost);
        this.recordEvent({
          round: this.round,
          kind: 'condition',
          damage: {sourceId:c.sourceId,targetId:u.id,amount:lost,cause:def.dot.label ?? def.name,...(hasMemberHealth(u)?{unit:'life' as const,members:members-u.hp}:{})},
          participants: [u.id], text: `${u.name} ${def.dot.label ?? def.name} -${displayNumber(damage)} → ${hasMemberHealth(u)?'总生命':'HP'} ${displayNumber(memberHealth(u))}`,
        });
        this.checkDeath(u, this.combatants.find(source=>source.id===c.sourceId));
        if (u.hp <= 0) { dotSource = this.combatants.find((source) => source.id === c.sourceId); break; }
      }
    }
    if (u.hp <= 0) this.checkDeath(u, dotSource);
    this.resolveFlightStates();
    this.settleMorale(u);
    reconcileBattleControls(this.combatants);
    beginControlActivation(u, this.rng, () => u.status !== 'ready' || u.conditions.some(c => c.dur > 0 && this.conditions.get(c.id)?.skipTurn) ? [] : this.combatants.filter(t => t.id !== u.id && canSpot(this.observationContext(), u, t) && this.confusedWeaponPlan(u, t)).map(t => t.id));
  }

  /** 回合结束效果：状态时长递减/过期、冷却递减、再生 */
  private settleUnit(u: Combatant): void {
    const movement = movementPoints(u, this.fieldTags);
    const remainder = u.numericModel ? movement > 0 ? movementFraction(movement + (u.movementRemainder ?? 0)) : 0 : undefined;
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
    if (remainder !== undefined) u.movementRemainder = remainder;
    // V13 工事：离开阵地（或开战时没能构筑）后原地完整休整一轮，在所在位置构筑。
    const firstWorks = u.entrenchedAt === undefined;
    if (fullRest && !entrenched(u) && entrench(u, 'small')) this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 原地休整，${firstWorks ? '' : '重新'}构筑工事` });
    if (u.suppression) u.suppression = Math.max(0, u.suppression - 1);
    const beforeConditions = new Set(u.conditions.filter(c => c.dur > 0).map(c => c.id));
    for (const c of [...u.conditions]) {
      if (c.effectSourceId) continue;
      if (ACTIVATION_CONTROLS.has(c.id)) continue;
      if (c.skipNextDecay) { delete c.skipNextDecay; continue; }
      c.dur -= 1;
      if (c.dur <= 0) {
        u.conditions = u.conditions.filter((x) => x !== c);
      }
    }
    finishControlActivation(u);
    const expired = [...beforeConditions].filter(id => !u.conditions.some(c => c.id === id && c.dur > 0)).map(id => this.conditions.get(id)?.name ?? id);
    if (expired.length) {
      this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 状态结束：${expired.join('、')}` });
    }
    for (const s of u.abilityState) if (s.cdLeft > 0) s.cdLeft -= 1;
    const regen = this.rules.resolutionVersion === 'v2' ? regeneration : this.regenOf(u);
    if (['traits-levels-v2', 'traits-items-v1', 'traits-items-v2'].includes(this.rules.traitLevelModel ?? '') || regen > 0 && u.hp > 0 && recoveryCapacity(u)>0) {
      const restored = settleRegeneration(u, regen);
      if (restored > 0) this.recordEvent({ round: this.round, kind: 'condition', participants: [u.id], text: `${u.name} 再生 +${displayNumber(restored)} → ${u.scale === 'hero' ? '生命' : '人数'} ${displayNumber(u.hp)}${u.scale !== 'hero' && u.rulesVersion === 'v2' ? `，剩余可救伤兵${u.recoverableWounded ?? 0}` : ''}` });
    }
  }

  /** 死亡与经验入账 */
  private settleAreaEffects(boundary=false): void {
    this.resolveGroundStates();
    const expired: BattleZone[] = [];
    for (const result of settleZones(this.observationContext(),this.round,boundary,this.rng, zone => expired.push(zone))) {
      breakCharmOnDamage(this.combatants, result.target, result.source, result.damage);
      if(result.control&&result.source)this.flightCauses.set(result.target.id,result.source.id);
      this.recordEvent({round:this.round,kind:'condition',participants:[result.target.id,...(result.source?[result.source.id]:[])],text:result.text});
      this.checkDeath(result.target,result.source); this.checkInjury(result.target,result.damage);
    }
    for (const zone of expired) this.recordEvent({ round: this.round, kind: 'condition', participants: [zone.ownerId], text: zoneEndText(zone, this.battlefield) });
  }
  private checkDeath(unit: Combatant, killer?: Combatant): void {
    if(this.rules.resolutionVersion==='v2') {
      const earned=casualtyXp(unit,this.xpMinimum,true);
      if(unit.side==='enemy'||unit.side==='neutral'&&killer?.side==='ally')this.xpGained+=earned;
      const owner=killer?.summonerId??killer?.id;
      if(owner&&earned&&killer?.side!==unit.side) {
        this.xpByUnit.set(owner,(this.xpByUnit.get(owner)??0)+earned);
      }
    }
    const revival = tryRevive(unit);
    if (revival) {
      this.recordEvent({ round: this.round, kind: 'condition', participants: [unit.id], text: revival });
      return;
    }
    if (unit.hp > 0 || unit.status === 'dead' || this.nonLethal && unit.status === 'dying') return;
    if(this.rules.resolutionVersion==='v2')this.defeatedIds.add(unit.id);
    // 与会战一致：生命归零即阵亡，不依赖战斗结束后不可能发生的再次补刀。
    unit.status = this.nonLethal ? 'dying' : 'dead';
    settleWoundedOnDeath(unit);
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
        participants: [target.id], text: `${target.name} 被重创，陷入【重伤】`,
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

  finishDiplomacy(winner: Side | 'draw', text: string): void {
    this.objectiveWinner = winner; this.finalizeCasualties();
    this.recordEvent({ round: this.round, kind: 'battle-end', text });
  }

  /**
   * 战中切换致命/非致命：只改之后的倒地与减员。已阵亡、已撤离的不变，已记的可救伤兵不变；
   * 改回致命时已经濒死的单位保持濒死，此后再受伤害才会阵亡。
   */
  setNonLethal(on: boolean): void {
    if (!this.started || this.isOver()) throw new Error('只能在进行中的战斗里修改致命规则');
    if (on === this.nonLethalRule) return;
    if (!on) for (const unit of this.combatants) if (unit.status === 'dying') this.sparedIds.add(unit.id);
    this.nonLethalRule = on;
    for (const unit of this.combatants) unit.nonLethal = on;
    this.recordEvent({ round: this.round, kind: 'rule', rule: { nonLethal: on },
      text: on ? '改为非致命：此后双方生命归零只会濒死失能，编队减员算可救伤兵' : '改为致命：此后生命归零按阵亡结算，已经濒死的单位保持濒死' });
  }

  /** 兼容旧战场中尚未结清的零生命濒死状态；不重复发放击败经验。非致命阶段倒下的单位不补记。 */
  finalizeCasualties(): void {
    if (this.nonLethal || !this.isOver()) return;
    for (const unit of this.combatants) if (unit.hp <= 0 && unit.status === 'dying' && !this.sparedIds.has(unit.id)) {
      unit.status = 'dead';
      settleWoundedOnDeath(unit);
      this.recordEvent({round:this.round,kind:'death',participants:[unit.id],text:`${unit.name} 阵亡（生命归零）`});
    }
  }

  isOver(): boolean {
    if (this.objectiveWinner) return true;
    const goal = this.battlefield?.objective;
    if (!goal || goal.kind === 'annihilation' || goal.kind === 'control' && !goal.attackingSide) return this.remainingSides().length <= 1;
    for (const side of ['ally', 'enemy'] as const) {
      if (!this.combatants.some((c) => c.side === side && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing'))) return true;
    }
    return false;
  }

  /** 胜方（未结束时为 undefined） */
  winner(): Side | 'draw' | undefined {
    if (this.objectiveWinner) return this.objectiveWinner;
    if (!this.isOver()) return undefined;
    const goal = this.battlefield?.objective;
    if (!goal || goal.kind === 'annihilation' || goal.kind === 'control' && !goal.attackingSide) return this.remainingSides()[0] ?? 'draw';
    const allyReady = this.combatants.some((c) => c.side === 'ally' && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing'));
    const enemyReady = this.combatants.some((c) => c.side === 'enemy' && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing'));
    if (allyReady && enemyReady) return 'draw';
    if (allyReady) return 'ally';
    if (enemyReady) return 'enemy';
    return 'draw';
  }

  private remainingSides(): Side[] {
    return (['ally', 'enemy', 'neutral'] as const).filter(side => this.combatants.some(c => c.side === side
      && (c.status === 'ready' || this.rules.resolutionVersion === 'v2' && c.status === 'routing')));
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
      v: 1, aiRevision: 1, allyTactic: this.allyTactic, commanderProfiles: this.commanderProfiles, nonLethal: this.nonLethal,
      ...(this.allyAiControl.size ? { allyAiControl: [...this.allyAiControl] } : {}),
      ...(this.sparedIds.size ? { sparedIds: [...this.sparedIds] } : {}),
      battlefield: this.battlefield,
      ...(this.diplomacy.offers.length || this.diplomacy.letters?.length ? { diplomacy: this.diplomacy } : {}),
      searchCoverage: this.searchCoverage,
      intel: this.intel,
      ...(this.activationStarts.size ? { activationStarts: [...this.activationStarts] } : {}),
      ...(isCommandV2(this.rules) ? { commandRounds: this.commandRounds } : {}),
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
    // 旧版塌墙只处理仍在行动的单位，遗留的伤亡/撤离平台标记会阻止整场战斗恢复。
    const combatants = (snap.combatants as Combatant[]).map(unit => {
      const structure = unit.pos === undefined ? undefined : snap.battlefield?.structures?.[unit.pos];
      return unit.elevation === 1 && !unit.airborne && snap.battlefield?.layerVersion === 1
        && structure?.top === true && structure.hp === 0 && (unit.hp <= 0 || !['ready', 'routing'].includes(unit.status))
        ? { ...unit, elevation: undefined } : unit;
    });
    const b = new SmallBattle({
      nonLethal: snap.nonLethal === true,
      battlefield: snap.battlefield,
      combatants,
      rules: rulesById(snap.rulesId),
      seed: snap.seed ?? randomSeed(),
      rng,
      traitRegistry: opts.traitRegistry,
      summonUnit: opts.summonUnit,
      field: { tags: snap.fieldTags ?? snap.battlefield?.environment ?? [] },
    });
    b.allyTactic = normalizeTactic(snap.allyTactic);
    b.allyAiControl = new Map(Array.isArray(snap.allyAiControl)
      ? snap.allyAiControl.filter((e: unknown): e is [string, boolean] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'boolean') : []);
    b.sparedIds = new Set(Array.isArray(snap.sparedIds) ? snap.sparedIds.filter((id: unknown): id is string => typeof id === 'string') : []);
    b.commanderProfiles = normalizeCommanderProfiles(snap.commanderProfiles);
    b.diplomacy = restoreDiplomacy(snap.diplomacy);
    b.round = snap.round ?? 1;
    b.searchCoverage = structuredClone(snap.searchCoverage ?? {});
    b.intel = restoreIntel(snap.intel, b.battlefield?.tiles.length);
    const cell = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < (b.battlefield?.tiles.length ?? 0);
    b.activationStarts = new Map((Array.isArray(snap.activationStarts) ? snap.activationStarts : []).filter((entry: unknown): entry is [string, { at: number; before?: number }] => Array.isArray(entry)
      && typeof entry[0] === 'string' && !!entry[1] && cell(entry[1].at) && (entry[1].before === undefined || cell(entry[1].before))).map(([id, start]: [string, { at: number; before?: number }]) => [id, { at: start.at, ...(start.before !== undefined ? { before: start.before } : {}) }]));
    if (isCommandV2(b.rules)) b.commandRounds = readCommandRounds(snap.commandRounds);
    b.movementSpent = new Map(snap.movementSpent ?? []); b.reactionSpent = new Set(snap.reactionSpent ?? []);
    b.overwatch = new Set(snap.overwatch ?? []); b.controlRounds = { ally: 0, enemy: 0, neutral: 0, ...snap.controlRounds };
    b.objectiveWinner = snap.objectiveWinner; b.controlHold = snap.controlHold ? { ...snap.controlHold } : undefined;
    b.controlReport = (snap.log as BattleLogEntry[] | undefined)?.filter(e => e.objective).at(-1)?.objective
      ?? (b.battlefield?.objective.kind === 'control' && b.controlHold ? { cell: b.battlefield.objective.cell, side: b.controlHold.side, contested: false, progress: b.controlRounds[b.controlHold.side], required: b.battlefield.objective.rounds } : undefined);
    b.defeatedIds = new Set(snap.defeatedIds ?? []);
    b.turnOrder = snap.turnOrder ?? b.turnOrder;
    b.turnIndex = snap.turnIndex ?? 0;
    b.log = [...(snap.log ?? [])];
    if (snap.aiRevision === undefined) b.log.push({ round: b.round, kind: 'rule', text: 'AI 已更新（修订 1）：工事中失联会继续搜索，推定敌人只用看见时的情报，会战攻击会避开已被确定击倒的目标' });
    for (const unit of b.combatants) {
      const before = lifeBefore.get(unit.id), maximum = unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp;
      if (before?.maximum !== undefined && before.maximum !== maximum) b.recordEvent({ round: b.round, kind: 'condition', participants: [unit.id],
        text: `${unit.name} 单体生命上限调整：${displayNumber(before.maximum)}→${displayNumber(maximum)}${unit.scale === 'hero' ? `，当前生命${displayNumber(before.hp)}→${displayNumber(unit.hp)}` : '，编制不变'}；规则归一化，不计战斗伤害` });
      if (before?.pressure !== undefined && before.pressure !== unit.moraleState?.damagePenalty) b.recordEvent({ round: b.round, kind: 'condition', participants: [unit.id],
        text: `${unit.name} 受创士气压力按实际最大生命校准：${displayNumber(before.pressure)}→${displayNumber(unit.moraleState?.damagePenalty)}` });
    }
    b.xpMinimum = new Map([...initialXpStrength(b.combatants, true), ...(snap.xpMinimum ?? [])]);
    b.xpInitialStrength = new Map(snap.xpInitialStrength ?? []);
    if(!snap.xpMinimum)for(const id of b.defeatedIds)b.xpMinimum.set(id,0);
    b.xpGained = snap.xpGained ?? 0;
    b.xpByUnit = new Map(snap.xpByUnit ?? []);
    b.movedThisTurn = new Set(snap.movedThisTurn ?? []);
    b.actedThisTurn = new Set(snap.actedThisTurn ?? []);
    b.hasteOverwatch = new Map(snap.hasteOverwatch ?? []);
    b.hasteSpent = new Map(snap.hasteSpent ?? []); b.hasteMovement = new Map(snap.hasteMovement ?? []); b.hasteSelected = new Set(snap.hasteSelected ?? []);
    if ([...b.hasteSpent].some(([id, round]) => !b.combatants.some(u => u.id === id) || !Number.isInteger(round) || round < 1 || round > b.round) || [...b.hasteMovement].some(([id, amount]) => !b.combatants.some(u => u.id === id) || !Number.isFinite(amount) || !progression(b.rules) && !Number.isInteger(amount) || amount < 0 || amount > (progression(b.rules) ? 5 + GEAR_G[9] : 5))) throw Error('加速动作记录损坏');
    if ([...b.hasteSelected].some(id => !b.combatants.some(u => u.id === id)) || [...b.hasteOverwatch].some(([id, scale]) => !b.combatants.some(u => u.id === id) || !Number.isFinite(scale) || scale < 0 || scale > 1)) throw Error('加速动作记录损坏');
    b.reloadCd = new Map(snap.reloadCd ?? []);
    (b as unknown as { started: boolean }).started = !!snap.started;
    if (b.started) for (const unit of b.combatants) { const text = grantEntryWornBarrier(unit, b.rules); if(text)b.recordEvent({round:b.round,kind:'condition',participants:[unit.id],text}); }
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

function knownStructureObserver(battle: SmallBattle, actor: Combatant, cell: number): boolean { return battle.visibleCombatants(actor.side).some(u => !combatHostile(u, actor, battle.combatants) && u.status === 'ready' && canSpot(battle.observationContext(), u, { ...u, side: actor.side === 'enemy' ? 'ally' : 'enemy', traits: [], traitSources: [], pos: cell, elevation: undefined, airborne: false })); }
