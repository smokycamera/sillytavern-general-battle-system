import { randomId } from '../../host/src/browser-compat.js';
import { cloneData } from '../../engine/src/clone.js';
import { SourceMessageChangedError } from '../../host/src/message-identity.js';
import type { HostSession, MetadataPort, NativeEnvelope, PersistReceipt, RecoveryJournal, RecoveryRecord, MessageTag, LegacyHandoff } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import type { NarrativeSave } from '../../panel/src/narrative-state.js';
import { envelopeFrom, matches, payloadHash } from './save-envelope.js';
import type { ReplySaveWindow } from '../../host/src/reply-save.js';
import { compactSaveHistory } from '../../panel/src/save-history.js';

/** Players read these messages; drop the `Error:` prefix that String(error) adds. */
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const CORRUPT = '酒馆里的战阵存档没有通过完整性检查，可能已损坏';
const NEWER = '酒馆里的战阵存档已被其他操作更新，请重新读取存档后再看';
const SOURCE_CHANGED = '这次改动对应的聊天消息已被修改、重新生成或删除，改动没有生效；请重新扫描这条消息';
export interface DiscardResult { discarded: boolean; receipt?: PersistReceipt }

export class NativeStore {
  private current?: NativeEnvelope;
  private active?: HostSession;
  private queue: Promise<unknown> = Promise.resolve();
  /** Queued reads and writes not yet settled; a swapped-in host context is only adopted while idle. */
  private busy = 0;
  /** Writes queued or running: commits, retries and discards. */
  private writes = 0;
  private loads = 0;
  private pending?: RecoveryRecord;
  constructor(private host: MetadataPort, private journal: RecoveryJournal) {}
  snapshot(keys?: readonly (keyof NarrativeSave)[], battleFields?: readonly string[]): NarrativeSave {
    const save = this.current?.payload ?? {};
    const selected: NarrativeSave = keys ? Object.fromEntries(keys.filter(key => key in save).map(key => [key, save[key]])) : { ...save };
    if (battleFields && selected.battle) selected.battle = { kind: selected.battle.kind,
      snap: Object.fromEntries(battleFields.filter(key => key in selected.battle!.snap).map(key => [key, selected.battle!.snap[key]])) };
    return cloneData(compactSaveHistory(selected));
  }
  /** The current head as of this call, copied on first read; heads are replaced on commit, never edited in place. */
  snapshotLater(): () => NarrativeSave { const payload = this.current?.payload; let copy: NarrativeSave | undefined; return () => copy ??= cloneData(compactSaveHistory(payload ?? {})); }
  needsHistoryCompaction(): boolean { return !!this.current?.payload && compactSaveHistory(this.current.payload) !== this.current.payload; }
  envelope(): NativeEnvelope | undefined { return cloneData(this.current); }
  head(): Omit<NativeEnvelope, 'payload'> | undefined { if (!this.current) return undefined; const { payload: _payload, ...head } = this.current; return structuredClone(head); }
  session(): HostSession | undefined { return structuredClone(this.active); }
  pendingOperation(): RecoveryRecord | undefined { return structuredClone(this.pending); }
  hasPending(): boolean { return !!this.pending; }
  private result(status: PersistReceipt['status'], session: HostSession, operationId: string, error?: unknown): PersistReceipt {
    return { status, session, operationId, ...(error === undefined ? {} : { error: errorText(error) }) };
  }
  private enqueue<T>(task: () => Promise<T>, write = false): Promise<T> {
    this.busy++; if (write) this.writes++;
    const result = this.queue.then(task, task).finally(() => { this.busy--; if (write) this.writes--; }); this.queue = result.catch(() => undefined); return result;
  }
  /** A write is queued or running; an unconfirmed candidate without one is a save that ended unconfirmed. */
  saving(): boolean { return this.writes > 0; }
  /**
   * The chat a write belongs to: no reload since it started, and the host still shows that chat.
   * A same-chat object swap does not stop the write; the disk reads decide whether it landed.
   */
  private sameChat(session: HostSession): boolean {
    return sameSession(session, this.active) && this.host.session()?.scope.key === session.scope.key;
  }
  /**
   * The host can swap in a new metadata or chat object for the same chat without CHAT_CHANGED
   * (TauriTavern's updateChatMetadata, other extensions). While idle, keep the loaded archive
   * when the new object still holds exactly this head; anything else still needs a reload.
   */
  adoptContext(): boolean {
    const active = this.active, session = this.host.session();
    if (!active || !session) return false;
    if (sameSession(active, session)) return true;
    if (this.busy || this.pending || active.scope.key !== session.scope.key) return false;
    const shown: unknown = this.host.metadata()?.tavernBattle;
    if (this.current ? !(shown && typeof shown === 'object' && matches(shown as NativeEnvelope, this.current)) : shown !== undefined) return false;
    this.active = session; return true;
  }
  load(): Promise<void> {
    const session = this.host.session(), load = ++this.loads;
    this.current = undefined; this.active = undefined; this.pending = undefined;
    return this.enqueue(async () => {
    if (!session) throw Error('无法确认当前是哪个角色聊天，暂时不能读取战阵存档');
    const metadata = await this.host.readPersisted(session.scope);
    const envelope = envelopeFrom(metadata.tavernBattle);
    if (envelope && await payloadHash(envelope.payload) !== envelope.payloadHash) throw Error(CORRUPT + '，没有读取');
    const pending = await this.journal.get(session.scope.key);
    if (pending && (pending.session.scope.key !== session.scope.key || await payloadHash(pending.candidate.payload) !== pending.candidate.payloadHash)) throw Error('浏览器里记录的未完成保存已损坏，无法继续使用');
    // A metadata object swapped in for the same chat during the read leaves the file read valid;
    // a later load (another chat, or back again) owns the result instead.
    const now = this.host.session();
    if (load !== this.loads || now?.scope.key !== session.scope.key) return;
    this.current = envelope; this.active = now;
    if (pending && matches(envelope, pending.candidate)) {
      if (await this.effectsVerified(session, pending)) await this.journal.remove(session.scope.key, pending.candidate.lastOperationId);
      else { this.current = cloneData(pending.previous); this.pending = pending; }
    } else if (pending) {
      // A cleared or newer generation never inherits an old recovery candidate.
      const expected = pending.expected;
      if ((!envelope && !expected) || envelope && expected && envelope.generation === expected.generation && envelope.revision === expected.revision && envelope.payloadHash === expected.payloadHash) this.pending = pending;
    }
    // A same-chat object swapped in from a stale copy would write its head back on the host's
    // next save; give it the head just read. An unconfirmed write keeps its own recovery path.
    const live = load === this.loads && this.host.session()?.scope.key === session.scope.key ? this.host.metadata() : undefined;
    if (!this.pending && this.current && live && !matches(live.tavernBattle as NativeEnvelope | undefined, this.current)) live.tavernBattle = cloneData(this.current);
    });
  }
  commit(expectedRevision: number, update: (before: NarrativeSave) => NarrativeSave, options: {
    operationId?: string; clear?: boolean; replace?: boolean; migration?: NativeEnvelope['migration']; messageTags?: MessageTag[]; legacyHandoff?: LegacyHandoff; resumeHandoff?: boolean; replySave?: ReplySaveWindow;
  } = {}): Promise<PersistReceipt> {
    // Capture before queueing so a delayed request cannot jump to another chat.
    const session = this.active;
    if (!session) return Promise.reject(Error('战阵存档还没读取完成，请稍后再试'));
    const operationId = options.operationId ?? randomId();
    return this.enqueue(async () => {
      if (!this.sameChat(session) || this.host.hasLegacyRuntime()) return this.result('conflict', session, operationId, '聊天已切换，或脚本版战阵仍在运行，这次没有保存');
      if (this.current?.lastOperationId === operationId) return this.result('confirmed', session, operationId);
      if (this.current?.handoff && !options.resumeHandoff) return this.result('conflict', session, operationId, '这个存档已交给脚本版战阵，请先在存档管理里迁回');
      if (this.pending) return this.result('pending', session, operationId, '上一次保存还没确认成功，请先选择“重试保存”或“撤销这次改动”');
      if ((this.current?.revision ?? 0) !== expectedRevision) return this.result('conflict', session, operationId, '存档已更新，请重新打开或重新预览后再操作');
      const previous = this.current;
      try {
        const persisted = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle, false);
        if (previous ? !matches(persisted, previous) : !!persisted) return this.result('conflict', session, operationId, NEWER);
        if (persisted && await payloadHash(persisted.payload) !== persisted.payloadHash) return this.result('conflict', session, operationId, CORRUPT);
      } catch (error) { return this.result('failed', session, operationId, error); }
      if (!this.sameChat(session)) return this.result('conflict', session, operationId, '保存过程中聊天已切换，这次没有保存');
      let candidate: NativeEnvelope;
      try {
        const payload = options.clear ? null : structuredClone(compactSaveHistory(update(this.snapshot())));
        candidate = {
          format: 'tavern-battle-native', containerVersion: 1,
          documentId: previous?.documentId ?? randomId(),
          generation: options.clear || options.replace ? randomId() : previous?.generation ?? randomId(),
          revision: options.clear || options.replace ? 1 : expectedRevision + 1,
          state: options.clear ? 'cleared' : 'active', lastOperationId: operationId,
          payloadHash: await payloadHash(payload), payload,
          ...(options.migration ?? previous?.migration ? { migration: options.migration ?? previous?.migration } : {}),
          ...(options.legacyHandoff ? { handoff: { target: 'helper', sourceHash: await payloadHash(options.legacyHandoff.panel) } } : {}),
        };
      } catch (error) { return this.result('failed', session, operationId, error); }
      if (!this.sameChat(session)) return this.result('conflict', session, operationId, '保存过程中聊天已切换，这次没有保存');
      // Repeated UI flushes must not rewrite an identical archive. The persisted
      // head was independently checked above, so this still detects outside edits.
      if (!options.operationId && previous && candidate.payloadHash === previous.payloadHash && !options.clear && !options.replace && !options.migration && !options.messageTags?.length && !options.legacyHandoff && !options.resumeHandoff) return this.result('confirmed', session, operationId);
      const record: RecoveryRecord = { session, candidate, expected: previous ? { generation: previous.generation, revision: previous.revision, payloadHash: previous.payloadHash } : null,
        // Store heads are immutable and never exposed without a copy.
        previous,
        ...(options.messageTags?.length ? { messageTags: structuredClone(options.messageTags) } : {}) };
      if (options.legacyHandoff) record.legacyHandoff = structuredClone(options.legacyHandoff);
      try { await this.journal.put(session.scope.key, record); }
      catch (error) { return this.result('failed', session, operationId, error); }
      if (!this.sameChat(session)) return this.result('conflict', session, operationId, '保存前聊天已切换；这次改动留在原聊天，回到原聊天后可以继续处理');
      this.pending = record;
      return this.persist(record, session, false, options.replySave);
    }, true);
  }
  retry(): Promise<PersistReceipt> {
    const session = this.active;
    if (!session) return Promise.reject(Error('战阵存档还没读取完成，请稍后再试'));
    return this.enqueue(async () => {
      const record = this.pending;
      if (!record) throw Error('没有需要重试的保存');
      const id = record.candidate.lastOperationId;
      if (!this.sameChat(session) || session.scope.key !== record.session.scope.key || this.host.hasLegacyRuntime()) return this.result('conflict', session, id, '聊天已切换，或脚本版战阵仍在运行');
      try {
        const saved = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle, false);
        if (saved && await payloadHash(saved.payload) !== saved.payloadHash) return this.result('conflict', session, id, CORRUPT);
        if (matches(saved, record.candidate)) return await this.effectsVerified(session, record) ? this.confirm(record, session) : this.persist(record, session);
        const expected = record.expected;
        if (saved ? !expected || saved.generation !== expected.generation || saved.revision !== expected.revision || saved.payloadHash !== expected.payloadHash : !!expected) return this.result('conflict', session, id, '酒馆里的战阵存档已被其他操作更新或清空，这次改动不能再覆盖它；请重新读取存档');
      } catch (error) { return this.result('pending', session, id, error); }
      if (!this.sameChat(session)) return this.result('conflict', session, id, '检查保存结果时聊天已切换，请回到原聊天再试');
      return this.persist(record, session, true);
    }, true);
  }
  discardPending(): Promise<DiscardResult> {
    const session = this.active;
    if (!session) return Promise.reject(Error('战阵存档还没读取完成，请稍后再试'));
    return this.enqueue(() => this.discardRecord(session), true);
  }
  private async discardRecord(session: HostSession): Promise<DiscardResult> {
    const record = this.pending; if (!record) return { discarded: false };
    if (record.legacyHandoff) throw Error('正在把存档交回脚本版战阵，这一步不能撤销；请点“重试保存”完成');
    if (!this.sameChat(session) || this.host.hasLegacyRuntime()) throw Error('聊天已切换，或脚本版战阵仍在运行');
    const metadata = await this.host.readPersisted(session.scope); const saved = envelopeFrom(metadata.tavernBattle);
    if (saved && await payloadHash(saved.payload) !== saved.payloadHash) throw Error(CORRUPT);
    if (matches(saved, record.candidate)) {
      if (await this.effectsVerified(session, record)) return { discarded: false, receipt: await this.confirm(record, session) };
      // The archive reached disk without its message tags. Dropping the record would
      // leave that half-saved head in charge, so write the previous head back instead.
      await this.restorePrevious(session, record, saved!);
      return { discarded: true };
    }
    if (record.previous ? !matches(saved, record.previous) : !!saved) throw Error(NEWER);
    if (!this.sameChat(session)) throw Error('检查保存结果时聊天已切换，请回到原聊天再试');
    await this.journal.remove(session.scope.key, record.candidate.lastOperationId);
    if (!this.sameChat(session)) return { discarded: true };
    const currentMetadata = this.host.metadata();
    if (currentMetadata) { if (saved) currentMetadata.tavernBattle = cloneData(saved); else delete currentMetadata.tavernBattle; }
    this.current = saved; this.pending = undefined;
    return { discarded: true };
  }
  /** Undoes a half-saved candidate with a verified forward write of its previous head. */
  private async restorePrevious(session: HostSession, record: RecoveryRecord, saved: NativeEnvelope): Promise<void> {
    const previous = record.previous;
    // A new revision on top of the saved head: the old record can never match disk again.
    const restored: NativeEnvelope | undefined = previous && { ...cloneData(previous), documentId: saved.documentId, generation: saved.generation, revision: saved.revision + 1, lastOperationId: randomId() };
    for (const fullSave of [false, true]) {
      const metadata = this.host.metadata();
      if (!metadata || !this.sameChat(session)) throw Error('撤销时聊天已切换，请回到原聊天再试');
      if (restored) metadata.tavernBattle = cloneData(restored); else delete metadata.tavernBattle;
      let error: unknown;
      try { await (fullSave ? this.host.saveChat!() : this.host.saveMetadata()); } catch (value) { error = value; }
      const after = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle, false);
      if (restored ? matches(after, restored) && await payloadHash(after!.payload) === restored.payloadHash : !after) {
        // The record no longer matches disk; a failed cleanup is skipped or re-offered by load.
        try { await this.journal.remove(session.scope.key, record.candidate.lastOperationId); } catch { /* See above. */ }
        if (this.sameChat(session)) { this.current = cloneData(restored); this.pending = undefined; }
        return;
      }
      if (!matches(after, saved)) throw Error(NEWER);
      if (error || fullSave || !this.host.saveChat) break;
    }
    throw Error('撤销这次改动时酒馆没有保存成功，请稍后再试');
  }
  private async persist(record: RecoveryRecord, session: HostSession, fullSave = false, replySave?: ReplySaveWindow): Promise<PersistReceipt> {
    const id = record.candidate.lastOperationId;
    if (!this.host.metadata() || !this.sameChat(session)) return this.result('conflict', session, id, '聊天已切换，这次没有保存');
    if (record.legacyHandoff) {
      try {
        if (!this.host.applyLegacyHandoff) throw Error('当前酒馆不支持把存档交回脚本版战阵');
        await this.host.applyLegacyHandoff(session, record.legacyHandoff);
      } catch (error) { return this.result('pending', session, id, error); }
      if (!this.sameChat(session)) return this.result('conflict', session, id, '保存过程中聊天已切换，这次没有保存');
    }
    if (record.messageTags?.length) {
      try {
        if (!this.host.applyMessageTags) throw Error('当前酒馆不支持给聊天消息加标记');
        await this.host.applyMessageTags(session, record.messageTags);
      } catch (error) {
        if (error instanceof SourceMessageChangedError && !record.legacyHandoff) {
          // A source conflict is not an unknown write. Drop only after an independent
          // read proves disk is still the previous head; a half-saved head is undone first.
          try {
            const discarded = await this.discardRecord(session);
            if (discarded.receipt) return discarded.receipt;
            if (discarded.discarded) return { ...this.result('conflict', session, id, SOURCE_CHANGED), code: 'source-changed' };
          } catch (verification) { return this.result('pending', session, id, verification); }
        }
        return this.result('pending', session, id, error);
      }
      if (!this.sameChat(session)) return this.result('conflict', session, id, '保存过程中聊天已切换，这次没有保存');
    }
    // Write into the object the host holds now; a same-chat swap may have replaced the earlier one.
    const metadata = this.host.metadata();
    if (!metadata) return this.result('conflict', session, id, '聊天已切换，这次没有保存');
    metadata.tavernBattle = cloneData(record.candidate);
    let error: unknown;
    try {
      if (replySave) {
        // Release MESSAGE_RECEIVED after staging, so the host (and MVU) can finish then save.
        replySave.prepared();
        await replySave.waitForHost();
      }
      // Source tags live on chat[] messages, not in chat metadata. In particular,
      // Tauri's saveMetadata intentionally leaves the message body untouched.
      else if (record.messageTags?.length || fullSave && this.host.saveChat) {
        if (!this.host.saveChat) throw Error('当前酒馆没有提供保存整段聊天的接口');
        await this.host.saveChat();
      } else {
        await this.host.saveMetadata();
      }
    } catch (value) { error = value; }
    // Even a throwing save may have reached the host. Verify before retrying it.
    try {
      const combined = this.host.readPersistedWithEffects && (record.messageTags?.length || record.legacyHandoff)
        ? await this.host.readPersistedWithEffects(session.scope, record) : undefined;
      const saved = envelopeFrom((combined?.metadata ?? await this.host.readPersisted(session.scope)).tavernBattle, false);
      if (matches(saved, record.candidate)) {
        if (await payloadHash(saved!.payload) !== record.candidate.payloadHash) error ??= '保存后读回的存档和这次改动不一致';
        else if (combined ? combined.effectsVerified : await this.effectsVerified(session, record)) return this.confirm(record, session);
        // The message may change while the host serializes the chat. Re-apply the tags
        // once: a changed source is then undone above instead of staying half-saved.
        else if (!error && !fullSave && record.messageTags?.length && !record.legacyHandoff && this.sameChat(session)) return this.persist(record, session, true);
        else error ??= record.legacyHandoff ? '存档已写入，但交给脚本版战阵的副本还没保存成功' : '存档已写入，但对应聊天消息的标记还没保存成功';
      } else {
        // Some hosts expose a metadata saver that returns without writing; SillyTavern's
        // saveChatConditional gives up after 1 s while another save runs, which long chats
        // outlast; a same-chat object swapped in during the save can go to disk without this
        // write. Write once more with a full save, only while disk is still the exact previous
        // head; never overwrite a competing save or bypass an explicit host error.
        const unchanged = record.previous ? matches(saved, record.previous) && await payloadHash(saved!.payload) === record.previous.payloadHash : !saved;
        if (!error && unchanged && !fullSave && this.host.saveChat && this.sameChat(session)) return this.persist(record, session, true);
        error ??= unchanged ? '酒馆显示保存完成，但读回的仍是旧存档，这次改动没有写进去' : '读回的存档和这次改动对不上，可能已被其他操作改动';
      }
    } catch (value) { error = value; }
    return this.result('pending', session, id, error ?? '还没能确认这次保存成功');
  }
  private async confirm(record: RecoveryRecord, session: HostSession): Promise<PersistReceipt> {
    if (this.sameChat(session)) {
      this.current = record.candidate; this.pending = undefined;
      // An object the host swapped in during the save may hold an older head. Give it the
      // verified one, so the host's next save cannot write the old head back.
      const live = this.host.metadata();
      if (live && !matches(live.tavernBattle as NativeEnvelope | undefined, record.candidate)) live.tavernBattle = cloneData(record.candidate);
    }
    // A cleanup failure cannot turn a confirmed save into an unsafe retry.
    try { await this.journal.remove(session.scope.key, record.candidate.lastOperationId); } catch { /* Next load verifies and removes it. */ }
    return this.result('confirmed', session, record.candidate.lastOperationId);
  }
  private async effectsVerified(session: HostSession, record: RecoveryRecord): Promise<boolean> {
    const tags = !record.messageTags?.length || !!this.host.verifyMessageTags && await this.host.verifyMessageTags(session.scope, record.messageTags);
    return tags && (!record.legacyHandoff || !!this.host.verifyLegacyHandoff && await this.host.verifyLegacyHandoff(session.scope, record.legacyHandoff));
  }
}
