// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { LLM_SETTINGS_KEY, COMMAND_THINKING_OFF_PARAMS } from './llm-settings.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('saves and resets generic parameters through the settings UI and lets local AI finish the round after cancelling both commanders', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const units = (['ally', 'enemy', 'neutral'] as const).map((side, i) => {
    const unit = generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4,
      weaponClass: 'sword', hpMax: 200, traits: [] }, { seed: side, noVariance: true }).unit;
    unit.id = 'u' + i; return unit;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'cancel-ui' });
  battle.start(); battle.turnOrder = ['u0', 'u1', 'u2']; battle.turnIndex = 0;
  units.forEach((u, i) => { u.pos = 35 + i * 2; });
  const brief = (side: 'enemy' | 'neutral') => ({ battleSeed: battle.seed, side, brief: { name: side, persona: '谨慎', known: [], mission: '守住' }, memory: { plan: '', notes: [], terrain: [] } });
  const base = encounterRequest({ roster: units, setup: { mode: 'small', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' }, settings: normalizeContextSettings(), messages: [], windowSize: 0, roles: [], phase: 'preparation' }).base;
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), protagonistId: 'u0', autoTurn: false,
    encounterContext: { ...base, llmCommanders: { enemy: brief('enemy'), neutral: brief('neutral') } }, battle: { kind: 'small', snap: battle.toSnapshot() } }));
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ enabled: true, commandEnemy: true, commandThinking: 'off', commandThinkingOffParams: '{}',
    url: 'https://fixture.invalid/v1', token: '', model: 'fixture', models: [] }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  const pending: { release: (r: Response) => void; data: any }[] = [], rounds: number[] = [];
  const answer = (data: any, late = false) => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [
    ...(late ? [{ id: 'plan', type: 'function', function: { name: 'commander_plan', arguments: '{"plan":"discard-late-plan"}' } }] : []),
    { id: 'act', type: 'function', function: { name: 'commander_intents', arguments: JSON.stringify({ intents: data.forces.map((u: any) => ({ unit: u.id, mode: 'hold', cell: u.pos })) }) } },
  ] } }] }));
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), data = JSON.parse(body.messages[1].content);
    expect(body.reasoning_effort).toBe('high'); rounds.push(data.round);
    if (data.round === 1) return new Promise<Response>(release => pending.push({ release, data }));
    return answer(data);
  }));
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="settings"]')!.click(); await idle();
  expect(document.querySelector('[data-role="llm-command-effort"]')).toBeNull();
  expect([...document.querySelectorAll('[data-role="llm-command-thinking"] option')].map(el=>el.getAttribute('value'))).toEqual(['auto','off']);
  let json = document.querySelector<HTMLTextAreaElement>('[data-role="llm-command-params"]')!;
  json.value = '{"enable_thinking":false,"vendor":{"effort":"high"}}'; json.dispatchEvent(new Event('input', { bubbles: true }));
  expect(json.validationMessage).toBe('');
  const beforeReset=JSON.parse(localStorage.getItem(LLM_SETTINGS_KEY)!);
  document.querySelector<HTMLButtonElement>('[data-action="llm-command-params-reset"]')!.click();await idle();
  json=document.querySelector<HTMLTextAreaElement>('[data-role="llm-command-params"]')!;
  expect(json.value).toBe(COMMAND_THINKING_OFF_PARAMS);
  expect(JSON.parse(localStorage.getItem(LLM_SETTINGS_KEY)!)).toEqual({...beforeReset,commandThinkingOffParams:COMMAND_THINKING_OFF_PARAMS});
  json.value = '{"reasoning_effort":'; json.dispatchEvent(new Event('input', { bubbles: true }));
  expect(json.validationMessage).toContain('JSON');
  expect(JSON.parse(localStorage.getItem(LLM_SETTINGS_KEY)!).commandThinkingOffParams).toBe(COMMAND_THINKING_OFF_PARAMS);
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="battle"]')!.click();await idle();
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="settings"]')!.click();await idle();
  json=document.querySelector<HTMLTextAreaElement>('[data-role="llm-command-params"]')!;
  expect(json.value).toBe('{"reasoning_effort":');expect(document.querySelector('[data-role="llm-command-params-status"]')!.textContent).toContain('草稿已保留');
  json.value = 'reasoning_effort="high"\nvendor_strength=7'; json.dispatchEvent(new Event('input', { bubbles: true }));
  expect(json.validationMessage).toBe('');
  expect(document.querySelector('[data-role="llm-command-params-status"]')!.textContent).toContain('已保存');
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="battle"]')!.click(); await idle();
  document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  document.querySelector<HTMLButtonElement>('[data-action="llm-command-stop"]')!.click();
  await idle();
  const saved = f.service.snapshot(), restored = SmallBattle.fromSnapshot(saved.battle!.snap);
  expect([restored.round, restored.active?.id]).toEqual([2, 'u0']);
  expect(rounds.filter(r => r === 1)).toHaveLength(2);
  pending.forEach(({ release, data }) => release(answer(data, true)));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.stringify(f.service.snapshot())).not.toContain('discard-late-plan');
  expect(document.body.textContent).not.toContain('自动行动未推进回合');
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="settings"]')!.click(); await idle();
  expect(document.querySelector<HTMLTextAreaElement>('[data-role="llm-command-params"]')!.value).toBe('reasoning_effort="high"\nvendor_strength=7');
  f.service.dispose();
}, 20000);
