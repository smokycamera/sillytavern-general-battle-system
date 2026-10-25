import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, standardField, V15_OVERFLOW_D20, activeTraitIds, traitLevel, prepareItemModel, type Combatant } from '../../engine/src/index.js';
import legacy from '../../engine/tests/fixtures/legacy-items-v14.json';
import { parseItemSpecification, parseSpawnItem, splitSpawnItems, spawnItemText } from './item-spec.js';
import { parseProtocol } from './protocol.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
import { createInventoryItem, outOfBattleUse, prepareInventoryState, prepareInventoryTransaction, type InventorySave } from './inventory-state.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { prepareBattleItems, prepareBattleItemWrite } from './battle-items.js';
import { reviewMigration } from './migration-review.js';
import { narrativeProjection } from './narrative-controller.js';
import { overshadowedGear } from './item-description.js';
import { compileItem, gearItem } from '../../engine/src/index.js';

const registry = traitRegistry();
let message = 0;
/** 一条完整的 assistant 正文入账；返回新存档与审批提示。 */
function commit(save: NarrativeSave, body: string): { save: NarrativeSave; notices: string[] } {
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'main', messageId: String(++message), swipeId: '0', role: 'assistant', complete: true, generationId: 'g' + message, text: `<tb>${body}</tb>` };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, 'g' + message); binding.complete = true;
  const proposal = proposalFromMessage(source, binding)!;
  if (proposal.status !== 'pending') throw Error(proposal.reason);
  const next = prepareNarrativeTransaction(save, proposal, ns, true);
  return { save: next, notices: next.proposals!.at(-1)!.notices ?? [] };
}
const empty = (): NarrativeSave => ({ schemaVersion: 2, storage: [], rosterIds: [], factRevision: 1, storySync: true });

describe('道具 spec 解析与容错', () => {
  it('形态、效果、等级与修正与技能和特质同一写法；旧名称按对照表换算；道具名不猜效果并给出修复建议', () => {
    expect(parseItemSpecification('buff治疗L3')).toEqual({ kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' });
    expect(parseItemSpecification('充能魔法范围热能L5')).toMatchObject({ kind: 'item', form: 'charged', power: 5 });
    expect(parseItemSpecification('充能:魔法范围热能L5')).toMatchObject({ kind: 'item', form: 'charged', power: 5 });
    expect(parseItemSpecification('夜战专精L5')).toEqual({ kind: 'item', form: 'worn', power: 5, traits: [{ id: 'night-fighter', level: 5 }] });
    expect(parseItemSpecification('潜伏、林地专精L6')).toMatchObject({ form: 'worn', traits: [{ id: 'stalk' }, { id: 'forest-lore', level: 6 }] });
    expect(parseItemSpecification('佩戴L4+4防御')).toEqual({ kind: 'item', form: 'worn', power: 4, traits: [], bonuses: { defense: 4 } });
    expect(parseItemSpecification('buff治疗L3+10治疗')).toMatchObject({ form: 'single', bonuses: { healing: 10 } });
    expect(parseItemSpecification('治疗药剂L3')).toMatchObject({ form: 'single', active: 'generic:buff:heal' });
    expect(parseItemSpecification('治疗护符L3')).toMatchObject({ form: 'charged', active: 'generic:buff:heal' });
    expect(parseItemSpecification('林行靴L3')).toMatchObject({ form: 'worn', traits: [{ id: 'forest-lore', level: 3 }] });
    expect(parseItemSpecification('步枪L5')).toMatchObject({ kind: 'weapon', mechanism: 'rifle' });
    const notes: string[] = [];
    expect(parseItemSpecification('手雷L4', {}, notes)).toMatchObject({ form: 'single', active: 'generic:physical-area:projectile' });
    expect(notes.join()).toContain('技能名');
    expect(() => parseItemSpecification('炸弹L3')).toThrow(/可改为“物理范围投射L等级”/);
    expect(() => parseItemSpecification('急救包L3')).toThrow(/可改为“buff治疗L等级”/);
    expect(() => parseItemSpecification('充能夜战专精L5')).toThrow(/特质写在佩戴道具里/);
    expect(() => parseItemSpecification('佩戴:物理范围投射L4')).toThrow(/佩戴道具写特质/);
  });
  it('spawn 的 items 按逗号分项，佩戴特质之间的逗号与顿号并回同一项；件数接受×、x、*；规范写法可原样解析', () => {
    expect(splitSpawnItems('精灵斗篷:潜伏，林地专精L6、治疗药水:buff治疗L3x2, 手雷:物理范围投射L4*6,金币×30,信件')).toEqual(
      ['精灵斗篷:潜伏、林地专精L6', '治疗药水:buff治疗L3x2', '手雷:物理范围投射L4*6', '金币×30', '信件']);
    expect(splitSpawnItems('潜伏、林地专精L6')).toEqual(['潜伏、林地专精L6']);
    const items = splitSpawnItems('精灵斗篷:潜伏，林地专精L6,治疗药水:buff治疗L3x2,手雷:物理范围投射L4*6,金币×30,信件').map((entry) => parseSpawnItem(entry));
    expect(items.map((i) => [i.name, i.qty, i.spec?.form])).toEqual([['精灵斗篷', 1, 'worn'], ['治疗药水', 2, 'single'], ['手雷', 6, 'single'], ['金币', 30, undefined], ['信件', 1, undefined]]);
    for (const entry of items) expect(parseSpawnItem(spawnItemText(entry))).toEqual(entry);
    expect(parseSpawnItem('火球魔杖:充能魔法范围热能L5×3')).toMatchObject({ qty: 3, spec: { form: 'charged' } });
    expect(() => parseSpawnItem('长剑:剑L3')).toThrow(/weapon/);
    expect(() => parseSpawnItem('手雷:物理范围投射L4×0')).toThrow(/件数/);
  });
});

describe('spawn 携带道具与收缴', () => {
  it('每张卡各一套道具，入库归该卡；佩戴、充能自动装上，编队按每卡一件；坏的一项单独略过；开战随身携带', () => {
    const parsed = parseProtocol('<tb><spawn name="掷弹兵连" side="enemy" scale="company" hpMax="30" level="3" weapon="步枪L4" count="2" items="手雷:物理范围投射L4×60,夜视镜:夜战专精L5×30,长剑:剑L3"/></tb>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.join()).toContain('未采用道具「长剑:剑L3」');
    expect(parsed.canonical).toContain('items="手雷:物理范围投射L4×60,夜视镜:夜战专精L5×30"');
    const { save, notices } = commit(empty(), '<spawn name="掷弹兵连" side="enemy" scale="company" hpMax="30" level="3" weapon="步枪L4" count="2" items="手雷:物理范围投射L4×60,夜视镜:夜战专精L5×30"/>'
      + '<spawn name="游侠" side="ally" scale="hero" level="5" weapon="长弓:弓弩L5" items="精灵斗篷:潜伏、林地专精L6,治疗药水:buff治疗L3×2,火球魔杖:充能魔法范围热能L5×2,金币×30"/>');
    expect(notices.join()).toContain('「夜视镜」按每卡1件建档');
    const inventory = prepareInventoryState(save).inventory!;
    const grenadiers = save.storage!.filter((r) => r.name === '掷弹兵连'), ranger = save.storage!.find((r) => r.name === '游侠')!;
    expect(grenadiers).toHaveLength(2);
    for (const card of grenadiers) {
      expect(inventory.filter((i) => i.assignedTo === card.id).map((i) => [i.name, i.qty, i.equippedTo?.slot]).filter(([name]) => ['手雷', '夜视镜'].includes(String(name))))
        .toEqual([['手雷', 60, undefined], ['夜视镜', 1, 'gear']]);
      expect(card.snapshot!.gear!.map((g) => g.name)).toEqual(['夜视镜']);
      expect(card.archetype).toBe('ranged');
    }
    expect(ranger.snapshot!.gear!.map((g) => g.name)).toEqual(['精灵斗篷', '火球魔杖', '火球魔杖']);
    expect(ranger.snapshot!.abilities.filter((a) => a.equipmentSourceId).map((a) => a.usesPerBattle)).toEqual([1, 1]);
    expect(inventory.find((i) => i.name === '金币')).toMatchObject({ qty: 30, assignedTo: ranger.id });
    const units = prepareBattleItems(save.storage!.map((r) => materializeUnitRecord(r, registry)), save);
    expect(units.find((u) => u.id === ranger.id)!.carriedItems!.map((c) => [c.name, c.quantity])).toEqual([['治疗药水', 2]]);
    expect(units.filter((u) => u.name === '掷弹兵连').map((u) => u.resources[u.abilities.find((a) => a.itemSourceId)!.cost!.resource])).toEqual([60, 60]);
    const battle = new SmallBattle({ combatants: units, battlefield: standardField(), rules: V15_OVERFLOW_D20, seed: 'spawn-items', traitRegistry: registry }); battle.start();
    const fielded = battle.byId(ranger.id);
    expect(activeTraitIds(fielded)).toEqual(expect.arrayContaining(['stalk', 'forest-lore'])); expect(traitLevel(fielded, 'forest-lore')).toBe(6);
    // 事实清单列出道具形态与 spec 原文，充能道具给每战次数。
    const facts = narrativeProjection(save, '');
    expect(facts).toContain('kind="充能道具" items="火球魔杖:充能魔法范围热能L5"');
    expect(facts).toContain('kind="一次性道具" items="手雷:物理范围投射L4×');
  });
  it('阵亡或撤离的敌方单位身上剩余的道具可以收缴进公共库存；活着的敌人与我方单位不能收缴', () => {
    let { save } = commit(empty(), '<spawn name="敌将" side="enemy" scale="hero" level="5" weapon="剑L5" items="手雷:物理范围投射L4×3,护身符:佩戴L4+4防御,密信"/><spawn name="我方" side="ally" scale="hero" weapon="剑L3" items="手雷:物理范围投射L4"/>');
    const foe = save.storage!.find((r) => r.name === '敌将')!, ally = save.storage!.find((r) => r.name === '我方')!;
    const collect = (unitId: string) => prepareInventoryTransaction(save, { kind: 'collect', unitId, id: 'collect:' + unitId + ':' + save.factRevision, expectedRevision: save.factRevision ?? 0 });
    expect(() => collect(foe.id)).toThrow(/只能收缴/);
    expect(() => collect(ally.id)).toThrow(/只能收缴/);
    save = commit(save, `<unit_update id="u1" state="dead" hp="0"/>`).save;
    expect(save.storage!.find((r) => r.id === foe.id)!.status).toBe('dead');
    const after = collect(foe.id);
    const taken = after.inventory!.filter((i) => ['手雷', '护身符', '密信'].includes(i.name) && !i.assignedTo);
    expect(taken.map((i) => [i.name, i.qty, i.equippedTo])).toEqual([['手雷', 3, undefined], ['护身符', 1, undefined], ['密信', 1, undefined]]);
    expect(after.storage!.find((r) => r.id === foe.id)!.snapshot!.gear ?? []).toEqual([]);
    expect(after.inventory!.some((i) => i.assignedTo === foe.id && i.mechanics?.kind === 'weapon')).toBe(true);
  });
});

describe('专精等级与 archetype 的正文写法', () => {
  it('spawn、unit_set、bless 都可写“林地专精L8”；unit_set 是绝对赋值，新输入不写等级为L1，破甲也保留显式等级', () => {
    let { save, notices } = commit(empty(), '<spawn name="游侠" side="ally" scale="hero" level="4" weapon="弓弩L4" traits="林地专精L8,破甲L3,夜战专精L12"/>');
    const id = save.storage![0]!.id;
    expect(save.storage![0]!.snapshot).toMatchObject({ traits: expect.arrayContaining(['forest-lore', 'ap-weapon', 'night-fighter']), traitLevels: { 'forest-lore': 8, 'ap-weapon': 3, 'night-fighter': 10 } });
    expect(notices.join()).toContain('「夜战专精L12」按L10');
    expect(narrativeProjection(save, '')).toContain('traits="林地专精L8,破甲L3,夜战专精L10"');
    save = commit(save, '<unit_set id="u1" traits="林地专精L6,夜战专精"/>').save;
    expect(save.storage!.find((r) => r.id === id)!.snapshot!.traitLevels).toEqual({ 'forest-lore': 6, 'night-fighter': 1 });
    save = commit(save, '<unit_set id="u1" traits="林地专精"/>').save;
    expect(save.storage!.find((r) => r.id === id)!.snapshot!.traitLevels).toEqual({ 'forest-lore': 1 });
    save = commit(save, '<bless id="u1" traits="夜战专精L9" battles="2"/>').save;
    const unit = materializeUnitRecord(save.storage!.find((r) => r.id === id)!, registry);
    expect(unit.traitSources!.at(-1)).toMatchObject({ traitIds: ['night-fighter'], traitLevels: { 'night-fighter': 9 } });
    prepareItemModel(unit, V15_OVERFLOW_D20); expect(traitLevel(unit, 'night-fighter')).toBe(9); expect(traitLevel(unit, 'forest-lore')).toBe(1);
  });
  it('spawn 的原型按配装推断，写错或写了别的值都照常建档并提示；unit_set 写了不认识的原型保留原值', () => {
    const parsed = parseProtocol('<tb><spawn name="骑兵" side="enemy" scale="company" hpMax="40" mount="true" archetype="infantry" weapon="骑枪:长兵器L3"/><spawn name="炮兵" side="enemy" scale="company" hpMax="12" body="vehicle" archetype="artillery" weapon="曲射火炮L6"/><spawn name="步兵" side="enemy" scale="company" hpMax="30" archetype="cavalry" weapon="剑L3"/></tb>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events.map((e) => e.kind === 'spawn' && e.archetype)).toEqual(['mobile', 'ranged', 'infantry']);
    expect(parsed.warnings.filter((w) => w.includes('不再使用'))).toHaveLength(3);
    const { save } = commit(empty(), '<spawn name="步兵" side="ally" scale="hero" weapon="剑L3" archetype="dragon"/>');
    expect(save.storage![0]!.archetype).toBe('infantry');
    const bad = parseProtocol('<tb><unit_set id="u1" archetype="cavalry" level="4"/></tb>');
    expect(bad.errors).toEqual([]); expect(bad.canonical).toBe('<unit_set id="u1" level="4"/>'); expect(bad.warnings.join()).toContain('保留原值');
    expect(parseProtocol('<tb><unit_set id="u1" archetype="cavalry"/></tb>').events).toEqual([]);
  });
});

describe('已佩戴列表的不叠加标注', () => {
  it('同方向修正只取最高一件、同一特质只算一次，被盖过的效果逐项列出；单位自带特质也算覆盖', () => {
    const worn = (id: string, spec: string) => { const parsed = parseItemSpecification(spec); const m = compileItem(parsed, { id, seed: id }); if (m.kind !== 'item') throw Error('fixture'); return gearItem(id, id, m.value); };
    const unit = { traits: ['stalk'], traitLevels:{stalk:6}, gear: [worn('ring', '佩戴L4+4防御'), worn('charm', '佩戴L3+2防御+1伤害'), worn('cloak', '潜伏、林地专精L6'), worn('boots', '林地专精L4'), worn('ring2', '佩戴L4+4防御')] };
    expect(overshadowedGear(unit, 'ring')).toEqual([]);
    expect(overshadowedGear(unit, 'charm')).toEqual(['+2防御']);
    expect(overshadowedGear(unit, 'cloak')).toEqual(['潜伏L6']);
    expect(overshadowedGear(unit, 'boots')).toEqual(['林地专精L4']);
    expect(overshadowedGear(unit, 'ring2')).toEqual(['+4防御']);
  });
});

describe('旧档转换与战外使用', () => {
  it('读档预览把旧版药剂与护符逐件转换，不当作损坏物品隔离；配件栏改为已佩戴，旧技能不再耗精力', () => {
    const review = reviewMigration(structuredClone(legacy.save) as unknown as NarrativeSave)!;
    expect(review.quarantined).toBe(0);
    expect(review.changes.filter((c) => c.startsWith('道具'))).toEqual([
      '道具「夜视镜」转为佩戴道具 夜战专精L5，仍装备在原单位', '道具「治疗护符」转为充能道具 充能增益治疗L3，仍装备在原单位',
      '道具「治疗药剂」转为一次性道具 增益治疗L3', '道具「投掷炸弹」转为一次性道具 物理范围投射L4']);
    expect(review.candidate.inventory!.filter((i) => i.mechanics?.kind === 'item').map((i) => [i.name, i.mechanics?.kind === 'item' && i.mechanics.value.recipe.form, i.equippedTo?.slot]))
      .toEqual([['夜视镜', 'worn', 'gear'], ['治疗护符', 'charged', 'gear'], ['治疗药剂', 'single', undefined], ['投掷炸弹', 'single', undefined]]);
    const hero = review.candidate.storage!.find((r) => r.id === 'hero')!.snapshot!;
    expect(hero.accessories).toBeUndefined(); expect(hero.gear!.map((g) => g.id)).toEqual(['night', 'charm']);
    expect(hero.abilities.find((a) => a.equipmentSourceId === 'charm')).toMatchObject({ usesPerBattle: 2 }); expect(hero.abilities.find((a) => a.equipmentSourceId === 'charm')!.cost).toBeUndefined();
    expect(activeTraitIds(hero)).toContain('night-fighter');
    expect(reviewMigration(structuredClone(review.candidate))).toBeUndefined();
  });
  it('进行中的旧战斗：携行记录随库存转换，快照里的行动原样冻结，继续用药照常从库存扣除', () => {
    const before = prepareInventoryState(structuredClone(legacy.inBattle) as unknown as InventorySave);
    const hero = (before.battle!.snap.combatants as Combatant[]).find((u) => u.id === 'hero')!;
    expect(hero.carriedItems!.map((c) => [c.id, c.mechanics.kind, !!c.action])).toEqual([['dose', 'item', true], ['bomb', 'item', true]]);
    const oldAction = structuredClone(legacy.inBattle.battle.snap.combatants.find((u: { id: string }) => u.id === 'hero')!.abilities.find((a: { itemSourceId?: string }) => a.itemSourceId === 'dose'));
    expect(hero.carriedItems![0]!.action).toEqual(oldAction);
    const battle = SmallBattle.fromSnapshot(structuredClone(before.battle!.snap), { traitRegistry: registry });
    battle.endTurn(); while (battle.active?.id !== 'hero') battle.endTurn();
    battle.byId('hero').hp -= 10;
    expect(battle.useAbility('hero', 'item:dose', 'hero').ok).toBe(true);
    const written = prepareBattleItemWrite(before, { ...before, battle: { kind: 'small', snap: structuredClone(battle.toSnapshot()) } });
    expect(written.inventory!.find((i) => i.id === 'dose')!.qty).toBe(1);
  });
  it('战外只能直接使用治疗、净化、回能道具', () => {
    const make = (active: string) => createInventoryItem('x', 'x', { kind: 'item', form: 'single', power: 3, active }, 'x', 1);
    expect(outOfBattleUse(make('generic:buff:heal'))).toBe(true);
    expect(outOfBattleUse(make('generic:buff:cleanse'))).toBe(true);
    expect(outOfBattleUse(make('generic:buff:restore'))).toBe(true);
    expect(outOfBattleUse(make('generic:physical-area:projectile'))).toBe(false);
    expect(outOfBattleUse(make('generic:buff:barrier'))).toBe(false);
    const unit = generateUnit({ name: '伤员', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [], hpMax: 40, hp: 10, weaponClass: 'sword' }, { seed: 'hurt', registry }).unit; unit.id = 'hurt';
    let save: InventorySave = { schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(unit)], inventory: [{ ...make('generic:buff:heal'), qty: 2, assignedTo: 'hurt' }] };
    save = prepareInventoryTransaction(save, { kind: 'use', itemId: 'x', unitId: 'hurt', id: 'use', expectedRevision: 1 });
    expect(save.inventory![0]!.qty).toBe(1); expect(save.storage![0]!.hp).toBeGreaterThan(10);
  });
});
