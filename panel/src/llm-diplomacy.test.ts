import { expect, it, vi } from 'vitest';
import { applyDiplomacy, generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20 } from '../../engine/src/index.js';
import { LlmCommandController, emptyCommandMemory, type CommanderState } from './llm-command.js';
import { LlmIntentPlanner } from './llm-intents.js';
import { COMMAND_PROMPTS } from './llm-command-prompts.js';
import { savedCommanderState } from './llm-save-context.js';
import { commandDiplomacy } from './llm-diplomacy.js';

const settings = { enabled: true, commandEnemy: true, selectBattleScale: false, windowSize: 6, model: 'fixture', url: 'https://fixture.invalid/v1', token: '', models: [] };
function fixture() {
  const combatants = (['ally', 'enemy', 'neutral'] as const).map((side, i) => {
    const u = generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', level: 4, hpMax: 200, weaponClass: 'sword', traits: [] }, { seed: side, noVariance: true }).unit;
    u.id = 'u' + i; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'diplomacy-model' }); b.start();
  combatants.forEach((u, i) => { u.pos = 35 + i * 2; }); b.turnOrder = ['u1', 'u2', 'u0']; b.turnIndex = 0;
  const state: CommanderState = { battleSeed: b.seed, side: 'enemy', brief: { name: '守备官', persona: '谨慎', known: [], mission: '保存兵力' }, memory: emptyCommandMemory() };
  return { b, state };
}
const response = (args: unknown) => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'decision', type: 'function', function: { name: 'diplomacy', arguments: JSON.stringify(args) } }] } }] }));
it('prefetches a terminal diplomatic decision without mutating the battle or sending duplicate requests, and saves the queued decision', async () => {
  const { b, state } = fixture(), before = structuredClone(b.toSnapshot());
  const request = vi.fn(async (_url: unknown, _init?: RequestInit) => response({ mode: 'surrender', target: 'opponent-1', text: '愿意放下武器。' }));
  const c = new LlmCommandController(COMMAND_PROMPTS, () => {}, request), p = new LlmIntentPlanner(c, COMMAND_PROMPTS);
  p.prefetch(b, state, settings, () => true); await p.beforeHero(); await p.forUnit(b, state, settings, () => true);
  expect(b.toSnapshot()).toEqual(before); expect(request).toHaveBeenCalledTimes(1);
  expect(savedCommanderState(state)!.decision).toEqual({ mode: 'surrender', target: 'ally', text: '愿意放下武器。', round: 1 });
  const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(body.tools.find((t: any) => t.function.name === 'diplomacy').function.description).toContain('text 可自行选择合适语句');
});
it('includes the exact rejection in the next round and excludes a third faction private negotiation', () => {
  const { b } = fixture(); applyDiplomacy(b, 'enemy', { mode: 'surrender', target: 'ally', text: '请接受。' });
  applyDiplomacy(b, 'ally', { mode: 'reject', id: 1, text: '先放下弓，“我方”不改写。' });
  b.round++;
  expect(commandDiplomacy(b, 'enemy').recent.at(-1)).toMatchObject({ mode: 'reject', text: '先放下弓，“我方”不改写。' });
  expect(commandDiplomacy(b, 'neutral').recent).toEqual([]);
});
it('invalidates a ready round plan when a new proposal arrives and lets the receiving AI answer before its action', async () => {
  const { b, state } = fixture();
  const request = vi.fn(async () => response({ mode: 'accept', id: 1, text: '同意撤军。' }));
  const c = new LlmCommandController(COMMAND_PROMPTS, () => {}, request), p = new LlmIntentPlanner(c, COMMAND_PROMPTS);
  state.memory.intents = { round: b.round, replanned: false, basis: { visible: [], friends: [] }, units: { u1: { mode: 'hold', cell: 37 } } };
  state.memory.diplomacyRevision = 0;
  applyDiplomacy(b, 'neutral', { mode: 'withdraw', target: 'enemy' });
  await p.forUnit(b, state, settings, () => true);
  expect(state.decision).toMatchObject({ mode: 'accept', id: 1 }); expect(request).toHaveBeenCalledTimes(1);
  expect(b.byId('u1').status).toBe('ready');
});
