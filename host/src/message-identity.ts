import type { HostMessage } from './sillytavern.js';
import type { MessageTag } from './contracts.js';

export function sourceId(message: HostMessage | undefined): string | undefined {
  const id = message?.extra?.tavernBattleSourceId;
  return typeof id === 'string' && /^tb-source:[\w-]+$/.test(id) ? id : undefined;
}
export function messageFingerprint(message: HostMessage): string {
  return JSON.stringify([message.is_user === true, message.is_system === true, message.mes, message.swipe_id ?? null, message.send_date ?? null, !!message.gen_finished]);
}
/** rc.1–4 recorded the completion timestamp; only its finished/unfinished state is semantic. */
export function matchesMessageFingerprint(message: HostMessage, fingerprint: string): boolean {
  try {
    const saved: unknown = JSON.parse(fingerprint);
    if (!Array.isArray(saved) || saved.length !== 6) return false;
    saved[5] = !!saved[5];
    return JSON.stringify(saved) === messageFingerprint(message);
  } catch { return false; }
}
export class SourceMessageChangedError extends Error {
  constructor() { super('来源消息已编辑、移动或删除，请重新扫描'); this.name = 'SourceMessageChangedError'; }
}
export function prepareMessageTag(chat: HostMessage[], index: number): MessageTag {
  const message = chat[index]; if (!message) throw Error('消息已不存在');
  return { index, id: sourceId(message) ?? 'tb-source:' + crypto.randomUUID(), fingerprint: messageFingerprint(message) };
}
export function findMessageBySourceId(chat: HostMessage[], id: string): number | undefined {
  if (/^\d+$/.test(id)) { const index = Number(id); return chat[index] ? index : undefined; }
  const matches = chat.flatMap((message, index) => sourceId(message) === id ? [index] : []);
  return matches.length === 1 ? matches[0] : undefined;
}
