// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { equipmentDraft, equipmentFields, captureEquipment, equipmentSpecification } from './equipment-form.js';
import { parseItemSpecification } from './item-spec.js';
import { createInventoryItem, validateInventoryItem } from './inventory-state.js';
import { itemDescription } from './inventory-view.js';
import { parseProtocol } from './protocol.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope } from './narrative-state.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { newUnitDraft, buildUnit, unitDraftFromRecord, editUnitBuild } from './unit-builder.js';
import { unitForm } from './unit-form.js';
import { traitRegistry, equipmentCapacity } from '../../engine/src/index.js';
import { V28_OVERFLOW_D20, V29_OVERFLOW_D20 } from '../../engine/src/rules.js';
import { seededReinforcement } from './battle-step.js';

it('weight suffixes work through all equipment forms, inventory descriptions and saved physical validation', () => {
  for (const [kind, text, expected] of [['weapon', '机炮L5-1重量', 8 / 1.1],
    ['armor', '重甲L5+1重量', 6.6], ['shield', '中盾L5-2重量', 1.5 / 1.1 ** 2]] as const) {
    const draft = equipmentDraft(kind); draft.bonuses = parseItemSpecification(text).bonuses;
    document.body.innerHTML = equipmentFields('gear', draft);
    expect(document.body.textContent).toContain('重量');
    const input = document.querySelector<HTMLInputElement>('[data-role="gear-bonuses"]')!;
    expect(equipmentSpecification(captureEquipment('gear', draft)).bonuses).toEqual(draft.bonuses);
    input.value = ''; expect(captureEquipment('gear', draft).bonuses).toEqual({});
    const item = createInventoryItem(kind, kind, parseItemSpecification(text), kind);
    const restored = JSON.parse(JSON.stringify(item)); validateInventoryItem(restored);
    if (!restored.mechanics || restored.mechanics.kind === 'item') throw Error('unexpected consumable');
    expect(restored.mechanics.value.load).toBeCloseTo(expected);
    expect(itemDescription(item)).toContain('负重' + Number(expected.toFixed(2)));
  }
});

it('narrative spawn persists weight on weapons, armor and shields and opts into platform capacity', () => {
  const parsed = parseProtocol('<tb><spawn name="载具" side="ally" scale="hero" body="vehicle" level="L5" weapon="火炮:直射火炮L5-1重量+2精度" armor="超重甲L5+1重量" shield="能量盾L5-2重量"/></tb>');
  expect(parsed.errors).toEqual([]);
  const source: MessageEnvelope = { characterId: 'weight', chatId: 'c', branchId: 'b', messageId: '1', swipeId: '0', generationId: 'g', role: 'assistant', complete: true, text: parsed.canonical };
  const ns = namespaceOf(source), binding = captureGeneration({}, ns, 'g'); binding.complete = true;
  const save = prepareNarrativeTransaction({}, proposalFromMessage(source, binding)!, ns, true);
  const u = materializeUnitRecord(save.storage![0]!, traitRegistry());
  expect(u.loadModel).toBe('capacity-v2'); expect(equipmentCapacity(u)).toBe(28);
  expect(u.weapon!.load).toBeCloseTo(12 / 1.1); expect(u.armor!.load).toBeCloseTo(8.8);
  expect(u.shield!.load).toBeCloseTo(1 / 1.1 ** 2);
  expect(u.weapon!.recipe!.bonuses).toEqual({ weight: -1, accuracy: 2 });
});

it('new manual vehicles use platform levels and renaming preserves frozen equipment and weight', () => {
  const registry = traitRegistry(), draft = newUnitDraft();
  draft.name = '平台'; draft.body = 'vehicle'; draft.level = '4'; draft.primary.mechanism = 'cannon';
  draft.primary.bonuses = { weight: -3 }; draft.armor.tier = '3';
  expect(unitForm('new', draft, registry)).toContain('平台等级');
  expect(unitForm('new', draft, registry)).toContain('80%');
  const u = buildUnit(draft, registry, 'platform'); expect(equipmentCapacity(u)).toBe(24);
  const record = unitRecordFromCombatant(u), edited = unitDraftFromRecord(record); edited.name = '改名平台';
  const result = editUnitBuild(record, edited, registry).snapshot!;
  expect(result.loadModel).toBe('capacity-v2'); expect(result.weapon).toEqual(u.weapon); expect(result.armor).toEqual(u.armor);
});

it('reinforcements use new physical loads only in V29 and retain historical generation in saved V28 battles', () => {
  const registry = traitRegistry(), old = seededReinforcement('reinforcement', 'ally', 'mass:old', registry, V28_OVERFLOW_D20)!;
  const current = seededReinforcement('reinforcement', 'ally', 'mass:current', registry, V29_OVERFLOW_D20)!;
  expect(old.loadModel).toBeUndefined(); expect(old.numericModel).toBeUndefined(); expect(old.armor!.load).toBe(2);
  expect(current.loadModel).toBe('capacity-v2'); expect(current.numericModel).toBe('graded-v1'); expect(current.armor!.load).toBe(4);
  expect(current.formation?.members ?? current.hp).toBe(10);
});
