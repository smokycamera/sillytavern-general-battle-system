import { PROMPT_SECTIONS, formatPromptSection, promptSelected, unitInPromptScope, itemInPromptScope, type ProjectionDetails, type PromptSettings, type PromptSectionId } from './prompt-settings.js';
import { skillMechanismName } from '../../engine/src/data/skill-mechanisms.js';
import { spCapacity } from '../../engine/src/resources.js';
import { xpProgress } from '../../engine/src/xp.js';
import {hasMemberHealth,memberHealth,memberHealthMax} from '../../engine/src/member-health.js';
import { prepareReportDeletion, prepareReportRestore, prepareReportRestart, stampNewBattleReports } from './report-history.js';
/** 常驻事实控制器：不依赖面板 DOM，不在后台推进战斗。 */
import type { SaveReceipt, TavernAdapter } from './tavern.js';
import { prepareBattleItemWrite } from './battle-items.js';
import { assertTraitSourcePanelWrite, prepareBlessingRevocation } from './trait-state.js';
import { moraleLabel, woundedLabel, isAirborne, positionedUnit, observedUnits, concealmentLabel, formationNode, type ObservationContext, traitSourceActive, traitRegistry, standardConditionMap, STANDARD_CONDITIONS, postureLabel, type Combatant } from '../../engine/src/index.js';
import { reviewMigration, type MigrationReview } from './migration-review.js';
import { assertInventoryPanelWrite, calibrateSavedWeaponRanges, deleteUnitArchive, prepareInventoryState, prepareInventoryTransaction, type InventoryAction, type InventoryIntent, type InventorySave } from './inventory-state.js';
import { cellLabel, type BattlefieldSpec } from '../../engine/src/small/spatial.js';
import {
  captureGeneration, factsOf, restoreNarrativeDeployment, messageSourceKey, namespaceOf, prepareNarrativeTransaction, proposalFromMessage,
  compactNarrativeSources, deleteNarrativeRecords, narrativeReceiptKey,
  type GenerationBinding, type NarrativeSave, type NarrativeProposal,
} from './narrative-state.js';

import { RUNTIME_REMINDER } from './narrative-prompt.js';
import { parseProtocol, protocolExcerpt } from './protocol.js';
const promptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

const PROMPT_ID = 'tavern-battle:context';
export function narrativeProjection(save: NarrativeSave, requestText = '', details?: ProjectionDetails): string {
  const settings = save.promptSettings;
  const blocks: Record<PromptSectionId, string[]> = { settlement: [], facts: [], units: [], mission: [], items: [], phase: [], reminder: [] };
  const lines = blocks.facts;
  const battleId = save.battle ? `${save.battle.kind}:${String(save.battle.snap.seed)}` : undefined;
  const battleOpen = !!battleId && !(save.committedOutcomeIds ?? []).includes(battleId);
  const combatants = battleOpen && Array.isArray(save.battle?.snap.combatants) ? save.battle!.snap.combatants as Combatant[] : [];
  const field = save.battle?.snap.battlefield as BattlefieldSpec | undefined;
  const limited = battleOpen && combatants.some((u) => u.rulesVersion === 'v2');
  const observation: ObservationContext = { units: combatants, mode: save.battle?.kind ?? 'small', fieldTags: save.battle?.snap.fieldTags as string[] ?? field?.environment ?? [],
    battlefield: field, attached: new Map(save.battle?.snap.attached as [string, string][] ?? []) };
  const visible = new Set((limited ? observedUnits(observation, 'ally') : combatants).map((u) => u.id));
  const canInclude = (record: { id: string; side: string }) => !limited || record.side === 'ally' || visible.has(record.id);
  const roster = new Set(save.rosterIds ?? []);
  const relevant = (r: { id: string; name: string }) => requestText.includes(r.id) || r.name.length > 1 && requestText.includes(r.name);
  let inventory: InventorySave['inventory'] = [];
  try { inventory = prepareInventoryState(save).inventory; } catch { /* 坏项由迁移/库存界面说明，不注入不可用物品引用。 */ }
  const equipment = (inventory ?? []).filter((i) => i.qty > 0 && promptSelected(settings, 'item', i.id) && (!i.assignedTo || !limited || save.storage?.some((r) => r.id === i.assignedTo && canInclude(r)))).sort((a, b) => Number(relevant(b)) - Number(relevant(a)) || Number(roster.has(b.assignedTo ?? '')) - Number(roster.has(a.assignedTo ?? '')) || (b.revision ?? 1) - (a.revision ?? 1));
  const allRecords = [...(save.storage ?? [])].filter(canInclude);
  const records = allRecords.filter((r) => promptSelected(settings, 'unit', r.id)
    && unitInPromptScope(settings, r.id, roster.has(r.id), relevant(r))
    && (!battleOpen || combatants.some((u) => u.id === r.id) || relevant(r) || settings?.pinnedUnitIds?.includes(r.id))).sort((a, b) => Number(relevant(b)) - Number(relevant(a)) || Number(roster.has(b.id)) - Number(roster.has(a.id)) || (b.revision ?? 1) - (a.revision ?? 1));
  lines.push(`本场${limited ? '已知' : ''}参战${allRecords.filter((r) => roster.has(r.id)).length}张单位卡；编队人数另计，旧档仓库数量不等于参战数量。`);
  lines.push(`环境：${battleOpen ? (save.battle?.snap.fieldTags as string[] | undefined)?.join('/') ?? 'plains' : (save.field || 'plains') + (save.lighting === 'night' && save.field !== 'night' ? '/night' : '')}；本场场景以快照为准。`);
  if (battleOpen && field) {
    const goal = field.objective;
    const owner = goal.kind === 'escape' ? combatants.find((u) => u.id === goal.unitId)?.side : undefined;
    blocks.mission.push(`当前地图${field.width}×${field.height}${goal.kind === 'annihilation' ? '' : '，任务格' + cellLabel(field, goal.cell)}，第${save.battle?.snap.round ?? 1}/${goal.limit}轮；移动/位置以引擎为准。`);
    blocks.mission.push(goal.kind === 'annihilation' ? '任务：歼灭战，使敌方全部失去作战能力获胜，无占点胜利。' : goal.kind === 'control' ? `任务：${goal.attackingSide ? (goal.attackingSide === 'ally' ? '我方进攻、敌方防守' : '我方防守、敌方进攻') + '；仅攻方可占点获胜，守方坚持至期限获胜' : '双方争夺'}，占领当轮不计，连续控制${goal.rounds}个完整回合可胜；当前进展${promptJson(save.battle?.snap.controlRounds ?? {})}。`
      : `任务：${owner === 'enemy' ? '我方拦截敌方护送' : '我方护送、敌方拦截'}；对象${visible.has(goal.unitId) ? promptJson(goal.unitId) : '尚未观测'}，地面抵达则护送方胜；${goal.defenderWins ? '消灭、撤离或逾期则拦截方胜' : '旧规则逾期僵持'}。`);
  }
  if (limited) blocks.mission.push('仅列我方与当前已观测敌军；未列出的敌军位置、兵力与行动未知，不补写隐藏事实。');
  for (const record of records) {
    const live = combatants.find((c) => c.id === record.id);
    const unit = live ?? record.snapshot;
    const physical = live && positionedUnit(observation, live);
    const effects = unit?.traitSources?.filter((s) => traitSourceActive(unit, s)).map((s) => ({ source: s.id, name: s.name,
      ...(s.traitIds.length ? { traits: s.traitIds.map((id) => traitRegistry().get(id)?.name ?? id) } : {}),
      ...(s.conditionIds?.length ? { effects: s.conditionIds.map((id) => standardConditionMap().get(id)?.name ?? id) } : {}),
      duration: s.duration.kind, remaining: s.remaining }));
    const line = promptJson({ id: record.id, name: record.name, side: record.side, training:record.level, bonuses:unit?.bonuses,
      ...(!battleOpen ? { level:record.level,xp:record.xp ?? 0,xpProgress:unit?xpProgress(unit)?.current:undefined,base:record.base,status:record.status,retired:record.retired,resources:unit?.resources,traits:unit?.traits,speedTier:unit?.speedTier,conditions:record.conditions,preparedAbilityIds:unit?.preparedAbilityIds } : {}),
      semantics: record.scale === 'hero' ? '生命' : unit?.body==='vehicle'?'载具数量':'人数', hp: live?.hp ?? record.hp, hpMax: live?.base.hpMax ?? record.base.hpMax,
      ...(unit&&hasMemberHealth(unit)?{memberHpMax:unit.formation!.memberHp,totalLife:memberHealth(unit),totalLifeMax:memberHealthMax(unit),memberHealth:unit.formation!.health}:{}),
      ...(live && live.rulesVersion === 'v2' && moraleLabel({ ...observation, units: combatants.filter((u) => visible.has(u.id)) }, live) ? { morale: moraleLabel({ ...observation, units: combatants.filter((u) => visible.has(u.id)) }, live) } : {}),
      ...(woundedLabel(live ?? record) ? { recovery: woundedLabel(live ?? record) } : {}),
      state: record.retired ? '已解散，不可调取' : ({ ready: '可行动', dying: '倒地失去战斗力（尚未死亡，不代表持续濒死；恢复以最新生命和状态为准）', dead: '死亡', routing: '溃退中，尚未离场', fled: '已撤离战场' }[live?.status ?? record.status ?? 'ready']),
      ...(physical?.airborne !== undefined ? { layer: isAirborne(physical) ? '空中' : '地面' } : {}),
      ...(live && concealmentLabel(observation, live) ? { concealment: concealmentLabel(observation, live) } : {}),
      ...(unit?.tacticalPose ? { posture: postureLabel(unit, standardConditionMap()) } : {}),
      ...(live && observation.mode === 'mass' && live.rulesVersion === 'v2' ? { formation: (formationNode(physical ?? live).side === 'ally' ? '我方阵地/' : '敌方阵地/') + formationNode(physical ?? live).wing + '/' + ({ front: '前线', rear: '支援', reserve: '预备' }[formationNode(live).rank]) } : {}),
      ...(field && live?.pos !== undefined ? { position: cellLabel(field, live.pos), suppressed: !!live.suppression } : {}),
      ...(live?.conditions.some((c) => c.dur > 0) ? { conditions: live.conditions.filter((c) => c.dur > 0).map((c) => (standardConditionMap().get(c.id)?.name ?? c.id) + c.dur + '轮') } : {}),
      ...(live?.side === 'ally' ? { SP: `${live.resources.SP ?? 0}/${spCapacity(live)}` } : {}),
      skills: unit?.rulesVersion === 'v2' && unit.abilities.length ? unit.abilities.filter((a) => !a.itemSourceId && (!battleOpen || /学习|技能|learn/.test(requestText) || unit.preparedAbilityIds?.includes(a.id))).map((a) => battleOpen && !/学习|技能|learn/.test(requestText)
        ? { name: a.name, cooldown: unit.abilityState.find((s) => s.abilityId === (a.cooldownGroup ?? a.id))?.cdLeft || undefined }
        : { id:a.id, definitionId:a.definitionId, name: a.name, mechanism: skillMechanismName(a.definitionId ?? '') || a.definitionId, power: a.fixedPower ? undefined : a.power, bonuses:a.bonuses, prepared: unit.preparedAbilityIds?.includes(a.id) }) : undefined,
      ...(!battleOpen && /修改|调整|数值|属性|unit_set/.test(requestText) ? { editable: { formation:unit?.formation,abilities:unit?.abilities,traitSources:unit?.traitSources,trinkets:unit?.trinkets,abilityState:unit?.abilityState,fatigue:unit?.fatigue,weapon:unit?.weapon,sidearm:unit?.sidearm,armor:unit?.armor,shield:unit?.shield,xpValue:unit?.xpValue } } : {}),
      body: unit?.rulesVersion === 'v2' && unit.body !== 'human' ? unit.body : undefined, mount: unit?.mount || undefined,
      weapon: unit?.weapon?.name, sidearm: unit?.sidearm?.name, armor: unit?.armor?.name, ...(effects?.length ? { effects } : {}) });
    blocks.units.push(line);
    details?.units.push({id: record.id, name: record.name, reason: settings?.pinnedUnitIds?.includes(record.id) ? '固定关注' : roster.has(record.id) ? '当前参战' : relevant(record) ? '正文提及' : '手动勾选'});
  }
  for (const item of equipment) {
    if (!itemInPromptScope(settings, !!item.assignedTo && roster.has(item.assignedTo), relevant(item))) continue;
    // 战内禁止物品档案事件，装备名称已随单位给出；仅按明确查询展开库存规格。
    if (battleOpen && !relevant(item) && !/物品|背包|库存|装备|配装/.test(requestText)) continue;
    const m = item.mechanics;
    const recipe = m?.kind === 'consumable' ? m.recipe : m?.value.recipe;
    blocks.items.push(promptJson({ id: item.id, name: item.name, qty: item.qty, owner: item.assignedTo, slot: item.equippedTo?.slot,
      kind: m?.kind ?? item.lootType, mechanism: recipe?.mechanism, power: recipe?.power, bonuses:recipe?.bonuses, enchant: recipe?.enchantment,
      quality: recipe?.quality, body: recipe?.size, stabilized: recipe?.stabilized, protection: recipe?.protectionProfile, note: item.note }));
    details?.items.push({id: item.id, name: item.name, reason: item.assignedTo && roster.has(item.assignedTo) ? '参战队伍携行' : relevant(item) ? '正文提及' : '手动勾选'});
  }
  blocks.phase.push(battleOpen ? '当前战斗/战果待提交，正文不能更新档案。' : '当前可进行战外档案事件。');
  const output = PROMPT_SECTIONS.filter((section) => section.id !== 'settlement').map((section) => formatPromptSection(settings, section.id, blocks[section.id].join('\n'))).filter(Boolean).join('\n');
  if (details) {
    details.chars = output.length;
    for (const id of ['units', 'items'] as const) if (settings?.sections?.[id]?.enabled === false || !(settings?.sections?.[id]?.template ?? '{{content}}').includes('{{content}}')) details[id] = [];
  }
  return output;
}
export function narrativeProjectionDetails(save: NarrativeSave, requestText = ''): ProjectionDetails {
  const details: ProjectionDetails = {chars:0,units:[],items:[]}; narrativeProjection(save, requestText, details); return details;
}

/** 不同宿主可能发送数字、数字字符串或消息对象。 */
function eventMessageId(value: unknown): number | undefined {
  if (value && typeof value === 'object') { const v = value as Record<string, unknown>; value = v.message_id ?? v.messageId ?? v.id; }
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

type Listener = (save: NarrativeSave, receipt?: SaveReceipt) => void;
export interface InventoryPreview {
  context: string; action: InventoryAction; intent: InventoryIntent; before: InventorySave; after: InventorySave;
}
export class NarrativeController {
  private state: NarrativeSave;
  private namespace: string | undefined;
  private identity: string;
  private epoch = 0;
  private binding?: GenerationBinding;
  private receivedId?: number;
  private generationEnded = false;
  private disposers: (() => void)[] = [];
  private listeners = new Set<Listener>();
  private active = true;
  private reading = false;
  private queuedScan?: { epoch: number; messageId?: number };
  private lastReceipt?: SaveReceipt;
  private migration?: MigrationReview;
  readonly capabilities = { beforeGeneration: false, generationEnded: false, messageIdentity: false, injection: false };

  constructor(private adapter: TavernAdapter) {
    this.state = compactNarrativeSources(adapter.load<NarrativeSave>('panel') ?? {});
    this.migration = reviewMigration(this.state);
    if (this.migration) this.state = structuredClone(this.migration.candidate);
    calibrateSavedWeaponRanges(this.state);
    this.identity = adapter.identity(); this.namespace = adapter.namespace();
    const bind = (kind: string, handler: (...args: unknown[]) => void) => {
      const result = adapter.subscribe(kind, handler); this.disposers.push(result.stop); return result.available;
    };
    // AFTER_COMMANDS 会覆盖普通发送、继续与重生成；缺少时降级 STARTED，并在状态中如实标记。
    const before = (...args: unknown[]) => { if (args[2] !== true) this.beginGeneration(); };
    this.capabilities.beforeGeneration = bind('GENERATION_AFTER_COMMANDS', before);
    if (!this.capabilities.beforeGeneration) this.capabilities.beforeGeneration = bind('GENERATION_STARTED', before);
    bind('MESSAGE_RECEIVED', (value) => {
      const id = eventMessageId(value);
      if (this.binding && id !== undefined) {
        this.receivedId = id;
        if (this.generationEnded && (!this.binding.messageId || this.binding.messageId === String(id))) {
          this.binding.complete = true; this.binding.messageId = String(id); void this.scan(id);
        }
      } else void this.scan(id);
    });
    this.capabilities.generationEnded = bind('GENERATION_ENDED', (value) => {
      this.generationEnded = true;
      const id = eventMessageId(value) ?? this.receivedId;
      if (this.binding) {
        this.binding.complete = id !== undefined && (this.receivedId === undefined || id === this.receivedId);
        this.binding.messageId = this.binding.complete ? String(id) : undefined;
      }
      void this.scan(id);
    });
    bind('GENERATION_STOPPED', () => { this.binding = undefined; this.receivedId = undefined; void this.scan(); });
    bind('MESSAGE_EDITED', () => { this.binding = undefined; void this.scan(); });
    bind('MESSAGE_SWIPED', () => { this.binding = undefined; void this.scan(); });
    bind('CHAT_CHANGED', () => this.switchContext());
    bind('MESSAGE_SENT', () => this.project());
    const timer = setInterval(() => {
      if (this.identity !== adapter.identity() || this.namespace !== adapter.namespace()) this.switchContext();
    }, 1500);
    this.disposers.push(() => clearInterval(timer));
    this.project();
  }
  snapshot(): NarrativeSave { return structuredClone(this.state); }
  migrationReview(): MigrationReview | undefined { return this.migration ? structuredClone(this.migration) : undefined; }
  acceptMigration(): SaveReceipt {
    const review = this.migration;
    if (!review) throw new Error('没有待接受的迁移预览');
    this.migration = undefined;
    const receipt = this.write({ ...review.candidate, migrationBackups: [
      ...(Array.isArray(review.original.migrationBackups) ? review.original.migrationBackups : []),
      { createdAt: new Date().toISOString(), source: { ...review.original, migrationBackups: undefined } },
    ] });
    if (receipt.status === 'failed') this.migration = review;
    this.notify(); return receipt;
  }
  restoreMigrationBackup(): SaveReceipt {
    const backups = this.state.migrationBackups;
    if (!Array.isArray(backups) || !backups.length) throw new Error('没有可恢复的迁移备份');
    const battle = this.state.battle;
    if (battle && !(this.state.committedOutcomeIds ?? []).includes(`${battle.kind}:${String(battle.snap.seed)}`)) throw new Error('先结束并归档当前战斗，再恢复旧备份');
    if (this.identity !== this.adapter.identity() || this.namespace !== this.adapter.namespace()) throw new Error('聊天已切换，不能恢复旧回调');
    const original = structuredClone(backups.at(-1).source) as NarrativeSave;
    const receipt = this.adapter.save('panel', original, 'chat'); this.lastReceipt = receipt;
    if (receipt.status !== 'failed') {
      this.migration = reviewMigration(original); this.state = structuredClone(this.migration?.candidate ?? original);
      this.binding = undefined; this.epoch++; this.project(); this.notify();
    }
    return receipt;
  }
  listen(callback: Listener): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  private notify(): void { for (const listener of this.listeners) listener(this.snapshot(), this.lastReceipt); }
  private project(): void { this.capabilities.injection = this.adapter.injectPrompts([{ id: PROMPT_ID, content: this.migration ? '【战阵】旧存档或坏项正等待玩家核对迁移预览；暂不执行正文档案事件。' : narrativeProjection(this.state, this.adapter.recentPromptText?.() ?? '') }]); }
  private switchContext(): void {
    this.epoch++; this.binding = undefined; this.receivedId = undefined;
    this.queuedScan = undefined;
    this.adapter.uninjectPrompts(PROMPT_ID);
    this.identity = this.adapter.identity(); this.namespace = this.adapter.namespace();
    this.state = compactNarrativeSources(this.adapter.load<NarrativeSave>('panel') ?? {});
    this.migration = reviewMigration(this.state);
    if (this.migration) this.state = structuredClone(this.migration.candidate);
    calibrateSavedWeaponRanges(this.state);
    this.lastReceipt = undefined; this.project(); this.notify();
  }
  private write(next: NarrativeSave, notify = true): SaveReceipt {
    if (this.migration) return { status: 'failed', host: false, local: false, error: '请先核对并接受迁移预览；原始存档尚未改写' };
    if (!this.active || this.identity !== this.adapter.identity() || this.namespace !== this.adapter.namespace()) return { status: 'failed', host: false, local: false, error: '聊天已切换，旧回调已拒绝' };
    next = compactNarrativeSources(next);
    const receipt = this.adapter.save('panel', next, 'chat');
    this.lastReceipt = receipt;
    if (receipt.status !== 'failed') { this.state = structuredClone(next); this.project(); }
    if (notify) this.notify();
    return receipt;
  }
  /** 面板写入也通过当前控制器；UI 变化不递增事实版本。 */
  persistPanel(next: NarrativeSave, expectedRevision: number): { receipt: SaveReceipt; revision: number } {
    if (expectedRevision !== (this.state.factRevision ?? 0)) return { receipt: { status: 'failed', host: false, local: false, error: '面板已过期，请重新载入最新档案' }, revision: this.state.factRevision ?? 0 };
    try { assertInventoryPanelWrite(this.state, next); assertTraitSourcePanelWrite(this.state, next); next = prepareBattleItemWrite(this.state, next); }
    catch (error) { return { receipt: { status: 'failed', host: false, local: false, error: String(error) }, revision: this.state.factRevision ?? 0 }; }
    stampNewBattleReports(this.state,next);
    const changed = factsOf(next) !== factsOf(this.state);
    next = { ...next, promptSettings: this.state.promptSettings, proposals: this.state.proposals ?? [], storySync: this.state.storySync ?? false,
      committedNarrativeSources: this.state.committedNarrativeSources, deletedNarrativeReceipts: this.state.deletedNarrativeReceipts,
      inventoryOperations: this.state.inventoryOperations,
      ...(this.state.inventoryMigrationBackup ? { inventoryMigrationBackup: this.state.inventoryMigrationBackup } : {}),
      ...(this.state.migrationBackups ? { migrationBackups: this.state.migrationBackups } : {}),
      factRevision: (this.state.factRevision ?? 0) + (changed ? 1 : 0) };
    const receipt = this.write(next, false);
    return { receipt, revision: this.state.factRevision ?? 0 };
  }
  setPromptSettings(settings: PromptSettings): SaveReceipt { return this.write({ ...this.state, promptSettings: structuredClone(settings) }, false); }
  setStorySync(enabled: boolean): SaveReceipt { return this.write({ ...this.state, storySync: enabled }); }
  deleteBattleReport(id: string): SaveReceipt { return this.write(prepareReportDeletion(this.state,id)); }
  restoreBattleReport(): SaveReceipt { return this.write(prepareReportRestore(this.state)); }
  restartBattleReport(id: string, expectedRevision: number, seed: string): SaveReceipt { return this.write(prepareReportRestart(this.state,id,expectedRevision,seed)); }
  revokeBlessing(unitId: string, sourceId: string, expectedRevision: number, context: string): SaveReceipt {
    if (context !== this.inventoryContext() || expectedRevision !== (this.state.factRevision ?? 0)) throw new Error('祝福操作属于旧上下文/版本，请重新查看');
    return this.write(prepareBlessingRevocation(this.state, unitId, sourceId));
  }
  inventoryAction(intent: InventoryIntent): SaveReceipt {
    return this.write(prepareInventoryTransaction(this.state, intent));
  }
  inventoryContext(): string { return JSON.stringify([this.identity, this.namespace, this.epoch]); }
  previewInventory(action: InventoryAction, id: string = crypto.randomUUID()): InventoryPreview {
    if (this.migration) throw new Error('先核对迁移预览，再操作库存');
    if (!this.active || this.identity !== this.adapter.identity() || this.namespace !== this.adapter.namespace()) throw new Error('聊天上下文正在切换，请重新预览');
    const intent = { ...structuredClone(action), id, expectedRevision: this.state.factRevision ?? 0 };
    return { context: this.inventoryContext(), action: structuredClone(action), intent,
      before: this.snapshot(), after: prepareInventoryTransaction(this.state, intent) };
  }
  commitInventoryPreview(preview: InventoryPreview): SaveReceipt {
    if (preview.context !== this.inventoryContext()) throw new Error('库存预览属于旧聊天/上下文，请重新预览');
    return this.inventoryAction(preview.intent);
  }
  beginGeneration(): void {
    if (!this.active || this.migration) return;
    if (this.identity !== this.adapter.identity() || this.namespace !== this.adapter.namespace()) this.switchContext();
    this.receivedId = undefined; this.generationEnded = false;
    this.binding = this.namespace ? captureGeneration(this.state, this.namespace, crypto.randomUUID()) : undefined;
    this.project();
  }
  async scan(messageId?: number): Promise<void> {
    if (!this.active || this.migration || this.adapter.isGenerating()) return;
    // 宿主读取可能跨越下一次生成完成；保留最新信号，不能因旧读取占用而丢掉最终正文。
    if (this.reading) { this.queuedScan = { epoch: this.epoch, messageId }; return; }
    this.reading = true;
    const epoch = this.epoch; const binding = this.binding ? structuredClone(this.binding) : undefined;
    try {
      const envelope = await this.adapter.getEnvelope(messageId);
      if (!envelope || !this.active || epoch !== this.epoch || binding?.id !== this.binding?.id || binding?.complete !== this.binding?.complete || binding?.messageId !== this.binding?.messageId || this.identity !== this.adapter.identity() || this.namespace !== this.adapter.namespace()) return;
      if (envelope.role !== 'assistant') return;
      this.capabilities.messageIdentity = !!envelope.messageId && !!envelope.swipeId && !!this.namespace;
      let expected = binding;
      const matchesGeneration = binding?.complete && binding.messageId === envelope.messageId;
      if (!matchesGeneration && envelope.complete && this.capabilities.messageIdentity && namespaceOf(envelope) === this.namespace) {
        expected = { ...captureGeneration(this.state, this.namespace!, crypto.randomUUID()), complete: true, manualOnly: true, messageId: envelope.messageId };
      }
      if (expected?.complete && this.capabilities.messageIdentity) envelope.generationId = expected.id;
      const proposal = proposalFromMessage(envelope, expected);
      if (!proposal) return;
      if (this.state.committedNarrativeSources?.includes(proposal.sourceKey) || this.state.deletedNarrativeReceipts?.includes(narrativeReceiptKey(proposal))) return;
      const existing = (this.state.proposals ?? []).filter((p) => p.sourceKey === proposal.sourceKey);
      const same = existing.find((p) => (p.canonical === proposal.canonical || p.status === 'committed' && parseProtocol(p.source.text).canonical === proposal.canonical) && p.source.swipeId === envelope.swipeId && (!!proposal.canonical || p.source.text === proposal.source.text));
      // 初读缺少完成信号时保留的候选，在可靠性补齐后原位升级，不能被正文去重吞掉。
      const upgrade = same && ((same.status === 'legacy' || same.status === 'unresolved' && same.reason?.startsWith('已识别')) && proposal.status === 'pending'
        || same.status === 'pending' && same.expected?.manualOnly && proposal.status === 'pending' && !proposal.expected?.manualOnly);
      if (same && !upgrade) return;
      if (upgrade) proposal.id = same.id;
      if (existing.some((p) => p.status === 'committed')) { proposal.status = 'stale'; proposal.reason = '此消息已同步；修改不会重复创建单位。可恢复原批次参战单位，新增内容请使用新消息'; }
      const proposals = (this.state.proposals ?? []).filter((p) => !upgrade || p.id !== same!.id).map((p): NarrativeProposal => p.sourceKey === proposal.sourceKey && ['pending', 'legacy', 'failed', 'unresolved'].includes(p.status) ? { ...p, status: 'stale', reason: '已被新消息修订替代' } : p);
      const candidate = { ...this.state, proposals: [...proposals, proposal] };
      if (proposal.status === 'pending' && !proposal.expected?.manualOnly && candidate.storySync && proposal.events.every((e) => ['unit-set', 'unit-update', 'deploy'].includes(e.kind))) {
        try {
          const next = prepareNarrativeTransaction(candidate, proposal, this.namespace!);
          if (this.write(next).status !== 'failed') return;
          proposal.status = 'failed'; proposal.reason = '保存失败，整批未提交，可重试';
        } catch (error) { proposal.reason = String(error); proposal.status = /过期|聊天|分支|战内|未结算/.test(proposal.reason) ? 'stale' : 'unresolved'; }
      }
      const receipt = this.write(candidate);
      if (receipt.status === 'failed') { this.state = candidate; this.notify(); }
    } finally {
      this.reading = false;
      const queued = this.queuedScan; this.queuedScan = undefined;
      if (queued?.epoch === this.epoch) await this.scan(queued.messageId);
    }
  }
  deleteUnit(id: string): SaveReceipt { return this.write(deleteUnitArchive(this.state, id)); }
  restoreDeployment(id: string): SaveReceipt {
    const p = this.state.proposals?.find((item) => item.id === id);
    if (!p || namespaceOf(p.source) !== this.namespace) throw Error('请选择当前聊天的同步记录');
    return this.write(restoreNarrativeDeployment(this.state, id));
  }
  approve(id: string): SaveReceipt {
    const proposal = this.state.proposals?.find((p) => p.id === id);
    if (!proposal) throw new Error('候选不存在');
    if (proposal.status === 'failed') proposal.status = 'pending';
    if (proposal.status !== 'pending') throw new Error('候选未处于可提交状态');
    if (!this.namespace) throw new Error('宿主缺少聊天/角色身份，不能安全提交');
    try { return this.write(prepareNarrativeTransaction(this.state, proposal, this.namespace, true)); }
    catch (error) {
      this.write({ ...this.state, proposals: this.state.proposals?.map((p) => p.id === id ? { ...p, status: 'unresolved', reason: String(error) } : p) });
      throw error;
    }
  }
  /** 本地修正先形成可审查的新候选；不会改宿主正文或自动发放任何内容。 */
  correctProposal(id: string, text: string): SaveReceipt {
    const old = this.state.proposals?.find((p) => p.id === id);
    if (!old || !this.namespace || old.status === 'committed') throw new Error('没有可修正的事件草稿');
    if (!this.active || this.identity !== this.adapter.identity() || this.namespace !== this.adapter.namespace() || namespaceOf(old.source) !== this.namespace) throw new Error('聊天已切换，请重新查看当前记录');
    if (this.state.committedNarrativeSources?.includes(old.sourceKey) || this.state.proposals?.some((p) => p.sourceKey === old.sourceKey && p.status === 'committed')) throw new Error('此消息已同步，不能通过草稿重复入账');
    if (old.source.role !== 'assistant' || !old.source.complete) throw new Error('需要完整assistant回复才能修正并提交事件');
    const binding = captureGeneration(this.state, this.namespace, crypto.randomUUID()); binding.complete = true;
    const proposal = proposalFromMessage({ ...old.source, text, generationId: binding.id }, binding);
    if (!proposal) throw new Error('草稿里尚未识别到事件标签');
    proposal.corrected = true; proposal.originalText = old.originalText ?? old.source.text;
    return this.write({ ...this.state, proposals: [...(this.state.proposals ?? []).map((p): NarrativeProposal => p.id === id ? { ...p, status: 'stale', reason: '已由本地修正草稿替代' } : p), proposal] });
  }
  /** 手动重新预览缺绑定的完整消息：生成一个绑定当前事实的候选，不直接执行。 */
  async rebind(id: string): Promise<void> {
    const old = this.state.proposals?.find((p) => p.id === id);
    if (!old || !this.namespace || !['legacy', 'stale'].includes(old.status)) throw new Error('缺少可重新预览的候选或可靠身份');
    if (old.corrected) {
      const receipt = this.correctProposal(id, old.source.text);
      if (receipt.status === 'failed') throw new Error(receipt.error ?? '草稿未保存');
      return;
    }
    const epoch = this.epoch;
    const current = await this.adapter.getEnvelope(Number(old.source.messageId));
    if (epoch !== this.epoch || !current || current.role !== 'assistant' || !current.complete || namespaceOf(current) !== this.namespace || protocolExcerpt(current.text) !== old.source.text || current.swipeId !== old.source.swipeId) throw new Error('原消息事件已变更/未完成，需重新扫描');
    if (this.state.committedNarrativeSources?.includes(messageSourceKey(current)) || this.state.proposals?.some((p) => p.sourceKey === messageSourceKey(current) && p.status === 'committed')) throw new Error('已提交消息不能重新入账');
    const binding = captureGeneration(this.state, this.namespace, crypto.randomUUID()); binding.complete = true;
    current.generationId = binding.id;
    const proposal = proposalFromMessage(current, binding)!;
    this.write({ ...this.state, proposals: [...(this.state.proposals ?? []).map((p): NarrativeProposal => p.id === old.id ? { ...p, status: 'stale' } : p), proposal] });
  }
  reject(id: string): SaveReceipt {
    return this.write({ ...this.state, proposals: this.state.proposals?.map((p) => p.id === id && p.status !== 'committed' ? { ...p, status: 'rejected' } : p) });
  }
  deleteRecords(ids?: string[]): SaveReceipt { return this.write(deleteNarrativeRecords(this.state, ids)); }
  dispose(): void {
    this.active = false; this.epoch++; this.disposers.forEach((stop) => stop()); this.listeners.clear(); this.adapter.uninjectPrompts(PROMPT_ID);
  }
}
