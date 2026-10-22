// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { LLM_SETTINGS_KEY } from './llm-settings.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';
import type { LlmEncounterContext } from './llm-context.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('sends private and shared letters through the UI, logs exact text and replans only at each recipients next activation', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const units = (['ally', 'enemy', 'neutral'] as const).map((side, i) => {
    const u = generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4,
      weaponClass: 'sword', hpMax: 200, traits: ['steadfast'] }, { seed: side, noVariance: true }).unit;
    u.id = 'u' + i; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'letters-ui' }); battle.start();
  battle.turnOrder = ['u0', 'u1', 'u2']; battle.turnIndex = 0; units.forEach((u, i) => { u.pos = [78, 14, 20][i]!; });
  const brief = (side: 'enemy' | 'neutral') => ({ battleSeed: battle.seed, side, brief: { name: side, persona: '谨慎', known: [], mission: '固守' }, memory: { plan: '', notes: [], terrain: [] } });
  const base = encounterRequest({ roster: units, setup: { mode: 'small', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' }, settings: normalizeContextSettings(), messages: [], windowSize: 0, roles: [], phase: 'preparation' }).base;
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), protagonistId: 'u0', autoTurn: false,
    encounterContext: { ...base, llmCommanders: { enemy: brief('enemy'), neutral: brief('neutral') } }, battle: { kind: 'small', snap: battle.toSnapshot() } }));
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ enabled: true, commandEnemy: true, commandInterval: 'round', url: 'https://fixture.invalid/v1', token: '', model: 'fixture', models: [] }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  const requests: { data: any; body: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body), data = JSON.parse(JSON.parse(body).messages[1].content); requests.push({ data, body });
    const calls = [ ...(data.letters?.length ? [{ id: 'plan', type: 'function', function: { name: 'commander_plan', arguments: JSON.stringify({ plan: '已考虑来信：' + data.letters.at(-1).text, addNotes: ['部分采纳来信：' + data.letters.at(-1).text + '；保持警戒。'] }) } }] : []),
      { id: 'intents', type: 'function', function: { name: 'commander_intents', arguments: JSON.stringify({ intents: data.forces.map((u: any) => ({ unit: u.id, mode: 'hold', cell: u.pos })) }) } } ];
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: calls } }] }));
  }));
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>'; await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const next = async () => { document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click(); await idle(); };
  await next();
  await vi.waitFor(() => expect(new Set(requests.filter(r => r.data.round === 2).map(r => r.data.forces[0].id)).size).toBe(2));
  const send = async (target: string, text: string) => {
    const count = requests.length;
    document.querySelector<HTMLButtonElement>('[data-action="letter-open"]')!.click();
    const select = document.querySelector<HTMLSelectElement>('[data-role="letter-target"]')!;
    select.value = target; select.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.querySelector<HTMLTextAreaElement>('[data-role="letter-text"]')!;
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="letter-send"]')!.click(); await idle();
    expect(requests).toHaveLength(count);
    expect(document.querySelector('#letter-title')).toBeNull();
  };
  await send('enemy', '只给敌方：桥后已备好退路。');
  let saved = f.service.snapshot(), loaded = SmallBattle.fromSnapshot(saved.battle!.snap);
  expect(loaded.diplomacy.letters?.[0]?.targets).toEqual(['enemy']);
  expect(loaded.log.at(-1)?.text).toBe('我方对敌方消息：只给敌方：桥后已备好退路。');
  await next();
  expect(requests.filter(r => r.data.round === 2 && r.data.letters?.length)).toHaveLength(1);
  expect(requests.find(r => r.data.round === 2 && r.data.letters?.length)?.data.letters).toEqual([{ id: 1, round: 2, from: 'opponent-1', text: '只给敌方：桥后已备好退路。' }]);
  expect(requests.filter(r => r.data.forces[0].id === 'u2').every(r => !r.body.includes('只给敌方'))).toBe(true);
  expect(SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap).round).toBe(3);
  expect(requests.filter(r => r.data.round === 3 && r.data.forces[0].id === 'u1')).toHaveLength(0);
  await vi.waitFor(() => expect(requests.filter(r => r.data.round === 3 && r.data.forces[0].id === 'u2')).toHaveLength(1));
  await send('all', '双方都退一步。'); await next();
  const deliveries = requests.filter(r => r.data.round === 3 && r.data.letters?.length);
  expect(deliveries).toHaveLength(2);
  expect(deliveries.every(r => r.data.letters.length === 1 && r.data.letters[0].id === 2 && r.data.letters[0].from === 'opponent-1')).toBe(true);
  saved = f.service.snapshot();
  loaded=SmallBattle.fromSnapshot(saved.battle!.snap);
  expect(loaded.log.some(e => e.text === '我方对敌方、第三方消息：双方都退一步。')).toBe(true);
  const commands=(saved.encounterContext as unknown as LlmEncounterContext).llmCommanders;
  for (const side of ['enemy', 'neutral'] as const) {
    expect(commands?.[side]?.memory.letterId).toBe(2);
    expect(commands?.[side]?.memory.plan).toContain('双方都退一步。');
    expect(commands?.[side]?.memory.notes.some(note=>note.includes('部分采纳来信'))).toBe(true);
  }
  expect(loaded.diplomacy.letters).toHaveLength(2);
  document.querySelector<HTMLButtonElement>('[data-action="llm-notes"]')!.click();
  const notes=document.querySelector('[aria-labelledby="llm-notes-title"]')!.textContent!;
  expect(notes).toContain('opponent-1：双方都退一步。');expect(notes).toContain('已送达');expect(notes).toContain('部分采纳来信');
  f.service.dispose();
}, 20000);
