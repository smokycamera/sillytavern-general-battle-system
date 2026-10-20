import { expect, it } from 'vitest';
import { generateUnit } from '../../engine/src/index.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { createInventoryItem, prepareInventoryState, prepareInventoryTransaction, type InventorySave } from './inventory-state.js';
import { narrativeIds } from './narrative-ids.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
import { parseProtocol } from './protocol.js';
import { unitRecordFromCombatant } from './unit-state.js';

function initial(): NarrativeSave {
  const storage = ['owner', 'receiver', 'receiver2'].map(id => {
    const unit = generateUnit({ name: id, side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [], weaponClass: 'sword' }, { seed: id }).unit;
    unit.id = id; return unitRecordFromCombatant(unit);
  });
  return prepareInventoryState({ storage, factRevision: 1, storySync: true, inventory: [
    { ...createInventoryItem('potion', '治疗药水', { kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, 'frozen-potion', 6), assignedTo: 'owner', note: '原始来源' },
  ] });
}
function proposal(save: NarrativeSave, body: string) {
  const source: MessageEnvelope = { characterId: 'char', chatId: 'chat', branchId: 'main', messageId: '1', swipeId: '0', role: 'assistant', complete: true, generationId: 'g', text: `<tb>${body}</tb>` };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, 'g'); binding.complete = true;
  return { ns, value: proposalFromMessage(source, binding)! };
}

it('add 新增支持武器、护甲、盾牌与三类道具；接收编号可省略to并放在任意属性位置', () => {
  for (const attrs of ['u2 item="药水" spec="buff治疗L3"', 'item="药水" u2 spec="buff治疗L3"', 'item=药水 spec=buff治疗L3 u2', 'item=药水 to u2 spec=buff治疗L3', 'item="药水" id="u2" spec="buff治疗L3"']) {
    const parsed = parseProtocol(`<add ${attrs} qty="2"/>`);
    expect(parsed.errors, attrs).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ kind: 'add', to: 'u2', item: '药水', qty: 2 });
    expect(parseProtocol(parsed.canonical).events).toEqual(parsed.events);
  }
  const save = initial(), p = proposal(save, ['剑L4', '重甲L4', '大盾L4', 'buff治疗L3', '充能魔法单体热能L3', '夜战专精L3'].map((spec, index) => `<add item="新物品${index}" spec="${spec}"/>`).join(''));
  expect(p.value.status).toBe('pending');
  const added = prepareNarrativeTransaction(save, p.value, p.ns, true).inventory!.filter(item => item.name.startsWith('新物品'));
  expect(added.map(item => item.mechanics?.kind === 'item' ? item.mechanics.value.recipe.form : item.mechanics?.kind)).toEqual(['weapon', 'armor', 'shield', 'single', 'charged', 'worn']);
  expect(parseProtocol('<add item="药" to="u1" u2/>').errors.join()).toContain('冲突');
  expect(parseProtocol('<give item="新药" spec="buff治疗L3"/>').errors.length).toBeGreaterThan(0);
});

it('一次性道具整叠改造保留编号、数量、归属和来源，补数量使用新规格，旧操作不会重复入账', () => {
  const save = initial(), old = structuredClone(save.inventory![0]!);
  const reforged = prepareInventoryTransaction(save, { kind: 'reforge', id: 'reforge', expectedRevision: 1, itemId: 'potion', name: '强化药水', spec: { kind: 'item', form: 'single', power: 5, active: 'generic:buff:heal' } });
  const item = reforged.inventory![0]!;
  expect(item).toMatchObject({ id: old.id, qty: 6, name: '强化药水', assignedTo: old.assignedTo, note: old.note, revision: 2, mechanics: { value: { recipe: { seed: 'frozen-potion', power: 5 } } } });
  expect(item.mechanics).not.toEqual(old.mechanics);
  const intent = { kind: 'add' as const, id: 'restock', expectedRevision: reforged.factRevision!, itemId: 'potion', qty: 2 };
  const next = prepareInventoryTransaction(reforged, intent);
  expect(next.inventory![0]!.qty).toBe(8); expect(next.inventory![0]!.mechanics).toEqual(item.mechanics);
  expect(prepareInventoryTransaction(next, intent)).toEqual(next);
  expect(save.inventory![0]).toEqual(old);
  expect(() => prepareInventoryTransaction(next, { kind: 'reforge', id: 'bad-form', expectedRevision: next.factRevision!, itemId: 'potion', spec: { kind: 'item', form: 'charged', power: 5, active: 'generic:buff:heal' } })).toThrow(/形态|互相改造/);
});

it('补充佩戴、充能和武器时逐件保存冻结属性，保持原装备位且不重掷武器数值', () => {
  let save: InventorySave = initial();
  for (const form of ['worn', 'charged'] as const) {
    save.inventory!.push({ ...createInventoryItem(form, form, form === 'worn' ? { kind: 'item', form, power: 3, bonuses: { defense: 2 } } : { kind: 'item', form, power: 3, active: 'generic:buff:heal' }, form), assignedTo: 'owner', equippedTo: { unitId: 'owner', slot: 'gear' } });
  }
  save = prepareInventoryState(save);
  const weapon = save.inventory!.find(item => item.equippedTo?.unitId === 'owner' && item.equippedTo.slot === 'primary')!;
  for (const itemId of ['worn', 'charged', weapon.id]) {
    const old = structuredClone(save.inventory!.find(item => item.id === itemId)!);
    save = prepareInventoryTransaction(save, { kind: 'add', id: `copy-${itemId}`, expectedRevision: save.factRevision!, itemId, qty: 2 });
    const copies = save.inventory!.filter(item => item.sourceItemId === itemId);
    expect(copies).toHaveLength(2);
    expect(copies.every(item => item.qty === 1 && item.assignedTo === 'owner' && !item.equippedTo)).toBe(true);
    for (const copy of copies) expect(copy.mechanics?.kind === 'weapon' ? { ...copy.mechanics, value: { ...copy.mechanics.value, id: old.id } } : copy.mechanics).toEqual(old.mechanics);
    expect(save.inventory!.find(item => item.id === itemId)).toEqual(old);
  }
  expect(prepareInventoryState(JSON.parse(JSON.stringify(save))).inventory).toEqual(save.inventory);
});

it('give 部分转移严格扣减原库存，拆分属性不变；整件武器转移卸下原槽，保持实物编号', () => {
  const save = initial(), old = structuredClone(save.inventory![0]!);
  const split = prepareInventoryTransaction(save, { kind: 'transfer', id: 'split', expectedRevision: 1, itemId: 'potion', unitId: 'receiver', qty: 2 });
  expect(split.inventory![0]).toMatchObject({ qty: 4, assignedTo: 'owner', mechanics: old.mechanics });
  expect(split.inventory!.find(item => item.sourceItemId === 'potion')).toMatchObject({ qty: 2, assignedTo: 'receiver', name: old.name, note: old.note, mechanics: old.mechanics });
  expect(split.inventory!.filter(item => item.mechanics?.kind === 'item').reduce((sum, item) => sum + item.qty, 0)).toBe(6);
  const weapon = split.inventory!.find(item => item.equippedTo?.unitId === 'owner' && item.equippedTo.slot === 'primary')!;
  const next = prepareInventoryTransaction(split, { kind: 'transfer', id: 'weapon', expectedRevision: split.factRevision!, itemId: weapon.id, unitId: 'receiver', qty: 1 });
  expect(next.inventory!.find(item => item.id === weapon.id)).toMatchObject({ assignedTo: 'receiver', mechanics: weapon.mechanics });
  expect(next.inventory!.find(item => item.id === weapon.id)!.equippedTo).toBeUndefined();
  expect(next.storage!.find(record => record.id === 'owner')!.snapshot!.weapon).toBeUndefined();
  expect(next.storage!.find(record => record.id === 'receiver')!.snapshot!.weapon).toEqual(split.storage!.find(record => record.id === 'receiver')!.snapshot!.weapon);
});

it('give 可同时转给多个单位，每人各得qty且原库存扣除总量；超量整批回滚，不新建或重算属性', () => {
  const save = initial(), ids = narrativeIds(save), sourceId = ids.publicId('potion'), receiver = ids.publicId('receiver'), receiver2 = ids.publicId('receiver2');
  const p = proposal(save, `<give ${receiver} qty="2" id="${sourceId}" ${receiver2}/>`);
  expect(p.value.status).toBe('pending');
  expect(parseProtocol(p.value.canonical).events).toEqual(p.value.events);
  const next = prepareNarrativeTransaction(save, p.value, p.ns, true);
  const items = next.inventory!.filter(item => item.mechanics?.kind === 'item');
  expect(items.map(item => [item.qty, item.assignedTo])).toEqual([[2, 'owner'], [2, 'receiver'], [2, 'receiver2']]);
  expect(items.every(item => JSON.stringify(item.mechanics) === JSON.stringify(save.inventory![0]!.mechanics))).toBe(true);
  const over = proposal(save, `<add item="不能部分留下的物品"/><give id="${sourceId}" to="${receiver},${receiver2}" qty="4"/>`), before = structuredClone(save);
  expect(() => prepareNarrativeTransaction(save, over.value, over.ns, true)).toThrow(/总数量/);
  expect(save).toEqual(before);
  const different = proposal(save, `<give id="${sourceId}" to="${receiver}" qty="1"/><give id="${sourceId}" to="${receiver2}" qty="3"/>`);
  expect(prepareNarrativeTransaction(save, different.value, different.ns, true).inventory!.filter(item => item.mechanics?.kind === 'item').map(item => [item.qty, item.assignedTo])).toEqual([[2, 'owner'], [1, 'receiver'], [3, 'receiver2']]);
  const overdraft = proposal(save, `<give id="${sourceId}" to="${receiver}" qty="6"/><give id="${sourceId}" to="${receiver2}" qty="1"/>`);
  expect(() => prepareNarrativeTransaction(save, overdraft.value, overdraft.ns, true)).toThrow(/转移总数量/);
  expect(save).toEqual(before);
  const all = prepareInventoryTransaction(save, { kind: 'transfer', id: 'all', expectedRevision: 1, itemId: 'potion', unitIds: ['receiver', 'receiver2'], qty: 3 });
  expect(all.inventory!.filter(item => item.mechanics?.kind === 'item').map(item => [item.qty, item.assignedTo])).toEqual([[3, 'receiver2'], [3, 'receiver']]);
  expect(all.inventory!.find(item => item.id === 'potion')!.mechanics).toEqual(save.inventory![0]!.mechanics);
});

it('give 可交给同批新建的多个档案，省略接收编号时移回公共库存', () => {
  const save = initial(), p = proposal(save, '<give id="potion" to="u9,u10" qty="2"/><unit_set id="u9" name="新同伴甲" side="ally" scale="hero"/><unit_set id="u10" name="新同伴乙" side="ally" scale="hero"/>');
  const next = prepareNarrativeTransaction(save, p.value, p.ns, true);
  const recipients = next.storage!.filter(record => record.name.startsWith('新同伴'));
  expect(recipients).toHaveLength(2);
  for (const recipient of recipients) expect(next.inventory!.find(item => item.assignedTo === recipient.id && item.mechanics?.kind === 'item')!.qty).toBe(2);
  const back = prepareInventoryTransaction(next, { kind: 'transfer', id: 'public', expectedRevision: next.factRevision!, itemId: 'potion', qty: 1 });
  expect(back.inventory!.find(item => item.sourceItemId === 'potion' && !item.assignedTo)).toMatchObject({ qty: 1, mechanics: save.inventory![0]!.mechanics });
  expect(back.inventory!.find(item => item.id === 'potion')).toMatchObject({ qty: 1, assignedTo: 'owner' });
});

it('add 非法数量、库存溢出、give 超量或无效接收单位均拒绝，原库存与属性不变', () => {
  const save = initial(), before = structuredClone(save);
  for (const qty of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) expect(() => prepareInventoryTransaction(save, { kind: 'add', id: 'bad', expectedRevision: 1, itemId: 'potion', qty })).toThrow();
  for (const attrs of ['qty="0"', 'qty="1.5"', 'qty="-1"', 'qty="9007199254740992"']) expect(parseProtocol(`<add id="potion" ${attrs}/>`).errors.length).toBeGreaterThan(0);
  expect(() => prepareInventoryTransaction(save, { kind: 'transfer', id: 'over', expectedRevision: 1, itemId: 'potion', unitId: 'receiver', qty: 7 })).toThrow(/数量/);
  expect(() => prepareInventoryTransaction(save, { kind: 'transfer', id: 'missing', expectedRevision: 1, itemId: 'potion', unitId: 'missing', qty: 1 })).toThrow();
  expect(save).toEqual(before);
});

it('正文按短编号执行add、reforge与give，保存读回和重复扫描不重复增加或转移', async () => {
  const f = nativeFixture();
  try {
    await f.service.start();
    const save = initial(), ids = narrativeIds(save), itemId = ids.publicId('potion'), receiver = ids.publicId('receiver'), receiver2 = ids.publicId('receiver2');
    expect((await f.service.transact(() => save)).status).toBe('confirmed');
    f.context.chat!.push({ mes: `<tb><add id="${itemId}" qty="2"/><reforge id="${itemId}" spec="buff治疗L5"/><give id="${itemId}" to="${receiver},${receiver2}" qty="2"/></tb>`, is_user: false, swipe_id: 0, gen_finished: 'finished' });
    await f.service.scan();
    const p = f.service.snapshot().proposals!.at(-1)!;
    expect(p.status).toBe('pending');
    expect((await f.service.approve(p.id)).status).toBe('confirmed');
    const assertItems = () => {
      const items = f.service.snapshot().inventory!.filter(item => item.mechanics?.kind === 'item');
      expect(items.map(item => [item.qty, item.assignedTo])).toEqual([[4, 'owner'], [2, 'receiver'], [2, 'receiver2']]);
      expect(items.every(item => item.mechanics?.kind === 'item' && item.mechanics.value.recipe.power === 5)).toBe(true);
    };
    assertItems(); await f.service.load(); await f.service.scan(); assertItems();
  } finally { f.service.dispose(); }
});
