// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V12_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

function battle(seed: string): SmallBattle {
  const units = (['ally', 'enemy'] as const).map((side, i) => {
    const u = generateUnit({ name: side, side, scale: 'hero', level: 4, rulesVersion: 'v2',
      weaponClass: 'sword', hpMax: 100, traits: [] }, { seed: side, noVariance: true }).unit;
    u.id = 'u' + i; u.morale = u.base.moraleMax = 100; return u;
  });
  units[0]!.base.atk = 100;
  units[0]!.weapon!.baseDice = '100d6';
  units[0]!.weapon!.apDice = '100d6';
  units[0]!.weapon!.penetration = 100;
  units[1]!.hp = 1;
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V12_OVERFLOW_D20, seed });
  b.start(); b.turnOrder = ['u0', 'u1']; b.turnIndex = 0;
  units[0]!.pos = 18; units[1]!.pos = 19; return b;
}

it('finishes and settles with one click, immediately reflects the receipt and never awards twice', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  vi.stubGlobal('fetch', vi.fn()); document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  const load = async (b: SmallBattle, autoSettleXp: boolean) => {
    await f.service.transact(() => ({ schemaVersion: 2, storage: b.combatants.map(u => unitRecordFromCombatant(u)),
      rosterIds: b.combatants.map(u => u.id), protagonistId: 'u0', autoTurn: false, autoSettleXp,
      battle: { kind: 'small', snap: b.toSnapshot() } }));
    await idle();
  };
  const settled = () => {
    expect(f.store.snapshot().xpSettled, document.querySelector('#toast')?.textContent ?? '').toBe(true);
    expect(f.store.snapshot().committedOutcomeIds).toHaveLength(1);
    expect(f.store.snapshot().reports).toHaveLength(1);
    expect(button('xp-settle')).toBeNull();
    expect(document.querySelector('.battle-exit')!.textContent).toContain('战果已入账');
    expect(document.querySelector('[data-role="save-status"]')!.textContent).toBe('已保存');
  };
  const finished = battle('manual-settle'); finished.finishBattle('ceasefire');
  await load(finished, false);
  // The shared action wrapper may still be saving after the settlement receipt.
  // As soon as success is shown, the old settlement button must already be gone.
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const persistPanel = f.service.persistPanel.bind(f.service);
  const save = vi.spyOn(f.service, 'persistPanel')
    .mockImplementationOnce(persistPanel)
    .mockImplementationOnce(async (...args) => { await blocked; return persistPanel(...args); });
  button('xp-settle')!.click();
  await vi.waitFor(() => expect(document.querySelector('#toast')!.textContent).toContain('双方成长经验已入账'));
  try { settled(); } finally { release(); }
  await idle(); save.mockRestore(); settled();

  await load(battle('manual-victory'), false);
  button('grid-execute')!.click(); await idle();
  expect(SmallBattle.fromSnapshot(f.store.snapshot().battle!.snap).isOver()).toBe(true);
  expect(button('xp-settle')).not.toBeNull();
  button('xp-settle')!.click(); await idle(); settled();

  await load(battle('auto-settle'), true);
  button('grid-execute')!.click(); await idle(); settled();
  const xp = f.store.snapshot().storage!.map(u => u.xp);
  button('battle-close')!.click(); await idle();
  expect(f.store.snapshot().battle).toBeNull();
  expect(f.store.snapshot().storage!.map(u => u.xp)).toEqual(xp);
  expect(f.store.snapshot().reports).toHaveLength(1);
  f.service.dispose();
}, 30000);
