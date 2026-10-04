import { describe, expect, it } from 'vitest';
import { activeTraitIds, generateUnit, traitRegistry } from '../../engine/src/index.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { parseProtocol } from './protocol.js';
import { parseItemSpecification } from './item-spec.js';
import { prepareInventoryState } from './inventory-state.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';

const id = 'unit-34e891c9-53f5-4b2f-8279-cc9eb51d8b89-2-0';
const leaderId = 'unit-34e891c9-53f5-4b2f-8279-cc9eb51d8b89-1-0';
const itemId = `unit:${id}:primary`;
const update = `<unit_update id="${id}" hp="50" hpMax="50"/>`;
const reforge = `<reforge id="${itemId}" name="缴获制式步枪与轻机枪" spec="步枪:步枪L4+1伤害"/>`;
const set = `<unit_set id="${id}" level="3" note="换装缴获军械，主力突击队"/>`;
const deploy = `<deploy id="${id}"/>`;
const original = `<tb>
<field env="siege" light="day"/>
${update}
${reforge}
${set}
<deploy id="${leaderId}"/>
${deploy}
<spawn name="城防守备队" side="enemy" scale="company" hpMax="45" level="2" weapon="老旧制式步枪:步枪L3" weapon2="马克沁重机枪:火枪L4" armor="土木工事与棉甲:轻甲L2" traits="守城工事,顽固"/>
<spawn name="外围地堡哨卡" side="enemy" scale="company" hpMax="15" level="2" weapon="轻机枪:火枪L4" armor="土木掩体:中甲L3" traits="守城工事"/>
</tb>`;
const registry = traitRegistry();
function setup(text: string, managed = false) {
  const unit = generateUnit({ rulesVersion: 'v2', damageModel: 'wounds-v2', name: '红石游击连', side: 'ally', scale: 'company', level: 2, hp: 20, hpMax: 30, traits: [], weaponClass: 'rifle', weaponLevel: 3 }, { seed: 'reforge-deploy', registry }).unit;
  unit.id = id; unit.weapon!.id = itemId;
  const leader = generateUnit({ rulesVersion: 'v2', damageModel: 'wounds-v2', name: '李华', side: 'ally', scale: 'hero', level: 3, traits: [] }, { seed: 'reforge-leader', registry }).unit;
  leader.id = leaderId;
  let save: NarrativeSave = { storage: [unitRecordFromCombatant(unit), unitRecordFromCombatant(leader)], rosterIds: [], factRevision: 1, storySync: true };
  if (managed) save = prepareInventoryState(save);
  const source: MessageEnvelope = { characterId: 'char', chatId: 'chat', branchId: 'main', messageId: '10', swipeId: '0', role: 'assistant', complete: true, generationId: 'g1', text };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, 'g1'); binding.complete = true;
  return { save, ns, proposal: proposalFromMessage(source, binding)! };
}
function permutations<T>(values: T[]): T[][] {
  return values.length ? values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest])) : [[]];
}
function assertUpdated(next: NarrativeSave) {
  const record = next.storage!.find(record => record.id === id)!;
  expect(record).toMatchObject({ hp: 50, base: { hpMax: 50 }, level: 3, note: '换装缴获军械，主力突击队' });
  expect(next.rosterIds).toContain(id);
  const restored = materializeUnitRecord(record, registry);
  expect(restored.weapon).toMatchObject({ id: itemId, name: '缴获制式步枪与轻机枪', level: 4, recipe: { mechanism: 'rifle', bonuses: { damage: 1 } } });
  expect(next.inventory!.filter(item => item.id === itemId)).toHaveLength(1);
  expect(next.inventory!.find(item => item.id === itemId)).toMatchObject({ equippedTo: { unitId: id, slot: 'primary' }, revision: 2 });
  expect(next.inventory!.find(item => item.id === itemId)!.history).toHaveLength(1);
}

describe('named reforge specifications and pre-deployment batches', () => {
  it('parses all eight events in the reported siege block', () => {
    const parsed = parseProtocol(original);
    expect(parsed.errors).toEqual([]);
    expect(parsed.events).toHaveLength(8);
    expect(parsed.events.find(event => event.kind === 'reforge')).toMatchObject({ kind: 'reforge', id: itemId, name: '缴获制式步枪与轻机枪', spec: { kind: 'weapon', mechanism: 'rifle', power: 4, bonuses: { damage: 1 } } });
    expect(parseProtocol(parsed.canonical).events).toEqual(parsed.events);
  });
  it.each([false, true])('commits the complete original block with managed equipment=%s', managed => {
    const { save, ns, proposal } = setup(original, managed), before = structuredClone(save);
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    assertUpdated(next);
    expect(next).toMatchObject({ field: 'siege', lighting: 'day', factRevision: 2 });
    expect(next.rosterIds).toHaveLength(4);
    expect(next.storage!.filter(record => record.side === 'enemy').map(record => record.hp)).toEqual([45, 15]);
    assertUpdated(prepareInventoryState(JSON.parse(JSON.stringify(next))));
    expect(save).toEqual(before);
    expect(prepareNarrativeTransaction(save, proposal, ns, true)).toEqual(next);
    expect(() => prepareNarrativeTransaction(next, proposal, ns, true)).toThrow();
  });
  it.each(permutations([update, reforge, set, deploy]).map((events, index) => [index + 1, events] as const))('uses final records in all four-event permutations: %s', (_index, events) => {
    const { save, ns, proposal } = setup(`<tb>${events.join('')}</tb>`, true);
    assertUpdated(prepareNarrativeTransaction(save, proposal, ns, true));
  });
  it.each([':', '：', '·', '|', '｜', '/', '／'])('accepts explicit item-name separator %s without guessing mechanics', separator => {
    expect(parseItemSpecification(`制式步枪${separator}步枪 L4+1伤害`)).toMatchObject({ kind: 'weapon', mechanism: 'rifle', power: 4, bonuses: { damage: 1 } });
    expect(parseItemSpecification(`精制板甲${separator}重甲L3+2防护`)).toMatchObject({ kind: 'armor', tier: 3, power: 3, bonuses: { protection: 2 } });
    expect(parseItemSpecification(`圆盾${separator}盾L2+1防御`)).toMatchObject({ kind: 'shield', power: 2, bonuses: { defense: 1 } });
    expect(parseItemSpecification(`药瓶${separator}治疗L3`)).toMatchObject({ kind: 'consumable', mechanism: 'heal', power: 3 });
  });
  it('preserves punctuation inside an explicit name before the colon', () => {
    expect(parseItemSpecification('制式·甲型/乙型:步枪L4')).toMatchObject({ kind: 'weapon', mechanism: 'rifle', power: 4 });
  });
  it('normalizes narrative typography and uses embedded names only when an explicit name is absent', () => {
    const parsed = parseProtocol(`<tb><REFORGE ref='${itemId}' spec='新步枪：步枪Ｌ４＋１伤害'/></tb>`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ name: '新步枪', spec: { power: 4, bonuses: { damage: 1 } } });
    expect(parseProtocol(`<reforge id="${itemId}" name="明确名称" spec="旧前缀:步枪L4"/>`).events[0]).toMatchObject({ name: '明确名称' });
    expect(parseProtocol(`<reforge id="${itemId}" spec="步枪L4"/>`).events[0]).toMatchObject({ name: undefined });
  });
  it.each(['步枪:胡编机制L4', '步枪:步枪L11', '步枪:步枪L4+11伤害', '步枪:步枪L4+1击退', '药:治疗L3', '步枪:步枪L4,剑L3', '步枪:'])('rejects invalid or ambiguous reforge %s', spec => {
    const parsed = parseProtocol(`<reforge id="${itemId}" spec="${spec}"/>`);
    expect(parsed.errors.length).toBeGreaterThan(0); expect(parsed.events).toEqual([]);
    expect(parsed.errors.join('')).not.toBe('reforge 字段或规格无法解析');
  });
  it('supports complementary unit_set records as well as unit_update', () => {
    const body = `${deploy}${update}<unit_set id="${id}" level="3"/><unit_set id="${id}" note="换装缴获军械，主力突击队"/>${reforge}`;
    const { save, ns, proposal } = setup(body);
    assertUpdated(prepareNarrativeTransaction(save, proposal, ns, true));
  });
  it.each([
    `<unit_update id="${id}" hp="25"/><unit_set id="${id}" hp="24"/>`,
    `<unit_set id="${id}" level="3"/><unit_set id="${id}" level="4"/>`,
    `<unit_update id="${id}" hpMax="40"/><unit_set id="${id}" data='{"base":{"hpMax":50}}'/>`,
  ])('does not silently overwrite contradictory absolute updates: %s', body => {
    const { save, ns, proposal } = setup(body + deploy), before = structuredClone(save);
    expect(() => prepareNarrativeTransaction(save, proposal, ns, true)).toThrow(/冲突/);
    expect(save).toEqual(before);
  });
  it('applies supported morale/state/condition updates before deployment', () => {
    const body = `${deploy}<unit_update id="${id}" morale="0"/><unit_update id="${id}" state="ready" clear="all"/>`;
    const { save, ns, proposal } = setup(body);
    expect(proposal.status).toBe('pending');
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    expect(next.storage!.find(record => record.id === id)).toMatchObject({ morale: 0, status: 'ready' });
    expect(materializeUnitRecord(next.storage![0]!, registry).conditions).toEqual([]);
    expect(parseProtocol(proposal.canonical).events).toEqual(proposal.events);
  });
  it.each(['morale="-1"', 'state="typo"', 'morale="1.5"'])('rejects invalid update fields %s', attrs => {
    expect(parseProtocol(`<unit_update id="${id}" hp="20" ${attrs}/>`).errors.length).toBeGreaterThan(0);
  });
  it.each([false, true])('applies blessings and skills before deployment, deployFirst=%s', deployFirst => {
    const edits = `<learn id="${id}" skills="精确射击:物理单体L3"/><bless id="${id}" name="鼓舞" traits="大守护" battles="2"/>`;
    const { save, ns, proposal } = setup(deployFirst ? deploy + edits : edits + deploy);
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    const unit = materializeUnitRecord(next.storage![0]!, registry);
    expect(unit.abilities.some(ability => ability.name === '精确射击')).toBe(true);
    expect(activeTraitIds(unit)).toContain('guardian-greater');
    expect(next.rosterIds).toEqual([id]);
  });
  it('rolls back the whole batch if the equipment reference is missing', () => {
    const { save, ns, proposal } = setup(`${update}${set}${deploy}<reforge id="missing-item" spec="步枪:步枪L4"/>`), before = structuredClone(save);
    expect(() => prepareNarrativeTransaction(save, proposal, ns, true)).toThrow(/物品不存在/);
    expect(save).toEqual(before);
  });
  it('still rejects stale records and live-battle narrative writes', () => {
    const { save, ns, proposal } = setup(`${update}${set}${reforge}${deploy}`);
    expect(() => prepareNarrativeTransaction({ ...save, factRevision: 9 }, proposal, ns, true)).toThrow(/过期/);
    expect(() => prepareNarrativeTransaction({ ...save, battle: { kind: 'small', snap: { seed: 'live' } } }, proposal, ns, true)).toThrow(/战内/);
  });
});


it.each(['metadata-only', 'legacy-full'])('native scan/approve/reload preserves the complete batch under %s saves', async mode => {
  const f = nativeFixture();
  if (mode === 'legacy-full') f.context.saveMetadata = f.saveNormally;
  try {
    await f.service.start();
    const { save } = setup(original, true);
    expect((await f.service.transact(() => save)).status).toBe('confirmed');
    f.context.chat!.push({ mes: original, is_user: false, swipe_id: 0, gen_finished: 'finished' });
    await f.service.scan();
    const proposal = f.service.snapshot().proposals!.at(-1)!;
    expect(proposal.status).toBe('pending'); expect(proposal.events).toHaveLength(8);
    expect((await f.service.approve(proposal.id)).status).toBe('confirmed');
    assertUpdated(f.service.snapshot());
    await f.service.load();
    assertUpdated(f.service.snapshot());
    await f.service.scan();
    expect(f.service.snapshot().storage).toHaveLength(4);
    assertUpdated(f.service.snapshot());
  } finally { f.service.dispose(); }
});
