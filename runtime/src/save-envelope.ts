import type { NativeEnvelope } from '../../host/src/contracts.js';
import { serialized } from '../../host/src/json.js';
export { serialized } from '../../host/src/json.js';
export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serialized(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function envelopeFrom(value: unknown): NativeEnvelope | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('原生存档容器损坏');
  const envelope = value as NativeEnvelope;
  if (envelope.format !== 'tavern-battle-native' || envelope.containerVersion !== 1) throw Error('原生存档版本不受支持，只能导出或使用兼容版本');
  if (![envelope.documentId, envelope.generation, envelope.lastOperationId].every(value => typeof value === 'string' && value.length > 0) || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1 || !/^[0-9a-f]{64}$/.test(envelope.payloadHash)) throw Error('原生存档身份或版本损坏');
  if (envelope.state !== 'active' && envelope.state !== 'cleared' || envelope.state === 'cleared' && envelope.payload !== null || envelope.state === 'active' && (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload))) throw Error('原生存档状态与内容不一致');
  if (envelope.handoff && (envelope.handoff.target !== 'helper' || typeof envelope.handoff.sourceHash !== 'string')) throw Error('原生存档交接标记损坏');
  return structuredClone(envelope);
}
export function matches(a: NativeEnvelope | undefined, b: NativeEnvelope | undefined): boolean {
  return !!a && !!b && a.documentId === b.documentId && a.generation === b.generation && a.revision === b.revision && a.lastOperationId === b.lastOperationId && a.payloadHash === b.payloadHash && a.state === b.state && serialized(a.handoff) === serialized(b.handoff) && serialized(a.migration) === serialized(b.migration);
}
