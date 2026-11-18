import { expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, traitRegistry, V3_D20, V23_OVERFLOW_D20 } from '../../engine/src/index.js';
import { editUnitRecord, deployUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { recoverUnitRecord } from './post-battle-recovery.js';
import { narrativeIds } from './narrative-ids.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
import { parseProtocol } from './protocol.js';

it('makes healed dying heroes deployable and recovers only reversible cohort losses', () => {
  const reg = traitRegistry();
  const hero = generateUnit({ name: 'hero', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', traits: [] }, { seed: 'recover' }).unit;
  hero.hp = 0; hero.status = 'dying'; hero.xp = 123;
  const record = unitRecordFromCombatant(hero), recovered = recoverUnitRecord(record, reg);
  const edited = editUnitRecord(record, { ...record, hp: record.base.hpMax }, reg);
  for (const result of [recovered, edited]) {
    expect(result).toMatchObject({ hp: record.base.hpMax, status: 'ready', xp: 123 });
    expect(deployUnitRecord([result], [], result.id, reg)[0]?.status).toBe('ready');
    expect(result.snapshot?.weapon).toEqual(record.snapshot?.weapon);
  }
  expect(record.status).toBe('dying');
  expect(() => recoverUnitRecord({ ...record, status: 'dead' }, reg)).toThrow('阵亡');
  const troop = generateUnit({ name: 'troop', side: 'ally', scale: 'company', level: 3, rulesVersion: 'v2', traits: [] }, { seed: 'recover-troop' }).unit;
  troop.hp = 60; troop.base.hpMax = 100; troop.recoverableWounded = 15;
  expect(recoverUnitRecord(unitRecordFromCombatant(troop), reg)).toMatchObject({ hp: 75, recoverableWounded: 0 });
});

function woundedCompany(memberLife = true, id = 'stored-company'): NarrativeSave {
  const unit = generateUnit({ name: '伤兵连', side: 'ally', scale: 'company', level: 3, rulesVersion: 'v2', hp: 60, hpMax: 100, traits: [] }, { seed: id }).unit;
  unit.id = id;
  prepareCombatModel(unit, memberLife ? V23_OVERFLOW_D20 : V3_D20, 20);
  if (memberLife) unit.formation!.health = [{ hp: 10, count: 2 }, { hp: 20, count: 58 }];
  unit.recoverableWounded = 15;
  unit.morale = 25;
  return { storage: [unitRecordFromCombatant(unit)], rosterIds: [unit.id], factRevision: 1, storySync: true };
}

function submitRecovery(save: NarrativeSave, tags: string, messageId = 'recovery') {
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'main', messageId, generationId: messageId,
    swipeId: '0', role: 'assistant', complete: true, text: `<tb>${tags}</tb>` };
  const namespace = namespaceOf(source), binding = captureGeneration(save, namespace, messageId);
  binding.complete = true;
  return prepareNarrativeTransaction(save, proposalFromMessage(source, binding)!, namespace);
}

it('treats existing members before returning wounded soldiers and deduplicates a repeated event', () => {
  const save = woundedCompany(), before = structuredClone(save), original = save.storage![0]!;
  const id = narrativeIds(save).publicId(original.id), tag = `<recover id="${id}" life="120"/>`;
  const next = submitRecovery(save, tag + tag);
  expect(next.storage![0]).toMatchObject({ hp: 65, base: { hpMax: 100 }, recoverableWounded: 10, morale: 25,
    snapshot: { formation: { health: [{ hp: 20, count: 65 }] } } });
  expect(next.rosterIds).toEqual(save.rosterIds);
  expect(next.proposals?.at(-1)?.events).toHaveLength(1);
  expect(save).toEqual(before);
  expect(() => submitRecovery(next, tag)).toThrow('此消息已经提交');
});

it('recovers two companies in one batch, including a count-only archive', () => {
  const save = woundedCompany(), legacy = woundedCompany(false, 'older-company').storage![0]!;
  save.storage!.push(legacy);
  const perMember = legacy.snapshot!.formation!.memberHp;
  const next = submitRecovery(save, '<recover id="stored-company" life="all"/>' + `<recover id="older-company" life="${perMember * 2 + 1}"/>`);
  expect(next.storage![0]).toMatchObject({ hp: 75, base: { hpMax: 100 }, recoverableWounded: 0, morale: 25,
    snapshot: { formation: { health: [{ hp: 20, count: 75 }] } } });
  expect(next.storage![1]).toMatchObject({ hp: 62, recoverableWounded: 13 });
});

it('reports an invalid budget and refuses inconsistent or unavailable recovery atomically', () => {
  const save = woundedCompany(), before = structuredClone(save);
  const tag = '<recover id="stored-company" life="120"/>';
  for (const amount of ['', '0', '-1', '1.5', '9007199254740992']) {
    const result = parseProtocol(`<recover id="stored-company" life="${amount}"/>`);
    expect(result.diagnostics[0]).toMatchObject({ event: 'recover', field: 'life' });
  }
  expect(() => submitRecovery(save, tag + '<recover id="stored-company" life="240"/>')).toThrow('治疗量冲突');
  expect(() => submitRecovery(save, tag + '<recover id="unknown" life="all"/>')).toThrow('缺失');
  expect(() => submitRecovery({ ...save, battle: { kind: 'small', snap: { seed: 'active' } } }, tag)).toThrow('战内');
  const retired = { ...save, storage: [{ ...save.storage![0]!, retired: true as const }] };
  expect(() => submitRecovery(retired, tag)).toThrow('解散');
  expect(save).toEqual(before);
});
