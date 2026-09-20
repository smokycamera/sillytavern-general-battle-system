import type { PersistReceipt, HostSession, MessageTag } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import { NativeHost } from '../../host/src/sillytavern.js';
import { NativeStore } from './native-store.js';
import { assertInventoryPanelWrite, deleteUnitArchive, prepareInventoryTransaction, type InventoryAction, type InventoryIntent } from '../../panel/src/inventory-state.js';
import { assertTraitSourcePanelWrite, prepareBlessingRevocation } from '../../panel/src/trait-state.js';
import { prepareBattleItemWrite } from '../../panel/src/battle-items.js';
import { prepareReportDeletion, prepareReportRestore, prepareReportRestart, stampNewBattleReports } from '../../panel/src/report-history.js';
import { factsOf, compactNarrativeSources, prepareNarrativeTransaction, restoreNarrativeDeployment, deleteNarrativeRecords, captureGeneration, namespaceOf, messageSourceKey, proposalFromMessage, narrativeReceiptKey, type NarrativeSave, type NarrativeProposal, type GenerationBinding } from '../../panel/src/narrative-state.js';
import { narrativeProjection, type InventoryPreview } from '../../panel/src/narrative-controller.js';
import { reviewMigration, type MigrationReview } from '../../panel/src/migration-review.js';
import { parseProtocol, protocolExcerpt } from '../../panel/src/protocol.js';
import type { PromptSettings } from '../../panel/src/prompt-settings.js';
import { findMessageBySourceId, prepareMessageTag } from '../../host/src/message-identity.js';
import { invalidateMissingSources, sameSource, sourceCommitted } from './source-receipts.js';

const PROMPT_ID = 'tavern-battle-native:context';
export interface CommandVersion { session: HostSession; revision: number; generation?: string }
export interface ServiceState {
  phase: 'loading' | 'import' | 'handoff' | 'ready' | 'pending' | 'review' | 'error' | 'disposed';
  save: NarrativeSave;
  receipt?: PersistReceipt;
  error?: string;
}
type Listener = (state: ServiceState) => void;

/** The store is the only authority. Every reducer runs on a private candidate. */
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
  private receivedId?: number;
  private generationEnded = false;
  private scanQueue: Promise<unknown> = Promise.resolve();
  readonly capabilities = { beforeGeneration: false, generationEnded: false, messageIdentity: false, injection: false };
  constructor(readonly host: NativeHost, readonly store: NativeStore, private initialize?: () => Promise<boolean>) {}
  snapshot(): NarrativeSave { return this.store.snapshot(); }
  canWrite(): boolean { return ['ready', 'review'].includes(this.phase) && !this.store.hasPending() && sameSession(this.store.session(), this.host.session()) && !this.host.hasLegacyRuntime(); }
  status(): ServiceState { return { phase: this.phase, save: this.snapshot(), receipt: structuredClone(this.receipt), error: this.error }; }
  listen(listener: Listener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) { try { listener(this.status()); } catch (error) { console.error('战阵视图更新失败', error); } } }
  version(): CommandVersion {
    const session = this.store.session();
    if (!session || !sameSession(session, this.host.session()) || this.phase !== 'ready' && this.phase !== 'review') throw Error('当前档案尚未就绪');
    const envelope = this.store.head();
    return { session, revision: envelope?.revision ?? 0, generation: envelope?.generation };
  }
  inventoryContext(): string {
    const session = this.store.session();
    return JSON.stringify([session?.scope.key, session?.epoch, this.store.head()?.generation]);
  }
  migrationReview(): MigrationReview | undefined { return structuredClone(this.migration); }
  async load(): Promise<void> {
    const epoch = ++this.loadEpoch;
    this.phase = 'loading'; this.error = undefined; this.receipt = undefined; this.migration = undefined;
    this.binding = undefined; this.receivedId = undefined; this.generationEnded = false;
    this.host.clearInjection(PROMPT_ID);
    const loading = this.store.load(); this.notify();
    try {
      await loading;
      if (this.disposed || epoch !== this.loadEpoch) return;
      if (!sameSession(this.store.session(), this.host.session())) throw Error('载入时聊天已切换');
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
      this.phase = 'error'; this.error = String(error); this.notify();
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
    const started = bind('GENERATION_STARTED', (...args) => { if (!afterCommands) before(...args); });
    this.capabilities.beforeGeneration = afterCommands || started;
    bind('MESSAGE_RECEIVED', value => {
      const id = messageId(value);
      if (this.binding && id !== undefined) {
        this.receivedId = id;
        const sourceId = this.host.message(id)?.messageId;
        if (this.generationEnded && (!this.binding.messageId || this.binding.messageId === sourceId)) {
          this.binding.complete = true; this.binding.messageId = sourceId; void this.scan(id);
        }
      } else void this.scan(id);
    });
    this.capabilities.generationEnded = bind('GENERATION_ENDED', value => {
      this.generationEnded = true;
      const id = messageId(value) ?? this.receivedId;
      if (this.binding) {
        this.binding.complete = id !== undefined && (this.receivedId === undefined || id === this.receivedId);
        this.binding.messageId = this.binding.complete ? this.host.message(id)?.messageId : undefined;
      }
      void this.scan(id);
    });
    bind('GENERATION_STOPPED', () => { this.binding = undefined; this.receivedId = undefined; void this.scan(); });
    for (const event of ['MESSAGE_EDITED', 'MESSAGE_SWIPED']) bind(event, value => { this.binding = undefined; void this.scan(messageId(value)); });
    bind('MESSAGE_DELETED', () => { this.binding = undefined; void this.reconcileDeletedMessages(); });
    bind('CHAT_CHANGED', () => { void this.load(); });
    bind('MESSAGE_SENT', () => this.project());
    await this.load();
  }
  private project(): void {
    if (this.disposed || this.host.hasLegacyRuntime() || !sameSession(this.store.session(), this.host.session()) || this.phase === 'loading' || this.phase === 'import' || this.phase === 'handoff' || this.phase === 'error') {
      this.host.clearInjection(PROMPT_ID); this.capabilities.injection = false; return;
    }
    const text = this.migration ? '【战阵】当前档案需要核对迁移预览；暂不执行正文档案事件。'
      : narrativeProjection(this.snapshot(), this.host.recentPromptText());
    this.capabilities.injection = this.host.inject(PROMPT_ID, text);
  }
  /** Caller versions are captured before awaiting; queued old intentions cannot follow a chat switch. */
  async transact(update: (before: NarrativeSave) => NarrativeSave, options: { version?: CommandVersion; operationId?: string; allowReview?: boolean; clear?: boolean; messageTags?: MessageTag[] } = {}): Promise<PersistReceipt> {
    const version = options.version ?? this.version();
    const reject = (error: string): PersistReceipt => ({ status: 'conflict', operationId: options.operationId ?? '', session: version.session, error });
    if (this.disposed || !sameSession(version.session, this.store.session()) || !sameSession(version.session, this.host.session()) || version.generation !== this.store.head()?.generation) return reject('聊天或存档代次已变化');
    if (this.migration && !options.allowReview) return reject('请先核对档案迁移预览');
    const receipt = await this.store.commit(version.revision, before => compactNarrativeSources(update(before)), { operationId: options.operationId, clear: options.clear, messageTags: options.messageTags });
    if (!this.disposed && sameSession(version.session, this.store.session()) && sameSession(version.session, this.host.session())) {
      this.receipt = receipt;
      this.phase = this.store.pendingOperation() ? 'pending' : this.migration ? 'review' : 'ready';
      if (receipt.status === 'confirmed') this.project();
      this.notify();
    }
    return receipt;
  }
  async retry(): Promise<PersistReceipt> {
    const session = this.store.session(); const receipt = await this.store.retry();
    if (!this.disposed && sameSession(session, this.host.session()) && sameSession(session, this.store.session())) {
      this.receipt = receipt; this.phase = this.store.pendingOperation() ? 'pending' : this.migration ? 'review' : 'ready';
      if (receipt.status === 'confirmed') { this.migration = reviewMigration(this.snapshot()); this.phase = this.migration ? 'review' : 'ready'; this.project(); }
      this.notify();
    }
    return receipt;
  }
  async discardPending(): Promise<void> { await this.store.discardPending(); await this.load(); }
  persistPanel(next: NarrativeSave, expectedRevision: number): Promise<PersistReceipt> {
    const candidate = structuredClone(next);
    return this.transact(before => {
      if (expectedRevision !== (before.factRevision ?? 0)) throw Error('面板已过期，请重新载入最新档案');
      assertInventoryPanelWrite(before, candidate); assertTraitSourcePanelWrite(before, candidate);
      let prepared = prepareBattleItemWrite(before, candidate); stampNewBattleReports(before, prepared);
      const changed = factsOf(prepared) !== factsOf(before);
      prepared = { ...before, ...prepared, promptSettings: before.promptSettings, proposals: before.proposals ?? [], storySync: before.storySync ?? false,
        committedNarrativeSources: before.committedNarrativeSources, deletedNarrativeReceipts: before.deletedNarrativeReceipts,
        inventoryOperations: before.inventoryOperations, inventoryMigrationBackup: before.inventoryMigrationBackup, migrationBackups: before.migrationBackups,
        factRevision: (before.factRevision ?? 0) + Number(changed) };
      return prepared;
    });
  }
  previewInventory(action: InventoryAction, id: string = crypto.randomUUID()): InventoryPreview {
    this.version(); if (this.migration) throw Error('请先核对档案迁移预览');
    const before = this.snapshot(); const intent = { ...structuredClone(action), id, expectedRevision: before.factRevision ?? 0 };
    return { context: this.inventoryContext(), action: structuredClone(action), intent, before, after: prepareInventoryTransaction(before, intent) };
  }
  commitInventoryPreview(preview: InventoryPreview): Promise<PersistReceipt> {
    if (preview.context !== this.inventoryContext()) throw Error('库存预览属于旧聊天，请重新预览');
    return this.inventoryAction(preview.intent);
  }
  inventoryAction(intent: InventoryIntent): Promise<PersistReceipt> {
    const copy = structuredClone(intent); return this.transact(before => prepareInventoryTransaction(before, copy), { operationId: copy.id });
  }
  setPromptSettings(settings: PromptSettings): Promise<PersistReceipt> { const copy = structuredClone(settings); return this.transact(before => ({ ...before, promptSettings: copy })); }
  setStorySync(enabled: boolean): Promise<PersistReceipt> { return this.transact(before => ({ ...before, storySync: enabled })); }
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
    const index = proposal ? findMessageBySourceId(chat, proposal.source.messageId) : undefined;
    const tags = index === undefined ? [] : [prepareMessageTag(chat, index)];
    return this.transact(before => {
      const proposal = before.proposals?.find(p => p.id === id);
      if (!proposal || !namespace || !['pending', 'failed'].includes(proposal.status)) throw Error('候选不可提交');
      const current = this.host.messageBySource(proposal.source.messageId);
      if (!current || !current.complete || namespaceOf(current) !== namespace || current.swipeId !== proposal.source.swipeId || protocolExcerpt(current.text) !== (proposal.originalText ?? proposal.source.text)) throw Error('来源消息已改变或删除，请重新扫描');
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
      const binding = captureGeneration(before, namespace, crypto.randomUUID()); binding.complete = true;
      const proposal = proposalFromMessage({ ...old.source, text, generationId: binding.id }, binding);
      if (!proposal) throw Error('草稿里尚未识别到事件标签');
      proposal.corrected = true; proposal.originalText = old.originalText ?? old.source.text;
      return { ...before, proposals: [...(before.proposals ?? []).map((p): NarrativeProposal => p.id === id ? { ...p, status: 'stale', reason: '已由本地修正草稿替代' } : p), proposal] };
    });
  }
  reject(id: string): Promise<PersistReceipt> { return this.transact(before => ({ ...before, proposals: before.proposals?.map(p => p.id === id && p.status !== 'committed' ? { ...p, status: 'rejected' } : p) })); }
  deleteRecords(ids?: string[]): Promise<PersistReceipt> { return this.transact(before => deleteNarrativeRecords(before, ids)); }
  async acceptMigration(): Promise<PersistReceipt> {
    const review = this.migration; if (!review) throw Error('没有待核对的迁移');
    const receipt = await this.transact(() => ({ ...review.candidate, migrationBackups: [...(Array.isArray(review.original.migrationBackups) ? review.original.migrationBackups : []), { createdAt: new Date().toISOString(), source: { ...review.original, migrationBackups: undefined } }] }), { allowReview: true });
    if (receipt.status === 'confirmed' && sameSession(receipt.session, this.store.session())) { this.migration = undefined; this.phase = 'ready'; this.project(); this.notify(); }
    return receipt;
  }
  restoreMigrationBackup(): Promise<PersistReceipt> {
    return this.transact(before => {
      const backups = before.migrationBackups as { source: NarrativeSave }[] | undefined;
      if (!Array.isArray(backups) || !backups.length) throw Error('没有可恢复的迁移备份');
      if (before.battle && !before.committedOutcomeIds?.includes(`${before.battle.kind}:${String(before.battle.snap.seed)}`)) throw Error('先结束并归档当前战斗');
      return structuredClone(backups.at(-1)!.source);
    }).then(async receipt => { if (receipt.status === 'confirmed' && sameSession(receipt.session, this.host.session())) await this.load(); return receipt; });
  }
  beginGeneration(): void {
    this.receivedId = undefined; this.generationEnded = false; this.binding = undefined;
    if (this.phase !== 'ready' || !sameSession(this.store.session(), this.host.session())) { this.project(); return; }
    const namespace = this.host.namespace();
    this.binding = namespace ? captureGeneration(this.snapshot(), namespace, crypto.randomUUID()) : undefined;
    this.project();
  }
  scan(messageId?: number): Promise<void> {
    const session = this.store.session(); const binding = structuredClone(this.binding);
    const run = async () => {
      if (this.disposed || this.phase !== 'ready' || this.host.isGenerating() || !sameSession(session, this.host.session()) || !sameSession(session, this.store.session())) return;
      const index = messageId ?? (this.host.context().chat?.length ?? 0) - 1;
      const message = this.host.message(index); const namespace = this.host.namespace();
      if (!message || message.role !== 'assistant' || !namespace) return;
      const tag = prepareMessageTag(this.host.context().chat!, index);
      const originalId = message.messageId; message.messageId = tag.id;
      this.capabilities.messageIdentity = !!message.messageId && !!message.swipeId;
      const before = this.snapshot(); let expected = binding ? { ...binding, messageId: binding.messageId === originalId ? tag.id : binding.messageId } : undefined;
      if (!(expected?.complete && expected.messageId === message.messageId) && message.complete && this.capabilities.messageIdentity) expected = { ...captureGeneration(before, namespace, crypto.randomUUID()), complete: true, manualOnly: true, messageId: message.messageId };
      if (expected?.complete && this.capabilities.messageIdentity) message.generationId = expected.id;
      const proposal = proposalFromMessage(message, expected); if (!proposal) return;
      if (sourceCommitted(before, proposal.sourceKey) || before.deletedNarrativeReceipts?.includes(narrativeReceiptKey(proposal))) return;
      const existing = (before.proposals ?? []).filter(p => sameSource(p.sourceKey, proposal.sourceKey));
      const same = existing.find(p => (p.canonical === proposal.canonical || p.status === 'committed' && parseProtocol(p.source.text).canonical === proposal.canonical) && p.source.swipeId === message.swipeId && (!!proposal.canonical || p.source.text === proposal.source.text));
      const upgrade = same && ((same.status === 'legacy' || same.status === 'unresolved' && same.reason?.startsWith('已识别')) && proposal.status === 'pending' || same.status === 'pending' && same.expected?.manualOnly && proposal.status === 'pending' && !proposal.expected?.manualOnly);
      if (same && !upgrade) return;
      if (upgrade) proposal.id = same.id;
      if (existing.some(p => p.status === 'committed')) { proposal.status = 'stale'; proposal.reason = '此消息已同步，修改不会重复入账'; }
      const proposals = (before.proposals ?? []).filter(p => !upgrade || p.id !== same!.id).map((p): NarrativeProposal => p.sourceKey === proposal.sourceKey && ['pending', 'legacy', 'failed', 'unresolved'].includes(p.status) ? { ...p, status: 'stale', reason: '已被新消息修订替代' } : p);
      let candidate = { ...before, proposals: [...proposals, proposal] };
      if (proposal.status === 'pending' && !proposal.expected?.manualOnly && candidate.storySync && proposal.events.every(e => ['unit-set', 'unit-update', 'deploy'].includes(e.kind))) {
        try { candidate = prepareNarrativeTransaction(candidate, proposal, namespace) as typeof candidate; }
        catch (error) { proposal.reason = String(error); proposal.status = /过期|聊天|分支|战内|未结算/.test(proposal.reason) ? 'stale' : 'unresolved'; }
      }
      await this.transact(() => candidate, { messageTags: [tag] });
    };
    const next = this.scanQueue.then(run, run).catch(error => { if (!this.disposed && sameSession(session, this.store.session())) { this.error = String(error); this.notify(); } });
    this.scanQueue = next; return next;
  }
  async rebind(id: string): Promise<void> {
    const before = this.snapshot(); const old = before.proposals?.find(p => p.id === id); const namespace = this.host.namespace();
    if (!old || !namespace || !['legacy', 'stale'].includes(old.status)) throw Error('缺少可重新预览的候选');
    if (old.corrected) { const receipt = await this.correctProposal(id, old.source.text); if (receipt.status !== 'confirmed') throw Error(receipt.error ?? '草稿尚未保存'); return; }
    const current = this.host.messageBySource(old.source.messageId);
    if (!current || current.role !== 'assistant' || !current.complete || namespaceOf(current) !== namespace || protocolExcerpt(current.text) !== old.source.text || current.swipeId !== old.source.swipeId) throw Error('原消息已变化，需要重新扫描');
    if (sourceCommitted(before, messageSourceKey(current))) throw Error('此消息已入账');
    const binding = captureGeneration(before, namespace, crypto.randomUUID()); binding.complete = true; binding.manualOnly = true;
    current.generationId = binding.id; const proposal = proposalFromMessage(current, binding)!;
    const receipt = await this.transact(state => ({ ...state, proposals: [...(state.proposals ?? []).map((p): NarrativeProposal => p.id === old.id ? { ...p, status: 'stale' } : p), proposal] }));
    if (receipt.status !== 'confirmed') throw Error(receipt.error ?? '候选尚未保存');
  }
  dispose(): void {
    if (this.disposed) return;
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
