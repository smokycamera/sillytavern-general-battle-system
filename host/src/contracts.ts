import type { NarrativeSave } from '../../panel/src/narrative-state.js';

export interface ChatScope {
  key: string;
  account: string;
  avatar: string;
  characterName: string;
  chatId: string;
}
export interface HostSession { scope: ChatScope; epoch: number }
export interface MessageTag { index: number; id: string; fingerprint: string }
export interface LegacyHandoff { panel: NarrativeSave; mirrorKey: string; mirrorValue: string }
export interface NativeEnvelope {
  format: 'tavern-battle-native';
  containerVersion: 1;
  documentId: string;
  generation: string;
  revision: number;
  state: 'active' | 'cleared';
  lastOperationId: string;
  payloadHash: string;
  payload: NarrativeSave | null;
  migration?: { source: 'helper-chat' | 'explicit-file' | 'empty'; sourceHash: string; legacyNamespace?: string };
  handoff?: { target: 'helper'; sourceHash: string };
}
export interface PersistReceipt {
  status: 'confirmed' | 'pending' | 'conflict' | 'failed';
  operationId: string;
  session: HostSession;
  error?: string;
}
export interface MetadataPort {
  session(): HostSession | undefined;
  metadata(): Record<string, unknown> | undefined;
  hasLegacyRuntime(): boolean;
  saveMetadata(): Promise<void>;
  readPersisted(scope: ChatScope): Promise<Record<string, unknown>>;
  applyMessageTags?(session: HostSession, tags: MessageTag[]): Promise<void>;
  verifyMessageTags?(scope: ChatScope, tags: MessageTag[]): Promise<boolean>;
  applyLegacyHandoff?(session: HostSession, handoff: LegacyHandoff): Promise<void>;
  verifyLegacyHandoff?(scope: ChatScope, handoff: LegacyHandoff): Promise<boolean>;
}
export interface RecoveryRecord {
  session: HostSession;
  expected: { generation: string; revision: number; payloadHash: string } | null;
  candidate: NativeEnvelope;
  messageTags?: MessageTag[];
  previous?: NativeEnvelope;
  legacyHandoff?: LegacyHandoff;
}
export interface RecoveryJournal {
  get(key: string): Promise<RecoveryRecord | undefined>;
  put(key: string, value: RecoveryRecord): Promise<void>;
  remove(key: string, operationId: string): Promise<void>;
}
export function sameSession(a: HostSession | undefined, b: HostSession | undefined): boolean {
  return !!a && !!b && a.scope.key === b.scope.key && a.epoch === b.epoch;
}
