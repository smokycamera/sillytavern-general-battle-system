// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { traitRegistry } from '../../engine/src/index.js';
import { buildUnit, newUnitDraft } from './unit-builder.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { prepareInventoryState } from './inventory-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('managed character editing survives input, skill rerender, preview, confirmation and reopen without re-forging inventory', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  try {
    const d = newUnitDraft(); d.name = '无强化的原单位'; d.armor.tier = '1';
    const unit = buildUnit(d, traitRegistry(), 'managed-edit-integration');
    await f.service.transact(() => ({ ...prepareInventoryState({ schemaVersion: 2, storage: [unitRecordFromCombatant(unit)] }), rosterIds: [unit.id] }));
    Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
    document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
    await import('./main.js');
    const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 5000 });
    const click = async (selector: string) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      expect(button, selector).not.toBeNull(); expect(button!.disabled).toBe(false);
      button!.click(); await idle();
    };
    const input = (role: string, value: string) => {
      const el = document.querySelector<HTMLInputElement>(`[data-role="edit-${role}"]`)!;
      expect(el, role).not.toBeNull(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await click('[data-action="workspace-tab"][data-tab="units"]');
    await click('[data-action="manage-toggle"]');
    const before = f.service.snapshot(), original = before.storage![0]!;
    expect(original.equipmentManaged).toBe(true); expect(original.snapshot!.weapon!.recipe!.bonuses).toBeUndefined();
    await click(`[data-action="storage-edit"][data-id="${unit.id}"]`);
    input('name', '已编辑的单位'); input('hpMax', '100'); input('hp', '17'); input('note', '没有修改任何装备');
    await click('[data-action="builder-skill-add"][data-builder="edit"]:not([data-mechanism])');
    expect(document.querySelector<HTMLInputElement>('[data-role="edit-name"]')!.value).toBe('已编辑的单位');
    input('skill-name', '新学技能');
    await click('[data-action="storage-preview"]');
    expect(document.querySelector('[data-role="builder-preview"]')).not.toBeNull();
    await click('[data-action="storage-preview"]'); expect(f.service.snapshot().storage).toEqual(before.storage);
    await click('[data-action="builder-confirm"]');
    const after = f.service.snapshot(), result = after.storage![0]!;
    expect(result).toMatchObject({ name: '已编辑的单位', hp: 17, base: { hpMax: 100 }, note: '没有修改任何装备', equipmentManaged: true });
    for (const slot of ['weapon', 'sidearm', 'armor', 'shield'] as const) expect(result.snapshot![slot]).toEqual(original.snapshot![slot]);
    expect(result.snapshot!.abilities.some(a => a.name === '新学技能')).toBe(true);
    expect(result.snapshot!.resources.SP).toBe(original.snapshot!.resources.SP);
    expect(after.inventory).toEqual(before.inventory);
    await click(`[data-action="storage-edit"][data-id="${unit.id}"]`);
    await click('[data-action="storage-preview"]'); expect(document.querySelector('[data-role="builder-preview"]')).not.toBeNull();
    await click('[data-action="manage-cancel-edit"]');
    await f.service.load(); expect(f.service.snapshot().storage).toEqual(after.storage); expect(f.service.snapshot().inventory).toEqual(before.inventory);
    await click(`[data-action="storage-edit"][data-id="${unit.id}"]`);
    input('name','过期草稿');await click('[data-action="storage-preview"]');
    const persist=f.service.persistPanel.bind(f.service);
    vi.spyOn(f.service,'persistPanel').mockImplementationOnce(async(...args)=>{
      await f.service.transact(saved=>({...saved,factRevision:(saved.factRevision??0)+1,storage:saved.storage!.map(r=>r.id!==unit.id?r:{...r,name:'已接受的新事实',hp:13,revision:(r.revision??0)+1,snapshot:{...r.snapshot!,name:'已接受的新事实',hp:13}})}));
      return persist(...args);
    });
    await click('[data-action="builder-confirm"]');
    expect(f.service.snapshot().storage![0]).toMatchObject({name:'已接受的新事实',hp:13});
    await click('[data-action="manage-cancel-edit"]');
    await click('[data-action="workspace-tab"][data-tab="battle"]');
    await f.service.load();expect(f.service.snapshot().storage![0]).toMatchObject({name:'已接受的新事实',hp:13});
  } finally { f.service.dispose(); }
}, 15000);
