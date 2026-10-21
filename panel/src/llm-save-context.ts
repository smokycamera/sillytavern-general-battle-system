import type { LlmEncounterContext } from './llm-context.js';
import { commanderBrief, type CommanderState, type KnownCommandCell } from './llm-command.js';
import { normalizeCommanderProfiles } from '../../engine/src/commander-profile.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const primitive = (value: unknown, keys: string[]): Record<string, any> => Object.fromEntries(Object.entries(object(value)).filter(([key, v]) => keys.includes(key)
  && (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))));
const strings = (value: unknown, count: number, length: number): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, count).map(v => v.slice(0, length)) : [];
const positions = (value: unknown): number[] => Array.isArray(value) ? value.filter((v): v is number => Number.isSafeInteger(v) && v >= 0) : [];

/** Persist state, never tool transcripts, provider responses, reasoning, or incidental object fields. */
export function savedCommanderState(value: unknown): CommanderState | undefined {
  const state = object(value), memory = object(state.memory);
  if (typeof state.battleSeed !== 'string' || !['ally', 'enemy', 'neutral'].includes(String(state.side))) return undefined;
  let brief;
  try { brief = commanderBrief(state.brief); } catch { return undefined; }
  const terrain: KnownCommandCell[] = (Array.isArray(memory.terrain) ? memory.terrain : []).flatMap(value => {
    const cell = object(value);
    if (!Number.isSafeInteger(cell.cell) || (cell.cell as number) < 0 || typeof cell.terrain !== 'string') return [];
    const result = primitive(cell, ['cell', 'terrain', 'terrainName', 'height', 'obstructionHeight', 'round']);
    result.round ??= 0;
    if (cell.structure) result.structure = { ...primitive(cell.structure, ['kind', 'level', 'hp', 'hpMax', 'owner', 'gateState', 'top', 'platformHeight', 'obstructionHeight', 'deckHeight']),
      access: positions(object(cell.structure).access) };
    if (cell.cover) result.cover = primitive(cell.cover, ['terrain', 'structure', 'rubble']);
    if (cell.overlays) result.overlays = strings(cell.overlays, 16, 120);
    if (Array.isArray(cell.connections)) result.connections = cell.connections.map(v => primitive(v, ['from', 'to', 'kind']));
    return [result as KnownCommandCell];
  });
  const contacts = (Array.isArray(memory.contacts) ? memory.contacts : []).map(v => primitive(v,
    ['id', 'name', 'side', 'pos', 'x', 'y', 'formationPosition', 'level', 'scale', 'quantityType', 'hp', 'hpMax', 'status', 'airborne', 'elevation', 'standingHeight', 'round']))
    .filter(v => typeof v.id === 'string' && typeof v.name === 'string').slice(-128);
  return { battleSeed: state.battleSeed, side: state.side as CommanderState['side'], brief,
    memory: { plan: typeof memory.plan === 'string' ? memory.plan.slice(0, 600) : '', notes: strings(memory.notes, 12, 300), terrain, contacts: contacts as NonNullable<CommanderState['memory']['contacts']> } };
}

/** The actual map is already in the battle snapshot; preparation designs are redundant after start. */
export function savedLlmContext(value: LlmEncounterContext | undefined, started: boolean): LlmEncounterContext | undefined {
  if (!value) return undefined;
  // Preparation previews are transient; an archived battle needs no active command context.
  if (!started) return undefined;
  const source = object(value), enemy = object(source.enemy);
  const result = { ...primitive(source, ['mode', 'field', 'lighting', 'mapLayout', 'objectiveMode', 'siegeAttacker', 'vipId', 'vipName']),
    enemy: { ...primitive(enemy, ['ability', 'source']), style: Object.fromEntries(Object.entries(object(enemy.style)).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) },
    commanders: normalizeCommanderProfiles(source.commanders), messageKey: '', detail: '' } as LlmEncounterContext;
  const commanders: NonNullable<LlmEncounterContext['llmCommanders']> = {};
  for (const side of ['ally', 'enemy', 'neutral'] as const) {
    const state = savedCommanderState(object(source.llmCommanders)[side]);
    if (state?.side === side) commanders[side] = state;
  }
  if (Object.keys(commanders).length) result.llmCommanders = commanders;
  return result;
}
