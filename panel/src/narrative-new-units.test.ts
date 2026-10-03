import { describe, expect, it } from 'vitest';
import { generateUnit, resolveTraitId, traitRegistry } from '../../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { captureGeneration, namespaceOf, narrativeDeploymentIds, prepareAiScanProposal, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
import { narrativeIds } from './narrative-ids.js';
import { parseProtocol } from './protocol.js';

const registry = traitRegistry();
function fixture(): NarrativeSave {
  const storage = ['李华', '赤翼骑兵连', '弓兵队'].map((name, i) => {
    const unit = generateUnit({ rulesVersion: 'v2', name, scale: i ? 'company' : 'hero', side: 'ally', level: 3, hp: 40, hpMax: 60, traits: [] }, { registry, seed: 'new-units-' + i }).unit;
    unit.id = 'record-' + i; return unitRecordFromCombatant(unit);
  });
  return { schemaVersion: 2, factRevision: 1, storySync: true, storage, rosterIds: ['record-0', 'record-1'] };
}
function proposal(save: NarrativeSave, text: string, id = 'next') {
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'main', messageId: id, swipeId: '0', role: 'assistant', complete: true, generationId: id, text: `<tb>\n${text}\n</tb>` };
  const namespace = namespaceOf(source), binding = captureGeneration(save, namespace, id); binding.complete = true;
  const candidate = proposalFromMessage(source, binding)!;
  expect(candidate.status, candidate.reason).toBe('pending');
  return { candidate, namespace };
}
function commit(save: NarrativeSave, text: string, id = 'next') {
  const { candidate, namespace } = proposal(save, text, id);
  return prepareNarrativeTransaction(save, candidate, namespace, true);
}
const byName = (save: NarrativeSave, name: string) => save.storage!.filter(r => r.name === name);
const handle = (save: NarrativeSave, name: string) => narrativeIds(save).publicId(byName(save, name)[0]!.id);
const spawnTag = (id: string, name = '灰羽弓兵', extra = '') => `<spawn id="${id}" name="${name}" side="ally" scale="company" hpMax="20" level="3" weapon="长弓:弓弩L3"${extra}/>`;

describe('spawn 写的 id 一律略过', () => {
  it('不提示、不写进事件，新单位编号由插件分配', () => {
    const parsed = parseProtocol(spawnTag('u7'));
    expect(parsed.errors).toEqual([]); expect(parsed.warnings.join()).not.toMatch(/\bid\b/);
    expect(parsed.canonical).not.toMatch(/id=/); expect(parsed.events[0]).not.toHaveProperty('ref');
    const save = fixture(), next = commit(save, spawnTag('u7'));
    expect(handle(next, '灰羽弓兵')).toBe('u4');
    expect(commit(save, spawnTag('u2'), 'taken').storage!.find(r => r.id === 'record-1')).toEqual(save.storage!.find(r => r.id === 'record-1'));
  });
  it('同一回复 deploy 这个编号：多余的出场被略过，其余单位照常', () => {
    const save = fixture();
    const parsed = parseProtocol(`${spawnTag('u7')}<deploy id="u7"/><deploy id="u1"/>`);
    expect(parsed.events.map(e => e.kind)).toEqual(['spawn', 'deploy']); expect(parsed.warnings.join()).toMatch(/已略过 deploy u7/);
    const next = commit(save, `${spawnTag('u7')}\n<deploy id="u7"/>\n<deploy id="u1"/>`);
    expect(next.rosterIds).toEqual([byName(next, '灰羽弓兵')[0]!.id, 'record-0']);
    expect(byName(commit(save, `${spawnTag('U08', '民兵', ' count="2"')}\n<deploy id="u8"/>`, 'two'), '民兵')).toHaveLength(2);
  });
  it('同一回复用这个编号学习或修改：说明编号由插件分配，整批待补全，不会改到同号的已有单位', () => {
    for (const text of [`${spawnTag('u7')}<learn id="u7" skills="齐射:物理范围+射击L4"/>`, `<unit_set id="u2" note="新兵"/>${spawnTag('u2')}`]) {
      const parsed = parseProtocol(text);
      expect(parsed.errors.join()).toMatch(/spawn 自编的编号，新单位的编号由插件分配/);
    }
  });
});

describe('unit_set 写了不存在的编号', () => {
  it('给出完整新单位字段：新建入档，沿用该编号，不改出场名单', () => {
    const save = fixture(), before = structuredClone(save);
    const next = commit(save, '<unit_set id="u9" name="王芳" side="ally" scale="hero" level="4" xpProgress="12" weapon="猎弓:弓弩L4" skills="穿云箭:物理单体+射击L4" traits="林间行者" note="自愿加入的游侠" reason="入队"/>');
    expect(save).toEqual(before);
    const [record] = byName(next, '王芳');
    expect(byName(next, '王芳')).toHaveLength(1); expect(handle(next, '王芳')).toBe('u9');
    expect(next.rosterIds).toEqual(save.rosterIds);
    const unit = materializeUnitRecord(record!, registry);
    expect(unit).toMatchObject({ side: 'ally', scale: 'hero', level: 4, status: 'ready' });
    expect(unit.weapon?.name).toBe('猎弓'); expect(unit.abilities.map(a => a.name)).toContain('穿云箭'); expect(unit.traits).toContain(resolveTraitId('林间行者'));
    expect(record!.note).toBe('自愿加入的游侠');
    // 下一条回复按这个编号修改的就是同一单位。
    const later = commit(next, '<unit_update id="u9" hp="1"/>', 'later');
    expect(byName(later, '王芳')[0]!.hp).toBe(1);
  });
  it('同一回复用这个编号学习、祝福、补字段与出场，都落到新单位上', () => {
    const save = fixture();
    const next = commit(save, ['<unit_set id="u12" name="王芳" side="ally" scale="hero" level="4"/>', '<learn id="u12" skills="呼叫炮击:物理范围+射击L6"/>',
      '<bless id="u12" traits="快速" battles="2"/>', '<unit_set id="u12" note="新到的游侠"/>', '<deploy id="u12"/>'].join('\n'));
    const [record] = byName(next, '王芳'), unit = materializeUnitRecord(record!, registry);
    expect(handle(next, '王芳')).toBe('u12');
    expect(unit.abilities.map(a => a.name)).toContain('呼叫炮击'); expect(unit.traitSources?.flatMap(s => s.traitIds)).toContain(resolveTraitId('快速'));
    expect(record!.note).toBe('新到的游侠'); expect(next.rosterIds).toEqual([record!.id]);
  });
  it('编号指向已有同名档案时修改原档案，不重复建档', () => {
    const save = fixture();
    const next = commit(save, '<unit_set id="u12" name="赤翼骑兵连" side="ally" scale="company" hpMax="80" hp="80" level="4"/>');
    expect(byName(next, '赤翼骑兵连')).toHaveLength(1);
    expect(byName(next, '赤翼骑兵连')[0]).toMatchObject({ id: 'record-1', hp: 80, level: 4 });
    expect(next.storage).toHaveLength(3);
  });
  it('既不是已有单位也写不全新单位时，说明编号缺失而不是“过期”，自动批准时留作待补全', () => {
    const save = fixture(), before = structuredClone(save);
    expect(() => commit(save, '<unit_set id="u9" level="5"/>')).toThrow(/u9 缺失.*spawn/);
    expect(save).toEqual(before);
    const scanned = prepareAiScanProposal(save, namespaceOf({ characterId: 'c', chatId: 'chat', branchId: 'main' }), '<tb>\n<unit_set id="u9" level="5"/>\n</tb>');
    const failed = scanned.proposals!.at(-1)!;
    expect(failed.status).toBe('unresolved'); expect(failed.reason).not.toMatch(/过期/);
  });
  it('编号已被删除的单位占用时另配编号，同一回复里的引用仍指向新单位', () => {
    const save = fixture();
    const removed = { ...save, storage: save.storage!.filter(r => r.id !== 'record-2'), narrativeIdState: narrativeIds(save).state };
    const next = commit(removed, '<unit_set id="u3" name="新弓兵" side="ally" scale="company" hpMax="20"/>\n<unit_set id="u3" note="补位"/>');
    const [record] = byName(next, '新弓兵');
    expect(record!.note).toBe('补位'); expect(handle(next, '新弓兵')).not.toBe('u3');
    expect(narrativeIds(next).realId('u3')).toBe('record-2');
  });
  it('只入档的新单位不进恢复出场名单；同批 deploy 才上场', () => {
    const save = fixture();
    const archived = commit(save, '<unit_set id="u9" name="王芳" side="ally" scale="hero" level="4"/>', 'a');
    expect(narrativeDeploymentIds(archived, archived.proposals!.at(-1)!.id)).toEqual([]);
    const deployed = commit(save, '<unit_set id="u9" name="王芳" side="ally" scale="hero" level="4"/>\n<deploy id="u9"/>', 'b');
    const id = byName(deployed, '王芳')[0]!.id;
    expect(deployed.rosterIds).toEqual([id]);
    expect(narrativeDeploymentIds(deployed, deployed.proposals!.at(-1)!.id)).toEqual([id]);
  });
  it('照抄单位资料里的 training 时按训练等级处理', () => {
    const next = commit(fixture(), '<unit_set id="u1" level="5" training="5"/>');
    expect(next.storage!.find(r => r.id === 'record-0')!.level).toBe(5);
  });
});
