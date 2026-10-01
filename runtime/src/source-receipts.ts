import { prepareMessageTag, matchesMessageFingerprint } from '../../host/src/message-identity.js';
import { protocolExcerpt } from '../../panel/src/protocol.js';
import type { MessageTag } from '../../host/src/contracts.js';
import type { NativeHost } from '../../host/src/sillytavern.js';
import { messageSourceKey, narrativeReceiptKey, namespaceOf, proposalFromMessage, type NarrativeSave, type NarrativeProposal } from '../../panel/src/narrative-state.js';

function keyParts(key: string): string[] | undefined {
  try { const value: unknown = JSON.parse(key); return Array.isArray(value) && value.length === 2 && value.every(x => typeof x === 'string') ? value : undefined; } catch { return undefined; }
}
export function sameSource(a: string, b: string): boolean {
  if (a === b) return true;
  const left = keyParts(a), right = keyParts(b);
  return !!left && !!right && left[1]!.startsWith('tb-source:') && left[1] === right[1];
}
export function sourceCommitted(save: NarrativeSave, key: string): boolean {
  return !!save.committedNarrativeSources?.some(old => sameSource(old, key)) || !!save.proposals?.some(p => p.status === 'committed' && sameSource(p.sourceKey, key));
}

/** Alias legacy index receipts during the explicit import, before indexes can move. */
export function bindLegacySources(save: NarrativeSave, host: NativeHost, verifyFile = false): { save: NarrativeSave; tags: MessageTag[] } {
  const candidate = structuredClone(save); const namespace = host.namespace(); const chat = host.context().chat;
  if (!namespace || !chat) return { save: candidate, tags: [] };
  const foreignNamespace = verifyFile && [...candidate.committedNarrativeSources??[],...(candidate.proposals??[]).map(p=>p.sourceKey)].some(key=>{
    const parts=keyParts(key);return parts&&parts[0]!==namespace;
  });
  if (foreignNamespace || typeof candidate.legacySourceScope === 'string' && candidate.legacySourceScope !== host.session()?.scope.key) {
    candidate.storySync = false; candidate.autoApprove = false;
    candidate.importedNarrativeSources = structuredClone(candidate.committedNarrativeSources ?? []);
    candidate.committedNarrativeSources = candidate.committedNarrativeSources?.filter(key=>keyParts(key)?.[1]?.startsWith('tb-source:'));
    candidate.proposals = candidate.proposals?.map(p => ({ ...p,sourceKey:JSON.stringify(['imported:'+candidate.legacySourceScope,p.source.messageId]),...(p.status==='committed'?{}:{status:'stale' as const,reason:'跨聊天导入，请重新核对来源'}) }));
    return { save: candidate, tags: [] };
  }
  const committed = new Set(candidate.committedNarrativeSources ?? []);
  const deleted = new Set(candidate.deletedNarrativeReceipts ?? []);
  const tags: MessageTag[] = [];
  const aliases = { ...(candidate.nativeSourceAliases as Record<string, string> | undefined) };
  for (let index = 0; index < chat.length; index++) {
    const source = host.message(index); if (!source || source.role !== 'assistant') continue;
    const numericKey = JSON.stringify([namespace, String(index)]);
    const known = candidate.proposals?.filter(p => p.sourceKey === numericKey) ?? [];
    const original = proposalFromMessage({ ...source, messageId: String(index) });
    const wasDeleted = original && deleted.has(narrativeReceiptKey(original));
    if (!committed.has(numericKey) && !known.length && !wasDeleted) continue;
    const fingerprint = (candidate.legacySourceFingerprints as Record<string,string> | undefined)?.[String(index)];
    if (verifyFile && !fingerprint && !known.length) throw Error('兼容文件只有旧消息序号，缺少可核对的来源正文；请从原聊天重新导出后导入');
    if (fingerprint && !matchesMessageFingerprint(chat[index]!, fingerprint)) throw Error('兼容存档的来源内容已变化，请核对后再导入');
    if (!fingerprint && known.some(p => protocolExcerpt(source.text) !== (p.originalText ?? p.source.text))) throw Error('兼容存档来源与当前消息不一致，请核对后再导入');
    const tag = prepareMessageTag(chat, index); tags.push(tag);
    const idSource = { ...source, messageId: tag.id }; const stableKey = messageSourceKey(idSource);
    aliases[numericKey] = stableKey;
    if (committed.has(numericKey) || known.some(p => p.status === 'committed')) committed.add(stableKey);
    if (wasDeleted) deleted.add(narrativeReceiptKey({ ...original, source: idSource, sourceKey: stableKey }));
    for (const proposal of known) {
      proposal.source.messageId = tag.id; proposal.sourceKey = stableKey;
      if (proposal.expected?.messageId) proposal.expected.messageId = tag.id;
      // A legacy pending preview must be reread against its actual current source.
      if (proposal.status === 'pending' || proposal.status === 'failed') { proposal.status = 'stale'; proposal.reason = '原生迁移后请重新核对来源与战斗记录版本'; }
    }
  }
  if (candidate.committedNarrativeSources || committed.size) candidate.committedNarrativeSources = [...committed];
  if (candidate.deletedNarrativeReceipts || deleted.size) candidate.deletedNarrativeReceipts = [...deleted];
  if (Object.keys(aliases).length) candidate.nativeSourceAliases = aliases;
  return { save: candidate, tags };
}

export function invalidateMissingSources(save: NarrativeSave, host: NativeHost): NarrativeSave | undefined {
  let changed = false;
  const proposals = save.proposals?.map((proposal): NarrativeProposal => {
    if (proposal.status === 'committed' || proposal.status === 'rejected' || proposal.status === 'stale') return proposal;
    if (proposal.origin === 'ai-scan' && namespaceOf(proposal.source) === host.namespace()) return proposal;
    const current = host.messageBySource(proposal.source.messageId);
    if (current && namespaceOf(current) === namespaceOf(proposal.source) && current.complete && current.swipeId === proposal.source.swipeId && protocolExcerpt(current.text) === (proposal.originalText ?? proposal.source.text)) return proposal;
    changed = true;
    return { ...proposal, status: 'stale', reason: '来源消息已删除或属于其他聊天分支，不能继续提交' };
  });
  return changed ? { ...save, proposals } : undefined;
}
