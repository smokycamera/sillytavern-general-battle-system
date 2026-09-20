import type { HostSession, LegacyHandoff, NativeEnvelope, PersistReceipt } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import { findMessageBySourceId } from '../../host/src/message-identity.js';
import type { NativeHost } from '../../host/src/sillytavern.js';
import { messageSourceKey, namespaceOf, type NarrativeSave } from '../../panel/src/narrative-state.js';
import { reviewMigration } from '../../panel/src/migration-review.js';
import { decodeSave, encodeSave } from '../../panel/src/storage-codec.js';
import { legacySource, type SourceBackups, type SourceBackup } from './legacy-import.js';
import { envelopeFrom, matches, payloadHash, serialized } from './save-envelope.js';
import { bindLegacySources } from './source-receipts.js';
import type { NativeStore } from './native-store.js';

type Summary = { units: number; inventory: number; reports: number; battle: boolean };
export interface SaveChangePreview { kind: 'clear' | 'file' | 'rollback' | 'resume'; before: Summary; after: Summary; changes: string[]; sourceChat?: string }
interface Change {
  preview: SaveChangePreview; session: HostSession; previous: NativeEnvelope; candidate: NarrativeSave;
  sourceHash: string; fileSource?: unknown; handoff?: LegacyHandoff; legacySourceHash?: string;
}
const summary = (save: NarrativeSave | null): Summary => ({ units: save?.storage?.length ?? 0, inventory: save?.inventory?.length ?? 0, reports: save?.reports?.length ?? 0, battle: !!save?.battle });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function legacyCompatibleSave(save: NarrativeSave, host: NativeHost): NarrativeSave {
  const next = structuredClone(save); const namespace = host.namespace(); const chat = host.context().chat;
  if (!namespace || !chat) throw Error('当前聊天身份不完整');
  const aliases = object(next.nativeSourceAliases) ? next.nativeSourceAliases as Record<string, string> : {};
  const remap = (key: string): string | undefined => {
    try {
      const parts: unknown = JSON.parse(aliases[key] ?? key);
      if (!Array.isArray(parts) || typeof parts[1] !== 'string') return key;
      if (!parts[1].startsWith('tb-source:')) return key;
      const index = findMessageBySourceId(chat, parts[1]);
      return index === undefined ? undefined : JSON.stringify([namespace, String(index)]);
    } catch { return key; }
  };
  next.committedNarrativeSources = [...new Set((next.committedNarrativeSources ?? []).flatMap(key => { const mapped = remap(key); return mapped ? [mapped] : []; }))];
  next.proposals = next.proposals?.map(proposal => {
    const index = findMessageBySourceId(chat, proposal.source.messageId);
    const message = index === undefined ? undefined : host.message(index);
    if (!message) return { ...proposal, ...(proposal.status !== 'committed' ? { status: 'stale' as const, reason: '回退时原消息已不存在' } : {}) };
    const source = { ...proposal.source, characterId: message.characterId, chatId: message.chatId, branchId: message.branchId, messageId: String(index) };
    return { ...proposal, source, sourceKey: messageSourceKey(source), expected: proposal.expected ? { ...proposal.expected, namespace: namespaceOf(source), messageId: String(index) } : undefined };
  });
  next.schemaVersion ??= 2; next.storage ??= []; next.rosterIds ??= []; next.inventory ??= [];
  next.saveScope = 'chat';
  return next;
}

/** Destructive changes require a concrete preview and a confirmed source backup. */
export class SaveManagement {
  private previews = new WeakMap<SaveChangePreview, Change>();
  constructor(private host: NativeHost, private store: NativeStore, private backups: SourceBackups) {}
  exportCurrent(): unknown {
    const session = this.host.session();
    return { format: 'tavern-battle-export', version: 1, exportedAt: new Date().toISOString(), scope: session?.scope,
      envelope: this.store.envelope() ?? this.host.metadata()?.tavernBattle };
  }
  exportLegacy(): NarrativeSave { return legacyCompatibleSave(this.store.snapshot(), this.host); }
  private current(): { session: HostSession; previous: NativeEnvelope } {
    const session = this.store.session(), previous = this.store.envelope();
    if (!session || !previous || !sameSession(session, this.host.session()) || this.store.pendingOperation() || this.host.hasLegacyRuntime()) throw Error('当前档案尚未确认、聊天已切换或旧脚本仍在运行');
    return { session, previous };
  }
  private remember(kind: SaveChangePreview['kind'], candidate: NarrativeSave, changes: string[], sourceHash: string, extra: Partial<Change> = {}, sourceChat?: string): SaveChangePreview {
    const { session, previous } = this.current();
    const preview: SaveChangePreview = { kind, before: summary(previous.payload), after: summary(candidate), changes, sourceChat };
    this.previews.set(preview, { preview: structuredClone(preview), session, previous, candidate: structuredClone(candidate), sourceHash, ...extra });
    return preview;
  }
  previewClear(): SaveChangePreview { return this.remember('clear', {}, ['清空本聊天的单位、库存、战斗和战报，记录新数据代次；旧变量和旧镜像不会自动补回。'], ''); }
  async previewFile(text: string): Promise<SaveChangePreview> {
    const captured = this.current();
    const raw: unknown = JSON.parse(text); if (!object(raw)) throw Error('存档文件必须是 JSON 对象');
    if (typeof raw.content === 'string' || raw.type === 'script') throw Error('这是脚本安装文件，不是聊天存档，请选择战阵导出的存档');
    let value: unknown = raw, sourceChat: string | undefined;
    if (raw.format === 'tavern-battle-export') {
      if (raw.version !== undefined && raw.version !== 1) throw Error('存档导出版本未知');
      value = raw.envelope ?? raw.legacy; sourceChat = object(raw.scope) && typeof raw.scope.chatId === 'string' ? raw.scope.chatId : undefined;
    }
    if (object(value) && value.format === 'tavern-battle-native') {
      const envelope = envelopeFrom(value)!;
      if (await payloadHash(envelope.payload) !== envelope.payloadHash) throw Error('导入文件校验失败');
      value = envelope.payload ?? {};
    }
    if (!object(value) || Object.keys(value).length && !['schemaVersion', 'storage', 'inventory', 'battle', 'roster', 'proposals', 'reports', 'factRevision'].some(key => key in value)) throw Error('文件没有可识别的战阵档案结构');
    const source = legacySource({ variables: { panel: value } })!;
    const review = reviewMigration(source); const candidate = review?.candidate ?? source;
    if (!sameSession(captured.session, this.host.session()) || !matches(captured.previous, this.store.envelope())) throw Error('读取文件期间聊天或档案已变化');
    return this.remember('file', candidate, review?.changes ?? [], await payloadHash(raw), { fileSource: raw }, sourceChat);
  }
  async previewRollback(): Promise<SaveChangePreview> {
    const { session, previous } = this.current(); if (previous.handoff) throw Error('此档案已经回退到旧脚本');
    const metadata = await this.host.readPersisted(session.scope); const original = legacySource(metadata);
    const mirrorKey = `tavern-battle:chat:chat:${session.scope.chatId}:panel`;
    if (!this.host.legacyStorage) throw Error('本地镜像存储不可用，只能先导出兼容存档');
    const mirror = this.host.legacyStorage.getItem(mirrorKey);
    if (mirror !== null && (!original || serialized(JSON.parse(decodeSave(mirror))) !== serialized(original))) throw Error('旧镜像与当前聊天旧变量不一致，无法确认归属；请先导出兼容存档，不自动覆盖该镜像');
    const candidate = legacyCompatibleSave(previous.payload ?? {}, this.host);
    const revision = Math.max(Date.now(), Number(original?.__tbSaveRevision ?? 0) + 1);
    if (!Number.isSafeInteger(revision)) throw Error('旧存档的镜像版本值损坏');
    candidate.__tbSaveRevision = revision;
    const handoff = { panel: candidate, mirrorKey, mirrorValue: encodeSave(JSON.stringify(candidate)) };
    if (!sameSession(session, this.host.session()) || !matches(previous, this.store.envelope())) throw Error('回退预览期间档案已变化');
    return this.remember('rollback', candidate, ['将原生阶段的最新进度同步到当前聊天旧变量及已确认归属的旧镜像。确认完成后停用原生扩展，再启用旧战阵脚本。'], await payloadHash(candidate), { handoff, legacySourceHash: await payloadHash(original ?? null) });
  }
  async previewResume(): Promise<SaveChangePreview> {
    const { session, previous } = this.current(); if (!previous.handoff) throw Error('当前没有已回退的档案');
    const source = legacySource(await this.host.readPersisted(session.scope));
    const review = source ? reviewMigration(source) : undefined;
    if (!sameSession(session, this.host.session()) || !matches(previous, this.store.envelope())) throw Error('重新迁移预览期间档案已变化');
    return this.remember('resume', review?.candidate ?? source ?? {}, review?.changes ?? [], await payloadHash(source ?? null), { legacySourceHash: await payloadHash(source ?? null) });
  }
  private async backup(change: Change): Promise<void> {
    const metadata = await this.host.readPersisted(change.session.scope);
    const persisted = envelopeFrom(metadata.tavernBattle);
    if (!matches(persisted, change.previous) || !persisted || await payloadHash(persisted.payload) !== persisted.payloadHash) throw Error('宿主档案已变化，请重新预览');
    const source = change.previous.payload ?? {}; const key = JSON.stringify(['native-before-change', change.session.scope.key, change.previous.generation, change.previous.revision]);
    const backup: SourceBackup = { session: change.session, source, sourceHash: await payloadHash(source), createdAt: new Date().toISOString(), envelope: change.previous,
      ...(change.handoff ? { legacyVariables: structuredClone(metadata.variables), legacyMirror: { key: change.handoff.mirrorKey, value: this.host.legacyStorage?.getItem(change.handoff.mirrorKey) ?? null } } : {}) };
    await this.backups.put(key, backup);
    const read = await this.backups.get(key);
    if (!read || !matches(read.envelope, change.previous) || await payloadHash(read.source) !== backup.sourceHash) throw Error('变更前备份尚未确认，未修改存档');
    if (change.fileSource !== undefined) {
      const fileKey = JSON.stringify(['import-file', change.session.scope.key, change.sourceHash]);
      await this.backups.put(fileKey, { session: change.session, source: change.candidate, sourceHash: change.sourceHash, fileSource: change.fileSource, createdAt: new Date().toISOString() });
      const file = await this.backups.get(fileKey);
      if (!file || await payloadHash(file.fileSource) !== change.sourceHash) throw Error('导入源备份尚未确认');
    }
    if (change.legacySourceHash !== undefined && await payloadHash(legacySource(metadata) ?? null) !== change.legacySourceHash) throw Error('旧变量在预览后已变化');
  }
  async apply(preview: SaveChangePreview): Promise<PersistReceipt> {
    const change = this.previews.get(preview); if (!change) throw Error('预览已失效，请重新预览');
    if (!sameSession(change.session, this.host.session()) || !matches(change.previous, this.store.envelope()) || this.store.pendingOperation() || this.host.hasLegacyRuntime()) throw Error('聊天或档案已变化，不能应用旧预览');
    await this.backup(change);
    if (!sameSession(change.session, this.host.session())) throw Error('备份期间聊天已切换');
    const kind = change.preview.kind;
    const candidate = kind === 'resume' ? bindLegacySources(change.candidate, this.host) : { save: change.candidate, tags: [] };
    const receipt = await this.store.commit(change.previous.revision, () => kind === 'rollback' ? change.previous.payload ?? {} : candidate.save, {
      clear: kind === 'clear' || kind === 'rollback' && change.previous.state === 'cleared',
      replace: kind === 'file' || kind === 'resume', resumeHandoff: kind === 'file' || kind === 'resume', legacyHandoff: change.handoff,
      messageTags: candidate.tags,
      migration: kind === 'file' || kind === 'resume' ? { source: kind === 'file' ? 'explicit-file' : 'helper-chat', sourceHash: change.sourceHash, legacyNamespace: this.host.namespace() } : undefined,
    });
    if (receipt.status === 'confirmed' || receipt.status === 'pending') this.previews.delete(preview);
    return receipt;
  }
}
