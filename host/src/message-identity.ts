import { randomId } from './browser-compat.js';
import type { HostMessage } from './sillytavern.js';
import type { MessageTag } from './contracts.js';
import { protocolExcerpt } from '../../panel/src/protocol.js';

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
/** Both fingerprints describe one message and swipe (role, swipe, send date, completion), whatever its text. */
export function sameMessageApartFromText(a: string, b: string): boolean {
  try {
    const [left, right] = [a, b].map(value => JSON.parse(value) as unknown);
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 6 || right.length !== 6) return false;
    for (const fields of [left, right]) { fields[2] = null; fields[5] = !!fields[5]; }
    return JSON.stringify(left) === JSON.stringify(right);
  } catch { return false; }
}
export class SourceMessageChangedError extends Error {
  constructor() { super('来源消息已编辑、移动或删除，请重新扫描'); this.name = 'SourceMessageChangedError'; }
}
/** MVU may append its own update/status text; message identity and our events must remain exact. */
export function matchesMessageTag(message: HostMessage, tag: MessageTag): boolean {
  return tag.excerpt
    ? sameMessageApartFromText(messageFingerprint(message), tag.fingerprint) && protocolExcerpt(message.mes ?? '') === tag.excerpt
    : matchesMessageFingerprint(message, tag.fingerprint);
}
export function prepareMessageTag(chat: HostMessage[], index: number): MessageTag {
  const message = chat[index]; if (!message) throw Error('消息已不存在');
  return { index, id: sourceId(message) ?? 'tb-source:' + randomId(), fingerprint: messageFingerprint(message) };
}
export function findMessageBySourceId(chat: HostMessage[], id: string): number | undefined {
  if (/^\d+$/.test(id)) { const index = Number(id); return chat[index] ? index : undefined; }
  const matches = chat.flatMap((message, index) => sourceId(message) === id ? [index] : []);
  return matches.length === 1 ? matches[0] : undefined;
}
