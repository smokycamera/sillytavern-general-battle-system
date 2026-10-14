// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, traitRegistry, V15_OVERFLOW_D20 } from '../../engine/src/index.js';
import { buildEncounter } from './game-encounter.js';
import { unitRecordFromCombatant } from './unit-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('收兵、濒死、撤离及移出参战名单后保留主控绑定，离场档案仍能在角色页查看', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const tab = (name: string) => document.querySelector<HTMLButtonElement>(`[data-action="workspace-tab"][data-tab="${name}"]`)!.click();
  for (const status of ['dying', 'fled', 'ready'] as const) {
    const units = ['bound-player', 'other-ally', 'foe'].map(id => {
      const u = generateUnit({ name: id, side: id === 'foe' ? 'enemy' : 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [] }, { seed: id }).unit;
      u.id = id; return u;
    });
    const field = standardField(); field.tiles.fill('open');
    const battle = new SmallBattle({ combatants: structuredClone(units), battlefield: field, rules: V15_OVERFLOW_D20, nonLethal: status === 'dying', seed: 'binding-' + status });
    battle.start(); battle.byId('bound-player').status = status;
    if (status === 'dying') battle.byId('bound-player').hp = 0;
    battle.finishBattle('ceasefire');
    await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), protagonistId: 'bound-player', autoTurn: false, autoSettleXp: false, battle: { kind: 'small', snap: battle.toSnapshot() } }));
    tab('battle'); await idle();
    document.querySelector<HTMLButtonElement>('[data-action="battle-close"]')!.click(); await idle();
    expect(f.service.snapshot().protagonistId).toBe('bound-player');
    expect(f.service.snapshot().storage?.find(r => r.id === 'bound-player')?.status).toBe(status);
    tab('units'); await idle();
    expect(document.querySelector('.role-overview')?.textContent).toContain('bound-player');
    if (status === 'ready') {
      const bound = [...document.querySelectorAll<HTMLButtonElement>('[data-action="roster-proto"]')].find(b => b.dataset.id === 'bound-player')!;
      bound.closest('.unit-tools')!.querySelector<HTMLButtonElement>('[data-action="roster-del"]')!.click(); await idle();
      expect(f.service.snapshot().rosterIds).not.toContain('bound-player');
      expect(f.service.snapshot().protagonistId).toBe('bound-player');
      expect(document.querySelector('.role-overview')?.textContent).toContain('bound-player');
    }
    await f.service.load(); await idle();
    expect(f.service.snapshot().protagonistId).toBe('bound-player');
  }
  // 主控不是指挥官也能手动下达军令，随队人物使用独立选择。
  const massUnits = ['commander', 'bound-player', 'other-hero', 'foe'].map(id => {
    const u = generateUnit({ name: id, side: id === 'foe' ? 'enemy' : 'ally', scale: id === 'bound-player' || id === 'other-hero' ? 'hero' : 'company', hpMax: 100, level: 3, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [] }, { seed: id }).unit;
    u.id = id; return u;
  });
  const mass = buildEncounter({ roster: massUnits, protagonistId: 'bound-player', commanderId: 'commander', setup: { mode: 'mass', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' }, registry: traitRegistry(), nonLethal: false, seed: 'independent-command', summonUnit: () => { throw Error('unused'); } });
  await f.service.transact(() => ({ schemaVersion: 2, storage: massUnits.map(u => unitRecordFromCombatant(u)), rosterIds: massUnits.map(u => u.id), protagonistId: 'bound-player', commanderId: 'commander', autoTurn: false, battle: { kind: 'mass', snap: mass.toSnapshot() } }));
  tab('battle'); await idle();
  expect(document.querySelector<HTMLButtonElement>('[data-action="formation-fill"]')?.disabled).toBe(false);
  expect(document.body.textContent).not.toContain('主控未担任指挥者');
  f.service.dispose();
}, 30000);
