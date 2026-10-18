// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, MassBattle, V15_OVERFLOW_TW } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('会战查看不重算已展示建议或写档，保存草案后复用预览，实际下令后刷新', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const units = ['u0', 'u1', 'foe'].map(id => {
    const u = generateUnit({ name: id, side: id === 'foe' ? 'enemy' : 'ally', scale: 'company', hpMax: 20,
      rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4, weaponClass: 'rifle', armorTier: 1, traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; u.tags = ['zone:中军', 'rank:front']; return u;
  });
  const b = new MassBattle({ combatants: units, rules: V15_OVERFLOW_TW, commanderId: 'u0', seed: 'formation-controls' }); b.start();
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id),
    protagonistId: 'u0', commanderId: 'u0', autoTurn: false, mode: 'mass', battle: { kind: 'mass', snap: b.toSnapshot() } }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  vi.stubGlobal('fetch', vi.fn()); document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const select = (id: string) => document.querySelector<HTMLButtonElement>(`[data-action="formation-select-actor"][data-id="${id}"]`)!.click();
  select('u1'); await idle();
  const recommendation = vi.spyOn(MassBattle.prototype, 'recommendedOrder'), write = vi.spyOn(f.journal, 'put');
  const before = JSON.stringify(f.service.snapshot());
  for (const id of ['u0', 'u1', 'u0', 'u1']) {
    select(id); expect(document.body.getAttribute('aria-busy')).not.toBe('true'); expect(document.querySelector('.formation-actor h3')!.textContent).toBe(id);
  }
  expect(recommendation).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(JSON.stringify(f.service.snapshot())).toBe(before);
  const type = document.querySelector<HTMLSelectElement>('[data-role="formation-order"]')!;
  type.value = 'hold'; type.dispatchEvent(new Event('change', { bubbles: true })); await idle();
  expect(f.service.snapshot().orderDraft).toMatchObject({ u1: { type: 'hold' } }); expect(recommendation).not.toHaveBeenCalled();
  select('u0'); select('u1'); expect(recommendation).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-action="formation-issue"]')!.click(); await idle();
  expect(MassBattle.fromSnapshot(f.service.snapshot().battle!.snap).orders.get('u1')?.type).toBe('hold');
  expect(write).not.toHaveBeenCalled();
  recommendation.mockClear(); select('u0'); expect(recommendation).toHaveBeenCalledWith('u0');
  f.service.dispose();
}, 30000);
