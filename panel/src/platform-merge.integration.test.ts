// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, standardField, V45_OVERFLOW_D20 } from '../../engine/src/index.js';
import { detachMembers } from '../../engine/src/small/transport-groups.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';
import { saveLlmSettings } from './llm-settings.js';
import { unitRecordFromCombatant } from './unit-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));

it('hands the first activation of the next round to the enemy LLM after a manual merge', async () => {
  const f = nativeFixture();
  await f.service.start();
  localStorage.clear();
  const rider = generateUnit({ name: 'Cavalry', side: 'ally', scale: 'company', hpMax: 20, level: 3,
    rulesVersion: 'v2', weaponClass: 'spear', traits: [] }, { seed: 'merge-rider' }).unit;
  const crossbow = generateUnit({ name: 'Crossbowmen', side: 'enemy', scale: 'company', hpMax: 25, level: 3,
    rulesVersion: 'v2', weaponClass: 'crossbow', traits: [] }, { seed: 'merge-crossbow' }).unit;
  rider.id = 'u1'; crossbow.id = 'u2';
  const storage = [rider, crossbow].map(unit => unitRecordFromCombatant(unit));
  const detachment = detachMembers(rider, 14, 'u1:part:1');
  const field = standardField(7, 13);
  field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [rider, detachment, crossbow], battlefield: field, rules: V45_OVERFLOW_D20, seed: 'merge-ui' });
  b.start();
  rider.pos = 81; detachment.pos = 80; crossbow.pos = 3;
  b.turnOrder = [crossbow.id, rider.id, detachment.id]; b.turnIndex = 2; b.round = 2;

  const base = encounterRequest({ roster: b.combatants, setup: { mode: 'small', field: 'plains', lighting: 'day',
    mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' },
    settings: normalizeContextSettings(), messages: [], windowSize: 0, roles: [], phase: 'preparation' }).base;
  await f.service.transact(() => ({ schemaVersion: 2, storage, rosterIds: [rider.id, crossbow.id],
    encounterContext: { ...base, llmCommanders: { enemy: { battleSeed: b.seed, side: 'enemy',
      brief: { name: 'Crossbow officer', persona: 'cautious', known: [], mission: 'Hold the line' },
      memory: { plan: '', notes: [], terrain: [] } } } }, battle: { kind: 'small', snap: b.toSnapshot() } }));
  saveLlmSettings({ enabled: true, commandEnemy: true, selectBattleScale: false, designMap: false,
    windowSize: 6, model: 'fixture', url: 'https://fixture.invalid/v1', token: '', models: [] });
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} },
    __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const round = JSON.parse(body.messages[1].content).round;
    expect(round).toBe(3);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      intents: [{ unit: crossbow.id, mode: 'advance', cell: 4 }],
    }) } }] }));
  });
  vi.stubGlobal('fetch', request);
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  try {
    await import('./main.js');
    const merge = document.querySelector<HTMLButtonElement>('button[data-action="small-platform"][data-kind="merge"]')!;
    expect(merge?.disabled).toBe(false);
    merge.click();
    await vi.waitFor(() => {
      expect(document.body.getAttribute('aria-busy')).not.toBe('true');
      expect(f.service.snapshot().battle?.snap.turnIndex).toBe(1);
    });
    const resumed = SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
    expect(request).toHaveBeenCalledTimes(1);
    expect(resumed.round).toBe(3);
    expect(resumed.active?.id).toBe(rider.id);
    expect(resumed.byId(rider.id).hp).toBe(20);
    expect(resumed.combatants.some(unit => unit.id === detachment.id)).toBe(false);
    expect(resumed.byId(crossbow.id).pos).toBe(4);
  } finally {
    window.dispatchEvent(new Event('pagehide'));
    f.service.dispose();
    vi.unstubAllGlobals();
  }
});
