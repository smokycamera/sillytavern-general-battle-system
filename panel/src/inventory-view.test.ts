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
  const potion = (id: string, assignedTo?: string) => ({ ...createInventoryItem(id, id, { kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, id, 2), assignedTo });
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
  return { panel, controller, render, choose, action, ids, save: () => save, context: (value: string) => { context = value; } };
}

beforeEach(() => { document.body.innerHTML = ''; Element.prototype.scrollIntoView = vi.fn(); });

it('已装备卡片和顶部配装按主武器、副武器、护甲、盾牌、佩戴排序，不受库存写入顺序影响', () => {
  const f = mount(), inventory = f.save().inventory!;
  const primary = inventory.find(item => item.equippedTo?.unitId === 'a' && item.equippedTo.slot === 'primary')!;
  const armor = inventory.find(item => item.equippedTo?.unitId === 'a' && item.equippedTo.slot === 'armor')!;
  const sidearm = createInventoryItem('sidearm', '副武器', { kind: 'weapon', mechanism: 'axe', power: 3 }, 'sidearm');
  const shield = createInventoryItem('shield', '盾牌', { kind: 'shield', power: 3 }, 'shield');
  const worn = createInventoryItem('worn', '饰品', { kind: 'item', form: 'worn', power: 3, bonuses: { defense: 1 } }, 'worn');
  for (const [item, slot] of [[sidearm, 'sidearm'], [shield, 'shield'], [worn, 'gear']] as const) {
    item.assignedTo = 'a'; item.equippedTo = { unitId: 'a', slot };
  }
  f.save().inventory = [worn, shield, armor, sidearm, ...inventory.filter(item => item.id !== armor.id)];
  f.render();
  expect(f.ids().slice(0, 5)).toEqual([primary.id, sidearm.id, armor.id, shield.id, worn.id]);
  expect([...document.querySelectorAll('.loadout-slots small')].map(el => el.textContent)).toEqual(['主武器', '副武器', '护甲', '盾牌', '佩戴']);
});

it('一次性道具可预览改造和增加数量，确认前不写入，取消不改变库存', async () => {
  const f = mount(); f.choose('a');
  await f.action('edit', 'a-bag');
  expect(document.querySelector('.inventory-editor h3')!.textContent).toBe('改造道具');
  document.querySelector<HTMLInputElement>('[data-role="inventory-power"]')!.value = '5';
  await f.action('preview-draft');
  expect(document.querySelector('[data-role="inventory-preview"]'), document.querySelector('[data-role="inventory-feedback"]')?.textContent ?? '').not.toBeNull();
  expect(f.save().inventory!.find(item => item.id === 'a-bag')!.mechanics).toMatchObject({ value: { recipe: { power: 3 } } });
  await f.action('confirm');
  const item = f.save().inventory!.find(item => item.id === 'a-bag')!;
  expect(item).toMatchObject({ qty: 2, assignedTo: 'a', mechanics: { value: { recipe: { power: 5 } } } });
  await f.action('add', 'a-bag');
  document.querySelector<HTMLInputElement>('[data-role="inventory-qty"]')!.value = '3';
  await f.action('preview-draft');
  expect(document.querySelector('.inventory-preview')!.textContent).toContain('数量 2 → 5');
  expect(item.qty).toBe(2);
  await f.action('cancel'); await f.action('close-draft');
  expect(f.save().inventory!.find(item => item.id === 'a-bag')!.qty).toBe(2);
  await f.action('add', 'a-bag');
  document.querySelector<HTMLInputElement>('[data-role="inventory-qty"]')!.value = '3';
  await f.action('preview-draft'); await f.action('confirm');
  expect(f.save().inventory!.find(item => item.id === 'a-bag')).toMatchObject({ qty: 5, assignedTo: 'a', mechanics: item.mechanics });
});

it('佩戴卡片展示短实效和升级收益；旧物更新先预览，提交后保留实物与历史', async () => {
  const f = mount(), name = '佩戴L1+2防御+1速度';
  const worn = createInventoryItem('worn', name, { kind: 'item', form: 'worn', power: 1, bonuses: { defense: 2, speed: 1 } }, 'worn');
  f.save().inventory!.push(worn); f.render();
  let card = document.querySelector<HTMLElement>('[data-inventory-id="worn"]')!;
  expect(card.querySelector('.item-stats')!.textContent).toContain('防御+0.2升L2 +0.06');
  expect(card.querySelector('.item-stats')!.textContent).toContain('速度+0.1升L2 +0.1');
  expect(card.querySelectorAll('b')[0]!.textContent).toBe(name);
  expect(card.querySelector('.item-rules p:last-child')!.textContent).not.toContain(name);
  if (worn.mechanics?.kind !== 'item') throw Error('fixture');
  delete worn.mechanics.value.recipe.wornEffectModel; delete worn.mechanics.value.recipe.progressionModel; delete worn.mechanics.value.passive!.actualEffects;
  f.render();
  await f.action('upgrade-budget', 'worn');
  expect(document.querySelector('.inventory-preview h3')!.textContent).toContain('更新佩戴数值');
  expect(document.querySelector('.inventory-preview')!.textContent).toContain('防御+0.2、速度+0.1');
  expect(worn.history).toBeUndefined();
  await f.action('confirm');
  const updated = f.save().inventory!.find(i => i.id === 'worn')!;
  expect(updated.qty).toBe(1); expect(updated.history).toBeUndefined();
  card = document.querySelector<HTMLElement>('[data-inventory-id="worn"]')!;
  expect(card.querySelector('[data-action="inventory-upgrade-budget"]')).toBeNull();
  expect(card.textContent).toContain('防御+0.2');
});

it('shows only the selected unit and public items, with equipped gear before its bag and public inventory', () => {
  const f = mount(), before = structuredClone(f.save());
  const equippedA = f.save().inventory!.filter(i => i.equippedTo?.unitId === 'a').map(i => i.id);
  expect(f.ids()).toEqual([...equippedA, 'a-bag', 'public']);
  expect(document.querySelector('#inventory-panel h2')?.textContent).toContain(`${equippedA.length + 2}种物品`);
  expect(document.querySelector('.loadout-current')!.compareDocumentPosition(document.querySelector('[data-action="prompt-select-items"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  f.choose('b');
  expect(document.querySelector<HTMLElement>('[data-action="loadout-skills"]')!.dataset.id).toBe('b');
  expect(f.ids()).toEqual([...f.save().inventory!.filter(i => i.equippedTo?.unitId === 'b').map(i => i.id), 'b-bag', 'public']);
  expect(f.save()).toEqual(before);
});

it('keeps the public-only selection across redraws and resets it on a chat change', () => {
  const f = mount(); f.choose(''); f.render();
  expect(f.ids()).toEqual(['public']);
  expect(document.querySelector<HTMLSelectElement>('[data-role="inventory-unit"]')!.value).toBe('');
  expect(document.querySelector('.loadout-current')).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('[data-action="loadout-skills"]')!.disabled).toBe(true);
  f.context('chat-b'); f.render();
  expect(document.querySelector<HTMLSelectElement>('[data-role="inventory-unit"]')!.value).toBe('a');
});

it('supports unequip, return to public storage and transfer without exposing another unit inventory', async () => {
  const f = mount();
  const gear = f.save().inventory!.find(i => i.equippedTo?.unitId === 'a' && i.equippedTo.slot === 'primary')!;
  await f.action('unequip', gear.id);
  expect(f.save().inventory!.find(i => i.id === gear.id)!.assignedTo).toBe('a');
  expect(f.save().inventory!.find(i => i.id === gear.id)!.equippedTo).toBeUndefined();
  expect(document.querySelector('[data-action="inventory-confirm"]')).toBeNull();
  await f.action('equip', gear.id);
  expect(f.save().inventory!.find(i => i.id === gear.id)!.equippedTo).toEqual({ unitId: 'a', slot: 'primary' });
  expect(document.querySelector('[data-action="inventory-confirm"]')).toBeNull();
  await f.action('unequip', gear.id);
  f.choose('b'); expect(f.ids()).not.toContain(gear.id);
  f.choose('a'); await f.action('unassign', gear.id);
  expect(f.save().inventory!.find(i => i.id === gear.id)!.assignedTo).toBe('a');
  await f.action('confirm'); f.choose('b'); expect(f.ids()).toContain(gear.id);
  await f.action('assign', gear.id); await f.action('confirm');
  expect(f.save().inventory!.find(i => i.id === gear.id)!.assignedTo).toBe('b');
  f.choose('a'); expect(f.ids()).not.toContain(gear.id);
});

it('direct equipment saves block duplicate clicks and can retry a failed save without confirmation', async () => {
  const f = mount(), before = structuredClone(f.save());
  const gear = f.save().inventory!.find(i => i.equippedTo?.unitId === 'a' && i.equippedTo.slot === 'primary')!;
  let release!: (value: any) => void;
  const commit = vi.spyOn(f.controller, 'commitInventoryPreview').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const button = document.querySelector<HTMLElement>(`[data-action="inventory-unequip"][data-item="${gear.id}"]`)!;
  const pending = f.panel.handleAction(button);
  await f.panel.handleAction(button);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-action="inventory-confirm"]')).toBeNull();
  release({ status: 'failed', error: 'save failed' }); await pending;
  expect(f.save()).toEqual(before);
  expect(document.querySelector('[data-role="inventory-feedback"]')!.textContent).toContain('save failed');
  await f.action('unequip', gear.id);
  expect(f.save().inventory!.find(i => i.id === gear.id)!.equippedTo).toBeUndefined();
  expect(f.save().factRevision).toBe(before.factRevision! + 1);
  expect(document.querySelector('[data-action="inventory-confirm"]')).toBeNull();
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
  expect(document.querySelector<HTMLButtonElement>('[data-action="loadout-skills"]')!.disabled).toBe(false);
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


it('bulk selection only includes visible unequipped stacks, confirms once, commits one transaction', async () => {
  const f=mount(record=>record.id!=='enemy'),before=structuredClone(f.save());
  await f.action('bulk');
  expect(document.querySelector('[data-action="inventory-new"]')).toBeNull();
  const checks=[...document.querySelectorAll<HTMLInputElement>('[data-role="inventory-select"]')];
  expect(checks.filter(c=>!c.disabled).map(c=>c.dataset.item)).toEqual(['a-bag','public']);
  expect(checks.some(c=>c.disabled)).toBe(true);
  await f.action('select-all');
  expect(document.querySelector('[data-action="inventory-delete-selected"]')!.textContent).toBe('删除（2）');
  await f.action('delete-selected');
  expect(document.querySelector('[data-role="inventory-preview"]')!.textContent).toContain('删除已选的2项物品？');
  expect(f.save()).toEqual(before);
  await f.action('confirm');
  expect(f.save().factRevision).toBe(before.factRevision!+1);
  expect(f.save().inventoryOperations).toHaveLength(1);
  expect(f.save().inventory!.filter(i=>['public','a-bag'].includes(i.id)).every(i=>i.qty===0)).toBe(true);
  expect(f.save().inventory!.find(i=>i.id==='b-bag')!.qty).toBe(2);
  expect(f.save().storage).toEqual(before.storage);
  expect(document.querySelector('[data-role="inventory-select"]')).toBeNull();
});
it('cancel, per-item toggles, select-all toggle, changed owner and changed chat clear pending choices', async () => {
  const f=mount(),before=structuredClone(f.save());await f.action('bulk');
  const check=document.querySelector<HTMLInputElement>('[data-role="inventory-select"][data-item="public"]')!;
  check.checked=true;f.panel.handleChange(check);
  expect(document.querySelector('[data-action="inventory-delete-selected"]')!.textContent).toBe('删除（1）');
  await f.action('select-all');await f.action('select-all');
  expect(document.querySelector<HTMLButtonElement>('[data-action="inventory-delete-selected"]')!.disabled).toBe(true);
  await f.action('select-all');await f.action('delete-selected');await f.action('cancel');
  expect(document.querySelector('[data-role="inventory-preview"]')).toBeNull();
  f.choose('b');expect(document.querySelector('[data-action="inventory-delete-selected"]')!.textContent).toBe('删除（0）');
  await f.action('select-all');f.context('new');f.render();
  expect(document.querySelector('[data-role="inventory-select"]')).toBeNull();
  await f.action('bulk');await f.action('select-all');await f.action('bulk-cancel');
  expect(f.save()).toEqual(before);
});
it('lost items and battle locks prune selections and discard stale confirmation', async () => {
  const f=mount();await f.action('bulk');await f.action('select-all');await f.action('delete-selected');
  f.save().inventory!.find(i=>i.id==='public')!.qty=0;f.render();
  expect(document.querySelector('[data-role="inventory-preview"]')).toBeNull();
  expect(document.querySelector('[data-action="inventory-delete-selected"]')!.textContent).toBe('删除（1）');
  f.save().battle={kind:'small',snap:{seed:'battle'}};f.render();
  expect(document.querySelector<HTMLButtonElement>('[data-action="inventory-delete-selected"]')!.disabled).toBe(true);
  expect(document.querySelector('[data-action="inventory-delete-selected"]')!.textContent).toBe('删除（0）');
});
it('failed save keeps facts and same preview for retry; repeated confirm while pending is blocked', async () => {
  const f=mount(),before=structuredClone(f.save());await f.action('bulk');await f.action('select-all');await f.action('delete-selected');
  const real=f.controller.commitInventoryPreview.bind(f.controller);
  let release!:(value:any)=>void;
  const spy=vi.spyOn(f.controller,'commitInventoryPreview').mockImplementationOnce(()=>new Promise(resolve=>release=resolve));
  const button=document.querySelector<HTMLElement>('[data-action="inventory-confirm"]')!;
  const pending=f.panel.handleAction(button);await f.panel.handleAction(button);
  expect(spy).toHaveBeenCalledTimes(1);expect(f.save()).toEqual(before);
  release({status:'failed',error:'save failed'});await pending;
  expect(document.querySelector('[data-role="inventory-preview"]')).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>('[data-action="inventory-confirm"]')!.disabled).toBe(false);
  spy.mockImplementation(real);await f.action('confirm');expect(f.save().factRevision).toBe(before.factRevision!+1);
});
it('late failure from old chat cannot poison a new view or leave buttons stuck disabled', async () => {
  const f=mount();await f.action('bulk');await f.action('select-all');await f.action('delete-selected');
  let reject!:(error:Error)=>void;
  vi.spyOn(f.controller,'commitInventoryPreview').mockImplementationOnce(()=>new Promise((_resolve,r)=>reject=r));
  const pending=f.action('confirm');f.context('new-chat');f.render();
  reject(Error('old save failure'));await pending;
  expect(document.querySelector('[data-role="inventory-feedback"]')!.textContent).not.toContain('old save failure');
  expect(document.querySelector<HTMLButtonElement>('[data-action="inventory-new"]')!.disabled).toBe(false);
});
