import type { HostMessage } from './sillytavern.js';
import type { MessageTag } from './contracts.js';

export function sourceId(message: HostMessage | undefined): string | undefined {
  const id = message?.extra?.tavernBattleSourceId;
  return typeof id === 'string' && /^tb-source:[\w-]+$/.test(id) ? id : undefined;
}
export function messageFingerprint(message: HostMessage): string {
  return JSON.stringify([message.is_user === true, message.is_system === true, message.mes, message.swipe_id ?? null, message.send_date ?? null, message.gen_finished ?? null]);
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
