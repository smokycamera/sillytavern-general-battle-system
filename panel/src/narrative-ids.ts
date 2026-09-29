/** Short, deterministic public handles for the LLM. Saved identities remain unchanged. */
export function narrativeIds(save: { storage?: { id: string }[]; inventory?: { id: string }[] }) {
  const ids = [...new Set([...(save.storage ?? []).map(x => x.id), ...(save.inventory ?? []).map(x => x.id)])].sort();
  const publicIds = new Map<string, string>(), realIds = new Map<string, string>();
  const reserved = new Set(ids);
  const hash = (value: string) => {
    let n = 2166136261;
    for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
    return (n >>> 0).toString(36).padStart(7, '0');
  };
  for (const id of ids) {
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,9}$/.test(id)) { publicIds.set(id, id); continue; }
    const prefix = save.storage?.some(unit => unit.id === id) ? 'u' : 'e';
    let candidate: string, attempt = 0;
    do { candidate = prefix + hash(attempt ? id + ':' + attempt : id); attempt++; }
    while (reserved.has(candidate) || realIds.has(candidate));
    publicIds.set(id, candidate);
    realIds.set(candidate, id);
  }
  return { publicId: (id: string) => publicIds.get(id) ?? id, realId: (id: string) => realIds.get(id) ?? id };
}
