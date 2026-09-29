import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import {
  captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage,
  restoreNarrativeDeployment, needsNarrativeDeploymentRestore, type MessageEnvelope, type NarrativeSave,
} from './narrative-state.js';

const registry = traitRegistry();
function fixture(count = 4): NarrativeSave {
  return { schemaVersion: 2, factRevision: 1, storySync: true,
    storage: Array.from({ length: count }, (_, i) => {
      const unit = generateUnit({ rulesVersion: 'v2', name: `单位${i}`, scale: 'company', side: 'ally', level: 3, hp: 20, hpMax: 30, traits: [] }, { registry, seed: `roster-${i}` }).unit; unit.id = `u${i}`; if (unit.weapon) unit.weapon.id = `unit:u${i}:primary`; if (unit.armor) unit.armor.id = `unit:u${i}:armor`;
      unit.side = i % 2 ? 'enemy' : 'ally'; return unitRecordFromCombatant(unit);
    }), rosterIds: ['u0', 'u1'] };
}
function proposal(save: NarrativeSave, text: string, id = 'next') {
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'main', messageId: id,
    swipeId: '0', role: 'assistant', complete: true, generationId: id, text: `<tb>${text}</tb>` };
  const namespace = namespaceOf(source), binding = captureGeneration(save, namespace, id); binding.complete = true;
  const candidate = proposalFromMessage(source, binding)!;
  expect(candidate.status, candidate.reason).toBe('pending');
  return { candidate, namespace };
}
function commit(save: NarrativeSave, text: string, id = 'next', manual = true) {
  const { candidate, namespace } = proposal(save, text, id);
  return prepareNarrativeTransaction(save, candidate, namespace, manual);
}

describe('每批明确出场名单取代上一场，而非累加', () => {
  it.each([true, false])('已有档案的 deploy 替换双方旧名单，保留档案和装备（manual=%s）', manual => {
    const save = fixture(), before = structuredClone(save);
    const next = commit(save, '<deploy id="u2"/><deploy id="u3"/>', 'deploy', manual);
    expect(next.rosterIds).toEqual(['u2', 'u3']); expect(next.storage).toEqual(save.storage);
    expect(save).toEqual(before);
  });
  it('spawn 批次只部署新单位，重复角色通过 deploy 沿用原身份', () => {
    const save = fixture();
    const next = commit(save, '<deploy id="u0"/><spawn name="新敌军" side="enemy" scale="company" hpMax="50"/>');
    const spawned = next.storage!.find(r => r.name === '新敌军')!;
    expect(next.rosterIds).toEqual(['u0', spawned.id]); expect(next.storage).toHaveLength(5);
    expect(next.storage!.slice(0, 4)).toEqual(save.storage);
  });
  it('只含 spawn、不含 field 也建立独立名单', () => {
    const next = commit(fixture(), '<spawn name="新双方" side="enemy" scale="company" hpMax="30" count="2"/>');
    expect(next.rosterIds).toHaveLength(2); expect(next.rosterIds).not.toContain('u0');
    expect(next.storage).toHaveLength(6);
  });
  it('连续确认和序列化重载不把任意前批名单带回', () => {
    const first = commit(fixture(), '<deploy id="u2"/><deploy id="u3"/>', 'first');
    const second = commit(JSON.parse(JSON.stringify(first)), '<deploy id="u0"/><deploy id="u2"/><deploy id="u2"/>', 'second');
    expect(second.rosterIds).toEqual(['u0', 'u2']); expect(second.storage).toHaveLength(4);
    const third = commit(second, '<deploy id="u1"/>', 'third');
    expect(third.rosterIds).toEqual(['u1']); expect(third.proposals).toHaveLength(3);
  });
  it('先 deploy、后补员和换装仍使用最终档案，未部署的被治疗单位不上场', () => {
    const next = commit(fixture(), '<deploy id="u2"/><unit_update id="u2" hp="25"/><unit_set id="u2" level="4"/>'
      + '<unit_update id="u0" hp="30"/><reforge id="unit:u2:primary" name="换装步枪" spec="步枪L4"/>');
    expect(next.rosterIds).toEqual(['u2']); expect(next.storage!.find(r => r.id === 'u0')!.hp).toBe(30);
    const unit = materializeUnitRecord(next.storage!.find(r => r.id === 'u2')!, registry);
    expect(unit.hp).toBe(25); expect(unit.level).toBe(4); expect(unit.weapon!.name).toBe('换装步枪');
  });
  it.each(['<unit_update id="u0" hp="25"/>', '<unit_set id="u0" note="战外更新"/>',
    '<field env="forest" light="night"/>', '<give item="药草" qty="2"/>',
    '<reforge id="unit:u0:primary" name="新武器" spec="剑L4"/>'])('没有出场指令的事务保留当前名单：%s', text => {
    const save = fixture(); expect(commit(save, text).rosterIds).toEqual(save.rosterIds);
  });
  it('已结算战斗的新名单替换残留；战内或未结算时仍拒绝', () => {
    const save = fixture(); save.battle = { kind: 'small', snap: { seed: 'last' } };
    const before = structuredClone(save);
    expect(() => commit(save, '<deploy id="u2"/>')).toThrow(/战内|未结算/); expect(save).toEqual(before);
    save.committedOutcomeIds = ['small:last'];
    const next = commit(save, '<deploy id="u2"/>'); expect(next.rosterIds).toEqual(['u2']);
    expect(next.battle).toEqual(save.battle); expect(next.committedOutcomeIds).toEqual(save.committedOutcomeIds);
  });
  it('坏批次整包回滚，不清空旧名单也不应用前面的治疗', () => {
    const save = fixture(), before = structuredClone(save);
    expect(() => commit(save, '<unit_update id="u0" hp="30"/><deploy id="missing"/>')).toThrow();
    expect(save).toEqual(before);
    expect(() => commit(save, '<unit_update id="u2" hp="0"/><deploy id="u2"/>')).toThrow();
    expect(save).toEqual(before);
  });
  it('历史满员名单不占新场名额，新场自身仍限制32卡', () => {
    const save = fixture(40); save.rosterIds = save.storage!.slice(0, 32).map(r => r.id);
    const next = commit(save, '<deploy id="u32"/><spawn name="新部队" side="enemy" scale="company" hpMax="30" count="20"/>');
    expect(next.rosterIds).toHaveLength(21); expect(next.rosterIds![0]).toBe('u32'); expect(next.storage).toHaveLength(60);
    const before = structuredClone(save);
    const twenty = Array.from({ length: 20 }, (_, i) => `<deploy id="u${i}"/>`).join('');
    expect(() => commit(save, twenty + '<spawn name="B" side="enemy" scale="hero" count="13"/>')).toThrow(/上限|最多/);
    expect(save).toEqual(before);
    expect(commit(save, twenty + '<spawn name="B" side="enemy" scale="hero" count="12"/>').rosterIds).toHaveLength(32);
  });
  it('旧超限存档仍可纯治疗，但不能建立新的超限名单', () => {
    const save = fixture(40); save.rosterIds = save.storage!.map(r => r.id);
    expect(commit(save, '<unit_update id="u0" hp="25"/>').rosterIds).toHaveLength(40);
    expect(commit(save, '<deploy id="u2"/>').rosterIds).toEqual(['u2']);
  });
  it('恢复原批只恢复该批名单，不叠加、不重新生成或发奖，同数量换人也更新事实版本', () => {
    const first = commit(fixture(), '<deploy id="u0"/><deploy id="u1"/><give item="药草" qty="2"/>', 'first');
    const second = commit(first, '<deploy id="u2"/><deploy id="u3"/>', 'second');
    // Isolate restore from the initial-confirmation bug so the old implementation fails independently.
    second.rosterIds = ['u2', 'u3']; const before = structuredClone(second);
    const restored = restoreNarrativeDeployment(second, first.proposals![0]!.id);
    expect(restored.rosterIds).toEqual(['u0', 'u1']); expect(restored.factRevision).toBe(second.factRevision! + 1);
    expect(restored.storage).toEqual(second.storage); expect(restored.inventory).toEqual(second.inventory);
    expect(restored.proposals).toEqual(second.proposals); expect(second).toEqual(before);
    expect(restoreNarrativeDeployment(restored, first.proposals![0]!.id)).toEqual(restored);
  });
  it('历史恢复按钮也识别名单夹带旧单位，但不对空批次或同集合误提示', () => {
    const save = commit(fixture(), '<deploy id="u0"/><deploy id="u1"/>'), id = save.proposals![0]!.id;
    expect(needsNarrativeDeploymentRestore(save, id)).toBe(false);
    expect(needsNarrativeDeploymentRestore({ ...save, rosterIds: ['u1', 'u0'] }, id)).toBe(false);
    expect(needsNarrativeDeploymentRestore({ ...save, rosterIds: ['u0', 'u1', 'u2'] }, id)).toBe(true);
    expect(needsNarrativeDeploymentRestore({ ...save, rosterIds: ['u2', 'u3'] }, id)).toBe(true);
    expect(needsNarrativeDeploymentRestore(save, 'missing')).toBe(false);
  });
  it('恢复时排除阵亡/濒死/解散，空批次和未结算战斗拒绝且不改变名单', () => {
    const save = commit(fixture(), '<deploy id="u0"/><deploy id="u1"/>'); const id = save.proposals![0]!.id;
    save.rosterIds = ['u2', 'u3']; save.storage![0]!.status = 'dead';
    expect(restoreNarrativeDeployment(save, id).rosterIds).toEqual(['u1']);
    save.storage![1]!.retired = true; const before = structuredClone(save);
    expect(() => restoreNarrativeDeployment(save, id)).toThrow(/没有/); expect(save).toEqual(before);
    save.storage![1]!.retired = false; save.battle = { kind: 'mass', snap: { seed: 'active' } };
    expect(() => restoreNarrativeDeployment(save, id)).toThrow(/结算/);
  });
});
