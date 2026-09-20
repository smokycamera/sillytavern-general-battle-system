import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, prepareCombatModel, V4_D20 } from '../../engine/src/index.js';
import { parseProtocol } from './protocol.js';
import { normalizeUnitRecord, unitRecordFromCombatant, updateUnitRecord, materializeUnitRecord, migratePanelUnits } from './unit-state.js';
import { newUnitDraft, buildUnit, unitDraftFromRecord, editUnitBuild } from './unit-builder.js';
import { proposalFromMessage, captureGeneration, namespaceOf, prepareNarrativeTransaction, type MessageEnvelope } from './narrative-state.js';
const registry = traitRegistry();
const message: MessageEnvelope = { characterId: 'test', chatId: 'life-cap', branchId: 'main', messageId: '1', swipeId: '0', generationId: 'generation', role: 'assistant', complete: true,
  text: '<tb>\n<spawn name="帝皇" side="ally" scale="hero" hpMax="100000" hp="100000" level="10"/>\n<spawn name="死星" side="enemy" scale="hero" body="vehicle" hpMax="100000" hp="100000" level="10"/>\n</tb>' };

describe('生命上限贯穿正文、编辑与档案', () => {
  it('正文高生命自动截断并给出提示，编队人数保留原值', () => {
    const parsed = parseProtocol(message.text); expect(parsed.errors).toEqual([]); expect(parsed.warnings.join('')).toContain('1000');
    expect(parsed.events).toMatchObject([{ hp: 1000, hpMax: 1000 }, { hp: 1000, hpMax: 1000 }]);
    expect(parseProtocol('<tb><spawn name="十万人" side="ally" scale="company" hpMax="100000"/></tb>').events[0]).toMatchObject({ hpMax: 100000 });
    expect(parseProtocol('<tb><spawn name="非法" side="ally" scale="hero" hpMax="-1"/></tb>').errors.length).toBeGreaterThan(0);
  });
  it('正文事务不能在生成后用旧事件值覆盖生命上限', () => {
    const save = { storage: [], rosterIds: [], factRevision: 1 }, namespace = namespaceOf(message);
    const binding = { ...captureGeneration(save, namespace, 'generation'), complete: true };
    const proposal = proposalFromMessage(message, binding)!;
    // 模拟旧客户端已经保存的尚未应用草稿，绕过新版解析器仍需被生成器限制。
    for (const event of proposal.events) if (event.kind === 'spawn') { event.hp = 100000; event.hpMax = 100000; }
    const next = prepareNarrativeTransaction(save, proposal, namespace, true);
    expect(next.storage).toHaveLength(2); expect(next.storage!.every(record => record.hp === 1000 && record.base.hpMax === 1000)).toBe(true);
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
    expect(unit.base.hpMax).toBe(1000); expect(updateUnitRecord(record, { hp: 100000, hpMax: 100000 }, registry).hp).toBe(1000);
    const edit = unitDraftFromRecord(record); edit.hpMax = edit.hp = '100000'; expect(editUnitBuild(record, edit, registry).base.hpMax).toBe(1000);
    draft.scale = 'company'; draft.hpMax = draft.hp = '100000'; draft.memberHp = '100000';
    const company = buildUnit(draft, registry, 'company'); expect(company.hp).toBe(100000); expect(company.formation!.memberHp).toBe(1000);
    const loaded = materializeUnitRecord(unitRecordFromCombatant(company), registry); expect(loaded.hp).toBe(100000); expect(loaded.formation!.memberHp).toBe(1000);
  });
});
