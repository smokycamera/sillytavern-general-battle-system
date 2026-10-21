import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, learnAbilities } from '../../engine/src/index.js';
import { unitRecordFromCombatant, editUnitRecord, forgetUnitRecordSkills, materializeUnitRecord } from './unit-state.js';
import { captureGeneration, namespaceOf, proposalFromMessage, prepareNarrativeTransaction, type NarrativeSave } from './narrative-state.js';
const registry = traitRegistry();
function initial() {
  const unit = generateUnit({ name: '学员', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 4, hp: 70, hpMax: 560, weaponClass: 'sword', weaponLevel: 8, armorTier: 2, traits: [], abilityBlueprints: [{ id: 'bp-crushing-blow', level: 5, name: '原技法' }, { id: 'bp-mending', level: 8 }, { id: 'bp-binding', level: 4 }] }, { seed: 'learning', registry, noVariance: true }).unit;
  unit.id = 'a'; unit.resources.SP = 1; unit.abilityState = [{ abilityId: unit.abilities[0]!.cooldownGroup!, cdLeft: 2, used: 1 }];
  return unit;
}
describe('逐项学习与冻结实例', () => {
  it('按实例删除同名技能，保留未删技能的精确值与冷却、次数和精力，可删除至空', () => {
    const unit = initial();
    const twin = { ...structuredClone(unit.abilities[0]!), id: 'same-name-other-instance', customized: true };
    unit.abilities.push(twin); unit.preparedAbilityIds = unit.abilities.map(ability => ability.id);
    unit.fatigue = 1;
    const record = unitRecordFromCombatant(unit), before = structuredClone(record);
    const selected = unit.abilities.slice(1).map(ability => ability.id);
    const next = forgetUnitRecordSkills(record, [unit.abilities[0]!.id], selected, registry);
    expect(next.snapshot!.abilities).toEqual(record.snapshot!.abilities.slice(1));
    expect(next.snapshot!.preparedAbilityIds).toEqual(selected);
    for (const key of ['abilityState', 'resources', 'fatigue', 'weapon', 'armor', 'hp'] as const) expect(next.snapshot![key]).toEqual(record.snapshot![key]);
    expect(next.snapshot!.genAudit!.input.abilityBlueprints).toHaveLength(selected.length);
    const empty = forgetUnitRecordSkills(next, selected, [], registry);
    expect(empty.snapshot!.abilities).toEqual([]); expect(empty.preparedAbilityIds).toEqual([]);
    expect(empty.snapshot!.genAudit!.input.abilityBlueprints).toEqual([]);
    expect(() => forgetUnitRecordSkills(record, ['missing'], [], registry)).toThrow(/已学技能/);
    expect(record).toEqual(before);
  });
  it('只改名保留原效果，只改一级技能不重建其余技能或装备，准备变化也不刷新次数', () => {
    const unit = initial(); const effect = unit.abilities[0]!.effects[0]!; if (effect.op === 'damage') effect.baseDice = '2d6+9';
    const record = unitRecordFromCombatant(unit), edited = structuredClone(record); edited.skills![0]!.name = '新名称';
    const named = editUnitRecord(record, edited, registry); expect(named.snapshot!.abilities[0]!.effects).toEqual(unit.abilities[0]!.effects); expect(named.snapshot!.abilities.slice(1)).toEqual(unit.abilities.slice(1));
    const upgraded = structuredClone(named); upgraded.skills![0]!.level = 7;
    const next = editUnitRecord(named, upgraded, registry); expect(next.snapshot!.abilities[0]!.power).toBe(7); expect(next.snapshot!.abilities[0]!.id).toBe(unit.abilities[0]!.id); expect(next.snapshot!.abilities.slice(1)).toEqual(unit.abilities.slice(1));
    expect(next.snapshot!.weapon).toEqual(unit.weapon); expect(next.snapshot!.armor).toEqual(unit.armor); expect(next.snapshot!.abilityState).toEqual(unit.abilityState); expect(next.snapshot!.resources.SP).toBe(1); expect(next.hp).toBe(70); expect(next.base.hpMax).toBe(560);
    const prepared = structuredClone(next); prepared.preparedAbilityIds = ['bp-binding']; const changed = editUnitRecord(next, prepared, registry); expect(changed.snapshot!.abilities).toEqual(next.snapshot!.abilities); expect(changed.snapshot!.abilityState).toEqual(unit.abilityState);
  });
  it('明确删除再学习保留稳定技能身份/机制组与次数账本，不修改输入对象', () => {
    const unit = initial(), original = structuredClone(unit);
    const removed = learnAbilities(unit, [], { replace: true }), learned = learnAbilities(removed, [{ id: 'bp-crushing-blow', level: 8 }], { rebuildRequested: true });
    expect(unit).toEqual(original); expect(learned.abilities[0]!.id).toBe(unit.abilities[0]!.id); expect(learned.abilities[0]!.cooldownGroup).toBe(unit.abilities[0]!.cooldownGroup); expect(learned.abilityState).toEqual(unit.abilityState); expect(learned.resources).toEqual(unit.resources);
  });
  it('正文学习与部署不依赖标签顺序，整批失败/旧回复/战内均不能留下半次学习', () => {
    const record = unitRecordFromCombatant(initial());
    for (const text of ['<learn id="a" skills="新击法:重击L7"/><deploy id="a"/>', '<deploy id="a"/><learn id="a" skills="新击法:重击L7"/>']) {
      const save: NarrativeSave = { storage: [record], rosterIds: [], factRevision: 1, storySync: false };
      const source = { characterId: 'char', chatId: 'chat', branchId: 'main', messageId: '1', swipeId: '0', role: 'assistant' as const, complete: true, generationId: 'g', text: '<tb>' + text + '</tb>' };
      const ns = namespaceOf(source), binding = captureGeneration(save, ns, 'g'); binding.complete = true;
      const proposal = proposalFromMessage(source, binding)!, before = structuredClone(save);
      const next = prepareNarrativeTransaction(save, proposal, ns, true); expect(save).toEqual(before); expect(next.rosterIds).toEqual(['a']);
      // 旧技能名换成通用机制：换了名字就是新学一项，原有三项保持不变（写原名“原技法:重击L7”才会就地更新那一项）。
      const restored = materializeUnitRecord(JSON.parse(JSON.stringify(next.storage![0])), registry);
      expect(restored.abilities.find((a) => a.name === '新击法')).toMatchObject({ power: 7, definitionId: 'generic:physical-single:melee' });
      expect(restored.abilities.filter((a) => a.name !== '新击法')).toEqual(record.snapshot!.abilities); expect(restored.weapon).toEqual(record.snapshot!.weapon); expect(restored.hp).toBe(70);
      expect(() => prepareNarrativeTransaction(next, proposal, ns, true)).toThrow(/过期|已经/);
      expect(() => prepareNarrativeTransaction({ ...save, battle: { kind: 'small', snap: { seed: 'active' } } }, proposal, ns, true)).toThrow(/战内/);
      const bad = proposalFromMessage({ ...source, text: '<tb><learn id="a" skills="重击L8"/><learn id="missing" skills="束缚术L5"/></tb>' }, binding)!;
      expect(() => prepareNarrativeTransaction(save, bad, ns, true)).toThrow(/缺失/); expect(save).toEqual(before);
    }
  });
});
