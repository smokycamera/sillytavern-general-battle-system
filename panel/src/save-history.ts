import { archiveStateStamp } from './archive-stamp.js';

const archiveContainers = new Set(['storage', 'inventory', 'legacyRecord', 'reports', 'start', 'before', 'deletedReport',
  'report', 'migrationBackups', 'source', 'inventoryMigrationBackup', 'unitMigrationBackup']);

/** Compact idempotency receipt; no edit request or previous item definition is retained. */
export function operationFingerprint(value: string): string {
  if (/^receipt-v1:[0-9a-f]{32}$/.test(value)) return value;
  const state = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < value.length; i++) for (let n = 0; n < state.length; n++) {
    state[n] = Math.imul(state[n]! ^ (value.charCodeAt(i) + n), [16777619, 2246822519, 3266489917, 668265263][n]!);
  }
  return 'receipt-v1:' + state.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Old edit trails are not game state. Copy only branches containing those trails. */
export function compactSaveHistory<T>(value: T): T {
  const visit = (node: unknown, record = false): unknown => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      const result = node.map(item => visit(item, record));
      return result.some((item, index) => item !== node[index]) ? result : node;
    }
    const source = node as Record<string, unknown>;
    let result = source;
    const change = (key: string, next: unknown, remove = false) => {
      if (result === source) result = { ...source };
      if (remove) delete result[key]; else result[key] = next;
    };
    for (const [key, child] of Object.entries(source)) {
      if (record && key === 'history') { change(key, undefined, true); continue; }
      // A conversion backup is useful only until the next change to that unit.
      if (record && key === 'legacyRecord' && child && typeof child === 'object'
        && Number(source.revision) !== Number((child as Record<string, unknown>).revision ?? 1) + 1) {
        change(key, undefined, true); continue;
      }
      if (key === 'inventoryOperations' && Array.isArray(child)) {
        const receipts = child.map(receipt => receipt && typeof receipt.fingerprint === 'string'
          && operationFingerprint(receipt.fingerprint) !== receipt.fingerprint
          ? { ...receipt, fingerprint: operationFingerprint(receipt.fingerprint) } : receipt);
        if (receipts.some((receipt, index) => receipt !== child[index])) change(key, receipts);
        continue;
      }
      // No edit trails live in battle logs, compiled mechanics or action previews.
      if (!archiveContainers.has(key)) continue;
      const next = visit(child, key === 'storage' || key === 'inventory' || key === 'legacyRecord' || key === 'inventoryMigrationBackup');
      if (next !== child) change(key, next);
    }
    if ((source.storage !== result.storage || source.inventory !== result.inventory)
      && (Array.isArray(result.reports) || result.deletedReport)) {
      const oldStamp = archiveStateStamp(source.storage, source.inventory);
      const newStamp = archiveStateStamp(result.storage, result.inventory);
      const rebase = (report: unknown) => report && typeof report === 'object'
        && (report as Record<string, unknown>).afterArchiveStamp === oldStamp ? { ...report, afterArchiveStamp: newStamp } : report;
      if (Array.isArray(result.reports)) {
        const reports = result.reports.map(rebase);
        if (reports.some((report, index) => report !== (result.reports as unknown[])[index])) change('reports', reports);
      }
      const deleted = result.deletedReport as { report?: unknown } | undefined;
      if (deleted && rebase(deleted.report) !== deleted.report) change('deletedReport', { ...deleted, report: rebase(deleted.report) });
    }
    return result;
  };
  return visit(value) as T;
}
