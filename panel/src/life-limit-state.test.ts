import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, prepareCombatModel, V4_D20 } from '../../engine/src/index.js';
import { SINGLE_LIFE_LIMIT } from '../../engine/src/health-limits.js';
import { parseProtocol } from './protocol.js';
import { normalizeUnitRecord, unitRecordFromCombatant, updateUnitRecord, materializeUnitRecord, migratePanelUnits } from './unit-state.js';
import { newUnitDraft, buildUnit, unitDraftFromRecord, editUnitBuild } from './unit-builder.js';
import { proposalFromMessage, captureGeneration, namespaceOf, prepareNarrativeTransaction, type MessageEnvelope } from './narrative-state.js';
const registry = traitRegistry();
const message: MessageEnvelope = { characterId: 'test', chatId: 'life-cap', branchId: 'main', messageId: '1', swipeId: '0', generationId: 'generation', role: 'assistant', complete: true,
  text: '<tb>\n<spawn name="帝皇" side="ally" scale="hero" hpMax="100000" hp="100000" level="10"/>\n<spawn name="死星" side="enemy" scale="hero" body="vehicle" hpMax="100000" hp="100000" level="10"/>\n</tb>' };

describe('生命上限贯穿正文、编辑与档案', () => {
  // 英雄生命由训练、身体和修正推导，正文 hp/hpMax 只按比例表示伤势，写多大都不会成为生命上限，所以解析时不再截断提示。
  it('正文英雄高生命照常解析，编队人数保留原值，非法值报错', () => {
    const parsed = parseProtocol(message.text); expect(parsed.errors).toEqual([]);
    expect(parsed.events).toMatchObject([{ hp: 100000, hpMax: 100000 }, { hp: 100000, hpMax: 100000, body: 'vehicle' }]);
    expect(parseProtocol('<tb><spawn name="十万人" side="ally" scale="company" hpMax="100000"/></tb>').events[0]).toMatchObject({ hpMax: 100000 });
    // 英雄的 hp/hpMax 只换算伤势，写错不阻止建档；编队的人数写错仍报错。
    const hero = parseProtocol('<tb><spawn name="非法" side="ally" scale="hero" hpMax="-1"/></tb>');
    expect(hero.errors).toEqual([]); expect(hero.events[0]).toMatchObject({ kind: 'spawn' }); expect((hero.events[0] as { hpMax?: number }).hpMax).toBeUndefined();
    expect(parseProtocol('<tb><spawn name="非法" side="ally" scale="company" hpMax="-1"/></tb>').errors.length).toBeGreaterThan(0);
  });
  it('正文事务不能用事件里的生命值覆盖推导出的生命上限', () => {
    const save = { storage: [], rosterIds: [], factRevision: 1 }, namespace = namespaceOf(message);
    const binding = { ...captureGeneration(save, namespace, 'generation'), complete: true };
    const proposal = proposalFromMessage(message, binding)!;
    // 模拟旧客户端已经保存的尚未应用草稿，绕过新版解析器仍需被生成器限制。
    for (const event of proposal.events) if (event.kind === 'spawn') { event.hp = 100000; event.hpMax = 100000; }
    const next = prepareNarrativeTransaction(save, proposal, namespace, true);
    const [human, vehicle] = next.storage!;
    expect(next.storage).toHaveLength(2); expect(next.storage!.every(record => record.hp === record.base.hpMax && record.base.hpMax <= SINGLE_LIFE_LIMIT)).toBe(true);
    expect(vehicle!.base.hpMax).toBeGreaterThan(human!.base.hpMax * 5);
  });
  it('旧档加载同步外层和快照，保留较低伤势、零生命、单位版本与历史', () => {
    const unit = generateUnit({ rulesVersion: 'v2', name: '旧档', side: 'ally', scale: 'hero', level: 6, hpMax: 1000, traits: [] }, { registry, seed: 'old' }).unit;
    prepareCombatModel(unit, V4_D20); const original = unitRecordFromCombatant(unit);
    original.base.hpMax = original.snapshot!.base.hpMax = 100000; original.hp = original.snapshot!.hp = 73;
    const copied = structuredClone(original), limited = normalizeUnitRecord(original);
    expect(original).toEqual(copied); expect(limited.base.hpMax).toBe(1000); expect(limited.snapshot!.base.hpMax).toBe(1000); expect(limited.hp).toBe(73);
    expect(limited.revision).toBe(original.revision); expect(limited.history).toEqual(original.history); expect(normalizeUnitRecord(limited)).toEqual(limited);
    const loaded = migratePanelUnits({ storage: [original], rosterIds: [original.id], registry }); expect(loaded.backup).toHaveLength(0); expect(loaded.roster[0]!.hp).toBe(73);
    original.hp = original.snapshot!.hp = 0; original.status = original.snapshot!.status = 'dead'; expect(normalizeUnitRecord(original).hp).toBe(0);
  });
  it('单位更新与手动编辑统一限制生命；成员上限不影响人数', () => {
    const draft = newUnitDraft(); draft.name = '单体'; draft.hpMax = draft.hp = '100000';
    const unit = buildUnit(draft, registry, 'single'); const record = unitRecordFromCombatant(unit);
    expect(unit.base.hpMax).toBe(SINGLE_LIFE_LIMIT); expect(updateUnitRecord(record, { hp: 100000, hpMax: 100000 }, registry).hp).toBe(SINGLE_LIFE_LIMIT);
    const edit = unitDraftFromRecord(record); edit.hpMax = edit.hp = '100000'; expect(editUnitBuild(record, edit, registry).base.hpMax).toBe(SINGLE_LIFE_LIMIT);
    draft.scale = 'company'; draft.hpMax = draft.hp = '100000'; draft.memberHp = '100000';
    const company = buildUnit(draft, registry, 'company'); expect(company.hp).toBe(100000); expect(company.formation!.memberHp).toBe(SINGLE_LIFE_LIMIT);
    const loaded = materializeUnitRecord(unitRecordFromCombatant(company), registry); expect(loaded.hp).toBe(100000); expect(loaded.formation!.memberHp).toBe(SINGLE_LIFE_LIMIT);
  });
});
