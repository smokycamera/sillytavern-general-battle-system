// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V23_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('非致命编队倒地后从界面切回致命并补刀，继续显示战场且能结算、重载', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const units = ['lead', 'down', 'foe'].map(id => {
    const u = generateUnit({ name: id, side: id === 'lead' ? 'ally' : 'enemy', scale: 'company', level: 5,
      rulesVersion: 'v2', weaponClass: 'sword', traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; u.morale = u.base.moraleMax = 100;
    u.base.atk = 100; u.weapon!.penetration = 30; u.weapon!.baseDice = u.weapon!.apDice = '100d6';
    return u;
  });
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, seed: 'company-lethality', rules: V23_OVERFLOW_D20 });
  b.start(); b.turnOrder = ['lead', 'down', 'foe']; b.turnIndex = 0;
  b.byId('lead').pos = 28; b.byId('down').pos = 21; b.byId('foe').pos = 0;
  b.setNonLethal(true); b.attack('lead', 'down', { bypassTurn: true });
  expect(b.byId('down').status).toBe('dying');
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)),
    rosterIds: units.map(u => u.id), protagonistId: 'lead', autoTurn: false, nonLethal: true,
    battle: { kind: 'small', snap: b.toSnapshot() } }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  vi.stubGlobal('fetch', vi.fn()); document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const snapshot = () => SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
  const click = async (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    expect(button, selector).not.toBeNull(); expect(button.disabled, selector).toBe(false);
    button.click(); await idle();
  };
  const toggle = document.querySelector<HTMLInputElement>('.battle-toolbar [data-role="non-lethal"]')!;
  expect(toggle.checked).toBe(true); toggle.click(); await idle();
  expect(snapshot().byId('down')).toMatchObject({ hp: 0, status: 'dying', recoverableWounded: b.byId('down').recoverableWounded });
  expect(snapshot().nonLethal).toBe(false);
  await click('[data-action="grid-mode"][data-mode="weapon"]');
  const target = document.querySelector<HTMLSelectElement>('[data-role="grid-target"]')!;
  target.value = 'down'; target.dispatchEvent(new Event('change', { bubbles: true })); await idle();
  await click('[data-action="grid-execute"]');
  expect(snapshot().byId('down')).toMatchObject({ hp: 0, status: 'dead', recoverableWounded: 0 });
  expect(document.querySelector('.battle-toolbar')).not.toBeNull();
  await click('[data-action="battle-finish"][data-reason="ceasefire"]');
  expect(f.service.snapshot().storage!.find(u => u.id === 'down')).toMatchObject({ hp: 0, status: 'dead', recoverableWounded: 0 });
  await f.service.load(); await idle();
  expect(snapshot().isOver()).toBe(true);
  expect(snapshot().byId('down')).toMatchObject({ hp: 0, status: 'dead', recoverableWounded: 0 });
  expect(document.querySelector('.battle-toolbar')).not.toBeNull();
  expect(document.querySelector('#toast')?.textContent).not.toContain('可救伤兵记录损坏');
  f.service.dispose();
}, 30000);
