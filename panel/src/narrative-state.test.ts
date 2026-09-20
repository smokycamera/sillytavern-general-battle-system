import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, activeTraitIds, applyXp } from '../../engine/src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
const reg = traitRegistry();
function setup(body: string) {
  const u = generateUnit({ name: 'A军团', side: 'ally', scale: 'company', level: 4, traits: [] }, { seed: 'narrative', registry: reg }).unit;
  u.id = 'a'; u.hp = 70; u.base.hpMax = 560;
  const save: NarrativeSave = { storage: [unitRecordFromCombatant(u)], rosterIds: [], factRevision: 1, storySync: true };
  const source: MessageEnvelope = { characterId: 'char', chatId: 'chat', branchId: 'main', messageId: '10', swipeId: '0', role: 'assistant', complete: true, generationId: 'g1', text: `<tb>${body}</tb>` };
  const ns = namespaceOf(source); const binding = captureGeneration(save, ns, 'g1'); binding.complete = true;
  return { save, source, ns, proposal: proposalFromMessage(source, binding)! };
}
describe('正文原子事务', () => {
  it('正文按实物id扣减，超量整批回滚且不能重复提交', () => {
    const { save, ns, proposal } = setup('<take id="herb" qty="2" note="交出药草"/>');
    save.inventory = [{ id: 'herb', name: '药草', qty: 3, lootType: 'material' }];
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    expect(next.inventory!.find((i) => i.id === 'herb')!.qty).toBe(1);
    expect(save.inventory[0]!.qty).toBe(3);
    expect(() => prepareNarrativeTransaction(next, proposal, ns, true)).toThrow();
    save.inventory[0]!.qty = 1;
    expect(() => prepareNarrativeTransaction(save, proposal, ns, true)).toThrow(/数量/);
    expect(save.inventory[0]!.qty).toBe(1);
  });
  it('分多批累积超量部署也被拒绝；不合并旧身份，仍允许原档治疗和合法编队人数', () => {
    const { save, ns, source } = setup('');
    const base = structuredClone(save.storage![0]!);
    save.storage = Array.from({ length: 40 }, (_, n) => ({ ...structuredClone(base), id: 'unit-' + n, snapshot: { ...structuredClone(base.snapshot!), id: 'unit-' + n } }));
    save.rosterIds = save.storage.slice(0, 32).map((r) => r.id);
    const before = structuredClone(save), binding = captureGeneration(save, ns, 'g1'); binding.complete = true;
    const proposal = proposalFromMessage({ ...source, text: '<tb><unit_update id="unit-0" hp="500"/><deploy id="unit-32"/></tb>' }, binding)!;
    expect(() => prepareNarrativeTransaction(save, proposal, ns, true)).toThrow(/33|上限/);
    expect(save).toEqual(before);
    const repair = proposalFromMessage({ ...source, text: '<tb><unit_update id="unit-0" hp="500"/></tb>' }, binding)!;
    const next = prepareNarrativeTransaction(save, repair, ns, true);
    expect(next.storage![0]!.hp).toBe(500); expect(next.storage).toHaveLength(40); expect(next.rosterIds).toHaveLength(32);
    const large = setup('<spawn name="师团" side="enemy" scale="company" hpMax="10000"/>');
    expect(prepareNarrativeTransaction(large.save, large.proposal, large.ns, true).storage!.at(-1)).toMatchObject({ hp: 10000, base: { hpMax: 10000 } });
  });
  it('正文短技能和明确预备份额生成可恢复执行配方，坏控制参数拒绝', () => {
    const { save, proposal, ns } = setup('<spawn name="术士" side="ally" scale="company" hpMax="30" level="3" reserves="1" skills="缠根:束缚术L7,净化L6,呼叫援军"/>');
    const next = prepareNarrativeTransaction(save, proposal, ns, true), record = next.storage!.find((r) => r.name === '术士')!;
    const restored = materializeUnitRecord(JSON.parse(JSON.stringify(record)), reg);
    expect(restored.resources.reserve).toBe(1); expect(restored.abilities[0]!.effects[0]).toMatchObject({ op: 'condition', conditionId: 'restrained', saveDC: 12 });
    expect(restored.abilities[1]!.effects[0]).toMatchObject({ op: 'dispel', count: 2 }); expect(restored.abilities[2]!.fixedPower).toBe(true);
    expect(restored.preparedAbilityIds).toHaveLength(3); expect(restored.abilities).toHaveLength(3);
    const bad = JSON.parse(JSON.stringify(record)); bad.snapshot.abilities[0].effects[0].saveDC = 'bad';
    expect(() => materializeUnitRecord(bad, reg)).toThrow(/参数损坏/);
  });

  it('车辆稳定和专项护甲通过正文创建，改造保留明确配置且不误用骑射', () => {
    const { save, proposal, ns, source } = setup('<spawn name="装甲车" side="ally" scale="company" hpMax="20" level="3" body="vehicle" stabilized="true" protection="thermal" weapon="车炮:火炮L5" armor="隔热车体:重甲L7"/>');
    const next = prepareNarrativeTransaction(save, proposal, ns, true), record = next.storage!.find((r) => r.name === '装甲车')!;
    expect(record.snapshot!.weapon!.recipe).toMatchObject({ stabilized: true, size: 'vehicle', version: 'mechanism-v2.3' });
    expect(record.snapshot!.armor!.recipe!.protectionProfile).toBe('thermal');
    const binding = captureGeneration(next, ns, 'reforge'); binding.complete = true;
    const message = { ...source, messageId: 'reforge', generationId: 'reforge', text: `<tb><reforge id="${record.snapshot!.weapon!.id}" name="新车炮" spec="火炮L6"/><reforge id="${record.snapshot!.armor!.id}" name="重铸车体" spec="重甲L8"/></tb>` };
    const upgraded = prepareNarrativeTransaction(next, proposalFromMessage(message, binding)!, ns, true);
    const reopened = materializeUnitRecord(JSON.parse(JSON.stringify(upgraded.storage!.find((r) => r.id === record.id)!)), reg);
    expect(reopened.weapon!.recipe).toMatchObject({ stabilized: true, power: 6 }); expect(reopened.armor!.recipe).toMatchObject({ protectionProfile: 'thermal', power: 8 }); expect(reopened.hp).toBe(20);
  });

  it('正文骑乘和轻型副武器真实生成，档案重开与训练升级不丢平台或重掷装备', () => {
    const { save, proposal, ns } = setup('<spawn name="骑射队" side="ally" scale="company" hpMax="80" level="3" mount="true" weapon="战弓:弓弩L5" weapon2="手弩:轻型投射L3" traits="骑射,远近双全"/>');
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    const record = next.storage!.find((r) => r.name === '骑射队')!, unit = materializeUnitRecord(record, reg);
    expect(unit.mount).toBe(true); expect(unit.tags).not.toContain('mounted'); expect(unit.sidearm).toMatchObject({ hands: 1, load: 1, range: 2 });
    const gear = structuredClone(unit.sidearm);
    applyXp(unit, 9999, reg);
    const restored = materializeUnitRecord(unitRecordFromCombatant(unit), reg);
    expect(restored.mount).toBe(true); expect(restored.sidearm).toEqual(gear); expect(restored.base.hpMax).toBe(80);
  });

  it('森林与夜间同批固化为下一战场景，战内拒绝且旧绑定不能覆盖新场景', () => {
    const { save, proposal, ns } = setup('<field env="forest" light="night"/>');
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    expect(next).toMatchObject({ field: 'forest', lighting: 'night', factRevision: 2 }); expect(save.field).toBeUndefined();
    expect(() => prepareNarrativeTransaction({ ...save, battle: { kind: 'small', snap: { seed: 'in-progress' } } }, proposal, ns, true)).toThrow(/战内/);
    expect(() => prepareNarrativeTransaction(next, proposal, ns, true)).toThrow(/过期|已经/);
  });
  it('诅咒与部署先全批校验再提交，解除只针对该来源，错误批次不留半个状态', () => {
    const { save, source, ns } = setup('');
    const u = generateUnit({ name: '试验编队', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 3, hp: 70, hpMax: 560, traits: [] }, { seed: 'effect-transaction', registry: reg }).unit;
    u.id = 'a'; save.storage = [unitRecordFromCombatant(u)];
    const prepare = (state: NarrativeSave, text: string, id: string) => {
      const message = { ...source, messageId: id, text: `<tb>${text}</tb>` };
      const binding = captureGeneration(state, ns, 'g1'); binding.complete = true;
      return prepareNarrativeTransaction(state, proposalFromMessage(message, binding)!, ns, true);
    };
    expect(() => prepare(save, '<affect id="a" effects="诅咒" battles="2"/><deploy id="missing"/>', 'bad')).toThrow();
    expect(save.storage[0]!.snapshot!.traitSources).toBeUndefined();
    const next = prepare(save, '<deploy id="a"/><affect id="a" effects="诅咒,士气低下" battles="2"/>', 'effect');
    expect(next.rosterIds).toEqual(['a']); expect(next.storage![0]).toMatchObject({ hp: 70, base: { hpMax: 560 } });
    const effect = next.storage![0]!.snapshot!.traitSources![0]!;
    expect(effect).toMatchObject({ kind: 'effect', conditionIds: ['cursed', 'demoralized'], remaining: 2 });
    expect(() => prepare(next, '<unaffect id="a" source="unknown"/>', 'missing')).toThrow(/来源/);
    expect(() => prepare(next, `<unbless id="a" source="${effect.id}"/>`, 'wrong')).toThrow(/来源/);
    const cleared = prepare(next, `<unaffect id="a" source="${effect.id}"/>`, 'clear');
    expect(cleared.storage![0]!.snapshot!.traitSources![0]!.revoked).toBe(true);
    expect(next.storage![0]!.snapshot!.traitSources![0]!.revoked).toBeUndefined();
  });
  it('有来源祝福与同批部署原子生效，不改人数/永久特质，重放与越权撤销拒绝', () => {
    const { save, source, ns } = setup('');
    const unit = generateUnit({ rulesVersion: 'v2', name: '军团', side: 'ally', scale: 'company', level: 3, hp: 70, hpMax: 560, traits: [], weaponClass: 'rifle' }, { seed: 'blessed-company', registry: reg }).unit;
    unit.id = 'a'; save.storage = [unitRecordFromCombatant(unit)];
    source.text = '<tb><deploy id="a"/><bless id="a" name="神灵庇佑" traits="大守护" battles="2"/></tb>';
    const binding = captureGeneration(save, ns, 'g1'); binding.complete = true;
    const proposal = proposalFromMessage(source, binding)!;
    expect(() => prepareNarrativeTransaction(save, proposal, ns)).toThrow(/审查/);
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    const deployed = materializeUnitRecord(next.storage![0]!, reg);
    expect(deployed.hp).toBe(70); expect(deployed.traits).toEqual([]); expect(activeTraitIds(deployed)).toEqual(['guardian-greater']);
    expect(deployed.traitSources![0]).toMatchObject({ name: '神灵庇佑', remaining: 2, kind: 'blessing' });
    expect(() => prepareNarrativeTransaction(next, proposal, ns, true)).toThrow();
    expect(save.storage![0]!.snapshot!.traitSources).toBeUndefined();
  });
  it('正文改造已装备大炮与同批部署使用新机制，重复消息不再改造', () => {
    const { save, source, ns } = setup('');
    const unit = generateUnit({ rulesVersion: 'v2', body: 'vehicle', name: '炮队', side: 'ally', scale: 'company', level: 3, hp: 70, hpMax: 560, traits: [], weaponClass: 'cannon', weaponLevel: 6 }, { seed: 'cannon', registry: reg }).unit;
    unit.id = 'a'; save.storage = [unitRecordFromCombatant(unit)];
    source.text = `<tb><deploy id="a"/><reforge id="${unit.weapon!.id}" spec="火炮L8" enchant="arcane" name="附魔大炮"/></tb>`;
    const binding = captureGeneration(save, ns, 'g1'); binding.complete = true;
    const proposal = proposalFromMessage(source, binding)!;
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    expect(next.rosterIds).toEqual(['a']);
    expect(materializeUnitRecord(next.storage![0]!, reg).weapon).toMatchObject({ id: unit.weapon!.id, name: '附魔大炮', channel: 'arcane', level: 8 });
    expect(next.storage![0]).toMatchObject({ hp: 70, base: { hpMax: 560 }, level: 3 });
    expect(next.inventory!.find((i) => i.id === unit.weapon!.id)!.history).toHaveLength(1);
    expect(() => prepareNarrativeTransaction(next, proposal, ns, true)).toThrow();
    expect(save.storage![0]!.snapshot!.weapon).toEqual(unit.weapon);
  });
  it('正文装备按件建档，失败重试不重掷，未知物品保留叙事记录', () => {
    const { save, proposal, ns } = setup('<give item="制式剑" type="weapon" spec="剑L4" qty="2"/><give item="急救剂" type="consumable" spec="治疗L3" qty="3"/><give item="未知遗物"/>');
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    const weapons = next.inventory!.filter((i) => i.mechanics?.kind === 'weapon');
    expect(weapons).toHaveLength(2); expect(new Set(weapons.map((i) => i.id)).size).toBe(2);
    expect(next.inventory!.find((i) => i.name === '急救剂')).toMatchObject({ qty: 3, mechanics: { kind: 'consumable' } });
    expect(next.inventory!.find((i) => i.name === '未知遗物')!.mechanics).toBeUndefined();
    expect(prepareNarrativeTransaction(save, proposal, ns, true)).toEqual(next);
  });
  it.each([
    '<deploy id="a"/><unit_update id="a" hp="500"/>',
    '<unit_update id="a" hp="500"/><deploy id="a"/>',
  ])('update+deploy 不受标签顺序影响且保留装备：%s', (body) => {
    const { save, proposal, ns } = setup(body);
    const next = prepareNarrativeTransaction(save, proposal, ns);
    expect(next.storage?.[0]?.hp).toBe(500); expect(next.rosterIds).toEqual(['a']);
    expect(materializeUnitRecord(next.storage![0]!, reg).weapon).toEqual(save.storage![0]!.snapshot?.weapon);
    expect(save.storage?.[0]?.hp).toBe(70);
    expect(() => prepareNarrativeTransaction(next, proposal, ns)).toThrow();
  });
  it('错误部署不留下前面的补员/物品半批状态', () => {
    const { save, proposal, ns } = setup('<unit_update id="a" hp="500"/><give item="药"/><deploy id="missing"/>');
    const before = structuredClone(save);
    expect(() => prepareNarrativeTransaction(save, proposal, ns, true)).toThrow(); expect(save).toEqual(before);
  });
  it('新单位 count=2，每支 560 人，身份不同且重试复现同装备', () => {
    const { save, proposal, ns } = setup('<spawn name="增援" side="ally" scale="company" hpMax="560" count="2"/>');
    expect(() => prepareNarrativeTransaction(save, proposal, ns)).toThrow('人工审查');
    const next = prepareNarrativeTransaction(save, proposal, ns, true);
    expect(next.storage!.slice(1).map((r) => [r.hp, r.base.hpMax])).toEqual([[560, 560], [560, 560]]);
    expect(new Set(next.storage!.map((r) => r.id)).size).toBe(3);
    expect(prepareNarrativeTransaction(save, proposal, ns, true)).toEqual(next);
  });
  it('版本/聊天/战内/消息来源守卫拒绝覆盖', () => {
    const { save, proposal, ns, source } = setup('<unit_update id="a" hp="500"/>');
    expect(() => prepareNarrativeTransaction({ ...save, factRevision: 2 }, proposal, ns)).toThrow('过期');
    expect(() => prepareNarrativeTransaction(save, proposal, 'different')).toThrow('其他聊天');
    expect(() => prepareNarrativeTransaction({ ...save, battle: { kind: 'small', snap: { seed: 's' } } }, proposal, ns)).toThrow('战内');
    expect(proposalFromMessage({ ...source, role: 'user' }, proposal.expected)?.status).toBe('legacy');
    expect(proposalFromMessage({ ...source, complete: false }, proposal.expected)?.status).toBe('legacy');
    expect(proposalFromMessage(source)?.status).toBe('legacy');
  });
});
