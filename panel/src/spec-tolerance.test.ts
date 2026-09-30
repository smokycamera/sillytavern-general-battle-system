import { describe, expect, it } from 'vitest';
import { parseProtocol } from './protocol.js';
import { serializeEvent } from './protocol-syntax.js';
import { materializeUnitRecord } from './unit-state.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
import { traitRegistry, V6_D20 } from '../../engine/src/index.js';
import { prepareCombatModel } from '../../engine/src/combat-model.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { normalizeNarrativeSkill, normalizeNarrativeSpec } from './spec-tolerance.js';

function spawn(skills: string, extra: Record<string, string> = {}) {
  return serializeEvent('spawn', { name: '测试单位', side: 'ally', scale: 'hero', level: '5', skills, ...extra });
}
function transact(save: NarrativeSave, text: string, messageId = '1'): NarrativeSave {
  const source: MessageEnvelope = { characterId: 'tolerance', chatId: 'c', branchId: 'b', messageId, swipeId: '0', generationId: messageId, role: 'assistant', complete: true, text };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, messageId); binding.complete = true;
  return prepareNarrativeTransaction(save, proposalFromMessage(source, binding)!, ns, true);
}
const registry = traitRegistry();

describe('正文技能规格兼容和局部恢复', () => {
  it('同义词、省略+1和混合顺序规范化后仍能再次解析', () => {
    expect(normalizeNarrativeSpec('步枪L5+1精度 伤害+3 穿甲+2 距离+1')).toBe('步枪L5+1精度+3伤害+2穿透+1射程');
    const text = spawn('推击:物理单体L5+击退+破甲+距离', { weapon: '步枪Lv.5 + 1 命中 伤害+3 +穿甲 +距离', level: 'Ｌｖ．５＋生命值' });
    const result = parseProtocol(text);
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ bonuses: { health: 1 }, weaponBonuses: { accuracy: 1, damage: 3, penetration: 1, range: 1 },
      skills: [{ blueprintId: 'generic:physical-single:push', bonuses: { penetration: 1, range: 1 } }] });
    expect(parseProtocol(result.canonical).canonical).toBe(result.canonical);
    expect(parseProtocol(spawn('坏:物理单体L3-伤害,治疗L3')).events[0]).toMatchObject({ skills: [{ blueprintId: 'generic:buff:heal' }] });
  });
  it.each(['剑Ｌ５＋３命中－２伤害', '剑 Lv. 5 + 3 精准 - 2 伤害', '剑（level 5 +3accuracy -2damage）', '剑L5  精度+3 伤害-2', '剑L5（+3命中-2伤害）'])('等价装备写法保留精确数值：%s', text => {
    expect(normalizeNarrativeSpec(text)).toBe('剑L5+3精度-2伤害');
    const result = parseProtocol(spawn('治疗L3', { weapon: '宝剑:' + text }));
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ weaponClass: 'sword', weaponLevel: 5, weaponBonuses: { accuracy: 3, damage: -2 } });
  });

  it('修复报错的三类写法，保留原有回旋斩和突刺规格', () => {
    const text = spawn('回旋斩:物理范围环形L7+4伤害,精准突刺:物理单体近战L7+6穿透,冲击:物理单体L7+3击退,护体:buff+防御L7+3defense,威慑:debuffL7+4恐惧');
    const result = parseProtocol(text);
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ skills: [
      { blueprintId: 'generic:physical-area:ring', level: 7, bonuses: { damage: 4 } },
      { blueprintId: 'generic:physical-single:melee', level: 7, bonuses: { penetration: 6 } },
      { blueprintId: 'generic:physical-single:push', level: 7 },
      { blueprintId: 'generic:buff:defense', level: 7, bonuses: { power: 3 } },
      { blueprintId: 'generic:debuff:fear', level: 7 },
    ] });
    expect(result.warnings.join('')).toContain('忽略独立加值');
    expect(parseProtocol(result.canonical).canonical).toBe(result.canonical);
  });

  it('等级后机制、别名与数值强化可以交错，负数效果词不增加机制', () => {
    const result = parseProtocol(spawn('冲击:物理单体 Lv.5 +击退 +3伤害 +恐惧 -2精度,反例:物理单体L3-2恐惧'));
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ skills: [
      { blueprintId: 'generic:physical-single:fear+push', bonuses: { damage: 3, accuracy: -2 } },
      { blueprintId: 'generic:physical-single' },
    ] });
    expect(normalizeNarrativeSkill('恐惧Lv.4', [])).toBe('减益惊惧L4');
  });

  it('同义强化确实进入防御和屏障效果，已有标准强化不变', () => {
    const save = transact({}, spawn('护体:buff防御L5+3防御,护盾:buff屏障L5-2防护,加速:buff加速L5+4速度'));
    const unit = materializeUnitRecord(save.storage![0]!, registry);
    prepareCombatModel(unit, V6_D20); upgradeCombatSkills(unit);
    expect(unit.abilities.map(a => a.bonuses)).toEqual([{ power: 3 }, { power: -2 }, { power: 4 }]);
    expect(unit.abilities[0]!.effects).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'condition', conditionId: 'encouraged', magnitude: 1.15 })]));
    expect(unit.abilities[1]!.effects).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'barrier', defensePower: 5 })]));
    const restored = materializeUnitRecord(JSON.parse(JSON.stringify(save.storage![0]!)), registry);
    expect(restored.abilities.map(a => a.bonuses)).toEqual(unit.abilities.map(a => a.bonuses));
  });

  it('一个强化抛错只跳过该技能，合法技能、单位和其他事件正常提交', () => {
    const text = '<field env="forest"/>' + spawn('错误:魔法单体L3+99伤害,好技能:治疗L3,残缺:物理单体L4+3伤害-') + spawn('治疗L2', { name: '第二人' });
    const parsed = parseProtocol(text);
    expect(parsed.errors).toEqual([]); expect(parsed.events).toHaveLength(3);
    expect(parsed.events[1]).toMatchObject({ skills: [{ name: '好技能' }] });
    expect(parsed.warnings.join('')).toMatch(/99|不完整/);
    expect(transact({}, text).storage).toHaveLength(2);
  });

  it('未知可选强化不丢基础技能，不把攻击技能的防御修正误换成伤害强度', () => {
    const parsed = parseProtocol(spawn('斩击:物理单体L5+3未知+4防御+2伤害,乱写:魔法单体不存在L4'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ skills: [{ blueprintId: 'generic:physical-single', bonuses: { damage: 2 } }] });
    expect(parsed.warnings.join('')).toMatch(/未知/);
  });

  it('重复同值修正合并，不叠加强度；冲突项隔离', () => {
    const parsed = parseProtocol(spawn('命中:魔法单体L5+3精度+3命中,冲突:魔法单体L5+2伤害+4伤害,治疗L3'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ skills: [{ bonuses: { accuracy: 3 } }, { blueprintId: 'generic:buff:heal' }] });
    expect(parsed.warnings.join('')).toMatch(/冲突/);
  });

  it('文本数组、常见字段别名和特质分隔符沿用同一处理', () => {
    const parsed = parseProtocol('<spawn name="甲" side="友方" scale="英雄" primary_weapon="剑Lv.5 +3命中" armour="轻甲L3" skill=\'["治疗Lv.3", "恐惧L2"]\' trait="快速+游击|不溃"/>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ weaponClass: 'sword', weaponLevel: 5, armorTier: 1 });
    expect(parsed.events[0]!.kind === 'spawn' && parsed.events[0]!.skills).toHaveLength(2);
  });

  it('unit_set完整列表兼容；坏列表保留原技能/特质，仍可更新明确字段', () => {
    const save = transact({}, spawn('原技能:治疗L3', { traits: '不溃' }));
    const id = save.storage![0]!.id;
    const before = materializeUnitRecord(save.storage![0]!, registry);
    const bad = serializeEvent('unit_set', { id, name: '改名', skills: '新技能:物理单体L5,错误:魔法单体L5+99伤害', traits: '快速,未知特质' });
    const next = transact(save, bad, '2');
    const unit = materializeUnitRecord(next.storage![0]!, registry);
    expect(unit.name).toBe('改名'); expect(unit.abilities).toEqual(before.abilities); expect(unit.traits).toEqual(before.traits);
    expect(parseProtocol(serializeEvent('unit_set', { id, skills: '错误:魔法单体L5+99伤害' })).events).toEqual([]);
    const good = transact(next, serializeEvent('unit_set', { id, skills: '冲击:物理单体Lv.5+击退,护体:buff防御L5+3防御' }), '3');
    expect(materializeUnitRecord(good.storage![0]!, registry).abilities.map(a => a.definitionId)).toEqual(['generic:physical-single:push', 'generic:buff:defense']);
    const cleared = transact(good, serializeEvent('unit_set', { id, skills: '' }), '4');
    expect(materializeUnitRecord(cleared.storage![0]!, registry).abilities).toEqual([]);
  });

  it('learn同样隔离坏技能，不让未知、越界、冲突身份与不完整事件悄悄执行', () => {
    const parsed = parseProtocol('<learn id="a" skills="错误:魔法单体L99,治疗Lv.3+2治疗量"/>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ kind: 'learn', skills: [{ level: 3, bonuses: { healing: 2 } }] });
    for (const input of [spawn('', { weapon: '剑Lv.99' }), spawn('', { weapon: '剑L5+11伤害' }), spawn('', { weapon: '剑L5+3未知' }), '<unit_update id="a" hp="-5"/>', '<deploy id="a" id="b"/>', '<unit_update id="a" hp="50']) {
      expect(parseProtocol(input).errors.length, input).toBeGreaterThan(0);
    }
  });
});
