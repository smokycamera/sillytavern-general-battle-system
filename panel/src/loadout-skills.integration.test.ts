// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { traitRegistry } from '../../engine/src/index.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { buildUnit, newUnitDraft } from './unit-builder.js';
import { unitRecordFromCombatant } from './unit-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('prepares learned skill instances from loadout without refreshing resources, gear or other units', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const unit = buildUnit({ ...newUnitDraft(), name: '施法者', skills: Array.from({ length: 6 }, (_, i) => ({ id: 'generic:magic-single', name: '法术' + i, power: '5', prepared: i < 5 })) }, traitRegistry(), 'loadout-skills');
  unit.id = 'a'; unit.resources.SP = 1;
  unit.abilityState = [{ abilityId: unit.abilities[0]!.cooldownGroup!, cdLeft: 2, used: 1 }];
  const other = buildUnit({ ...newUnitDraft(), name: '同伴' }, traitRegistry(), 'other'); other.id = 'b';
  await f.service.transact(() => ({ schemaVersion: 2, storage: [unit, other].map(u => unitRecordFromCombatant(u)), rosterIds: ['a', 'b'] }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const skill = (i: number) => document.querySelector<HTMLInputElement>(`[data-role="loadout-skill"][data-id="${unit.abilities[i]!.id}"]`)!;
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="inventory"]')!.click();
  const before = f.service.snapshot();
  expect(button('loadout-skills').dataset.id).toBe('a');
  button('loadout-skills').click(); await idle();
  expect(document.querySelectorAll('[data-role="loadout-skill"]')).toHaveLength(6);
  expect(skill(5).disabled).toBe(true);
  skill(0).click(); expect(skill(5).disabled).toBe(false); skill(5).click();
  expect(document.querySelector('[data-role="loadout-skill-count"]')!.textContent).toContain('5 / 5');
  document.querySelector<HTMLButtonElement>('.loadout-skill-dialog [data-action="loadout-skills-close"]')!.click(); await idle();
  expect(f.service.snapshot()).toEqual(before);

  button('loadout-skills').click(); await idle();
  expect(skill(0).checked).toBe(true); expect(skill(5).checked).toBe(false);
  skill(0).click(); skill(5).click(); button('loadout-skills-save').click(); await idle();
  expect(document.querySelector('.loadout-skill-dialog'), document.querySelector('#toast')?.textContent ?? '').toBeNull();
  const saved = f.service.snapshot(), changed = saved.storage![0]!, original = before.storage![0]!;
  expect(changed.preparedAbilityIds).toEqual(unit.abilities.slice(1).map(a => a.id));
  expect(changed.snapshot!.preparedAbilityIds).toEqual(changed.preparedAbilityIds);
  for (const key of ['abilities', 'abilityState', 'resources', 'weapon', 'armor', 'hp'] as const) expect(changed.snapshot![key]).toEqual(original.snapshot![key]);
  expect(saved.inventory).toEqual(before.inventory); expect(saved.storage![1]).toEqual(before.storage![1]);
  await f.service.load(); button('loadout-skills').click(); await idle();
  expect(skill(0).checked).toBe(false); expect(skill(5).checked).toBe(true);

  // An external update invalidates the open draft rather than overwriting it.
  await f.service.transact(current => ({ ...current, storage: current.storage!.map(r => r.id === 'a' ? { ...r, revision: (r.revision ?? 0) + 1 } : r) }));
  expect(button('loadout-skills-save').disabled).toBe(true);
  expect(document.querySelector('.loadout-skill-dialog')!.textContent).toContain('档案已更新');
  f.switchTo('another-chat'); await f.service.load();
  expect(document.querySelector('.loadout-skill-dialog')).toBeNull();
  expect(f.service.snapshot().storage ?? []).toHaveLength(0);
  f.service.dispose();
});
