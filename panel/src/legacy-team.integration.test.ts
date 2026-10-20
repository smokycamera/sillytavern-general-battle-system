// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { proposalFromMessage, type NarrativeProposal } from './narrative-state.js';
import type { Suggestion } from './tags.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));

afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('opens the team workspace with pre-2.6.7 item grants in saved history and pending records without replaying them', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const unit = generateUnit({ name: '旧档队员', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', traits: [] }, { seed: 'legacy-team' }).unit;
  unit.id = 'legacy-unit';
  const legacy = (id?: string) => ({ kind: 'give', item: '旧档补给', qty: 2, lootType: 'misc', ...(id ? { id } : {}), raw: '<give item="旧档补给" qty="2"/>' }) as unknown as Suggestion;
  const proposal = proposalFromMessage({ characterId: '0', chatId: 'a', branchId: 'main', messageId: 'old', swipeId: '0', role: 'assistant', complete: true, text: '<tb><add item="旧档补给" qty="2"/></tb>' })!;
  const proposals = (['committed', 'rejected', 'legacy'] as const).map((status, i): NarrativeProposal => ({ ...proposal, id: 'old-' + i, sourceKey: 'old-source-' + i, status, events: [legacy(i ? unit.id : undefined)] }));
  const inventory = [{ id: 'existing-supply', name: '已有补给', qty: 7, lootType: 'misc' as const }];
  await f.service.transact(() => ({ schemaVersion: 2, storage: [unitRecordFromCombatant(unit)], rosterIds: [unit.id], inventory, proposals, pending: [legacy(), legacy(unit.id)] }));
  const before = f.service.snapshot();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const nav = (tab: string) => document.querySelector<HTMLButtonElement>(`[data-action="workspace-tab"][data-tab="${tab}"]`)!.click();
  nav('units');
  expect(document.querySelector('[data-workspace="units"]')!.textContent).toContain('参战队伍');
  expect(document.querySelector('[data-workspace="units"]')!.textContent).toContain('旧档队员');
  expect(document.querySelector('[data-workspace="units"]')!.textContent).toContain('获得物品「旧档补给」×2');
  nav('inventory'); nav('units');
  expect(document.querySelector('[data-workspace="units"]')!.textContent).toContain('全部单位档案');
  expect(f.service.snapshot()).toEqual(before);
  await f.service.load(); nav('units');
  expect(document.querySelector('[data-workspace="units"]')!.textContent).toContain('获得物品「旧档补给」×2');
  expect(f.service.snapshot().inventory).toEqual(before.inventory);
  f.service.dispose();
});
