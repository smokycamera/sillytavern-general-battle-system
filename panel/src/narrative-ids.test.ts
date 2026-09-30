import { describe, expect, it } from 'vitest';
import { mapNarrativeReferences, mentionsNarrativeId, narrativeIds, prepareNarrativeIds } from './narrative-ids.js';

describe('公开短编号', () => {
  it('所有实例按类型编号，排序、删除、序列化重载后不复用旧编号', () => {
    const initial = prepareNarrativeIds({ storage: [{ id: 'first-unit' }, { id: 'second-unit' }], inventory: [
      { id: 'gun', mechanics: { kind: 'weapon' } }, { id: 'plate', mechanics: { kind: 'armor' } },
      { id: 'buckler', mechanics: { kind: 'shield' } }, { id: 'potion', mechanics: { kind: 'consumable' } },
      { id: 'ring', mechanics: { kind: 'accessory' } },
    ] });
    const ids = narrativeIds(initial);
    expect(['first-unit', 'second-unit', 'gun', 'plate', 'buckler', 'potion', 'ring'].map(ids.publicId)).toEqual(['u1', 'u2', 'w1', 'a1', 'a2', 'c1', 'i1']);
    const reopened = JSON.parse(JSON.stringify({ ...initial, storage: [{ id: 'second-unit' }, { id: 'third-unit' }], inventory: [...initial.inventory].reverse() }));
    const after = narrativeIds(reopened);
    expect(after.publicId('second-unit')).toBe('u2'); expect(after.publicId('third-unit')).toBe('u3');
    expect(after.realId('u1')).toBe('first-unit'); expect(after.publicId('gun')).toBe('w1');
    expect(after.realId('Ｕ００２')).toBe('second-unit'); expect(after.realId('second-unit')).toBe('second-unit');
    expect(initial.storage).toHaveLength(2);
  });
  it('仅身份字段往返替换，保留同名显示文字、备注和机制定义', () => {
    const resolve = (id: string) => ({ saved: 'u1', skill: 'k1', effect: 's1' } as Record<string, string>)[id] ?? id;
    const input = { id: 'saved', name: 'saved', note: 'saved', definitionId: 'skill', conditions: [{ id: 'saved', dur: 1 }],
      preparedAbilityIds: ['skill'], skills: [{ id: 'skill', spec: { id: 'skill' } }], effects: [{ source: 'effect' }],
      abilityState: [{ abilityId: 'skill' }] };
    expect(mapNarrativeReferences(input, resolve)).toEqual({ ...input, id: 'u1', preparedAbilityIds: ['k1'],
      skills: [{ id: 'k1', spec: { id: 'skill' } }], effects: [{ source: 's1' }], abilityState: [{ abilityId: 'k1' }] });
    expect(input.id).toBe('saved');
  });
  it('点名u10不会顺便匹配u1，编号可紧接中文或引号', () => {
    expect(mentionsNarrativeId('请调整u10的装备', 'u1')).toBe(false);
    expect(mentionsNarrativeId('请调整u1的装备', 'u1')).toBe(true);
    expect(mentionsNarrativeId('id="u1"', 'u1')).toBe(true);
    expect(mentionsNarrativeId('old-u1-copy', 'u1')).toBe(false);
    expect(mentionsNarrativeId('任意正文', '')).toBe(false);
  });
});
