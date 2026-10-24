// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, V25_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { prepareInventoryState } from './inventory-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('旧战斗在界面结算后更新负载，连续保存和收兵不写回旧投影', async () => {
  const f = nativeFixture();
  try {
    const units = (['ally', 'enemy'] as const).map(side => generateUnit({ name: side, side, scale: 'company', level: 4, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [], weaponClass: 'cannon', armorTier: 3 }, { seed: 'ui-load-' + side }).unit);
    const battle = new SmallBattle({ combatants: units, seed: 'ui-old-load', rules: V25_OVERFLOW_D20 }); battle.start();
    await f.store.load();
    await f.store.commit(0, () => prepareInventoryState({ schemaVersion: 2, factRevision: 1, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), battle: { kind: 'small', snap: battle.toSnapshot() }, autoTurn: false, autoSettleXp: true }));
    await f.service.start(); localStorage.clear();
    Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
    const request = vi.fn(() => Promise.reject(Error('unexpected model call'))); vi.stubGlobal('fetch', request);
    document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
    await import('./main.js');
    await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
    expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(6);
    document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="battle"]')!.click();
    await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
    document.querySelector<HTMLButtonElement>('[data-action="battle-finish"][data-reason="ceasefire"]')!.click();
    await vi.waitFor(() => {
      expect(document.body.getAttribute('aria-busy')).not.toBe('true');
    }, { timeout: 15000 });
    expect(f.service.snapshot().committedOutcomeIds, document.querySelector('#toast')?.textContent).toContain('small:ui-old-load');
    expect(f.service.status().phase).toBe('ready');
    expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(12);
    expect((f.service.snapshot().battle!.snap.combatants as typeof units)[0]!.weapon!.load).toBe(6);
    document.querySelector<HTMLButtonElement>('[data-action="battle-close"]')!.click();
    await vi.waitFor(() => { expect(document.body.getAttribute('aria-busy')).not.toBe('true'); expect(f.service.snapshot().battle).toBeNull(); });
    expect(f.service.snapshot().storage![0]!.snapshot!.weapon!.load).toBe(12);
    expect(request).not.toHaveBeenCalled();
  } finally { f.service.dispose(); }
}, 30000);
