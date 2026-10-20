import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { createInventoryItem, prepareInventoryState, type InventoryItem } from './inventory-state.js';
import { narrativeIds } from './narrative-ids.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';

// unit_set 换上的装备如果就是同一回复 add 的那件、或库存里已有的那件，只算一件。
const reg = traitRegistry();
function setup(side: 'ally' | 'enemy' = 'ally', inventory: InventoryItem[] = []): NarrativeSave {
  const unit = generateUnit({ name: '阿尔萨斯', side, scale: 'hero', rulesVersion: 'v2', level: 4, traits: [], weaponClass: 'sword', weaponLevel: 3, weaponName: '长剑' }, { seed: 'stash-gear', registry: reg }).unit;
  unit.id = 'a';
  return prepareInventoryState({ storage: [unitRecordFromCombatant(unit)], rosterIds: [], factRevision: 1, storySync: true, inventory }) as NarrativeSave;
}
function transact(save: NarrativeSave, body: string, messageId = 'reply') {
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'b', messageId, swipeId: '0', role: 'assistant', complete: true, generationId: messageId, text: `<tb>${body}</tb>` };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, messageId); binding.complete = true;
  return prepareNarrativeTransaction(save, proposalFromMessage(source, binding)!, ns, true);
}
const named = (save: NarrativeSave, name: string) => save.inventory!.filter(i => i.name === name && i.qty > 0);
const weaponOf = (save: NarrativeSave) => save.inventory!.find(i => i.equippedTo?.unitId === 'a' && i.equippedTo.slot === 'primary')!;
const notices = (save: NarrativeSave) => save.proposals!.at(-1)!.notices?.join('；') ?? '';

describe('unit_set 换装与库存同一件实物', () => {
  it.each([false, true])('give 防具后按名称穿上同一件，保留冻结属性与旧装备，unit_set在前=%s', setFirst => {
    const armor = createInventoryItem('incoming-armor', '盔甲', { kind: 'armor', tier: 3, power: 5, profile: 'thermal', bonuses: { protection: 4 } }, 'original-armor');
    const save = setup('ally', [armor]), before = structuredClone(save), ids = narrativeIds(save);
    const give = `<give id="${ids.publicId(armor.id)}" to="u1"/>`, set = '<unit_set id="u1" armor="盔甲" note="穿上收到的防具"/>';
    const next = transact(save, setFirst ? set + give : give + set);
    expect(named(next, '盔甲')).toHaveLength(1);
    expect(next.inventory!.find(item => item.id === armor.id)).toMatchObject({ qty: 1, assignedTo: 'a', equippedTo: { unitId: 'a', slot: 'armor' }, mechanics: armor.mechanics });
    expect(next.storage![0]!.snapshot!.armor).toEqual(armor.mechanics!.value);
    const old = before.inventory!.find(item => item.equippedTo?.slot === 'armor')!;
    expect(next.inventory!.find(item => item.id === old.id)).toMatchObject({ mechanics: old.mechanics, assignedTo: 'a' });
    expect(next.inventory!.find(item => item.id === old.id)!.equippedTo).toBeUndefined();
    expect(next.storage![0]!.note).toBe('穿上收到的防具');
    expect(save).toEqual(before);
  });
  it('同批转来的防具优先于原有同名装备，重复规格不抹掉属性修正；reforge后再按编号穿上', () => {
    const armor = createInventoryItem('incoming-armor', '盔甲', { kind: 'armor', tier: 3, power: 5, bonuses: { protection: 4 } }, 'original-armor');
    let save = setup('ally', [armor]);
    const original = save.inventory!.find(item => item.equippedTo?.slot === 'armor')!;
    original.name = '盔甲'; if (original.mechanics?.kind === 'armor') original.mechanics.value.name = '盔甲';
    save = prepareInventoryState(save);
    const id = narrativeIds(save).publicId(armor.id);
    const next = transact(save, `<give id="${id}" to="u1"/><unit_set id="u1" armor="盔甲:重甲L5"/>`);
    expect(next.storage![0]!.snapshot!.armor).toEqual(armor.mechanics!.value);
    expect(next.inventory!.find(item => item.id === original.id)!.mechanics).toEqual(original.mechanics);
    const reforged = transact(save, `<unit_set id="u1" armor="${id}"/><give id="${id}" to="u1"/><reforge id="${id}" spec="重甲L6+5防护"/>`);
    expect(reforged.storage![0]!.snapshot!.armor).toMatchObject({ id: armor.id, recipe: { power: 6, bonuses: { protection: 5 } } });
    expect(named(reforged, '盔甲')).toHaveLength(2);
  });
  it('已转移的防具可交给同批新建单位或敌方，缺失名称与超量转移整批拒绝', () => {
    const armor = createInventoryItem('incoming-armor', '盔甲', { kind: 'armor', tier: 3, power: 5 }, 'original-armor');
    const save = setup('enemy', [armor]), id = narrativeIds(save).publicId(armor.id);
    const enemy = transact(save, `<give id="${id}" to="u1"/><unit_set id="u1" armor="盔甲"/>`);
    expect(enemy.storage![0]!.snapshot!.armor).toEqual(armor.mechanics!.value);
    const created = transact(save, `<give id="${id}" to="u9"/><unit_set id="u9" name="新守卫" side="ally" scale="hero" armor="盔甲"/>`);
    expect(created.storage!.find(unit => unit.name === '新守卫')!.snapshot!.armor).toEqual(armor.mechanics!.value);
    expect(named(created, '盔甲')).toHaveLength(1);
    const before = structuredClone(save);
    expect(() => transact(save, `<give id="${id}" to="u1"/><unit_set id="u1" armor="不存在的盔甲"/>`)).toThrow();
    expect(() => transact(save, `<give id="${id}" to="u1" qty="2"/><unit_set id="u1" armor="盔甲"/>`)).toThrow(/数量/);
    expect(save).toEqual(before);
  });
  it('接收防具不会延后不相关武器的unit_set，也不覆盖随后reforge的结果', () => {
    const armor = createInventoryItem('incoming-armor', '盔甲', { kind: 'armor', tier: 3, power: 5 }, 'original-armor');
    const save = setup('ally', [armor]), ids = narrativeIds(save), weapon = weaponOf(save);
    const next = transact(save, `<give id="${ids.publicId(armor.id)}" to="u1"/><unit_set id="u1" weapon="长剑:剑L3"/><reforge id="${ids.publicId(weapon.id)}" spec="剑L6"/>`);
    expect(weaponOf(next)).toMatchObject({ id: weapon.id, mechanics: { value: { recipe: { power: 6 } } } });
    expect(next.inventory!.find(item => item.id === armor.id)).toMatchObject({ assignedTo: 'a', mechanics: armor.mechanics });
    expect(next.inventory!.find(item => item.id === armor.id)!.equippedTo).toBeUndefined();
  });
  it('原生保存、读回与重扫保留转来的防具身份和属性，不重复入库', async () => {
    const f = nativeFixture();
    try {
      await f.service.start();
      const armor = createInventoryItem('incoming-armor', '盔甲', { kind: 'armor', tier: 3, power: 5, bonuses: { protection: 4 } }, 'original-armor');
      const save = setup('ally', [armor]), id = narrativeIds(save).publicId(armor.id);
      expect((await f.service.transact(() => save)).status).toBe('confirmed');
      f.context.chat!.push({ mes: `<tb><give id="${id}" to="u1"/><unit_set id="u1" armor="盔甲"/><deploy id="u1"/></tb>`, is_user: false, swipe_id: 0, gen_finished: 'finished' });
      await f.service.scan();
      expect((await f.service.approve(f.service.snapshot().proposals!.at(-1)!.id)).status).toBe('confirmed');
      await f.service.load(); await f.service.scan();
      const next = f.service.snapshot();
      expect(named(next, '盔甲')).toHaveLength(1);
      expect(next.storage![0]!.snapshot!.armor).toEqual(armor.mechanics!.value);
      expect(next.rosterIds).toEqual(['a']);
    } finally { f.service.dispose(); }
  });
  it('同一回复 add 后 unit_set 换上：只有一把，原武器卸下留在库存', () => {
    const save = setup(), oldWeapon = weaponOf(save);
    const next = transact(save, '<add item="霜之哀伤" spec="剑L7"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toHaveLength(1);
    const sword = weaponOf(next);
    expect(sword.name).toBe('霜之哀伤'); expect(sword.id).toMatch(/^loot-/); expect(sword.history).toBeUndefined();
    expect(next.storage![0]!.snapshot!.weapon).toMatchObject({ id: sword.id, name: '霜之哀伤' });
    expect(next.inventory!.find(i => i.id === oldWeapon.id)).toMatchObject({ name: '长剑', assignedTo: 'a' });
    expect(next.inventory!.find(i => i.id === oldWeapon.id)!.equippedTo).toBeUndefined();
    expect(notices(next)).toContain('阿尔萨斯换上库存里的「霜之哀伤」，原来的「长剑」卸下留在库存');
  });
  it('之前入库的同名实物直接换上，不另造一件；规格不同时按 unit_set 改造并留记录', () => {
    const stored = transact(setup(), '<add item="霜之哀伤" spec="剑L7"/>', 'loot');
    const id = named(stored, '霜之哀伤')[0]!.id;
    const same = transact(stored, '<unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(same, '霜之哀伤')).toEqual([expect.objectContaining({ id, equippedTo: { unitId: 'a', slot: 'primary' } })]);
    expect(weaponOf(same).history).toBeUndefined();
    const upgraded = transact(stored, '<unit_set id="u1" weapon="霜之哀伤:剑L8"/>');
    expect(named(upgraded, '霜之哀伤')).toHaveLength(1);
    expect(weaponOf(upgraded)).toMatchObject({ id, mechanics: { value: { recipe: { power: 8 } } } });
    expect(weaponOf(upgraded).history).toBeUndefined();
  });
  it('add 两把只换上一把，另一把留在库存', () => {
    const next = transact(setup(), '<add item="霜之哀伤" spec="剑L7" qty="2"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toHaveLength(2);
    expect(named(next, '霜之哀伤').filter(i => i.equippedTo)).toHaveLength(1);
  });
  it('改的就是手上这件时原位修改，同一回复的同名 add 不另外入库', () => {
    const next = transact(setup(), '<add item="长剑" spec="剑L4"/><unit_set id="u1" weapon="长剑:剑L4"/>');
    expect(named(next, '长剑')).toHaveLength(1);
    expect(weaponOf(next).mechanics).toMatchObject({ value: { recipe: { power: 4 } } });
    expect(notices(next)).toContain('同一回复 add 的「长剑」就是阿尔萨斯身上的这件');
  });
  it('没写名字时认同一回复 add 的同规格实物，名字用 add 的', () => {
    const next = transact(setup(), '<add item="精钢剑" spec="剑L6"/><unit_set id="u1" weapon="剑L6"/>');
    expect(weaponOf(next).name).toBe('精钢剑');
    expect(named(next, '精钢剑')).toHaveLength(1); expect(named(next, '长剑')).toHaveLength(1);
  });
  it('只写名字的叙事记录补上规格后装备', () => {
    const next = transact(setup(), '<add item="霜之哀伤" note="王子的佩剑"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toEqual([expect.objectContaining({ note: '王子的佩剑', equippedTo: { unitId: 'a', slot: 'primary' } })]);
  });
  it('卸下装备时同一回复 add 的同名物品就是卸下的这件', () => {
    const next = transact(setup(), '<add item="长剑" spec="剑L3"/><unit_set id="u1" weapon=""/>');
    expect(named(next, '长剑')).toHaveLength(1); expect(named(next, '长剑')[0]!.equippedTo).toBeUndefined();
  });
  it('别的单位装备着的、或属于别的单位的同名实物不会被拿走', () => {
    const save = setup(), other = { ...weaponOf(save), id: 'other-sword', name: '霜之哀伤', assignedTo: 'b', equippedTo: undefined };
    other.mechanics = structuredClone(other.mechanics);
    if (other.mechanics?.kind === 'weapon') { other.mechanics.value.id = 'other-sword'; other.mechanics.value.name = '霜之哀伤'; }
    const next = transact({ ...save, inventory: [...save.inventory!, other] }, '<unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(next.inventory!.find(i => i.id === 'other-sword')).toMatchObject({ assignedTo: 'b' });
    expect(named(next, '霜之哀伤')).toHaveLength(2);
  });
  it('敌方单位换装不动我方库存，与之前相同', () => {
    const next = transact(setup('enemy'), '<add item="霜之哀伤" spec="剑L7"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toHaveLength(2);
    expect(named(next, '霜之哀伤').filter(i => !i.assignedTo)).toHaveLength(1);
    expect(named(next, '长剑')).toHaveLength(0);
  });
});
