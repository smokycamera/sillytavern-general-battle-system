import { prepareClassMigration } from '../../panel/src/arms-v2.js';
import { randomId } from '../../host/src/browser-compat.js';
import type { PersistReceipt, HostSession, MessageTag } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import { NativeHost } from '../../host/src/sillytavern.js';
import { errorText, NativeStore, type DiscardResult } from './native-store.js';
import { assertInventoryPanelWrite, deleteUnitArchive, prepareInventoryTransaction, type InventoryAction, type InventoryIntent } from '../../panel/src/inventory-state.js';
import { assertTraitSourcePanelWrite, prepareBlessingRevocation } from '../../panel/src/trait-state.js';
import { prepareBattleItemWrite } from '../../panel/src/battle-items.js';
import { prepareReportDeletion, prepareReportRestore, prepareReportRestart, stampNewBattleReports } from '../../panel/src/report-history.js';
import { factsOf, shouldRefreshNarrativeProposal, compactNarrativeSources, prepareNarrativeTransaction, restoreNarrativeDeployment, deleteNarrativeRecords, captureGeneration, namespaceOf, messageSourceKey, proposalFromMessage, narrativeReceiptKey, type NarrativeSave, type NarrativeProposal, type GenerationBinding } from '../../panel/src/narrative-state.js';
import { narrativeProjection, type InventoryPreview } from '../../panel/src/narrative-controller.js';
import { reviewMigration, type MigrationReview } from '../../panel/src/migration-review.js';
import { parseProtocol, protocolExcerpt } from '../../panel/src/protocol.js';
import type { PromptSettings } from '../../panel/src/prompt-settings.js';
import { findMessageBySourceId, prepareMessageTag, sameMessageApartFromText } from '../../host/src/message-identity.js';
import { invalidateMissingSources, sameSource, sourceCommitted } from './source-receipts.js';
import { prepareNarrativeIds } from '../../panel/src/narrative-ids.js';
import { narrativeAutoApproval, prepareAiScanProposal } from '../../panel/src/narrative-state.js';

const PROMPT_ID = 'tavern-battle-native:context';
/** Shown on a reply that waits for confirmation although auto-approve is on, with the cause when known. */
const autoApproveSkipped = (cause?: string) => '自动批准只处理档案就绪后生成并直接收到的回复；' + (cause ? `这条没有自动入账：${cause}。` : '这条不符合（例如刚进聊天时档案还在读取，或回复被编辑、切换过），') + '请核对后确认';
const NOT_READY: Partial<Record<ServiceState['phase'], string>> = { loading: '档案还在读取', pending: '上一次保存还没确认', review: '档案在等迁移核对', error: '档案读取出错', import: '档案还没启用', handoff: '档案已切到脚本模式' };
/** The archive a generation was bound on; a re-read that finds the same one keeps the binding. */
type Archive = { documentId: string; generation: string } | undefined;
const archiveOf = (head?: { documentId: string; generation: string }): Archive => head && { documentId: head.documentId, generation: head.generation };
const sameArchive = (a: Archive, b: Archive) => a ? !!b && a.documentId === b.documentId && a.generation === b.generation : !b;
/** `load` counts archive reads; a command captured before a re-read cannot run after it. */
export interface CommandVersion { session: HostSession; revision: number; generation?: string; load?: number }
export interface ServiceState {
  phase: 'loading' | 'import' | 'handoff' | 'ready' | 'pending' | 'review' | 'error' | 'disposed';
  save: NarrativeSave;
  receipt?: PersistReceipt;
  error?: string;
}
type Listener = (state: ServiceState) => void;

/** The store owns durable checkpoints; a battle may advance on a private session candidate. */
export class BattleService {
  private phase: ServiceState['phase'] = 'loading';
  private error?: string;
  private receipt?: PersistReceipt;
  private listeners = new Set<Listener>();
  private stops: (() => void)[] = [];
  private started = false;
  private disposed = false;
  private loadEpoch = 0;
  private migration?: MigrationReview;
  private binding?: GenerationBinding;
  private bindingArchive?: Archive;
  /** Why the current generation has no binding, for the reply's auto-approve note. */
  private bindingMiss?: string;
  /** 进行中的一次生成：收到的消息序号，以及生成是否已结束。两者都到齐才扫描这条回复。 */
  private generation?: { receivedId?: number; ended: boolean };
  private scanQueue: Promise<unknown> = Promise.resolve();
  private loading?: { session?: HostSession; promise: Promise<void> };
  private memoryPanel?: { save: NarrativeSave; session: HostSession; revision: number; generation?: string };
  readonly capabilities = { beforeGeneration: false, generationEnded: false, messageIdentity: false, injection: false };
  constructor(readonly host: NativeHost, readonly store: NativeStore, private initialize?: () => Promise<boolean>) {}
  private livePanel(): NarrativeSave | undefined {
    const panel = this.memoryPanel, head = this.store.head();
    if (!panel || panel.revision !== (head?.revision ?? 0) || panel.generation !== head?.generation || !this.inSync()) return undefined;
    const session = this.store.session();
    if (!session || panel.session.scope.key !== session.scope.key) return undefined;
    // An adopted metadata object still holds this exact durable checkpoint.
    // Preserve the live fight when the host replaces that same-chat object.
    panel.session = session;
    return panel.save;
  }
  snapshot(keys?: readonly (keyof NarrativeSave)[]): NarrativeSave {
    const live = this.livePanel();
    return live ? structuredClone(keys ? Object.fromEntries(keys.filter(key => key in live).map(key => [key, live[key]])) : live) : this.store.snapshot(keys);
  }
  /** The archive belongs to the host's current context; a same-chat object swap that still holds it is adopted. */
  private inSync(): boolean { return sameSession(this.store.session(), this.host.session()) || this.store.adoptContext(); }
  /**
   * An async step can finish on the chat and archive load it began on although the host swapped
   * that chat's objects meanwhile (slow saves of long chats make this common); then adopt them.
   */
  private stillOn(session: HostSession | undefined, loaded: number): boolean {
    if (this.disposed || loaded !== this.loadEpoch || !session || this.store.session()?.scope.key !== session.scope.key || this.host.session()?.scope.key !== session.scope.key) return false;
    this.inSync(); return true;
  }
  /** A save is still running, as opposed to one that ended unconfirmed. */
  saving(): boolean { return this.store.saving(); }
  canWrite(): boolean { return ['ready', 'review'].includes(this.phase) && !this.store.hasPending() && this.inSync() && !this.host.hasLegacyRuntime(); }
  writeBlockReason(): string | undefined {
    if (this.disposed) return '战阵服务已关闭，请重新打开战阵';
    if (this.host.hasLegacyRuntime()) return '脚本版战阵仍在运行，请停用脚本版战阵后重新打开';
    if (!this.host.session()) return '当前聊天尚未载入，请先打开角色聊天';
    if (this.phase === 'loading') return '正在读取当前聊天档案';
    if (this.phase === 'error') return this.error ?? '存档读取失败，请点“重新读取存档”';
    if (!this.inSync()) return '聊天已刷新，请点“重新读取存档”或重新扫描';
    if (this.phase === 'pending' || this.store.hasPending()) return this.store.saving() ? '正在保存上一项改动，请稍候' : '上一次保存还没确认成功，请先处理上方提示';
    if (this.phase === 'import') return '发现脚本存档，请先选择导入或从空档开始';
    if (this.phase === 'handoff') return '档案已切换到脚本模式，请先在存档管理中迁回原生扩展';
    return undefined;
  }
  status(): ServiceState { return { phase: this.phase, save: this.snapshot(), receipt: structuredClone(this.receipt), error: this.error }; }
  listen(listener: Listener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  // The entry ignores the save and the panel skips its own commits: copy the archive only when a listener reads it.
  private notify(): void {
    for (const listener of this.listeners) {
      const live = this.livePanel();
      let copy: NarrativeSave | undefined;
      const save = live ? () => copy ??= structuredClone(live) : this.store.snapshotLater();
      const state: ServiceState = { phase: this.phase, get save() { return save(); }, receipt: structuredClone(this.receipt), error: this.error };
      try { listener(state); } catch (error) { console.error('战阵视图更新失败', error); }
    }
  }
  version(): CommandVersion {
    const session = this.inSync() ? this.store.session() : undefined;
    if (!session || this.phase !== 'ready' && this.phase !== 'review') throw Error('当前档案尚未就绪');
    const envelope = this.store.head();
    return { session, revision: envelope?.revision ?? 0, generation: envelope?.generation, load: this.loadEpoch };
  }
  inventoryContext(): string {
    this.inSync();
    const session = this.store.session();
    return JSON.stringify([session?.scope.key, session?.epoch, this.store.head()?.generation]);
  }
  migrationReview(): MigrationReview | undefined { return structuredClone(this.migration); }
  load(): Promise<void> {
    const session = this.host.session();
    if (this.loading && sameSession(session, this.loading.session)) return this.loading.promise;
    const loading = { session, promise: this.loadCurrent() };
    this.loading = loading;
    void loading.promise.finally(() => { if (this.loading === loading) this.loading = undefined; });
    return loading.promise;
  }
  private async loadCurrent(): Promise<void> {
    this.memoryPanel = undefined;
    const epoch = ++this.loadEpoch;
    this.phase = 'loading'; this.error = undefined; this.receipt = undefined; this.migration = undefined;
    if (this.generation) this.bindingMiss = '生成期间重新读取了档案';
    this.binding = undefined; this.generation = undefined;
    this.host.clearInjection(PROMPT_ID);
    const loading = this.store.load(); this.notify();
    try {
      await loading;
      if (this.disposed || epoch !== this.loadEpoch) return;
      if (!this.inSync()) throw Error('载入时聊天已切换');
      if (this.store.head()?.handoff && !this.store.pendingOperation()) { this.phase = 'handoff'; this.notify(); return; }
      if (!this.store.envelope() && !this.store.pendingOperation() && this.initialize) {
        const initialized = await this.initialize();
        if (this.disposed || epoch !== this.loadEpoch) return;
        if (!initialized) { this.phase = this.store.pendingOperation() ? 'pending' : 'import'; this.notify(); return; }
      }
      this.migration = reviewMigration(this.snapshot());
      this.phase = this.store.pendingOperation() ? 'pending' : this.migration ? 'review' : 'ready';
      this.project(); this.notify();
    } catch (error) {
      if (this.disposed || epoch !== this.loadEpoch) return;
      this.phase = 'error'; this.error = errorText(error); this.notify();
    }
  }
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const bind = (kind: string, callback: (...args: unknown[]) => void) => {
      const result = this.host.subscribe(kind, callback); this.stops.push(result.stop); return result.available;
    };
    const messageId = (value: unknown): number | undefined => {
      if (value && typeof value === 'object') { const v = value as Record<string, unknown>; value = v.message_id ?? v.messageId ?? v.id; }
      if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    };
    const before = (...args: unknown[]) => { if (args[2] !== true) this.beginGeneration(); };
    const afterCommands = bind('GENERATION_AFTER_COMMANDS', before);
    // Some hosts expose AFTER_COMMANDS in eventTypes without emitting it on every
    // generation path. STARTED must still capture the archive for those replies.
    const started = bind('GENERATION_STARTED', before);
    this.capabilities.beforeGeneration = afterCommands || started;
    // 生成中的回复要等“收到消息”和“生成结束”都到了才扫描。酒馆流式输出先发生成结束、非流式先发收到消息，
    // 别的扩展的监听也会打乱顺序，所以哪个后到由哪个收尾。
    bind('MESSAGE_RECEIVED', value => {
      const id = messageId(value), generation = this.generation;
      if (generation && id !== undefined) {
        generation.receivedId = id;
        if (generation.ended) this.finishGeneration();
      } else { this.bindingMiss ??= '没有收到这次生成开始的事件'; void this.scan(id); this.bindingMiss = undefined; }
    });
    // 酒馆这里传的是 chat.length（消息条数），不是刚生成那条的序号，所以不读它；只认收到消息时给的序号。
    this.capabilities.generationEnded = bind('GENERATION_ENDED', () => {
      const generation = this.generation;
      if (!generation) return;
      generation.ended = true;
      if (generation.receivedId !== undefined) this.finishGeneration();
    });
    bind('GENERATION_STOPPED', () => { this.generation = undefined; this.unbound('生成被中止'); });
    for (const event of ['MESSAGE_EDITED', 'MESSAGE_SWIPED']) bind(event, value => this.unbound('回复被编辑或切换过', messageId(value)));
    bind('MESSAGE_DELETED', () => { this.binding = undefined; if (this.generation) this.bindingMiss = '生成期间有消息被删除'; void this.reconcileDeletedMessages(); });
    bind('CHAT_CHANGED', () => { void this.load(); });
    bind('MESSAGE_SENT', () => this.project());
    await this.load();
  }
  private project(): void {
    if (this.disposed || this.host.hasLegacyRuntime() || !this.inSync() || this.phase === 'loading' || this.phase === 'import' || this.phase === 'handoff' || this.phase === 'error') {
      this.host.clearInjection(PROMPT_ID); this.capabilities.injection = false; return;
    }
    const text = this.migration ? '【战阵】当前档案需要核对迁移预览；暂不执行正文档案事件。'
      : narrativeProjection(this.livePanel() ?? this.store.snapshot(['storage', 'inventory', 'rosterIds', 'protagonistId', 'committedOutcomeIds', 'field', 'lighting', 'promptSettings', 'narrativeIdState', 'battle'],
        ['seed', 'round', 'combatants', 'battlefield', 'attached', 'fieldTags']), this.host.recentPromptText());
    this.capabilities.injection = this.host.inject(PROMPT_ID, text);
  }
  /** Caller versions are captured before awaiting; queued old intentions cannot follow a chat switch. */
  async transact(update: (before: NarrativeSave) => NarrativeSave, options: { version?: CommandVersion; operationId?: string; allowReview?: boolean; clear?: boolean; messageTags?: MessageTag[]; memoryOnly?: boolean; durable?: boolean } = {}): Promise<PersistReceipt> {
    const version = options.version ?? this.version();
    const reject = (error: string): PersistReceipt => ({ status: 'conflict', operationId: options.operationId ?? '', session: version.session, error });
    // Same chat, archive read and generation: a same-chat object swap since the capture is no change.
    if (this.disposed || version.load !== undefined && version.load !== this.loadEpoch || version.session.scope.key !== this.store.session()?.scope.key
      || version.session.scope.key !== this.host.session()?.scope.key || version.generation !== this.store.head()?.generation) return reject('聊天或存档代次已变化');
    if (this.migration && !options.allowReview) return reject('请先核对档案迁移预览');
    const live = this.livePanel(), previousMemory = this.memoryPanel;
    const prepare = (before: NarrativeSave) => compactNarrativeSources(update(prepareNarrativeIds(before)));
    let candidate: NarrativeSave | undefined;
    try { if (options.memoryOnly || live) candidate = structuredClone(prepare(this.snapshot())); }
    catch (error) { return { ...reject(errorText(error)), status: 'failed' }; }
    const sameBattle = live?.battle && candidate?.battle && live.battle.kind === candidate.battle.kind && live.battle.snap.seed === candidate.battle.snap.seed;
    if ((options.memoryOnly || sameBattle && !options.durable) && !options.clear && !options.messageTags?.length) {
      if (!this.canWrite()) return reject('当前档案尚未就绪');
      this.memoryPanel = { save: candidate!, session: structuredClone(version.session), revision: version.revision, generation: version.generation };
      const receipt: PersistReceipt = { status: 'confirmed', memoryOnly: true, operationId: options.operationId ?? randomId(), session: version.session };
      this.receipt = receipt; this.notify(); return receipt;
    }
    const loaded = this.loadEpoch;
    const receipt = await this.store.commit(version.revision, before => {
      if (live && this.memoryPanel !== previousMemory) throw Error('战斗内存状态已更新，请重新保存');
      return candidate ?? prepare(before);
    }, { operationId: options.operationId, clear: options.clear, messageTags: options.messageTags });
    if (this.stillOn(version.session, loaded)) {
      this.receipt = receipt;
      if (receipt.status === 'confirmed') this.memoryPanel = undefined;
      if (receipt.status === 'confirmed') this.error = undefined;
      this.phase = this.store.pendingOperation() ? 'pending' : this.migration ? 'review' : 'ready';
      if (receipt.status === 'confirmed') this.project();
      this.notify();
    }
    return receipt;
  }
  async retry(): Promise<PersistReceipt> {
    const session = this.store.session(), loaded = this.loadEpoch; const receipt = await this.store.retry();
    if (this.stillOn(session, loaded)) {
      this.receipt = receipt; this.phase = this.store.pendingOperation() ? 'pending' : this.migration ? 'review' : 'ready';
      if (receipt.status === 'confirmed') { this.migration = reviewMigration(this.snapshot()); this.phase = this.migration ? 'review' : 'ready'; this.project(); }
      this.notify();
    }
    if (receipt.code === 'source-changed' && this.stillOn(session, loaded) && this.canWrite()) {
      // An undone first archive leaves none; reload so the initializer offers the import choice again.
      if (!this.store.head() && this.initialize) { await this.load(); return receipt; }
      this.binding = undefined; this.bindingMiss = '保存途中回复被改动，已按最新正文重扫';
      const scanning = this.scan(); this.bindingMiss = undefined; await scanning;
      // Return the new scan's receipt (and its own operation ID), so the panel
      // does not overwrite successful recovery with the obsolete conflict.
      if (this.stillOn(session, loaded) && this.receipt) return this.receipt;
    }
    return receipt;
  }
  async discardPending(): Promise<DiscardResult> { const result = await this.store.discardPending(); await this.load(); return result; }
  persistPanel(next: NarrativeSave, expectedRevision: number, options: { memoryOnly?: boolean } = {}): Promise<PersistReceipt> {
    const candidate = structuredClone(next);
    return this.transact(before => {
      if (expectedRevision !== (before.factRevision ?? 0)) throw Error('面板已过期，请重新载入最新档案');
      assertInventoryPanelWrite(before, candidate); assertTraitSourcePanelWrite(before, candidate);
      let prepared = prepareBattleItemWrite(before, candidate); stampNewBattleReports(before, prepared);
      const changed = factsOf(prepared) !== factsOf(before);
      prepared = { ...before, ...prepared, promptSettings: before.promptSettings, proposals: before.proposals ?? [], storySync: before.storySync ?? false,
        committedNarrativeSources: before.committedNarrativeSources, deletedNarrativeReceipts: before.deletedNarrativeReceipts,
        inventoryOperations: before.inventoryOperations, classMigration: before.classMigration, inventoryMigrationBackup: before.inventoryMigrationBackup, migrationBackups: before.migrationBackups,
        factRevision: (before.factRevision ?? 0) + Number(changed) };
      return prepared;
    }, { memoryOnly: options.memoryOnly, durable: !options.memoryOnly });
  }
  previewInventory(action: InventoryAction, id: string = randomId()): InventoryPreview {
    this.version(); if (this.migration) throw Error('请先核对档案迁移预览');
    const before = this.snapshot(); const intent = { ...structuredClone(action), id, expectedRevision: before.factRevision ?? 0 };
    return { context: this.inventoryContext(), action: structuredClone(action), intent, before, after: prepareInventoryTransaction(before, intent) };
  }
  commitInventoryPreview(preview: InventoryPreview): Promise<PersistReceipt> {
    if (preview.context !== this.inventoryContext()) throw Error('库存预览属于旧聊天，请重新预览');
    return this.inventoryAction(preview.intent);
  }
  migrateWeaponClasses(selected: string[], expectedRevision: number): Promise<PersistReceipt> {
    const ids = [...selected], id = randomId();
    return this.transact(before => { if (expectedRevision !== (before.factRevision ?? 0)) throw Error('档案已变化，请重新查看类别更新'); return prepareClassMigration(before, ids, id); });
  }
  inventoryAction(intent: InventoryIntent): Promise<PersistReceipt> {
    const copy = structuredClone(intent); return this.transact(before => prepareInventoryTransaction(before, copy), { operationId: copy.id });
  }
  setPromptSettings(settings: PromptSettings): Promise<PersistReceipt> { const copy = structuredClone(settings); return this.transact(before => ({ ...before, promptSettings: copy })); }
  setStorySync(enabled: boolean): Promise<PersistReceipt> { return this.transact(before => ({ ...before, storySync: enabled, autoApprove: enabled })); }
  proposeAiScan(text: string, expectedRevision: number, context: string): Promise<PersistReceipt> {
    const namespace = this.host.namespace();
    if (!namespace || context !== this.inventoryContext()) throw Error('聊天或档案已变化，请重新扫描');
    return this.transact(before => {
      if (expectedRevision !== (before.factRevision ?? 0) || namespace !== this.host.namespace()) throw Error('扫描结果已过期');
      return prepareAiScanProposal(before, namespace, text);
    });
  }
  deleteBattleReport(id: string): Promise<PersistReceipt> { return this.transact(before => prepareReportDeletion(before, id)); }
  restoreBattleReport(): Promise<PersistReceipt> { return this.transact(prepareReportRestore); }
  restartBattleReport(id: string, expectedRevision: number, seed: string): Promise<PersistReceipt> { return this.transact(before => prepareReportRestart(before, id, expectedRevision, seed)); }
  revokeBlessing(unitId: string, sourceId: string, expectedRevision: number, context: string): Promise<PersistReceipt> {
    if (context !== this.inventoryContext()) throw Error('祝福操作属于旧聊天');
    return this.transact(before => { if (expectedRevision !== (before.factRevision ?? 0)) throw Error('档案版本已变化'); return prepareBlessingRevocation(before, unitId, sourceId); });
  }
  deleteUnit(id: string): Promise<PersistReceipt> { return this.transact(before => deleteUnitArchive(before, id)); }
  restoreDeployment(id: string): Promise<PersistReceipt> {
    const namespace = this.host.namespace();
    return this.transact(before => { const proposal = before.proposals?.find(p => p.id === id); if (!proposal || namespaceOf(proposal.source) !== namespace) throw Error('请选择当前聊天的同步记录'); return restoreNarrativeDeployment(before, id); });
  }
  approve(id: string): Promise<PersistReceipt> {
    const namespace = this.host.namespace();
    const proposal = this.snapshot().proposals?.find(item => item.id === id);
    const chat = this.host.context().chat ?? [];
    const index = proposal && proposal.origin !== 'ai-scan' ? findMessageBySourceId(chat, proposal.source.messageId) : undefined;
    const tags = index === undefined ? [] : [prepareMessageTag(chat, index)];
    return this.transact(before => {
      const proposal = before.proposals?.find(p => p.id === id);
      if (!proposal || !namespace || !['pending', 'failed'].includes(proposal.status)) throw Error('待确认内容不可提交');
      const current = this.host.messageBySource(proposal.source.messageId);
      if (proposal.origin !== 'ai-scan' && (!current || !current.complete || namespaceOf(current) !== namespace || current.swipeId !== proposal.source.swipeId || protocolExcerpt(current.text) !== (proposal.originalText ?? proposal.source.text))) throw Error('来源消息已改变或删除，请重新扫描');
      if (sourceCommitted(before, proposal.sourceKey)) throw Error('此消息已入账，不能重复执行');
      return prepareNarrativeTransaction(before, { ...proposal, status: 'pending' }, namespace, true);
    }, { operationId: 'narrative:' + id, messageTags: tags });
  }
  correctProposal(id: string, text: string): Promise<PersistReceipt> {
    const namespace = this.host.namespace();
    return this.transact(before => {
      const old = before.proposals?.find(p => p.id === id);
      if (!old || !namespace || namespaceOf(old.source) !== namespace || old.source.role !== 'assistant' || !old.source.complete || old.status === 'committed') throw Error('没有可修正的完整事件草稿');
      if (sourceCommitted(before, old.sourceKey)) throw Error('此消息已入账');
      const binding = captureGeneration(before, namespace, randomId()); binding.complete = true;
      const proposal = proposalFromMessage({ ...old.source, text, generationId: binding.id }, binding);
      if (!proposal) throw Error('草稿里尚未识别到事件标签');
      proposal.corrected = true; proposal.originalText = old.originalText ?? old.source.text; proposal.origin = old.origin;
      return { ...before, proposals: [...(before.proposals ?? []).map((p): NarrativeProposal => p.id === id ? { ...p, status: 'stale', reason: '已由本地修正草稿替代' } : p), proposal] };
    });
  }
  reject(id: string): Promise<PersistReceipt> { return this.transact(before => ({ ...before, proposals: before.proposals?.map(p => p.id === id && p.status !== 'committed' ? { ...p, status: 'rejected' } : p) })); }
  deleteRecords(ids?: string[]): Promise<PersistReceipt> { return this.transact(before => deleteNarrativeRecords(before, ids)); }
  reviewBalanceUpgrade(): void {
    this.version();
    if (this.phase !== 'ready' || this.migration || !this.inSync()) throw Error('请先核实保存或处理当前迁移预览');
    this.migration = reviewMigration(this.snapshot(), true);
    if (this.migration) { this.phase = 'review'; this.binding = undefined; this.project(); this.notify(); }
  }
  async acceptMigration(): Promise<PersistReceipt> {
    const review = this.migration; if (!review) throw Error('没有待核对的迁移');
    const loaded = this.loadEpoch;
    const receipt = await this.transact(() => ({ ...review.candidate, migrationBackups: [...(Array.isArray(review.original.migrationBackups) ? review.original.migrationBackups : []), { createdAt: new Date().toISOString(), source: { ...review.original, migrationBackups: undefined } }] }), { allowReview: true });
    if (receipt.status === 'confirmed' && this.stillOn(receipt.session, loaded)) { this.migration = undefined; this.phase = 'ready'; this.project(); this.notify(); }
    return receipt;
  }
  restoreMigrationBackup(): Promise<PersistReceipt> {
    return this.transact(before => {
      const backups = before.migrationBackups as { source: NarrativeSave }[] | undefined;
      if (!Array.isArray(backups) || !backups.length) throw Error('没有可恢复的迁移备份');
      if (before.battle && !before.committedOutcomeIds?.includes(`${before.battle.kind}:${String(before.battle.snap.seed)}`)) throw Error('先结束并归档当前战斗');
      return structuredClone(backups.at(-1)!.source);
    }).then(async receipt => { if (receipt.status === 'confirmed' && receipt.session.scope.key === this.host.session()?.scope.key) await this.load(); return receipt; });
  }
  beginGeneration(): void {
    this.generation = { ended: false }; this.binding = undefined; this.bindingMiss = undefined;
    if (this.phase !== 'ready' || !this.inSync()) {
      this.bindingMiss = '生成开始时' + (this.phase === 'ready' ? '酒馆换了聊天数据，档案要重新读取' : NOT_READY[this.phase] ?? '档案没有就绪');
      this.project(); return;
    }
    const namespace = this.host.namespace();
    this.binding = namespace ? captureGeneration(this.snapshot(), namespace, randomId()) : undefined;
    this.bindingArchive = archiveOf(this.store.head());
    if (!this.binding) this.bindingMiss = '生成开始时无法确认当前聊天';
    this.project();
  }
  /** 这次生成的回复已收到、生成也已结束：把绑定落到这条消息上再扫描。 */
  private finishGeneration(): void {
    const id = this.generation!.receivedId!;
    this.generation = undefined;
    if (this.binding) { this.binding.complete = true; this.binding.messageId = this.host.message(id)?.messageId; }
    void this.scan(id); this.bindingMiss = undefined;
  }
  /** A reply changed outside a generation: rescan it as a manual preview that says why. */
  private unbound(miss: string, id?: number): void {
    this.binding = undefined; this.bindingMiss = miss;
    void this.scan(id);
    if (!this.generation) this.bindingMiss = undefined;
  }
  scan(messageId?: number, options: { manual?: boolean } = {}): Promise<void> {
    const chat = this.host.session()?.scope.key, archive = this.bindingArchive;
    let binding = structuredClone(this.binding), miss = this.bindingMiss;
    // Only another chat cancels the scan: the host may swap this chat's objects at any time.
    const sameChat = () => chat !== undefined && this.host.session()?.scope.key === chat;
    /** `changed`: the first attempt's source changed during its save; `ids` when that attempt was bound to the generation. */
    const run = async (changed?: { fingerprint: string; excerpt: string; ids?: (string | undefined)[] }): Promise<void> => {
      if (this.disposed || this.host.isGenerating() || !sameChat()) return;
      if (this.loading) await this.loading.promise;
      if (!sameChat()) return;
      // updateChatMetadata can replace the context without CHAT_CHANGED. An object that still
      // holds this archive is adopted; otherwise re-read the chat. The reply was generated on the
      // archive the binding captured, so a re-read that finds that same archive keeps it; its
      // fact and unit versions are still checked before anything is committed.
      if (this.phase === 'error' || !this.inSync()) {
        await this.load();
        if (binding && !sameArchive(archive, archiveOf(this.store.head()))) { binding = undefined; miss = '生成期间档案被替换'; }
      }
      if (!sameChat()) return;
      if (this.phase !== 'ready' || !this.canWrite()) {
        if (options.manual) throw Error(this.writeBlockReason() ?? '请先核对并接受迁移预览');
        return;
      }
      let index = messageId ?? (this.host.context().chat?.length ?? 0) - 1;
      if (messageId === undefined && options.manual) {
        while (index >= 0) {
          const candidate = this.host.message(index);
          if (candidate?.role === 'assistant' && candidate.complete) break;
          index--;
        }
      }
      const message = this.host.message(index); const namespace = this.host.namespace();
      if (!message || message.role !== 'assistant' || !namespace) return;
      const tag = prepareMessageTag(this.host.context().chat!, index);
      const originalId = message.messageId; message.messageId = tag.id;
      this.capabilities.messageIdentity = !!message.messageId && !!message.swipeId;
      // After a source change during the save the facts stay automatic only when the first attempt
      // was bound to this generation and the same message still carries the same events: the host
      // or another extension rewrote the text around them, which approve() accepts as well.
      const sameMessage = !changed || sameMessageApartFromText(changed.fingerprint, tag.fingerprint);
      const kept = !changed || !!changed.ids && sameMessage && !!changed.excerpt && changed.excerpt === protocolExcerpt(message.text);
      if (!kept && changed?.ids) miss = sameMessage ? '保存途中回复里的事件被改动' : '保存途中回复被切换或替换';
      const before = this.snapshot(); let expected = binding && kept && !options.manual ? { ...binding, messageId: (changed?.ids ?? [binding.messageId]).includes(originalId) ? tag.id : binding.messageId } : undefined;
      if (!(expected?.complete && expected.messageId === message.messageId) && message.complete && this.capabilities.messageIdentity) expected = { ...captureGeneration(before, namespace, randomId()), complete: true, manualOnly: !(options.manual && narrativeAutoApproval(before)), messageId: message.messageId };
      const bound = !!binding && expected?.id === binding.id;
      if (expected?.complete && this.capabilities.messageIdentity) message.generationId = expected.id;
      const proposal = proposalFromMessage(message, expected); if (!proposal) return;
      if (proposal.status === 'pending' && proposal.expected?.manualOnly && !options.manual && narrativeAutoApproval(before)) proposal.reason = autoApproveSkipped(binding && kept ? '没有对上这次生成的开始' : miss);
      if (sourceCommitted(before, proposal.sourceKey) || before.deletedNarrativeReceipts?.includes(narrativeReceiptKey(proposal))) return;
      const existing = (before.proposals ?? []).filter(p => sameSource(p.sourceKey, proposal.sourceKey));
      const same = existing.find(p => (p.canonical === proposal.canonical || p.status === 'committed' && parseProtocol(p.source.text).canonical === proposal.canonical) && p.source.swipeId === message.swipeId && (!!proposal.canonical || p.source.text === proposal.source.text));
      const upgrade = shouldRefreshNarrativeProposal(same, proposal, options.manual);
      if (same && !upgrade) return;
      if (upgrade) proposal.id = same!.id;
      if (existing.some(p => p.status === 'committed')) { proposal.status = 'stale'; proposal.reason = '此消息已同步，修改不会重复入账'; }
      const proposals = (before.proposals ?? []).filter(p => !upgrade || p.id !== same!.id).map((p): NarrativeProposal => p.sourceKey === proposal.sourceKey && ['pending', 'legacy', 'failed', 'unresolved'].includes(p.status) ? { ...p, status: 'stale', reason: '已被新消息修订替代' } : p);
      let candidate = { ...before, proposals: [...proposals, proposal] };
      if (proposal.status === 'pending' && !proposal.expected?.manualOnly && narrativeAutoApproval(candidate)) {
        try { candidate = prepareNarrativeTransaction(candidate, proposal, namespace) as typeof candidate; }
        catch (error) { proposal.reason = String(error); proposal.status = /过期|聊天|分支|战内|未结算/.test(proposal.reason) ? 'stale' : 'unresolved'; }
      }
      // Long chats save slowly: let an open panel show the save while it runs.
      const saving = this.transact(() => candidate, { messageTags: [tag] }); this.notify();
      const receipt = await saving;
      // Re-read at most once. Changed events or another message make it a manual preview.
      if (receipt.code === 'source-changed' && !changed) await run({ fingerprint: tag.fingerprint, excerpt: proposal.source.text, ids: bound ? [binding!.messageId, tag.id] : undefined });
    };
    const next = this.scanQueue.then(() => run(), () => run()).catch(error => {
      if (!this.disposed && chat !== undefined && this.store.session()?.scope.key === chat) { this.error = errorText(error); this.notify(); }
      if (options.manual) throw error;
    });
    this.scanQueue = next; return next;
  }
  async rebind(id: string): Promise<void> {
    const before = this.snapshot(); const old = before.proposals?.find(p => p.id === id); const namespace = this.host.namespace();
    if (!old || !namespace || !['legacy', 'stale'].includes(old.status)) throw Error('缺少可重新预览的待确认内容');
    if (old.corrected || old.origin === 'ai-scan') { const receipt = await this.correctProposal(id, old.source.text); if (receipt.status !== 'confirmed') throw Error(receipt.error ?? '草稿尚未保存'); return; }
    const current = this.host.messageBySource(old.source.messageId);
    if (!current || current.role !== 'assistant' || !current.complete || namespaceOf(current) !== namespace || protocolExcerpt(current.text) !== old.source.text || current.swipeId !== old.source.swipeId) throw Error('原消息已变化，需要重新扫描');
    if (sourceCommitted(before, messageSourceKey(current))) throw Error('此消息已入账');
    const binding = captureGeneration(before, namespace, randomId()); binding.complete = true; binding.manualOnly = true;
    current.generationId = binding.id; const proposal = proposalFromMessage(current, binding)!;
    const receipt = await this.transact(state => ({ ...state, proposals: [...(state.proposals ?? []).map((p): NarrativeProposal => p.id === old.id ? { ...p, status: 'stale' } : p), proposal] }));
    if (receipt.status !== 'confirmed') throw Error(receipt.error ?? '待确认内容尚未保存');
  }
  dispose(): void {
    if (this.disposed) return;
    this.memoryPanel = undefined;
    this.disposed = true; this.loadEpoch++; this.binding = undefined; this.phase = 'disposed';
    for (const stop of this.stops.splice(0)) stop();
    this.host.clearInjection(PROMPT_ID); this.notify(); this.listeners.clear();
  }
  async reconcileDeletedMessages(): Promise<void> {
    if (this.phase !== 'ready') return;
    const next = invalidateMissingSources(this.snapshot(), this.host);
    if (next) await this.transact(() => next);
  }
}
