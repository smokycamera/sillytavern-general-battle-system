import { randomId } from '../../host/src/browser-compat.js';
import { SourceMessageChangedError } from '../../host/src/message-identity.js';
import type { HostSession, MetadataPort, NativeEnvelope, PersistReceipt, RecoveryJournal, RecoveryRecord, MessageTag, LegacyHandoff } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import type { NarrativeSave } from '../../panel/src/narrative-state.js';
import { envelopeFrom, matches, payloadHash } from './save-envelope.js';

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
  private pending?: RecoveryRecord;
  constructor(private host: MetadataPort, private journal: RecoveryJournal) {}
  snapshot(): NarrativeSave { return structuredClone(this.current?.payload ?? {}); }
  envelope(): NativeEnvelope | undefined { return structuredClone(this.current); }
  head(): Omit<NativeEnvelope, 'payload'> | undefined { if (!this.current) return undefined; const { payload: _payload, ...head } = this.current; return structuredClone(head); }
  session(): HostSession | undefined { return structuredClone(this.active); }
  pendingOperation(): RecoveryRecord | undefined { return structuredClone(this.pending); }
  hasPending(): boolean { return !!this.pending; }
  private result(status: PersistReceipt['status'], session: HostSession, operationId: string, error?: unknown): PersistReceipt {
    return { status, session, operationId, ...(error === undefined ? {} : { error: errorText(error) }) };
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task); this.queue = result.catch(() => undefined); return result;
  }
  load(): Promise<void> {
    const session = this.host.session();
    this.current = undefined; this.active = undefined; this.pending = undefined;
    return this.enqueue(async () => {
    if (!session) throw Error('无法确认当前是哪个角色聊天，暂时不能读取战阵存档');
    const metadata = await this.host.readPersisted(session.scope);
    const envelope = envelopeFrom(metadata.tavernBattle);
    if (envelope && await payloadHash(envelope.payload) !== envelope.payloadHash) throw Error(CORRUPT + '，没有读取');
    const pending = await this.journal.get(session.scope.key);
    if (pending && (pending.session.scope.key !== session.scope.key || await payloadHash(pending.candidate.payload) !== pending.candidate.payloadHash)) throw Error('浏览器里记录的未完成保存已损坏，无法继续使用');
    if (!sameSession(session, this.host.session())) return;
    this.current = envelope; this.active = session;
    if (pending && matches(envelope, pending.candidate)) {
      if (await this.effectsVerified(session, pending)) await this.journal.remove(session.scope.key, pending.candidate.lastOperationId);
      else { this.current = structuredClone(pending.previous); this.pending = pending; }
    } else if (pending) {
      // A cleared or newer generation never inherits an old recovery candidate.
      const expected = pending.expected;
      if ((!envelope && !expected) || envelope && expected && envelope.generation === expected.generation && envelope.revision === expected.revision && envelope.payloadHash === expected.payloadHash) this.pending = pending;
    }
    });
  }
  commit(expectedRevision: number, update: (before: NarrativeSave) => NarrativeSave, options: {
    operationId?: string; clear?: boolean; replace?: boolean; migration?: NativeEnvelope['migration']; messageTags?: MessageTag[]; legacyHandoff?: LegacyHandoff; resumeHandoff?: boolean;
  } = {}): Promise<PersistReceipt> {
    // Capture before queueing so a delayed request cannot jump to another chat.
    const session = this.active;
    if (!session) return Promise.reject(Error('战阵存档还没读取完成，请稍后再试'));
    const operationId = options.operationId ?? randomId();
    return this.enqueue(async () => {
      if (!sameSession(session, this.active) || !sameSession(session, this.host.session()) || this.host.hasLegacyRuntime()) return this.result('conflict', session, operationId, '聊天已切换，或旧版战阵脚本仍在运行，这次没有保存');
      if (this.current?.lastOperationId === operationId) return this.result('confirmed', session, operationId);
      if (this.current?.handoff && !options.resumeHandoff) return this.result('conflict', session, operationId, '这个存档已交给旧版战阵脚本，请先在存档管理里迁回');
      if (this.pending) return this.result('pending', session, operationId, '上一次保存还没确认成功，请先选择“重试保存”或“撤销这次改动”');
      if ((this.current?.revision ?? 0) !== expectedRevision) return this.result('conflict', session, operationId, '存档已更新，请重新打开或重新预览后再操作');
      const previous = this.current;
      try {
        const persisted = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
        if (previous ? !matches(persisted, previous) : !!persisted) return this.result('conflict', session, operationId, NEWER);
        if (persisted && await payloadHash(persisted.payload) !== persisted.payloadHash) return this.result('conflict', session, operationId, CORRUPT);
      } catch (error) { return this.result('failed', session, operationId, error); }
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return this.result('conflict', session, operationId, '保存过程中聊天已切换，这次没有保存');
      let candidate: NativeEnvelope;
      try {
        const payload = options.clear ? null : structuredClone(update(this.snapshot()));
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
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return this.result('conflict', session, operationId, '保存过程中聊天已切换，这次没有保存');
      // Repeated UI flushes must not rewrite an identical archive. The persisted
      // head was independently checked above, so this still detects outside edits.
      if (!options.operationId && previous && candidate.payloadHash === previous.payloadHash && !options.clear && !options.replace && !options.migration && !options.messageTags?.length && !options.legacyHandoff && !options.resumeHandoff) return this.result('confirmed', session, operationId);
      const record: RecoveryRecord = { session, candidate, expected: previous ? { generation: previous.generation, revision: previous.revision, payloadHash: previous.payloadHash } : null,
        previous: structuredClone(previous),
        ...(options.messageTags?.length ? { messageTags: structuredClone(options.messageTags) } : {}) };
      if (options.legacyHandoff) record.legacyHandoff = structuredClone(options.legacyHandoff);
      try { await this.journal.put(session.scope.key, record); }
      catch (error) { return this.result('failed', session, operationId, error); }
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return this.result('conflict', session, operationId, '保存前聊天已切换；这次改动留在原聊天，回到原聊天后可以继续处理');
      this.pending = record;
      return this.persist(record, session);
    });
  }
  retry(): Promise<PersistReceipt> {
    const session = this.active;
    if (!session) return Promise.reject(Error('战阵存档还没读取完成，请稍后再试'));
    return this.enqueue(async () => {
      const record = this.pending;
      if (!record) throw Error('没有需要重试的保存');
      const id = record.candidate.lastOperationId;
      if (!sameSession(session, this.active) || !sameSession(session, this.host.session()) || session.scope.key !== record.session.scope.key || this.host.hasLegacyRuntime()) return this.result('conflict', session, id, '聊天已切换，或旧版战阵脚本仍在运行');
      try {
        const saved = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
        if (saved && await payloadHash(saved.payload) !== saved.payloadHash) return this.result('conflict', session, id, CORRUPT);
        if (matches(saved, record.candidate)) return await this.effectsVerified(session, record) ? this.confirm(record, session) : this.persist(record, session);
        const expected = record.expected;
        if (saved ? !expected || saved.generation !== expected.generation || saved.revision !== expected.revision || saved.payloadHash !== expected.payloadHash : !!expected) return this.result('conflict', session, id, '酒馆里的战阵存档已被其他操作更新或清空，这次改动不能再覆盖它；请重新读取存档');
      } catch (error) { return this.result('pending', session, id, error); }
      if (!sameSession(session, this.host.session())) return this.result('conflict', session, id, '检查保存结果时聊天已切换，请回到原聊天再试');
      return this.persist(record, session, true);
    });
  }
  discardPending(): Promise<DiscardResult> {
    const session = this.active;
    if (!session) return Promise.reject(Error('战阵存档还没读取完成，请稍后再试'));
    return this.enqueue(() => this.discardRecord(session));
  }
  private async discardRecord(session: HostSession): Promise<DiscardResult> {
    const record = this.pending; if (!record) return { discarded: false };
    if (record.legacyHandoff) throw Error('正在把存档交回旧版战阵脚本，这一步不能撤销；请点“重试保存”完成');
    if (!sameSession(session, this.host.session()) || !sameSession(session, this.active) || this.host.hasLegacyRuntime()) throw Error('聊天已切换，或旧版战阵脚本仍在运行');
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
    if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) throw Error('检查保存结果时聊天已切换，请回到原聊天再试');
    await this.journal.remove(session.scope.key, record.candidate.lastOperationId);
    if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return { discarded: true };
    const currentMetadata = this.host.metadata();
    if (currentMetadata) { if (saved) currentMetadata.tavernBattle = structuredClone(saved); else delete currentMetadata.tavernBattle; }
    this.current = saved; this.pending = undefined;
    return { discarded: true };
  }
  /** Undoes a half-saved candidate with a verified forward write of its previous head. */
  private async restorePrevious(session: HostSession, record: RecoveryRecord, saved: NativeEnvelope): Promise<void> {
    const previous = record.previous;
    // A new revision on top of the saved head: the old record can never match disk again.
    const restored: NativeEnvelope | undefined = previous && { ...structuredClone(previous), documentId: saved.documentId, generation: saved.generation, revision: saved.revision + 1, lastOperationId: randomId() };
    for (const fullSave of [false, true]) {
      const metadata = this.host.metadata();
      if (!metadata || !sameSession(session, this.host.session()) || !sameSession(session, this.active)) throw Error('撤销时聊天已切换，请回到原聊天再试');
      if (restored) metadata.tavernBattle = structuredClone(restored); else delete metadata.tavernBattle;
      let error: unknown;
      try { await (fullSave ? this.host.saveChat!() : this.host.saveMetadata()); } catch (value) { error = value; }
      const after = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
      if (restored ? matches(after, restored) && await payloadHash(after!.payload) === restored.payloadHash : !after) {
        // The record no longer matches disk; a failed cleanup is skipped or re-offered by load.
        try { await this.journal.remove(session.scope.key, record.candidate.lastOperationId); } catch { /* See above. */ }
        if (sameSession(session, this.host.session()) && sameSession(session, this.active)) { this.current = structuredClone(restored); this.pending = undefined; }
        return;
      }
      if (!matches(after, saved)) throw Error(NEWER);
      if (error || fullSave || !this.host.saveChat) break;
    }
    throw Error('撤销这次改动时酒馆没有保存成功，请稍后再试');
  }
  private async persist(record: RecoveryRecord, session: HostSession, fullSave = false): Promise<PersistReceipt> {
    const id = record.candidate.lastOperationId;
    const metadata = this.host.metadata();
    if (!metadata || !sameSession(session, this.host.session())) return this.result('conflict', session, id, '聊天已切换，这次没有保存');
    if (record.legacyHandoff) {
      try {
        if (!this.host.applyLegacyHandoff) throw Error('当前酒馆不支持把存档交回旧版战阵脚本');
        await this.host.applyLegacyHandoff(session, record.legacyHandoff);
      } catch (error) { return this.result('pending', session, id, error); }
      if (!sameSession(session, this.host.session())) return this.result('conflict', session, id, '保存过程中聊天已切换，这次没有保存');
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
      if (!sameSession(session, this.host.session())) return this.result('conflict', session, id, '保存过程中聊天已切换，这次没有保存');
    }
    metadata.tavernBattle = structuredClone(record.candidate);
    let error: unknown;
    try {
      // Source tags live on chat[] messages, not in chat metadata. In particular,
      // Tauri's saveMetadata intentionally leaves the message body untouched.
      if (record.messageTags?.length || fullSave && this.host.saveChat) {
        if (!this.host.saveChat) throw Error('当前酒馆没有提供保存整段聊天的接口');
        await this.host.saveChat();
      } else {
        await this.host.saveMetadata();
      }
    } catch (value) { error = value; }
    // Even a throwing save may have reached the host. Verify before retrying it.
    try {
      const saved = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
      if (matches(saved, record.candidate)) {
        if (await payloadHash(saved!.payload) !== record.candidate.payloadHash) error ??= '保存后读回的存档和这次改动不一致';
        else if (await this.effectsVerified(session, record)) return this.confirm(record, session);
        // The message may change while the host serializes the chat. Re-apply the tags
        // once: a changed source is then undone above instead of staying half-saved.
        else if (!error && !fullSave && record.messageTags?.length && !record.legacyHandoff && sameSession(session, this.host.session()) && sameSession(session, this.active)) return this.persist(record, session, true);
        else error ??= record.legacyHandoff ? '存档已写入，但交给旧版战阵脚本的副本还没保存成功' : '存档已写入，但对应聊天消息的标记还没保存成功';
      } else {
        // Some hosts expose a metadata saver that returns without writing. Only
        // fall back when disk is still the exact previous head; never overwrite
        // a competing save or bypass an explicit host error.
        const unchanged = record.previous ? matches(saved, record.previous) && await payloadHash(saved!.payload) === record.previous.payloadHash : !saved;
        if (!error && unchanged && !fullSave && !record.messageTags?.length && this.host.saveChat && sameSession(session, this.host.session()) && sameSession(session, this.active)) return this.persist(record, session, true);
        error ??= unchanged ? '酒馆显示保存完成，但读回的仍是旧存档，这次改动没有写进去' : '读回的存档和这次改动对不上，可能已被其他操作改动';
      }
    } catch (value) { error = value; }
    return this.result('pending', session, id, error ?? '还没能确认这次保存成功');
  }
  private async confirm(record: RecoveryRecord, session: HostSession): Promise<PersistReceipt> {
    if (sameSession(session, this.active) && sameSession(session, this.host.session())) {
      this.current = structuredClone(record.candidate); this.pending = undefined;
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
