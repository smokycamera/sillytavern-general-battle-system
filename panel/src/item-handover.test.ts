import { describe, expect, it } from 'vitest';
import { anchoredProtection, generateUnit, traitRegistry, parseSkillMechanism, skillMechanismId } from '../../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { createInventoryItem, prepareInventoryState, type InventoryItem } from './inventory-state.js';
import { parseItemSpecification, parseSpawnItem } from './item-spec.js';
import { parseProtocol, recoverProtocol } from './protocol.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';

// 2026-10-12：正文自创的道具——写法容错、道具位置上的武器词条、写不出效果的单独略过、unit_set 的 items 交给单位、佩戴防护。
const reg = traitRegistry();
function unit(id: string, name: string, side: 'ally' | 'enemy' = 'ally', scale: 'hero' | 'company' = 'hero') {
  const generated = generateUnit({ name, side, scale, rulesVersion: 'v2', level: 4, traits: [], weaponClass: 'sword', weaponLevel: 3, armorTier: 1, armorLevel: 3,
    ...(scale === 'company' ? { hp: 40, hpMax: 40 } : {}) }, { seed: 'handover-' + id, registry: reg }).unit;
  generated.id = id;
  return unitRecordFromCombatant(generated);
}
function setup(records = [unit('a', '法师'), unit('b', '战士')], inventory: InventoryItem[] = []): NarrativeSave {
  return prepareInventoryState({ storage: records, rosterIds: [], factRevision: 1, storySync: true, inventory }) as NarrativeSave;
}
let message = 0;
function transact(save: NarrativeSave, body: string) {
  const id = 'reply-' + ++message;
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'b', messageId: id, swipeId: '0', role: 'assistant', complete: true, generationId: id, text: `<tb>${body}</tb>` };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, id); binding.complete = true;
  const proposal = proposalFromMessage(source, binding)!;
  if (proposal.status !== 'pending') throw Error(proposal.reason);
  return prepareNarrativeTransaction(save, proposal, ns, true);
}
const carried = (save: NarrativeSave, unitId: string) => save.inventory!.filter((i) => i.assignedTo === unitId && i.qty > 0 && !i.mechanics?.kind.match(/weapon|armor|shield/))
  .map((i) => [i.name, i.qty, i.equippedTo?.slot ?? '-']);
const notices = (save: NarrativeSave) => save.proposals!.at(-1)!.notices?.join('；') ?? '';
const potion = (id: string, qty: number, assignedTo?: string): InventoryItem => ({ ...createInventoryItem(id, '治疗药水', { kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, id, qty), ...(assignedTo ? { assignedTo } : {}) });

describe('道具写法容错与武器词条', () => {
  it('“佩戴”写在特质前、修正方向写在等级前都按规范写法理解；“佩戴L4+4防御”照旧', () => {
    expect(parseItemSpecification('佩戴破甲L5')).toEqual({ kind: 'item', form: 'worn', power: 5, traits: [{ id: 'ap-weapon' }] });
    const notes: string[] = [];
    expect(parseItemSpecification('佩戴热能防护L5+4', {}, notes)).toEqual({ kind: 'item', form: 'worn', power: 5, traits: [], bonuses: { thermalProtection: 4 } });
    expect(notes).toEqual(['「佩戴热能防护L5+4」按「佩戴L5+4热能防护」理解']);
    expect(parseItemSpecification('佩戴L4+4防御')).toEqual({ kind: 'item', form: 'worn', power: 4, traits: [], bonuses: { defense: 4 } });
    // 防护照样占佩戴预算，建档时检查。
    expect(() => createInventoryItem('x', '护符', parseItemSpecification('佩戴L3+4热能防护'), 'x')).toThrow(/需要4点，L3只有3点/);
  });
  it('道具位置上的武器词条换成用这件武器打一次的道具；近战武器与护甲没有对应道具', () => {
    const notes: string[] = [];
    expect(parseSpawnItem('爆裂火球石:爆破装置L5', notes)).toEqual({ name: '爆裂火球石', qty: 1, spec: { kind: 'item', form: 'single', power: 5, active: 'generic:physical-area:projectile' } });
    expect(notes).toEqual(['「爆破装置L5」是武器写法，按道具「物理范围投射L5」']);
    expect(parseSpawnItem('火箭筒:直射火炮L6').spec).toMatchObject({ form: 'single', active: 'generic:physical-area:projectile' });
    expect(parseSpawnItem('飞刀:投掷冷兵器L3×4')).toMatchObject({ qty: 4, spec: { form: 'single', active: 'generic:physical-single:projectile' } });
    expect(parseSpawnItem('炎杖:法杖L6').spec).toMatchObject({ form: 'charged', active: 'generic:magic-single' });
    const dropped: string[] = [];
    expect(parseSpawnItem('穿甲弹:步枪L5+2穿透-1防御', dropped).spec).toEqual({ kind: 'item', form: 'single', power: 5, active: 'generic:physical-single:projectile', bonuses: { penetration: 2 } });
    expect(dropped.join()).toContain('已忽略未支持强化 -1防御');
    // 效果词照技能写法并入道具效果。
    expect(parseSpawnItem('淬毒飞刀:投掷冷兵器L5+中毒×5')).toMatchObject({ qty: 5, spec: { form: 'single', active: skillMechanismId(parseSkillMechanism('物理单体投射+中毒')!) } });
    expect(() => parseSpawnItem('长剑:剑L5')).toThrow(/没有对应的道具写法；武器写在weapon、weapon2/);
    expect(() => parseSpawnItem('皮甲:轻甲L3')).toThrow(/护甲与盾写在armor/);
    // 带形态词的武器也是道具；不带的 spec 照旧是装备。
    expect(parseItemSpecification('充能魔杖L5')).toMatchObject({ kind: 'item', form: 'charged', active: 'generic:magic-single' });
    expect(parseItemSpecification('一次性炸药L3')).toMatchObject({ kind: 'item', form: 'single', active: 'generic:physical-area:projectile' });
    expect(parseItemSpecification('爆破装置L5')).toMatchObject({ kind: 'weapon', mechanism: 'demolition' });
  });
  it('give：要用 items 交出的、写爆破装置的按道具入库；其余写武器的仍是武器', () => {
    const events = (text: string) => parseProtocol(`<tb>${text}</tb>`).events.filter((e) => e.kind === 'give').map((e) => e.kind === 'give' && [e.item, e.spec?.kind === 'item' ? e.spec.form + ':' + e.spec.active : e.spec?.kind]);
    expect(events('<give item="炸药包" spec="爆破装置L4" qty="3"/>')).toEqual([['炸药包', 'single:generic:physical-area:projectile']]);
    expect(events('<give item="霜之哀伤" spec="剑L7"/><give item="突击步枪" spec="步枪L5"/>')).toEqual([['霜之哀伤', 'weapon'], ['突击步枪', 'weapon']]);
    expect(events('<give item="炸药包" type="weapon" spec="爆破装置L4"/><give item="工兵炸药" spec="爆破装置L4"/><unit_set id="u1" weapon="工兵炸药:爆破装置L4"/>')).toEqual([['炸药包', 'weapon'], ['工兵炸药', 'weapon']]);
    expect(events('<give item="穿甲弹" spec="步枪L5" qty="5"/><unit_set id="u1" items="穿甲弹:步枪L5×5"/>')).toEqual([['穿甲弹', 'single:generic:physical-single:projectile']]);
    expect(events('<give item="长剑" type="item" spec="剑L5"/><give item="药水" spec="buff治疗L3"/>')).toEqual([['药水', 'single:generic:buff:heal']]);
  });
});

describe('写不出效果的道具单独略过', () => {
  it('give 与 items 里写不出的一项略过并提示，其余事件照常；只剩写不出的道具时作为待补全', () => {
    const parsed = parseProtocol('<tb><give item="冰风暴卷轴" spec="魔法范围寒冷L5"/><give item="药水" spec="buff治疗L3"/><unit_set id="u1" items="冰风暴卷轴:魔法范围寒冷L5,药水:buff治疗L3"/></tb>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events.map((e) => e.kind)).toEqual(['give', 'unit-set']);
    expect(parsed.warnings.slice(0, 2)).toEqual([expect.stringContaining('未采用道具「冰风暴卷轴」（未知道具效果「魔法范围寒冷」'), expect.stringContaining('u1：未采用道具「冰风暴卷轴:魔法范围寒冷L5」')]);
    expect(parsed.canonical).toContain('<unit_set id="u1" items="药水:增益治疗L3"/>');
    const only = parseProtocol('<tb><give item="冰风暴卷轴" spec="魔法范围寒冷L5"/><unit_set id="u1" items="冰风暴卷轴:魔法范围寒冷L5"/></tb>');
    expect(only.events).toEqual([]); expect(only.errors).toEqual([expect.stringContaining('未采用道具「冰风暴卷轴」')]);
  });
  it('佩戴修正超出预算时逐点降到预算内并保留道具；特质本身超出预算的在解析时就略过，不拖到入账时整批失败', () => {
    const body = '<give item="陶瓷插板" spec="佩戴L5+8防御"/><give item="斗篷" spec="潜伏、林地专精L4"/><give item="手雷" spec="物理范围投射L4" qty="2"/>'
      + '<unit_set id="u1" items="赤鳞护符:佩戴L5+4热能防护+4防御,手雷:物理范围投射L4×2"/>';
    const parsed = parseProtocol(`<tb>${body}</tb>`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual(expect.arrayContaining(['「佩戴L5+8防御」超出L5的佩戴预算，按「佩戴L5+5防御」',
      '「赤鳞护符:佩戴L5+4热能防护+4防御」超出L5的佩戴预算，按「佩戴L5+2热能防护+3防御」', expect.stringContaining('未采用道具「斗篷」（佩戴效果需要5点，L4只有4点')]));
    const next = transact(setup(), body);
    expect(carried(next, 'a')).toEqual([['手雷', 2, '-'], ['赤鳞护符', 1, 'gear']]);
    expect(next.inventory!.find((i) => i.name === '陶瓷插板')!.mechanics).toMatchObject({ value: { recipe: { form: 'worn', power: 5, bonuses: { defense: 5 } } } });
    expect(next.inventory!.some((i) => i.name === '斗篷')).toBe(false);
    // 修正写在等级前、效果词写在等级后，也按规范写法理解。
    expect(parseItemSpecification('物理单体射击+6穿透L5')).toMatchObject({ form: 'single', active: skillMechanismId(parseSkillMechanism('物理单体射击')!), bonuses: { penetration: 6 } });
    expect(parseItemSpecification('buff治疗L3+振奋')).toMatchObject({ form: 'single', active: skillMechanismId(parseSkillMechanism('buff治疗+振奋')!) });
  });
  it('识别可解析部分不留下什么都不改的 unit_set', () => {
    expect(recoverProtocol('<tb><unit_set id="u1" items="冰风暴卷轴:魔法范围寒冷L5"/><give item="药水" spec="buff治疗L3"/></tb>').text).toBe('<tb>\n<give item="药水" spec="buff治疗L3"/>\n</tb>');
  });
});

describe('unit_set 的 items 把道具交给单位', () => {
  it('2026-10-12 那条回复：九件道具交到两人手上，佩戴、充能装上，没有重复入库，冰风暴卷轴略过', () => {
    const next = transact(setup(), '<give item="法力合剂" spec="充能buff回能L4" qty="1"/><give item="抗火护符" spec="佩戴热能防护L5+4" qty="1"/><give item="炽火魔杖" spec="充能魔法单体热能L5" qty="1"/>'
      + '<give item="冰风暴卷轴" spec="魔法范围寒冷L5" qty="1"/><give item="石肤卷轴" spec="buff守护L5" qty="1"/><give item="沸血烈剂" spec="buff攻击L5+4" qty="1"/><give item="碎魔臂甲" spec="佩戴破甲L5" qty="1"/>'
      + '<give item="爆裂火球石" spec="爆破装置L5" qty="1"/><give item="硫磺晶尘" spec="buff伤害L4" qty="1"/><give item="龙髓药油" spec="buff狂暴L5" qty="1"/>'
      + '<unit_set id="u1" items="法力合剂:充能buff回能L4,抗火护符:佩戴热能防护L5+4,炽火魔杖:充能魔法单体热能L5,冰风暴卷轴:魔法范围寒冷L5,石肤卷轴:buff守护L5"/>'
      + '<unit_set id="u2" items="沸血烈剂:buff攻击L5+4,碎魔臂甲:佩戴破甲L5,爆裂火球石:爆破装置L5,硫磺晶尘:buff伤害L4,龙髓药油:buff狂暴L5"/>');
    expect(carried(next, 'a')).toEqual([['法力合剂', 1, 'gear'], ['抗火护符', 1, 'gear'], ['炽火魔杖', 1, 'gear'], ['石肤卷轴', 1, '-']]);
    expect(carried(next, 'b')).toEqual([['沸血烈剂', 1, '-'], ['碎魔臂甲', 1, 'gear'], ['爆裂火球石', 1, '-'], ['硫磺晶尘', 1, '-'], ['龙髓药油', 1, '-']]);
    expect(next.inventory!.filter((i) => !i.assignedTo)).toEqual([]);
    expect(next.storage!.find((r) => r.id === 'a')!.snapshot!.gear!.map((g) => g.name)).toEqual(['法力合剂', '抗火护符', '炽火魔杖']);
    expect(notices(next)).toContain('交给法师：法力合剂（装上）、抗火护符（装上）、炽火魔杖（装上）、石肤卷轴');
  });
  it('只增不减：已经带着的算在内，重复写同一份清单不会越加越多；不够的先拿库存里没主的，再新建', () => {
    let save = setup(undefined, [potion('mine', 2, 'a'), potion('stash', 3)]);
    save = transact(save, '<unit_set id="u1" items="治疗药水:buff治疗L3×2"/>');
    expect(carried(save, 'a')).toEqual([['治疗药水', 2, '-']]);
    expect(notices(save)).toContain('治疗药水（已有2件，没有重复添加）');
    save = transact(save, '<unit_set id="u1" items="治疗药水:buff治疗L3×4"/>');
    expect(carried(save, 'a').reduce((n, [, qty]) => n + Number(qty), 0)).toBe(4);
    expect(save.inventory!.find((i) => i.id === 'stash')!.qty).toBe(1);
    expect(notices(save)).toContain('治疗药水×2（2件取自库存）');
    save = transact(save, '<unit_set id="u2" items="治疗药水:buff治疗L3×3,金币×10"/>');
    expect(carried(save, 'b')).toEqual([['治疗药水', 1, '-'], ['治疗药水', 2, '-'], ['金币', 10, '-']]);
    expect(save.inventory!.some((i) => i.id === 'stash' && i.qty > 0 && !i.assignedTo)).toBe(false);
  });
  it('编队一件即整卡配发；敌方不动我方原有库存；同一回复 give 的同名道具效果不同时各自入库', () => {
    let save = setup([unit('a', '掷弹兵连', 'ally', 'company'), unit('b', '敌将', 'enemy')], [potion('stash', 3)]);
    save = transact(save, '<unit_set id="u1" items="夜视镜:夜战专精L5×30"/><unit_set id="u2" items="治疗药水:buff治疗L3"/>');
    expect(carried(save, 'a')).toEqual([['夜视镜', 1, 'gear']]);
    expect(notices(save)).toContain('掷弹兵连是编队，佩戴、充能道具一件就是整张单位卡的配发，「夜视镜」只交1件');
    expect(carried(save, 'b')).toEqual([['治疗药水', 1, '-']]);
    expect(save.inventory!.find((i) => i.id === 'stash')!.qty).toBe(3);
    save = transact(save, '<give item="怒火药剂" spec="buff攻击L3"/><unit_set id="u2" items="怒火药剂:buff伤害L3"/>');
    expect(save.inventory!.filter((i) => i.name === '怒火药剂').map((i) => [i.assignedTo ?? '公共库存', i.mechanics?.kind === 'item' && i.mechanics.value.recipe.active]))
      .toEqual([['公共库存', 'generic:buff:attack'], ['b', 'generic:buff:empower']]);
    expect(notices(save)).toContain('同一回复 give 的「怒火药剂」效果与交给敌将的不同，各自入库');
  });
  it('unit_set 新建单位时带的道具交给新单位；只交道具的 unit_set 不改档案', () => {
    const save = transact(setup(), '<give item="炽火魔杖" spec="充能魔法单体热能L5"/><unit_set id="u9" name="见习法师" side="ally" scale="hero" level="2" items="炽火魔杖:充能魔法单体热能L5,金币×5"/>');
    const apprentice = save.storage!.find((r) => r.name === '见习法师')!;
    expect(carried(save, apprentice.id)).toEqual([['炽火魔杖', 1, 'gear'], ['金币', 5, '-']]);
    expect(save.inventory!.filter((i) => i.name === '炽火魔杖')).toHaveLength(1);
    const before = setup(), after = transact(before, '<unit_set id="u1" items="金币×5"/>');
    expect(after.storage!.find((r) => r.id === 'a')!.revision).toBe(before.storage!.find((r) => r.id === 'a')!.revision);
  });
  it('改造道具时写的武器词条换成对应道具，形态不变', () => {
    const wand = { ...createInventoryItem('wand', '旧魔杖', { kind: 'item', form: 'charged', power: 3, active: 'generic:magic-single' }, 'wand'), assignedTo: 'a' };
    const save = transact(setup(undefined, [wand]), '<reforge id="i1" spec="法杖L6"/>');
    expect(save.inventory!.find((i) => i.id === 'wand')!.mechanics).toMatchObject({ kind: 'item', value: { recipe: { form: 'charged', power: 6, active: 'generic:magic-single' } } });
    expect(notices(save)).toContain('「法杖L6」是武器写法，按道具「充能魔法单体L6」');
  });
});

describe('佩戴道具的防护', () => {
  it('与护甲的防护修正相加抗穿，只加写明的通道；同方向取最高一件；合计仍限 ±10 点', () => {
    const base = materializeUnitRecord(setup().storage![0]!, reg);
    const save = transact(setup(), '<unit_set id="u1" items="抗火护符:佩戴L5+4热能防护,护心镜:佩戴L3+2热能防护,秘银护符:佩戴L5+3防护"/>');
    const guarded = materializeUnitRecord(save.storage!.find((r) => r.id === 'a')!, reg);
    expect(anchoredProtection(guarded, 'thermal') - anchoredProtection(base, 'thermal')).toBeCloseTo((4 + 3) / 5, 9);
    expect(anchoredProtection(guarded, 'kinetic') - anchoredProtection(base, 'kinetic')).toBeCloseTo(3 / 5, 9);
    const capped = { ...guarded, armor: { ...guarded.armor!, recipe: { ...guarded.armor!.recipe!, bonuses: { protection: 6, thermalProtection: 4 } } } };
    const armorOnly = { ...capped, gear: undefined };
    expect(anchoredProtection(capped, 'thermal') - anchoredProtection(armorOnly, 'thermal')).toBe(0);
  });
});
