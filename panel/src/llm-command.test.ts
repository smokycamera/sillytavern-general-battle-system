import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCarriedItems, compileItem, createStructure, generateUnit, MassBattle, SmallBattle, standardField, V24_OVERFLOW_D20, V24_OVERFLOW_TW } from '../../engine/src/index.js';
import { COMMAND_PROMPTS } from './llm-command-prompts.js';
import { commanderTool, emptyCommandMemory, commandObservation, LlmCommandController, smallCommandChoices,
  updateCommandMemory, CommandCancelled, type CommanderState } from './llm-command.js';
import type { LlmSettings } from './llm-settings.js';
import { applyBattleStep, computeBattleStep } from './battle-step.js';
import { savedCommanderState, savedLlmContext } from './llm-save-context.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';

afterEach(() => vi.useRealTimers());

const settings: LlmSettings = { enabled: true, commandEnemy: true, selectBattleScale: false, designMap: false,
  windowSize: 6, model: 'fixture', url: 'https://example.invalid/v1', token: 'fixture-secret', models: [] };
const state = (battleSeed = 'command-small'): CommanderState => ({ battleSeed, side: 'enemy', brief: { name: '守备官', persona: '谨慎，重视协同', known: ['守住通道'], mission: '保持阵地' }, memory: emptyCommandMemory() });
function units() {
  return ['ally', 'enemy', 'enemy'].map((side, i) => {
    const u = generateUnit({ name: ['玩家', '左队', '右队'][i]!, side: side as 'ally' | 'enemy', scale: 'company', hpMax: 20,
      rulesVersion: 'v2', level: 4, weaponClass: 'rifle', weaponLevel: 4, armorTier: 1, traits: [] }, { seed: 'command:' + i, noVariance: true }).unit;
    u.id = 'u' + i; return u;
  });
}
function small() {
  const field = standardField(7, 13); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null);
  const b = new SmallBattle({ combatants: units(), battlefield: field, rules: V24_OVERFLOW_D20, seed: 'command-small' });
  b.start(); b.turnOrder = ['u1', 'u2', 'u0']; b.turnIndex = 0;
  b.combatants.forEach((u, i) => { u.pos = [78, 15, 16][i]; });
  return b;
}
const response = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }));
const call = (name: string, args: unknown) => response({ content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
function initial(init?: RequestInit) { return JSON.parse(JSON.parse(String(init?.body)).messages.filter((m: any) => m.role === 'user').at(-1).content); }

describe('commander observation and tools', () => {
  it('keeps notes and known facts while stripping provider transcripts and redundant preparation data on save/load', () => {
    const b = small(), current = state(); current.memory = updateCommandMemory(b, current.memory);
    current.memory.plan = '保持协同'; current.memory.notes = ['上轮看见对手'];
    const dirty: any = structuredClone(current);
    dirty.messages = ['raw-provider-chat']; dirty.reasoning_content = 'raw-provider-thoughts';
    dirty.memory.toolCalls = ['raw-provider-tools']; dirty.brief.rawResponse = 'raw-provider-response';
    dirty.memory.terrain[0].request = 'raw-provider-map'; dirty.memory.terrain[0].structure = { kind: 'cover', hp: 10, raw: 'raw-provider-nested' };
    const restored = savedCommanderState(dirty)!;
    expect(restored.memory.plan).toBe('保持协同'); expect(restored.memory.notes).toEqual(['上轮看见对手']);
    expect(JSON.stringify(restored)).not.toContain('raw-provider');
    expect(savedCommanderState(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
    const base = encounterRequest({ roster: b.combatants, setup: { mode: 'small', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' },
      settings: normalizeContextSettings(), messages: [], windowSize: 0, roles: [], phase: 'preparation' }).base;
    const context: any = { ...base, llmCommanders: { enemy: dirty }, model: 'provider-model', messages: ['raw-provider-context'],
      battlefieldPlan: { raw: 'raw-provider-layout' }, mapDesign: { raw: 'raw-provider-design' }, unitBindings: { source: 'raw-provider-bindings' } };
    const compact = savedLlmContext(context, true)!;
    expect(compact.llmCommanders!.enemy!.memory.plan).toBe('保持协同');
    expect(compact).not.toHaveProperty('battlefieldPlan'); expect(compact).not.toHaveProperty('model');
    expect(JSON.stringify(compact)).not.toContain('raw-provider');
    expect(savedLlmContext(context, false)).toBeUndefined();
  });
  it('redacts hidden units, unseen terrain, opponent resources, private logs and live fields in last sightings', () => {
    const b = small(), own = b.byId('u1'), foe = b.byId('u0');
    vi.spyOn(b, 'visibleCombatants').mockReturnValue([own, foe]);
    vi.spyOn(b, 'visibleCells').mockReturnValue(b.battlefield!.tiles.map((_, cell) => cell === 15 || cell === 78));
    vi.spyOn(b, 'enemyIntel').mockReturnValue({ traces: [{ id: 'lost', name: '旧目击', round: 0, cell: 4,
      seen: { ...foe, name: 'unseen-current-state' } }], clues: [] });
    b.byId('u2').name = 'hidden-name'; b.byId('u2').resources['hidden-resource'] = 1;
    foe.resources['opponent-private'] = 1;
    b.log.push({ round: b.round, kind: 'rule', text: 'player-secret-command', observedBy: ['ally'] });
    const observed = commandObservation(b, own.id), json = JSON.stringify(observed);
    expect(json).not.toMatch(/hidden-name|hidden-resource|opponent-private|player-secret-command|unseen-current-state|fixture-secret/);
    expect(observed.units.find(u => u.id === foe.id)).toMatchObject({ name: foe.name, hp: foe.hp, hpMax: foe.base.hpMax, level: foe.level, pos: foe.pos });
    expect(observed.units.find(u => u.id === foe.id)).not.toHaveProperty('resources');
    expect(observed.units.find(u => u.id === own.id)).toHaveProperty('hp', own.hp);
    expect(observed.units.find(u => u.id === own.id)?.side).toBe('friendly');
    expect(observed.map!.cells.map(c => c.cell)).toEqual([15, 78]);
    const s = state(); s.memory = updateCommandMemory(b, s.memory);
    expect(commanderTool('commander_unit', { unitId: 'u2' }, b, own.id, s, [])).toEqual({ unknown: true });
    expect(commanderTool('commander_unit', { unitId: 'lost' }, b, own.id, s, [])).toMatchObject({ cell: 4, round: 0 });
    expect(commanderTool('commander_map', { cells: [0] }, b, own.id, s, [])).toMatchObject({ cells: [] });
  });

  it('keeps last observed terrain without refreshing it through fog and enforces the 600 character plan', () => {
    const b = small(); let seen = 15;
    vi.spyOn(b, 'visibleCells').mockImplementation(() => b.battlefield!.tiles.map((_, i) => i === seen));
    const s = state(); s.memory = updateCommandMemory(b, s.memory);
    seen = 16; b.battlefield!.tiles[15] = 'forest'; b.round++;
    s.memory = updateCommandMemory(b, s.memory);
    const map = commanderTool('commander_map', { cells: [15] }, b, 'u1', s, []) as { cells: unknown[] };
    expect(map.cells).toEqual([expect.objectContaining({ cell: 15, terrain: 'open', round: b.round - 1, visible: false, x: 1, y: 2 })]);
    commanderTool('commander_plan', { plan: '计'.repeat(600), notes: ['推测：对手可能在南侧'] }, b, 'u1', s, []);
    expect(s.memory.plan).toHaveLength(600);
    expect(() => commanderTool('commander_plan', { plan: '计'.repeat(601), notes: [] }, b, 'u1', s, [])).toThrow('超出限制');
    expect(s.memory.plan).toHaveLength(600);
    expect(() => commanderTool('commander_act', { choice: 'invented', actorId: 'u0' }, b, 'u1', s, smallCommandChoices(b, 'u1'))).toThrow('候选编号无效');
    expect(COMMAND_PROMPTS.preparation + COMMAND_PROMPTS.command + Object.values(COMMAND_PROMPTS.tools).join('')).not.toContain('敌方');
  });

  it('isolates three faction memories and supports the ally perspective without granting cross-faction control', async () => {
    const b = small(); b.byId('u2').side = 'neutral'; b.turnOrder = ['u1', 'u2', 'u0'];
    b.combatants.forEach((u, i) => { u.pos = 22 + i; });
    const enemy = state(), third = { ...state(), side: 'neutral' as const }, ally = { ...state(), side: 'ally' as const };
    enemy.memory.plan = 'only-enemy-plan'; third.memory.plan = 'only-third-plan'; ally.memory.plan = 'only-ally-plan';
    let expectedSide: 'enemy' | 'neutral' = 'enemy';
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)), data = initial(init);
      expect(data.plan).toBe(expectedSide === 'enemy' ? enemy.memory.plan : third.memory.plan);
      expect(JSON.stringify(payload)).not.toContain(expectedSide === 'enemy' ? 'only-third-plan' : 'only-enemy-plan');
      expect(JSON.stringify(payload)).not.toContain('only-ally-plan');
      expect(data.observation.units.find((u: any) => u.id === data.observation.actorId).side).toBe('friendly');
      return call('commander_act', { choice: data.choices.find((c: any) => c.action?.type === 'end_turn').id });
    }) as unknown as typeof fetch;
    const enemyController = new LlmCommandController(COMMAND_PROMPTS, () => {}, request, 'enemy');
    const thirdController = new LlmCommandController(COMMAND_PROMPTS, () => {}, request, 'neutral');
    await expect(thirdController.small(b, enemy, settings, () => true)).rejects.toThrow('其他阵营');
    const first = await enemyController.small(b, enemy, settings, () => true); applyBattleStep(b, first!);
    expectedSide = 'neutral';
    const second = await thirdController.small(b, third, settings, () => true); expect(second!.commandState.side).toBe('neutral');
    const allyView = commandObservation(b, undefined, 'ally');
    expect(allyView.units.find(u => u.id === 'u0')?.side).toBe('friendly');
    expect(new Set(allyView.units.filter(u => u.side !== 'friendly').map(u => u.side)).size).toBe(2);
  });
});

describe('atomic LLM command execution', () => {
  it('executes items, opens and closes gates, climbs both ways, and reports terrain height, cover and observer LOS', async () => {
    const generated = generateUnit({ name: '守备官', side: 'enemy', scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2',
      level: 3, hpMax: 100, hp: 10, weaponClass: 'sword', traits: [] }, { seed: 'interactions', noVariance: true }).unit;
    generated.id = 'u1';
    const mechanics = compileItem({ kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, { id: 'dose', seed: 'dose' });
    if (mechanics.kind !== 'item') throw Error('fixture');
    const actor = attachCarriedItems(generated, [{ id: 'dose', name: '急救剂', quantity: 2, revision: 1, mechanics }]);
    const others = units().filter(u => u.id !== 'u1');
    const field = standardField(7, 13); field.tiles.fill('open'); field.layerVersion = 1;
    field.structures = field.tiles.map(() => null); field.spatialRulesVersion = 2; field.groundHeight = field.tiles.map(() => 0);
    field.structures[14] = createStructure('tower', 2, { owner: 'enemy', top: true, access: [15], platformHeight: 2 });
    field.structures[16] = createStructure('gate', 2, { owner: 'enemy' });
    field.structures[8] = createStructure('cover', 2); field.structures[43] = createStructure('wall', 2);
    field.groundHeight[22] = 2; field.heightTransitions = [{ from: 15, to: 22, kind: 'stairs' }];
    const b = new SmallBattle({ combatants: [actor, ...others], battlefield: field, rules: V24_OVERFLOW_D20, seed: 'command-small' }); b.start();
    b.turnOrder = ['u1', 'u0']; b.turnIndex = 0; b.byId('u1').pos = 15; b.byId('u0').pos = 71; b.byId('u2').pos = 72;
    let s = state(); s.memory = updateCommandMemory(b, s.memory);
    const map = commanderTool('commander_map', {}, b, 'u1', s, []) as { cells: any[] };
    expect(map.cells.find(c => c.cell === 22)).toMatchObject({ height: 2, connections: [{ from: 15, to: 22, kind: 'stairs' }] });
    expect(map.cells.find(c => c.cell === 8)?.cover.structure).toBe('cover');
    const target = commanderTool('commander_unit', { unitId: 'u0' }, b, 'u1', s, []) as any;
    expect(target.visible).toBe(true); expect(target.losFromActor.geometric).toBe(false);
    const item = b.byId('u1').abilities.find(a => a.itemSourceId)!;
    let wanted: { type: string; cell?: number; abilityId?: string };
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const data = initial(init);
      const choice = data.choices.find((c: any) => c.action?.type === wanted.type && (wanted.cell === undefined || c.action.cell === wanted.cell)
        && (!wanted.abilityId || c.action.abilityId === wanted.abilityId)) ?? data.choices.find((c: any) => c.action?.type === 'end_turn');
      return call('commander_act', { choice: choice.id });
    }) as unknown as typeof fetch;
    const commander = new LlmCommandController(COMMAND_PROMPTS, () => {}, request);
    const activate = async (action: typeof wanted) => {
      while (b.active?.id !== 'u1') b.endTurn();
      wanted = action;
      // Select the requested interaction once, then end this activation.
      const original = request as any, prior = original.mock.calls.length;
      original.mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        const data = initial(init), choice = data.choices.find((c: any) => c.action?.type === wanted.type
          && (wanted.cell === undefined || c.action.cell === wanted.cell) && (!wanted.abilityId || c.action.abilityId === wanted.abilityId));
        expect(choice, JSON.stringify(wanted)).toBeDefined();
        wanted = { type: 'end_turn' }; return call('commander_act', { choice: choice.id });
      });
      const result = await commander.small(b, s, settings, () => true);
      expect(result, commander.status).toBeDefined(); applyBattleStep(b, result!); s = result!.commandState;
      expect(original.mock.calls.length).toBeGreaterThan(prior);
    };
    await activate({ type: 'ability', abilityId: item.id });
    expect(b.byId('u1').hp).toBeGreaterThan(10); expect(b.byId('u1').resources['item:dose']).toBe(1);
    await activate({ type: 'gate', cell: 16 }); expect(b.battlefield!.structures![16]!.gateState).toBe('open');
    await activate({ type: 'climb', cell: 14 }); expect(b.byId('u1')).toMatchObject({ pos: 14, elevation: 1 });
    await activate({ type: 'climb', cell: 15 }); expect(b.byId('u1').pos).toBe(15); expect(b.byId('u1').elevation).toBeUndefined();
    await activate({ type: 'gate', cell: 16 }); expect(b.battlefield!.structures![16]!.gateState).toBe('closed');
  });

  it('runs native tools, shares the revised plan with the next unit, and restores it from saved JSON', async () => {
    const b = small(), original = structuredClone(b.toSnapshot()), s = state(); let calls = 0;
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const data = initial(init), payload = JSON.parse(String(init?.body));
      expect(JSON.stringify(payload)).not.toContain('fixture-secret');
      expect(payload.tools.map((t: any) => t.function.name)).toContain('commander_act');
      calls++;
      if (calls === 1) return call('commander_plan', { plan: '左队固守，右队掩护。', notes: ['双方尚未接触'] });
      if (calls === 2) return call('commander_map', { cells: [15, 16] });
      if (calls === 3) return call('commander_unit', { unitId: 'u1' });
      return call('commander_act', { choice: data.choices.find((c: any) => c.action?.type === 'end_turn').id });
    }) as unknown as typeof fetch;
    const commander = new LlmCommandController(COMMAND_PROMPTS, () => {}, request);
    const result = await commander.small(b, s, settings, () => true);
    expect(result).toBeDefined(); expect(b.toSnapshot()).toEqual(original); expect(s.memory.plan).toBe('');
    expect(result!.commandState.memory.plan).toBe('左队固守，右队掩护。');
    applyBattleStep(b, result!); expect(b.active?.id).toBe('u2');
    const restored: CommanderState = JSON.parse(JSON.stringify(result!.commandState));
    const second = await new LlmCommandController(COMMAND_PROMPTS, () => {}, request).small(b, restored, settings, () => true);
    expect(second!.commandState.memory.plan).toBe(restored.memory.plan);
    expect(initial((request as any).mock.calls.at(-1)[1]).plan).toBe(restored.memory.plan);
  });

  it('retries preparation and the current command without replaying prior actions or losing the plan', async () => {
    vi.useFakeTimers();
    const b = small(), s = state(), before = structuredClone(b.toSnapshot());
    let preparations = 0, commands = 0; const payloads: string[] = [];
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (!payload.tools) {
        preparations++;
        if (preparations === 1) return new Response('{}', { status: 503 });
        return response({ content: JSON.stringify(preparations === 2 ? { name: '缺少人设' } : s.brief) });
      }
      commands++; payloads.push(String(init?.body));
      if (commands === 1) return call('commander_plan', { plan: '先移动再观察', notes: [] });
      const data = initial(init);
      if (commands === 2) return call('commander_act', { choice: data.choices.find((c: any) => c.action?.type === 'move').id });
      if (commands === 3) return new Response('{}', { status: 503 });
      return call('commander_act', { choice: data.choices.find((c: any) => c.action?.type === 'end_turn').id });
    }) as unknown as typeof fetch;
    const commander = new LlmCommandController(COMMAND_PROMPTS, () => {}, request);
    const preparation = commander.prepare(b, [], {}, settings, () => true);
    await vi.runAllTimersAsync(); expect((await preparation)?.brief).toEqual(s.brief); expect(preparations).toBe(3);
    const pending = commander.small(b, s, settings, () => true);
    await vi.runAllTimersAsync(); const result = await pending;
    expect(result).toBeDefined(); expect(commands).toBe(4); expect(payloads[2]).toBe(payloads[3]);
    expect(result!.commandState.memory.plan).toBe('先移动再观察'); expect(b.toSnapshot()).toEqual(before);
    applyBattleStep(b, result!); expect(b.active?.id).toBe('u2'); expect(commander.available(b, settings, result!.commandState)).toBe(true);
  });

  it('cancels retry waiting immediately without another request or local fallback', async () => {
    vi.useFakeTimers(); const b = small(), before = structuredClone(b.toSnapshot());
    const request = vi.fn(async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const commander = new LlmCommandController(COMMAND_PROMPTS, () => {}, request);
    const pending = commander.small(b, state(), settings, () => true).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); commander.cancel();
    expect(await pending).toBeInstanceOf(CommandCancelled); await vi.runAllTimersAsync();
    expect(request).toHaveBeenCalledTimes(1); expect(b.toSnapshot()).toEqual(before); expect(commander.available(b, settings, state())).toBe(true);
  });

  it('discards a partial activation only after malformed output exhausts retries and switches this battle to local AI', async () => {
    vi.useFakeTimers();
    const b = small(), before = structuredClone(b.toSnapshot()), s = state(); let calls = 0;
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const data = initial(init); calls++;
      if (calls === 1) return call('commander_plan', { plan: '先移动', notes: [] });
      if (calls === 2) return response({ content: JSON.stringify({ choice: data.choices.find((c: any) => c.action?.type === 'move').id }) });
      return response({ content: JSON.stringify({ choice: 'invalid' }) });
    }) as unknown as typeof fetch;
    const commander = new LlmCommandController(COMMAND_PROMPTS, () => {}, request);
    const pending = commander.small(b, s, settings, () => true); await vi.runAllTimersAsync();
    expect(await pending).toBeUndefined(); expect(calls).toBe(5);
    expect(b.toSnapshot()).toEqual(before); expect(s.memory.plan).toBe('');
    expect(commander.available(b, settings, s)).toBe(false); expect(commander.status).toContain('内置 AI');
  });

  it('ignores a late response after cancellation without changing the battle or plan', async () => {
    const b = small(), before = structuredClone(b.toSnapshot()); let release!: (value: Response) => void;
    const request = vi.fn(() => new Promise<Response>(resolve => { release = resolve; })) as unknown as typeof fetch;
    const commander = new LlmCommandController(COMMAND_PROMPTS, () => {}, request);
    const pending = commander.small(b, state(), settings, () => true);
    const rejected = expect(pending).rejects.toBeInstanceOf(CommandCancelled);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    commander.cancel(); release(response({ content: '{"choice":"c0"}' }));
    await rejected;
    expect(b.toSnapshot()).toEqual(before); expect(commander.busy).toBe(false);
  });

  it('plans mass units separately, hides player orders, and preserves external orders through master AI and worker replay', async () => {
    const b = new MassBattle({ combatants: units(), rules: V24_OVERFLOW_TW, seed: 'command-mass' }); b.start();
    b.commanderProfiles.enemy = { ability: 'master', style: 'aggressive', scoring: 'tactical-v2' };
    b.orders.set('u0', { unitId: 'u0', type: 'hold', targetId: 'player-private-order' });
    const before = structuredClone(b.toSnapshot());
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const data = initial(init);
      expect(JSON.stringify(data)).not.toContain('player-private-order');
      return call('commander_act', { choice: data.choices.find((c: any) => c.order?.type === 'hold').id });
    }) as unknown as typeof fetch;
    const result = await new LlmCommandController(COMMAND_PROMPTS, () => {}, request).mass(b, state(b.seed), settings, () => true);
    expect(b.toSnapshot()).toEqual(before); expect(result!.orders.map(o => o.unitId)).toEqual(['u1', 'u2']);
    expect(b.replaceOrders(result!.orders).ok).toBe(true); b.autoOrders('enemy');
    expect(b.orders.get('u1')).toMatchObject({ type: 'hold', externalCommand: true });
    const computed = computeBattleStep({ kind: 'mass', snap: before, rules: b.rules, traits: b.traitRegistry,
      conditions: b.conditions.all(), summons: false, expectedRound: b.round, drafts: {}, enemyOrders: result!.orders });
    expect(computed.snap.round).toBe(b.round + 1);
  });
});
