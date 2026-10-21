import { SmallBattle, MassBattle, type Combatant, type Order, type Side } from '../../engine/src/index.js';
import { controlPolicy } from '../../engine/src/battle-control.js';
import { FORMATION_NODES, FORMATION_EDGES, formationNode } from '../../engine/src/mass/formation.js';
import { withAbort } from '../../host/src/browser-compat.js';
import { openAiJsonRequest, openAiCommandRequest, type CommandTool, type CommandMessage } from './jev-connection.js';
import { canSpot } from '../../engine/src/observation.js';
import { unitLineOfSight, TERRAIN_NAMES } from '../../engine/src/small/spatial.js';
import { groundHeightAt, unitHeight } from '../../engine/src/small/height-map.js';
import { obstructionHeight } from '../../engine/src/small/layers.js';
import { llmConnection, commandRequestOptions, type LlmSettings } from './llm-settings.js';
import { AUTO_TRIES, CONTEXT_TIMEOUT_MS } from './llm-context.js';
import { waitForJev, JEV_RETRY_DELAY_MS } from './jev-retry.js';
import { battleAbilities } from './battle-skills.js';
import { formationChoices } from './formation-orders.js';
import type { BattleStepResult } from './battle-step.js';
import type { GameAction } from './mcp-game.js';

export interface CommanderBrief { name: string; persona: string; known: string[]; mission: string }
export type CommanderToolName = 'commander_map' | 'commander_unit' | 'commander_brief' | 'commander_plan' | 'commander_actions' | 'commander_act';
export interface CommandPrompts { preparation: string; command: string; tools: Record<CommanderToolName, string> }
export interface KnownCommandCell { cell: number; terrain: string; height?: number; structure?: unknown; overlays?: unknown; connections?: unknown; cover?: unknown; round: number }
export interface CommandMemory { plan: string; notes: string[]; terrain: KnownCommandCell[]; contacts?: (ReturnType<typeof unitSummary> & { round: number })[] }
export const emptyCommandMemory = (): CommandMemory => ({ plan: '', notes: [], terrain: [] });
export interface CommanderState { battleSeed: string; side: Side; brief: CommanderBrief; memory: CommandMemory }
type Battle = SmallBattle | MassBattle;
export interface CommandChoice { id: string; label: string; action?: GameAction; order?: Order; cost?: number; risks?: string[] }
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
function unitSummary(u: ReturnType<typeof observedUnit> & { x?: number; y?: number; standingHeight?: number; losFromActor?: { canSee: boolean; geometric?: boolean } }) {
  return { id: u.id, name: u.name, side: u.side, pos: u.pos, x: u.x, y: u.y, formationPosition: u.formationPosition, level: u.level,
    scale: u.scale, quantityType: u.quantityType, hp: u.hp, hpMax: u.hpMax, status: u.status, airborne: u.airborne, elevation: u.elevation, standingHeight: u.standingHeight, losFromActor: u.losFromActor };
}
const nodeName = (id: string, side: Side) => id.replace(/^(ally|enemy|neutral):/, (_, faction: Side) => perspective(faction, side) + ':');
function choiceView(choice: CommandChoice, side: Side) {
  const order = choice.order;
  return { id: choice.id, label: choice.label, action: choice.action, cost: choice.cost, risks: choice.risks,
    order: order && { type: order.type, targetId: order.targetId && nodeName(order.targetId.replace(/^zone:/, ''), side), abilityId: order.abilityId, abilityActorId: order.abilityActorId } };
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
    events: b.visibleLog(side).slice(-12).map(e => ({ round: e.round, kind: e.kind,
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
  return { plan: text(memory.plan, 600), notes: (memory.notes ?? []).slice(0, 12).map(n => text(n, 300)), terrain: [...terrain.values()], contacts: [...contacts.values()].slice(-128) };
}

export function commanderTools(prompts: CommandPrompts): CommandTool[] {
  const schemas: Record<CommanderToolName, Record<string, unknown>> = {
    commander_map: { cells: { type: 'array', items: { type: 'integer', minimum: 0 } } },
    commander_unit: { unitId: { type: 'string' } }, commander_brief: {},
    commander_plan: { plan: { type: 'string', maxLength: 600 }, notes: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 } } },
    commander_actions: {}, commander_act: { choice: { type: 'string' } },
  };
  return (Object.keys(schemas) as CommanderToolName[]).map(name => ({ type: 'function', function: { name, description: prompts.tools[name],
    parameters: { type: 'object', properties: schemas[name], additionalProperties: false,
      required: name === 'commander_unit' ? ['unitId'] : name === 'commander_plan' ? ['plan', 'notes'] : name === 'commander_act' ? ['choice'] : [] } } }));
}

/** The tool router sees only the prefiltered observation; it cannot look up arbitrary live units. */
export function commanderTool(name: string, args: Record<string, unknown>, b: Battle, actorId: string, state: CommanderState, choices: CommandChoice[]): unknown {
  const observation = commandObservation(b, actorId, state.side), { map, ...situation } = observation;
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
    case 'commander_brief': return { brief: state.brief, plan: state.memory.plan, notes: state.memory.notes, situation: { ...situation, units: situation.units.map(unitSummary) } };
    case 'commander_plan':
      if (typeof args.plan !== 'string' || args.plan.length > 600 || !Array.isArray(args.notes) || args.notes.length > 12
        || args.notes.some(n => typeof n !== 'string' || n.length > 300)) throw Error('总计划或记事超出限制');
      state.memory.plan = args.plan; state.memory.notes = [...args.notes] as string[];
      return { plan: state.memory.plan, notes: state.memory.notes };
    case 'commander_actions': return { actorId, choices: choices.map(choice => choiceView(choice, state.side)) };
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

export class LlmCommandController {
  private aborter?: AbortController;
  private failed = new Set<string>();
  status = '';
  statusBattle?: string;
  busy = false;
  constructor(private prompts: CommandPrompts, private changed: () => void = () => {}, private request: typeof fetch = (url, init) => fetch(url, init), readonly side: Side = 'enemy') {}
  cancel(): void { this.aborter?.abort(); }
  private key(b: Battle, settings: LlmSettings): string { return JSON.stringify([b.seed, this.side, settings.url.trim(), settings.token.trim(), settings.model.trim(), settings.commandThinking, settings.commandThinkingOffParams]); }
  available(b: Battle, settings: LlmSettings, state?: CommanderState): boolean {
    return settings.enabled && settings.commandEnemy === true && state?.side === this.side && state.battleSeed === b.seed && b.rules.resolutionVersion === 'v2' && !this.failed.has(this.key(b, settings));
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
    return this.retryRequest(async combined => commanderBrief(await openAiJsonRequest(connection,
      [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }], combined, this.request, '指挥官')), valid, signal);
  }
  async prepare(b: Battle, narrative: unknown, task: unknown, settings: LlmSettings, valid: () => boolean): Promise<CommanderState | undefined> {
    return this.run(b, settings, valid, '正在生成指挥官…', async signal => ({ battleSeed: b.seed, side: this.side, brief: await this.ask(this.prompts.preparation,
      { perspective: { self: 'friendly', playerFaction: perspective('ally', this.side),
        controlledUnits: b.combatants.filter(u => u.side === this.side).map(u => ({ id: u.id, name: u.name })) },
        narrative, task, observation: commandObservation(b, undefined, this.side) }, settings, valid, signal), memory: updateCommandMemory(b, emptyCommandMemory(), this.side) }));
  }
  private async choose(b: Battle, actorId: string, state: CommanderState, choices: CommandChoice[], settings: LlmSettings, valid: () => boolean, signal: AbortSignal, budget: { left: number }, conversation: CommandMessage[]): Promise<CommandChoice> {
    this.status = `指挥官 ${state.brief.name} 正在指挥 ${b.byId(actorId).name}…`; this.changed();
    state.memory = updateCommandMemory(b, state.memory, this.side);
    const { map, ...observation } = commandObservation(b, actorId, this.side);
    const first = !conversation.length;
    if (first) conversation.push({ role: 'system', content: this.prompts.command });
    conversation.push({ role: 'user', content: JSON.stringify({ ...(first ? { brief: state.brief } : {}),
      plan: state.memory.plan, notes: state.memory.notes, lastSightings: state.memory.contacts?.filter(u => !observation.units.some(current => current.id === u.id)),
      observation: { ...observation, units: observation.units.map(unitSummary) }, map: map && { width: map.width, height: map.height }, choices: choices.map(choice => choiceView(choice, this.side)) }) });
    while (budget.left-- > 0) {
      if (signal.aborted || !valid()) throw new CommandCancelled();
      const answer = await this.retryRequest(async combined => {
        const answer = await openAiCommandRequest(llmConnection(settings), conversation, commanderTools(this.prompts), combined, this.request, commandRequestOptions(settings));
        if (!answer.tool_calls && !choices.some(c => c.id === JSON.parse(answer.content!).choice)) throw Error('模型返回了候选之外的指令');
        return answer;
      }, valid, signal);
      if (signal.aborted || !valid()) throw new CommandCancelled();
      if (!answer.tool_calls) {
        const choice = choices.find(c => c.id === JSON.parse(answer.content!).choice);
        if (!choice) throw Error('模型返回了候选之外的指令');
        conversation.push(answer);
        return choice;
      }
      conversation.push(answer);
      let selected: CommandChoice | undefined;
      for (const call of answer.tool_calls) {
        let result: unknown;
        try {
          const args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数无效');
          if (call.function.name === 'commander_act' && selected) throw Error('每次只能提交一项行动');
          result = commanderTool(call.function.name, args, b, actorId, state, choices);
          if (call.function.name === 'commander_act') { selected = result as CommandChoice; result = choiceView(selected, this.side); }
        } catch (error) { result = { error: error instanceof Error ? error.message : '工具参数无效' }; }
        conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      if (selected) return selected;
    }
    throw Error('本单位的工具调用次数已用尽');
  }
  private async run<T>(b: Battle, settings: LlmSettings, valid: () => boolean, status: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.busy) throw Error('敌方指挥请求仍在进行');
    const aborter = new AbortController(); this.aborter = aborter; this.busy = true; this.status = status; this.statusBattle = b.seed; this.changed();
    try { const result = await task(aborter.signal); this.status = ''; return result; }
    catch (error) {
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
      const conversation: CommandMessage[] = [];
      // One activation is atomic. A later invalid answer discards all of its partial moves and RNG changes.
      for (let i = 0; i < 8 && budget.left > 0 && !candidate.isOver() && candidate.active?.id === actorId; i++) {
        const choices = smallCommandChoices(candidate, actorId);
        if (!choices.length) { candidate.autoAction(actorId); break; }
        const choice = await this.choose(candidate, actorId, commandState, choices, settings, valid, signal, budget, conversation);
        executeSmall(candidate, actorId, choice.action!);
      }
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
      const commandState = structuredClone(state);
      const orders: Order[] = [];
      for (const unit of candidate.readyUnits(this.side as 'ally' | 'enemy').filter(u => !candidate.isAttached(u.id) && !['charmed', 'confused'].includes(controlPolicy(u) ?? ''))) {
        const choices = massCommandChoices(candidate, unit.id);
        if (!choices.length) continue;
        const choice = await this.choose(candidate, unit.id, commandState, choices, settings, valid, signal, { left: 6 }, []);
        const order = choice.order!;
        const receipt = candidate.replaceOrders([order]);
        if (!receipt.ok) throw Error(receipt.reason);
        orders.push(order);
      }
      return { orders, commandState };
    });
  }
}
