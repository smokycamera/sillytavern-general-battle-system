import { LlmContextController, llmContextSummary, type LlmEncounterContext } from './llm-context.js';
import { readLlmSettings, saveLlmSettings, llmConnectionKey } from './llm-settings.js';
import { renderLlmSettings } from './llm-settings-view.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';
import { enhancementLabel, trainingEdge, trainingDamage } from '../../engine/src/enhancements.js';
import { renderReportWorkspace } from './report-view.js';
import { captureBattleArchive, captureBattleStart, reportRestartReason, type BattleStart, type DeletedReport } from './report-history.js';
import { prepareCombatModel, strengthDescription, memberDurability } from '../../engine/src/combat-model.js';
import {hasMemberHealth,memberHealth,memberHealthMax} from '../../engine/src/member-health.js';
import {anchoredWeapon,anchoredWeaponLabel,anchoredProtection,armorPowerScale} from '../../engine/src/power-anchors.js';
import {memberHealthPanel,cannonAmmoControl} from './combat-model-view.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import './battle-ui.css';
import { updateRegion, BattleCamera } from './view-dom.js';
import { executeMassPlan, executeAndSaveAsync as executeAndSave } from './battle-execution.js';
import { TACTICAL_PREFERENCES, normalizeTactic } from '../../engine/src/tactical-preference.js';
import { battleIdOf, publicBattleEvents, battleEpilogue, narrativeEvents, makeNarrativeBatch, beginNarrativeDelivery, finishNarrativeDelivery, completedBattleRounds, type BattleReport, type BattleDeliveries, type NarrativeBatch } from './battle-reports.js';
import { lastBattleAction, traceLocations } from './battle-presentation.js';
import { promptScopeControls } from './prompt-settings.js';
import { narrativeProjectionDetails } from './narrative-controller.js';
import { calibrateAutocannon, calibrateWeaponHands } from '../../engine/src/gen/equipment.js';
import { gridWeaponRange } from '../../engine/src/small/weapon-range.js';
import { formationWeaponRange } from '../../engine/src/melee.js';
import { movementLabel } from '../../engine/src/tactics.js';
const resourceLabel = (key: string) => key === 'SP' ? '精力' : key === 'reserve' ? '预备兵力' : key.startsWith('item:') ? '消耗品' : key;
import { spCapacity } from '../../engine/src/resources.js';
import { PROMPT_SECTIONS, applySettlementPrompt, promptSelected, selectPromptEntries, renderPromptSettings, type PromptSectionId } from './prompt-settings.js';
import { narrativeDeploymentIds } from './narrative-state.js';
import { AutoBattleLoop } from './auto-battle.js';
import { newUnitDraft, unitDraftFromRecord, buildUnit, editUnitBuild, type UnitDraft } from './unit-builder.js';
import { MAX_SCENE_UNITS } from './narrative-limits.js';
import { recommendBattleMode, extendSmallRoundLimit, upgradeDefaultObjective, normalizeObjectiveMode, prepareBattleObjective, battleCapacityIssue, prepareMassRoster, type BattleObjectiveMode } from './battle-setup.js';
import { unitForm, captureUnitDraft, buildPreview } from './unit-form.js';
import { BODY, effectiveProtection, looseFormation, ABILITY_BLUEPRINTS } from '../../engine/src/index.js';
/**
 * 战阵 · 面板主程序
 * 编排：编制管理（造怪器）→ 小规模战斗 / 军团会战 → 结算卡与状态输出；
 * 结算卡/回合纪要/状态摘要以 user 楼层发给 AI；轻量扩展提示词同步连续编制、
 * 战利品与战前后态势。战场环境由 AI <field> 标签声明，英雄与连队统一经验成长，
 * 武器/护甲/技能统一「名字:种类L等级」解析。
 */

import {
  generateUnit, traitCatalog, traitRegistry, resolveTraitId,
  SmallBattle, MassBattle, battleXpAwardsForBothSides, applyXp, xpProgress, xpLabel,
  armorDR, fieldModsFor, LITE_D20,
  V4_D20, V4_OVERFLOW_D20, V4_OVERFLOW_TW, isAirborne, abilityUsabilityReason,
  generatedField, randomSeed, hasFlightAbility, woundedLabel, regenerationAmount, moraleLabel,
  FORMATION_NODES, formationNode, concealmentLabel,
  type Combatant, type GenerateInput, type Order, type BattleLogEntry, type Side,
  type Category, type Ability, categoryLabel, CATEGORY_LABELS,
  smallStateSummary, massStateSummary, settlementCard, unitCardLine,
  battleIntroSummary, battleAftermathSummary, roundDigest, isRangedCapable,
  STANDARD_CONDITIONS, standardConditionMap,
  activeTraitIds, equipmentTraitIds, traitDescription, traitSourceActive, traitStatAdjustments,
  scaleLabel, postureLabel, fatigueAfter, environmentTags,
  WEAPON_LIBRARY, ARMOR_LIBRARY, WEAPON_CLASSES, calibrateWeaponRange,
} from '../../engine/src/index.js';
import type { SaveScope, SaveReceipt, DeliveryReceipt } from './tavern.js';
import { createPanelRuntime } from './panel-runtime.js';
import { type LootType, type Suggestion } from './tags.js';
import type { NarrativeProposal, NarrativeSave } from './narrative-state.js';
import { prepareInventoryState, type InventoryItem } from './inventory-state.js';
import { prepareBattleItems } from './battle-items.js';
import { InventoryPanel } from './inventory-view.js';
import { itemSpecificationLabel } from './item-spec.js';
import { WORKSPACES, workspaceNavigation, workspacePage, showWorkspace, type WorkspaceTab } from './workspace-view.js';
import { renderFormationBattle } from './formation-view.js';
import { formationSelection, selectFormationUnit, setFormationChoice, orderDraft, type FormationView, type OrderDrafts } from './formation-orders.js';
import { renderTacticalBattle, selectTacticalElement, type TacticalView, type TacticalQuery } from './tactical-view.js';
import {
  PANEL_SAVE_SCHEMA_VERSION,
  battleOutcomeId,
  commitBattleOutcome,
  materializeUnitRecord,
  migratePanelUnits,
  unitRecordFromCombatant,
  updateUnitRecord,
  deployUnitRecord,
  editUnitRecord,
  previewUnitConversion,
  undoUnitConversion,
  blueprintIdForCategory,
  type UnitRecord,
} from './unit-state.js';

// 防重复初始化：同一窗口内模块被执行两次时，事件监听会翻倍（点一次按钮录两次的元凶之一）
const gw = window as unknown as Record<string, unknown>;
if (gw.__tavernBattlePanelMain) {
  throw new Error('战阵面板已初始化，跳过重复加载');
}
gw.__tavernBattlePanelMain = true;

const runtime = createPanelRuntime();
const { adapter, controller, resident } = runtime;
document.body.dataset.native = String(!!runtime.native);
if (runtime.getTheme) document.body.dataset.theme = runtime.getTheme();
const inventoryPanel = new InventoryPanel(controller, visibleUnitRecord);
if (!resident) window.addEventListener('pagehide', () => controller.dispose());
const reg = traitRegistry();
const tacticalView: TacticalView = { mode: 'weapon' };
const formationView: FormationView = {};
const narrativeDrafts = new Map<string, string>();
const promptDrafts = new Map<string, string>();
let workspaceTab: WorkspaceTab = 'battle';
let workspaceNamespace = adapter.namespace();
let builderEditDraft: UnitDraft | undefined;
let builderSeed = crypto.randomUUID();
let builderPreview: { namespace?: string; signature: string; unit: Combatant; record?: UnitRecord; previousRevision?: number } | undefined;
let unitConversion: { namespace?: string; before: UnitRecord; after: UnitRecord } | undefined;
let reportRestartPreview: { id: string; revision: number; namespace?: string } | undefined;

// ---------- 战场环境 ----------

/** 环境标签 → 显示名（AI 用 <field env="…"/> 声明，面板解析落库，开战时固化进快照） */
const FIELD_LABELS: Record<string, string> = { plains: '野战', urban: '巷战', siege: '攻城', night: '夜战', forest: '森林', mountain: '山地' };
function plannedFieldTags(): string[] { return environmentTags([...(state.field ? [state.field] : []), ...(state.lighting === 'night' ? ['night'] : [])]); }
function fieldLabel(tags: string[]): string {
  return tags.map((t) => FIELD_LABELS[t] ?? t).join('/');
}
/** 当前生效的环境标签：进行中的战斗优先，否则用 AI 声明的环境 */
function battleFieldTags(): string[] {
  if (state.small) return state.small.fieldTags;
  if (state.mass) return state.mass.fieldTags;
  return plannedFieldTags();
}

// ---------- 应用状态 ----------

/** 兼容现有 UI 命名；持久化权威类型已移到 unit-state.ts。 */
export type RosterUnit = UnitRecord;

interface AbilityDialogState {
  battle: 'small' | 'mass';
  actorId: string;
  abilityId: string;
  suggestedTargetId?: string;
}


interface AppState {
  encounterContext?: LlmEncounterContext;
  factRevision: number;
  proposals: NarrativeProposal[];
  storySync: boolean;
  reports: BattleReport[];
  reportDeliveries: BattleDeliveries;
  selectedReportId?: string;
  activeBattleStart?: BattleStart;
  deletedReport?: DeletedReport;
  deletedReportIds?: string[];
  era: string;
  mode: 'small' | 'mass';
  mapLayout: 'standard' | 'indoor';
  objectiveMode: BattleObjectiveMode;
  siegeAttacker: 'ally' | 'enemy';
  roster: Combatant[];
  small: SmallBattle | null;
  mass: MassBattle | null;
  smallTarget: string;
  idSeq: number;
  /** 主控单位 id（视角标记 + 指挥权门禁 + 经验入账默认目标） */
  protagonistId?: string;
  /** 我方主指挥单位 id（军团；主控非指挥官时军令自动） */
  commanderId?: string;
  /** 自动行动开关：自动扮演非主控单位（未设主控时仅自动敌方） */
  autoTurn: boolean;
  /** 保存作用域：chat=每聊天一份；character=跟随角色卡 */
  saveScope: SaveScope;
  /** AI 建议待审队列（持久化） */
  pending: Suggestion[];
  /** 最近一次扫描发现的非法标签（仅展示，不入库） */
  lastInvalid: string[];
  /** 已批准/已拒绝过的标签 raw（防重复扫描重复录入；持久化，上限 400 条） */
  processedRaws: string[];
  /** 最近一次成功扫描的时间戳（毫秒）：用于判定面板关闭期间是否有漏扫的生成完毕 */
  lastScanAt: number;
  /** 批准入账的物品清单 */
  inventory: InventoryItem[];
  /** 当前战斗经验是否已入账 */
  xpSettled: boolean;
  /** 战后经验自动入账（写回编制并按曲线自动升级） */
  autoSettleXp: boolean;
  nonLethal: boolean;
  /** 军团：每回合自动为我方无令单位下达军令（命令记忆优先，启发补全） */
  autoAllyOrders: boolean;
  /** 军团命令记忆：单位 id → 上次指令（跨回合/跨战斗复用） */
  orderMemory: OrderDrafts;
  /** 战场环境标签（AI <field> 声明落库，开战时固化进战斗快照） */
  field: string;
  lighting: 'day' | 'night';
  /** 造怪器表单状态（render 重建 DOM 时回填，防止用户输入丢失） */
  form: UnitDraft;
  /** 造怪器二阶面板是否展开（默认折叠，render 重建时保持） */
  genOpen: boolean;
  /** 战场参战单位列表是否展开（可收起，避免长列表刷屏） */
  unitsOpen: boolean;
  /** 单位详情卡展开集合（key = 单位 id），战斗内/编制共用 */
  expandedUnits: Set<string>;
  /** 日志明细展开集合（key = 日志索引），展开完整数值管线 */
  expandedLog: Set<number>;
  /** 编制管理子界面是否展开 */
  manageOpen: boolean;
  /** 编制管理：正在编辑的单位 id（null=仅浏览） */
  editingUnit: string | null;
  editingDraft?: UnitRecord;
  saveReceipt?: SaveReceipt;
  /** 自动批准：扫描完成后不经待审队列直接批准落库 */
  autoApprove: boolean;
  /** AI spawn 投放的「战场遭遇」单位 id（与手动编制区分展示/清理） */
  encounterIds: Set<string>;
  /** 最近一场战斗的存活单位 id；具体数据始终从 storage 读取。 */
  lastBattleUnitIds: string[];
  /** 编制储存器：历史存活单位的可编辑档案库（与 roster 上场编制 / combatants 战斗态三分离）。
   *  存储「定义」而非运行时态：可改名称/等级/攻防速/HP/士气/侧别/原型/装备/技能/特质/备注。 */
  storage: RosterUnit[];
  /** 军团军令草稿：unit id → 未提交的指令（下拉 change 时记录，不触发渲染，避免已选被重置） */
  orderDraft: OrderDrafts;
  /** 大项折叠状态：section id → 是否收起（默认展开 ①②，其余收起） */
  collapsed: Record<string, boolean>;
  /** 回合快照（第 N 回合末状态摊开）是否展开 */
  snapOpen: boolean;
  /** 静默注入是否已启用（宿主支持 setExtensionPrompt 时 true，用于状态提示） */
  injectEnabled: boolean;
  /** 技能先预览后确认，不进入持久存档。 */
  abilityDialog: AbilityDialogState | null;
  /** 已提交 XP 的稳定 battle id；比单个布尔值可靠，可阻止恢复/重复点击造成双倍入账。 */
  committedOutcomeIds: string[];
  /** 旧存档逐条迁移的可见告警与未改写原始备份。 */
  unitMigrationWarnings: string[];
  unitMigrationBackup: unknown[];
}

const state: AppState = {
  factRevision: 0,
  proposals: [],
  storySync: false,
  reports: [],
  reportDeliveries: {},
  era: 'medieval',
  mode: 'small',
  mapLayout: 'standard', objectiveMode: 'auto', siegeAttacker: 'ally',
  roster: [],
  small: null,
  mass: null,
  smallTarget: '',
  idSeq: 1,
  autoTurn: false,
  saveScope: 'chat',
  pending: [],
  lastInvalid: [],
  processedRaws: [],
  lastScanAt: 0,
  inventory: [],
  xpSettled: false,
  autoSettleXp: true,
  nonLethal: false,
  autoAllyOrders: true,
  orderMemory: {},
  field: '',
  lighting: 'day',
  genOpen: false,
  unitsOpen: true,
  expandedUnits: new Set<string>(),
  expandedLog: new Set<number>(),
  manageOpen: false,
  editingUnit: null,
  autoApprove: true,
  encounterIds: new Set<string>(),
  lastBattleUnitIds: [],
  storage: [],
  orderDraft: {},
  collapsed: {},
  snapOpen: true,
  injectEnabled: false,
  abilityDialog: null,
  committedOutcomeIds: [],
  unitMigrationWarnings: [],
  unitMigrationBackup: [],
  form: newUnitDraft(),
};

const fullAuto = new AutoBattleLoop();
const llmContext = new LlmContextController();
let llmDiagnostic = "";
let smallResumeRequested = false;
function recentContextMessages() { return (runtime.recentNarrative?.()??[]).filter(m=>m.completed); }
function stopAutomation(): void { fullAuto.stop(); llmContext.cancel(); smallResumeRequested = false; }
window.addEventListener('pagehide', stopAutomation);
let battleSaveFailed = false;
let uiBusy = false;
async function panelTask(task: () => Promise<void>, allowPending = false, feedback?: HTMLElement): Promise<void> {
  if (uiBusy) { toast('正在保存上一项操作，请稍候…'); return; }
  if (!allowPending && runtime.canWrite && !runtime.canWrite()) { toast(runtime.writeBlockReason?.() ?? '当前档案尚未就绪，请先核实保存或重新读取。'); render('view'); return; }
  const identity = adapter.identity(), namespace = adapter.namespace();
  uiBusy = true; document.body.setAttribute('aria-busy', 'true');
  feedback?.setAttribute('data-processing', 'true');
  try {
    // Let the pressed state paint before synchronous battle/AI calculations.
    if (feedback && !document.hidden) await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    if (identity !== adapter.identity() || namespace !== adapter.namespace()) return;
    await task();
  }
  catch (error) { restore(); toast(error instanceof Error ? error.message : String(error)); render(); }
  finally {
    feedback?.removeAttribute('data-processing');
    uiBusy = false; document.body.removeAttribute('aria-busy');
    if (identity !== adapter.identity() || namespace !== adapter.namespace()) { restore(); render(); }
    if (smallResumeRequested) void resumeSmallTurnIfNeeded();
  }
}
async function persist(): Promise<boolean> {
  // v2 起 storage 是持久权威源；新生成但尚未入 storage 的旧路径在保存前补齐一次。
  for (const unit of state.roster) {
    if (!state.storage.some((r) => r.id === unit.id)) {
      state.storage.push(
        unitRecordFromCombatant(unit, undefined, { transient: state.encounterIds.has(unit.id) }),
      );
    }
  }
  const write = (await controller.persistPanel({
      schemaVersion: PANEL_SAVE_SCHEMA_VERSION,
      encounterContext: state.encounterContext,
      reports: state.reports, reportDeliveries: state.reportDeliveries,
      selectedReportId: state.selectedReportId,
      activeBattleStart: state.activeBattleStart, deletedReport: state.deletedReport, deletedReportIds: state.deletedReportIds,
      rosterIds: state.roster.map((u) => u.id),
      idSeq: state.idSeq,
      protagonistId: state.protagonistId, commanderId: state.commanderId,
      autoTurn: state.autoTurn, saveScope: state.saveScope, autoApprove: state.autoApprove,
      pending: state.pending, inventory: state.inventory,
      lastBattleUnitIds: state.lastBattleUnitIds,
      mode: state.mode, field: state.field, lighting: state.lighting, smallTarget: state.smallTarget,
      mapLayout: state.mapLayout, objectiveMode: state.objectiveMode, siegeAttacker: state.siegeAttacker,
      xpSettled: state.xpSettled, manageOpen: state.manageOpen,
      processedRaws: state.processedRaws, orderMemory: state.orderMemory,
      lastScanAt: state.lastScanAt,
      autoSettleXp: state.autoSettleXp, nonLethal: state.nonLethal, autoAllyOrders: state.autoAllyOrders, unitsOpen: state.unitsOpen,
      encounterIds: [...state.encounterIds],
      storage: state.storage, orderDraft: state.orderDraft, collapsed: state.collapsed,
      snapOpen: state.snapOpen,
      committedOutcomeIds: state.committedOutcomeIds,
      unitMigrationWarnings: state.unitMigrationWarnings,
      unitMigrationBackup: state.unitMigrationBackup,
      battle: battlePersist(),
    }, state.factRevision));
  state.saveReceipt = write.receipt;
  if (write.receipt.status !== 'failed') {
    state.factRevision = write.revision;
    const saved=controller.snapshot();
    state.inventory = saved.inventory ?? [];
    state.reports = saved.reports ?? [];
  } else {
    battleSaveFailed = true;
    restore();
    if (state.small?.battlefield) { tacticalView.selectedId = state.small.active?.id; tacticalView.cell = undefined; }
    state.saveReceipt = { ...write.receipt, error: write.receipt.nativeStatus === 'pending'
      ? write.receipt.error
      : '本次操作尚未保存，已恢复到上次确认的档案。' + (write.receipt.error ?? '') };
  }
  return state.saveReceipt.status !== 'failed';
}

/** 战斗快照：把进行中/已结束的战场（含日志）序列化存档，关窗后可完整恢复 */
function battlePersist(): { kind: 'small' | 'mass'; snap: Record<string, unknown> } | null {
  if (state.small) return { kind: 'small', snap: state.small.toSnapshot() };
  if (state.mass) return { kind: 'mass', snap: state.mass.toSnapshot() };
  return null;
}

interface SavedPanel {
  encounterContext?: LlmEncounterContext;
  activeBattleStart?: BattleStart;
  deletedReport?: DeletedReport;
  deletedReportIds?: string[];
  factRevision?: number;
  proposals?: NarrativeProposal[];
  storySync?: boolean;
  reports?: BattleReport[];
  reportDeliveries?: BattleDeliveries;
  selectedReportId?: string;
  schemaVersion?: number;
  rosterIds?: string[];
  roster?: Combatant[]; idSeq?: number;
  protagonistId?: string; commanderId?: string;
  autoTurn?: boolean; saveScope?: SaveScope; autoApprove?: boolean;
  pending?: Suggestion[]; inventory?: InventoryItem[];
  /** v1 兼容：旧版保存整份战斗单位；v2 只保存 id。 */
  savedCombatants?: Combatant[];
  lastBattleUnitIds?: string[];
  mode?: 'small' | 'mass'; field?: string; lighting?: 'day' | 'night'; smallTarget?: string;
  mapLayout?: 'standard' | 'indoor'; objectiveMode?: BattleObjectiveMode; siegeAttacker?: 'ally' | 'enemy';
  xpSettled?: boolean; manageOpen?: boolean;
  processedRaws?: string[]; orderMemory?: AppState['orderMemory'];
  lastScanAt?: number;
  autoSettleXp?: boolean; nonLethal?: boolean; autoAllyOrders?: boolean; unitsOpen?: boolean;
  encounterIds?: string[];
  storage?: RosterUnit[]; orderDraft?: OrderDrafts;
  collapsed?: Record<string, boolean>; snapOpen?: boolean;
  committedOutcomeIds?: string[];
  unitMigrationWarnings?: string[];
  unitMigrationBackup?: unknown[];
  battle?: { kind: 'small' | 'mass'; snap: Record<string, unknown> } | null;
}

function restore(): void {
  const resumeRequested = smallResumeRequested;
  stopAutomation();
  smallResumeRequested = resumeRequested;
  reportRestartPreview=undefined;
  if (workspaceNamespace !== adapter.namespace()) {
    narrativeDrafts.clear(); promptDrafts.clear();
    workspaceNamespace = adapter.namespace(); workspaceTab = 'battle';
    formationView.selectedId = undefined; formationView.inspectedId = undefined; formationView.nodeId = undefined;
    tacticalView.selectedId = undefined; tacticalView.targetId = undefined; tacticalView.cell = undefined; tacticalView.inspectedCell = undefined; tacticalView.mode = 'weapon';
    state.editingUnit = null; state.editingDraft = undefined; state.abilityDialog = null; unitConversion = undefined;
    builderEditDraft = undefined; builderPreview = undefined; builderSeed = crypto.randomUUID(); state.form = newUnitDraft();
  }
  const snapshot = controller.snapshot();
  const saved = Object.keys(snapshot).length ? snapshot as SavedPanel : undefined;
  state.factRevision = saved?.factRevision ?? 0;
  state.encounterContext = saved?.encounterContext;
  state.proposals = saved?.proposals ?? [];
  state.storySync = saved?.storySync ?? false;
  state.nonLethal = saved?.nonLethal === true;
  state.mapLayout = saved?.mapLayout === 'indoor' ? 'indoor' : 'standard';
  state.objectiveMode = normalizeObjectiveMode(saved?.objectiveMode);
  state.siegeAttacker = saved?.siegeAttacker === 'enemy' ? 'enemy' : 'ally';
  if (!saved) {
    // 新聊天没有存档时必须清空上个聊天的事实与战斗，不能沿用旧内存。
    state.roster = []; state.storage = []; state.small = null; state.mass = null;
    state.pending = []; state.inventory = []; state.lastBattleUnitIds = []; state.committedOutcomeIds = [];
    state.encounterIds = new Set(); state.processedRaws = []; state.lastScanAt = 0;
    state.xpSettled = false; state.protagonistId = undefined; state.commanderId = undefined;
    state.editingUnit = null; state.editingDraft = undefined; state.saveReceipt = undefined;
    state.idSeq = 1; state.field = ''; state.lighting = 'day'; state.orderDraft = {}; state.orderMemory = {};
    state.reports = []; state.reportDeliveries = {}; state.selectedReportId = undefined;
    state.activeBattleStart=undefined; state.deletedReport=undefined; state.deletedReportIds=[];
    state.mode = autoScaleMode();
    return;
  }
  const legacyRoster = Array.isArray(saved.roster) ? saved.roster : [];
  state.reports = saved.reports ?? [];
  state.reportDeliveries = saved.reportDeliveries ?? {};
  state.selectedReportId = saved.selectedReportId;
  state.activeBattleStart=saved.activeBattleStart; state.deletedReport=saved.deletedReport; state.deletedReportIds=saved.deletedReportIds??[];
  state.idSeq = saved.idSeq ?? legacyRoster.length + 1;
  state.protagonistId = saved.protagonistId;
  state.commanderId = saved.commanderId;
  state.autoTurn = !!saved.autoTurn;
  state.saveScope = saved.saveScope === 'character' ? 'character' : 'chat';
  state.autoApprove = saved.autoApprove ?? true;
  state.pending = Array.isArray(saved.pending) ? saved.pending : [];
  state.inventory = Array.isArray(saved.inventory)
    ? saved.inventory.map((it, i) => ({
        ...it,
        id: typeof it.id === 'string' ? it.id : `loot-migrated-${i + 1}`,
        name: it.name,
        note: it.note,
        qty: Number.isFinite(it.qty) ? Math.max(0, it.qty) : 1,
        lootType: it.lootType ?? 'misc',
        ...(it.assignedTo ? { assignedTo: it.assignedTo } : {}),
      }))
    : [];
  state.lastBattleUnitIds = Array.isArray(saved.lastBattleUnitIds)
    ? saved.lastBattleUnitIds.filter((id): id is string => typeof id === 'string')
    : Array.isArray(saved.savedCombatants)
      ? saved.savedCombatants.map((c) => c.id)
      : [];
  state.field = typeof saved.field === 'string' ? saved.field : '';
  state.lighting = saved.lighting === 'night' || saved.field === 'night' ? 'night' : 'day';
  state.smallTarget = typeof saved.smallTarget === 'string' ? saved.smallTarget : '';
  state.xpSettled = !!saved.xpSettled;
  state.manageOpen = !!saved.manageOpen;
  state.processedRaws = Array.isArray(saved.processedRaws) ? saved.processedRaws.slice(-400) : [];
  state.lastScanAt = Number.isFinite(saved.lastScanAt) ? (saved.lastScanAt as number) : 0;
  state.orderMemory = saved.orderMemory && typeof saved.orderMemory === 'object' ? saved.orderMemory : {};
  state.autoSettleXp = saved.autoSettleXp ?? true;
  state.autoAllyOrders = saved.autoAllyOrders ?? true;
  state.unitsOpen = saved.unitsOpen ?? true;
  state.encounterIds = new Set(Array.isArray(saved.encounterIds) ? saved.encounterIds : []);
  state.committedOutcomeIds = Array.isArray(saved.committedOutcomeIds)
    ? saved.committedOutcomeIds.filter((id): id is string => typeof id === 'string')
    : [];
  const migrated = migratePanelUnits({
    schemaVersion: saved.schemaVersion,
    rosterIds: saved.rosterIds,
    roster: saved.roster,
    storage: saved.storage,
    encounterIds: state.encounterIds,
    registry: reg,
    era: state.era,
  });
  state.storage = migrated.records;
  state.roster = migrated.roster;
  state.unitMigrationWarnings = [...new Set([
    ...(Array.isArray(saved.unitMigrationWarnings) ? saved.unitMigrationWarnings : []),
    ...migrated.warnings,
  ])].slice(-50);
  state.unitMigrationBackup = [
    ...(Array.isArray(saved.unitMigrationBackup) ? saved.unitMigrationBackup : []),
    ...migrated.backup,
  ].slice(-50);
  state.orderDraft = saved.orderDraft && typeof saved.orderDraft === 'object' ? saved.orderDraft : {};
  state.collapsed = saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {};
  state.snapOpen = saved.snapOpen ?? true;
  // 战斗快照恢复：关窗/切聊天回来，战场（含战报日志）原样续上
  state.small = null;
  state.mass = null;
  try {
    if (saved.battle?.kind === 'small' && saved.battle.snap) {
      state.small = SmallBattle.fromSnapshot(saved.battle.snap, { traitRegistry: reg, summonUnit });
      extendSmallRoundLimit(state.small); upgradeDefaultObjective(state.small, state.siegeAttacker);
    } else if (saved.battle?.kind === 'mass' && saved.battle.snap) {
      state.mass = MassBattle.fromSnapshot(saved.battle.snap, { traitRegistry: reg, summonUnit });
    }
  } catch {
    /* 快照损坏则丢弃战斗态，保留编制 */
  }
  // 旧存档已结算标记也封口，不能因旧版缺少完整战果 id 而重写最新档案。
  const restoredBattle = currentBattle();
  if(!restoredBattle)for(const unit of state.roster)if(unit.rulesVersion==='v2'){prepareCombatModel(unit,V4_D20);upgradeCombatSkills(unit);}
  if (restoredBattle && state.xpSettled) {
    const id = battleOutcomeId(state.mass ? 'mass' : 'small', restoredBattle.seed);
    if (!state.committedOutcomeIds.includes(id)) state.committedOutcomeIds.push(id);
  }
  // 无进行中战斗时规模由编制推导（出现连队→军团）；有战斗则跟随战斗刻度
  state.mode = state.small ? 'small' : state.mass ? 'mass' : (saved.mode ?? autoScaleMode());
  if (!state.small && !state.mass) state.mode = autoScaleMode();
}

// ---------- 工具 ----------

function $(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 2200);
}

/** 大项折叠开关：读 state.collapsed，默认展开 those in defaultOpen */
function isSecCollapsed(id: string): boolean {
  return state.collapsed[id] ?? false;
}
function secToggleHtml(id: string, label: string): string {
  const open = !isSecCollapsed(id);
  return `<div class="sec-toggle" data-action="section-toggle" data-sec="${id}">${open ? '▾' : '▸'} ${label}</div>`;
}
function wrapSection(id: string, label: string, body: string): string {
  if (isSecCollapsed(id)) return `<section>${secToggleHtml(id, label)}</section>`;
  return `<section>${secToggleHtml(id, label)}${body}</section>`;
}

function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 单位序号：id 形如 「名字-7」，同名单位靠 #7 区分 */
function unitSeq(u: Combatant): string {
  const m = u.id.match(/-(\d+)$/);
  return m ? m[1]! : '';
}

/** 单位显示名：同名单位带 #序号，选择列表里再附等级/血量便于区分 */
function unitLabel(u: Combatant, extra = ''): string {
  const seq = unitSeq(u);
  return `${u.name}${seq ? ` #${seq}` : ''}${extra}`;
}

function formationZone(u: Combatant): '左翼' | '中军' | '右翼' | undefined {
  const zone = u.tags.find((t) => t.startsWith('zone:'))?.slice(5);
  return zone === '左翼' || zone === '中军' || zone === '右翼' ? zone : undefined;
}

function formationRank(u: Combatant): 'front' | 'rear' | 'reserve' | undefined {
  const rank = u.tags.find((t) => t.startsWith('rank:'))?.slice(5);
  return rank === 'front' || rank === 'rear' || rank === 'reserve' ? rank : undefined;
}

function defaultRank(u: Pick<Combatant, 'archetype'>): 'front' | 'rear' | 'reserve' {
  return u.archetype === 'ranged' ? 'rear' : u.archetype === 'mobile' ? 'reserve' : 'front';
}

async function addUnit(input: GenerateInput, opts: { encounter?: boolean } = {}): Promise<void> {
  // 特质去重：AI 标签/面板勾选可能重复给同一特质
  const { unit } = generateUnit({ ...input, rulesVersion: 'v2', era: undefined, traits: [...new Set(input.traits)] }, { registry: reg });
  prepareCombatModel(unit, V4_D20); upgradeCombatSkills(unit);
  // id 去重
  state.idSeq++;
  state.roster.push(unit);
  state.storage.push(unitRecordFromCombatant(unit, undefined, { transient: !!opts.encounter }));
  if (opts.encounter) state.encounterIds.add(unit.id);
  // 只为下一战推荐模式，保持已有单位的身份与刻度。
  state.mode = autoScaleMode();
  (await persist());
}

/** 储存器档案实体化为本场编制，保留稳定 id、当前兵力、状态和玩家编辑过的基础属性。 */
function materializeStorageUnit(r0: RosterUnit): Combatant {
  const unit=materializeUnitRecord(r0, reg, { era: state.era });
  if(unit.rulesVersion==='v2'){prepareCombatModel(unit,V4_D20);upgradeCombatSkills(unit);}
  return unit;
}

/** 召唤模板 → 战斗单位。供引擎 summon 效果落地用（面板提供，引擎不引造怪器）。
 *  模板按「reinforcement」返回一个默认援军单位；成功后不写入持久编制（临场召唤物）。 */
function summonUnit(templateId: string, side: Side, seed?: string): Combatant | null {
  if (templateId !== 'reinforcement') return null;
  if (seed) return generateUnit({ name: '随队预备', side, scale: seed.startsWith('mass:') ? 'company' : 'hero', hpMax: seed.startsWith('mass:') ? 10 : undefined, level: 3, rulesVersion: 'v2', traits: [], weaponClass: 'sword', weaponLevel: 4, armorTier: 2 }, { registry: reg, seed }).unit;
  const { unit } = generateUnit(
    {
      name: '援军营',
      side,
      archetype: 'infantry',
      scale: 'company',
      level: Math.max(2, Math.min(6, Math.round((state.mass?.round || state.small?.round || 1) / 2) + 2)),
      traits: [],
      era: state.era,
    },
    { registry: reg },
  );
  unit.id = `${unit.name}-${state.idSeq++}`;
  return unit;
}

function hpPct(u: Combatant): number {
  return Math.max(0, Math.round((memberHealth(u) / Math.max(1, memberHealthMax(u))) * 100));
}

/** 新战根据实际规模与参战形式推荐；进行中的战斗由effectiveMode保持。 */
function autoScaleMode(): 'small' | 'mass' {
  return recommendBattleMode(state.roster).mode;
}

function rosterHasBothSides(): boolean {
  return state.roster.some((u) => u.side === 'ally') && state.roster.some((u) => u.side === 'enemy');
}

/** 展示用模式：进行中的战斗优先（编制变动不把正在打的战斗切走） */
function effectiveMode(): 'small' | 'mass' {
  return state.small ? 'small' : state.mass ? 'mass' : state.mode;
}

/** 当前战斗（结算/输出共用） */
function currentBattle(): SmallBattle | MassBattle | null {
  return state.small ?? state.mass;
}

function requireArchiveWritable(): void {
  const b = currentBattle();
  if (b && !state.committedOutcomeIds.includes(battleOutcomeId(state.mass ? 'mass' : 'small', b.seed))) {
    throw new Error('战斗中或战果未提交：先结算/收兵，再更新长期档案');
  }
}

function prepareRosterForBattle(): void {
  if (currentBattle()) throw new Error('请先收兵归档上一场战斗');
  let roster: Combatant[] = [];
  for (const id of new Set(state.roster.map((u) => u.id))) roster = deployUnitRecord(state.storage, roster, id, reg);
  const issue = battleCapacityIssue(roster); if (issue) throw new Error(issue);
  // 旧远程实例在开战时补齐到分类新射程（库存权威档案由控制器装载时迁移）。
  for (const unit of roster) { calibrateWeaponRange(unit.weapon); calibrateWeaponRange(unit.sidearm); calibrateAutocannon(unit.weapon); calibrateAutocannon(unit.sidearm); calibrateWeaponHands(unit.weapon); calibrateWeaponHands(unit.sidearm); }
  state.roster = prepareBattleItems(roster, controller.snapshot());
}

/**
 * 自动行动（小规模）：依次替「引擎接管方」的单位执行 autoAction，直到轮到玩家手动方或战斗结束。
 * 规则：敌方单位**始终**由引擎自动行动（无论是否设主控、是否勾选自动行动）；玩家只操控我方。
 * 友方仅在开了「自动行动」且当前不是主控时由引擎代打；否则停下让玩家手动。
 * （autoTurn 关闭时：敌方仍自动、我方全手动。）
 */
async function autoSmall(b: SmallBattle): Promise<void> {
  if (!b.active || b.isOver()) return;
  if (b.active.status !== 'ready') b.endTurn();
  else b.autoAction(b.active.id);
}
async function runAuto(): Promise<void> {
  if (fullAuto.running) return;
  const b = state.small;
  if (!b) return;
  if (!b.isOver()) {
    let guard = 0;
    while (state.small === b && !b.isOver() && b.active && guard++ < 200) {
      const a = b.active;
      // 反应击杀/失能必须先交还行动权，不能等待已倒下的玩家单位。
      if (a.status === 'ready') {
        if (a.id === state.protagonistId) break;
        if (a.side !== 'enemy' && !state.autoTurn) break;
      }
      await autoSmall(b);
      // Each completed activation is durable before the next remote decision.
      if (state.small !== b || !(await persist())) return;
    }
  }
  if (state.small !== b) return;
  tacticalView.selectedId = b.active?.id; tacticalView.cell = undefined;
  // 战斗结束统一收口：无论结束路径（自动清场/手动收尾/🤖自动行动/撤离）都补结束日志并触发入账+注入。
  // 各步骤幂等（battle-end 日志判重 / xpSettled），每次 render 重复调用无副作用。
  if (b.isOver()) {
    if (!b.log.some((l) => l.kind === 'battle-end')) {
      const w = b.winner();
      b.log.push({ round: b.round, kind: 'battle-end', text: w === 'ally' ? '⚔ 战斗胜利' : w === 'draw' ? '僵局' : '⚔ 战斗失败' });
    }
    (await onBattleEnded());
  }
}

async function resumeSmallTurnIfNeeded(): Promise<void> {
  // A restored view can arrive while the old request is unwinding. Coalesce that
  // wake-up behind the same UI task lock instead of losing it or cancelling a peer.
  smallResumeRequested = true;
  if (uiBusy || fullAuto.running) return;
  smallResumeRequested = false;
  const b = state.small;
  if (!b || b.isOver() || !b.active || (b.active.status === 'ready' && b.active.side !== 'enemy')
    || battleSaveFailed || (runtime.canWrite && !runtime.canWrite())) return;
  await panelTask(async () => {
    await runAuto();
    render('battle');
  });
}

/** 全自动只在当前面板/战斗有效，恢复或切聊天后需重新开启。 */
function startFullAuto(): void {
  const battle = currentBattle(), context = controller.inventoryContext();
  if (!battle || battle.isOver()) return;
  if (controller.migrationReview()) throw Error('请先完成档案迁移预览');
  state.abilityDialog = null;
  fullAuto.start(async () => {
    if (uiBusy) return true;
    if (runtime.canWrite && !runtime.canWrite()) return false;
    uiBusy = true; document.body.setAttribute('aria-busy', 'true');
    try {
    if (currentBattle() !== battle || context !== controller.inventoryContext() || workspaceNamespace !== adapter.namespace()
      || controller.migrationReview() || battleSaveFailed || battle.isOver()) return false;
    const progress = `${battle.round}:${battle instanceof SmallBattle ? battle.turnIndex : ''}`;
    battleSaveFailed = false;
    if (battle instanceof SmallBattle) {
      if (!battle.active) return false;
      await autoSmall(battle);
      tacticalView.selectedId = battle.active?.id; tacticalView.cell = undefined;
    } else {
      // 复用手动执行的草案校验、自动补令、阶段结算和失败回滚。
      (await resolveMassRound(battle.round, battle.seed));
    }
    if (battleSaveFailed || currentBattle() !== battle) return false;
    if (battle.isOver()) {
      fullAuto.stop();
      if (battle instanceof SmallBattle) (await runAuto()); else (await onBattleEnded());
    }
    if (battleSaveFailed || currentBattle() !== battle || !(await persist())) return false;
    if (battle.isOver()) render('battle');
    if (!battle.isOver() && progress === `${battle.round}:${battle instanceof SmallBattle ? battle.turnIndex : ''}`) throw Error('自动行动没有推进回合，已暂停，可手动处理');
    return !battle.isOver();
    } finally {
      uiBusy = false; document.body.removeAttribute('aria-busy');
      if (!fullAuto.running) render('battle');
      if (smallResumeRequested) void resumeSmallTurnIfNeeded();
    }
  }, () => render('battle'), (error) => {
    // 异常时撤回到已保存战场，避免保留只执行了一半的行动。
    restore(); toast('全自动已暂停：' + (error instanceof Error ? error.message : String(error)));
  });
}

/** 战斗结束统一收口：经验自动入账（可选）+ 存活单位落库。输出由玩家点按钮以 user 楼层发送 */
async function onBattleEnded(): Promise<void> {
  const b = currentBattle();
  if (!b || !b.isOver()) return;
  if (b instanceof SmallBattle) b.finalizeCasualties();
  if (state.autoSettleXp && !state.xpSettled && state.saveReceipt?.status !== 'failed') {
    try {
      (await settleXp());
    } catch (error) {
      toast(`战果未提交：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** 军团：当前是否自动军令（主控非指挥官，或主帅倒下） */
function massAutoCommand(): boolean {
  const b = state.mass;
  if (!b) return false;
  if (!b.manualCommandAllowed) return true;
  return !!state.protagonistId && state.protagonistId !== b.commanderId;
}

/** 军团命令记忆落地：为所有无令我方单位重发上次指令（目标阵亡时自动换最近敌军） */
function issueMemoryOrders(): number {
  const b = state.mass;
  if (!b) return 0;
  let n = 0;
  for (const u of b.readyUnits('ally')) {
    if (b.orders.has(u.id)) continue;
    const previous = b.previousOrders.get(u.id);
    const mem = b.rules.resolutionVersion === 'v2' && previous && !previous.automatic ? previous : state.orderMemory[u.id];
    if (!mem) continue;
    let targetId = mem.targetId;
    const targetOk =
      !!targetId && b.combatants.some((c) => c.id === targetId && c.side === 'enemy' && c.status === 'ready');
    if (!targetOk) {
      const foes = b.visibleCombatants('ally').filter((c) => c.side === 'enemy' && c.status === 'ready');
      targetId = foes[0]?.id;
    }
    const r = b.issue({ unitId: u.id, type: mem.type, targetId });
    if (r.ok) n++;
  }
  return n;
}

// ---------- 渲染 ----------

/** 渲染前捕获生成器表单当前值（render 会重建 DOM，必须回填防止选择被重置） */
function captureForm(): void {
  state.form = captureUnitDraft('gen', state.form);
  if (builderEditDraft) builderEditDraft = captureUnitDraft('edit', builderEditDraft);
}

type RenderScope = 'all' | 'battle' | 'view' | 'none';
const dirtyWorkspaces = new Set<WorkspaceTab>(WORKSPACES.map(([id]) => id));
const battleCamera = new BattleCamera();
let renderedNamespace: string | undefined;
let lastTraceKey = '';
function render(scope: RenderScope = 'all', tacticalQuery?: TacticalQuery): void {
  const app = $('#app'), winScroll = window.scrollY;
  const contextChanged = renderedNamespace !== workspaceNamespace;
  if (contextChanged) { renderedNamespace = workspaceNamespace; dirtyWorkspaces.clear(); WORKSPACES.forEach(([id]) => dirtyWorkspaces.add(id)); battleCamera.reset(); lastTraceKey = ''; app.replaceChildren(); }
  if (scope === 'all') WORKSPACES.forEach(([id]) => dirtyWorkspaces.add(id));
  else if (scope === 'battle') (['battle','reports','units','inventory','settings'] as WorkspaceTab[]).forEach(id => dirtyWorkspaces.add(id));
  else if (scope === 'view') dirtyWorkspaces.add(workspaceTab);
  if (!app.querySelector('.workspace-main')) app.innerHTML = `<header class="app-header"><div class="app-brand"><span class="brand-emblem" aria-hidden="true">阵</span><div><h1>战阵</h1><p>你的队伍，你的战场</p></div></div><div class="app-state"></div></header><div id="workspace-navigation"></div><div id="workspace-notices"></div><main class="workspace-main">${WORKSPACES.map(([id]) => workspacePage(id, workspaceTab, '')).join('')}</main><div id="workspace-dialog"></div>`;
  const pendingCount = state.proposals.filter(p => ['pending','failed','unresolved'].includes(p.status)).length;
  const nav = app.querySelector<HTMLElement>('#workspace-navigation')!;
  const navHtml = workspaceNavigation(workspaceTab, pendingCount);
  if (nav.innerHTML !== navHtml) nav.innerHTML = navHtml;
  const blocked = runtime.writeBlockReason?.();
  const saveMessage = blocked ? esc(blocked) : state.saveReceipt?.status === 'failed' ? '未保存：' + esc(state.saveReceipt.error ?? '存储不可用') : state.saveReceipt?.status === 'local-only' ? '已保存本地 · 酒馆待确认' : state.saveReceipt ? '已保存' : '准备就绪';
  const statusHtml = `<span data-role="save-status" class="${blocked || state.saveReceipt?.status === 'failed' ? 'save-failed' : ''}">${saveMessage}</span>${state.saveReceipt?.status === 'failed' ? '<button data-action="save-retry">重试保存</button>' : ''}${blocked && runtime.reloadArchive ? '<button data-action="archive-reload">重新读取档案</button>' : ''}<button data-action="theme-toggle" aria-label="切换深浅主题">明暗</button>`;
  const status = app.querySelector('.app-state')!; if(status.innerHTML !== statusHtml)status.innerHTML=statusHtml;
  const latest = state.proposals.at(-1), failure = latest && ['rejected','stale','unresolved'].includes(latest.status) ? latest.reason : undefined;
  const notices = app.querySelector<HTMLElement>('#workspace-notices')!;
  const noticeHtml = (controller.migrationReview() ? renderMigrationReview() : '') + (pendingCount ? `<div class="workspace-notice"><span>剧情带来 ${pendingCount} 项待处理变更</span><button data-action="workspace-tab" data-tab="units">查看变更</button></div>` : '') + (failure ? `<div class="workspace-notice narrative-alert" role="alert"><span>${esc(failure.slice(0,160))}</span><button data-action="narrative-review">查看记录</button></div>` : '');
  if (notices.innerHTML !== noticeHtml) updateRegion(notices, noticeHtml);
  for (const page of app.querySelectorAll<HTMLElement>('[data-workspace]')) page.hidden = page.dataset.workspace !== workspaceTab;
  const b = currentBattle();
  // 自动推进时不打断其他页的输入；其内容在返回/主动操作时刷新。
  if (dirtyWorkspaces.has(workspaceTab) && !(scope === 'battle' && !['battle','reports'].includes(workspaceTab))) {
    let content = '';
    if (workspaceTab === 'battle') {
      const battleContent = state.small?.battlefield ? renderTacticalBattle(state.small, tacticalView, state.autoTurn, tacticalQuery) : b ? state.mass ? renderMass() : renderSmall() : renderBattlePreparation();
      content = (b ? renderBattleToolbar(b) : '') + (b?.isOver() ? renderBattleExit(b) : '') + battleContent + renderXp();
    } else if (workspaceTab === 'units') content = renderNarrativeProposals() + renderConfig() + renderRole() + renderManage() + renderUnitConversion() + (state.pending.length ? renderPending() : '');
    else if (workspaceTab === 'inventory') content = inventoryPanel.render();
    else if (workspaceTab === 'reports') content = renderLog() || '<section class="workspace-empty"><h2>战报会保存在这里</h2><p>完成战斗并归档后，可以随时查看或发送叙述。</p></section>';
    else content = renderWorkspaceSettings();
    updateRegion(app.querySelector<HTMLElement>(`[data-workspace="${workspaceTab}"]`)!, content);
    dirtyWorkspaces.delete(workspaceTab);
  }
  const dialog = app.querySelector<HTMLElement>('#workspace-dialog')!, dialogHtml = renderAbilityDialog();
  if (dialog.innerHTML !== dialogHtml) updateRegion(dialog, dialogHtml);
  window.scrollTo(0, winScroll);
  if (workspaceTab === 'battle' && b) {
    const target = state.small ? app.querySelector<HTMLElement>('.grid-cell.selected') : app.querySelector<HTMLElement>('.formation-piece.active');
    if (scope !== 'view' && !fullAuto.running) battleCamera.update(battleIdOf(b), state.small?.active?.id ?? formationView.selectedId ?? 'mass', target ?? undefined);
    const trace = traceLocations(b);
    if (trace && trace.key !== lastTraceKey) { lastTraceKey = trace.key; replayBattleTrace(); }
  }
}
function renderBattleToolbar(b: SmallBattle | MassBattle): string {
  const actor=b instanceof SmallBattle?b.active:b.combatants.find(u=>u.id===formationView.selectedId)??b.combatants.find(u=>u.side==='ally'&&u.status==='ready'&&!b.isAttached(u.id));
  return `<div class="battle-toolbar"><span class="tag">本场：${b.nonLethal?'非致命':'致命'}</span>${cannonAmmoControl(actor,b.isOver()||actor?.side!=='ally')}${renderContextStatus()}<label class="battle-auto"><input type="checkbox" aria-label="全自动战斗（含主控）" data-role="full-auto-battle" ${fullAuto.running ? 'checked' : ''} ${b.isOver() ? 'disabled' : ''}>${fullAuto.running ? '自动推进中 · 点击暂停' : '全自动战斗（含主控）'}</label><label>自动策略 <select data-role="battle-tactic" ${b.isOver() || b.rules.resolutionVersion !== 'v2' ? 'disabled' : ''}>${Object.entries(TACTICAL_PREFERENCES).map(([id,name]) => `<option value="${esc(id)}" ${b.allyTactic === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>${!b.isOver() ? '<details data-detail-id="battle-options"><summary>更多</summary><button data-action="battle-finish" data-reason="ceasefire">停止交战并结算</button><button class="danger" data-action="battle-finish" data-reason="surrender">投降并结算</button></details>' : ''}</div>`;
}
function renderContextStatus(): string {
  return llmContext.busy ? '<p role="status">正在读取上下文并选择开战配置… <button data-action="llm-stop">取消读取</button></p>'
    : state.encounterContext ? `<p class="sub">${esc(llmContextSummary(state.encounterContext))}</p>` : '';
}
function renderBattleExit(b: SmallBattle | MassBattle): string {
  const archived = state.committedOutcomeIds.includes(battleIdOf(b)), deleted=state.deletedReportIds?.includes(battleIdOf(b));
  return `<section class="battle-exit"><strong>${archived ? '战果已入账 · '+(deleted?'归档报告已删除':'战报已归档') : '战果尚未入账'}</strong><div class="row"><button class="primary" data-action="out-epilogue">叙述战斗终章</button><button data-action="out-digest">发送完整逐轮战报</button><button data-action="workspace-tab" data-tab="reports">查看战报</button><button data-action="battle-close">收兵并清理战场</button></div><p class="sub">${archived ? deleted?'删除报告不会撤销已入账战果，可在战报页撤销删除。':'收兵后仍可查看和发送战报。' : '收兵时将先保存本场战果。'}</p></section>`;
}
function replayBattleTrace(eventIndex?: number): void {
  const b = currentBattle(); if (!b) return;
  const trace = traceLocations(b, eventIndex); if (!trace) return;
  const app = $('#app');
  const targets = trace.cells.map(cell => b instanceof SmallBattle ? app.querySelector<HTMLElement>(`.grid-cell[data-cell="${cell}"]`) : app.querySelector<HTMLElement>(`[data-formation="${FORMATION_NODES[cell]?.id}"]`)).filter((el): el is HTMLElement => !!el);
  for (const el of targets) { el.classList.remove('trace-pulse'); void el.offsetWidth; el.classList.add('trace-pulse'); }
  const overlay = app.querySelector<SVGSVGElement>('.battle-trace'); if (overlay && eventIndex === undefined) {
    const line = overlay.querySelector('line'), bounds = overlay.getBoundingClientRect(), box = overlay.viewBox.baseVal;
    if (line && targets.length >= 2 && bounds.width && bounds.height) for (const [suffix, target] of [['1', targets[0]!], ['2', targets.at(-1)!]] as const) {
      const rect = target.getBoundingClientRect();
      line.setAttribute('x' + suffix, String((rect.left + rect.width / 2 - bounds.left) / bounds.width * box.width));
      line.setAttribute('y' + suffix, String((rect.top + rect.height / 2 - bounds.top) / bounds.height * box.height));
    }
    overlay.classList.remove('trace-active'); void overlay.getBoundingClientRect(); overlay.classList.add('trace-active');
  }
  const event = eventIndex === undefined ? lastBattleAction(b)?.entry : publicBattleEvents(b).find(e => e.index === eventIndex)?.entry;
  const damage = event?.resolution;
  if (damage && targets.length) { const label = document.createElement('span'); label.className = 'battle-damage-float'; label.textContent = damage.finalDamage ? '−' + damage.finalDamage : damage.hit ? damage.penetrationFactor === 0 ? '未穿透' : '无损失' : '未命中'; targets.at(-1)!.append(label); setTimeout(() => label.remove(), 2200); }
  if (eventIndex !== undefined) battleCamera.focus(targets.at(-1));
}


function renderBattlePreparation(): string {
  const visible = state.roster.filter(visibleUnitRecord), allies = visible.filter((u) => u.side === 'ally'), enemies = visible.filter((u) => u.side === 'enemy');
  const mode = effectiveMode(), capacityIssue = battleCapacityIssue(state.roster), ready = rosterHasBothSides() && !capacityIssue;
  const escortSide = state.objectiveMode === 'intercept' ? 'enemy' : 'ally';
  const escortCandidates = state.roster.filter((u) => u.side === escortSide && u.hp > 0 && u.status === 'ready');
  const escortUnit = escortCandidates.find((u) => u.id === state.protagonistId) ?? escortCandidates[0];
  const missionSummary = state.objectiveMode === 'escort' || state.objectiveMode === 'intercept'
    ? `${escortSide === 'ally' ? '我方护送，敌方拦截' : '敌方护送，我方拦截'}；护送对象：${escortUnit?.name ?? '尚未集结'}。`
    : state.objectiveMode === 'siege' || state.objectiveMode === 'auto' && plannedFieldTags().includes('siege')
      ? `${state.siegeAttacker === 'ally' ? '我方进攻，敌方防守' : '我方防守，敌方进攻'}；胜利点在守方后方，攻方连续控制5个完整回合获胜。`
      : '歼灭战：击溃或消灭敌方全部作战单位，没有占点胜利。';
  return `<section class="battle-preparation"><span class="workspace-eyebrow">下一场交战</span><h2>${ready ? '队伍已集结' : '先集结你的队伍'}</h2>
    ${capacityIssue ? `<p class="notice error" role="alert">${esc(capacityIssue)}</p>` : ''}
    <p>${ready ? esc(recommendBattleMode(state.roster).reason) + '。确认队伍后即可开始。' : '从已有档案选人，或接收正文中的新遭遇。生命、兵员和装备沿用当前记录。'}</p>
    ${mode === 'small' ? `<p class="mission-summary">${esc(missionSummary)}</p>` : ''}
    <div class="preparation-stats"><div><strong>${allies.length}</strong><span>我方单位</span></div><div><strong>${enemies.length}</strong><span>已知敌方</span></div><div><strong>${mode === 'mass' ? '会战' : '战术'}</strong><span>${esc(fieldLabel(plannedFieldTags()) || '野战')}</span></div></div>
    <label class="battle-auto"><input type="checkbox" data-role="non-lethal" ${state.nonLethal?'checked':''}> 非致命战斗（双方伤害只会造成濒死）</label>
    ${renderContextStatus()}${readLlmSettings().enabled ? '<p class="sub">开战前将由普通 LLM 读取最近所选层数的正文，选择指挥与场景配置。可在设置中关闭。</p>' : ''}<div class="row"><button class="primary" data-action="${mode === 'mass' ? 'mass-start' : 'small-start'}" ${ready ? '' : 'disabled'}>开始交战</button><button data-action="workspace-tab" data-tab="units">${ready ? '查看队伍' : '集结队伍'}</button><button data-action="workspace-tab" data-tab="inventory">整理配装</button></div>
    ${state.roster.every((u) => u.rulesVersion === 'v2') ? `<details class="preparation-options" data-detail-id="preparation-options"><summary>任务设置 · ${state.mapLayout === 'indoor' ? '室内' : '野战'} / ${state.objectiveMode === 'escort' ? '护送' : state.objectiveMode === 'intercept' ? '拦截' : state.objectiveMode === 'siege' ? '攻城' : state.objectiveMode === 'annihilation' ? '歼灭' : plannedFieldTags().includes('siege') ? '攻城' : '歼灭'}</summary><div class="row"><label>地形<select data-role="context-field">${Object.entries(FIELD_LABELS).filter(([id])=>id!=='night').map(([id,label])=>`<option value="${id}" ${(state.field||'plains')===id?'selected':''}>${label}</option>`).join('')}</select></label><label>光照<select data-role="context-lighting"><option value="day" ${state.lighting==='day'?'selected':''}>日间</option><option value="night" ${state.lighting==='night'?'selected':''}>夜间</option></select></label><label>地图<select data-role="map-layout"><option value="standard" ${state.mapLayout !== 'indoor' ? 'selected' : ''}>标准野战</option><option value="indoor" ${state.mapLayout === 'indoor' ? 'selected' : ''}>紧凑室内</option></select></label><label>目标<select data-role="objective-mode"><option value="auto" ${state.objectiveMode === 'auto' ? 'selected' : ''}>按环境：野战歼灭／攻城夺点</option><option value="annihilation" ${state.objectiveMode === 'annihilation' ? 'selected' : ''}>歼灭战</option><option value="siege" ${state.objectiveMode === 'siege' ? 'selected' : ''}>攻城战</option><option value="escort" ${state.objectiveMode === 'escort' ? 'selected' : ''}>我方护送</option><option value="intercept" ${state.objectiveMode === 'intercept' ? 'selected' : ''}>拦截敌方护送</option></select></label><label>攻城角色<select data-role="siege-attacker"><option value="ally" ${state.siegeAttacker === 'ally' ? 'selected' : ''}>我方进攻</option><option value="enemy" ${state.siegeAttacker === 'enemy' ? 'selected' : ''}>我方防守</option></select></label></div><p>野战默认歼灭；攻城胜利点在守方纵深，攻方连续控制5个完整回合获胜，守方坚持到60回合获胜。我方护送沿用主控或首个我方单位；拦截以首个敌方单位为护送对象。双方规则相同：抵达出口则护送方胜，目标被消灭、撤离或逾期未抵达则拦截方胜。</p></details>` : ''}
    ${allies.length ? `<div class="preparation-roster">${allies.slice(0, 8).map((u) => `<span><b>${esc(u.name)}</b><small>${u.scale === 'hero' ? '生命' : '人数'} ${u.hp}/${u.base.hpMax}</small></span>`).join('')}${allies.length > 8 ? `<span>另有${allies.length - 8}支单位</span>` : ''}</div>` : ''}
  </section>`;
}
function renderWorkspaceSettings(): string {
  const saved = controller.snapshot();
  return `${renderLlmSettings(readLlmSettings(), llmDiagnostic)}${promptScopeControls(saved.promptSettings, narrativeProjectionDetails(saved, adapter.recentPromptText?.() ?? ''), (saved.storage ?? []).filter(visibleUnitRecord))}${renderPromptSettings(saved.promptSettings, promptDrafts)}<section><h2>显示与操作</h2><p>战场形式由参战队伍确定，环境沿用剧情声明。</p><button data-action="theme-toggle">切换深浅主题</button></section>
    <section><h2>保存与恢复</h2><p>${state.saveReceipt?.status === 'local-only' ? '目前仅确认本地副本，酒馆尚未确认保存。' : '单位档案和战报随当前聊天保存。保存失败时会在顶部显示。'}</p><button data-action="save-retry">核实并重试保存</button>${controller.migrationReview() ? '' : renderMigrationReview()}</section>
    <details class="workspace-diagnostics"><summary>版本与运行信息</summary><p>战斗结果由本设备计算。伤害、命中和状态的详细过程可在战报中查看。</p><p>${controller.capabilities.injection ? '已支持在续写剧情时参考当前战斗进度。' : '当前酒馆暂不支持自动提供剧情参考。'}</p></details>`;
}
function renderMigrationReview(): string {
  const review = controller.migrationReview();
  if (review) return `<section data-role="migration-review"><h2>存档迁移预览 · 尚未改写原档</h2>
    <p>可读取 ${review.candidate.storage?.length ?? 0} 个档案；隔离 ${review.quarantined} 项。已有装备、人数和进行中旧规则保留。接受后会连同完整原档备份一起保存。</p>
    ${review.changes.map((change) => `<div class="sub">${esc(change)}</div>`).join('')}
    <div class="row"><button data-action="migration-export">下载原档备份</button><button class="primary" data-action="migration-accept">接受此预览并保存备份</button></div></section>`;
  const backups = controller.snapshot().migrationBackups;
  return Array.isArray(backups) && backups.length ? `<details><summary>迁移备份与恢复</summary><p>恢复会替换当前聊天的战阵战斗记录，回到最近一次迁移前。请先下载当前存档。</p><button data-action="migration-export">下载当前完整存档</button><button data-action="migration-restore">恢复最近迁移前备份</button></details>` : '';
}

function renderUnitConversion(): string {
  if (!unitConversion || unitConversion.namespace !== adapter.namespace()) return '';
  const { before, after } = unitConversion;
  const old = before.snapshot, next = after.snapshot!;
  return `<section data-role="unit-conversion"><h2>${esc(before.name)} · V2更新规则预览</h2><p>身份 ${esc(before.id)}、${before.scale === 'hero' ? '生命' : '人数'} ${before.hp}/${before.base.hpMax}、训练${before.level}、经验${before.xp ?? 0}保持。更新规则会按下列效果重建装备，原档一并保留。</p>
    <table><tr><th>字段</th><th>原档</th><th>V2待确认内容</th></tr>
    <tr><td>武器</td><td>${esc(old?.weapon?.baseDice ?? '旧默认')} ${esc(old?.weapon?.apDice ?? '')}</td><td>${esc(next.weapon!.recipe!.mechanism)} P${next.weapon!.level} / ${esc(next.weapon!.baseDice)} / 穿透${next.weapon!.penetration}</td></tr>
    <tr><td>防护</td><td>旧类型${old?.armor?.tier ?? before.armorTier ?? 0}</td><td>P${next.armor!.level} / 动能${next.armor!.protection!.kinetic} 热能${next.armor!.protection!.thermal} 奥术${next.armor!.protection!.arcane}</td></tr>
    <tr><td>属性</td><td>攻${before.base.atk} 防${before.base.def}</td><td>攻${after.base.atk} 防${after.base.def}</td></tr></table>
    <div class="sub">${next.generationWarnings?.map(esc).join('；') ?? ''}</div>
    <div class="row"><button data-action="unit-conversion-export">下载此单位原档</button><button class="primary" data-action="unit-conversion-commit">确认上述更新规则</button><button data-action="unit-conversion-cancel">取消</button></div></section>`;
}

function renderConfig(): string {
  const units = state.roster.filter(visibleUnitRecord);
  return `<section class="team-workspace"><div class="section-heading"><div><h2>参战队伍</h2><p class="sub">沿用当前生命、人数与装备。</p></div><button data-action="gen-toggle">${state.genOpen ? '收起新建' : '添加单位'}</button></div>
    <div class="gen-details">${state.genOpen ? `<div class="gen-body"><h3>新建单位</h3>${unitForm('gen', state.form, reg)}<div class="row"><button class="primary" data-action="gen-add">预览队伍</button></div>${builderPreview && !builderPreview.record ? buildPreview(builderPreview.unit) : ''}</div>` : ''}</div>
    <div class="units">${units.map((u) => unitHtml(u, state.roster.indexOf(u), false)).join('') || '<div class="workspace-empty"><p>尚未集结队伍。添加新单位，或从下方档案中选择。</p></div>'}</div>
    ${units.length ? '<details class="team-tools"><summary>编制工具</summary><button data-action="gen-clear">清空参战名单</button></details>' : ''}</section>`;
}

function archName(a: string, _skin = false): string {
  // 单位种类由 AI 输出，名称始终用中性词汇（不再随时代皮肤切换成 火枪兵/炮兵 等）
  const names: Record<string, string> = { infantry: '步兵（抗线）', ranged: '远程（输出）', mobile: '机动（冲锋）' };
  return names[a] ?? a;
}

function visibleUnitRecord(u: { id: string; side: Side }): boolean {
  const b = currentBattle();
  return !b || b.isOver() || b.rules.resolutionVersion !== 'v2' || u.side === 'ally' || b.visibleCombatants('ally').some((c) => c.id === u.id);
}
function unitHtml(u: Combatant, index: number, inBattle: boolean): string {
  if (!visibleUnitRecord(u)) return '';
  const battle = currentBattle(); const physical = inBattle && battle && isMassBattle(battle) ? battle.effectiveUnit(u) : u; const concealment = battle && concealmentLabel(battle.observationContext(), u);
  const pressure = inBattle && battle?.rules.resolutionVersion === 'v2' ? moraleLabel({ ...battle.observationContext(), units: battle.visibleCombatants('ally') }, u, reg) : '';
  const isActive = inBattle && state.small?.active?.id === u.id;
  const cls = [`unit`, u.side, u.status === 'dead' ? 'dead' : '', u.status === 'routing' ? 'routing' : '', u.status === 'fled' ? 'fled' : '', isActive ? 'active' : ''].join(' ');
  const statusWord = u.status === 'dead' ? ' †' : u.status === 'dying' ? ' ‼濒死' : u.status === 'routing' ? ' 溃逃中' : u.status === 'fled' ? ' 已撤离' : '';
  const morale = u.morale !== undefined ? ` 士气${u.morale}` : '';
  const fat = u.fatigue >= 2 ? ` 疲劳${Math.floor(u.fatigue)}` : '';
  const engage = u.engagedWith.length ? ' ⚔' : '';
  const pos = inBattle && u.pos !== undefined ? `｜阵位${u.pos}` : '';
  const marks = `${u.id === state.protagonistId ? '<span class="badge">★</span>' : ''}${u.side === 'ally' && u.id === state.commanderId ? '<span class="badge">⚑</span>' : ''}`;
  const seq = unitSeq(u);
  const encTag = !inBattle && state.encounterIds.has(u.id) ? '<span class="tag">遭遇</span>' : '';
  const prog = u.rulesVersion === 'v2' || u.scale !== 'mook' ? xpProgress(u) : null;
  let xpTxt = '';
  if ((u.rulesVersion === 'v2' || u.scale !== 'mook') && u.xp !== undefined && !inBattle) {
    xpTxt = prog ? `｜本级经验 ${xpLabel(prog.current)}/${prog.next}` : `｜累计经验 ${xpLabel(u.xp ?? 0)}（满级）`;
  }
  const rosterCtl = !inBattle
    ? `<details class="unit-tools"><summary>单位操作</summary><div class="row">
        ${u.side === 'ally' ? `<button data-action="roster-proto" data-id="${esc(u.id)}">${u.id === state.protagonistId ? '当前主控' : '设为主控'}</button><button data-action="roster-commander" data-id="${esc(u.id)}">${u.id === state.commanderId ? '当前指挥' : '设为指挥'}</button>` : ''}
        <button data-action="roster-del" data-i="${index}">移出参战名单</button>
      </div></details>`
    : '';
  const expanded = state.expandedUnits.has(u.id);
  return `<div class="${cls}" data-unit="${esc(u.id)}">
    <div class="nm">${marks}${esc(u.name)}${seq ? `<span class="seq">#${seq}</span>` : ''}${encTag}${statusWord}</div>
    <div class="st">${!inBattle && u.rulesVersion === 'v2' ? `${scaleLabel(u)} · 训练${u.level}${esc(enhancementLabel(u.bonuses))} · ${u.scale === 'hero' ? '生命' : '人数'} ${u.hp}/${u.base.hpMax}` : `等级${u.level}${u.archetype ? '·' + archName(u.archetype, true) : ''}｜${u.scale === 'hero' ? '生命' : '人数'} ${u.hp}/${u.base.hpMax}${morale}${fat}${engage}${pos}${isAirborne(physical) ? ' · 空中' : ''}${xpTxt}`}</div>
    ${hasMemberHealth(u)?`<div class="sub">${esc(strengthDescription(u))}</div>`:''}${woundedLabel(u) ? `<div class="sub">${esc(woundedLabel(u))}</div>` : ''}
    <div class="hpbar"><i style="width:${hpPct(u)}%"></i></div>
    ${prog ? `<div class="xpbar" title="本级经验 ${xpLabel(prog.current)}/${prog.next} · 累计${xpLabel(u.xp ?? 0)}"><i style="width:${Math.min(100, Math.round((prog.current / prog.next) * 100))}%"></i></div>` : ''}
    ${concealment ? `<div class="sub">${esc(concealment)}</div>` : ''}
    ${pressure ? `<div class="sub morale-pressure">${esc(pressure)}</div>` : ''}
    <div class="row" style="margin-top:2px"><button data-action="unit-detail" data-id="${esc(u.id)}">${expanded ? '收起详情' : '详情'}</button></div>
    ${expanded ? `<div class="unit-detail">${unitDetailHtml(u, battleFieldTags())}</div>` : ''}
    ${rosterCtl}
  </div>`;
}

/** 单位详情：属性 + 装备（含实际减伤）+ 技能 + 特质 + 环境修正 + 生成审计 */
function unitDetailHtml(u: Combatant, fieldTags: string[]): string {
  const rows: string[] = [];
  const modern=u.combatModel==='cohort-v2',protection=(channel:'kinetic'|'thermal'|'arcane')=>modern?anchoredProtection(u,channel):effectiveProtection(u,channel);
  if (u.tacticalPose) rows.push(`<div class="eq"><b>${esc(postureLabel(u, standardConditionMap())!)}</b> · 正面防御提高2，盾墙/拒马按实际装备与受击方式启用；侧后方可绕过</div>`);
  rows.push(`<div class="stat-grid">`);
  const atkPlus = u.base.atk >= 0 ? '+' + u.base.atk : u.base.atk;
  rows.push(`<span>攻 <b>${atkPlus}</b></span>`);
  rows.push(`<span>防 <b>${u.base.def}</b></span>`);
  rows.push(`<span>速 <b>${u.base.spd}</b></span>`);
  if(modern)rows.push(`<div class="sub">训练加成：命中／规避 +${trainingEdge(u.level)} · 输出 ×${trainingDamage(u.level).toFixed(2)}${u.bonuses?' · 单位强化'+esc(enhancementLabel(u.bonuses)):''}</div>`);
  rows.push(`<span>${u.scale === 'hero' ? '生命' : u.body==='vehicle'?'载具数':'人数'} <b>${u.hp}/${u.base.hpMax}</b></span>`);
  if(u.combatModel&&u.scale!=='hero')rows.push(`<span>单个${u.body==='vehicle'?'载具':'成员'}最大生命 <b>${memberDurability(u)}</b></span>`);
  if (u.base.moraleMax !== undefined) rows.push(`<span>士气 <b>${u.base.moraleMax}</b></span>`);
  if (woundedLabel(u)) rows.push(`<span>${esc(woundedLabel(u))}</span>`);
  if (u.rulesVersion === 'v2' && activeTraitIds(u).includes('regen')) rows.push(`<span>本次结算可再生 <b>${regenerationAmount(u, reg)}</b></span>`);
  rows.push(`</div>`);
  rows.push(memberHealthPanel(u));

  // 装备（武器/护甲，hero 刻度）
  if (u.weapon) {
    const atkTimes = u.weapon.attacks && u.weapon.attacks > 1 ? ` ×${u.weapon.attacks}` : '';
    const reload = u.weapon.reload ? ` 装填${u.weapon.reload}` : '';
    if(modern)rows.push(`<div class="eq"><b>武器</b> ${esc(u.weapon.name)} L${u.weapon.level??5}${esc(enhancementLabel(u.weapon.recipe?.bonuses))}：${esc(anchoredWeaponLabel(anchoredWeapon(u.weapon,u.cannonAmmo)))} · 格子射程${gridWeaponRange(u.weapon)}／会战${formationWeaponRange(u.weapon)}阵距${reload}</div>`);
    else rows.push(`<div class="eq"><b>武器</b> ${esc(u.weapon.name)}：${esc(u.weapon.baseDice)}${u.weapon.apDice ? ` +破甲${esc(u.weapon.apDice)}` : ''}｜射程${u.rulesVersion === 'v2' ? gridWeaponRange(u.weapon, false) + '格／会战' + (u.weapon.range ?? 0) + '阵距' : u.weapon.range ?? 0}${atkTimes}${reload}${u.rulesVersion === 'v2' ? ' · 穿透' + (u.weapon.penetration ?? 0) + ' · ' + ({ kinetic: '动能', thermal: '热能', arcane: '奥术' })[u.weapon.channel ?? 'kinetic'] : u.weapon.tags?.length ? '｜' + esc(u.weapon.tags.join(',')) : ''}</div>`);
  }
  if (u.armor) {
    if (u.armor.protection) {
      rows.push(`<div class="eq"><b>通道防护</b> L${u.armor.level??5}${esc(enhancementLabel(u.armor.recipe?.bonuses))} · 动能${protection('kinetic')} / 热能${protection('thermal')} / 奥术${protection('arcane')}${modern?' · 装甲等效耐久×'+Number(armorPowerScale(u).toFixed(2)):''} · 负重${u.armor.load ?? 0}</div>`);
    } else {
    const tierNames = ['无甲', '轻甲', '中甲', '重甲', '超重甲'];
    // 实际减伤 = (基础档+特质档修正，封顶4档) 表值 × 护甲效率，最终封顶 90%
    const rules = state.mass ? state.mass.rules : LITE_D20;
    const dr = Math.round(armorDR(u, rules, reg) * 100);
    let tierBonus = 0;
    for (const id of u.traits) {
      for (const e of reg.get(id)?.effects ?? []) if (e.kind === 'armorTier') tierBonus += e.value;
    }
    const overflow = (u.armor.tier ?? 0) + tierBonus > 4;
    const gapHint = (u.armor.tier ?? 0) > 0
      ? `<span class="dim">｜等级差压制：武器每低于护甲 1 级再 +4% 减伤（合计封顶 90%）</span>`
      : '';
    rows.push(`<div class="eq"><b>护甲</b> ${esc(u.armor.name)}：${tierNames[u.armor.tier] ?? u.armor.tier}档${u.armor.drScale && u.armor.drScale !== 1 ? `（效率×${u.armor.drScale}）` : ''}｜实际减伤 <b>${dr}%</b>${gapHint}${overflow ? '<span class="dim">（特质护甲加成超出4档上限，溢出无效）</span>' : ''}</div>`);
    }
  }
  if (u.trinkets?.length) {
    rows.push(`<div class="eq"><b>饰品</b> ${u.trinkets.map((t) => esc(t.name)).join('、')}</div>`);
  }

  // 技能
  if (u.abilities.length) {
    rows.push(`<b class="detail-label">技能</b>`);
    rows.push(`<div class="detail-list">${u.abilities.map((a) => `<div><b>${esc(a.name)}</b> L${a.power??5}${esc(enhancementLabel(a.bonuses))}${a.desc && (u.rulesVersion !== 'v2' || a.effectVersion) ? ` <span class="dim">${esc(a.desc)}</span>` : ''}${u.rulesVersion === 'v2' ? '<span class="dim"> · 已学 · ' + esc(abilityUsabilityReason(u, a) ?? '已准备可用') + (a.cost ? ' · ' + esc(resourceLabel(a.cost.resource)) + ' ' + a.cost.amount : '') + '</span>' : ''}</div>`).join('')}</div>`);
  }
  if (u.barrier) rows.push('<p class="sub">屏障剩余 '+u.barrier.remaining+' 点，可继续吸收伤害；剩余 '+u.barrier.duration+' 轮</p>');
  if (u.weapon?.recipe?.stabilized) rows.push('<div class="sub">车载行进稳定 · 移动射击免罚 · 仍须装填且可能遭近战借机</div>');
  if (u.rulesVersion === 'v2' && u.body && u.body !== 'human') rows.push(`<div class="sub">${({ large: '大型身体', giant: '巨型身体', vehicle: '车辆平台' })[u.body]} · 有效防护 ${protection('kinetic')}/${protection('thermal')}/${protection('arcane')}（动能/热能/奥术） · 负重容量${BODY[u.body].capacity}</div>`);
  if (looseFormation(u)) rows.push('<div class="sub">疏散队形 · 未接敌时范围暴露减半 · 近战展开减半、防御降低1；固守后收拢</div>');
  if (u.rulesVersion === 'v2') rows.push('<div class="sub">移动 ' + movementLabel(u, plannedFieldTags()) + ' · 基础速度' + (u.speedTier ?? BODY[u.body ?? 'human'].movement) + '档 · 精力 ' + (u.resources.SP ?? 0) + '/' + spCapacity(u) + '</div>');
  if(u.combatModel&&u.scale!=='hero')rows.push('<p class="sub">人数与成员耐久分别结算。参战规模随现员增长，地形与阵位限制展开；减员后火力同步下降。</p>');
  if(u.combatModel&&u.scale==='hero'&&u.moraleState?.damagePenalty)rows.push('<p class="sub">累计受创压力 '+u.moraleState.damagePenalty+'，影响本场士气；不溃能力免疫惊退。</p>');
  if (u.mount) rows.push('<div class="sub">骑乘 · 占格更大 · 机动提高 · 不增加人员或生命</div>');
  if (u.weapon?.recipe) rows.push(`<details><summary>装备属性</summary><div class="sub">训练${u.level} · 装备等级${u.weapon.recipe.power}${esc(enhancementLabel(u.weapon.recipe.bonuses))} · 体型${({human:'普通人形',large:'大型生物',giant:'巨型生物',vehicle:'车辆'})[u.body??'human']} · 品质${u.weapon.recipe.quality} · ${esc(WEAPON_CLASSES[u.weapon.recipe.mechanism]?.name ?? u.weapon.recipe.mechanism)} · 穿透${u.weapon.penetration} · 物品编号 ${esc(u.weapon.id)}</div></details>`);
  if (u.generationWarnings?.length) rows.push(`<details><summary>生成说明</summary><div class="sub">${u.generationWarnings.map(esc).join('；')}</div></details>`);

  // 特质
  const equipmentTraits = equipmentTraitIds(u);
  if (equipmentTraits.length) rows.push(`<div class="eq" data-role="equipment-traits"><b>装备自动特质</b> ${equipmentTraits.map(id => esc(reg.get(id)?.name ?? id)).join('、')} · 来自${esc(u.armor?.name ?? '护甲')}，卸下或更换后同步变化</div>`);
  const traitAdjustments = Object.entries(traitStatAdjustments(u, reg));
  if (traitAdjustments.length) rows.push(`<div class="eq"><b>当前特质修正</b> ${traitAdjustments.map(([key, value]) => `${({ atk: '攻击', def: '防御', spd: '先攻速度', morale: '士气' } as Record<string, string>)[key]}${value > 0 ? '+' : ''}${value}`).join(' · ')}（已用于行动预览与结算）</div>`);
  if (activeTraitIds(u).length) {
    const names = activeTraitIds(u).map((id) => reg.get(id)?.name ?? id).join('、');
    rows.push(`<div class="eq"><b>特质</b> ${esc(names)}</div>`);
    rows.push(`<details><summary>特质效果</summary>${activeTraitIds(u).map((id) => { const trait = reg.get(id); return `<div>${esc(trait?.name ?? id)}：${esc(trait ? traitDescription(trait, u) : '未知定义')}</div>`; }).join('')}</details>`);
  }
  if (u.traitSources?.length) {
    rows.push(`<div class="trait-sources" data-role="trait-sources">${u.traitSources.map((source) => {
      const active = traitSourceActive(u, source);
      const duration = source.revoked ? '已撤销' : source.duration.kind === 'permanent' ? '永久' : source.remaining! <= 0 ? '已到期' : `剩余${source.remaining}${source.duration.kind === 'rounds' ? '个战斗整轮' : '场战斗'}`;
      const effects = (source.conditionIds ?? []).map((id) => { const def = standardConditionMap().get(id); return `<div><b>${esc(def?.name ?? id)}</b>：${esc(def?.desc ?? '')}</div>`; }).join('');
      return `<div><b>${esc(source.name)}</b> · ${duration}${!active && !source.revoked && (source.remaining === undefined || source.remaining > 0) ? ' · 来源未装备' : ''}<div>${source.traitIds.map((id) => esc(reg.get(id)?.name ?? id)).join('、')}</div>${effects}${active && source.kind !== 'equipment' && !currentBattle() ? `<button data-action="trait-source-revoke" data-unit="${esc(u.id)}" data-source="${esc(source.id)}" data-revision="${state.factRevision}" data-context="${esc(controller.inventoryContext())}">解除此效果</button>` : ''}</div>`;
    }).join('')}</div>`);
  }

  // 环境修正（fieldMod 特质 × 当前战场环境）
  if (fieldTags.length) {
    const mods = fieldModsFor(u, fieldTags, reg);
    if (mods.length) {
      const parts = mods.map((m) => `${m.kind === 'atk' ? '攻' : m.kind === 'def' ? '防' : '士气'}${m.value > 0 ? '+' : ''}${m.value}`);
      rows.push(`<div class="eq"><b>环境</b> ${esc(fieldLabel(fieldTags))}：${parts.join('，')}</div>`);
    }
  }

  // 状态（战斗内）
  if (u.conditions.length) {
    rows.push(`<div class="eq"><b>状态</b> ${u.conditions.filter((c) => c.dur > 0).map((c) => esc(standardConditionMap().get(c.id)?.name ?? c.id) + ' ' + c.dur + '次').join('、')}</div>`);
  }

  // 生成审计
  if (u.genAudit) {
    rows.push(`<details><summary>生成计算依据</summary><div class="eq dim"><b>随机记录号</b> <code>${esc(u.genAudit.seed)}</code>${u.genAudit.deltas && Object.keys(u.genAudit.deltas).length ? `｜浮动：${esc(JSON.stringify(u.genAudit.deltas))}` : ''}</div></details>`);
  }
  return rows.join('');
}

/** 小规模战场一维轨道地图：pos 0~5，我方在左（0~2），敌方在右（3~5）。
 *  每个阵位格显示停在里面的单位（名字缩写）；正在行动者高亮。 */
function renderSmallMap(b: SmallBattle): string {
  const cellLabels = ['接战', '近距', '中距', '中距', '远距', '远距'];
  let cells = '';
  for (let pos = 0; pos <= 5; pos++) {
    const here = b.combatants.filter((c) => c.status !== 'dead' && c.status !== 'fled' && c.pos === pos);
    const unitsHere = here
      .map((u) => {
        const sideCls = u.side === 'ally' ? 'ally' : 'enemy';
        const activeCls = b.active?.id === u.id ? ' map-active' : '';
        const seq = unitSeq(u);
        return `<span class="map-unit ${sideCls}${activeCls}" data-unit="${esc(u.id)}" title="${esc(unitLabel(u))}｜生命 ${u.hp}/${u.base.hpMax}">${esc(u.name.slice(0, 3))}${seq ? '#' + seq : ''}</span>`;
      })
      .join(' ');
    const band = cellLabels[pos];
    cells += `<div class="map-cell"><div class="map-band">${band}${pos === 0 || pos === 5 ? '⛔' : ''}</div><div class="map-slot">${unitsHere || '—'}</div></div>`;
  }
  // 距离带图例（左右两军）
  const sideLegend =
    b.combatants.filter((c) => c.side === 'ally' && c.status !== 'dead').length > 0
      ? '<div class="map-side ally">我方（左）</div>'
      : '';
  return `<div class="map"><div class="map-track">${cells}</div><div class="map-sidebar">${sideLegend}<div class="map-side enemy">敌方（右）</div></div></div>`;
}

/** 军团分区地图：按 zone 分组显示各单位；当前接战（engagedWith）标记 ⚔，行动者高亮 */
function renderMassMap(b: MassBattle): string {
  if (b.rules.resolutionVersion === 'v2') return `<div class="formation-grid">${[...FORMATION_NODES].sort((a, b) => a.y - b.y || a.x - b.x).map((node) => `<div class="formation-node ${node.side}" data-formation="${node.id}"><b>${node.side === 'ally' ? '我方' : '敌方'} ${node.wing} · ${{ front: '前线', rear: '支援', reserve: '预备' }[node.rank]}</b>${b.visibleCombatants('ally').filter((u) => !b.isAttached(u.id) && u.status === 'ready' && formationNode(u).id === node.id).map((u) => `<button data-action="unit-detail" data-id="${esc(u.id)}">${u.side === 'ally' ? '我军' : '敌军'}${isAirborne(u) ? '空中' : ''} · ${esc(u.name)} ${u.hp}/${u.base.hpMax}${b.attached.get(u.id) ? ' · 随队' + esc(b.byId(b.attached.get(u.id)!).name) : ''}</button>`).join('') || '<span class="sub">' + (node.side === 'enemy' ? '未观测到部队' : '空位') + '</span>'}</div>`).join('')}</div><div class="sub">战线控制：${Object.entries(b.frontControl).map(([wing, side]) => `${wing} ${{ ally: '我方', enemy: '敌方', contested: '争夺', empty: '空缺' }[side]}`).join('｜')}</div>`;
  const zones = b.zones ?? ['中军'];
  const blocks = zones
    .map((z) => {
      const inZone = b.combatants.filter((c) => c.status !== 'dead' && c.status !== 'fled' && b.zoneOf(c) === z);
      const rankRows = ([['front', '前排'], ['rear', '后排'], ['reserve', '预备']] as const).map(([rank, rankName]) => {
        const unitsHere = inZone.filter((u) => b.rankOf(u) === rank).map((u) => {
          const sideCls = u.side === 'ally' ? 'ally' : 'enemy';
          const engage = u.engagedWith.length ? ' ⚔' : '';
          const deadCls = u.status === 'dead' ? ' dead' : '';
          const seq = unitSeq(u);
          return `<span class="map-unit ${sideCls}${deadCls}" data-unit="${esc(u.id)}" title="${esc(unitLabel(u))}｜兵力${u.hp}/${u.base.hpMax}${u.morale !== undefined ? ' 士气' + u.morale : ''}">${esc(u.name.slice(0, 3))}${seq ? '#' + seq : ''}${engage}</span>`;
        }).join(' ');
        return `<div class="map-band">${rankName}</div><div class="map-zone-slot">${unitsHere || '—'}</div>`;
      }).join('');
      return `<div class="map-zone"><div class="map-zone-name">${esc(z)}</div>${rankRows}</div>`;
    })
    .join('');
  return `<div class="map map-zones"><div class="map-track">${blocks}</div></div>`;
}

/** 参战单位区（可收起）：小规模/军团共用。同名单位靠 #序号 区分。 */
function renderUnitsBlock(unitsHtml: string, allyCount: number, enemyCount: number): string {
  return `
    <div class="gen-head" data-action="units-toggle">已知参战单位（我方 ${allyCount} · 已发现敌方 ${enemyCount}）<span class="gen-caret">${state.unitsOpen ? '▾' : '▸'}</span></div>
    ${state.unitsOpen ? `<div class="units">${unitsHtml || '<span class="sub">无参战单位</span>'}</div>` : ''}`;
}

/** 每轮战斗后的单位实时情况摊开（第 N 回合末状态）。b.isOver 时显示战后终态。 */
function roundSnapshotHtml(b: SmallBattle | MassBattle): string {
  const mass = isMassBattle(b);
  const header = b.isOver() ? '▼ 战后单位终态' : `▼ 第 ${b.round} 回合末 · 各单位实时情况`;
  const row = (u: Combatant): string => {
    const marks = `${u.id === state.protagonistId ? '★' : ''}${!mass && u.side === 'ally' && u.id === state.commanderId ? '⚑' : ''}`;
    const status = u.status !== 'ready' ? `｜${u.status === 'dead' ? '†倒下' : u.status === 'fled' ? '↩撤离' : u.status === 'routing' ? '溃逃' : u.status === 'dying' ? '濒死' : u.status}` : '';
    const engage = u.engagedWith.length ? '⚔' : '';
    let geo = '';
    if (mass) {
      const zb = b as MassBattle;
      const rank = zb.rankOf(u) === 'front' ? '前排' : zb.rankOf(u) === 'rear' ? '后排' : '预备队';
      geo = zb.zones ? `${zb.zoneOf(u)}·${rank}·` : `${rank}·`;
    } else {
      const sb = b as SmallBattle;
      const d = sb.distToNearestFoe(u) === Infinity ? 99 : sb.distToNearestFoe(u);
      geo = `距敌${bandLabel(d)}：`;
    }
    const morale = u.morale !== undefined ? ` 士气${u.morale}` : '';
    const hp = mass ? ` 兵力${u.hp}/${u.base.hpMax}` : ` 生命${u.hp}/${u.base.hpMax}`;
    const conds = u.conditions.length ? ` [${u.conditions.map((c) => c.id).join(',')}]` : '';
    const fatigue = u.fatigue >= 2 ? ` 疲劳${u.fatigue}` : '';
    return `<div class="snapshot-line"><b>${marks}${esc(u.name)}</b> <span class="dim">${geo}${u.side === 'ally' ? '我' : '敌'}${engage}${hp}${morale}${fatigue}${conds}${status}</span></div>`;
  };
  return `<div class="gen-head" data-action="snapshot-toggle">${header}<span class="gen-caret">${state.snapOpen ? '▾' : '▸'}</span></div>
    ${state.snapOpen ? `${(b.isOver() ? b.combatants : b.visibleCombatants('ally')).filter((c) => c.status !== 'dead').map(row).join('') || '<span class="sub">无存活单位</span>'}` : ''}`;
}

/** 距离/翼说明（常在提示，解释各类别的实际作用）。 */
function distanceLegendHtml(mass: boolean): string {
  const legend = mass
    ? `战前可为连队指定左/中/右翼与前排/后排/预备队。前排会掩护同翼后排和预备队；预备队需先前移才能参战。回合中可用「前移/后撤一列」或消耗 1CP 横移相邻翼；接战后需先撤退才能变阵。近战/冲锋只能打<b>同翼或相邻翼</b>的可及前线，远程齐射/魔法不受翼限制。`
    : `阵位 0~5：0=接战 1=近距 2~3=中距 4+=远距。每件武器/技能各有最小与最大射程；枪械和坦克炮可抵近射击但有命中惩罚，弓弩/间接火力仍有最小射程。距离≥2 可冲锋/撤离；后撤被贴身会吃借机攻击。移动只耗移动额度，之后仍可射击（通常 −2，骑射免疫）。`;
  return `<div class="sub" style="margin-top:2px">${legend}</div>`;
}

function bandLabel(d: number): string {
  return d <= 0 ? '接战' : d === 1 ? '近距' : d <= 3 ? '中距' : '远距';
}

function isMassBattle(b: SmallBattle | MassBattle): b is MassBattle {
  return (b as MassBattle).cp !== undefined;
}

/** 编制管理子界面：编制单位与战场遭遇（AI spawn 投放）分栏管理，可展开查看/编辑详细属性与装备。
 *  仅在非战斗时可用（战斗态单位是快照，不应就地改）。 */
function renderManage(): string {
  const promptSettings = controller.snapshot().promptSettings;
  const tierNames = ['无甲', '轻甲', '中甲', '重甲', '超重甲'];
  const catKeys = Object.keys(CATEGORY_LABELS) as Category[];
  const storedRecords = state.storage.filter((r) => !r.transient && visibleUnitRecord(r));
  const migrationWarning = state.unitMigrationWarnings.length
    ? `<div class="sub" style="color:var(--danger);margin:6px 0">⚠ 旧存档有 ${state.unitMigrationWarnings.length} 条单位数据未能完整迁移；原始条目已保留在迁移备份中。${state.unitMigrationWarnings.slice(0, 3).map((w) => `<div>${esc(w)}</div>`).join('')}</div>`
    : '';

  // ---------- 储存器条目编辑器（RosterUnit 全字段可改） ----------
  const storageRow = (r: RosterUnit): string => {
    const editing = state.editingUnit === r.id;
    if (editing && state.editingDraft) r = state.editingDraft;
    const isEditingSome = !!state.editingUnit;
    const line = `<div class="manage-row">
        <span class="tag ${r.side}">${r.side === 'ally' ? '我方' : '敌方'}</span>
        <b>${esc(r.name)}</b><label><input type="checkbox" data-role="prompt-unit" data-id="${esc(r.id)}" ${promptSelected(promptSettings, 'unit', r.id) ? 'checked' : ''}>发送给AI</label>
        <span class="dim">${scaleLabel({ scale: r.scale, rulesVersion: r.snapshot?.rulesVersion })}等级${r.level}${r.scale !== 'mook' || r.snapshot?.rulesVersion === 'v2' ? `·经验${r.xp ?? 0}` : ''}·${archName(r.archetype ?? 'infantry', true)}·攻${r.base.atk}防${r.base.def}速${r.base.spd}·${r.scale === 'hero' ? '生命' : '人数'}${r.hp}/${r.base.hpMax}${r.morale !== undefined ? `·士气${r.morale}/${r.base.moraleMax}` : ''}${r.status && r.status !== 'ready' ? `·${r.status}` : ''}${r.zone ? `·${r.zone}/${r.rank === 'rear' ? '后排' : r.rank === 'reserve' ? '预备队' : '前排'}` : ''}</span>
        <button data-action="storage-edit" data-id="${esc(r.id)}" ${isEditingSome && !editing ? 'disabled' : ''}>${editing ? '编辑中' : '编辑'}</button>
        ${r.snapshot?.rulesVersion !== 'v2' ? `<button data-action="unit-conversion-preview" data-id="${esc(r.id)}">预览V2更新规则</button>` : r.history?.at(-1)?.sourceId === 'mechanism-v2-conversion' ? `<button data-action="unit-conversion-undo" data-id="${esc(r.id)}">撤销刚才更新规则</button>` : ''}
        <span class="sub">${r.scale === 'hero' ? '生命' : '人数'}/${r.scale === 'hero' ? '生命上限' : '编制上限'}${woundedLabel(r) ? ' · ' + esc(woundedLabel(r)) : ''} · 档案版本 ${r.revision ?? 1} · 历史 ${r.history?.length ?? 0} 条${r.retired ? ' · 已解散' : ''}</span>
        <button data-action="storage-into" data-id="${esc(r.id)}" ${state.roster.some((u) => u.id === r.id) || r.retired || r.hp <= 0 || r.status === 'dying' ? 'disabled' : ''} title="加入本场参战队伍">${state.roster.some((u) => u.id === r.id) ? '已参战' : '→参战队伍'}</button>
        <button data-action="storage-del" data-id="${esc(r.id)}" class="danger" title="删除档案及参战引用，同时删除已装备的主武器、副武器、护甲和盾牌">直接删除（含已装备）</button>
      </div>`;
    if (!editing) return line;
    if (r.snapshot?.rulesVersion === 'v2' && builderEditDraft) return `${line}<div class="manage-edit">${unitForm('edit', builderEditDraft, reg, { editing: true, managed: r.equipmentManaged })}<div class="row"><button class="primary" data-action="storage-preview" data-id="${esc(r.id)}">预览修改</button><button data-action="manage-cancel-edit">取消编辑</button></div>${builderPreview?.record?.id === r.id ? buildPreview(builderPreview.unit, r.snapshot) : ''}</div>`;
    const skillRows = (r.skills ?? []).map((sk, j) => `<div class="row">
        ${r.snapshot?.rulesVersion === 'v2' ? `<label><input type="checkbox" data-role="s-prepared" data-j="${j}" ${r.preparedAbilityIds?.includes(sk.blueprintId ?? '') ? 'checked' : ''}>准备</label>` : ''}
        <select data-role="s-cat" data-j="${j}">${catKeys.map((c) => `<option value="${esc(c)}" ${sk.category === c ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('')}</select>
        <input type="text" data-role="s-name" data-j="${j}" value="${esc(sk.name ?? '')}" placeholder="技能名（可省略）" style="width:90px">
        <input type="number" data-role="s-lv" data-j="${j}" min="1" max="10" value="${sk.level ?? ''}" placeholder="L" style="width:44px">
        <span class="del" data-action="storage-skill-del" data-id="${esc(r.id)}" data-j="${j}" style="cursor:pointer">✕</span>
      </div>`).join('');
    const skillAdd = `<button data-action="storage-skill-add" data-id="${esc(r.id)}">＋技能</button>`;
    const traitOpts = traitCatalog(reg)
      .flatMap((g) => g.traits.map((t) => t))
      .map((t) => `<option value="${esc(t.id)}" ${(r.traits ?? []).includes(t.id) ? 'selected' : ''}>${t.name}</option>`)
      .join('') || '<option value="">（无特质）</option>';
    return `${line}<div class="manage-edit">
        <div class="row">
          <label>名称</label><input type="text" data-role="s-name0" value="${esc(r.name)}">
          <label>原型</label>
          <select data-role="s-arch">${(['infantry', 'ranged', 'mobile'] as const).map((a) => `<option value="${esc(a)}" ${r.archetype === a ? 'selected' : ''}>${archName(a)}</option>`).join('')}</select>
          <label>等级</label><input type="number" data-role="s-level" min="1" max="10" value="${esc(r.level)}" style="width:52px">
          <label>刻度</label>
          <select data-role="s-scale"><option value="hero" ${r.scale === 'hero' ? 'selected' : ''}>个体</option>${r.scale === 'mook' ? '<option value="mook" selected>编队（旧规则，待更新规则）</option>' : ''}<option value="company" ${r.scale === 'company' ? 'selected' : ''}>编队</option></select>
        </div>
        <div class="row">
          <label>攻</label><input type="number" data-role="s-atk" value="${esc(r.base.atk)}" style="width:52px">
          <label>防</label><input type="number" data-role="s-def" value="${esc(r.base.def)}" style="width:52px">
          <label>速</label><input type="number" data-role="s-spd" value="${esc(r.base.spd)}" style="width:52px">
          <label>${r.scale === 'hero' ? '当前生命' : '当前人数'}</label><input type="number" data-role="s-hp-current" min="0" value="${esc(r.hp)}" style="width:68px">
          <label>上限</label><input type="number" data-role="s-hp" min="1" value="${esc(r.base.hpMax)}" style="width:68px">
          <label>当前士气</label><input type="number" data-role="s-morale-current" min="0" value="${r.morale ?? ''}" placeholder="—" style="width:52px">
          <label>士气上限</label><input type="number" data-role="s-morale" min="1" value="${r.base.moraleMax ?? ''}" placeholder="—" style="width:52px">
          <label>状态</label><select data-role="s-status">${([['ready', '可战'], ['fled', '已撤离'], ['routing', '溃逃'], ['dying', '濒死']] as const).map(([v, n]) => `<option value="${esc(v)}" ${r.status === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <div class="row">
          <label>侧别</label><select data-role="s-side"><option value="ally" ${r.side === 'ally' ? 'selected' : ''}>我方</option><option value="enemy" ${r.side === 'enemy' ? 'selected' : ''}>敌方</option></select>
          <label>武器名</label><input type="text" data-role="s-weapon" value="${esc(r.weaponName ?? '')}" ${r.equipmentManaged ? 'readonly' : ''} placeholder="任意名字" style="width:90px">
          <label>武器类</label>
          <select data-role="s-wclass" ${r.equipmentManaged ? 'disabled' : ''}><option value="">（自动）</option>${(Object.keys(WEAPON_CLASSES) as string[]).map((k) => `<option value="${esc(k)}" ${r.weaponClass === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
          <label>武等级</label><input type="number" data-role="s-wlv" min="1" max="10" value="${r.weaponLevel ?? ''}" ${r.equipmentManaged ? 'readonly' : ''} placeholder="按等级" style="width:48px">
        </div>
        <div class="row">
          <label>护甲</label>
          <select data-role="s-armor" ${r.equipmentManaged ? 'disabled' : ''}>${tierNames.map((t, i) => `<option value="${esc(i)}" ${r.armorTier === i ? 'selected' : ''}>${t}</option>`).join('')}<option value="" ${r.armorTier === undefined ? 'selected' : ''}>（自动）</option></select>
          <label>甲等级</label><input type="number" data-role="s-alv" min="1" max="10" value="${r.armorLevel ?? ''}" ${r.equipmentManaged ? 'readonly' : ''} placeholder="按等级" style="width:48px">
        </div>
        ${r.equipmentManaged ? '<p class="sub">装备已由实物库存管理；在「配装与库存」更换或改造，可预览变化并保留原物品记录。</p>' : ''}
        <div class="eq dim">技能（类别·名·等级）：</div>
        ${r.snapshot?.rulesVersion === 'v2' ? `<label>随队预备份额（最多2）<input type="number" data-role="s-reserve" min="0" max="2" value="${r.snapshot.resources.reserve ?? 0}"></label>` : ''}
        ${skillRows || '<span class="sub">无技能</span>'}
        ${skillAdd}
        <div class="eq dim">特质：</div>
        <select data-role="s-traits" multiple size="3">${traitOpts}</select>
        <div class="row"><input type="text" data-role="s-note" value="${esc(r.note ?? '')}" placeholder="备注（可选）" style="flex:1;min-width:120px"></div>
        <div class="row">
          <button class="primary" data-action="storage-save" data-id="${esc(r.id)}">保存</button>
          <button data-action="manage-cancel-edit">取消</button>
          <span class="sub">改的是档案库档案；点「→编制」才作为上场单位。</span>
        </div>
      </div>`;
  };

  const storageBlock = storedRecords.length
    ? `<div class="manage-list">${storedRecords.map((r) => storageRow(r)).join('') || '<span class="sub">档案库为空——战斗中出现且未死的单位会自动存入</span>'}</div>`
    : '<span class="sub">档案库为空——战斗中出现且未死的单位会自动存入</span>';

  // ---------- 上场编制（roster）----------
  const rosterRow = (u: Combatant, i: number): string => {
    const marks = `${u.id === state.protagonistId ? '★' : ''}${u.side === 'ally' && u.id === state.commanderId ? '⚑' : ''}`;
    const seq = unitSeq(u);
    return `<div class="manage-row">
        <span class="tag ${u.side}">${u.side === 'ally' ? '我方' : '敌方'}</span>
        <b>${marks}${esc(u.name)}${seq ? ` <span class="seq">#${seq}</span>` : ''}</b>
        <span class="dim">${scaleLabel(u)}等级${u.level}·${u.scale === 'hero' ? '生命' : '人数'}${u.hp}/${u.base.hpMax}</span>
        ${u.scale === 'company' ? `<label>战区<select data-role="deploy-zone" data-unit="${esc(u.id)}" ${currentBattle() ? 'disabled' : ''}><option value="">自动</option>${(['左翼', '中军', '右翼'] as const).map((z) => `<option value="${esc(z)}" ${formationZone(u) === z ? 'selected' : ''}>${z}</option>`).join('')}</select></label><label>阵列<select data-role="deploy-rank" data-unit="${esc(u.id)}" ${currentBattle() ? 'disabled' : ''}>${([['front', '前排'], ['rear', '后排'], ['reserve', '预备队']] as const).map(([v, n]) => `<option value="${esc(v)}" ${(formationRank(u) ?? defaultRank(u)) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
        <button data-action="roster-del" data-i="${i}" class="danger">删除</button>
      </div>`;
  };
  const rosterBlock = state.roster.length
    ? `<div class="manage-list">${state.roster.filter(visibleUnitRecord).map(rosterRow).join('')}</div>`
    : '<span class="sub">编制为空——在「① 编制」生成，或从下方档案库点「→编制」加入。</span>';

  return `<section>
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">全部单位档案 <small class="sub">选择参战单位，或查看与编辑历史档案</small></h2>
    <button data-action="manage-toggle">${state.manageOpen ? '收起' : '展开'}</button></div>
    ${migrationWarning}
    ${state.manageOpen ? `<div>
      <div style="margin-top:6px"><b style="color:var(--dim)">当前参战（${state.roster.filter(visibleUnitRecord).length}）</b></div>
      <details><summary>调整当前参战名单</summary>${rosterBlock}</details>
      <div style="margin-top:12px"><b style="color:var(--dim)">全部档案（${storedRecords.length}）</b><div class="row"><button data-action="prompt-select-units" data-selected="true">发送全选</button><button data-action="prompt-select-units" data-selected="false">发送全不选</button><span class="sub">仅控制单位参考清单，不改变参战队伍；新单位默认选中。</span></div>
        <span class="sub">同一 id 保留装备、战损和经验；阵亡/解散留档，召唤不自动建档。分遣拆分尚不支持。</span></div>
      ${storageBlock}
    </div>` : '<span class="sub">点「展开」管理当前参战名单和全部单位档案。</span>'}
  </section>`;
}

/** 角色子界面：主控英雄(user)的等级/属性/经验/装备展示。
 *  数据源 = ★主控 hero 单位；未设主控时提示从编制选。升级沿用自动按曲线重算（不加点）。 */
function renderRole(): string {
  const hero = state.roster.find((u) => u.id === state.protagonistId && u.side === 'ally');
  if (!hero) {
    return `<section>
      <h2>👤 角色</h2>
      <span class="sub">在队伍的单位操作中设定主控后，可查看近况并发送给正文AI。</span>
    </section>`;
  }
  if (hero.rulesVersion === 'v2') {
    const current = currentBattle()?.combatants.find((u) => u.id === hero.id) ?? hero;
    const progress = xpProgress(hero), opened = state.expandedUnits.has('role:' + hero.id);
    return `<section class="role-overview"><h2>主角近况 <small>${esc(hero.name)}</small></h2><p>${current.scale === 'hero' ? '生命' : '人数'} ${current.hp}/${current.base.hpMax} · 训练${hero.level}${progress ? ' · 本级经验' + xpLabel(progress.current) + '/' + progress.next : ''} · 累计经验 ${xpLabel(hero.xp ?? 0)}</p><div class="row"><button data-action="role-detail" data-id="${esc(hero.id)}">${opened ? '收起详情' : '装备与状态'}</button><button data-action="role-inject">发送当前近况</button></div>${opened ? '<div class="role-details">' + unitDetailHtml(current, battleFieldTags()) + '</div>' : ''}</section>`;
  }
  const prog = xpProgress(hero);
  const xpLine = prog
    ? `本级经验 <b>${xpLabel(prog.current)}</b>/${prog.next}` + (hero.level < 10 ? `（距 ${xpLabel(prog.next - prog.current)} 升级）` : '')
    : `经验 <b>${hero.xp ?? 0}</b>（满级）`;
  const tierNames = ['无甲', '轻甲', '中甲', '重甲', '超重甲'];
  const equip = hero.weapon
    ? `<div class="eq"><b>武器</b> ${esc(hero.weapon.name)}：${esc(hero.weapon.baseDice)}${hero.weapon.apDice ? ` +破甲${esc(hero.weapon.apDice)}` : ''}｜射程${hero.weapon.range ?? 0}${hero.weapon.attacks && hero.weapon.attacks > 1 ? ` ×${hero.weapon.attacks}` : ''}${hero.weapon.reload ? ` 装填${hero.weapon.reload}` : ''}</div>`
    : '';
  const armor = hero.armor
    ? `<div class="eq"><b>护甲</b> ${esc(hero.armor.name)}（${tierNames[hero.armor.tier] ?? hero.armor.tier}档${hero.armor.drScale && hero.armor.drScale !== 1 ? ` 效率×${hero.armor.drScale}` : ''}）</div>`
    : '';
  const trinket = hero.trinkets?.length ? `<div class="eq"><b>饰品</b> ${hero.trinkets.map((t) => esc(t.name)).join('、')}</div>` : '';
  const conds = hero.conditions.length ? `<div class="eq"><b>状态</b> ${hero.conditions.map((c) => esc(c.id) + '(' + c.dur + ')').join('、')}</div>` : '';
  const traits = hero.traits.length ? `<div class="eq"><b>特质</b> ${esc(hero.traits.map((id) => reg.get(id)?.name ?? id).join('·'))}</div>` : '';
  const opened = state.expandedUnits.has(`role:${hero.id}`);
  return `<section>
    <h2>👤 角色 <small class="sub">主控 · ${esc(hero.name)}</small></h2>
    <div class="role-card">
      <div class="row" style="gap:12px">
        <div><span class="dim">等级</span> <b>等级${hero.level}</b></div>
        <div><span class="dim">${xpLine}</span></div>
      </div>
      <div class="stat-grid">
        <span>攻 <b>${hero.base.atk >= 0 ? '+' + hero.base.atk : hero.base.atk}</b></span>
        <span>防 <b>${hero.base.def}</b></span>
        <span>速 <b>${hero.base.spd}</b></span>
        <span>生命 <b>${hero.hp}/${hero.base.hpMax}</b></span>
        ${hero.base.moraleMax !== undefined ? `<span>士气 <b>${hero.base.moraleMax}</b></span>` : ''}
      </div>
      ${opened ? equip + armor + trinket + conds + traits : ''}
      <div class="row" style="margin-top:4px"><button data-action="role-detail" data-id="${esc(hero.id)}">${opened ? '收起装备状态' : '展开装备/状态'}</button>
      <button data-action="role-inject">发送角色状态 → 给AI</button></div>
    </div>
  </section>`;
}

/** 详细战报：把日志条目展开为完整数值管线（命中/伤害/护甲/倍率明细）。 */
function logDetailHtml(e: BattleLogEntry): string {
  const r = e.resolution;
  if (!r) return '';
  if(r.packetCount)return `<b>${esc(r.text)}</b><br><span class="dim">有效参战${r.participants?.toFixed(1)}人 · 各组损失：${r.packetRolls?.map(p=>p.damage).join(' / ')}；实际扣除以目标余量为上限</span>`;
  const lines: string[] = [];
  const head = `<b>${esc(r.attackerName)} → ${esc(r.defenderName)}</b>`;
  if (!r.hit) {
    const roll = r.attackRoll ? `d20[${r.attackRoll.kept.join(',')}]` : '';
    lines.push(`${head}：${roll}${r.netAtk >= 0 ? '+' : ''}${r.netAtk} vs 防御${r.targetDef} —— <b class="miss">未命中</b>`);
    if (r.atkDetail) lines.push(`<span class="dim">加值栈：${esc(r.atkDetail)}</span>`);
    return lines.join('<br>');
  }
  const rollPart = r.attackRoll
    ? `d20[${r.attackRoll.kept.join(',')}]${r.crit ? ' 暴击!' : ''}${r.netAtk >= 0 ? '+' : ''}${r.netAtk}=${r.attackRoll.total + r.netAtk} vs 防御${r.targetDef}`
    : `命中率${Math.round((r.hitChance ?? 0) * 100)}%`;
  lines.push(`${head}：${rollPart} —— <b class="hit">命中</b>`);
  lines.push(`<span class="dim">净攻${r.netAtk}｜目标防${r.targetDef}${r.drPercent ? `｜护甲减伤${r.drPercent}%` : ''}${r.dmgMult !== 1 ? `｜攻倍×${r.dmgMult}` : ''}${r.wardMult !== 1 ? `｜守护×${r.wardMult}` : ''}</span>`);
  if (r.baseRoll) lines.push(`<span class="dim">普通段 ${r.baseRoll.rolls.join('+')}${r.baseRoll.flat ? '+' + r.baseRoll.flat : ''} → 减伤后 ${r.baseAfterDR}</span>`);
  if (r.apRoll || r.apTotal > 0) lines.push(`<span class="dim">破甲段 ${r.apTotal}</span>`);
  lines.push(`<b>最终伤害 ${r.finalDamage}</b> → ${esc(r.defenderName)} 生命 ${r.hpBefore}→${r.hpAfter}`);
  return lines.join('<br>');
}

function renderSmall(): string {
  const b = state.small;
  if (!b) {
    return `<section><h2>② 小规模战斗</h2>
      <button class="primary" data-action="small-start" ${!rosterHasBothSides() ? 'disabled' : ''}>开始战斗（需双方编制）</button>
      <span class="sub">先攻 = d20+速度｜阵位 0~5：0=接战 1=近距 2~3=中距 4+=远距｜后撤被贴身会吃借机攻击｜距离≥2 可撤离</span>
    </section>`;
  }
  const over = b.isOver();
  const banner = over ? `<div class="banner ${b.winner() === 'ally' ? 'win' : 'lose'}">${b.winner() === 'ally' ? '⚔ 战斗胜利' : b.winner() === 'draw' ? '僵局' : '⚔ 战斗失败'}｜我方原始击杀经验 ${b.xpGained}（成长另行折算）</div>` : '';
  const act = b.active;
  const proto = act?.id === state.protagonistId;
  const foes = b.combatants.filter((c) => c.side !== act?.side && c.status !== 'dead' && c.status !== 'fled');
  const actionOptions = act ? b.getActionOptions(act.id) : [];
  const optionById = (id: string) => actionOptions.find((option) => option.id === id);
  const weaponOption = optionById('weapon');
  const sidearmOption = optionById('weapon:sidearm');
  const chargeOption = optionById('charge');
  const advanceOption = optionById('advance');
  const withdrawOption = optionById('withdraw');
  const retreatOption = optionById('retreat');
  const economy = act ? b.getTurnEconomy(act.id) : null;
  const selectedTargetId = foes.some((f) => f.id === state.smallTarget) ? state.smallTarget : foes[0]?.id ?? '';
  const selectedWeaponTarget = weaponOption?.targets?.find((candidate) => candidate.targetId === selectedTargetId);
  const selectedSidearmTarget = sidearmOption?.targets?.find((candidate) => candidate.targetId === selectedTargetId);
  const targetOpts = foes.map((f) => {
    const primary = weaponOption?.targets?.find((candidate) => candidate.targetId === f.id);
    const sidearm = sidearmOption?.targets?.find((candidate) => candidate.targetId === f.id);
    const preview = primary?.preview;
    const estimate = preview ? `｜命中≈${Math.round((preview.hitChance ?? 0) * 100)}%·期望伤害≈${(preview.expectedDamage ?? 0).toFixed(1)}` : '';
    const availability = primary?.enabled
      ? estimate
      : sidearm?.enabled
        ? `｜主武器不可：${primary?.reason ?? '不可用'}；副武器可用`
        : `｜不可攻击：${primary?.reason ?? sidearm?.reason ?? '没有合法武器'}`;
    return `<option value="${esc(f.id)}" ${selectedTargetId === f.id ? 'selected' : ''}>${esc(unitLabel(f, `（等级${f.level}·生命${f.hp}/${f.base.hpMax}）`))}（距${b.dist(act!, f)}${esc(availability)}）</option>`;
  }).join('');
  const abilityBtns = (act?.abilities ?? [])
    .map((a) => {
      const option = optionById(a.id);
      const title = [a.desc, option?.reason].filter(Boolean).join('｜');
      return `<button data-action="small-ability" data-id="${esc(a.id)}" ${option?.enabled ? '' : 'disabled'} title="${esc(title)}">${esc(a.name)}</button>`;
    })
    .join(' ');
  const units = b.combatants.map((u, i) => unitHtml(u, i, true)).join('');
  const alive = b.visibleCombatants('ally').filter((c) => c.status !== 'dead' && c.status !== 'fled');
  const allyCount = alive.filter((c) => c.side === 'ally').length;
  const enemyCount = alive.filter((c) => c.side === 'enemy').length;
  const envTag = b.fieldTags.length ? `｜🌐 ${esc(fieldLabel(b.fieldTags))}` : '';
  return `<section>
    <h2>② 小规模战斗 ${over ? '（已结束）' : `· 第${b.round}回合`}${envTag}</h2>
    ${banner}
    ${renderSmallMap(b)}
    ${renderUnitsBlock(units, allyCount, enemyCount)}
    ${roundSnapshotHtml(b)}
    ${distanceLegendHtml(false)}
    ${over
      ? `<div class="row"><button class="primary" data-action="battle-close">收兵并清理战场</button>
          <span class="sub">战果先保存，阵亡保留历史档案；收兵后仍可发送归档战报。</span></div>`
      : `<div class="row">
           <span>行动：<b style="color:var(--gold)">${esc(act ? unitLabel(act) : '-')}${proto ? '（主控）' : ''}</b></span>
           <span class="tag">移动 ${economy?.moveAvailable ? '可用' : '已用'}｜主行动 ${economy?.actionAvailable ? '可用' : '已用'}</span>
           <select data-role="small-target">${targetOpts || '<option value="">（无目标）</option>'}</select>
           <button class="primary" data-action="small-attack" ${selectedWeaponTarget?.enabled ? '' : 'disabled'} title="${esc(selectedWeaponTarget?.reason ?? '使用主武器攻击所选目标')}">主武器·${esc(act?.weapon?.name ?? '攻击')}</button>
           ${act?.sidearm ? `<button data-action="small-sidearm" ${selectedSidearmTarget?.enabled ? '' : 'disabled'} title="${esc(selectedSidearmTarget?.reason ?? '明确切换副武器攻击所选目标')}">副武器·${esc(act.sidearm.name)}</button>` : ''}
           <button data-action="small-charge" ${chargeOption?.enabled ? '' : 'disabled'} title="${esc(chargeOption?.reason ?? '消耗移动与主行动：贴至目标并造成攻击伤害')}">冲锋</button>
          ${abilityBtns}
        </div>
        <div class="row">
           <button data-action="small-move" data-dir="advance" ${advanceOption?.enabled ? '' : 'disabled'} title="${esc(advanceOption?.reason ?? '消耗移动额度，不消耗主行动')}">◀ 前进</button>
           <button data-action="small-move" data-dir="withdraw" ${withdrawOption?.enabled ? '' : 'disabled'} title="${esc(withdrawOption?.reason ?? '消耗移动额度，不消耗主行动')}">后撤 ▶</button>
           <button data-action="small-retreat" ${retreatOption?.enabled ? '' : 'disabled'} title="${esc(retreatOption?.reason ?? '与所有敌人距离≥2；消耗主行动')}">撤离战场</button>
          <button data-action="small-endturn">结束回合</button>
          <button data-action="small-auto-act" title="引擎替当前行动者自动选择目标并行动（自动选目标）">🤖 自动行动</button>
          <label><input type="checkbox" data-role="auto-turn" ${state.autoTurn ? 'checked' : ''}> 友军自动战斗（自动选目标代打）</label>
        </div>
        <div class="sub">先攻顺序：${b.turnOrder.map((id) => esc(unitLabel(b.byId(id)))).join(' → ')}｜移动后射击 −2（骑射免疫）</div>`}
  </section>`;
}

function abilityTargetLabel(a: Ability): string {
  return { enemy: '敌方单位', ally: '友方单位', self: '自己', zone: '战区' }[a.target] ?? a.target;
}

function abilityEffectLabel(a: Ability): string[] {
  return a.effects.map((e) => {
    switch (e.op) {
      case 'damage': if (a.damageBasis) return `${a.damageBasis === 'shield' ? '以实际盾牌' : a.weaponUse ? '以实际选用武器' : '以当前近战武器'}结算，受技能强度和装备威力共同限制${e.shape === 'burst' ? '，范围内分配可用上限' : ''}`; return `伤害：普通 ${e.baseDice}${e.apDice ? ` + 破甲 ${e.apDice}` : ''}${e.shape === 'burst' ? '（范围）' : ''}`;
      case 'trait': return `${reg.get(e.traitId)?.name ?? e.traitId}持续至多${e.dur}轮，战斗归档时结束`;
      case 'zone': return `在指定位置形成持续区域，半径${e.radius}格，持续${e.dur}轮`;
      case 'barrier': return `屏障吸收${e.amount}点伤害，持续${e.dur}轮`;
      case 'heal': return `恢复生命或可救伤兵：${e.amount ?? e.dice}，以实际可恢复量为上限`;
      case 'condition': return `${e.onDamage ? '造成损伤后' : e.onHit ? '命中后' : ''}施加${standardConditionMap().get(e.conditionId)?.name ?? e.conditionId}${e.potency ? '，效果强度' + e.potency : ''}${e.magnitude !== undefined ? '，效力' + Math.round(e.magnitude * 100) + '%' : ''}，持续 ${e.dur} 次状态结算${e.saveDC ? '，目标可以抵抗' : ''}`;
      case 'push': return `${e.onHit ? '命中后' : ''}尝试${e.direction === 'towards' ? '拉近' : '推开'}目标一格，受体量、稳固姿态和落点限制`;
      case 'dispel': return `最多解除${e.count}项${e.polarity === 'negative' ? '负面' : '有益'}效果；实物和已发生伤亡保持`;
      case 'resource': return `${resourceLabel(e.resource)}变化： ${e.amount >= 0 ? '+' : ''}${e.amount}`;
      case 'morale': return `士气 ${e.amount >= 0 ? '+' : ''}${e.amount}`;
      case 'summon': return /^conjured:(10|[1-9])$/.test(e.templateId) ? `召唤临时造物 L${e.templateId.split(':')[1]} ×${e.count}，下一轮行动` : `召唤：${e.templateId} ×${e.count}`;
    }
  });
}

function abilityTargets(actor: Combatant, ability: Ability, b: SmallBattle | MassBattle): Combatant[] {
  if (!isMassBattle(b)) {
    const option = b.getActionOptions(actor.id).find((item) => item.id === ability.id);
    const validIds = new Set(option?.targets?.filter((target) => target.enabled).map((target) => target.targetId) ?? []);
    if (ability.target === 'zone') return [];
    return b.combatants.filter((unit) => validIds.has(unit.id));
  }
  if (b.rules.resolutionVersion === 'v2') return b.combatants.filter((u) => !b.abilityOrderReason(actor.id, ability.id, u.id));
  if (ability.target === 'self') return [actor];
  if (ability.target === 'ally') {
    return b.combatants.filter((u) => u.side === actor.side && u.status !== 'dead' && u.status !== 'fled');
  }
  if (ability.target === 'enemy' || ability.target === 'zone') {
    return b.combatants.filter((u) => u.side !== actor.side && u.status !== 'dead' && u.status !== 'fled');
  }
  return [];
}

function renderAbilityDialog(): string {
  const d = state.abilityDialog;
  if (!d) return '';
  const b = d.battle === 'small' ? state.small : state.mass;
  if (!b) return '';
  const actor = b.visibleCombatants('ally').find((u) => u.id === d.actorId);
  const ability = actor?.abilities.find((a) => a.id === d.abilityId);
  if (!actor || !ability) return '';
  const runtime = actor.abilityState.find((s) => s.abilityId === (ability.cooldownGroup ?? ability.id));
  const targets = abilityTargets(actor, ability, b);
  const smallOption = d.battle === 'small'
    ? (b as SmallBattle).getActionOptions(actor.id).find((item) => item.id === ability.id)
    : undefined;
  const selected = targets.some((u) => u.id === d.suggestedTargetId)
    ? d.suggestedTargetId
    : ability.target === 'self' ? actor.id : targets[0]?.id;
  const targetSelect = ability.target === 'self'
    ? `<span class="tag">${esc(unitLabel(actor))}</span>`
    : targets.length
      ? `<select data-role="ability-confirm-target">${targets.map((u) => {
          const distance = d.battle === 'small' ? `·距${(b as SmallBattle).dist(actor, u)}` : `·${(b as MassBattle).zoneOf(u)}/${(b as MassBattle).rankOf(u) === 'front' ? '前排' : (b as MassBattle).rankOf(u) === 'rear' ? '后排' : '预备队'}`;
          return `<option value="${esc(u.id)}" ${u.id === selected ? 'selected' : ''}>${esc(unitLabel(u, `（生命${u.hp}/${u.base.hpMax}${distance}）`))}</option>`;
        }).join('')}</select>`
      : '<span class="tag">无需选择</span>';
  const resource = ability.cost ? `${ability.itemSourceId ? '物品剩余/消耗' : resourceLabel(ability.cost.resource)} ${actor.resources[ability.cost.resource] ?? 0}/${ability.cost.amount}` : '无消耗';
  const massV2 = isMassBattle(b) && b.rules.resolutionVersion === 'v2';
  const unavailable = massV2 ? b.abilityOrderReason(actor.id, ability.id, selected) : smallOption?.reason;
  const recoveryTarget = targets.find((u) => u.id === selected);
  const effectPreview = massV2 ? b.orderPreview({ unitId: [...b.attached].find(([, id]) => id === actor.id)?.[0] ?? actor.id, type: 'ability', abilityActorId: actor.id, abilityId: ability.id, targetId: selected }) : smallOption?.targets?.find((t) => t.targetId === selected)?.preview;
  const strikePreview = effectPreview && 'preview' in effectPreview ? effectPreview.preview : effectPreview;
  const damagePreview = strikePreview && 'expectedDamage' in strikePreview && strikePreview.expectedDamage !== undefined ? `<div class="damage-preview">主目标伤害期望 ${strikePreview.expectedDamage.toFixed(1)}${effectPreview?.areaTargets?.length ? ' · 波及' + effectPreview.areaTargets.map(esc).join('、') : ''}</div>` : '';
  const healingPreview = effectPreview?.healing;
  const moralePreview = effectPreview?.moraleAfter === undefined ? '' : `<div class="morale-preview">预计有效士气 ${effectPreview.moraleBefore} → ${effectPreview.moraleAfter}${effectPreview.rallyChance !== undefined ? '，基础重整成功率' + Math.round(effectPreview.rallyChance * 100) + '%，仍需合法空位' : '，惊退风险' + Math.round((effectPreview.breakChance ?? 0) * 100) + '%'}</div>`;
  const recoveryPreview = healingPreview === undefined ? '' : `<div class="recovery-preview">预计恢复${recoveryTarget?.scale === 'hero' ? '生命' : '可救伤兵'} ${healingPreview}${recoveryTarget?.scale !== 'hero' ? '，不会补回其余缺员' : ''}</div>`;
  const confirmation = massV2 ? '编入本轮主任务' : '确认释放';
  const uses = ability.itemSourceId ? '次数受携行余量限制' : ability.usesPerBattle === undefined ? '不限次数' : `剩余 ${Math.max(0, ability.usesPerBattle - (runtime?.used ?? 0))}/${ability.usesPerBattle}`;
  const rangeSpec = smallOption?.range ?? ability.range;
  const range = rangeSpec
    ? rangeSpec.metric === 'global' ? '全战场' : rangeSpec.metric === 'self' ? '自身' : `${rangeSpec.min}~${rangeSpec.max} ${massV2 ? '阵距' : '格'}`
    : '兼容射程';
  return `<div class="modal-backdrop" data-action="ability-cancel">
    <div class="modal-card" data-action="modal-stop">
      <h2>${confirmation}：${esc(ability.name)}</h2>
      ${ability.desc && (actor.rulesVersion !== 'v2' || ability.effectVersion) ? `<div class="sub">${esc(ability.desc)}</div>` : ''}
      <div class="row"><span class="tag">使用者：${esc(unitLabel(actor))}</span><span class="tag">目标：${abilityTargetLabel(ability)}</span><span class="tag">射程：${range}</span>${ability.itemSourceId ? '' : `<span class="tag">冷却：${runtime?.cdLeft ?? 0}/${ability.cooldown ?? 0}</span>`}</div>
      <div class="effect-list">${abilityEffectLabel(ability).map((x) => `<div>▸ ${esc(x)}</div>`).join('')}</div>
      <div class="row"><b>选择目标</b>${targetSelect}</div>
      ${damagePreview}${recoveryPreview}${moralePreview}${effectPreview?.effects?.length ? '<div class="effect-preview">' + effectPreview.effects.map(esc).join('<br>') + '</div>' : ''}
      <div class="sub">资源：${esc(resource)}｜${uses}${unavailable ? `｜不可用：${esc(unavailable)}` : ''}${massV2 ? '｜支援阶段执行时扣费，占用所属编队唯一主任务' : ''}</div>
      <div class="row"><button class="primary" data-action="ability-confirm" ${unavailable || smallOption && !smallOption.enabled ? 'disabled' : ''}>${confirmation}</button><button data-action="ability-cancel">取消</button></div>
    </div>
  </div>`;
}

function massOrderPreviewText(b: MassBattle, order: Order): string {
  const result = b.orderPreview(order);
  if (result.reason) return '不可下达：' + result.reason;
  const unit = b.byId(order.unitId);
  const fatigueUnit = order.type === 'ability' && order.abilityActorId ? b.byId(order.abilityActorId) : unit;
  const exertion = (order.type === 'charge' ? 2 : ['hold', 'brace', 'retreat'].includes(order.type) ? 0 : 1) + (result.extraFatigue ?? 0);
  const fatigue = fatigueAfter(fatigueUnit, exertion) - fatigueUnit.fatigue;
  const cost = `占用编队本轮任务${fatigue ? ` · ${fatigueUnit.id !== unit.id ? '使用者' : ''}疲劳${fatigue > 0 ? '+' : ''}${fatigue}` : ''}`;
  const place = (node: typeof FORMATION_NODES[number]) => `${node.side === 'ally' ? '我方' : '敌方'}${node.wing}${{ front: '前线', rear: '支援', reserve: '预备' }[node.rank]}`;
  if (result.destination) return `${cost} · 到达${place(result.destination)}${result.layer === 'air' ? '空域' : '地面'}（阶段状态与容量变化可能调整路径）${result.reactions?.length ? ' · 起飞可能遭' + result.reactions.join('、') + '借机' : ''}`;
  if (result.moraleAfter !== undefined) return `${cost} · 有效士气${result.moraleBefore}→${result.moraleAfter}${result.rallyChance !== undefined ? ' · 基础重整成功率' + Math.round(result.rallyChance * 100) + '%' : ' · 惊退风险' + Math.round((result.breakChance ?? 0) * 100) + '%'}`;
  if (result.healing !== undefined) return `${cost} · 预计恢复${result.healing}，以目标可恢复生命或伤兵为上限`;
  const fall = result.fallDamage !== undefined ? ` · ${result.fallChance !== undefined && result.fallChance < 1 ? '迫降概率' + Math.round(result.fallChance * 100) + '%' : '将迫降'}，额外坠落损失至多${result.fallDamage}${result.forcedLanding ? '，预计落点' + place(result.forcedLanding) : '，已知范围无落点，预计撤出'}` : '';
  return result.preview ? `${cost}${result.weaponName ? ' · 使用' + result.weaponName : ''}${result.approach && !result.landing ? ' · 冲锋接近至' + place(result.approach) : ''}${result.vehicleMove ? ' · 短移至' + place(result.vehicleMove) + '稳定射击' + (result.reactions?.length ? '，可能遭' + result.reactions.join('、') + '借机' : '') : ''}${result.withdrawal ? ' · 自动后撤至' + place(result.withdrawal) + '射击' : ''}${result.landing ? ' · 先降落至' + place(result.landing) + '扑击' : ''} · 单次命中${Math.round(result.preview.hitChance * 100)}% · 主目标伤害期望${result.preview.expectedDamage.toFixed(1)}${result.preview.onHit ? ' · ' + result.preview.onHit : ''}${result.areaTargets?.length ? ' · 波及' + result.areaTargets.join('、') : ''}${result.effects?.length ? ' · ' + result.effects.join('；') : ''}${fall}（阶段行动可能改变结果）` : cost + fall + (result.effects?.length ? ' · ' + result.effects.join('；') : '');
}

function renderMass(): string {
  const b = state.mass;
  if (b?.rules.resolutionVersion === 'v2') return renderFormationBattle(b, formationView, state.orderDraft, massAutoCommand(), (u) => unitDetailHtml(u, battleFieldTags()), massOrderPreviewText);
  if (!b) {
    return `<section><h2>② 军团会战</h2>
      <button class="primary" data-action="mass-start" ${!rosterHasBothSides() ? 'disabled' : ''}>开战（需双方编制）</button>
      <span class="sub">连队 hp=兵员数｜指挥点限制冲锋/撤退｜主控非指挥官时军令自动下达</span>
    </section>`;
  }
  const over = b.isOver();
  const v2 = b.rules.resolutionVersion === 'v2';
  const banner = over ? `<div class="banner ${b.winner() === 'ally' ? 'win' : 'lose'}">${b.winner() === 'ally' ? '⚔ 会战大捷' : b.winner() === 'draw' ? '两败俱伤' : '⚔ 会战失利'}｜我方原始击杀经验 ${b.xpGained}（成长另行折算）</div>` : '';
  const units = b.combatants.map((u, i) => unitHtml(u, i, true)).join('');
  const alive = b.visibleCombatants('ally').filter((c) => c.status !== 'dead' && c.status !== 'fled');
  const allyCount = alive.filter((c) => c.side === 'ally').length;
  const enemyCount = alive.filter((c) => c.side === 'enemy').length;
  const auto = massAutoCommand();
  const autoReason = !b.manualCommandAllowed ? v2 ? '指挥者或随队编队当前无法下令' : '主帅倒下，指挥点减半' : '主控非指挥官（士兵视角）';
  const orderLines = b.combatants
    .filter((u) => u.side === 'ally' && u.status === 'ready' && !(b.rules.resolutionVersion === 'v2' && b.isAttached(u.id)))
    .map((u) => {
      const zone = b.zones ? b.zoneOf(u) : '';
      // 翼门禁：近战/冲锋目标限同翼或相邻翼（远程/齐射单位可看全部）。这里过滤选项，避免玩家选中被 issue 拒。
      const foes = b.visibleCombatants('ally').filter((f) => f.side === 'enemy' && f.status === 'ready').filter((f) => !v2 || !b.isAttached(f.id));
      const targetable = !v2 && b.zones && !isRangedCapable(u)
        ? foes.filter((f) => b.canMeleeReach(u, f))
        : foes;
      const existing = b.orders.get(u.id);
      // 预选优先级：本回合已下现令 → 未提交草稿 → 上次命令记忆
      const draft = state.orderDraft[u.id];
      const mem = v2 ? b.previousOrders.get(u.id) ?? state.orderMemory[u.id] : state.orderMemory[u.id];
      const selType = draft?.type ?? existing?.type ?? mem?.type;
      const selTarget = draft?.targetId ?? existing?.targetId ?? mem?.targetId;
      const foeOpts = targetable
        .map((f) => `<option value="${esc(f.id)}" ${selTarget === f.id ? 'selected' : ''}>${esc(unitLabel(f, `（等级${f.level}·兵${f.hp}/${f.base.hpMax}）`))}</option>`)
        .join('');
      // 军团技能按钮（支援阶段手动释放）：目标取本行的军令目标下拉；冷却/次数尽灰禁
      const skillSources = [u, ...(v2 ? b.combatants.filter((h) => h.id === b.attached.get(u.id)) : [])];
      const skillBtns = `<span>${skillSources.flatMap((source) => source.abilities.map((a) => {
            const st = source.abilityState.find((s) => s.abilityId === (a.cooldownGroup ?? a.id));
            const cd = st?.cdLeft ?? 0;
            const usedOut = a.usesPerBattle !== undefined && (st?.used ?? 0) >= a.usesPerBattle;
            const reason = v2 ? abilityUsabilityReason(source, a) ?? (existing ? '所属编队已有主任务，请先撤回' : undefined) : cd > 0 || usedOut ? '冷却或次数耗尽' : undefined;
            return `<button data-action="mass-ability" data-unit="${esc(source.id)}" data-id="${esc(a.id)}" ${reason ? 'disabled' : ''} title="${esc(reason ?? a.desc ?? '')}">${source.id !== u.id ? esc(source.name) + ' · ' : ''}${esc(a.name)}${cd > 0 ? `⏱${cd}` : ''}</button>`;
          })).join('')}</span>`;
      return `<div class="orderline">
        <b>${u.id === state.protagonistId ? '★' : ''}${esc(unitLabel(u))}</b>
        <select data-role="order-type" data-unit="${esc(u.id)}">
          ${['attack', 'charge', 'volley', 'hold', 'brace', 'retreat', 'rank-forward', 'rank-back', 'shift-left', 'shift-right', ...(v2 && (hasFlightAbility(u) || isAirborne(u)) ? [isAirborne(u) ? 'land' : 'takeoff'] : [])].map((t) => `<option value="${esc(t)}" ${selType === t ? 'selected' : ''}>${orderName(t)}</option>`).join('')}
        </select>
        <select data-role="order-target" data-unit="${esc(u.id)}"><option value="">目标…</option>${foeOpts}</select>
        <button data-action="order-issue" data-unit="${esc(u.id)}">下达</button>
        ${skillBtns}
        ${existing ? `<span class="tag">已令：${orderName(existing.type)}${existing.targetId ? '→' + esc(unitLabel(b.byId(existing.targetId))) : ''}</span> <button data-action="order-revoke" data-unit="${esc(u.id)}">撤回</button>` : ''}
        ${v2 ? `<span class="sub order-preview">${esc(massOrderPreviewText(b, draft ? { unitId: u.id, ...draft } : existing ?? { unitId: u.id, type: selType ?? 'attack', targetId: selTarget }))}</span>` : ''}
      </div>`;
    })
    .join('');
  const protoUnit = state.protagonistId ? b.combatants.find((c) => c.id === state.protagonistId) : undefined;
  const alreadyAttached = state.protagonistId ? [...b.attached.values()].includes(state.protagonistId) : false;
  const attachable = protoUnit && protoUnit.scale === 'hero' && protoUnit.status === 'ready' && !alreadyAttached;
  const companies = b.combatants.filter((c) => c.side === 'ally' && c.scale === 'company' && c.status === 'ready' && !b.attached.get(c.id));
  const attachCtl = attachable && companies.length
    ? `<div class="row"><span class="sub">主控嵌入连队（攻击+1，随队征战）：</span>
        <select data-role="attach-target">${companies.map((c) => `<option value="${esc(c.id)}">${esc(unitLabel(c))}</option>`).join('')}</select>
        <button data-action="mass-attach">嵌入</button></div>`
    : '';
  const envTag = b.fieldTags.length ? `｜🌐 ${esc(fieldLabel(b.fieldTags))}` : '';
  return `<section>
    <h2>② 军团会战 ${over ? '（已结束）' : v2 ? `· 第${b.round}轮｜每编队一个主任务` : `· 第${b.round}回合｜我方指挥点 <span class="cp">${b.cp.ally}</span>｜敌方 <span class="cp">${b.cp.enemy}</span>`}${envTag}</h2>
    ${banner}
    ${b.rules.resolutionVersion === 'v2' ? `<div class="mass-controls"><button data-action="mass-orders-auto">自动军令（只补空缺）</button><button class="primary" data-action="mass-resolve" data-round="${b.round}" ${over ? 'disabled' : ''}>锁定并执行第${b.round}轮</button><span class="sub">${b.lastPhases.join(' → ') || '计划 → 支援 → 机动 → 交战 → 重整'}</span></div>` : ''}
    ${renderMassMap(b)}
    ${renderUnitsBlock(units, allyCount, enemyCount)}
    ${roundSnapshotHtml(b)}
    ${v2 ? '<div class="sub">阵位所有权固定；距离按图中相邻阵位计算。随队人物的技能占用所在编队的主要行动；区域伤害最多覆盖相邻2支编队。</div>' : distanceLegendHtml(true)}
    ${over
      ? `<div class="row"><button class="primary" data-action="battle-close">收兵并清理战场</button>
          <span class="sub">战果先保存，阵亡保留历史档案；收兵后仍可发送归档战报。</span></div>`
      : auto
        ? `<div class="flexgrid">
          <div><h2 style="font-size:12px;color:var(--dim)">我方军令（自动）</h2>
            <div class="sub">⚠ ${autoReason}。${v2 ? '可行动编队执行系统生成的合法军令；恢复指挥资格后可手动下令。' : '军令由上级自动下达，玩家以士兵视角参战，无法手动布阵'}</div>
            ${attachCtl}
          </div>
          <div><h2 style="font-size:12px;color:var(--dim)">快捷</h2>
            ${v2 ? '' : '<div class="row"><button class="primary" data-action="mass-resolve">执行回合（自动列阵）</button></div>'}
            <div class="sub">自动列阵：远程齐射 / 机动冲锋 / 近战攻击；骑射连队被冲锋时先手反击齐射</div>
          </div>
        </div>`
        : `<div class="flexgrid">
        <div><h2 style="font-size:12px;color:var(--dim)">我方指令</h2>
          <div class="row">
            <button class="primary" data-action="mass-orders-all" title="把下方所有单位的下拉选择一次性全部下达（未选的自动跳过）">一键下达所有安排</button>
            <button data-action="mass-orders-memory" title="按每支单位上次的指令一键重发（目标阵亡自动换目标）">一键下令（按记忆）</button>
            <button data-action="mass-orders-auto" title="引擎启发式：远程齐射/机动冲锋/近战攻击，火力分散">自动军令（引擎）</button>
            <label><input type="checkbox" data-role="auto-orders" ${state.autoAllyOrders ? 'checked' : ''}> 每回合自动下令（记忆优先）</label>
          </div>
          ${orderLines || '<span class="sub">无可用单位</span>'}</div>
        <div><h2 style="font-size:12px;color:var(--dim)">敌方快捷</h2>
          ${v2 ? '' : '<div class="row"><button class="primary" data-action="mass-resolve">执行回合</button></div>'}
          <div class="sub">执行回合时敌我未下令单位都会自动补齐军令（敌方：齐射/冲锋/攻击最近目标，受翼位限制）</div>
        </div>
      </div>`}
  </section>`;
}

function orderName(t: string): string {
  const label = {
    ability: '技能任务', takeoff: '起飞', land: '降落',
    attack: '攻击', charge: '冲锋(1CP)', volley: '齐射', hold: '待命', brace: '固守', retreat: '撤退(1CP)',
    'rank-forward': '前移一列', 'rank-back': '后撤一列', 'shift-left': '向左翼转移(1CP)', 'shift-right': '向右翼转移(1CP)',
  }[t] ?? t;
  return state.mass?.rules.resolutionVersion === 'v2' ? label.replace('(1CP)', '') : label;
}

/** 翼相邻判定（面板层）：同翼或相邻翼才可被近战/冲锋攻击；远程/齐射不受限。 */
function zoneOfNear(b: MassBattle, a: Combatant, v: Combatant): boolean {
  const zones = b.zones;
  if (!zones) return true;
  const za = b.zoneOf(a);
  const zb = b.zoneOf(v);
  if (za === zb) return true;
  const ai = zones.indexOf(za);
  const bi = zones.indexOf(zb);
  if (ai < 0 || bi < 0) return true;
  // 相邻：索引差 ≤1（首尾不相邻，除非 zones 只有2个且跨接也算相邻）
  if (Math.abs(ai - bi) <= 1) return true;
  // 两翼循环（只有左/右两翼时互为相邻）
  return zones.length === 2;
}

/** 战后经验结算区（战斗结束时显示） */
function renderXp(): string {
  const b = currentBattle();
  if (!b || !b.isOver()) return '';
  const awards = battleXpAwardsForBothSides(b.combatants, b.xpByUnit, {
    winner: b.winner(), initialStrength: b.xpInitialStrength,
    commanderId: state.mass ? state.mass.commanderId : state.commanderId,
  });
  if (!awards.length) return '';
  const rows = awards
    .map((a) => `<div class="orderline"><b>${a.side === 'enemy' ? '敌方' : '我方'} · ${esc(a.name)}</b> 原始击杀${a.kills} + 参战${a.participation}${a.command ? ` + 指挥${a.command}` : ''}${a.startMembers !== undefined ? `<br>合计${a.rawTotal} ÷ ${a.populationBasis === 'capacity' ? '旧战编制基数' : '开战实到'}${a.startMembers} × 存活比例${xpLabel((a.survivalRatio ?? 0) * 100)}%（${a.survivingMembers}/${a.startMembers}）` : ''} = <span class="cp">${xpLabel(a.total)} 成长经验</span></div>`)
    .join('');
  return `<section>
    <h2>③ 经验结算</h2>
    ${rows}
    <div class="row">${state.xpSettled ? '<span class="sub">双方成长经验已入账，本场不会重复结算。</span>' : '<button class="primary" data-action="xp-settle">双方经验入账（写回档案）</button>'}
    <label><input type="checkbox" data-role="auto-settle" ${state.autoSettleXp ? 'checked' : ''}> 战后自动入账（自动升级）</label>
    <span class="sub">敌我分别计奖；参战份额按开战人数分配（胜15%/败5%），主指挥胜利+25%。编队总额÷开战实到人数×存活比例，个体直接入账；保留小数经验。</span></div>
  </section>`;
}

/** 构造【战阵·角色状态】+【战场存活单位】注入文案：给 AI 每次回复前看的上下文 */
function buildContextInject(): string {
  const lines: string[] = [];
  const hero = state.roster.find((u) => u.id === state.protagonistId);
  if (hero) {
    const prog = xpProgress(hero);
    const xpS = prog ? `本级${xpLabel(prog.current)}/${prog.next}，累计${xpLabel(hero.xp ?? 0)}` : `${xpLabel(hero.xp ?? 0)}（满级）`;
    const eq: string[] = [];
    if (hero.weapon) eq.push(`武器：${hero.weapon.name}(${hero.weapon.baseDice}${hero.weapon.apDice ? '+破甲' + hero.weapon.apDice : ''})`);
    if (hero.armor) eq.push(`护甲：${hero.armor.name}(${hero.armor.tier}档)`);
    if (hero.trinkets?.length) eq.push(`饰品：${hero.trinkets.map((t) => t.name).join('、')}`);
    lines.push(`【战阵·角色状态】name=${hero.name}（等级${hero.level}）`);
    lines.push(`属性：攻${hero.base.atk}/防${hero.base.def}/速${hero.base.spd}/生命${hero.hp}/${hero.base.hpMax}｜经验 ${xpS}`);
    if (eq.length) lines.push(`装备：${eq.join('；')}`);
    if (hero.traits.length) lines.push(`特质：${hero.traits.map((id) => reg.get(id)?.name ?? id).join('、')}`);
  } else {
    lines.push('【战阵·角色状态】（尚未设主控，无玩家角色视角）');
  }
  const b = currentBattle();
  const alive = b
    ? (b.isOver() ? b.combatants : b.visibleCombatants('ally')).filter((c) => c.status !== 'dead' && c.status !== 'fled')
    : state.lastBattleUnitIds
        .map((id) => state.storage.find((r) => r.id === id))
        .filter((r): r is UnitRecord => !!r && r.status !== 'dead' && r.status !== 'fled')
        .map((r) => materializeUnitRecord(r, reg, { era: state.era }));
  if (alive.length) {
    lines.push('【战场存活单位】');
    for (const u of alive) {
      const side = u.side === 'ally' ? '我' : u.side === 'enemy' ? '敌' : '中立';
      const mark = u.id === state.protagonistId ? '【主控】' : '';
      lines.push(`- ${mark}${u.name}（${side}·${scaleLabel(u)}等级${u.level}）${u.scale === 'hero' ? '生命' : '人数'} ${u.hp}/${u.base.hpMax}${woundedLabel(u) ? '｜' + woundedLabel(u) : ''}${u.status !== 'ready' ? '｜' + u.status : ''}`);
    }
  } else {
    lines.push('【战场存活单位】无');
  }
  return lines.join('\n');
}

/** 战报先作为 user 消息插入；原生模式只有用户另行点击发送才生成回复。 */
async function sendToAi(text: string, label: string, reportId?: string, batch?: NarrativeBatch): Promise<void> {
  const historical=state.reports.find(r=>r.id===(reportId??batch?.battleId));
  if(historical?.supersededBy)text='【已被重战替代的历史战报：仅供对照，不代表当前战果】\n'+text;
  text = applySettlementPrompt(text, controller.snapshot().promptSettings);
  if (!text) { toast(`暂无可发送的${label}`); return; }
  const identity = adapter.identity();
  const namespace = adapter.namespace();
  const report = !batch && reportId ? state.reports.find((r) => r.id === reportId) : undefined;
  const prior = report?.deliveries[label];
  const deliveryId = (batch ? state.reportDeliveries[batch.battleId]?.receipts[batch.key]?.deliveryId : prior?.deliveryId) ?? crypto.randomUUID();
  if (prior && ['sent', 'inserted', 'unknown', 'sending'].includes(prior.status)) {
    toast('此战报已发送或投递结果待核对；不会盲目重发'); return;
  }
  const deliveryBefore = batch ? structuredClone(state.reportDeliveries) : undefined;
  if (batch) { try { beginNarrativeDelivery(state.reportDeliveries, batch); } catch (error) { toast(error instanceof Error ? error.message : String(error)); return; } }
  if (batch) state.reportDeliveries[batch.battleId]!.receipts[batch.key]!.deliveryId = deliveryId;
  if (report) report.deliveries[label] = { status: 'sending', deliveryId };
  if (!(await persist())) {
    if (deliveryBefore) state.reportDeliveries = deliveryBefore;
    if (report) report.deliveries[label] = { status: 'failed', detail: '发送前保存失败' };
    toast('未保存，尚未发送；请先重试保存'); return;
  }
  const receipt = await adapter.sendAsUser(text, { deliveryId, ...(runtime.native ? { generate: false } : {}) }).catch((error): DeliveryReceipt => ({status:'failed',detail:String(error),deliveryId}));
  if (identity !== adapter.identity() || namespace !== adapter.namespace()) return;
  // 等待宿主期间，正文通知可能已通过restore替换全部UI副本；按稳定id更新当前战报。
  const currentReport = report && (state.reports.find((r) => r.id === report.id) ?? (state.deletedReport?.report.id===report.id?state.deletedReport.report:undefined));
  if (currentReport) currentReport.deliveries[label] = receipt;
  if (batch) finishNarrativeDelivery(state.reportDeliveries, batch, receipt);
  const saved = (await persist());
  const words: Record<DeliveryReceipt['status'], string> = {
    sent: '已发送给 AI', inserted: '已作为用户消息放入聊天；请手动点击发送' , copied: '已复制，需手动粘贴发送',
    unknown: '投递结果未知，请核对聊天后处理', failed: '发送失败，可重试', sending: '发送中',
  };
  render();
  toast(`${label}${words[receipt.status]}${saved ? '' : '；回执未保存'}`);
}

/** AI 建议待审队列 + 物品清单 */
function renderPending(): string {
  const items = state.pending
    .map((s, i) => `<div class="orderline"><span class="tag">${suggestionLabel(s)}</span> ${esc(suggestionDesc(s))}
      <button data-action="pending-approve" data-i="${i}">批准</button>
      <button data-action="pending-reject" data-i="${i}">拒绝</button></div>`)
    .join('');
  const invalid = state.lastInvalid.length
    ? `<div class="sub" style="color:var(--danger)">无法解析的标签（已忽略）：${state.lastInvalid.map((t) => esc(t)).join(' ')}</div>`
    : '';
  return `<section>
    <h2>④ 旧协议待审记录</h2>
    <div class="row">
      <button data-action="pending-scan">扫描最新回复</button>
      <span class="sub">旧存档待确认内容仅供人工核查；新回复统一走下方剧情档案同步。</span>
    </div>
    ${items || '<span class="sub">没有旧协议待审记录</span>'}
    ${invalid}
  </section>`;
}

function narrativeEditor(p: NarrativeProposal): string {
  if (p.status === 'committed' || state.proposals.some((other) => other.sourceKey === p.sourceKey && other.status === 'committed')) return '';
  return '<details data-detail-id="narrative-edit-' + esc(p.id) + '"><summary>修正事件草稿</summary>'
    + '<p class="sub">可直接补改标签，或只保留已识别部分；重新解析后先预览，再确认入账。原聊天正文保持。</p>'
    + '<textarea data-role="narrative-draft" data-id="' + esc(p.id) + '" aria-label="事件草稿" rows="6" style="box-sizing:border-box;width:100%;resize:vertical">' + esc(narrativeDrafts.get(p.id) ?? p.source.text) + '</textarea>'
    + '<div class="row"><button data-action="narrative-correct" data-id="' + esc(p.id) + '">重新解析草稿</button>'
    + (p.status === 'unresolved' && p.events.length ? '<button data-action="narrative-recognized" data-id="' + esc(p.id) + '">草稿只保留已识别部分</button>' : '') + '</div></details>';
}
function renderNarrativeProposals(): string {
  const labels: Record<NarrativeProposal['status'], string> = { pending: '待确认', committed: '已同步', stale: '已过期', legacy: '需核对来源', failed: '未保存', rejected: '已忽略', unresolved: '待补全' };
  const unresolved = state.proposals.filter((p) => !['committed', 'rejected'].includes(p.status)).slice().reverse();
  const history = state.proposals.filter((p) => ['committed', 'rejected'].includes(p.status)).slice(-12).reverse();
  const proposal = (p: NarrativeProposal) => `<div class="narrative-proposal" data-proposal="${esc(p.id)}"><span class="tag">${labels[p.status]}</span>
    <p>${p.events.map((e) => esc(suggestionDesc(e))).join('；')}</p>${p.corrected ? '<p class="sub">本地修正草稿，原聊天未修改。</p>' : ''}${p.reason ? '<p class="grid-reason">' + esc(p.reason) + '</p>' : ''}
    ${p.notices?.length ? '<details><summary>识别与格式整理说明</summary><p class="sub">' + p.notices.map(esc).join('；') + '</p></details>' : ''}
    <div class="row">${['pending', 'failed'].includes(p.status) ? '<button class="primary" data-action="narrative-approve" data-id="' + esc(p.id) + '">' + (p.events.some((e) => e.kind === 'spawn' || e.kind === 'deploy') ? '确认入库并上场' : '确认本批变更') + '</button>' : ''}
    ${narrativeDeploymentIds({ proposals: state.proposals, storage: state.storage }, p.id).some((id) => !state.roster.some((u) => u.id === id)) ? '<button class="primary" data-action="narrative-restore-roster" data-id="' + esc(p.id) + '">恢复本批参战单位</button>' : ''}
    ${['legacy', 'stale'].includes(p.status) ? '<button data-action="narrative-rebind" data-id="' + esc(p.id) + '">重新预览</button>' : ''}
    ${!['committed', 'rejected'].includes(p.status) ? '<button data-action="narrative-reject" data-id="' + esc(p.id) + '">忽略本次</button>' : ''}
    <button data-action="narrative-delete" data-id="${esc(p.id)}" title="删除此记录；已同步的档案保持，重复扫描不会再次入账">删除记录</button></div>
    <details><summary>查看事件块</summary><pre>${esc(p.source.text)}</pre></details>${narrativeEditor(p)}</div>`;
  return `<section class="narrative-sync">${unresolved.length ? '<h2>剧情带来的变化 <small>' + unresolved.length + '项待处理</small></h2>' : '<details data-detail-id="narrative-settings"><summary>剧情同步 · ' + (state.storySync ? '自动同步已启用' : '手动确认') + ' · 没有待处理变更</summary>'}
    <label><input type="checkbox" data-role="story-sync" ${state.storySync ? 'checked' : ''}>自动同步明确的战外单位修改与部署</label>
    <div class="sub">${controller.capabilities.beforeGeneration && controller.capabilities.generationEnded ? '关闭面板后仍保持联动。新单位、物品与能力先在这里确认。' : '当前酒馆未连接完整生成事件，请手动扫描并核对变更。'}${controller.capabilities.injection ? '' : '当前酒馆暂不支持自动提供战斗记录。'}</div>
    ${unresolved.length ? unresolved.map(proposal).join('') : '<p class="sub">没有待处理变更。</p>'}
    <details class="narrative-history" data-detail-id="narrative-history"><summary>同步记录与手动扫描</summary><div class="row"><button data-action="narrative-scan">扫描最新完整回复</button><button data-action="narrative-delete">清理已处理记录</button></div><p class="sub">删除记录不撤销已同步档案。事件修正后可重新扫描。</p>${history.map(proposal).join('')}</details>${unresolved.length ? '' : '</details>'}
  </section>`;
}

function suggestionLabel(s: Suggestion): string {
  return { take: '减少物品', learn: '学习技能', give: '掉落', reforge: '装备改造', bless: '明确祝福', unbless: '撤销祝福', affect: '增减益', unaffect: '解除效果', status: '状态', xp: '经验', field: '环境', spawn: '遭遇', deploy: '选择编制', 'unit-update': '编制更新', 'unit-set': '完整单位修改' }[s.kind];
}

function suggestionDesc(s: Suggestion): string {
  const unitName = (id?: string, name?: string) => { const record = storageRecordByRef(id, name); return record && visibleUnitRecord(record) ? record.name : name ?? '指定单位'; };
  switch (s.kind) {
    case 'take': return `减少物品「${s.id}」×${s.qty}${s.note ? '——' + s.note : ''}`;
    case 'give': return `获得物品「${s.item}」×${s.qty}${s.spec ? ' · ' + itemSpecificationLabel(s.spec) : ' · 叙事记录'}${s.note ? `——${s.note}` : ''}`;
    case 'learn': return `${unitName(s.id)} 学习或更新：${s.skills.map((skill) => (skill.name ?? ABILITY_BLUEPRINTS[skill.blueprintId]?.name ?? skill.blueprintId) + (skill.level === undefined ? '' : ' L' + skill.level)).join('、')}；其余记录保留`;
    case 'reforge': return `改造「${s.name ?? state.inventory.find((i) => i.id === s.id)?.name ?? '指定装备'}」为 ${itemSpecificationLabel(s.spec)}`;
    case 'bless': return `${unitName(s.id)} 获得「${s.name}」：${s.traitIds.map((id) => reg.get(id)?.name ?? id).join('、')} · ${s.duration.kind === 'permanent' ? '永久' : s.duration.count + (s.duration.kind === 'rounds' ? '个战斗整轮' : '场战斗')}`;
    case 'unbless': return `${unitName(s.id)} 撤销指定祝福来源（保留永久特质）`;
    case 'affect': return `${unitName(s.id)} 获得「${s.name}」：${s.conditionIds.map((id) => standardConditionMap().get(id)?.name ?? id).join('、')} · ${s.duration.kind === 'permanent' ? '永久' : s.duration.count + (s.duration.kind === 'rounds' ? '个战斗整轮' : '场战斗')}`;
    case 'unaffect': return `${unitName(s.id)} 解除指定效果来源（保留其他来源与永久特质）`;
    case 'status': return `${unitName(s.target)} 获得状态【${standardConditionMap().get(s.conditionId)?.name ?? s.conditionId}】${s.dur} 回合`;
    case 'xp': return `剧情经验 +${s.amount} 经验${s.reason ? `（${s.reason}）` : ''}`;
    case 'field': return `战场环境设为「${FIELD_LABELS[s.env] ?? s.env}${s.light === 'night' && s.env !== 'night' ? ' / 夜间' : ''}」（开战时生效）${s.note ? `——${s.note}` : ''}`;
    case 'deploy': return `让${unitName(s.id, s.name)}参战`;
    case 'unit-set': return `${unitName(s.id)}：${JSON.stringify(s.data)}${s.reason ? `（${s.reason}）` : ''}`;
    case 'unit-update': return `${unitName(s.id, s.name)}：${[
      s.hp !== undefined ? `当前兵力=${s.hp}` : '', s.hpMax !== undefined ? `上限=${s.hpMax}` : '',
      s.morale !== undefined ? `士气=${s.morale}` : '', s.state ? `状态=${s.state}` : '',
      s.clear?.length ? `解除=${s.clear.join('、')}` : '',
    ].filter(Boolean).join('，')}${s.reason ? `（${s.reason}）` : ''}`;
    case 'spawn': {
      const wep = 'weaponName' in s ? (s.weaponName ?? s.weapon) : undefined;
      const arm = 'armorName' in s ? (s.armorName ?? s.armor) : undefined;
      return `新增 ${s.name}×${s.count}（训练${s.level}${s.scale ? '·' + scaleLabel({ scale: s.scale, rulesVersion: 'v2' }) : ''}${wep ? `·${wep}` : ''}${arm ? `·${arm}` : ''}${s.skills?.length ? `·技能×${s.skills.length}` : ''}）`;
    }
  }
}

function storageRecordByRef(id?: string, name?: string): RosterUnit | undefined {
  if (id) return state.storage.find((r) => r.id === id);
  if (!name) return undefined;
  const hits = state.storage.filter((r) => r.name === name);
  return hits.length === 1 ? hits[0] : undefined;
}

function clearConditions(conditions: { id: string; dur: number }[], clear: string[]): { id: string; dur: number }[] {
  if (clear.some((x) => x === 'all' || x === '全部')) return [];
  const ids = new Set(clear.map((x) => STANDARD_CONDITIONS.find((c) => c.id === x || c.name === x)?.id ?? x));
  return conditions.filter((c) => !ids.has(c.id));
}

function deployStorageRecord(r: RosterUnit): boolean {
  requireArchiveWritable();
  const added = !state.roster.some((u) => u.id === r.id);
  state.roster = deployUnitRecord(state.storage, state.roster, r.id, reg);
  state.mode = autoScaleMode();
  return added;
}

function applyUnitUpdate(s: Extract<Suggestion, { kind: 'unit-update' }>): void {
  requireArchiveWritable();
  const stored = storageRecordByRef(s.id, s.name);
  if (!stored) throw new Error(`找不到唯一档案「${s.id ?? s.name}」`);
  const clear = s.clear?.map((id) => STANDARD_CONDITIONS.find((c) => c.id === id || c.name === id)?.id ?? id);
  const next = updateUnitRecord(stored, { ...s, clear }, reg);
  state.storage = state.storage.map((r) => r.id === stored.id ? next : r);
  state.roster = state.roster.filter((u) => u.id !== stored.id || next.hp > 0)
    .map((u) => u.id === stored.id ? materializeStorageUnit(next) : u);
}

function renderLog(): string {
  const report=reportForOutput();
  return renderReportWorkspace(currentBattle(), state.reports, state.selectedReportId, state.reportDeliveries, renderLogEntries, {
    promptSettings:controller.snapshot().promptSettings,
    start:state.activeBattleStart,
    restartReason:report?reportRestartReason(controller.snapshot(),report):undefined,
    restartPreview:reportRestartPreview?.id===report?.id?reportRestartPreview:undefined,
    canUndo:!!state.deletedReport,
    native: runtime.native,
    deletedCurrent:!!currentBattle()&&!!state.deletedReportIds?.includes(battleIdOf(currentBattle()!)),
  });
}

/** 渲染日志：每条一行 + 可展开的完整数值管线明细（有 resolution 的才给详情按钮） */
function renderLogEntries(b: SmallBattle | MassBattle): string {
  const visibleLog = b.isOver() ? b.log : b.visibleLog('ally');
  const entries = visibleLog.slice(-40);
  if (!entries.length) return '（暂无记录）';
  const startIdx = visibleLog.length - entries.length;
  return entries
    .map((l, i) => {
      const idx = startIdx + i;
      const hasDetail = !!l.resolution;
      const expanded = state.expandedLog.has(idx);
      const roundTag = l.kind === 'round' ? ` <span class="tag round">${esc(l.text)}</span>` : '';
      // 非战斗日志行（回合分隔、布阵、先攻）只展示原文
      if (!hasDetail) {
        return `<div class="logline${l.kind === 'round' ? ' roundline' : ''}">${esc(l.text)}${roundTag}</div>`;
      }
      return `<div class="logline">
        <span class="logline-main">${esc(l.text.split('\n')[0] ?? '')}</span>
        <button data-action="log-detail" data-i="${idx}">${expanded ? '收起' : '明细'}</button>
        ${expanded ? `<div class="log-detail">${logDetailHtml(l)}</div>` : ''}
      </div>`;
    })
    .join('\n');
}

// ---------- 事件 ----------

async function handleAction(e: Event): Promise<void> {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  const act = el.dataset.action!;
  if (act === 'llm-stop') { llmContext.cancel(); toast('已取消上下文读取'); render('battle'); return; }
  if (['llm-models'].includes(act)) { try { await actions[act]!(el); } catch (error) { toast(String(error)); } return; }
  // Navigation never joins the durable-write queue or alters its failure flag.
  if (act === 'workspace-tab') {
    const tab = el.dataset.tab;
    if (WORKSPACES.some(([id]) => id === tab)) { workspaceTab = tab as WorkspaceTab; showWorkspace(workspaceTab); render('none'); }
    return;
  }
  if (act === 'theme-toggle') { const theme = document.body.dataset.theme === 'light' ? 'dark' : 'light'; document.body.dataset.theme = theme; runtime.setTheme?.(theme); return; }
  if (act === 'grid-pan') { document.querySelector('.grid-camera')?.scrollBy({ left: Number(el.dataset.dx) * 180, behavior: 'auto' }); return; }
  if (act === 'grid-focus') { battleCamera.focus(document.querySelector<HTMLElement>('.grid-cell.selected') ?? undefined); return; }
  if (act === 'modal-stop') return;
  if ((await inventoryPanel.handleAction(el))) return;
  battleSaveFailed = false;
  if (act === 'save-retry') { await actions[act]?.(el); render(); return; }
  if(['report-delete','report-restore','report-restart','report-restart-cancel','report-restart-confirm'].includes(act)) {
    try {
      if(act==='report-restart') {
        const report=state.reports.find(r=>r.id===el.dataset.id);if(!report)throw Error('战报不存在');
        const reason=reportRestartReason(controller.snapshot(),report);if(reason)throw Error(reason);
        reportRestartPreview={id:report.id,revision:state.factRevision,namespace:adapter.namespace()};
      } else if(act==='report-restart-cancel')reportRestartPreview=undefined;
      else {
        const review=reportRestartPreview;
        if(act==='report-restart-confirm'&&(!review||review.id!==el.dataset.id||review.namespace!==adapter.namespace()||review.revision!==Number(el.dataset.revision)))throw Error('重战预览已经过期');
        const receipt=act==='report-delete'?(await controller.deleteBattleReport(el.dataset.id!)):act==='report-restore'?(await controller.restoreBattleReport()):(await controller.restartBattleReport(review!.id,review!.revision,randomSeed()));
        state.saveReceipt=receipt;if(receipt.status==='failed')throw Error(receipt.error??'未保存，本次操作未生效');
        if(act==='report-restart-confirm') {
          reportRestartPreview=undefined;state.abilityDialog=null;
          Object.assign(tacticalView,{selectedId:state.small?.active?.id,targetId:undefined,cell:undefined,inspectedCell:undefined,mode:'weapon'});
          Object.assign(formationView,{selectedId:undefined,inspectedId:undefined,nodeId:undefined});
          workspaceTab='battle';showWorkspace('battle');
          if(state.small)(await runAuto());(await persist());toast('已恢复原开局，重战结果将替换原战果');
        } else toast(act==='report-delete'?'战报已删除，可撤销；已入账战果保留':'战报已恢复');
      }
    } catch(error) { toast(error instanceof Error?error.message:String(error)); }
    render('view');return;
  }
  if (act === 'formation-command-focus') {
    document.querySelector('.formation-command')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (['formation-unit', 'formation-select-actor', 'formation-cell'].includes(act)) {
    const b = state.mass;
    if (!b || b.rules.resolutionVersion !== 'v2') return;
    const before = JSON.stringify(state.orderDraft), editable = !massAutoCommand() && !b.isOver() && !b.planningLocked;
    try {
      if (act !== 'formation-cell') selectFormationUnit(b, formationView, state.orderDraft, el.dataset.id!, editable, act === 'formation-select-actor');
      else {
        const node = FORMATION_NODES.find((n) => n.id === el.dataset.node);
        if (node) {
          formationView.nodeId = node.id;
          const selected = formationSelection(b, formationView, state.orderDraft);
          const move = selected.choices.flatMap((c) => c.targets).find((t) => !t.id && t.preview.destination?.id === node.id && ['rank-forward', 'rank-back', 'shift-left', 'shift-right'].includes(t.order.type));
          if (editable && selected.actor && move) state.orderDraft[selected.actor.id] = orderDraft(move.order);
        }
      }
      if (JSON.stringify(state.orderDraft) !== before) { render('view'); (await persist()); }
    } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
    render('view'); return;
  }
  if (['unit-detail', 'role-detail', 'log-detail', 'units-toggle', 'manage-toggle', 'section-toggle', 'ability-cancel', 'unit-conversion-preview', 'unit-conversion-cancel'].includes(act)) {
    try { (await actions[act]?.(el)); } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
    render(); return;
  }
  if (act === 'narrative-review') {
    workspaceTab = 'units'; showWorkspace(workspaceTab); render('none');
    const history = document.querySelector<HTMLDetailsElement>('.narrative-history');
    if (history) { history.open = true; history.scrollIntoView({ block: 'nearest' }); }
    return;
  }
  if (['gen-add', 'gen-toggle', 'storage-edit', 'storage-preview', 'manage-cancel-edit', 'builder-skill-add', 'builder-skill-remove', 'builder-cancel-preview', 'builder-confirm'].includes(act)) {
    try { if (act === 'builder-confirm') (await commitBuilder()); else (await actions[act]?.(el)); } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
    render(); return;
  }
  if (['grid-cell', 'grid-inspect-unit', 'grid-mode'].includes(act)) {
    if (state.small?.battlefield) {
      const query = selectTacticalElement(state.small, tacticalView, act === 'grid-cell' ? { cell: Number(el.dataset.cell) }
        : act === 'grid-mode' ? { mode: el.dataset.mode } : { unitId: el.dataset.unit });
      render('view', query);
    }
    return;
  }
  // 相机/主题是纯视图操作，不保存、不重新渲染，也不触发自动回合。
  if (act === 'battle-replay' || act === 'battle-highlight') { replayBattleTrace(act === 'battle-highlight' ? Number(el.dataset.event) : undefined); return; }
  if (act === 'grid-command-focus') { document.querySelector('.grid-command')?.scrollIntoView({ block: 'start' }); return; }
  if (act.startsWith('out-') || act === 'delivery-generate') {
    await actions[act]?.(el); return;
  }
  if (act === 'archive-reload') {
    await runtime.reloadArchive?.(); render(); return;
  }
  if (act === 'narrative-scan' || act === 'pending-scan') {
    if (controller.migrationReview()) throw Error('请先核对并接受迁移预览，再扫描回复');
    await scanLastMessage({ manual: true });
    render(); return;
  }
  const actionBattle = currentBattle();
  try {
    (await executeAndSave(async () => {
    if (controller.migrationReview() && !act.startsWith('migration-') && !['log-detail', 'unit-detail', 'units-toggle', 'sec-toggle', 'modal-stop'].includes(act)) throw new Error('先核对迁移预览；预览期间不会改写原档或推进战斗');
    (await actions[act]?.(el));
    if (battleSaveFailed) { const receipt = state.saveReceipt; restore(); state.saveReceipt = receipt; render(); return; }
    if (state.small?.battlefield && (['grid-endturn', 'grid-mobile-endturn', 'grid-auto', 'small-start', 'mass-start'].includes(act)
      || state.small.active && state.small.active.status !== 'ready')) {
      // 先保存动作及反应结果，再跳过失能行动者并执行后续自动回合。
      if (!(await persist())) return;
      (await runAuto()); tacticalView.selectedId = state.small.active?.id; tacticalView.cell = undefined;
    }
    if (!state.small?.battlefield && ['small-start', 'mass-start', 'small-attack', 'small-sidearm', 'small-charge', 'small-move', 'small-retreat', 'small-auto-act', 'small-endturn', 'ability-confirm'].includes(act)) {
      if (!(await persist())) return;
      (await runAuto());
    }
    if (state.small?.battlefield && state.small.isOver()) (await onBattleEnded());
    }, async () => battleSaveFailed ? false : (await persist()), () => { if (actionBattle) restore(); }));
  } catch (err) {
    toast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
  }
  render();
}

function val(sel: string): string {
  const el = document.querySelector(`[data-role="${sel}"]`) as HTMLInputElement | HTMLSelectElement | null;
  return el?.value ?? '';
}

async function commitBuilder(): Promise<void> {
  if (controller.migrationReview()) throw Error('请先核对迁移预览，当前不能保存新档案');
  requireArchiveWritable(); captureForm();
  const preview = builderPreview, draft = preview?.record ? builderEditDraft : state.form;
  if (!preview || preview.namespace !== adapter.namespace() || !draft || preview.signature !== JSON.stringify(draft)) throw Error('配置已变，请重新预览');
  const original = { manageOpen: state.manageOpen, storage: state.storage, roster: state.roster, mode: state.mode, protagonistId: state.protagonistId, commanderId: state.commanderId };
  if (preview.record) {
    const current = state.storage.find((r) => r.id === preview.record!.id);
    if (!current || current.revision !== preview.previousRevision) throw Error('档案已更新，请重新预览');
    state.storage = state.storage.map((r) => r.id === current.id ? structuredClone(preview.record!) : r);
    state.roster = state.roster.map((u) => u.id === current.id ? materializeStorageUnit(preview.record!) : u);
  } else {
    if (state.storage.some((r) => r.id === preview.unit.id)) throw Error('此单位已加入，不重复创建');
    const unit = structuredClone(preview.unit);
    state.storage = [...state.storage, unitRecordFromCombatant(unit)]; state.roster = [...state.roster, unit];
    if (unit.side === 'ally') { state.protagonistId ??= unit.id; state.commanderId ??= unit.id; }
    state.mode = autoScaleMode();
  }
  if (!(await persist())) { const receipt = state.saveReceipt; Object.assign(state, original); state.saveReceipt = receipt; throw Error('尚未保存，当前预览保留，可直接重试'); }
  const edited = !!preview.record; builderPreview = undefined;
  if (edited) { builderEditDraft = undefined; state.editingUnit = null; state.editingDraft = undefined; }
  if (!edited) { state.genOpen = false; state.form = newUnitDraft(); builderSeed = crypto.randomUUID(); }
  toast(edited ? '档案修改已保存' : '已加入队伍');
}

/** 扫描互斥标记：事件+轮询可能同时触发，防止并发双扫导致重复录入 */
let scanning = false;

/** loader 常驻监听写入的「生成完毕待扫」标记（主窗口 localStorage，与面板同源共享） */
const SCAN_PENDING_KEY = 'tavern-battle:scan-pending';

function readScanPendingMarker(): number {
  try {
    const raw = localStorage.getItem(SCAN_PENDING_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function clearScanPendingMarker(): void {
  try {
    localStorage.removeItem(SCAN_PENDING_KEY);
  } catch {
    /* localStorage 不可用则忽略 */
  }
}

/** 补扫：面板关闭/重开期间完成的生成由 loader 标记驱动补一次扫描（processedRaws 去重保证幂等） */
function catchUpScan(): void {
  if (!adapter.inTavern) return;
  if (readScanPendingMarker() <= state.lastScanAt) return;
  void scanLastMessage().then((changed) => {
    if (changed && !state.editingUnit) render();
  });
}

/** 自动扫描沿用生成绑定；手动重扫刷新待处理回复，已提交来源继续去重。 */
async function scanLastMessage(opts: { manual?: boolean } = {}): Promise<boolean> {
  await controller.scan(undefined, opts);
  if (opts.manual) toast('已按完整协议与消息来源扫描；结果见剧情档案同步');
  return true;
}


/** 标记一条建议 raw 已处理（批准/拒绝都算），后续扫描不再重复录入 */
function markProcessed(raw: string): void {
  if (!state.processedRaws.includes(raw)) state.processedRaws.push(raw);
  if (state.processedRaws.length > 400) state.processedRaws = state.processedRaws.slice(-400);
}

/** 批准一条建议并落地 */
async function approveSuggestion(s: Suggestion): Promise<void> {
  if (['bless', 'unbless', 'affect', 'unaffect', 'reforge', 'learn'].includes(s.kind) || s.kind === 'give' && s.spec) throw new Error('有效果的物品、改造和增减益请通过剧情档案同步整批审查，旧无来源记录不能直接执行');
  switch (s.kind) {
    case 'give': {
      const existing = state.inventory.find((it) => it.name === s.item && it.lootType === s.lootType && it.note === s.note && !it.assignedTo);
      if (existing) existing.qty += s.qty;
      else state.inventory.push({ id: `loot-${Date.now().toString(36)}-${state.idSeq++}`, name: s.item, note: s.note, qty: s.qty, lootType: s.lootType });
      toast(`🎒 已入账物品：${s.item}×${s.qty}`);
      break;
    }
    case 'status': {
      requireArchiveWritable();
      const stored = storageRecordByRef(undefined, s.target);
      if (!stored) throw new Error('状态目标缺失或同名不唯一');
      const target = materializeStorageUnit(stored);
      target.conditions.push({ id: s.conditionId, dur: s.dur });
      const next = unitRecordFromCombatant(target, stored, { kind: 'update' });
      state.storage = state.storage.map((r) => r.id === stored.id ? next : r);
      state.roster = state.roster.map((u) => u.id === stored.id ? materializeStorageUnit(next) : u);
      toast(`${s.target} 获得状态【${s.conditionId}】${s.dur} 回合（下次战斗生效）`);
      break;
    }
    case 'xp': {
      requireArchiveWritable();
      const rosterTarget =
        (state.protagonistId && state.roster.find((u) => u.id === state.protagonistId)) ||
        state.roster.find((u) => u.side === 'ally' && u.scale === 'hero');
      const target = rosterTarget && state.storage.some((r) => r.id === rosterTarget.id)
        ? materializeStorageUnit(state.storage.find((r) => r.id === rosterTarget.id)!)
        : undefined;
      if (!target) throw new Error('无友方英雄可入账经验');
      const r = applyXp(target, s.amount, reg);
      const rosterIndex = state.roster.findIndex((u) => u.id === target.id);
      if (rosterIndex >= 0) state.roster[rosterIndex] = JSON.parse(JSON.stringify(target)) as Combatant;
      const storageIndex = state.storage.findIndex((u) => u.id === target.id);
      const previous = storageIndex >= 0 ? state.storage[storageIndex] : undefined;
      const record = unitRecordFromCombatant(target, previous, { transient: !!previous?.transient });
      if (storageIndex >= 0) state.storage[storageIndex] = record;
      else state.storage.push(record);
      toast(r.levelsGained > 0 ? `${target.name} +${s.amount} 经验，升级 等级${r.fromLevel}→等级${r.toLevel}！` : `${target.name} +${s.amount} 经验`);
      break;
    }
    case 'field': {
      // 环境声明：AI 叙述战场时输出 <field env="…"/>，面板落库供下次开战（战斗中环境已固化）
      state.field = s.env;
      state.lighting = s.light ?? (s.env === 'night' ? 'night' : 'day');
      const inBattle = !!(state.small || state.mass);
      toast(`战场环境已设为「${FIELD_LABELS[s.env] ?? s.env}」${inBattle ? '（本场已固化，下场战斗生效）' : '（开战时生效）'}`);
      break;
    }
    case 'deploy': {
      const r = storageRecordByRef(s.id, s.name);
      if (!r) throw new Error(`档案库中找不到 id=${s.id} 的单位`);
      const added = deployStorageRecord(r);
      toast(added ? `已选择 ${r.name}（${r.hp}/${r.base.hpMax}）进入上场编制` : `${r.name} 已在上场编制中，无需重复选择`);
      break;
    }
    case 'unit-update': {
      applyUnitUpdate(s);
      toast(`已更新 ${s.name ?? s.id}${s.reason ? `：${s.reason}` : ''}`);
      break;
    }
    case 'spawn': {
      if (!Number.isInteger(s.count) || s.count < 1 || s.count + state.roster.length > MAX_SCENE_UNITS) throw new Error('本场单位卡超过32，请通过正文整批审查重新按编队描述；人数写hpMax');
      // 正文对应层：装备/特质/人设从 AI 描述映射到生成输入（匹配不到的按曲线基准+原名生成）
      // 武器显示名：weapon="名字:种类L等级" 的名字段（旧格式无名字段则用原文）——面板一律显示它
      const weaponLabel = s.weaponName ?? s.weapon;
      const weaponId = weaponLabel
        ? Object.values(WEAPON_LIBRARY).find((w) => w.name === weaponLabel)?.id
        : undefined;
      // 护甲解析优先级：AI 显式 档位+等级（armorTier/armorLevel，减伤按它算）> 命中护甲库专有名（armorId）> 自由文本名
      const armorId = s.armor && s.armorTier === undefined
        ? Object.values(ARMOR_LIBRARY).find((a) => a.name === s.armor)?.id
        : undefined;
      const armorName = s.armorName ?? (!armorId && s.armorTier === undefined && s.armor ? s.armor : undefined);
      const traits = [...new Set((s.traits ?? [])
        .map((t) => resolveTraitId(t, reg))
        .filter((x): x is string => !!x))];
      if (s.leader) {
        // 敌方首领：统率光环（己方士气+10）+ 精锐，数值上是个头目
        if (!traits.includes('commander')) traits.push('commander');
        if (!traits.includes('elite')) traits.push('elite');
      }
      // side：spawn 标签可选 ally（生成玩家/友军单位），缺省 enemy（向后兼容）
      const side = s.side ?? 'enemy';
      // 刻度：AI 显式声明个体/编队优先；缺省按当前战斗规模
      const scale = s.scale ?? (state.mode === 'mass' ? 'company' : 'hero');
      // 武器解析优先级：AI 显式 种类+等级(weaponClass+weaponLevel，伤害/射程按它算) > 命中武器库专有名(weaponId) > 自由文本名(weaponName)
      // 例如 weapon="裂颅者:斧L6" → weaponName=裂颅者（面板显示）+ weaponClass=axe + weaponLevel=6（数值来源）
      // 副武器（weapon2）：同样优先级，仅显式声明才有，种类与主武器相同
      const sidearmLabel = s.weapon2Name ?? s.weapon2;
      const sidearmId = sidearmLabel
        ? Object.values(WEAPON_LIBRARY).find((w) => w.name === sidearmLabel)?.id
        : undefined;
      for (let i = 0; i < s.count; i++) {
        (await addUnit(
          {
            name: s.name, side, archetype: s.archetype,
            scale, level: s.level, traits, era: state.era,
            ...(s.weaponClass
              ? { bonuses:s.bonuses,weaponBonuses:s.weaponBonuses,sidearmBonuses:s.weapon2Bonuses,armorBonuses:s.armorBonuses,weaponClass: s.weaponClass, weaponLevel: s.weaponLevel ?? 1, weaponName: weaponLabel }
              : weaponId ? { weaponId } : s.weapon ? { weaponName: s.weapon } : {}),
            ...(s.weapon2
              ? s.weapon2Class
                ? { sidearmClass: s.weapon2Class, sidearmLevel: s.weapon2Level ?? 1, sidearmName: sidearmLabel }
                : sidearmId ? { sidearmId } : { sidearmName: sidearmLabel }
              : {}),
            ...(armorId
              ? { armorId }
              : s.armorTier !== undefined
                ? { armorTier: s.armorTier }
                : armorName
                  ? { armorName }
                  : {}),
            ...(s.armorLevel ? { armorLevel: s.armorLevel } : {}),
            ...(s.skills?.length
              ? { abilityBlueprints: s.skills.map((k) => ({ id: k.blueprintId, bonuses:k.bonuses, ...(k.level ? { level: k.level } : {}), ...(k.name ? { name: k.name } : {}) })) }
              : {}),
          },
          { encounter: true },
        ));
      }
      const sideWord = side === 'ally' ? '我方' : '敌方';
      const bits = [
        weaponLabel, sidearmLabel ? `副武器${sidearmLabel}` : '', armorName ?? s.armor,
        s.skills?.length ? `技能×${s.skills.length}` : '',
        s.traits?.length ? `特质×${traits.length}` : '', s.leader ? '首领' : '',
      ].filter(Boolean).join('·');
      toast(`已生成${s.side === 'ally' ? '同伴' : '遭遇'}：${s.name}×${s.count}（${sideWord}·${scaleLabel({ scale, rulesVersion: 'v2' })}${bits ? '｜' + bits : ''}）`);
      break;
    }
  }
  markProcessed(s.raw);
  state.pending = state.pending.filter((p) => p.raw !== s.raw);
  (await persist());
}

/** 战后经验入账：击杀/参战/指挥加成写回编制单位，跨阈值自动按曲线升级 */
async function settleXp(allowUnfinished = false): Promise<void> {
  const b = currentBattle();
  if (!b || (!b.isOver() && !allowUnfinished)) throw new Error('战斗尚未结束');
  const awards = b.isOver() ? battleXpAwardsForBothSides(b.combatants, b.xpByUnit, {
    winner: b.winner(), initialStrength: b.xpInitialStrength,
    commanderId: state.mass ? state.mass.commanderId : state.commanderId,
  }) : [];
  const id = battleOutcomeId(state.mass ? 'mass' : 'small', b.seed);
  const result = commitBattleOutcome({
    battleId: id,
    committedIds: state.committedOutcomeIds,
    records: state.storage,
    roster: state.roster,
    combatants: b.combatants,
    awards,
    registry: reg,
  });
  const before = { committedOutcomeIds: state.committedOutcomeIds, storage: state.storage, roster: state.roster, lastBattleUnitIds: state.lastBattleUnitIds, xpSettled: state.xpSettled, reports: state.reports };
  if (!state.reports.some((r) => r.id === id) && !state.deletedReportIds?.includes(id)) {
    state.reports = [...state.reports, {
      id, roundCount: completedBattleRounds(b), epilogue: battleEpilogue(b,state.activeBattleStart), narrativeEvents: narrativeEvents(b), eventCount: b.log.length, card: settlementCard(b.log, b.round, !!state.mass, { wholeBattle: true }),
      digest: roundDigest(b, state.era, reg, { wholeBattle: true, protagonistId: state.protagonistId }),
      summary: state.small ? smallStateSummary(state.small, state.era, reg) : massStateSummary(state.mass!, state.era, reg),
      deliveries: {}, ...(state.activeBattleStart?.battleId===id?{start:structuredClone(state.activeBattleStart)}:{}),
    }];
  }
  state.selectedReportId = id;
  state.committedOutcomeIds = result.committedIds;
  state.storage = result.records;
  state.roster = result.roster;
  if (result.applied) state.lastBattleUnitIds = result.survivingIds;
  state.xpSettled = true;
  // XP 与战损已经由同一提交入口写回，杜绝旧 roster 覆盖新 XP。
  if (!(await persist())) {
    Object.assign(state, before);
    throw new Error('战果未保存，档案提交已撤回；战斗存档记录仍在，可重试');
  }
  const levelUps = result.levelUps.map((u) => `${u.name} 等级${u.from}→等级${u.to}`);
  const sideXp = (side: 'ally' | 'enemy') => xpLabel(awards.filter(a => a.side === side).reduce((sum, a) => sum + a.total, 0));
  toast(result.applied
    ? `双方成长经验已入账：我方+${sideXp('ally')}／敌方+${sideXp('enemy')} 经验${levelUps.length ? `｜🎉 升级：${levelUps.join('、')}` : ''}`
    : '本场经验已入账，没有重复结算');
}

async function resolveMassRound(expectedRound: number, expectedSeed?: string): Promise<void> {
    const b = state.mass!;
    if (expectedRound !== b.round || expectedSeed && expectedSeed !== b.seed) throw new Error('旧回合按钮已失效');
    if (b.rules.resolutionVersion === 'v2') {
      const snapshot = structuredClone(b.toSnapshot()), drafts = structuredClone(state.orderDraft);
      try {
        executeMassPlan(b, drafts, massAutoCommand(), expectedRound);
        state.orderDraft = {};
      } catch (error) {
        state.mass = MassBattle.fromSnapshot(snapshot, { traitRegistry: reg, summonUnit }); state.orderDraft = drafts;
        throw error;
      }
      if (b.isOver()) {
        if (!b.log.some((l) => l.kind === 'battle-end')) b.log.push({ round: b.round, kind: 'battle-end', text: b.winner() === 'ally' ? '会战胜利' : b.winner() === 'enemy' ? '会战失利' : '会战僵持' });
        (await onBattleEnded());
      }
      return;
    }
    if (massAutoCommand() || fullAuto.running) {
      b.autoOrders('enemy');
      b.autoOrders('ally');
    } else {
      // 敌方军令始终自动补齐；我方按设置（命令记忆优先 + 引擎启发补全）
      b.autoOrders('enemy');
      if (state.autoAllyOrders) {
        issueMemoryOrders();
        b.autoOrders('ally');
      }
    }
    b.resolveRound(expectedRound);
    if (b.isOver()) {
      if (!b.log.some((l) => l.kind === 'battle-end')) {
        const w = b.winner();
        b.log.push({ round: b.round, kind: 'battle-end', text: w === 'ally' ? '⚔ 会战大捷' : w === 'draw' ? '两败俱伤' : '⚔ 会战失利' });
      }
      (await onBattleEnded());
    }
}


async function startContextualBattle(requestedMode:'small'|'mass'):Promise<void> {
  prepareRosterForBattle();
  if (!rosterHasBothSides()) throw Error('开战前必须同时有我方与敌方单位');
  let context:LlmEncounterContext|undefined;
  const v2=state.roster.every(u=>u.rulesVersion==='v2'), settings=readLlmSettings();
  const setup={mode:requestedMode,field:state.field||'plains',lighting:state.lighting,mapLayout:state.mapLayout,objectiveMode:state.objectiveMode,siegeAttacker:state.siegeAttacker};
  if(settings.enabled && v2) {
    const namespace=adapter.namespace(), identity=adapter.identity(), revision=state.factRevision,
      generation=controller.inventoryContext(), settingsKey=JSON.stringify(settings), rosterKey=JSON.stringify(state.roster);
    const messages=recentContextMessages(), messagesKey=JSON.stringify(messages);
    const valid=()=>!currentBattle() && adapter.namespace()===namespace && adapter.identity()===identity && state.factRevision===revision
        && controller.inventoryContext()===generation && JSON.stringify(readLlmSettings())===settingsKey && JSON.stringify(state.roster)===rosterKey
        && JSON.stringify(recentContextMessages())===messagesKey && (!runtime.canWrite||runtime.canWrite());
    const pending=llmContext.select({roster:state.roster,setup,messages},settings,valid);
    render('battle');
    context=await pending;
    if (!valid()) throw Error('准备信息已变化，尚未开始战斗');
    state.mode=context.mode;state.field=context.field;state.lighting=context.lighting;state.mapLayout=context.mapLayout;
    state.objectiveMode=context.objectiveMode;state.siegeAttacker=context.siegeAttacker;
  }
  let mode=context?.mode??requestedMode;
  if(!context&&v2) {
    const manual=encounterRequest({roster:state.roster,setup,
      settings:{...normalizeContextSettings(),enemy:'manual',scene:'manual'},messages:[],windowSize:0,roles:[],phase:'preparation'}).base;
    mode=manual.mode;state.mapLayout=manual.mapLayout;
  }
  if(mode==='mass')await startMassBattle(context);else await startSmallBattle(context);
}

async function startSmallBattle(context?:LlmEncounterContext):Promise<void> {
    const before=captureBattleArchive({...controller.snapshot(),storage:state.storage,inventory:state.inventory,rosterIds:state.roster.map(u=>u.id),protagonistId:state.protagonistId,commanderId:state.commanderId,encounterIds:[...state.encounterIds],lastBattleUnitIds:state.lastBattleUnitIds});
    if (!rosterHasBothSides()) throw new Error('开战前必须同时有我方与敌方单位');
    const seed = randomSeed();
    const tags = state.objectiveMode === 'siege' ? [...new Set([...plannedFieldTags(), 'siege'])] : plannedFieldTags();
    let battlefield = state.mapLayout === 'indoor' ? generatedField(seed, 5, 7, tags) : generatedField(seed, 7, 13, tags);
    if (state.roster.every((u) => u.rulesVersion === 'v2')) battlefield = prepareBattleObjective(battlefield, state.roster, state.objectiveMode, state.protagonistId, state.siegeAttacker);
    const small = new SmallBattle({
      nonLethal:state.nonLethal,
      ...(state.roster.every((u) => u.rulesVersion === 'v2') ? { battlefield } : {}),
      rules: state.roster.every((u) => u.rulesVersion === 'v2') ? V4_OVERFLOW_D20 : LITE_D20,
      combatants: JSON.parse(JSON.stringify(state.roster)), seed: state.roster.every((u) => u.rulesVersion === 'v2') ? seed : undefined, traitRegistry: reg,
      summonUnit,
      field: { tags: state.roster.every((u) => u.rulesVersion === 'v2') ? tags : state.field ? [state.field] : [] },
    });
    small.commanderProfiles = structuredClone(context?.commanders ?? {});
    small.start();
    state.activeBattleStart=captureBattleStart(small,before);state.selectedReportId=undefined;
    state.small = small;
    state.mass = null;
    state.encounterContext = context;
    state.xpSettled = false;
    state.smallTarget = '';
    tacticalView.selectedId = state.small.active?.id; tacticalView.cell = undefined;
    (await persist());
}

async function startMassBattle(context?:LlmEncounterContext):Promise<void> {
    const before=captureBattleArchive({...controller.snapshot(),storage:state.storage,inventory:state.inventory,rosterIds:state.roster.map(u=>u.id),protagonistId:state.protagonistId,commanderId:state.commanderId,encounterIds:[...state.encounterIds],lastBattleUnitIds:state.lastBattleUnitIds});
    if (!rosterHasBothSides()) throw new Error('开战前必须同时有我方与敌方单位');
    const clones: Combatant[] = state.roster.every((u) => u.rulesVersion === 'v2') ? prepareMassRoster(state.roster) : structuredClone(state.roster);
    const zoneNames = ['左翼', '中军', '右翼'];
    if (clones.some((u) => u.rulesVersion !== 'v2')) for (const side of ['ally', 'enemy'] as const) {
      const sideUnits = clones.filter((c) => c.side === side);
      sideUnits.forEach((c, i) => {
        const z = formationZone(c) ?? zoneNames[Math.floor(i * zoneNames.length / Math.max(1, sideUnits.length))]!;
        c.tags = [...c.tags.filter((t) => !t.startsWith('zone:') && !t.startsWith('rank:')), 'zone:' + z, 'rank:' + (formationRank(c) ?? defaultRank(c))];
      });
    }
    const mass = new MassBattle({
      nonLethal:state.nonLethal,
      ...(clones.every((u) => u.rulesVersion === 'v2') ? { rules: V4_OVERFLOW_TW } : {}),
      combatants: clones,
      traitRegistry: reg,
      commanderId: state.commanderId,
      zones: zoneNames,
      summonUnit,
      field: { tags: state.roster.every((u) => u.rulesVersion === 'v2') ? plannedFieldTags() : state.field ? [state.field] : [] },
    });
    mass.commanderProfiles = structuredClone(context?.commanders ?? {});
    mass.start();
    state.activeBattleStart=captureBattleStart(mass,before);state.selectedReportId=undefined;
    state.mass = mass;
    state.small = null;
    state.encounterContext = context;
    state.xpSettled = false;
    (await persist());
}

const actions: Record<string, (el: HTMLElement) => void | Promise<void>> = {
  'llm-models': async (button) => {
    const settings = readLlmSettings(), key = llmConnectionKey(settings);
    button.setAttribute('disabled', '');
    try {
      const models = await llmContext.models(settings);
      const latest = readLlmSettings();
      if (llmConnectionKey(latest) !== key) { toast('连接或模型已改变，请重新拉取'); return; }
      saveLlmSettings({...latest, models});
      llmDiagnostic = `已保存 ${models.length} 个模型；请选择要使用的模型。`;
      render('view');
    } finally { button.removeAttribute('disabled'); }
  },
  'delivery-generate': async el => {
    if (!runtime.retryGeneration || !el.dataset.delivery) throw Error('当前酒馆没有独立重试生成接口');
    const receipt = await runtime.retryGeneration(el.dataset.delivery);
    if (el.dataset.key) finishNarrativeDelivery(state.reportDeliveries, { battleId: el.dataset.battle!, key: el.dataset.key }, receipt);
    else if (el.dataset.label) { const report = state.reports.find(item => item.id === el.dataset.battle); if (report) report.deliveries[el.dataset.label] = receipt; }
    await persist();
  },
  'out-delta': async () => { const batch = makeNarrativeBatch(currentBattle() ?? undefined, reportForOutput(), state.reportDeliveries, 'delta'); void (await sendToAi(batch.text, '新增战况', undefined, batch)); },
  'out-epilogue': async () => { const batch = makeNarrativeBatch(currentBattle() ?? undefined, reportForOutput(), state.reportDeliveries, 'epilogue',state.activeBattleStart); void (await sendToAi(batch.text, '战斗终章', undefined, batch)); },
  'delivery-review': (el) => { finishNarrativeDelivery(state.reportDeliveries, {battleId:el.dataset.battle!,key:el.dataset.key!}, {status:el.dataset.result === 'sent' ? 'sent' : 'failed',detail:'玩家核对聊天后确认'}); },
  'trait-source-revoke': async (el) => {
    const receipt = (await controller.revokeBlessing(el.dataset.unit!, el.dataset.source!, Number(el.dataset.revision), el.dataset.context!));
    if (receipt.status === 'failed') throw new Error(receipt.error ?? '保存失败，效果没有解除');
  },
  'unit-conversion-preview': (el) => {
    requireArchiveWritable(); const before = state.storage.find((r) => r.id === el.dataset.id)!;
    unitConversion = { namespace: adapter.namespace(), before: structuredClone(before), after: previewUnitConversion(before, reg) };
  },
  'unit-conversion-cancel': () => { unitConversion = undefined; },
  'unit-conversion-export': () => {
    if (!unitConversion) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(unitConversion.before, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'unit-before-v2.json'; link.click(); URL.revokeObjectURL(url);
  },
  'unit-conversion-commit': async () => {
    requireArchiveWritable(); const review = unitConversion;
    if (!review || review.namespace !== adapter.namespace()) throw new Error('更新规则预览已经过期');
    const original = state.storage.find((r) => r.id === review.before.id);
    if (!original || JSON.stringify(original) !== JSON.stringify(review.before)) throw new Error('单位已有新战斗记录，请重新预览');
    const before = { storage: state.storage, roster: state.roster };
    state.storage = state.storage.map((r) => r.id === original.id ? review.after : r);
    state.roster = state.roster.map((u) => u.id === original.id ? materializeUnitRecord(review.after, reg) : u);
    if (!(await persist())) { Object.assign(state, before); throw new Error('保存失败，更新规则未提交'); }
    unitConversion = undefined;
  },
  'unit-conversion-undo': async (el) => {
    requireArchiveWritable(); const current = state.storage.find((r) => r.id === el.dataset.id)!;
    const restored = undoUnitConversion(current); const before = { storage: state.storage, roster: state.roster };
    state.storage = state.storage.map((r) => r.id === current.id ? restored : r);
    state.roster = state.roster.map((u) => u.id === current.id ? materializeUnitRecord(restored, reg) : u);
    if (!(await persist())) { Object.assign(state, before); throw new Error('保存失败，撤销未提交'); }
  },
  'migration-export': () => {
    const source = controller.migrationReview()?.original ?? controller.snapshot();
    const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'tavern-battle-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    link.click(); URL.revokeObjectURL(url);
  },
  'migration-accept': async () => { const receipt = (await controller.acceptMigration()); if (receipt.status === 'failed') throw new Error(receipt.error); restore(); state.saveReceipt = receipt; },
  'migration-restore': async () => { const receipt = (await controller.restoreMigrationBackup()); if (receipt.status === 'failed') throw new Error(receipt.error); restore(); state.saveReceipt = receipt; },
  'grid-flight': (el) => {
    const b = state.small; const actorId = el.dataset.actor;
    if (!b || !actorId || actorId !== b.active?.id) throw new Error('行动者已变化，请重新预览');
    b.changeFlight(actorId, el.dataset.airborne === 'true');
  },
  'grid-move': (el) => {
    const b = state.small; const actorId = el.dataset.actor;
    if (!b || !actorId || actorId !== b.active?.id) throw new Error('行动者已变化，请重新预览');
    b.moveTo(actorId, tacticalView.cell!); tacticalView.cell = undefined;
  },
  'grid-execute': (el) => {
    const b = state.small!;
    const actorId = el.dataset.actor;
    if (!actorId || actorId !== b.active?.id) throw new Error('行动者已变化，请重新预览');
    const mode = el.dataset.mode!; const target = el.dataset.target!;
    if (mode === 'weapon' || mode === 'weapon:sidearm') b.attack(actorId, target, { weaponMode: mode === 'weapon' ? 'primary' : 'sidearm' });
    else if (mode === 'charge') b.attack(actorId, target, { charge: true });
    else {
      const abilityId = mode.startsWith('ability:') ? mode.slice(8) : mode;
      const result = b.useAbility(actorId, abilityId, target);
      if (!result.ok) throw new Error(result.reason ?? '技能不可用');
    }
    tacticalView.cell = undefined;
  },
  'grid-watch': () => { state.small!.setOverwatch(state.small!.active!.id); },
  'grid-brace': () => { state.small!.brace(state.small!.active!.id); },
  'grid-suppress': (el) => { state.small!.suppress(state.small!.active!.id, el.dataset.target!); },
  'grid-retreat': () => { state.small!.retreat(state.small!.active!.id); },
  'grid-endturn': () => { state.small!.endTurn(); },
  'grid-mobile-endturn': () => { state.small!.endTurn(); },
  'grid-auto': async () => { await autoSmall(state.small!); },
  'prompt-save': async (el) => {
    const id = el.dataset.section as PromptSectionId; if (!PROMPT_SECTIONS.some((s) => s.id === id)) return;
    const settings = controller.snapshot().promptSettings ?? {};
    const template = document.querySelector<HTMLTextAreaElement>(`[data-role="prompt-template"][data-section="${id}"]`)!.value;
    const receipt = (await controller.setPromptSettings({ ...settings, sections: { ...settings.sections, [id]: { ...settings.sections?.[id], template } } }));
    if (receipt.status === 'failed') throw Error(receipt.error); promptDrafts.delete(id);
  },
  'prompt-reset': async (el) => {
    const id = el.dataset.section as PromptSectionId; if (!PROMPT_SECTIONS.some((s) => s.id === id)) return;
    const settings = controller.snapshot().promptSettings ?? {};
    const receipt = (await controller.setPromptSettings({ ...settings, sections: { ...settings.sections, [id]: { enabled: settings.sections?.[id]?.enabled } } }));
    if (receipt.status === 'failed') throw Error(receipt.error); promptDrafts.delete(id);
  },
  'prompt-select-units': async (el) => {
    const receipt = (await controller.setPromptSettings(selectPromptEntries(controller.snapshot().promptSettings, 'unit', state.storage.filter(visibleUnitRecord).map((r) => r.id), el.dataset.selected === 'true')));
    if (receipt.status === 'failed') throw Error(receipt.error);
  },
  'prompt-select-items': async (el) => {
    const save = controller.snapshot();
    const receipt = (await controller.setPromptSettings(selectPromptEntries(save.promptSettings, 'item', inventoryPanel.visibleItemIds(), el.dataset.selected === 'true')));
    if (receipt.status === 'failed') throw Error(receipt.error);
  },
  'narrative-restore-roster': async (el) => { const receipt = (await controller.restoreDeployment(el.dataset.id!)); if (receipt.status === 'failed') throw Error(receipt.error ?? '参战名单未保存'); },
  'narrative-approve': async (el) => { const receipt = (await controller.approve(el.dataset.id!)); if (receipt.status === 'failed') throw new Error(receipt.error ?? '保存失败，未提交'); },
  'narrative-correct': async (el) => {
    const id = el.dataset.id!, draft = el.closest('.narrative-proposal')?.querySelector<HTMLTextAreaElement>('[data-role="narrative-draft"]')?.value;
    if (draft === undefined) throw new Error('没有可重新解析的草稿');
    const receipt = (await controller.correctProposal(id, draft));
    if (receipt.status === 'failed') throw new Error(receipt.error ?? '草稿未保存，输入已保留');
    narrativeDrafts.delete(id); toast('草稿已重新解析，请核对识别结果');
  },
  'narrative-recognized': (el) => {
    const p = state.proposals.find((p) => p.id === el.dataset.id);
    if (!p?.canonical) throw new Error('尚无可识别部分');
    narrativeDrafts.set(p.id, '<tb>\n' + p.canonical + '\n</tb>');
    toast('草稿已保留识别部分，尚未入账；核对后重新解析');
  },
  'narrative-reject': async (el) => { (await controller.reject(el.dataset.id!)); },
  'narrative-delete': async (el) => { const receipt = (await controller.deleteRecords(el.dataset.id ? [el.dataset.id] : undefined)); if (receipt.status === 'failed') throw new Error(receipt.error ?? '记录未删除，保存失败'); },
  'narrative-rebind': (el) => { void controller.rebind(el.dataset.id!).catch((error) => toast(String(error))); },
  'save-retry': async () => {
    if (runtime.retrySave) { state.saveReceipt = await runtime.retrySave(); restore(); render(); }
    else await persist();
  },
  'modal-stop': () => {},
  'ability-cancel': () => {
    state.abilityDialog = null;
  },
  'ability-confirm': async () => {
    const d = state.abilityDialog;
    if (!d) return;
    const targetId = val('ability-confirm-target') || undefined;
    if (d.battle === 'small') {
      const b = state.small;
      if (!b?.active || b.active.id !== d.actorId) throw new Error('行动者已经变化，请重新选择技能');
      const r = b.useAbility(d.actorId, d.abilityId, targetId);
      if (!r.ok) throw new Error(r.reason ?? '技能无法施放');
      state.abilityDialog = null;
      (await afterSmallAction());
    } else {
      const b = state.mass;
      if (!b) throw new Error('会战已经结束');
      const r = b.useAbility(d.actorId, d.abilityId, targetId);
      if (!r.ok) throw new Error(r.reason ?? '技能无法施放');
      const actorName = b.byId(d.actorId).name;
      if (b.rules.resolutionVersion === 'v2') {
        const host = [...b.attached].find(([, hero]) => hero === d.actorId)?.[0] ?? d.actorId;
        delete state.orderDraft[host];
      }
      state.abilityDialog = null;
      toast(b.rules.resolutionVersion === 'v2' ? `${actorName} 的技能已排入支援阶段，执行时扣费` : `${actorName} 已施放技能（结算见战报）`);
    }
  },
  'gen-toggle': () => {
    state.genOpen = !state.genOpen;
  },
  'units-toggle': () => {
    state.unitsOpen = !state.unitsOpen;
  },
  'unit-detail': (el) => {
    const id = el.dataset.id!;
    if (state.expandedUnits.has(id)) state.expandedUnits.delete(id);
    else state.expandedUnits.add(id);
  },
  'role-detail': (el) => {
    const key = `role:${el.dataset.id!}`;
    if (state.expandedUnits.has(key)) state.expandedUnits.delete(key);
    else state.expandedUnits.add(key);
  },
  'role-inject': async () => {
    void (await sendToAi(buildContextInject(), '角色状态'));
  },
  'log-detail': (el) => {
    const i = parseInt(el.dataset.i!, 10);
    if (state.expandedLog.has(i)) state.expandedLog.delete(i);
    else state.expandedLog.add(i);
  },
  'manage-toggle': () => {
    state.manageOpen = !state.manageOpen;
    if (!state.manageOpen && !builderEditDraft) state.editingUnit = null;
  },
  'section-toggle': (el) => {
    const sec = el.dataset.sec!;
    state.collapsed[sec] = !isSecCollapsed(sec);
  },
  'snapshot-toggle': async () => {
    state.snapOpen = !state.snapOpen;
    (await persist());
  },
  'manage-edit': async (el) => {
    // 兼容：旧「编辑」也落 storage（若 id 属于 storage 则直接选中；否则忽略）
    (await actions['storage-edit']!(el));
  },
  'manage-cancel-edit': () => {
    builderEditDraft = undefined; builderPreview = undefined;
    state.editingUnit = null;
    state.editingDraft = undefined;
  },
  'storage-edit': (el) => {
    requireArchiveWritable();
    const record = state.storage.find((r) => r.id === el.dataset.id);
    if (!record) throw new Error('档案不存在');
    state.editingUnit = el.dataset.id!;
    state.editingDraft = structuredClone(record);
    builderEditDraft = record.snapshot?.rulesVersion === 'v2' ? unitDraftFromRecord(record) : undefined; builderPreview = undefined;
  },
  'storage-save': async (el) => {
    requireArchiveWritable();
    const id = el.dataset.id!;
    const storageIndex = state.storage.findIndex((x) => x.id === id);
    const previous = state.storage[storageIndex];
    if (!previous) throw new Error('档案库条目不存在');
    const r = structuredClone(state.editingDraft ?? previous);
    if (r.revision !== previous.revision) throw new Error('编辑期间档案已更新，请重新打开编辑');
    r.name = val('s-name0')?.trim() || r.name;
    const arch = val('s-arch');
    if (arch === 'infantry' || arch === 'ranged' || arch === 'mobile') r.archetype = arch;
    const lv = parseInt(val('s-level'), 10);
    if (Number.isFinite(lv)) r.level = Math.max(1, Math.min(10, lv));
    const sc = val('s-scale');
    if (sc === 'hero' || sc === 'mook' || sc === 'company') r.scale = sc;
    const atk = parseInt(val('s-atk'), 10);
    if (Number.isFinite(atk)) r.base.atk = atk;
    const def = parseInt(val('s-def'), 10);
    if (Number.isFinite(def)) r.base.def = def;
    const spd = parseInt(val('s-spd'), 10);
    if (Number.isFinite(spd)) r.base.spd = spd;
    const hp = parseInt(val('s-hp'), 10);
    if (Number.isFinite(hp) && hp > 0) r.base.hpMax = hp;
    const currentHp = parseInt(val('s-hp-current'), 10);
    if (Number.isFinite(currentHp)) r.hp = Math.max(0, Math.min(r.base.hpMax, currentHp));
    else r.hp = Math.min(r.hp, r.base.hpMax);
    const moraleMax = parseInt(val('s-morale'), 10);
    const moraleCurrent = parseInt(val('s-morale-current'), 10);
    if (Number.isFinite(moraleMax) && moraleMax > 0) {
      r.base.moraleMax = moraleMax;
      r.morale = Number.isFinite(moraleCurrent)
        ? Math.max(0, Math.min(moraleMax, moraleCurrent))
        : Math.min(r.morale ?? moraleMax, moraleMax);
    } else {
      delete r.base.moraleMax;
      delete r.morale;
    }
    const side = val('s-side');
    if (side === 'ally' || side === 'enemy') r.side = side;
    const status = val('s-status');
    if (status === 'ready' || status === 'fled' || status === 'routing' || status === 'dying') r.status = status;
    r.weaponName = val('s-weapon')?.trim() || undefined;
    r.weaponClass = val('s-wclass') || undefined;
    if (r.weaponClass !== previous.weaponClass) delete r.weaponId;
    const wlv = parseInt(val('s-wlv'), 10);
    if (Number.isFinite(wlv)) r.weaponLevel = Math.max(1, Math.min(10, wlv)); else delete r.weaponLevel;
    const at = val('s-armor');
    r.armorTier = at !== '' ? (Number(at) as 0 | 1 | 2 | 3 | 4) : undefined;
    const alv = parseInt(val('s-alv'), 10);
    if (Number.isFinite(alv)) r.armorLevel = Math.max(1, Math.min(10, alv)); else delete r.armorLevel;
    // 技能：从行内 data-role 收集
    const skills: { blueprintId?: string; category: Category; level?: number; name?: string }[] = [];
    document.querySelectorAll<HTMLSelectElement>('[data-role="s-cat"]').forEach((sel) => {
      const j = parseInt(sel.dataset.j!, 10);
      const nameEl = document.querySelector<HTMLInputElement>(`[data-role="s-name"][data-j="${j}"]`);
      const lvEl = document.querySelector<HTMLInputElement>(`[data-role="s-lv"][data-j="${j}"]`);
      const name = nameEl?.value.trim();
      const lv = parseInt(lvEl?.value ?? '', 10);
      const previousSkill = r.skills?.[j];
      skills.push({
        category: sel.value as Category,
        ...(previousSkill?.category === sel.value && previousSkill.blueprintId
          ? { blueprintId: previousSkill.blueprintId }
          : { blueprintId: blueprintIdForCategory(sel.value as Category) }),
        ...(name ? { name } : {}),
        ...(Number.isFinite(lv) ? { level: Math.max(1, Math.min(10, lv)) } : {}),
      });
    });
    r.skills = skills;
    if (r.snapshot?.rulesVersion === 'v2') {
      const reserve = Number(val('s-reserve'));
      if (!Number.isInteger(reserve) || reserve < 0 || reserve > 2) throw new Error('随队预备份额必须为0–2');
      r.snapshot.resources.reserve = reserve;
    }
    if (r.snapshot?.rulesVersion === 'v2') {
      r.preparedAbilityIds = [...document.querySelectorAll<HTMLInputElement>('[data-role="s-prepared"]:checked')]
        .map((el) => skills[Number(el.dataset.j)]?.blueprintId)
        .filter((id): id is string => !!id);
    }
    r.traits = [...document.querySelectorAll<HTMLSelectElement>('[data-role="s-traits"] option:checked')].map((o) => o.value);
    r.note = val('s-note')?.trim() || undefined;
    if (previous.retired || previous.status === 'dead') throw new Error('历史墓碑只读；普通编辑不能复活');
    if (r.hp === 0) r.status = 'dead';
    const next = editUnitRecord(previous, r, reg, state.era);
    const rebuilt = materializeStorageUnit(next);
    state.storage[storageIndex] = next;
    const rosterIndex = state.roster.findIndex((u) => u.id === id);
    if (rosterIndex >= 0) state.roster[rosterIndex] = rebuilt;
    if (!(await persist())) throw new Error('档案变更留在内存，尚未保存；请重试保存');
    state.editingUnit = null;
    state.editingDraft = undefined;
    toast(`已保存档案 ${r.name}`);
  },
  'storage-skill-add': async (el) => {
    const r = state.editingDraft;
    if (!r) return;
    r.skills = r.skills ?? [];
    r.skills.push({ category: 'phys-single', level: 1 });
    (await persist());
  },
  'storage-skill-del': async (el) => {
    const r = state.editingDraft;
    if (!r) return;
    const j = parseInt(el.dataset.j!, 10);
    r.skills = (r.skills ?? []).filter((_, k) => k !== j);
    (await persist());
  },
  'storage-del': async (el) => {
    requireArchiveWritable(); const id = el.dataset.id!;
    const receipt = (await controller.deleteUnit(id));
    if (receipt.status === 'failed') throw Error(receipt.error ?? '删除未保存，原档保留');
    if (state.editingUnit === id) { state.editingUnit = null; builderEditDraft = undefined; builderPreview = undefined; }
    state.mode = autoScaleMode();
  },
  'storage-into': async (el) => {
    const r = state.storage.find((x) => x.id === el.dataset.id);
    if (!r) throw new Error('档案不存在');
    deployStorageRecord(r);
    (await persist());
    toast(`已将 ${r.name} 以 ${r.hp}/${r.base.hpMax} 兵力编入编制`);
  },
  'gen-add': () => {
    requireArchiveWritable(); captureForm();
    const signature = JSON.stringify(state.form);
    if (builderPreview?.signature === signature && !builderPreview.record) return;
    builderPreview = { namespace: adapter.namespace(), signature, unit: buildUnit(state.form, reg, builderSeed) };
  },
  'storage-preview': (el) => {
    requireArchiveWritable(); captureForm();
    const previous = state.storage.find((r) => r.id === el.dataset.id);
    if (!previous || !builderEditDraft || previous.revision !== state.editingDraft?.revision) throw Error('档案已更新，请重新打开编辑');
    const record = editUnitBuild(previous, builderEditDraft, reg);
    builderPreview = { namespace: adapter.namespace(), signature: JSON.stringify(builderEditDraft), record, previousRevision: previous.revision, unit: record.snapshot! };
  },
  'builder-skill-add': (el) => {
    captureForm(); const d = el.dataset.builder === 'gen' ? state.form : builderEditDraft; if (!d) return;
    const baseName = el.dataset.name ?? '技能'; const name = !d.skills.some(s=>s.name===baseName) ? baseName : Array.from({length:100},(_,i)=>baseName+(i+1)).find(name=>!d.skills.some(s=>s.name===name))!;
    d.skills.push({ id: el.dataset.mechanism ?? 'generic:physical-single', name, power: '5', prepared: false }); builderPreview = undefined;
  },
  'builder-skill-remove': (el) => {
    captureForm(); const d = el.dataset.builder === 'gen' ? state.form : builderEditDraft; if (d) d.skills.splice(Number(el.dataset.index), 1); builderPreview = undefined;
  },
  'builder-cancel-preview': () => { builderPreview = undefined; },
  'gen-clear': async () => {
    if (currentBattle()) throw new Error('请先收兵归档，再清空编制');
    state.roster = [];
    state.storage = state.storage.filter((r) => !r.transient && visibleUnitRecord(r));
    state.small = null;
    state.mass = null;
    state.protagonistId = undefined;
    state.commanderId = undefined;
    state.mode = 'small';
    state.encounterIds.clear();
    (await persist());
  },
  'enc-clear': async () => {
    requireArchiveWritable();
    const ids = state.encounterIds;
    const removed = state.roster.filter((u) => ids.has(u.id)).length;
    state.roster = state.roster.filter((u) => !ids.has(u.id));
    state.storage = state.storage.filter((r) => !ids.has(r.id) && !r.transient);
    state.lastBattleUnitIds = state.lastBattleUnitIds.filter((id) => !ids.has(id));
    state.encounterIds = new Set();
    if (state.protagonistId && ids.has(state.protagonistId)) state.protagonistId = undefined;
    if (state.commanderId && ids.has(state.commanderId)) state.commanderId = undefined;
    state.mode = autoScaleMode();
    (await persist());
    toast(`已清空 ${removed} 个战场遭遇单位（手动编制保留）`);
  },
  'roster-del': async (el) => {
    requireArchiveWritable();
    const i = parseInt(el.dataset.i!, 10);
    const id = state.roster[i]?.id;
    state.roster.splice(i, 1);
    if (id) {
      state.encounterIds.delete(id);
      state.storage = state.storage.filter((r) => r.id !== id || !r.transient);
    }
    if (id && state.protagonistId === id) state.protagonistId = undefined;
    if (id && state.commanderId === id) state.commanderId = undefined;
    state.mode = autoScaleMode();
    (await persist());
  },
  'roster-proto': async (el) => {
    const id = el.dataset.id!;
    state.protagonistId = state.protagonistId === id ? undefined : id;
    (await persist());
  },
  'roster-commander': async (el) => {
    const id = el.dataset.id!;
    state.commanderId = state.commanderId === id ? undefined : id;
    (await persist());
  },
  'small-start': async () => startContextualBattle('small'),
  'small-attack': async () => {
    const b = state.small!;
    if (!b.active) throw new Error('没有行动者');
    const id = b.active.id;
    b.attack(id, val('small-target'), { weaponMode: 'primary' });
    (await afterSmallAction());
  },
  'small-sidearm': async () => {
    const b = state.small!;
    if (!b.active) throw new Error('没有行动者');
    const id = b.active.id;
    b.attack(id, val('small-target'), { weaponMode: 'sidearm' });
    (await afterSmallAction());
  },
  'small-charge': async () => {
    const b = state.small!;
    if (!b.active) throw new Error('没有行动者');
    const id = b.active.id;
    b.attack(id, val('small-target'), { charge: true });
    (await afterSmallAction());
  },
  'small-ability': (el) => {
    const b = state.small!;
    if (!b.active) throw new Error('没有行动者');
    const id = b.active.id;
    const ability = b.active.abilities.find((a) => a.id === el.dataset.id);
    if (!ability) throw new Error('技能不存在');
    state.abilityDialog = {
      battle: 'small', actorId: id, abilityId: ability.id,
      suggestedTargetId: ability.target === 'enemy' ? val('small-target') || undefined : ability.target === 'self' ? id : undefined,
    };
  },
  'small-move': async (el) => {
    const b = state.small!;
    if (!b.active) throw new Error('没有行动者');
    const id = b.active.id;
    b.move(id, el.dataset.dir === 'withdraw' ? 'withdraw' : 'advance');
    (await afterSmallAction(false));
  },
  'small-retreat': () => {
    const b = state.small!;
    if (!b.active) throw new Error('没有行动者');
    const id = b.active.id;
    b.retreat(id);
    b.endTurn();
  },
  'small-auto-act': async () => {
    // 自动执行当前行动者的回合：引擎自动选目标（伤害技能>武器攻击>走位）
    const b = state.small!;
    const a = b.active;
    if (!a) throw new Error('没有行动者');
    if (a.status !== 'ready') throw new Error(`${a.name} 无法行动（${a.status}）`);
    await autoSmall(b);
    (await persist());
  },
  'small-endturn': async () => {
    state.small!.endTurn();
    (await persist());
  },
  'mass-start': async () => startContextualBattle('mass'),
  'mass-attach': async () => {
    const b = state.mass!;
    if (!state.protagonistId) throw new Error('未设主控');
    const target = val('attach-target');
    if (!target) throw new Error('选择要嵌入的连队');
    b.attachHero(state.protagonistId, target);
    (await persist());
  },
  'battle-finish': async (el) => {
    const b = currentBattle(); if (!b) return;
    stopAutomation();
    b.finishBattle(el.dataset.reason === 'surrender' ? 'surrender' : 'ceasefire');
    state.abilityDialog = null; state.orderDraft = {};
    (await onBattleEnded()); (await persist());
  },
  'battle-close': async () => {
    const b = currentBattle();
    if (!b) throw new Error('没有进行中的战斗可清理');
    // 覆没者从编制和储存器删除；撤离者只离开当前上场编制，保留战后兵力档案以便下次调取。
    const lost = b.combatants.filter((c) => c.hp <= 0 || c.status === 'dead');
    const withdrawn = b.combatants.filter((c) => c.hp > 0 && (c.status === 'fled' || c.status === 'routing'));
    const survivors = b.combatants.filter((c) => c.hp > 0 && c.status !== 'dead' && c.status !== 'fled' && c.status !== 'routing');
    const lostIds = new Set(lost.map((c) => c.id));
    const withdrawnIds = new Set(withdrawn.map((c) => c.id));
    // 已结束战斗在归档前确保 XP 入账；进行中强制收兵只提交当前战损，不虚构结算奖励。
    (await settleXp(true));
    // 编制：覆没者删除；撤离者离开上场编制但保留权威档案。
    state.roster = state.roster.filter((u) => !lostIds.has(u.id) && !withdrawnIds.has(u.id));
    const rosterIds = new Set(state.roster.map((u) => u.id));
    if (state.protagonistId && !rosterIds.has(state.protagonistId)) state.protagonistId = undefined;
    if (state.commanderId && !rosterIds.has(state.commanderId)) state.commanderId = undefined;
    // 遭遇单位只在首次入战前是 transient；一旦活着离开战场就成为普通档案。
    for (const c of b.combatants) state.encounterIds.delete(c.id);
    // 清空战斗中单位 + 重置收尾态
    state.small = null;
    state.mass = null;
    state.xpSettled = true;
    state.activeBattleStart=undefined;
    state.orderDraft = {};
    state.mode = autoScaleMode();
    (await persist());
    toast(`收兵完成：失去战斗力 ${lost.length}（留档），撤离 ${withdrawn.length}，在阵 ${survivors.length}；战报已归档`);
    render();
  },
  'order-issue': async (el) => {
    const b = state.mass!;
    if (massAutoCommand()) throw new Error('军令自动模式：主控非指挥官，无法手动下令');
    const uid = el.dataset.unit!;
    const type = (document.querySelector(`[data-role="order-type"][data-unit="${CSS.escape(uid)}"]`) as HTMLSelectElement)?.value as Order['type'];
    const target = (document.querySelector(`[data-role="order-target"][data-unit="${CSS.escape(uid)}"]`) as HTMLSelectElement)?.value;
    const r = b.issue({ unitId: uid, type, targetId: target || undefined });
    if (!r.ok) throw new Error(r.reason ?? '指令无效');
    // 命令记忆：记住这支单位这次的指令，下回合/下场战斗一键重发
    state.orderMemory[uid] = { type, targetId: target || undefined };
    // 下单后清掉该单位草稿，避免下一回合重复残留
    delete state.orderDraft[uid];
    (await persist());
  },
  'formation-issue': (el) => {
    const b = state.mass!;
    if (massAutoCommand()) throw Error('当前由系统指挥，不能手动改令');
    const selected = formationSelection(b, formationView, state.orderDraft);
    if (!selected.order || !selected.actor || selected.actor.id !== el.dataset.unit) throw Error('所选编队已经变化');
    const result = b.replaceOrders([{ ...selected.order, automatic: false }], Number(el.dataset.round));
    if (!result.ok) throw Error(result.reason);
    if (!['ability', 'takeoff', 'land'].includes(selected.order.type)) state.orderMemory[selected.actor.id] = { type: selected.order.type, targetId: selected.order.targetId };
    delete state.orderDraft[selected.actor.id];
  },
  'formation-cancel': (el) => { delete state.orderDraft[el.dataset.unit!]; },
  'formation-revoke': (el) => {
    const b = state.mass!;
    if (massAutoCommand() || b.planningLocked || b.byId(el.dataset.unit!).side !== 'ally') throw Error('当前不能撤回军令');
    b.revoke(el.dataset.unit!); delete state.orderDraft[el.dataset.unit!];
  },
  'formation-fill': () => {
    const b = state.mass!;
    if (massAutoCommand()) throw Error('当前由系统指挥');
    const count = b.autoOrders('ally', Object.keys(state.orderDraft));
    toast(count ? '已补齐' + count + '支编队，玩家草案保持原样' : '没有需要补齐的编队');
  },
  'mass-orders-all': async () => {
    const b = state.mass!;
    if (massAutoCommand()) throw new Error('军令自动模式：主控非指挥官，无法手动下令');
    // 遍历所有 ally ready 单位，把各自的草稿（下拉当前选择）一次性全部下达
    let issued = 0;
    for (const u of b.combatants) {
      if (u.side !== 'ally' || u.status !== 'ready') continue;
      if (b.orders.has(u.id) && !state.orderDraft[u.id]) continue;
      const typeEl = document.querySelector<HTMLSelectElement>(`[data-role="order-type"][data-unit="${CSS.escape(u.id)}"]`);
      const tgtEl = document.querySelector<HTMLSelectElement>(`[data-role="order-target"][data-unit="${CSS.escape(u.id)}"]`);
      const type = (state.orderDraft[u.id]?.type ?? typeEl?.value) as Order['type'] | undefined;
      const target = state.orderDraft[u.id]?.targetId ?? tgtEl?.value;
      if (!type) continue;
      // 该单位已有指令且无草稿 → 跳过（不重复下）
      if (b.orders.has(u.id) && !state.orderDraft[u.id]) continue;
      const r = b.issue({ unitId: u.id, type, targetId: target || undefined });
      if (r.ok) {
        state.orderMemory[u.id] = { type, targetId: target || undefined };
        delete state.orderDraft[u.id];
        issued += 1;
      }
    }
    toast(issued ? `已下达 ${issued} 条安排` : '没有可下达的安排（先在下拉里选好）');
    (await persist());
  },
  'order-revoke': async (el) => {
    state.mass!.revoke(el.dataset.unit!);
    (await persist());
  },
  'mass-ability': (el) => {
    const b = state.mass!;
    if (massAutoCommand()) throw new Error('军令自动模式：主控非指挥官，无法手动下令');
    // 目标取同一军令行的目标下拉（召唤/自军增益类可不选）
    const targetSel = el.closest('.orderline')?.querySelector<HTMLSelectElement>('[data-role="order-target"]');
    const actor = b.byId(el.dataset.unit!);
    const ability = actor.abilities.find((a) => a.id === el.dataset.id);
    if (!ability) throw new Error('技能不存在');
    state.abilityDialog = {
      battle: 'mass', actorId: actor.id, abilityId: ability.id,
      suggestedTargetId: ability.target === 'enemy' ? targetSel?.value || undefined : ability.target === 'self' ? actor.id : undefined,
    };
  },
  'mass-orders-memory': async () => {
    if (massAutoCommand()) throw new Error('军令自动模式：主控非指挥官，无法手动下令');
    const n = issueMemoryOrders();
    toast(n ? `已按记忆重发 ${n} 条军令` : '没有可重发的记忆指令（先手动下达过一次）');
    (await persist());
  },
  'mass-orders-auto': async () => {
    const b = state.mass!;
    if (massAutoCommand()) throw new Error('军令自动模式：主控非指挥官，无法手动下令');
    const n = issueMemoryOrders() + b.autoOrders('ally');
    toast(`我方自动军令 ${n} 条已下达（记忆优先，无记忆的按引擎启发）`);
    (await persist());
  },
  'mass-resolve': async (el) => { const b = state.mass!; (await resolveMassRound(Number(el.dataset.round ?? b.round), el.dataset.seed)); },
  'xp-settle': async () => {
    (await settleXp());
  },
  'pending-approve': async (el) => {
    const s = state.pending[parseInt(el.dataset.i!, 10)];
    if (!s) return;
    (await approveSuggestion(s));
  },
  'pending-reject': async (el) => {
    const s = state.pending[parseInt(el.dataset.i!, 10)];
    state.pending.splice(parseInt(el.dataset.i!, 10), 1);
    if (s) markProcessed(s.raw); // 拒绝也算处理过——不再被后续扫描翻出来
    (await persist());
  },
  'out-card': async () => {
    const b = currentBattle();
    const archived = reportForOutput();
    if (archived) { void (await sendToAi(archived.card, '结算卡（整场）', archived.id)); return; }
    if (!b) throw new Error('没有可输出的战斗');
    // 整场战斗的结算（不再只发最后一回合）：从第 1 回合到结束全部记录
    const rounds = b.log.reduce((m, l) => Math.max(m, l.round), 0);
    const text = settlementCard(b.isOver() ? b.log : b.visibleLog('ally'), rounds || b.round, state.mode === 'mass', { wholeBattle: true });
    void (await sendToAi(text, '结算卡（整场）'));
  },
  'out-digest': async () => {
    const b = currentBattle();
    const archived = reportForOutput();
    if (archived) { void (await sendToAi(archived.digest, '回合纪要（整场）', archived.id)); return; }
    if (!b) throw new Error('没有可输出的战斗');
    // 回合纪要（中等详细）：每回合命中/未中/状态变化/溃退重整——比结算卡省 token
    const text = roundDigest(b, state.era, reg, {
      wholeBattle: true,
      protagonistId: state.protagonistId,
    });
    if (!text) throw new Error('还没有可纪要的交战事件（先打一回合）');
    void (await sendToAi(text, '回合纪要（整场）'));
  },
  'out-inject': async () => {
    const archived = reportForOutput();
    if (archived) { void (await sendToAi(archived.summary, '状态摘要', archived.id)); return; }
    const opts = { protagonistId: state.protagonistId };
    const text = state.small
      ? smallStateSummary(state.small, state.era, reg, opts)
      : state.mass
        ? massStateSummary(state.mass, state.era, reg, opts)
        : '';
    void (await sendToAi(text, '状态摘要'));
  },
};

function reportForOutput(): BattleReport | undefined {
  const b = currentBattle();
  const id = b ? battleOutcomeId(state.mass ? 'mass' : 'small', b.seed) : state.selectedReportId;
  return state.reports.find((r) => r.id === id) ?? (!b ? state.reports.at(-1) : undefined);
}

/** 主行动后自动推进；移动只消耗移动额度，保留本回合主行动。 */
async function afterSmallAction(endTurn = true): Promise<void> {
  const b = state.small;
  if (!b) return;
  // 结算战斗结束
  if (b.isOver() && !b.log.some((l) => l.kind === 'battle-end')) {
    const w = b.winner();
    b.log.push({ round: b.round, kind: 'battle-end', text: w === 'ally' ? '⚔ 战斗胜利' : w === 'draw' ? '僵局' : '⚔ 战斗失败' });
    (await onBattleEnded());
    return;
  }
  if (endTurn) b.endTurn();
  (await persist());
}

// ---------- 绑定 ----------

document.addEventListener('click', e => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!action) return;
  if (['workspace-tab', 'theme-toggle', 'grid-pan', 'grid-focus', 'modal-stop', 'llm-stop', 'llm-models'].includes(action)) { void handleAction(e); return; }
  // Scan/reload validate the refreshed service themselves; they must remain
  // reachable when a host metadata refresh invalidates the old panel session.
  const viewOnly = ['save-retry', 'archive-reload', 'narrative-scan', 'pending-scan', 'workspace-tab', 'theme-toggle', 'grid-pan', 'grid-focus', 'grid-inspect-unit', 'grid-cell', 'grid-mode', 'narrative-review', 'log-detail', 'unit-detail', 'role-detail', 'modal-stop', 'migration-export'].includes(action);
  const feedback = !viewOnly && /^(grid-|small-|mass-|formation-)/.test(action) ? (e.target as HTMLElement).closest<HTMLElement>('[data-action]') ?? undefined : undefined;
  void panelTask(() => handleAction(e), viewOnly, feedback);
});
let cameraPointer: {x:number;y:number} | undefined;
document.addEventListener('pointerdown', event => { cameraPointer = event.target instanceof Element && event.target.closest('.grid-camera, .formation-map-camera') ? {x:event.clientX,y:event.clientY} : undefined; }, {passive:true});
document.addEventListener('pointermove', event => { if (cameraPointer && Math.hypot(event.clientX-cameraPointer.x,event.clientY-cameraPointer.y)>8) { battleCamera.browse(); cameraPointer=undefined; } }, {passive:true});
document.addEventListener('pointerup', () => { cameraPointer=undefined; }, {passive:true});
document.addEventListener('wheel', event => { if (event.target instanceof Element && event.target.closest('[data-workspace="battle"]')) battleCamera.browse(); }, {passive:true});
document.addEventListener('input', e => {
  const el=e.target;
  if (!(el instanceof HTMLInputElement) || !['llm-url','llm-token','llm-model','llm-window'].includes(el.dataset.role ?? '')) return;
  try {
    const settings=readLlmSettings();
    if(el.dataset.role==='llm-window') {
      const value=Number(el.value); if(!Number.isInteger(value)||value<1||value>100) { el.setCustomValidity('层数须为 1–100 的整数'); return; }
      el.setCustomValidity(''); settings.windowSize=value;
    } else if(el.dataset.role==='llm-url') settings.url=el.value;
    else if(el.dataset.role==='llm-token') settings.token=el.value;
    else settings.model=el.value;
    saveLlmSettings(settings); llmContext.cancel(); llmDiagnostic='已保存';
  } catch(error) { toast(error instanceof Error ? error.message : '保存失败'); }
});
document.addEventListener('input', (e) => {
  if (!(e.target instanceof Element)) return;
  if (e.target instanceof HTMLTextAreaElement && e.target.dataset.role === 'prompt-template') { promptDrafts.set(e.target.dataset.section!, e.target.value); return; }
  if (e.target instanceof HTMLTextAreaElement && e.target.dataset.role === 'narrative-draft') { narrativeDrafts.set(e.target.dataset.id!, e.target.value); return; }
  inventoryPanel.capture(e.target);
  if (e.target.closest('[data-builder-form]') && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLInputElement && e.target.type === 'checkbox')) { captureForm(); builderPreview = undefined; document.querySelectorAll('[data-role="builder-preview"]').forEach((el) => el.remove()); }
});
async function handleChange(e: Event): Promise<void> {
  if(e.target instanceof HTMLSelectElement&&e.target.dataset.role==='cannon-ammo'){
    const b=currentBattle(),unit=b?.combatants.find(u=>u.id===(e.target as HTMLSelectElement).dataset.unit);
    if(!b||b.isOver()||!unit||unit.side!=='ally'||!['auto','he','ap'].includes(e.target.value))return;
    const previous=unit.cannonAmmo;unit.cannonAmmo=e.target.value==='auto'?undefined:e.target.value as 'he'|'ap';if(!(await persist()))unit.cannonAmmo=previous;render('battle');return;
  }
  if (e.target instanceof HTMLInputElement && e.target.dataset.role === 'non-lethal') {
    if (currentBattle()) return;
    const previous=state.nonLethal;state.nonLethal=e.target.checked;
    if(!(await persist()))state.nonLethal=previous;
    render('battle');return;
  }
  if (e.target instanceof HTMLSelectElement && e.target.dataset.role === 'battle-tactic') { const b = currentBattle(); if (b && !b.isOver() && b.rules.resolutionVersion === 'v2') { b.allyTactic = normalizeTactic(e.target.value); (await persist()); render('battle'); } return; }
  if (e.target instanceof HTMLSelectElement && e.target.dataset.role === 'prompt-scope' || e.target instanceof HTMLInputElement && e.target.dataset.role === 'prompt-pin') {
    const el = e.target as HTMLInputElement, settings = controller.snapshot().promptSettings ?? {};
    if (el.dataset.role === 'prompt-pin') { const ids = new Set(settings.pinnedUnitIds ?? []); if (el.checked) ids.add(el.dataset.id!); else ids.delete(el.dataset.id!); settings.pinnedUnitIds = [...ids]; }
    else if (el.dataset.kind === 'unit') settings.unitScope = el.value as 'manual' | 'roster' | 'scene'; else settings.itemScope = el.value as 'all' | 'carried' | 'scene';
    state.saveReceipt = (await controller.setPromptSettings(settings)); render(); return;
  }
  if (e.target instanceof HTMLInputElement && ['prompt-enabled', 'prompt-unit', 'prompt-item'].includes(e.target.dataset.role ?? '')) {
    const input = e.target, settings = controller.snapshot().promptSettings ?? {};
    const id = input.dataset.section as PromptSectionId;
    const next = input.dataset.role === 'prompt-enabled'
      ? { ...settings, sections: { ...settings.sections, [id]: { ...settings.sections?.[id], enabled: input.checked } } }
      : selectPromptEntries(settings, input.dataset.role === 'prompt-unit' ? 'unit' : 'item', [input.dataset.id!], input.checked);
    const receipt = (await controller.setPromptSettings(next)); state.saveReceipt = receipt; if (receipt.status === 'failed') toast(receipt.error ?? '设置未保存'); render(); return;
  }

  if (e.target instanceof Element && inventoryPanel.handleChange(e.target)) return;
  const el = e.target as HTMLElement;
  const role = (el as HTMLElement).dataset?.role;
  if (el.closest('[data-builder-form]')) {
    const oldBody = state.form.body; captureForm(); builderPreview = undefined;
    if (role === 'gen-body') for (const slot of ['primary', 'sidearm', 'armor', 'shieldGear'] as const) if (state.form[slot].body === oldBody) state.form[slot].body = state.form.body;
    if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement && el.type === 'checkbox') render();
    return;
  }
  if ((role === 'formation-order' || role === 'formation-target') && state.mass?.rules.resolutionVersion === 'v2') {
    if (massAutoCommand() || state.mass.isOver() || state.mass.planningLocked) return;
    try {
      if (role === 'formation-order') setFormationChoice(state.mass, formationView, state.orderDraft, (el as HTMLSelectElement).value);
      else selectFormationUnit(state.mass, formationView, state.orderDraft, (el as HTMLSelectElement).value, true);
      render('view'); (await persist());
    } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
    render('view'); return;
  }
  if (role === 'grid-unit' || role === 'grid-mode' || role === 'grid-target') {
    const query = state.small?.battlefield ? selectTacticalElement(state.small, tacticalView,
      role === 'grid-mode' ? { mode: (el as HTMLSelectElement).value } : { unitId: (el as HTMLSelectElement).value, actor: role === 'grid-unit' }) : undefined;
    render('view', query);
  } else if (role === 'ability-confirm-target' && state.abilityDialog) {
    state.abilityDialog.suggestedTargetId = (el as HTMLSelectElement).value; render();
  } else if (role === 'story-sync') {
    (await controller.setStorySync((el as HTMLInputElement).checked));
  } else if (role === 'report-select') {
    reportRestartPreview=undefined;
    state.selectedReportId = (el as HTMLSelectElement).value; render();
  } else if (role === 'mode') {
    state.mode = (el as HTMLSelectElement).value as 'small' | 'mass';
    render();
  } else if (role === 'siege-attacker') {
    state.siegeAttacker = (el as HTMLSelectElement).value === 'enemy' ? 'enemy' : 'ally'; (await persist()); render();
  } else if (role === 'full-auto-battle') {
    try { if ((el as HTMLInputElement).checked) { battleSaveFailed = false; startFullAuto(); } else fullAuto.stop(); }
    catch (error) { fullAuto.stop(); toast(error instanceof Error ? error.message : String(error)); }
    render();
  } else if (role === 'auto-turn') {
    state.autoTurn = (el as HTMLInputElement).checked;
    if (state.small?.battlefield) (await runAuto());
    (await persist());
    render();
  } else if (role === 'auto-approve') {
    state.autoApprove = (el as HTMLInputElement).checked;
    (await persist());
    render();
  } else if (role === 'auto-settle') {
    state.autoSettleXp = (el as HTMLInputElement).checked;
    (await persist());
    render();
  } else if (role === 'auto-orders') {
    state.autoAllyOrders = (el as HTMLInputElement).checked;
    (await persist());
    render();
  } else if (role === 'context-field' || role === 'context-lighting') {
    if(currentBattle())return;
    const value=(el as HTMLSelectElement).value;
    if(role==='context-field')state.field=Object.hasOwn(FIELD_LABELS,value)&&value!=='night'?value:'plains';else state.lighting=value==='night'?'night':'day';
    await persist();render();
  } else if (role === 'map-layout' || role === 'objective-mode') {
    if (currentBattle()) return;
    const value = (el as HTMLSelectElement).value;
    if (role === 'map-layout') state.mapLayout = value === 'indoor' ? 'indoor' : 'standard';
    else state.objectiveMode = normalizeObjectiveMode(value);
    (await persist());
  } else if (role === 'small-target') {
    // 只记选择不重渲染：目标选择不引起界面重建（否则下拉会跳回第一项）
    state.smallTarget = (el as HTMLSelectElement).value;
  } else if (role === 'deploy-zone' || role === 'deploy-rank') {
    if (currentBattle()) return;
    const id = el.dataset.unit!;
    const unit = state.roster.find((u) => u.id === id);
    if (!unit) return;
    const value = (el as HTMLSelectElement).value;
    if (role === 'deploy-zone') {
      unit.tags = [...unit.tags.filter((t) => !t.startsWith('zone:')), ...(value ? [`zone:${value}`] : [])];
    } else {
      unit.tags = [...unit.tags.filter((t) => !t.startsWith('rank:')), `rank:${value}`];
    }
    const stored = state.storage.find((r) => r.id === id);
    if (stored) {
      stored.zone = formationZone(unit);
      stored.rank = formationRank(unit);
    }
    (await persist());
  } else if (role === 'order-type' || role === 'order-target') {
    // 军令草稿：只记选择不重渲染（否则「下完一个单位后其他单位下拉重置」——草稿保证 render 后仍回填）
    const unit = (el as HTMLElement).dataset.unit!;
    const row = el.closest('.orderline');
    const draft = state.orderDraft[unit] ?? {
      type: (row?.querySelector<HTMLSelectElement>('[data-role="order-type"]')?.value ?? 'attack') as Order['type'],
      targetId: row?.querySelector<HTMLSelectElement>('[data-role="order-target"]')?.value || undefined,
    };
    if (role === 'order-type') draft.type = (el as HTMLSelectElement).value as Order['type'];
    else draft.targetId = (el as HTMLSelectElement).value || undefined;
    state.orderDraft[unit] = draft;
    if (state.mass?.rules.resolutionVersion === 'v2') {
      const preview = el.closest('.orderline')?.querySelector('.order-preview');
      if (preview) preview.textContent = massOrderPreviewText(state.mass, { unitId: unit, ...draft });
    }
    (await persist());
  }
}
document.addEventListener('change', e => {
  if (e.target instanceof HTMLInputElement && e.target.dataset.role === 'llm-battle-scale') {
    try {
      const settings = readLlmSettings();
      settings.selectBattleScale = e.target.checked;
      saveLlmSettings(settings); llmContext.cancel(); llmDiagnostic = '已保存'; render('view');
    } catch (error) { toast(error instanceof Error ? error.message : '保存失败'); }
    return;
  }
  if (e.target instanceof HTMLSelectElement && ['llm-mode', 'llm-model-list'].includes(e.target.dataset.role ?? '')) {
    try {
      const settings = readLlmSettings();
      if (e.target.dataset.role === 'llm-mode') settings.enabled = e.target.value === 'llm';
      else settings.model = e.target.value;
      saveLlmSettings(settings); llmContext.cancel(); llmDiagnostic = '已保存'; render('view');
    } catch (error) { toast(error instanceof Error ? error.message : '保存失败'); }
    return;
  }
  if (e.target instanceof HTMLInputElement && e.target.dataset.role?.startsWith('llm-')) return;

  if (e.target instanceof HTMLInputElement && e.target.dataset.role === 'full-auto-battle' && !e.target.checked) {
    stopAutomation(); render('battle'); return;
  }
  // Text/number drafts are captured on input. Making the document inert during
  // their blur/change steals focus from the next field before typing begins.
  if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
    if (e.target.closest('[data-builder-form]')) return;
    if (inventoryPanel.handleChange(e.target)) return;
  }
  void panelTask(() => handleChange(e));
});

// 聊天/角色卡切换：重新同步存档（事件 + 轮询双保险都在适配层内处理）
const stopControllerView = controller.listen((_saved: NarrativeSave, receipt?: SaveReceipt) => {
  restore();
  if (receipt) {
    state.saveReceipt = receipt;
    if (receipt.status !== 'failed') battleSaveFailed = false;
  }
  state.lastInvalid = [];
  render();
  void resumeSmallTurnIfNeeded();
});
window.addEventListener('pagehide', stopControllerView);
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source === window.parent && event.origin === location.origin && event.data?.type === 'tb:panel-hidden') {
    const wasRunning = fullAuto.running; stopAutomation(); if (wasRunning) render('battle');
  }
});
let formationResizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(formationResizeFrame);
  formationResizeFrame = requestAnimationFrame(() => {
    const camera = document.querySelector<HTMLElement>('.formation-map-camera');
    const selected = camera?.querySelector<HTMLElement>('.formation-piece.active');
    if (camera && selected && camera.offsetParent) {
      camera.scrollTop += selected.getBoundingClientRect().top - camera.getBoundingClientRect().top - (camera.clientHeight - selected.offsetHeight) / 2;
    }
  });
});

// 新消息（AI 回复后）：自动扫描待审标签（事件 + 轮询兜底；已处理的 raw 不会重复录入）。
// 生成未定稿（部分版本的 MESSAGE_RECEIVED 早于流式结束）不扫半截文本——
// GENERATION_ENDED / 生成结束后的轮询周期会再触发完整扫描。
// 界面只在确有变化时刷新——避免编辑编制时被无关重渲染打断。

// loader 常驻监听的戳动：面板开着时，宿主「生成完毕」事件直接通知本窗立刻扫描
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window.parent || e.origin !== window.location.origin) return;
  if ((e.data as { type?: string } | null)?.type !== 'tb:scan-now') return;
  if (adapter.isGenerating()) return;
  clearScanPendingMarker();
  void scanLastMessage().then((changed) => {
    if (changed && !state.editingUnit) render();
  });
});

// 玩家点击发送、AI 生成前：静默注入编制储存器单位清单 + 战前后态势。
// 只在宿主支持 setExtensionPrompt 时生效；失败自动降级（不注入不报错，面板状态标签提示）。

restore();
render();
void resumeSmallTurnIfNeeded();
// 面板（重）打开：补扫关闭期间完成的生成（无标记或标记不比上次扫描新则不动）
catchUpScan();

document.addEventListener('keydown', event => {
  const dialog = document.querySelector<HTMLElement>('.inventory-editor'); if (!dialog) return;
  if (event.key === 'Escape') { event.preventDefault(); void inventoryPanel.handleAction(dialog.querySelector<HTMLElement>('[data-action="inventory-close-draft"]')!); return; }
  if (event.key !== 'Tab') return;
  const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(el => el.getClientRects().length);
  if (!controls.length) return;
  const first = controls[0]!, last = controls.at(-1)!;
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});
