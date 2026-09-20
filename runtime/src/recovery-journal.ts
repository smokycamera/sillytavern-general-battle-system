import type { RecoveryJournal, RecoveryRecord } from '../../host/src/contracts.js';

export class MemoryJournal implements RecoveryJournal {
  private records = new Map<string, RecoveryRecord>();
  async get(key: string): Promise<RecoveryRecord | undefined> { return structuredClone(this.records.get(key)); }
  async put(key: string, value: RecoveryRecord): Promise<void> { this.records.set(key, structuredClone(value)); }
  async remove(key: string, operationId: string): Promise<void> { if (this.records.get(key)?.candidate.lastOperationId === operationId) this.records.delete(key); }
}

/** A journal is recovery evidence only, never an automatic authoritative save. */
export class IndexedDbJournal implements RecoveryJournal {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open('tavern-battle-native-recovery', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
      request.onblocked = () => { this.database = undefined; reject(Error('恢复记录数据库被其他窗口占用')); };
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('pending', mode); let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('恢复记录事务未完成'));
      try { action(tx.objectStore('pending'), result => { value = result; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  get(key: string): Promise<RecoveryRecord | undefined> {
    return this.transaction('readonly', (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result as RecoveryRecord | undefined); });
  }
  put(key: string, value: RecoveryRecord): Promise<void> { return this.transaction('readwrite', store => { store.put(structuredClone(value), key); }); }
  remove(key: string, operationId: string): Promise<void> {
    return this.transaction('readwrite', store => {
      const request = store.get(key); request.onsuccess = () => { if ((request.result as RecoveryRecord | undefined)?.candidate.lastOperationId === operationId) store.delete(key); };
    });
  }
}
