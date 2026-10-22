import { SmallBattle, MassBattle, type Combatant, type Order, type Side } from '../../engine/src/index.js';
import { controlPolicy } from '../../engine/src/battle-control.js';
import { FORMATION_NODES, FORMATION_EDGES, formationNode } from '../../engine/src/mass/formation.js';
import { withAbort } from '../../host/src/browser-compat.js';
import { openAiJsonRequest, openAiCommandRequest, JevAnswerError, type CommandTool, type CommandMessage } from './jev-connection.js';
import { canSpot } from '../../engine/src/observation.js';
import { unitLineOfSight, TERRAIN_NAMES, type Terrain } from '../../engine/src/small/spatial.js';
import { groundHeightAt, unitHeight } from '../../engine/src/small/height-map.js';
import { obstructionHeight, STRUCTURE_NAMES, type FieldStructure } from '../../engine/src/small/layers.js';
import { llmConnection, commandRequestOptions, type LlmSettings } from './llm-settings.js';
import { AUTO_TRIES, CONTEXT_TIMEOUT_MS } from './llm-context.js';
import { waitForJev, JEV_RETRY_DELAY_MS } from './jev-retry.js';
import { battleAbilities } from './battle-skills.js';
import { formationChoices } from './formation-orders.js';
import type { BattleStepResult } from './battle-step.js';
import type { GameAction } from './mcp-game.js';
import { incomingDiplomacy, playerLetters, latestLetter, type DiplomacyDecision } from '../../engine/src/diplomacy.js';
import { commandDiplomacy, commandDiplomacyDecision, commandLetters } from './llm-diplomacy.js';

export interface CommanderBrief { name: string; persona: string; known: string[]; mission: string }
export type CommanderToolName = 'commander_map' | 'commander_unit' | 'commander_plan' | 'commander_act' | 'commander_orders' | 'commander_intents' | 'diplomacy';
export interface CommandPrompts { preparation: string; command: string; intents: string; tools: Record<CommanderToolName, string> }
export interface KnownCommandCell { cell: number; terrain: string; height?: number; structure?: unknown; overlays?: unknown; connections?: unknown; cover?: unknown; round: number }
export interface RoundIntents { round: number; carryRound?: number; replanned: boolean; basis: { visible: string[]; friends: string[] }; units: Record<string, import('../../engine/src/index.js').UnitIntent> }
export interface CommandMemory { intents?: RoundIntents; letterId?: number; diplomacyRound?: number; diplomacyRevision?: number; plan: string; notes: string[]; terrain: KnownCommandCell[]; contacts?: (ReturnType<typeof unitSummary> & { round: number })[] }
export const emptyCommandMemory = (): CommandMemory => ({ plan: '', notes: [], terrain: [] });
interface CommandBudget { left: number; letterReviewed?: number }
export interface CommanderState { battleSeed: string; side: Side; brief: CommanderBrief; memory: CommandMemory; playerFallback?: { resumeRound?: number }; decision?: DiplomacyDecision & { round: number } }
type Battle = SmallBattle | MassBattle;
export interface CommandChoice { id: string; label: string; action?: GameAction; order?: Order; cost?: number; risks?: string[] }
/** A follow-up step names an action like a candidate does; it runs only if a later candidate matches it. */
export type CommandStep = Pick<GameAction, 'type' | 'targetId' | 'cell' | 'weaponMode' | 'abilityId'>;
export class CommandCancelled extends Error { constructor() { super('模型请求已取消，尚未应用本次指令'); } }
const text = (v: unknown, max: number): string => typeof v === 'string' ? v.trim().slice(0, max) : '';

export function commanderBrief(value: unknown): CommanderBrief {
  const v = value as Partial<CommanderBrief> | null;
  if (!v || !text(v.name, 120) || !text(v.persona, 2000) || !text(v.mission, 1500)
    || !Array.isArray(v.known) || v.known.some(k => typeof k !== 'string')) throw Error('指挥官简报格式无效');
  return { name: text(v.name, 120), persona: text(v.persona, 2000), known: v.known.slice(0, 24).map(k => text(k, 500)).filter(Boolean), mission: text(v.mission, 1500) };
}

/** Explicit allowlist: visible opponents never disclose exact stats, loadouts, skills or resources. */
function perspective(side: Side, own: Side): string { return side === own ? 'friendly' : 'opponent-' + (['ally', 'enemy', 'neutral'].filter(s => s !== own).indexOf(side) + 1); }
function observedUnit(u: Combatant, side: Side) {
  const visible = { id: u.id, name: u.name, side: perspective(u.side, side), pos: u.pos, formationPosition: u.formationPosition,
    level: u.level, scale: u.scale, body: u.body, hp: u.hp, hpMax: u.base.hpMax,
    quantityType: u.scale === 'hero' ? '生命' : '人数',
    status: u.status, airborne: u.airborne, elevation: u.elevation };
  return u.side !== side ? visible : { ...visible, hp: u.hp, hpMax: u.base.hpMax, morale: u.morale,
    fatigue: u.fatigue, suppression: u.suppression, barrier: u.barrier, tacticalPose: u.tacticalPose, traits: u.traits,
    stats: u.base, resources: u.resources, conditions: u.conditions.map(c => ({ id: c.id, dur: c.dur })), weapon: u.weapon, sidearm: u.sidearm,
    abilities: battleAbilities(u), abilityState: u.abilityState };
}
export function unitSummary(u: ReturnType<typeof observedUnit> & { x?: number; y?: number; standingHeight?: number; losFromActor?: { canSee: boolean; geometric?: boolean } }) {
  return { id: u.id, name: u.name, side: u.side, pos: u.pos, x: u.x, y: u.y, formationPosition: u.formationPosition, level: u.level,
    scale: u.scale, quantityType: u.quantityType, hp: u.hp, hpMax: u.hpMax, status: u.status, airborne: u.airborne, elevation: u.elevation, standingHeight: u.standingHeight, losFromActor: u.losFromActor };
}
const nodeName = (id: string, side: Side) => id.replace(/^(ally|enemy|neutral):/, (_, faction: Side) => perspective(faction, side) + ':');
function choiceView(choice: CommandChoice, side: Side) {
  const order = choice.order;
  return { id: choice.id, label: choice.label, action: choice.action, cost: choice.cost, risks: choice.risks,
    order: order && { type: order.type, targetId: order.targetId && nodeName(order.targetId.replace(/^zone:/, ''), side), abilityId: order.abilityId, abilityActorId: order.abilityActorId } };
}
const MOVE_COLUMNS = ['编号', '格', '消耗', '风险'];
/** Cell moves are the bulk of small-battle candidates, so they travel as rows. */
function choiceMessage(choices: CommandChoice[], side: Side) {
  const moves = choices.filter(c => c.action?.type === 'move' && typeof c.action.cell === 'number');
  return { choices: choices.filter(c => !moves.includes(c)).map(c => choiceView(c, side)),
    ...(moves.length ? { moves: moves.map(c => [c.id, c.action!.cell, c.cost, ...(c.risks?.length ? [c.risks] : [])]), moveColumns: MOVE_COLUMNS } : {}) };
}
const TERRAIN_CHARS: Record<Terrain, string> = { open: '.', cover: 'c', wall: '#', rough: ':', forest: 'F', hill: 'h', street: '=', shallow_water: '~', deep_water: 'W', swamp: '%', cliff: '^' };
const STRUCTURE_CHARS: Record<FieldStructure['kind'], string> = { cover: 'C', fortification: 'B', wall: 'X', gate: 'G', building: 'H', tower: 'T', bridge: 'b' };
/** One character per explored cell (structures replace terrain); only non-default details are listed. */
export function compactCommandMap(width: number, height: number, known: KnownCommandCell[]) {
  const rows = Array.from({ length: height }, () => Array<string>(width).fill('?'));
  const legend: Record<string, string> = { '?': '未探索' }, features: Record<string, unknown>[] = [];
  for (const cell of known) {
    const s = cell.structure as Partial<FieldStructure> | undefined, terrain = cell.terrain as Terrain;
    const char = s?.kind ? STRUCTURE_CHARS[s.kind] : TERRAIN_CHARS[terrain] ?? '*';
    rows[Math.floor(cell.cell / width)]![cell.cell % width] = char;
    legend[char] = s?.kind ? STRUCTURE_NAMES[s.kind] : TERRAIN_NAMES[terrain] ?? terrain;
    const overlays = cell.overlays as unknown[] | undefined, connections = cell.connections as unknown[] | undefined;
    const feature = { ...(cell.height ? { height: cell.height } : {}), ...(s?.kind === 'gate' ? { gate: s.gateState ?? 'closed', owner: s.owner } : {}),
      ...(s?.top ? { platform: s.platformHeight ?? s.deckHeight ?? true } : {}), ...(s?.access?.length ? { access: s.access } : {}),
      ...(overlays?.length ? { overlays } : {}), ...(connections?.length ? { connections } : {}) };
    if (Object.keys(feature).length) features.push({ cell: cell.cell, ...feature });
  }
  return { width, height, rows: rows.map(row => row.join('')), legend, features };
}

/** Never serialize the battle, snapshot, source narrative, allied orders, or full map into command requests. */
export function commandObservation(b: Battle, actorId?: string, side: Side = 'enemy') {
  const visible = b.visibleCombatants(side), intel = b.enemyIntel(side, visible);
  const field = b instanceof SmallBattle ? b.battlefield : undefined;
  const cells = b instanceof SmallBattle ? b.visibleCells(side) : [];
  const objective = field?.objective;
  const observer = visible.find(u => u.id === actorId && u.side === side);
  return { mode: b instanceof SmallBattle ? 'small' : 'mass', round: b.round, actorId,
    units: visible.map(u => ({ ...observedUnit(u, side), ...(field && u.pos !== undefined ? { x: u.pos % field.width, y: Math.floor(u.pos / field.width), standingHeight: unitHeight(field, u) } : {}),
      losFromActor: observer ? { canSee: canSpot(b.observationContext(), observer, u), geometric: field ? unitLineOfSight(field, observer, u) : undefined } : undefined,
      ...(b instanceof MassBattle ? { formationPosition: nodeName(formationNode(b.effectiveUnit(u)).id, side) } : {}) })),
    intel: {
      traces: intel.traces.map(t => ({ id: t.id, name: t.name, round: t.round, cell: t.cell, node: t.node && nodeName(t.node, side), layer: t.layer, checked: t.checked, routing: t.routing })),
      clues: intel.clues.map(c => ({ round: c.round, victimId: c.victimId, cell: c.cell, node: c.node && nodeName(c.node, side) })),
    },
    fieldTags: b.fieldTags,
    objective: objective && { kind: objective.kind, cell: objective.cell, roundLimit: objective.limit,
      ...(objective.kind === 'control' ? { cells: objective.cells, holdRounds: objective.rounds, attackingSide: objective.attackingSide && perspective(objective.attackingSide, side) } : {}),
      ...(objective.kind === 'escape' && visible.some(u => u.id === objective.unitId) ? { unitId: objective.unitId } : {}) },
    map: field && { width: field.width, height: field.height,
      cells: field.tiles.flatMap((terrain, cell) => cells[cell] ? [{ cell, terrain, terrainName: TERRAIN_NAMES[terrain], height: groundHeightAt(field, cell), obstructionHeight: obstructionHeight(field, cell),
        cover: { terrain: ['cover', 'forest'].includes(terrain) ? terrain : undefined,
          structure: ['cover', 'fortification'].includes(field.structures?.[cell]?.kind ?? '') ? field.structures![cell]!.kind : undefined,
          rubble: field.overlays?.[cell]?.includes('rubble') === true },
        structure: field.structures?.[cell] && { ...field.structures[cell], owner: field.structures[cell]?.owner && perspective(field.structures[cell]!.owner!, side),
          access: field.structures[cell]?.access?.filter(cell => cells[cell]) }, overlays: field.overlays?.[cell],
        connections: field.heightTransitions?.filter(t => (t.from === cell || t.to === cell) && cells[t.from] && cells[t.to]) }] : []) },
    ownOrders: b instanceof MassBattle ? [...b.orders.values()].filter(o => b.byId(o.unitId).side === side)
      .map(order => ({ unitId: order.unitId, ...choiceView({ id: '', label: '', order }, side).order })) : undefined,
    economy: b instanceof SmallBattle && actorId ? { ...b.getTurnEconomy(actorId), movementLeft: b.movementLeft(actorId), haste: b.hasteAvailable(actorId) } : undefined,
    // visibleLog already redacts unseen participants and supplies side-specific narration.
    events: b.visibleLog(side).filter(e => !(e.kind === 'rule' && /^指挥[：:]/.test(e.text))).slice(-12).map(e => ({ round: e.round, kind: e.kind,
      text: e.text.slice(0, 400).replace(/我方|敌方|第三方/g, label => { const faction = ({ 我方: 'ally', 敌方: 'enemy', 第三方: 'neutral' } as const)[label as '我方' | '敌方' | '第三方']; return faction === side ? '己方' : perspective(faction, side) === 'opponent-1' ? '对手一方' : '对手二方'; }),
      participants: e.participants?.filter(id => visible.some(u => u.id === id)),
      locations: e.locations && Object.fromEntries(Object.entries(e.locations).filter(([id]) => visible.some(u => u.id === id))) })),
  };
}

export function updateCommandMemory(b: Battle, memory: CommandMemory, side: Side = 'enemy'): CommandMemory {
  const observation = commandObservation(b, undefined, side);
  const terrain = new Map((memory.terrain ?? []).map(cell => [cell.cell, cell]));
  for (const cell of observation.map?.cells ?? []) terrain.set(cell.cell, { ...structuredClone(cell), round: b.round });
  const contacts = new Map((memory.contacts ?? []).map(unit => [unit.id, unit]));
  for (const unit of observation.units.filter(u => u.side !== 'friendly')) contacts.set(unit.id, { ...unitSummary(unit), losFromActor: undefined, round: b.round });
  return { ...(memory.intents ? { intents: memory.intents } : {}),
    ...(memory.letterId !== undefined ? { letterId: memory.letterId } : {}),
    ...(memory.diplomacyRound !== undefined ? { diplomacyRound: memory.diplomacyRound } : {}), ...(memory.diplomacyRevision !== undefined ? { diplomacyRevision: memory.diplomacyRevision } : {}),
    plan: text(memory.plan, 600), notes: (memory.notes ?? []).slice(0, 12).map(n => text(n, 300)), terrain: [...terrain.values()], contacts: [...contacts.values()].slice(-128) };
}

export function commanderTools(prompts: CommandPrompts, mode: 'small' | 'mass' | 'intents' = 'small'): CommandTool[] {
  const step = { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'string' }, targetId: { type: 'string' },
    cell: { type: 'integer', minimum: 0 }, weaponMode: { type: 'string', enum: ['primary', 'sidearm'] }, abilityId: { type: 'string' } } };
  const schemas: Partial<Record<CommanderToolName, Record<string, unknown>>> = {
    diplomacy: { mode: { type: 'string', enum: ['surrender', 'withdraw', 'accept', 'reject'] }, target: { type: 'string' }, id: { type: 'integer', minimum: 1 }, text: { type: 'string', maxLength: 1000 } },
    commander_map: { cells: { type: 'array', items: { type: 'integer', minimum: 0 } } },
    commander_unit: { unitId: { type: 'string' } },
    commander_plan: { plan: { type: 'string', maxLength: 600 }, addNotes: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 } },
      removeNotes: { type: 'array', items: { type: 'integer', minimum: 0 } } },
    ...(mode === 'small' ? { commander_act: { choice: { type: 'string' }, then: { type: 'array', maxItems: 7, items: step } } }
      : mode === 'intents' ? { commander_intents: { intents: { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false, required: ['unit', 'mode'], properties: { unit: { type: 'string' }, mode: { type: 'string', enum: ['attack', 'advance', 'hold', 'withdraw', 'support', 'open', 'close', 'use'] }, cell: { type: 'integer', minimum: 0 }, target: { type: 'string' }, skill: { type: 'string' } } } } } }
      : { commander_orders: { orders: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['unitId', 'choice'],
        properties: { unitId: { type: 'string' }, choice: { type: 'string' } } } } } }),
  };
  const required: Partial<Record<CommanderToolName, string[]>> = { diplomacy: ['mode'], commander_unit: ['unitId'], commander_act: ['choice'], commander_orders: ['orders'], commander_intents: ['intents'] };
  return (Object.keys(schemas) as CommanderToolName[]).map(name => ({ type: 'function', function: { name, description: prompts.tools[name],
    parameters: { type: 'object', properties: schemas[name], additionalProperties: false, required: required[name] ?? [] } } }));
}

/** The tool router sees only the prefiltered observation; it cannot look up arbitrary live units. */
export function commanderTool(name: string, args: Record<string, unknown>, b: Battle, actorId: string | undefined, state: CommanderState, choices: CommandChoice[] = []): unknown {
  const observation = commandObservation(b, actorId, state.side), { map } = observation;
  switch (name) {
    case 'commander_map': {
      if (args.cells !== undefined && (!Array.isArray(args.cells) || args.cells.some(cell => !Number.isSafeInteger(cell) || cell < 0))) throw Error('cells格式无效');
      const cells = Array.isArray(args.cells) ? new Set(args.cells) : undefined;
      if (b instanceof MassBattle) return { nodes: FORMATION_NODES.map(n => ({ ...n, id: nodeName(n.id, state.side), side: perspective(n.side, state.side),
        adjacent: FORMATION_EDGES.get(n.id)?.map(id => nodeName(id, state.side)) })), slots: b.formationSlots };
      const currentlyVisible = new Set(map?.cells.map(cell => cell.cell));
      const observer = b.combatants.find(u => u.id === actorId && u.side === state.side);
      return { width: map?.width, height: map?.height, cells: state.memory.terrain.filter(cell => !cells || cells.has(cell.cell))
        .map(cell => ({ ...cell, visible: currentlyVisible.has(cell.cell), x: cell.cell % map!.width, y: Math.floor(cell.cell / map!.width),
          losFromActor: currentlyVisible.has(cell.cell) && observer && b instanceof SmallBattle && b.battlefield
            ? { ground: unitLineOfSight(b.battlefield, observer, { ...observer, pos: cell.cell, airborne: false, elevation: undefined }),
              platform: b.battlefield.structures?.[cell.cell]?.top ? unitLineOfSight(b.battlefield, observer, { ...observer, pos: cell.cell, airborne: false, elevation: 1 }) : undefined } : undefined })) };
    }
    case 'commander_unit': {
      const current = observation.units.find(u => u.id === args.unitId);
      const observer = b.combatants.find(u => u.id === actorId && u.side === state.side), target = b.combatants.find(u => u.id === args.unitId);
      if (current) return { ...current, visible: true,
        losFromActor: observer && target ? { canSee: canSpot(b.observationContext(), observer, target),
          geometric: b instanceof SmallBattle && b.battlefield ? unitLineOfSight(b.battlefield, observer, target) : undefined } : undefined };
      const trace = observation.intel.traces.find(t => t.id === args.unitId), contact = state.memory.contacts?.find(u => u.id === args.unitId);
      return contact ? { lastSeen: contact, trace, visible: false } : trace ? { ...trace, visible: false } : { unknown: true };
    }
    case 'commander_plan': {
      const add = args.addNotes ?? [], remove = args.removeNotes ?? [];
      if (args.plan !== undefined && (typeof args.plan !== 'string' || args.plan.length > 600) || !Array.isArray(add) || add.length > 12
        || add.some(n => typeof n !== 'string' || n.length > 300) || !Array.isArray(remove) || remove.some(i => !Number.isSafeInteger(i))) throw Error('总计划或记事超出限制');
      if (typeof args.plan === 'string') state.memory.plan = args.plan;
      state.memory.notes = [...state.memory.notes.filter((_, i) => !remove.includes(i)), ...add as string[]].slice(-12);
      return { plan: state.memory.plan, notes: state.memory.notes };
    }
    case 'commander_act': {
      const choice = choices.find(c => c.id === args.choice);
      if (!choice) throw Error('候选编号无效');
      return choice;
    }
    default: throw Error('工具不存在');
  }
}

export function smallCommandChoices(b: SmallBattle, actorId: string): CommandChoice[] {
  return b.withReadOnlyQueries(() => {
    const actor = b.byId(actorId), choices: CommandChoice[] = [];
    const seen = b.visibleCells(actor.side), visible = new Set(b.visibleCombatants(actor.side).map(u => u.id));
    const allowedTarget = (id: string) => visible.has(id) || id.startsWith('cell:') && seen[Number(id.slice(5))] === true;
    const add = (label: string, action: GameAction) => choices.push({ id: 'c' + choices.length, label, action });
    for (const option of b.getActionOptions(actorId)) {
      if (!option.enabled || option.kind === 'move' && b.battlefield || option.kind === 'ability' && !battleAbilities(actor).some(a => a.id === option.id)) continue;
      const action: GameAction = option.kind === 'weapon' ? { type: 'attack', weaponMode: option.id === 'weapon:sidearm' ? 'sidearm' : 'primary' }
        : option.kind === 'ability' ? { type: 'ability', abilityId: option.id }
        : option.kind === 'move' ? { type: 'move', direction: option.id as 'advance' | 'withdraw' }
        : { type: option.kind === 'end-turn' ? 'end_turn' : option.kind };
      if (option.targets) {
        for (const target of option.targets) if (target.enabled && allowedTarget(target.targetId)) add(option.label, { ...action, targetId: target.targetId });
      } else add(option.label, action);
    }
    if (b.battlefield) {
      for (const path of b.reachableCells(actorId)) if (path.cost > 0 && path.cells.every(cell => seen[cell])) {
        add('移动', { type: 'move', cell: path.cells.at(-1)! });
        Object.assign(choices.at(-1)!, { cost: path.cost, risks: b.pathPreview(actorId, path.cells.at(-1)!).risks });
      }
      for (let cell = 0; cell < seen.length; cell++) if (seen[cell]) {
        if (!b.gateReason(actorId, cell)) add('开关门', { type: 'gate', cell });
        if (!b.climbReason(actorId, cell)) add('攀登', { type: 'climb', cell });
        for (const mode of ['primary', 'sidearm', ...battleAbilities(actor).map(a => a.id)]) {
          if (!b.structurePreview(actorId, cell, mode).reason) add('破坏结构', { type: 'structure', cell,
            ...(mode === 'primary' || mode === 'sidearm' ? { weaponMode: mode } : { abilityId: mode }) });
        }
      }
      if (!b.overwatchReason(actorId)) add('警戒', { type: 'overwatch' });
      for (const target of b.visibleCombatants(actor.side)) if (!b.suppressReason(actorId, target.id)) add('压制', { type: 'suppress', targetId: target.id });
    }
    for (const weaponMode of ['primary', 'sidearm'] as const) if (!b.reloadReason(actorId, weaponMode === 'sidearm')) add('主动装填', { type: 'reload', weaponMode });
    if (!b.flightReason(actorId, !actor.airborne)) add(actor.airborne ? '降落' : '升空', { type: actor.airborne ? 'land' : 'takeoff' });
    if (b.hasteAvailable(actorId) && !b.hasteSelected.has(actorId)) add('使用加速动作', { type: 'haste', enabled: true });
    return choices;
  });
}

export function massCommandChoices(b: MassBattle, actorId: string): CommandChoice[] {
  return b.withReadOnlyQueries(() => formationChoices(b, b.byId(actorId)).flatMap(choice => choice.targets
    .filter(target => !target.preview.reason).map(target => ({ id: '', label: choice.label, order: { ...target.order, automatic: true as const, externalCommand: true as const } })))
    .map((choice, i) => ({ ...choice, id: 'c' + i })));
}

function executeSmall(b: SmallBattle, actorId: string, a: GameAction): void {
  const target = a.targetId!;
  switch (a.type) {
    case 'move': if (b.battlefield) b.moveTo(actorId, a.cell as number); else b.move(actorId, a.direction!); break;
    case 'attack': b.attack(actorId, target, { weaponMode: a.weaponMode }); break;
    case 'charge': b.attack(actorId, target, { charge: true }); break;
    case 'ability': { const result = b.useAbility(actorId, a.abilityId!, a.targetId); if (!result.ok) throw Error(result.reason); break; }
    case 'brace': b.brace(actorId); break;
    case 'overwatch': b.setOverwatch(actorId); break;
    case 'reload': b.reloadWeapon(actorId, a.weaponMode === 'sidearm'); break;
    case 'suppress': b.suppress(actorId, target); break;
    case 'retreat': b.retreat(actorId); if (!b.battlefield) b.endTurn(); break;
    case 'takeoff': b.changeFlight(actorId, true); break;
    case 'land': b.changeFlight(actorId, false); break;
    case 'climb': b.climb(actorId, a.cell as number); break;
    case 'structure': b.attackStructure(actorId, a.cell as number, a.abilityId ?? a.weaponMode); break;
    case 'gate': b.toggleGate(actorId, a.cell as number); break;
    case 'haste': b.selectHaste(actorId, true); break;
    case 'end_turn': b.endTurn(); break;
    default: throw Error('无效的敌方指令');
  }
}

function commandSteps(value: unknown): CommandStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 7 || value.some(step => !step || typeof step !== 'object' || typeof step.type !== 'string')) throw Error('then格式无效');
  return value.map(({ type, targetId, cell, weaponMode, abilityId }) => ({ type, ...(typeof targetId === 'string' ? { targetId } : {}),
    ...(Number.isSafeInteger(cell) ? { cell } : {}), ...(weaponMode === 'primary' || weaponMode === 'sidearm' ? { weaponMode } : {}), ...(typeof abilityId === 'string' ? { abilityId } : {}) }));
}
/** A step must identify one target or cell; only the weapon of an otherwise identical attack may stay implicit (primary first). */
function stepChoice(choices: CommandChoice[], step: CommandStep): CommandChoice | undefined {
  const matches = choices.filter(({ action: a }) => a?.type === step.type && (step.targetId === undefined || a.targetId === step.targetId)
    && (step.cell === undefined || a.cell === step.cell) && (step.abilityId === undefined || a.abilityId === step.abilityId)
    && (step.weaponMode === undefined || (a.weaponMode ?? 'primary') === step.weaponMode));
  return new Set(matches.map(({ action: a }) => [a!.targetId, a!.cell, a!.abilityId].join())).size === 1 ? matches[0] : undefined;
}
interface CommandWatch { visible: Set<string>; hp: number; status: string; suppression: number; conditions: Set<string> }
function watch(b: SmallBattle, actorId: string): CommandWatch {
  const actor = b.byId(actorId);
  return { visible: new Set(b.visibleCombatants(actor.side).map(u => u.id)), hp: actor.hp, status: actor.status,
    suppression: actor.suppression ?? 0, conditions: new Set(actor.conditions.map(c => c.id)) };
}
/** Queued steps stop once the facts the commander decided on have changed. */
function interruption(b: SmallBattle, actorId: string, before: CommandWatch): string | undefined {
  const now = watch(b, actorId);
  if ([...now.visible].some(id => !before.visible.has(id))) return '出现新的可见单位';
  if (now.hp < before.hp) return '本单位受伤';
  if (now.status !== before.status || now.suppression > before.suppression || [...now.conditions].some(id => !before.conditions.has(id))) return '本单位状态改变';
  return undefined;
}

export class LlmCommandController {
  private aborter?: AbortController;
  private failed = new Set<string>();
  private pausedRounds = new WeakMap<Battle, number>();
  status = '';
  statusBattle?: string;
  busy = false;
  constructor(private prompts: CommandPrompts, private changed: () => void = () => {}, private request: typeof fetch = (url, init) => fetch(url, init), readonly side: Side = 'enemy') {}
  cancel(): void { this.aborter?.abort(); }
  receiveLetter(b: Battle, settings: LlmSettings): void {
    this.cancel(); this.pausedRounds.delete(b); this.failed.delete(this.key(b, settings));
  }
  /** Explicit command pause falls back locally for the remainder of this battle round. */
  pauseRound(b: Battle): void {
    this.pausedRounds.set(b, b.round);
    if (this.statusBattle === b.seed) this.cancel();
    this.statusBattle = b.seed; this.status = '本大回合由内置 AI 接管，下个大回合恢复 LLM 指挥';
  }
  private key(b: Battle, settings: LlmSettings): string { return JSON.stringify([b.seed, this.side, settings.url.trim(), settings.token.trim(), settings.model.trim(), settings.commandInterval, settings.commandThinking, settings.commandThinkingOffParams]); }
  private playerReady(b: Battle, state: CommanderState): boolean {
    if (!b.combatants.some(u => u.side === 'ally' && u.status === 'ready' && u.hp > 0)) {
      state.playerFallback = {}; delete state.memory.intents;
      this.pauseRound(b); this.status = '我方已全部溃败或失能，内置 AI 接管';
      return false;
    }
    if (state.playerFallback) {
      state.playerFallback.resumeRound ??= b.round + 1;
      if (b.round < state.playerFallback.resumeRound) {
        this.statusBattle = b.seed; this.status = `内置 AI 接管，第${state.playerFallback.resumeRound}大回合恢复 LLM 指挥`;
        return false;
      }
      delete state.playerFallback;
      this.status = '';
    }
    return true;
  }
  available(b: Battle, settings: LlmSettings, state?: CommanderState): boolean {
    return settings.enabled && settings.commandEnemy === true && state?.side === this.side && state.battleSeed === b.seed && b.rules.resolutionVersion === 'v2'
      && b.combatants.some(u => u.side === this.side && u.hp > 0 && ['ready', 'routing'].includes(u.status) && !u.moraleState?.forcedRetreat)
      && (state.decision?.round === b.round || state.memory.diplomacyRound !== b.round || incomingDiplomacy(b, this.side).length > 0 || playerLetters(b, this.side, state.memory.letterId).length > 0)
      && this.playerReady(b, state) && this.pausedRounds.get(b) !== b.round && !this.failed.has(this.key(b, settings));
  }
  /** Retry only the current read/validation; already selected actions and memory are never replayed. */
  private async retryRequest<T>(operation: (signal: AbortSignal) => Promise<T>, valid: () => boolean, signal: AbortSignal): Promise<T> {
    const check = () => { if (signal.aborted || !valid()) throw new CommandCancelled(); };
    const status = this.status;
    for (let attempt = 1; ; attempt++) {
      check();
      try {
        const result = await withAbort({ timeout: CONTEXT_TIMEOUT_MS, signals: [signal] }, operation);
        check();
        if (attempt > 1) { this.status = status; this.changed(); }
        return result;
      } catch (error) {
        check();
        if (attempt >= AUTO_TRIES) throw Error(`已自动尝试${AUTO_TRIES}次：${error instanceof Error ? error.message : '请求失败'}`);
        this.status = `模型请求失败，正在第${attempt + 1}/${AUTO_TRIES}次尝试…`; this.changed();
        await waitForJev(JEV_RETRY_DELAY_MS, signal);
      }
    }
  }
  private async ask(system: string, data: unknown, settings: LlmSettings, valid: () => boolean, signal: AbortSignal) {
    if (signal.aborted || !valid()) throw new CommandCancelled();
    const connection = llmConnection(settings);
    if (!connection.model) throw Error('请先选择模型');
    const original: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }];
    let previousAnswer: unknown, problem: string | undefined;
    return this.retryRequest(async combined => {
      try {
        previousAnswer = await openAiJsonRequest(connection, [...original, ...(problem ? [{ role: 'user' as const, content: JSON.stringify({ previousAnswer, retryErrors: [problem] }) }] : [])], combined, this.request, '指挥官');
        return commanderBrief(previousAnswer);
      } catch (error) { if (error instanceof JevAnswerError) previousAnswer = error.previousAnswer; problem = error instanceof Error ? error.message : '指挥官简报格式无效'; throw error; }
    }, valid, signal);
  }
  async prepare(b: Battle, narrative: unknown, task: unknown, settings: LlmSettings, valid: () => boolean): Promise<CommanderState | undefined> {
    return this.run(b, settings, valid, '正在生成指挥官…', async signal => ({ battleSeed: b.seed, side: this.side, brief: await this.ask(this.prompts.preparation,
      { perspective: { self: 'friendly', playerFaction: perspective('ally', this.side),
        controlledUnits: b.combatants.filter(u => u.side === this.side).map(u => ({ id: u.id, name: u.name })) },
        narrative, task, observation: commandObservation(b, undefined, this.side) }, settings, valid, signal), memory: updateCommandMemory(b, emptyCommandMemory(), this.side) }));
  }
  /** Query tools run locally; plain JSON that fails the final tool's check is retried like a failed request. */
  async decide<T>(b: Battle, actorId: string | undefined, state: CommanderState, mode: 'small' | 'mass' | 'intents', conversation: CommandMessage[], settings: LlmSettings,
    valid: () => boolean, signal: AbortSignal, budget: CommandBudget, final: { check: (args: Record<string, unknown>) => void; apply: (args: Record<string, unknown>) => { done?: T; result: unknown };
      encode?: (value: unknown) => unknown; decode?: (args: Record<string, unknown>) => Record<string, unknown> }): Promise<T | undefined> {
    const finalName = mode === 'small' ? 'commander_act' : mode === 'intents' ? 'commander_intents' : 'commander_orders', tools = commanderTools(this.prompts, mode);
    const encode = final.encode ?? ((value: unknown) => value), decode = final.decode ?? ((args: Record<string, unknown>) => args);
    const letter = playerLetters(b, this.side, state.memory.letterId).at(-1)?.id;
    const needsLetterReview = () => letter !== undefined && budget.letterReviewed !== letter;
    const reviewError = '请先用 commander_plan 的 addNotes 简短记录对新来信的判断、是否采纳及理由，再提交本次决定';
    while (budget.left-- > 0) {
      if (signal.aborted || !valid()) throw new CommandCancelled();
      const answer = await this.retryRequest(async combined => {
        let previousAnswer: CommandMessage | undefined;
        try {
          previousAnswer = await openAiCommandRequest(llmConnection(settings), conversation, tools, combined, this.request, commandRequestOptions(settings));
          if (!previousAnswer.tool_calls) {
            const args = decode(JSON.parse(previousAnswer.content!));
            if (['surrender', 'withdraw', 'accept', 'reject'].includes(String(args.mode))) commandDiplomacyDecision(b, this.side, args);
            else final.check(args);
          }
          return previousAnswer;
        } catch (error) {
          if (!signal.aborted && valid()) conversation.push({ role: 'user', content: JSON.stringify({ previousAnswer: previousAnswer ?? (error instanceof JevAnswerError ? error.previousAnswer : undefined),
            retryErrors: [error instanceof Error ? error.message : '指挥回复无效'] }) });
          throw error;
        }
      }, valid, signal);
      if (signal.aborted || !valid()) throw new CommandCancelled();
      conversation.push(answer);
      const diplomacy = (args: Record<string, unknown>) => {
        const action = commandDiplomacyDecision(b, this.side, args);
        state.decision = { ...action, round: b.round }; state.memory.diplomacyRound = b.round;
      };
      if (!answer.tool_calls) {
        const args = decode(JSON.parse(answer.content!));
        if (needsLetterReview()) { conversation.push({ role: 'user', content: JSON.stringify({ error: reviewError }) }); continue; }
        if (['surrender', 'withdraw', 'accept', 'reject'].includes(String(args.mode))) { diplomacy(args); return; }
        const outcome = final.apply(args);
        if (outcome.done !== undefined) return outcome.done;
        conversation.push({ role: 'user', content: JSON.stringify(encode(outcome.result)) });
        continue;
      }
      let done: T | undefined;
      const planResults = new Map<string, unknown>();
      // Notes are metadata, so keep them even when the same answer ends with diplomacy.
      for (const call of answer.tool_calls.filter(call => call.function.name === 'commander_plan')) {
        try {
          const args = decode(JSON.parse(call.function.arguments));
          const result = commanderTool('commander_plan', args, b, actorId, state);
          if (Array.isArray(args.addNotes) && args.addNotes.some(note => typeof note === 'string' && note.trim())) budget.letterReviewed = letter;
          planResults.set(call.id, result);
        } catch (error) { planResults.set(call.id, { error: error instanceof Error ? error.message : '记事格式无效' }); }
      }
      // A diplomatic decision is terminal; do not also apply combat calls from the same answer.
      const diplomaticCall = answer.tool_calls.find(call => call.function.name === 'diplomacy');
      if (diplomaticCall) {
        try { if (needsLetterReview()) throw Error(reviewError); diplomacy(JSON.parse(diplomaticCall.function.arguments)); return; }
        catch (error) { conversation.push(...answer.tool_calls.map(call => ({ role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(planResults.has(call.id) ? encode(planResults.get(call.id)) : { error: call === diplomaticCall ? String(error) : '本次先处理提议，未执行其他工具' }) }))); continue; }
      }
      for (const call of answer.tool_calls) {
        let result: unknown;
        try {
          const raw = JSON.parse(call.function.arguments);
          const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? decode(raw) : raw;
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数无效');
          if (planResults.has(call.id)) result = planResults.get(call.id);
          else if (call.function.name === finalName) {
            if (needsLetterReview()) throw Error(reviewError);
            if (done !== undefined) throw Error('每次只能提交一项行动');
            ({ done, result } = final.apply(args));
          } else if (['commander_map', 'commander_unit', 'commander_plan'].includes(call.function.name)) result = commanderTool(call.function.name, args, b, actorId, state);
          else throw Error('工具不存在');
        } catch (error) { result = { error: error instanceof Error ? error.message : '工具参数无效' }; }
        conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(encode(result)) });
      }
      if (done !== undefined) return done;
    }
    throw Error('本单位的工具调用次数已用尽');
  }
  private async choose(b: SmallBattle, actorId: string, state: CommanderState, choices: CommandChoice[], settings: LlmSettings, valid: () => boolean, signal: AbortSignal,
    budget: CommandBudget, conversation: CommandMessage[], sent: { map?: string }, stopped?: { step: CommandStep; reason: string }): Promise<{ choice: CommandChoice; then: CommandStep[] } | undefined> {
    this.status = `指挥官 ${state.brief.name} 正在指挥 ${b.byId(actorId).name}…`; this.changed();
    state.memory = updateCommandMemory(b, state.memory, this.side);
    const { map, ...observation } = commandObservation(b, actorId, this.side);
    const mapView = map && compactCommandMap(map.width, map.height, state.memory.terrain), mapKey = JSON.stringify(mapView);
    const first = !conversation.length;
    if (first) conversation.push({ role: 'system', content: this.prompts.command });
    // The map is resent only when exploration changed it during this activation.
    conversation.push({ role: 'user', content: JSON.stringify({ ...(first ? { brief: state.brief } : {}),
      plan: state.memory.plan, ...(mapKey !== sent.map ? { map: mapView } : {}), notes: state.memory.notes, ...(stopped ? { stopped } : {}), lastSightings: state.memory.contacts?.filter(u => !observation.units.some(current => current.id === u.id)),
      self: observation.units.find(u => u.id === actorId), observation: { ...observation, units: observation.units.map(unitSummary) },
      ...(first ? { letters: commandLetters(b, this.side, state.memory.letterId) } : {}), diplomacy: commandDiplomacy(b, this.side), ...choiceMessage(choices, this.side) }) });
    sent.map = mapKey;
    const act = (args: Record<string, unknown>) => ({ choice: commanderTool('commander_act', args, b, actorId, state, choices) as CommandChoice, then: commandSteps(args.then) });
    return this.decide(b, actorId, state, 'small', conversation, settings, valid, signal, budget,
      { check: act, apply: args => { const done = act(args); return { done, result: choiceView(done.choice, this.side) }; } });
  }
  async run<T>(b: Battle, settings: LlmSettings, valid: () => boolean, status: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.busy) throw Error('敌方指挥请求仍在进行');
    const aborter = new AbortController(); this.aborter = aborter; this.busy = true; this.status = status; this.statusBattle = b.seed; this.changed();
    try { const result = await task(aborter.signal); this.status = ''; return result; }
    catch (error) {
      if (aborter.signal.aborted && valid() && this.pausedRounds.get(b) === b.round) return undefined;
      if (aborter.signal.aborted || !valid() || error instanceof CommandCancelled) { this.status = 'LLM 指挥已暂停'; throw new CommandCancelled(); }
      this.failed.add(this.key(b, settings));
      this.status = `LLM 指挥失败，本场后续使用内置 AI：${error instanceof Error ? error.message : '请求失败'}`;
      return undefined;
    } finally { this.busy = false; if (this.aborter === aborter) this.aborter = undefined; this.changed(); }
  }
  async small(b: SmallBattle, state: CommanderState, settings: LlmSettings, valid: () => boolean): Promise<(BattleStepResult & { commandState: CommanderState }) | undefined> {
    if (state.side !== this.side || state.battleSeed !== b.seed || b.active?.side !== this.side) throw Error('指挥官不能控制其他阵营或其他战斗');
    return this.run(b, settings, valid, '正在请求敌方指令…', async signal => {
      const actorId = b.active!.id;
      const candidate = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()), { traitRegistry: b.traitRegistry, summonUnit: b.summonUnit });
      Object.assign(candidate, { rules: b.rules }); b.conditions.all().forEach(c => candidate.conditions.register(c));
      const commandState = structuredClone(state), budget = { left: 12 };
      const conversation: CommandMessage[] = [], sent: { map?: string } = {};
      let queue: CommandStep[] = [], basis: CommandWatch | undefined, stopped: { step: CommandStep; reason: string } | undefined;
      // One activation is atomic. A later invalid answer discards all of its partial moves and RNG changes.
      for (let i = 0; i < 8 && (budget.left > 0 || queue.length) && !candidate.isOver() && candidate.active?.id === actorId; i++) {
        const choices = smallCommandChoices(candidate, actorId);
        if (!choices.length) { candidate.autoAction(actorId); break; }
        let choice: CommandChoice | undefined;
        const step = queue.shift();
        if (step) {
          const reason = interruption(candidate, actorId, basis!);
          choice = reason ? undefined : stepChoice(choices, step);
          if (!choice) { stopped = { step, reason: reason ?? '不再合法' }; queue = []; }
        }
        if (!choice) {
          basis = watch(candidate, actorId);
          const decision = await this.choose(candidate, actorId, commandState, choices, settings, valid, signal, budget, conversation, sent, stopped);
          if (!decision) break;
          choice = decision.choice; queue = decision.then; stopped = undefined;
        }
        executeSmall(candidate, actorId, choice.action!);
        // The commander chose its own ability, so the conditions it adds are not a surprise.
        if (choice.action!.type === 'ability') basis!.conditions = new Set(candidate.byId(actorId).conditions.map(c => c.id));
      }
      if (conversation.length) commandState.memory.letterId = latestLetter(candidate, this.side);
      if (commandState.decision) return { snap: candidate.toSnapshot(), conditions: candidate.conditions.all(), commandState };
      if (!candidate.isOver() && candidate.active?.id === actorId) candidate.endTurn();
      commandState.memory = updateCommandMemory(candidate, commandState.memory, this.side);
      return { snap: candidate.toSnapshot(), conditions: candidate.conditions.all(), commandState };
    });
  }
  async mass(b: MassBattle, state: CommanderState, settings: LlmSettings, valid: () => boolean): Promise<{ orders: Order[]; commandState: CommanderState } | undefined> {
    if (state.side !== this.side || state.battleSeed !== b.seed || this.side === 'neutral') throw Error('此会战不支持该阵营或其他战斗的指挥官');
    return this.run(b, settings, valid, '正在请求敌方军令…', async signal => {
      const candidate = MassBattle.fromSnapshot(structuredClone(b.toSnapshot()), { traitRegistry: b.traitRegistry, summonUnit: b.summonUnit });
      Object.assign(candidate, { rules: b.rules }); b.conditions.all().forEach(c => candidate.conditions.register(c));
      const commandState = structuredClone(state), orders: Order[] = [], pending = new Map<string, CommandChoice[]>();
      const refresh = () => { for (const id of [...pending.keys()]) { const choices = massCommandChoices(candidate, id); if (choices.length) pending.set(id, choices); else pending.delete(id); } };
      candidate.readyUnits(this.side as 'ally' | 'enemy').filter(u => !candidate.isAttached(u.id) && !['charmed', 'confused'].includes(controlPolicy(u) ?? '')).forEach(u => pending.set(u.id, []));
      refresh();
      if (!pending.size) return { orders, commandState };
      this.status = `指挥官 ${commandState.brief.name} 正在下达军令…`; this.changed();
      commandState.memory = updateCommandMemory(candidate, commandState.memory, this.side);
      const observation = commandObservation(candidate, undefined, this.side);
      const formations = () => [...pending].map(([unitId, choices]) => ({ unitId, name: candidate.byId(unitId).name, choices: choices.map(c => choiceView(c, this.side)) }));
      const conversation: CommandMessage[] = [{ role: 'system', content: this.prompts.command }, { role: 'user', content: JSON.stringify({ brief: commandState.brief,
        plan: commandState.memory.plan, notes: commandState.memory.notes, lastSightings: commandState.memory.contacts?.filter(u => !observation.units.some(current => current.id === u.id)),
        letters: commandLetters(candidate, this.side, commandState.memory.letterId), diplomacy: commandDiplomacy(candidate, this.side), observation: { ...observation, units: observation.units.map(unitSummary) }, formations: formations() }) }];
      const check = (args: Record<string, unknown>) => {
        if (!Array.isArray(args.orders) || args.orders.some(o => !o || typeof o.unitId !== 'string' || typeof o.choice !== 'string')) throw Error('orders格式无效');
      };
      // Accepted orders stay placed; the rest are offered again with candidates refreshed against them.
      const apply = (args: Record<string, unknown>) => {
        check(args);
        const errors: { unitId: string; error: string }[] = [];
        for (const { unitId, choice: id } of args.orders as { unitId: string; choice: string }[]) {
          const choice = pending.get(unitId)?.find(c => c.id === id);
          const receipt = choice ? candidate.replaceOrders([choice.order!]) : { ok: false, reason: pending.has(unitId) ? '候选编号无效' : '不是待下令的编队' };
          if (!receipt.ok) { errors.push({ unitId, error: receipt.reason ?? '军令无效' }); continue; }
          orders.push(choice!.order!); pending.delete(unitId);
        }
        refresh();
        return pending.size ? { result: { errors, formations: formations() } } : { done: orders, result: { accepted: orders.map(o => o.unitId) } };
      };
      await this.decide(candidate, undefined, commandState, 'mass', conversation, settings, valid, signal, { left: 6 }, { check, apply });
      commandState.memory.letterId = latestLetter(candidate, this.side);
      return { orders: commandState.decision ? [] : orders, commandState };
    });
  }
}
