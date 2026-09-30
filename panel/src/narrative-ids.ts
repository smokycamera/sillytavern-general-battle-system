/** Saved engine identities stay stable; public handles are allocated once and never reused. */
export interface NarrativeIdState { aliases: Record<string, string> }
interface IdentityUnit {
  id: string;
  snapshot?: IdentityUnit;
  weapon?: { id: string }; sidearm?: { id: string }; armor?: { id: string }; shield?: { id: string };
  accessories?: Record<string, { id: string } | undefined>;
  trinkets?: { id: string }[];
  abilities?: { id: string; cooldownGroup?: string }[];
  traitSources?: { id: string }[];
}
export interface NarrativeIdentitySave {
  storage?: IdentityUnit[];
  inventory?: { id: string; mechanics?: { kind: string }; lootType?: string }[];
  battle?: { snap: Record<string, unknown> } | null;
  narrativeIdState?: NarrativeIdState;
}
const handlePattern = /^[uwaciksg][1-9]\d*$/;
export function narrativeIds(save: NarrativeIdentitySave) {
  const entries: { id: string; prefix: string }[] = [];
  const register = (id: string | undefined, prefix: string) => { if (id) entries.push({ id, prefix }); };
  const units = [...(save.storage ?? [])];
  if (Array.isArray(save.battle?.snap.combatants)) units.push(...save.battle.snap.combatants as IdentityUnit[]);
  for (const unit of units) register(unit.id, 'u');
  for (const item of save.inventory ?? []) {
    const kind = item.mechanics?.kind ?? item.lootType;
    register(item.id, kind === 'weapon' ? 'w' : kind === 'armor' || kind === 'shield' ? 'a' : kind === 'consumable' ? 'c' : 'i');
  }
  for (const record of units) {
    const unit = record.snapshot ?? record;
    for (const gear of [unit.weapon, unit.sidearm]) register(gear?.id, 'w');
    for (const gear of [unit.armor, unit.shield]) register(gear?.id, 'a');
    for (const gear of [...Object.values(unit.accessories ?? {}), ...(unit.trinkets ?? [])]) register(gear?.id, 'i');
    for (const ability of unit.abilities ?? []) {
      register(ability.id, 'k');
      if (ability.cooldownGroup !== ability.id) register(ability.cooldownGroup, 'g');
    }
    for (const source of unit.traitSources ?? []) register(source.id, 's');
  }
  const publicIds = new Map<string, string>(), realIds = new Map<string, string>();
  const reserved = new Set(entries.map(entry => entry.id));
  const counters: Record<string, number> = { u: 0, w: 0, a: 0, c: 0, i: 0, k: 0, s: 0, g: 0 };
  const remember = (id: string, handle: string) => {
    publicIds.set(id, handle); realIds.set(handle, id);
    counters[handle[0]!] = Math.max(counters[handle[0]!]!, Number(handle.slice(1)));
  };
  // Keep deleted identities as reservations so an old u1 never selects a different unit.
  for (const [id, handle] of Object.entries(save.narrativeIdState?.aliases ?? {})) {
    if (typeof handle !== 'string' || !handlePattern.test(handle) || !Number.isSafeInteger(Number(handle.slice(1))) || realIds.has(handle)) continue;
    if (reserved.has(handle) && handle !== id) throw Error('短编号与已有身份冲突：' + handle);
    remember(id, handle);
  }
  for (const { id, prefix } of entries) {
    if (publicIds.has(id) || !id.startsWith(prefix) || !handlePattern.test(id) || !Number.isSafeInteger(Number(id.slice(1))) || realIds.has(id)) continue;
    remember(id, id);
  }
  for (const { id, prefix } of entries) {
    if (publicIds.has(id)) continue;
    let handle: string;
    do {
      if (counters[prefix]! >= Number.MAX_SAFE_INTEGER) throw Error('短编号超出可用范围');
      handle = prefix + ++counters[prefix]!;
    } while (reserved.has(handle) || realIds.has(handle));
    remember(id, handle);
  }
  const state: NarrativeIdState = { aliases: Object.fromEntries(publicIds) };
  const legacyIds = new Map<string, string>();
  const legacyReserved = new Set(entries.filter(entry => ['u', 'w', 'a', 'c', 'i'].includes(entry.prefix)).map(entry => entry.id));
  const legacyUnits = new Set(units.map(unit => unit.id));
  const legacyHash = (value: string) => {
    let n = 2166136261;
    for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
    return (n >>> 0).toString(36).padStart(7, '0');
  };
  // Old pending drafts may still contain the previous deterministic u/e hash handles.
  for (const id of [...legacyReserved].sort()) {
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,9}$/.test(id)) continue;
    const prefix = legacyUnits.has(id) ? 'u' : 'e';
    let handle: string, attempt = 0;
    do { handle = prefix + legacyHash(attempt ? id + ':' + attempt : id); attempt++; } while (legacyReserved.has(handle) || legacyIds.has(handle));
    legacyIds.set(handle, id);
  }
  return { state, publicId: (id: string) => publicIds.get(id) ?? id,
    realId: (id: string) => realIds.get(id) ?? (reserved.has(id) ? id : realIds.get(normalizeHandle(id)) ?? legacyIds.get(id)) ?? id };
}
function normalizeHandle(id: string): string {
  const value = id.trim().replace(/[０-９Ａ-Ｚａ-ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).toLowerCase();
  return /^[uwaciksg]0*\d+$/.test(value) ? value[0] + String(Number(value.slice(1))) : id;
}
export function mentionsNarrativeId(text: string, id: string): boolean {
  if (!id) return false;
  let from = 0, at: number;
  while ((at = text.indexOf(id, from)) !== -1) {
    if (!/[A-Za-z0-9_-]/.test(text[at - 1] ?? '') && !/[A-Za-z0-9_-]/.test(text[at + id.length] ?? '')) return true;
    from = at + id.length;
  }
  return false;
}
export function prepareNarrativeIds<T extends NarrativeIdentitySave>(save: T): T {
  const { state } = narrativeIds(save);
  return Object.keys(state.aliases).length ? { ...save, narrativeIdState: state } : save;
}

const referenceKeys = new Set(['id', 'unitId', 'itemId', 'abilityId', 'sourceId', 'owner', 'assignedTo', 'itemSourceId', 'sourceItemId',
  'equipmentId', 'equipmentSourceId', 'summonerId', 'weaponId', 'sidearmId', 'armorId', 'instanceId', 'cooldownGroup', 'targetId']);
const referenceLists = new Set(['preparedAbilityIds', 'unitIds', 'rosterIds']);
/** Translate identity fields in both directions without changing names, notes or definition IDs. */
export function mapNarrativeReferences<T>(value: T, resolve: (id: string) => string): T {
  const visit = (entry: unknown, key = ''): unknown => {
    if (typeof entry === 'string') return referenceKeys.has(key) || referenceLists.has(key) ? resolve(entry) : entry;
    if (Array.isArray(entry)) return entry.map(child => visit(child, key));
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.entries(entry).map(([childKey, child]) => [childKey,
      // Conditions and skill definitions are engine vocabulary, not saved instance identities.
      childKey === 'id' && ['conditions', 'spec', 'recipe'].includes(key) ? child
        : childKey === 'source' && key === 'effects' && typeof child === 'string' ? resolve(child) : visit(child, childKey)]));
  };
  return visit(value) as T;
}
