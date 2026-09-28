// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { SmallBattle, MassBattle, traitRegistry, standardField, V7_OVERFLOW_D20, V7_OVERFLOW_TW, type Combatant } from '../../engine/src/index.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { buildUnit, newUnitDraft } from './unit-builder.js';
import { unitRecordFromCombatant } from './unit-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('saves battle skill changes from battle and loadout, preserves live ledgers and archives, and rejects stale drafts or failed saves', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const click = async (action: string) => { expect(button(action)?.disabled, action).toBe(false); button(action).click(); await idle(); };
  const tab = async (name: string) => { document.querySelector<HTMLButtonElement>(`[data-action="workspace-tab"][data-tab="${name}"]`)!.click(); await idle(); };
  const savedUnit = () => (f.service.snapshot().battle!.snap.combatants as Combatant[]).find(u => u.id === 'a')!;

  for (const mode of ['small', 'mass'] as const) {
    const units = ['a', 'b', 'enemy'].map(id => {
      const u = buildUnit({ ...newUnitDraft(), name: id, side: id === 'enemy' ? 'enemy' : 'ally', scale: mode === 'small' ? 'hero' : 'company', hpMax: '100',
        skills: Array.from({ length: 6 }, (_, i) => ({ id: 'generic:magic-single', name: id + i, power: '1', prepared: i < 5 })) }, traitRegistry(), id);
      u.id = id; return u;
    });
    const field = standardField(7, 13); field.tiles.fill('open');
    const b = mode === 'small' ? new SmallBattle({ rules: V7_OVERFLOW_D20, combatants: units, battlefield: field, seed: 'live-skills' })
      : new MassBattle({ rules: V7_OVERFLOW_TW, combatants: units, seed: 'live-skills' }); b.start();
    const actor = b.byId('a'), ids = actor.abilities.map(a => a.id);
    actor.resources.SP = 3;
    const oldOrder = { unitId: 'a', type: 'ability' as const, abilityId: ids[0], abilityActorId: 'a', targetId: 'enemy' };
    if (b instanceof SmallBattle) {
      b.turnOrder = ['a', 'b', 'enemy']; b.turnIndex = 0; actor.pos = 73; b.byId('b').pos = 79; b.byId('enemy').pos = 52;
      b.movementSpent.set('a', 1); b.reactionSpent.add('a');
    } else {
      expect(b.issue(oldOrder).ok).toBe(true); expect(b.issue({ unitId: 'b', type: 'brace' }).ok).toBe(true);
    }
    actor.abilityState = [{ abilityId: actor.abilities[0]!.cooldownGroup!, cdLeft: 2, used: 1 }];
    await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id),
      battle: { kind: mode, snap: b.toSnapshot() }, orderDraft: mode === 'mass' ? { a: oldOrder, b: { type: 'brace' } } : {} }));
    await tab('battle');
    const castingSkills = async () => {
      if (mode === 'small') {
        [...document.querySelectorAll<HTMLButtonElement>('.command-modes [data-action="grid-mode"]')].find(el => el.textContent === '技能')!.click();
        await idle();
      }
      const role = mode === 'small' ? 'grid-mode' : 'formation-order';
      return [...document.querySelectorAll<HTMLOptionElement>(`[data-role="${role}"] option`)].map(el => el.textContent!.split(' · ')[0]);
    };
    expect(await castingSkills()).toContain('a0'); // 已装备但正在冷却，仍需显示。
    expect(await castingSkills()).not.toContain('a5');
    const before = f.service.snapshot();
    const skill = (i: number) => document.querySelector<HTMLInputElement>(`[data-role="loadout-skill"][data-id="${ids[i]}"]`)!;
    await click('loadout-skills');
    expect(skill(5).disabled).toBe(true);
    skill(0).click(); skill(5).click(); await click('loadout-skills-save');
    expect(document.querySelector('.loadout-skill-dialog'), document.querySelector('#toast')?.textContent).toBeNull();
    expect(savedUnit().preparedAbilityIds).toEqual(ids.slice(1));
    expect(await castingSkills()).not.toContain('a0');
    expect(await castingSkills()).toContain('a5');
    const expected = structuredClone(before.battle!);
    (expected.snap.combatants as Combatant[]).find(u => u.id === 'a')!.preparedAbilityIds = ids.slice(1);
    if (mode === 'mass') {
      expected.snap.orders = [{ unitId: 'a', type: 'hold' }, { unitId: 'b', type: 'brace' }];
      expect(f.service.snapshot().orderDraft).toEqual({ a: { type: 'hold' }, b: { type: 'brace' } });
    }
    expect(f.service.snapshot().battle).toEqual(expected);
    expect(f.service.snapshot().storage).toEqual(before.storage); expect(f.service.snapshot().inventory ?? []).toEqual(before.inventory ?? []);

    // Reload reads the live prepared list rather than the unchanged pre-battle archive.
    await f.service.load(); await tab('inventory'); await click('loadout-skills');
    expect(skill(0).checked).toBe(false); expect(skill(5).checked).toBe(true);
    skill(5).click(); skill(0).click(); await click('loadout-skills-save');
    expect(new Set(savedUnit().preparedAbilityIds)).toEqual(new Set(ids.slice(0, 5))); expect(savedUnit().abilityState).toEqual(actor.abilityState);

    // A failed durable write must not keep an in-memory swap.
    await click('loadout-skills'); skill(0).click(); skill(5).click();
    const failed = vi.spyOn(f.service, 'persistPanel').mockRejectedValueOnce(Error('模拟保存失败'));
    await click('loadout-skills-save'); expect(new Set(savedUnit().preparedAbilityIds)).toEqual(new Set(ids.slice(0, 5))); failed.mockRestore();
    await f.service.load();
    document.querySelector<HTMLButtonElement>('.loadout-skill-dialog [data-action="loadout-skills-close"]')!.click(); await idle();
    await click('loadout-skills'); expect(skill(0).checked).toBe(true);

    // Updates while the dialog is open invalidate its battle revision.
    await f.service.transact(current => ({ ...current, factRevision: (current.factRevision ?? 0) + 1 }));
    expect(button('loadout-skills-save').disabled).toBe(true);
    expect(document.querySelector('.loadout-skill-dialog')!.textContent).toContain('档案已更新');
    document.querySelector<HTMLButtonElement>('.loadout-skill-dialog [data-action="loadout-skills-close"]')!.click(); await idle();
  }
  f.service.dispose();
}, 15000);
