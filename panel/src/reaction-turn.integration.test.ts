// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V4_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { saveLlmSettings } from './llm-settings.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

function reactionBattle(options: { nonLethal?: boolean; roundEnd?: boolean; healthy?: boolean; lastAlly?: boolean } = {}) {
  const units = (['victim', 'survivor', 'guard'] as const).filter(id => !options.lastAlly || id !== 'survivor').map(id => {
    const u = generateUnit({ name: id, side: id === 'guard' ? 'enemy' : 'ally', scale: 'hero', level: 4,
      rulesVersion: 'v2', weaponClass: id === 'guard' ? 'rifle' : 'sword', weaponLevel: 5, hpMax: 500, traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; u.morale = u.base.moraleMax = 100; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V4_OVERFLOW_D20, seed: 'reaction-turn', nonLethal: options.nonLethal });
  b.start(); b.turnOrder = ['guard', 'victim', ...(options.lastAlly ? [] : ['survivor'])]; b.turnIndex = 0;
  b.byId('victim').pos = 79; b.byId('guard').pos = 58; b.byId('guard').base.atk = 100;
  if (!options.lastAlly) b.byId('survivor').pos = 87;
  b.setOverwatch('guard'); b.endTurn();
  if (!options.healthy) b.byId('victim').hp = 1;
  if (options.roundEnd) {
    b.turnOrder = ['survivor', 'guard', 'victim']; b.turnIndex = 2;
    b.movementSpent.set('survivor', 2); b.actedThisTurn.add('survivor');
  }
  return b;
}

it('advances after lethal player movement, restores stalled saves, and preserves healthy turns and battle results', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 5000 });
  const snapshot = () => SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
  const click = async (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    expect(button, selector).not.toBeNull(); expect(button!.disabled, selector).toBe(false);
    button!.click(); await idle();
  };
  const load = async (b: SmallBattle, protagonistId?: string, autoTurn = false) => {
    await f.service.transact(() => ({ schemaVersion: 2, storage: b.combatants.map(u => unitRecordFromCombatant(u)),
      rosterIds: b.combatants.map(u => u.id), protagonistId, autoTurn, battle: { kind: 'small', snap: b.toSnapshot() } }));
    await idle();
  };
  const move = async () => {
    const actor = document.querySelector<HTMLSelectElement>('[data-role="grid-unit"]')!;
    actor.value = 'victim'; actor.dispatchEvent(new Event('change', { bubbles: true })); await idle();
    await click('[data-action="grid-mode"][data-mode="move"]');
    await click('[data-action="grid-cell"][data-cell="65"]');
    await click('[data-action="grid-move"]');
  };

  for (const scenario of [
    { protagonistId: 'victim', llm: true },
    { protagonistId: undefined, llm: true },
    { protagonistId: 'victim', llm: false, roundEnd: true },
    { protagonistId: 'victim', llm: true, nonLethal: true },
  ]) {
    saveLlmSettings({ enabled: scenario.llm, selectBattleScale: true, windowSize: 6, url: 'https://gateway.example/v1', token: '', model: 'fixture', models: ['fixture'] });
    const b = reactionBattle(scenario);
    if (scenario.llm) b.commanderProfiles = { enemy: { ability: 'expert', style: 'ambush' }, ally: { ability: 'master', style: 'aggressive' } };
    await load(b, scenario.protagonistId); await move();
    const after = snapshot();
    expect(after.byId('victim').status).toBe(scenario.nonLethal ? 'dying' : 'dead');
    expect(after.byId('victim').pos).toBe(72); // Stop at the first reaction, before the requested destination.
    expect(after.log.filter(l => l.text.startsWith('警戒反应'))).toHaveLength(1);
    expect(after.active?.id).toBe('survivor'); expect(after.isOver()).toBe(false);
    expect(after.round).toBe(scenario.roundEnd ? 2 : 1);
    expect(after.actedThisTurn.has('survivor')).toBe(false); expect(after.movementSpent.has('survivor')).toBe(false);
    expect(document.querySelector('.turn-indicator')?.textContent).toContain('survivor');
    expect(document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.disabled).toBe(false);
  }

  // Reload the exact stale pointer produced by the old version, including a dead protagonist with auto allies enabled.
  const stalled = reactionBattle(); stalled.moveTo('victim', 65);
  expect(stalled.active?.id).toBe('victim'); expect(stalled.active?.status).toBe('dead');
  await load(stalled, 'survivor', true);
  expect(snapshot().active?.id).toBe('survivor');
  expect(snapshot().log.filter(l => l.text.startsWith('警戒反应'))).toHaveLength(1);
  await load(stalled, 'victim');
  expect(snapshot().active?.id).toBe('survivor');

  // An ordinary surviving move retains this activation and its independent main action.
  await load(reactionBattle({ healthy: true }), 'victim'); await move();
  const healthy = snapshot();
  expect(healthy.active?.id).toBe('victim'); expect(healthy.active?.status).toBe('ready');
  expect(healthy.byId('victim').pos).toBe(65); expect(healthy.actedThisTurn.has('victim')).toBe(false);
  expect(healthy.movementSpent.get('victim')).toBe(2);

  // The last ally falling ends the battle once instead of starting another activation.
  await load(reactionBattle({ lastAlly: true }), 'victim'); await move();
  expect(snapshot().isOver()).toBe(true); expect(snapshot().winner()).toBe('enemy'); expect(snapshot().round).toBe(1);
  expect(snapshot().log.filter(l => l.kind === 'battle-end')).toHaveLength(1);
  expect(f.service.snapshot().xpSettled).toBe(true);

  // Manual scanning owns its save transaction. A concurrent panel save used to
  // suppress the source update or conflict with it while the scan was in flight.
  await load(reactionBattle({ healthy: true }), 'victim');
  await click('[data-action="workspace-tab"][data-tab="units"]');
  const battleBeforeScan = f.service.snapshot().battle;
  f.context.chat!.push({ mes: '<tb><spawn name="扫描到的新单位" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  const persistPanel = vi.spyOn(f.service, 'persistPanel');
  const put = f.journal.put.bind(f.journal);
  let releaseScan!: () => void;
  const blocked = new Promise<void>(resolve => { releaseScan = resolve; });
  const saveScan = vi.spyOn(f.journal, 'put').mockImplementationOnce(async (...args) => { await blocked; await put(...args); });
  document.querySelector<HTMLButtonElement>('[data-action="narrative-scan"]')!.click();
  await vi.waitFor(() => expect(saveScan).toHaveBeenCalled());
  expect(document.body.getAttribute('aria-busy')).toBe('true');
  expect(persistPanel).not.toHaveBeenCalled();
  releaseScan(); await idle();
  expect(f.service.snapshot().proposals).toHaveLength(1);
  expect(document.body.textContent).toContain('扫描到的新单位');
  expect(f.service.snapshot().battle).toEqual(battleBeforeScan);
  expect(f.service.status().phase).toBe('ready');
  saveScan.mockRestore(); persistPanel.mockRestore();
  expect(request).not.toHaveBeenCalled();
  f.service.dispose();
}, 30000);
