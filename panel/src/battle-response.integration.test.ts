// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V16_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { computeBattleStep, type BattleStepRequest, type BattleStepResult } from './battle-step.js';

const background = vi.hoisted(() => ({ hold: false, request: undefined as BattleStepRequest | undefined,
  release: undefined as ((result: BattleStepResult) => void) | undefined }));
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
vi.mock('./battle-worker.js', () => ({ BattleWorker: class {
  run(request: BattleStepRequest) {
    if (!background.hold) return Promise.resolve(undefined);
    background.request = structuredClone(request);
    return new Promise<BattleStepResult>(resolve => { background.release = resolve; });
  }
  dispose() {}
} }));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });
function battle(seed: string) {
  const units = ['ally', 'enemy'].map((side, i) => {
    const unit = generateUnit({ name: side, side: side as 'ally' | 'enemy', scale: 'hero', hpMax: 500, rulesVersion: 'v2',
      level: 4, weaponClass: 'sword', weaponLevel: 4, traits: [] }, { seed: side, noVariance: true }).unit;
    unit.id = 'u' + i; unit.base.atk = 30; unit.morale = unit.base.moraleMax = 100; return unit;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V16_OVERFLOW_D20, seed }); b.start();
  b.turnOrder = ['u0', 'u1']; b.turnIndex = 0; units[0]!.pos = 18; units[1]!.pos = 19; return b;
}
it('keeps battle actions in memory, saves the final result, restores failed final writes and discards old background replies', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  vi.stubGlobal('fetch', vi.fn()); document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const save = (b: SmallBattle) => ({ schemaVersion: 2, storage: b.combatants.map(u => unitRecordFromCombatant(u)), rosterIds: b.combatants.map(u => u.id),
    protagonistId: 'u0', autoTurn: false, autoSettleXp: false, battle: { kind: 'small' as const, snap: b.toSnapshot() } });
  const load = async (b: SmallBattle) => { await f.service.transact(() => save(b)); await idle(); };
  await load(battle('early-result'));
  const before = f.store.snapshot().battle, noWrite = vi.spyOn(f.journal, 'put'), noRead = vi.spyOn(f.host, 'readPersisted');
  document.querySelector<HTMLButtonElement>('[data-action="grid-execute"]')!.click(); await idle();
  expect(f.service.snapshot().battle).not.toEqual(before); expect(f.store.snapshot().battle).toEqual(before);
  expect(noWrite).not.toHaveBeenCalled(); expect(noRead).not.toHaveBeenCalled();
  expect(document.querySelector('[data-role="save-status"]')!.textContent).toBe('开局已保存');
  noWrite.mockRestore(); noRead.mockRestore();
  const live = f.service.snapshot().battle;
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const put = f.journal.put.bind(f.journal);
  const write = vi.spyOn(f.journal, 'put').mockImplementationOnce(async (...args) => { await blocked; await put(...args); });
  document.querySelector<HTMLButtonElement>('[data-action="battle-finish"][data-reason="ceasefire"]')!.click();
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  expect(f.store.snapshot().battle).toEqual(before); expect(f.service.snapshot().battle).toEqual(live);
  release(); await idle(); expect(SmallBattle.fromSnapshot(f.store.snapshot().battle!.snap).isOver()).toBe(true); write.mockRestore();
  expect(document.querySelector('[data-role="save-status"]')!.textContent).toBe('已保存');

  await load(battle('failed-preview')); const saved = f.service.snapshot().battle;
  const failed = vi.spyOn(f.journal, 'put').mockRejectedValueOnce(Error('磁盘不可用'));
  document.querySelector<HTMLButtonElement>('[data-action="battle-finish"][data-reason="ceasefire"]')!.click(); await idle();
  expect(f.service.snapshot().battle).toEqual(saved);
  expect(document.querySelector<HTMLButtonElement>('[data-action="grid-execute"]')!.disabled).toBe(false);
  expect(document.querySelector('[data-role="save-status"]')!.textContent).toContain('未保存'); failed.mockRestore();

  await load(battle('old-background')); background.hold = true;
  document.querySelector<HTMLButtonElement>('[data-action="grid-auto"]')!.click();
  await vi.waitFor(() => expect(background.request).toBeDefined());
  f.switchTo('b'); await f.service.load();
  await f.service.transact(() => save(battle('new-chat')));
  const otherChat = f.service.snapshot(), writes = vi.spyOn(f.service, 'persistPanel');
  background.release!(computeBattleStep(background.request!)); background.hold = false;
  await idle(); expect(f.service.snapshot()).toEqual(otherChat); expect(writes).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('正在保存…');
  f.service.dispose();
}, 30000);
