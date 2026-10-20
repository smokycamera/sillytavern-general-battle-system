import type { Suggestion } from './tags.js';

type LegacyItemGrant = Omit<Extract<Suggestion, { kind: 'add'; item: string }>, 'kind' | 'id' | 'to'> & { kind: 'give'; id?: string };

/** Before 2.6.7, give created an item and id named its receiving unit. */
export function migrateSavedSuggestion(event: Suggestion): Suggestion {
  if (event.kind !== 'give' || !('item' in event) || typeof event.item !== 'string') return event;
  const { kind: _kind, id, ...grant } = event as unknown as LegacyItemGrant;
  return { ...grant, kind: 'add', ...(id ? { to: id } : {}) };
}
