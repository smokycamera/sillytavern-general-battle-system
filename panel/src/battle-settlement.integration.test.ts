// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V12_OVERFLOW_D20, battleXpAwardsForBothSides } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { battleEpilogue } from './battle-reports.js';
import { renderTacticalBattle } from './tactical-view.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('awards third-party casualties in both directions once and reports third-party victory as player defeat', () => {
  const units = (['ally', 'enemy', 'neutral', 'neutral'] as const).map((side, i) => {
    const u = generateUnit({ name: side + i, side, scale: 'hero', level: 3, rulesVersion: 'v2', weaponClass: 'sword', traits: [] }, { seed: side + i, noVariance: true }).unit;
    u.id = 't' + i; u.morale = u.base.moraleMax = 100; u.base.atk = 100;
    u.weapon!.baseDice = u.weapon!.apDice = '100d6'; u.weapon!.penetration = 100; return u;
  });
  const field = standardField(9, 15); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, nonLethal: true, rules: V12_OVERFLOW_D20, seed: 'third-party-xp' });
  b.start(); units.forEach((u, i) => { u.pos = [30, 38, 31, 39][i]!; });
  b.turnOrder = ['t0', 't1', 't2', 't3']; b.turnIndex = 0;
  b.attack('t0', 't2'); const allyXp = b.xpByUnit.get('t0')!;
  expect(allyXp).toBeGreaterThan(0);
  const restored = SmallBattle.fromSnapshot(b.toSnapshot());
  const recovered = restored.byId('t2'); recovered.hp = recovered.base.hpMax; recovered.status = 'ready';
  restored.turnIndex = 1; restored.endTurn(); restored.turnIndex = 3; restored.endTurn();
  restored.byId('t0').pos = 30; recovered.pos = 31;
  restored.turnOrder = ['t0', 't1', 't2', 't3']; restored.turnIndex = 0; restored.attack('t0', 't2');
  expect(restored.xpByUnit.get('t0')).toBe(allyXp);
  restored.turnIndex = 3; restored.byId('t3').pos = 39; restored.byId('t1').pos = 38; restored.byId('t0').pos = 100;
  restored.autoAction('t3');
  const neutralXp = restored.xpByUnit.get('t3')!; expect(neutralXp).toBeGreaterThan(0);
  restored.byId('t0').status = 'fled';
  const awards = battleXpAwardsForBothSides(restored.combatants, restored.xpByUnit, { winner: restored.winner(), sides: ['ally', 'enemy', 'neutral'], initialStrength: restored.xpInitialStrength });
  expect(awards.find(a => a.unitId === 't3')).toMatchObject({ side: 'neutral', kills: neutralXp });
  expect(battleEpilogue(restored)).toContain('第三方获胜，我方失败');
  expect(renderTacticalBattle(restored, { mode: 'inspect' })).toContain('第三方获胜，我方失败');
});

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
