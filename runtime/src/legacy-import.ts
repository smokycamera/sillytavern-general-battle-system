import type { HostSession, NativeEnvelope, PersistReceipt } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import { NativeHost } from '../../host/src/sillytavern.js';
import type { NarrativeSave } from '../../panel/src/narrative-state.js';
import { reviewMigration, type MigrationReview } from '../../panel/src/migration-review.js';
import { envelopeFrom, payloadHash } from './save-envelope.js';
import { NativeStore } from './native-store.js';
import { bindLegacySources } from './source-receipts.js';

export interface SourceBackup { session: HostSession; source: NarrativeSave; sourceHash: string; createdAt: string; envelope?: NativeEnvelope; legacyMirror?: { key: string; value: string | null }; legacyVariables?: unknown; fileSource?: unknown }
export interface SourceBackups { put(key: string, backup: SourceBackup): Promise<void>; get(key: string): Promise<SourceBackup | undefined> }
export interface ImportPreview {
  session: HostSession;
  kind: 'native' | 'cleared' | 'legacy' | 'empty';
  sourceHash: string;
  source?: NarrativeSave;
  candidate?: NarrativeSave;
  review?: MigrationReview;
  counts: { units: number; inventory: number; reports: number; battle: boolean };
  legacyNamespace?: string;
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function legacySource(metadata: Record<string, unknown>): NarrativeSave | undefined {
  const variables = metadata.variables;
  if (variables === undefined) return undefined;
  if (!object(variables)) throw Error('当前聊天的旧变量容器损坏，需要人工核对');
  const value = variables.panel;
  if (value === undefined) return undefined;
  if (!object(value)) throw Error('当前聊天的旧战阵存档不是对象，需要人工核对');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2) throw Error('旧战阵存档版本未知，不能自动降级');
  if (value.factRevision !== undefined && (!Number.isSafeInteger(value.factRevision) || Number(value.factRevision) < 0)) throw Error('旧档事实版本损坏');
  // Invalid arrays and units are handled by the existing explicit review, never silently repaired here.
  return structuredClone(value) as NarrativeSave;
}
function counts(save?: NarrativeSave): ImportPreview['counts'] {
  return { units: Array.isArray(save?.storage) ? save.storage.length : Array.isArray(save?.roster) ? save.roster.length : 0,
    inventory: Array.isArray(save?.inventory) ? save.inventory.length : 0, reports: Array.isArray(save?.reports) ? save.reports.length : 0, battle: !!save?.battle };
}

/** Reads only the captured chat. There is deliberately no localStorage mirror lookup. */
export class LegacyImporter {
  private previews = new WeakSet<ImportPreview>();
  constructor(private host: NativeHost, private store: NativeStore, private backups: SourceBackups) {}
  async preview(): Promise<ImportPreview> {
    const session = this.host.session(); if (!session) throw Error('当前聊天身份不完整');
    const metadata = await this.host.readPersisted(session.scope);
    if (!sameSession(session, this.host.session())) throw Error('读取旧档期间聊天已切换');
    const native = envelopeFrom(metadata.tavernBattle);
    if (native) {
      if (await payloadHash(native.payload) !== native.payloadHash) throw Error('原生存档校验失败');
      return { session, kind: native.state === 'cleared' ? 'cleared' : 'native', sourceHash: native.payloadHash, counts: counts(native.payload ?? undefined) };
    }
    const source = legacySource(metadata);
    const sourceHash = await payloadHash(source ?? null);
    const review = source ? reviewMigration(source) : undefined;
    const preview: ImportPreview = { session, kind: source && Object.keys(source).length ? 'legacy' : 'empty', sourceHash,
      source, candidate: structuredClone(review?.candidate ?? source ?? {}), review, counts: counts(source), legacyNamespace: this.host.namespace() };
    this.previews.add(preview); return preview;
  }
  async adopt(preview: ImportPreview, choice: 'import' | 'empty'): Promise<PersistReceipt> {
    if (!this.previews.has(preview) || preview.kind === 'native' || preview.kind === 'cleared') throw Error('请重新取得当前聊天的迁移预览');
    const session = preview.session;
    if (!sameSession(session, this.host.session()) || !sameSession(session, this.store.session()) || this.host.hasLegacyRuntime()) throw Error('聊天已切换或旧脚本仍在运行');
    if (this.store.envelope() || this.store.pendingOperation()) throw Error('已经存在原生状态或待恢复操作，不能覆盖');
    // A caller cannot turn a changed source/candidate into an approved preview.
    const current = await this.host.readPersisted(session.scope);
    if (current.tavernBattle !== undefined || await payloadHash(legacySource(current) ?? null) !== preview.sourceHash) throw Error('迁移预览之后原档已变化，请重新核对');
    if (await payloadHash(preview.source ?? null) !== preview.sourceHash) throw Error('迁移预览内容已变化');
    const review = preview.source ? reviewMigration(preview.source) : undefined;
    const candidate = choice === 'empty' ? { save: {}, tags: [] } : bindLegacySources(structuredClone(review?.candidate ?? preview.source ?? {}), this.host);
    if (preview.source) {
      const key = JSON.stringify([session.scope.key, preview.sourceHash]);
      await this.backups.put(key, { session, source: preview.source, sourceHash: preview.sourceHash, createdAt: new Date().toISOString() });
      const backup = await this.backups.get(key);
      if (!backup || await payloadHash(backup.source) !== preview.sourceHash) throw Error('迁移原档备份尚未确认，未写入原生存档');
    }
    if (!sameSession(session, this.host.session())) throw Error('备份期间聊天已切换');
    const migration: NativeEnvelope['migration'] = { source: choice === 'empty' || preview.kind === 'empty' ? 'empty' : 'helper-chat', sourceHash: preview.sourceHash, legacyNamespace: preview.legacyNamespace };
    const receipt = await this.store.commit(0, () => candidate.save, { operationId: 'import:' + crypto.randomUUID(), migration, messageTags: candidate.tags });
    if (receipt.status === 'confirmed' || receipt.status === 'pending') this.previews.delete(preview);
    return receipt;
  }
}

export class MemorySourceBackups implements SourceBackups {
  private records = new Map<string, SourceBackup>();
  async put(key: string, value: SourceBackup): Promise<void> { this.records.set(key, structuredClone(value)); }
  async get(key: string): Promise<SourceBackup | undefined> { return structuredClone(this.records.get(key)); }
}
export class IndexedDbSourceBackups implements SourceBackups {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open('tavern-battle-native-sources', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sources');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
      request.onblocked = () => { this.database = undefined; reject(Error('原档备份数据库被占用')); };
    });
  }
  private async access<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('sources', mode); let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? Error('原档备份未完成'));
      try { act(transaction.objectStore('sources'), value => { result = value; }); } catch (error) { transaction.abort(); reject(error); }
    });
  }
  put(key: string, value: SourceBackup): Promise<void> { return this.access('readwrite', store => { store.put(structuredClone(value), key); }); }
  get(key: string): Promise<SourceBackup | undefined> { return this.access('readonly', (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result as SourceBackup | undefined); }); }
}
