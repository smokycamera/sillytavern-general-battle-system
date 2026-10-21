// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { LLM_SETTINGS_KEY } from './llm-settings.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('pauses for player reply, resumes after rejection with exact words, and resolves accepted bilateral surrender/withdrawal without routing allies', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  let scenario = 'reject';
  const makeSave = (three = false) => {
    const units = (three ? ['ally', 'enemy', 'neutral'] as const : ['ally', 'enemy'] as const).map((side, i) => {
      const u = generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4,
        weaponClass: 'sword', hpMax: 200, traits: ['steadfast'] }, { seed: side, noVariance: true }).unit;
      u.id = 'u' + i; return u;
    });
    const field = standardField(7, 13); field.tiles.fill('open');
    const b = new SmallBattle({ combatants: units, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'ui-' + scenario }); b.start();
    b.turnOrder = units.map(u => u.id); b.turnIndex = 0; units.forEach((u, i) => { u.pos = [35, 39, 43][i]; });
    const command = (side: 'enemy' | 'neutral') => ({ battleSeed: b.seed, side, brief: { name: side, persona: '谨慎', known: [], mission: '保存兵力' }, memory: { plan: '', notes: [], terrain: [] } });
    const base = encounterRequest({ roster: units, setup: { mode: 'small', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' }, settings: normalizeContextSettings(), messages: [], windowSize: 0, roles: [], phase: 'preparation' }).base;
    return { schemaVersion: 2 as const, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), protagonistId: 'u0', autoTurn: false,
      encounterContext: { ...base, llmCommanders: { enemy: command('enemy'), ...(three ? { neutral: command('neutral') } : {}) } }, battle: { kind: 'small' as const, snap: b.toSnapshot() } };
  };
  await f.service.transact(() => makeSave());
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ enabled: true, commandEnemy: true, commandInterval: 'round', url: 'https://fixture.invalid/v1', token: '', model: 'fixture', models: [] }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  const bodies: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), data = JSON.parse(body.messages[1].content); bodies.push(data);
    const args = data.round === 1 && data.forces[0].id === 'u1'
      ? { mode: scenario.startsWith('withdraw') ? 'withdraw' : 'surrender', target: 'opponent-1', text: '愿与贵方结束这场战斗。' }
      : { intents: data.forces.map((u: any) => ({ unit: u.id, mode: 'hold', cell: u.pos })) };
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'action', type: 'function', function: {
      name: 'mode' in args ? 'diplomacy' : 'commander_intents', arguments: JSON.stringify(args),
    } }] } }] }));
  }));
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const openOffer = async () => {
    document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#diplomacy-title')).not.toBeNull(), { timeout: 10000 }); await idle();
  };
  const reply = async (mode: string, text: string) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-role="diplomacy-text"]')!;
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>(`[data-action="diplomacy-reply"][data-mode="${mode}"]`)!.click(); await idle();
  };
  await openOffer();
  expect(SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap).active?.id).toBe('u1');
  await reply('reject', '先退出桥头，“我方”原样保留。');
  let saved = f.service.snapshot(), b = SmallBattle.fromSnapshot(saved.battle!.snap);
  expect([b.isOver(), b.round, b.active?.id]).toEqual([false, 2, 'u0']);
  await vi.waitFor(() => expect(bodies.some(d => d.round === 2 && d.diplomacy.recent.some((e: any) => e.mode === 'reject' && e.text === '先退出桥头，“我方”原样保留。'))).toBe(true));
  expect(b.log.some(e => e.text.includes('我方拒绝了敌方的投降请求'))).toBe(true);
  for (const name of ['withdraw', 'surrender', 'withdraw3']) {
    scenario = name; await f.service.transact(() => makeSave(name === 'withdraw3')); await idle();
    await openOffer(); await reply('accept', '同意，照此办理。');
    saved = f.service.snapshot(); b = SmallBattle.fromSnapshot(saved.battle!.snap);
    if (name === 'withdraw3') {
      expect(b.isOver()).toBe(false); expect(b.byId('u0').status).toBe('ready');
      expect(b.byId('u0').moraleState?.forcedRetreat).toBeUndefined();
      expect(b.byId('u1').moraleState?.forcedRetreat).toBe('withdraw');
    } else { expect(b.isOver()).toBe(true); expect(b.winner()).toBe(name === 'withdraw' ? 'draw' : 'ally'); }
    expect(b.byId('u0').status).toBe('ready');
  }
  expect(document.body.textContent).not.toContain('自动行动未推进回合'); f.service.dispose();
}, 30000);
