import type { NarrativeSave } from './narrative-state.js';
import { packArchiveJson, readArchiveJson } from './storage-codec.js';

export interface MigrationBackup {
  createdAt?: string;
  source?: NarrativeSave;
  packedSource?: string;
}

export function packMigrationBackup(backup: MigrationBackup): MigrationBackup {
  if (!backup?.source || typeof backup.source !== 'object' || Array.isArray(backup.source)) return backup;
  const packedSource = packArchiveJson(backup.source);
  if (!packedSource) return backup;
  const { source: _source, ...rest } = backup;
  return { ...rest, packedSource };
}

export function readMigrationBackup(backup: MigrationBackup | undefined): NarrativeSave | undefined {
  if (backup?.source) return backup.source;
  if (!backup?.packedSource) return;
  const source = readArchiveJson(backup.packedSource);
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('压缩迁移备份内容损坏');
  return source as NarrativeSave;
}

export function expandMigrationBackup(backup: MigrationBackup): MigrationBackup {
  if (!backup?.packedSource) return backup;
  const { packedSource: _packed, ...rest } = backup;
  return { ...rest, source: readMigrationBackup(backup) };
}
