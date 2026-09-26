// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { createInventoryItem, prepareInventoryState, prepareInventoryTransaction, type InventorySave, type InventoryAction } from './inventory-state.js';
import { InventoryPanel } from './inventory-view.js';
import type { PanelController } from './controller-port.js';
import type { InventoryPreview } from './narrative-controller.js';
import { selectPromptEntries } from './prompt-settings.js';

function fixture() {
  const storage = ['a', 'b', 'enemy'].map(id => {
    const unit = generateUnit({ name: id, side: id === 'enemy' ? 'enemy' : 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'sword', traits: [] }, { seed: id }).unit;
    unit.id = id; return unitRecordFromCombatant(unit);
  });
  const potion = (id: string, assignedTo?: string) => ({ ...createInventoryItem(id, id, { kind: 'consumable', mechanism: 'heal', power: 3 }, id, 2), assignedTo });
  return prepareInventoryState({ schemaVersion: 2, factRevision: 1, storage, inventory: [potion('public'), potion('b-bag', 'b'), potion('a-bag', 'a'), { ...potion('empty'), qty: 0 }] });
}

function mount(canView = (_record: NonNullable<InventorySave['storage']>[number]) => true) {
  let save = fixture(), context = 'chat-a';
  const controller = {
    snapshot: () => structuredClone(save), inventoryContext: () => context,
    previewInventory: (action: InventoryAction): InventoryPreview => {
      const intent = { ...action, id: crypto.randomUUID(), expectedRevision: save.factRevision! };
      return { context, action, intent, before: structuredClone(save), after: prepareInventoryTransaction(save, intent) };
    },
    commitInventoryPreview: (preview: InventoryPreview) => { save = prepareInventoryTransaction(save, preview.intent); return { status: 'saved' }; },
  } as unknown as PanelController;
  const panel = new InventoryPanel(controller, canView);
  const render = () => { document.body.innerHTML = panel.render(); };
  render();
  const choose = (id: string) => {
    const select = document.querySelector<HTMLSelectElement>('[data-role="inventory-unit"]')!;
    select.value = id; panel.handleChange(select);
  };
  const action = async (name: string, id?: string) => {
    const button = document.querySelector<HTMLElement>(`[data-action="inventory-${name}"]${id ? `[data-item="${id}"]` : ''}`)!;
    expect(button).not.toBeNull(); await panel.handleAction(button);
  };
  const ids = () => [...document.querySelectorAll<HTMLElement>('[data-inventory-id]')].map(el => el.dataset.inventoryId!);
  return { panel, render, choose, action, ids, save: () => save, context: (value: string) => { context = value; } };
}

beforeEach(() => { document.body.innerHTML = ''; Element.prototype.scrollIntoView = vi.fn(); });

it('shows only the selected unit and public items, with equipped gear before its bag and public inventory', () => {
  const f = mount(), before = structuredClone(f.save());
  const equippedA = f.save().inventory!.filter(i => i.equippedTo?.unitId === 'a').map(i => i.id);
  expect(f.ids()).toEqual([...equippedA, 'a-bag', 'public']);
  expect(document.querySelector('#inventory-panel h2')?.textContent).toContain(`${equippedA.length + 2}条`);
  expect(document.querySelector('.loadout-current')!.compareDocumentPosition(document.querySelector('[data-action="prompt-select-items"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  f.choose('b');
  expect(f.ids()).toEqual([...f.save().inventory!.filter(i => i.equippedTo?.unitId === 'b').map(i => i.id), 'b-bag', 'public']);
  expect(f.save()).toEqual(before);
});

it('keeps the public-only selection across redraws and resets it on a chat change', () => {
  const f = mount(); f.choose(''); f.render();
  expect(f.ids()).toEqual(['public']);
  expect(document.querySelector<HTMLSelectElement>('[data-role="inventory-unit"]')!.value).toBe('');
  expect(document.querySelector('.loadout-current')).toBeNull();
  f.context('chat-b'); f.render();
  expect(document.querySelector<HTMLSelectElement>('[data-role="inventory-unit"]')!.value).toBe('a');
});

it('supports unequip, return to public storage and transfer without exposing another unit inventory', async () => {
  const f = mount();
  const gear = f.save().inventory!.find(i => i.equippedTo?.unitId === 'a' && i.equippedTo.slot === 'primary')!;
  await f.action('unequip', gear.id); await f.action('confirm');
  expect(f.save().inventory!.find(i => i.id === gear.id)!.assignedTo).toBe('a');
  expect(f.save().inventory!.find(i => i.id === gear.id)!.equippedTo).toBeUndefined();
  f.choose('b'); expect(f.ids()).not.toContain(gear.id);
  f.choose('a'); await f.action('unassign', gear.id);
  expect(f.save().inventory!.find(i => i.id === gear.id)!.assignedTo).toBe('a');
  await f.action('confirm'); f.choose('b'); expect(f.ids()).toContain(gear.id);
  await f.action('assign', gear.id); await f.action('confirm');
  expect(f.save().inventory!.find(i => i.id === gear.id)!.assignedTo).toBe('b');
  f.choose('a'); expect(f.ids()).not.toContain(gear.id);
});

it('limits bulk prompt selection to visible items and preserves observation restrictions', () => {
  const f = mount(record => record.id !== 'enemy');
  expect(document.querySelector('option[value="enemy"]')).toBeNull();
  expect(f.panel.visibleItemIds()).toEqual(f.ids());
  const settings = selectPromptEntries({ excludedItemIds: ['b-bag'] }, 'item', f.panel.visibleItemIds(), false);
  expect(settings.excludedItemIds).toEqual(expect.arrayContaining(['a-bag', 'public', 'b-bag']));
  expect(settings.excludedItemIds).not.toContain(f.save().inventory!.find(i => i.equippedTo?.unitId === 'enemy')!.id);
  expect(selectPromptEntries(settings, 'item', f.panel.visibleItemIds(), true).excludedItemIds).toEqual(['b-bag']);
});

it('locks returning carried items to public inventory during a battle', () => {
  const f = mount(); f.save().battle = { kind: 'small', snap: { seed: 'battle' } }; f.render();
  expect(document.querySelector<HTMLButtonElement>('[data-action="inventory-unassign"][data-item="a-bag"]')!.disabled).toBe(true);
});

it('closes a hidden unit item draft and cancels its pending preview when switching units', async () => {
  const f = mount(), before = structuredClone(f.save());
  const gear = f.save().inventory!.find(i => i.equippedTo?.unitId === 'a' && i.equippedTo.slot === 'primary')!;
  await f.action('edit', gear.id); await f.action('preview-draft');
  expect(document.querySelector('[data-role="inventory-preview"]')).not.toBeNull();
  f.choose('b');
  expect(document.querySelector('.inventory-form')).toBeNull();
  expect(document.querySelector('[data-role="inventory-preview"]')).toBeNull();
  expect(f.save()).toEqual(before);
});
