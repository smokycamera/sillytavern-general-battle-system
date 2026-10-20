import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { prepareInventoryState, type InventoryItem } from './inventory-state.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';

// unit_set 换上的装备如果就是同一回复 give 的那件、或库存里已有的那件，只算一件。
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
  it('同一回复 give 后 unit_set 换上：只有一把，原武器卸下留在库存', () => {
    const save = setup(), oldWeapon = weaponOf(save);
    const next = transact(save, '<give item="霜之哀伤" spec="剑L7"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toHaveLength(1);
    const sword = weaponOf(next);
    expect(sword.name).toBe('霜之哀伤'); expect(sword.id).toMatch(/^loot-/); expect(sword.history).toBeUndefined();
    expect(next.storage![0]!.snapshot!.weapon).toMatchObject({ id: sword.id, name: '霜之哀伤' });
    expect(next.inventory!.find(i => i.id === oldWeapon.id)).toMatchObject({ name: '长剑', assignedTo: 'a' });
    expect(next.inventory!.find(i => i.id === oldWeapon.id)!.equippedTo).toBeUndefined();
    expect(notices(next)).toContain('阿尔萨斯换上库存里的「霜之哀伤」，原来的「长剑」卸下留在库存');
  });
  it('之前入库的同名实物直接换上，不另造一件；规格不同时按 unit_set 改造并留记录', () => {
    const stored = transact(setup(), '<give item="霜之哀伤" spec="剑L7"/>', 'loot');
    const id = named(stored, '霜之哀伤')[0]!.id;
    const same = transact(stored, '<unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(same, '霜之哀伤')).toEqual([expect.objectContaining({ id, equippedTo: { unitId: 'a', slot: 'primary' } })]);
    expect(weaponOf(same).history).toBeUndefined();
    const upgraded = transact(stored, '<unit_set id="u1" weapon="霜之哀伤:剑L8"/>');
    expect(named(upgraded, '霜之哀伤')).toHaveLength(1);
    expect(weaponOf(upgraded)).toMatchObject({ id, mechanics: { value: { recipe: { power: 8 } } } });
    expect(weaponOf(upgraded).history).toBeUndefined();
  });
  it('give 两把只换上一把，另一把留在库存', () => {
    const next = transact(setup(), '<give item="霜之哀伤" spec="剑L7" qty="2"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toHaveLength(2);
    expect(named(next, '霜之哀伤').filter(i => i.equippedTo)).toHaveLength(1);
  });
  it('改的就是手上这件时原位修改，同一回复的同名 give 不另外入库', () => {
    const next = transact(setup(), '<give item="长剑" spec="剑L4"/><unit_set id="u1" weapon="长剑:剑L4"/>');
    expect(named(next, '长剑')).toHaveLength(1);
    expect(weaponOf(next).mechanics).toMatchObject({ value: { recipe: { power: 4 } } });
    expect(notices(next)).toContain('同一回复 give 的「长剑」就是阿尔萨斯身上的这件');
  });
  it('没写名字时认同一回复 give 的同规格实物，名字用 give 的', () => {
    const next = transact(setup(), '<give item="精钢剑" spec="剑L6"/><unit_set id="u1" weapon="剑L6"/>');
    expect(weaponOf(next).name).toBe('精钢剑');
    expect(named(next, '精钢剑')).toHaveLength(1); expect(named(next, '长剑')).toHaveLength(1);
  });
  it('只写名字的叙事记录补上规格后装备', () => {
    const next = transact(setup(), '<give item="霜之哀伤" note="王子的佩剑"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toEqual([expect.objectContaining({ note: '王子的佩剑', equippedTo: { unitId: 'a', slot: 'primary' } })]);
  });
  it('卸下装备时同一回复 give 的同名物品就是卸下的这件', () => {
    const next = transact(setup(), '<give item="长剑" spec="剑L3"/><unit_set id="u1" weapon=""/>');
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
    const next = transact(setup('enemy'), '<give item="霜之哀伤" spec="剑L7"/><unit_set id="u1" weapon="霜之哀伤:剑L7"/>');
    expect(named(next, '霜之哀伤')).toHaveLength(2);
    expect(named(next, '霜之哀伤').filter(i => !i.assignedTo)).toHaveLength(1);
    expect(named(next, '长剑')).toHaveLength(0);
  });
});
