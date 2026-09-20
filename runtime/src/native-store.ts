import type { HostSession, MetadataPort, NativeEnvelope, PersistReceipt, RecoveryJournal, RecoveryRecord, MessageTag, LegacyHandoff } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import type { NarrativeSave } from '../../panel/src/narrative-state.js';
import { envelopeFrom, matches, payloadHash } from './save-envelope.js';

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
    return { status, session, operationId, ...(error === undefined ? {} : { error: String(error) }) };
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task); this.queue = result.catch(() => undefined); return result;
  }
  load(): Promise<void> {
    const session = this.host.session();
    this.current = undefined; this.active = undefined; this.pending = undefined;
    return this.enqueue(async () => {
    if (!session) throw Error('当前聊天没有可靠身份，原生存档只能只读');
    const metadata = await this.host.readPersisted(session.scope);
    const envelope = envelopeFrom(metadata.tavernBattle);
    if (envelope && await payloadHash(envelope.payload) !== envelope.payloadHash) throw Error('原生存档校验失败，未载入');
    const pending = await this.journal.get(session.scope.key);
    if (pending && (pending.session.scope.key !== session.scope.key || await payloadHash(pending.candidate.payload) !== pending.candidate.payloadHash)) throw Error('待恢复记录身份或校验值损坏');
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
    if (!session) return Promise.reject(Error('尚未载入原生存档'));
    const operationId = options.operationId ?? crypto.randomUUID();
    return this.enqueue(async () => {
      if (!sameSession(session, this.active) || !sameSession(session, this.host.session()) || this.host.hasLegacyRuntime()) return this.result('conflict', session, operationId, '聊天已切换或旧战阵脚本仍在运行');
      if (this.current?.lastOperationId === operationId) return this.result('confirmed', session, operationId);
      if (this.current?.handoff && !options.resumeHandoff) return this.result('conflict', session, operationId, '此档案已交回旧脚本，请先显式迁回原生');
      if (this.pending) return this.result('pending', session, operationId, '上一笔操作的保存结果仍待核实');
      if ((this.current?.revision ?? 0) !== expectedRevision) return this.result('conflict', session, operationId, '档案版本已变，请重新预览');
      const previous = this.current;
      try {
        const persisted = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
        if (previous ? !matches(persisted, previous) : !!persisted) return this.result('conflict', session, operationId, '宿主持久状态已更新，请重新载入');
        if (persisted && await payloadHash(persisted.payload) !== persisted.payloadHash) return this.result('conflict', session, operationId, '宿主数据校验失败');
      } catch (error) { return this.result('failed', session, operationId, error); }
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return this.result('conflict', session, operationId, '核对版本期间聊天已切换');
      let candidate: NativeEnvelope;
      try {
        const payload = options.clear ? null : structuredClone(update(this.snapshot()));
        candidate = {
          format: 'tavern-battle-native', containerVersion: 1,
          documentId: previous?.documentId ?? crypto.randomUUID(),
          generation: options.clear || options.replace ? crypto.randomUUID() : previous?.generation ?? crypto.randomUUID(),
          revision: options.clear || options.replace ? 1 : expectedRevision + 1,
          state: options.clear ? 'cleared' : 'active', lastOperationId: operationId,
          payloadHash: await payloadHash(payload), payload,
          ...(options.migration ?? previous?.migration ? { migration: options.migration ?? previous?.migration } : {}),
          ...(options.legacyHandoff ? { handoff: { target: 'helper', sourceHash: await payloadHash(options.legacyHandoff.panel) } } : {}),
        };
      } catch (error) { return this.result('failed', session, operationId, error); }
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return this.result('conflict', session, operationId, '准备候选期间聊天已切换');
      // Repeated UI flushes must not rewrite an identical archive. The persisted
      // head was independently checked above, so this still detects outside edits.
      if (!options.operationId && previous && candidate.payloadHash === previous.payloadHash && !options.clear && !options.replace && !options.migration && !options.messageTags?.length && !options.legacyHandoff && !options.resumeHandoff) return this.result('confirmed', session, operationId);
      const record: RecoveryRecord = { session, candidate, expected: previous ? { generation: previous.generation, revision: previous.revision, payloadHash: previous.payloadHash } : null,
        previous: structuredClone(previous),
        ...(options.messageTags?.length ? { messageTags: structuredClone(options.messageTags) } : {}) };
      if (options.legacyHandoff) record.legacyHandoff = structuredClone(options.legacyHandoff);
      try { await this.journal.put(session.scope.key, record); }
      catch (error) { return this.result('failed', session, operationId, error); }
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return this.result('conflict', session, operationId, '保存前聊天已切换，候选保留在原聊天恢复记录中');
      this.pending = record;
      return this.persist(record, session);
    });
  }
  retry(): Promise<PersistReceipt> {
    const session = this.active;
    if (!session) return Promise.reject(Error('尚未载入原生存档'));
    return this.enqueue(async () => {
      const record = this.pending;
      if (!record) throw Error('没有待核实的保存');
      const id = record.candidate.lastOperationId;
      if (!sameSession(session, this.active) || !sameSession(session, this.host.session()) || session.scope.key !== record.session.scope.key || this.host.hasLegacyRuntime()) return this.result('conflict', session, id, '恢复目标已变或旧脚本正在运行');
      try {
        const saved = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
        if (saved && await payloadHash(saved.payload) !== saved.payloadHash) return this.result('conflict', session, id, '宿主数据校验失败');
        if (matches(saved, record.candidate)) return await this.effectsVerified(session, record) ? this.confirm(record, session) : this.persist(record, session);
        const expected = record.expected;
        if (saved ? !expected || saved.generation !== expected.generation || saved.revision !== expected.revision || saved.payloadHash !== expected.payloadHash : !!expected) return this.result('conflict', session, id, '宿主档案已更新或清理，旧候选不能覆盖');
      } catch (error) { return this.result('pending', session, id, error); }
      if (!sameSession(session, this.host.session())) return this.result('conflict', session, id, '读回期间聊天已切换');
      return this.persist(record, session, true);
    });
  }
  discardPending(): Promise<{ discarded: boolean; receipt?: PersistReceipt }> {
    const session = this.active;
    if (!session) return Promise.reject(Error('尚未载入原生存档'));
    return this.enqueue(async () => {
      const record = this.pending; if (!record) return { discarded: false };
      if (record.legacyHandoff) throw Error('回退交接候选不能直接丢弃，请继续核实完成交接');
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active) || this.host.hasLegacyRuntime()) throw Error('聊天已切换或旧脚本仍在运行');
      const metadata = await this.host.readPersisted(session.scope); const saved = envelopeFrom(metadata.tavernBattle);
      if (saved && await payloadHash(saved.payload) !== saved.payloadHash) throw Error('宿主数据校验失败');
      if (matches(saved, record.candidate)) {
        if (await this.effectsVerified(session, record)) return { discarded: false, receipt: await this.confirm(record, session) };
        throw Error('候选已部分落盘，不能当作未保存操作丢弃');
      }
      if (record.previous ? !matches(saved, record.previous) : !!saved) throw Error('宿主已存在其他进度，请重新读取后核对');
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) throw Error('核实时聊天已切换');
      await this.journal.remove(session.scope.key, record.candidate.lastOperationId);
      if (!sameSession(session, this.host.session()) || !sameSession(session, this.active)) return { discarded: true };
      const currentMetadata = this.host.metadata();
      if (currentMetadata) { if (saved) currentMetadata.tavernBattle = structuredClone(saved); else delete currentMetadata.tavernBattle; }
      this.current = saved; this.pending = undefined;
      return { discarded: true };
    });
  }
  private async persist(record: RecoveryRecord, session: HostSession, fullSave = false): Promise<PersistReceipt> {
    const id = record.candidate.lastOperationId;
    const metadata = this.host.metadata();
    if (!metadata || !sameSession(session, this.host.session())) return this.result('conflict', session, id, '保存目标不再是原聊天');
    if (record.legacyHandoff) {
      try {
        if (!this.host.applyLegacyHandoff) throw Error('宿主不支持兼容回退');
        await this.host.applyLegacyHandoff(session, record.legacyHandoff);
      } catch (error) { return this.result('pending', session, id, error); }
      if (!sameSession(session, this.host.session())) return this.result('conflict', session, id, '回退准备期间聊天已切换');
    }
    if (record.messageTags?.length) {
      try {
        if (!this.host.applyMessageTags) throw Error('宿主不支持持久消息身份');
        await this.host.applyMessageTags(session, record.messageTags);
      } catch (error) { return this.result('pending', session, id, error); }
      if (!sameSession(session, this.host.session())) return this.result('conflict', session, id, '消息绑定期间聊天已切换');
    }
    metadata.tavernBattle = structuredClone(record.candidate);
    let error: unknown;
    try {
      // Source tags live on chat[] messages, not in chat metadata. In particular,
      // Tauri's saveMetadata intentionally leaves the message body untouched.
      if (record.messageTags?.length || fullSave && this.host.saveChat) {
        if (!this.host.saveChat) throw Error('宿主没有提供聊天完整保存接口');
        await this.host.saveChat();
      } else {
        await this.host.saveMetadata();
      }
    } catch (value) { error = value; }
    // Even a throwing save may have reached the host. Verify before retrying it.
    try {
      const saved = envelopeFrom((await this.host.readPersisted(session.scope)).tavernBattle);
      if (matches(saved, record.candidate)) {
        if (await payloadHash(saved!.payload) !== record.candidate.payloadHash) error ??= '读回内容与候选校验值不一致';
        else if (await this.effectsVerified(session, record)) return this.confirm(record, session);
        else error ??= '档案已写入，但来源消息标记或回退副本尚未落盘';
      } else {
        // Some hosts expose a metadata saver that returns without writing. Only
        // fall back when disk is still the exact previous head; never overwrite
        // a competing save or bypass an explicit host error.
        const unchanged = record.previous ? matches(saved, record.previous) && await payloadHash(saved!.payload) === record.previous.payloadHash : !saved;
        if (!error && unchanged && !fullSave && !record.messageTags?.length && this.host.saveChat && sameSession(session, this.host.session()) && sameSession(session, this.active)) return this.persist(record, session, true);
        error ??= unchanged ? '宿主保存接口返回后，持久档案仍停留在上一版本' : '读回的档案身份或版本与本次候选不同';
      }
    } catch (value) { error = value; }
    return this.result('pending', session, id, error ?? '宿主尚未独立确认此次保存');
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
