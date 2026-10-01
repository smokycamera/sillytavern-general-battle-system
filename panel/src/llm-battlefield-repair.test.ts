import { describe, expect, it } from 'vitest';
import { normalizeBattlefieldPlan } from '../../engine/src/small/battlefield-plan.js';
import { validateSceneIntentEvidence } from '../../engine/src/small/scene-intent.js';
import { repairBattlefieldAnswer } from './llm-battlefield-repair.js';

const context = { sources: [{ id: 'm1.p1', text: '我们从南面渡河。' }, { id: 'm2.p1', text: '河上只有一座石桥，敌军守在桥北哨塔。' }], units: { u1: '李将军', u2: '守军', u3: '守军' } };
function strict(battlefield: unknown) {
  const plan = normalizeBattlefieldPlan(battlefield).plan!;
  validateSceneIntentEvidence(plan.intent!, context.sources, Object.keys(context.units));
  return plan.intent!;
}

describe('secondary API battlefield repair', () => {
  it('normalizes citation, label, anchor, ID and state slips so the strict scene validators accept them', () => {
    const { battlefield, notes } = repairBattlefieldAnswer({ battlefield: { scene: ' Field ', intent: { schema: 'v2', archetype: 'River Crossing', entities: [
      { id: '石桥', kind: 'Bridge', label: '石桥／唯一渡口', basis: 'explicit', sources: ['[m2.p1]'] },
      { id: 'river', kind: 'stream', basis: 'explicit', sources: 'm1.p1, m9.p9' },
      { id: '1tower', kind: 'tower', label: '“鹰巢”哨塔', anchor: 'NorthEast', height: '5', basis: 'explicit', sources: [] },
      { id: 'town', kind: 'city', state: 'destroyed', anchor: 'front_left' },
    ], relations: [
      { subject: '石桥', relation: 'crosses', object: 'river' },
      { subject: '1tower', relation: 'north_of', object: '石桥' },
    ], constraints: [{ kind: 'crossing_count', entity: 'river', value: '1', basis: 'explicit', sources: ['m2.p1'] }] } } }, context);
    const intent = strict(battlefield);
    expect(normalizeBattlefieldPlan(battlefield).plan).toMatchObject({ scene: 'field' });
    expect(intent.archetype).toBe('river_crossing');
    expect(intent.entities).toEqual([
      { id: 'bridge1', kind: 'bridge', label: '石桥·唯一渡口', basis: 'explicit', sources: ['m2.p1'] },
      { id: 'river', kind: 'river', basis: 'explicit', sources: ['m1.p1'] },
      { id: 'tower1', kind: 'tower', label: '鹰巢 哨塔', anchor: 'north_east', height: 3, basis: 'inferred', sources: [] },
      { id: 'town', kind: 'city', basis: 'inferred', sources: [] },
    ]);
    expect(intent.relations.map(r => [r.subject, r.relation, r.object])).toEqual([['bridge1', 'crosses', 'river'], ['tower1', 'north_of', 'bridge1']]);
    // A relation may name a place by its label as originally written.
    const named = repairBattlefieldAnswer({ battlefield: { intent: { entities: [{ id: 'b', kind: 'bridge', label: '石桥、渡口' }, { id: 't', kind: 'tower' }],
      relations: [{ subject: 't', relation: 'near', object: '石桥、渡口' }, { subject: 't', relation: 'near', object: '石桥·渡口' }] } } }, context);
    expect(strict(named.battlefield).relations).toMatchObject([{ subject: 't', relation: 'near', object: 'b' }]);
    expect(intent.constraints).toEqual([{ kind: 'crossing_count', entity: 'river', value: 1, basis: 'explicit', sources: ['m2.p1'] }]);
    expect(notes).toEqual(expect.arrayContaining(['部分地点方位无效，已改由关系或本地布局决定', '地表高度超出0—3，已截取', '部分地点状态不适用于该类型，已省略', '部分正文事实缺少有效段落引用，按推断处理']));
  });
  it('keeps forces on places, turns force directions into a side of that place and drops relations to nowhere', () => {
    const { battlefield, notes } = repairBattlefieldAnswer({ battlefield: { intent: { entities: [
      { id: 'bridge', kind: 'bridge', label: '石桥' }, { id: 'river', kind: 'river' }, { id: 'tower', kind: 'tower', label: '哨塔' },
    ], relations: [
      { subject: 'enemy', relation: 'north_of', object: 'river', basis: 'explicit', sources: ['m2.p1'] },
      { subject: 'ally', relation: 'approaches_from', object: 'south', basis: 'explicit', sources: ['m1.p1'] },
      { subject: '李将军', relation: 'guards', object: '石桥' },
      { subject: '守军', relation: 'occupies', object: 'tower' },
      { subject: 'u9', relation: 'guards', object: 'tower' },
      { subject: 'tower', relation: 'guards', object: 'bridge', basis: 'explicit', sources: ['m2.p1'] },
      { subject: 'tower', relation: 'near', object: 'enemy' },
      { subject: 'ally', relation: 'targets', object: 'tower' }, { subject: 'ally', relation: 'exits_at', object: 'bridge' },
    ] } } }, context);
    const intent = strict(battlefield);
    expect(intent.relations).toEqual([
      { subject: 'enemy', relation: 'near', object: 'river', region: 'north_bank', basis: 'inferred', sources: ['m2.p1'] },
      { subject: 'u1', relation: 'guards', object: 'bridge', basis: 'inferred', sources: [] },
      { subject: 'tower', relation: 'near', object: 'bridge', basis: 'inferred', sources: ['m2.p1'] },
      { subject: 'enemy', relation: 'near', object: 'tower', basis: 'inferred', sources: [] },
      { subject: 'ally', relation: 'targets', object: 'tower', basis: 'inferred', sources: [] },
    ]);
    // 守军 names two units, so it is ambiguous; u9 is not in the battle.
    expect(notes).toEqual(expect.arrayContaining(['3条无法对应地点或部队的关系未采用', '任务地点只能有一处，已保留第一处']));
  });
  it('accepts a flattened, top-level or JSON-string scene and merges a second river into the main one', () => {
    for (const answer of [
      { battlefield: { scene: 'field', entities: [{ id: 'r1', kind: 'river' }], relations: [], constraints: [] } },
      { battlefield: { scene: 'field' }, intent: { entities: [{ id: 'r1', kind: 'river' }] } },
      { intent: { entities: [{ id: 'r1', kind: 'river' }] } },
      { battlefield: JSON.stringify({ scene: 'field', intent: { entities: [{ id: 'r1', kind: 'river' }] } }) },
    ]) expect(strict(repairBattlefieldAnswer(answer, context).battlefield).entities).toEqual([{ id: 'r1', kind: 'river', basis: 'inferred', sources: [] }]);
    const merged = repairBattlefieldAnswer({ battlefield: { intent: { entities: [{ id: 'main', kind: 'river' }, { id: 'branch', kind: 'river', label: '支流' }, { id: 'b', kind: 'bridge' }],
      relations: [{ subject: 'b', relation: 'crosses', object: 'branch' }], constraints: [{ kind: 'crossing_count', entity: 'b', value: 1 }] } } }, context);
    const intent = strict(merged.battlefield);
    expect(intent.entities.map(e => e.id)).toEqual(['main', 'b']);
    expect(intent.relations[0]).toMatchObject({ subject: 'b', relation: 'crosses', object: 'main' });
    expect(intent.constraints[0]).toMatchObject({ kind: 'crossing_count', entity: 'main', value: 1 });
    expect(merged.notes).toContain('多条河流已合并为一条主河');
  });
  it('keeps structures and cited places when more than twelve entities are returned, and ignores a malformed legacy bridge list', () => {
    const entities = [...Array.from({ length: 12 }, (_, n) => ({ id: 'ruin' + n, kind: 'ruins' })), { id: 'river', kind: 'river' }, { id: 'hill', kind: 'hill', basis: 'explicit', sources: ['m1.p1'] }];
    const { battlefield, notes } = repairBattlefieldAnswer({ battlefield: { bridgePlan: [{ anchor: 'middle' }], intent: { entities } } }, context);
    const intent = strict(battlefield);
    expect(intent.entities).toHaveLength(12);
    expect(intent.entities.map(e => e.id)).toEqual(expect.arrayContaining(['river', 'hill']));
    expect(battlefield).not.toHaveProperty('bridgePlan');
    expect(notes).toEqual(expect.arrayContaining(['已忽略格式无效的bridgePlan', '地点超过12项，已保留主要设施与正文明确地点']));
  });
  it('maps a kind the stated scene cannot build to the nearest one it can', () => {
    const kinds = (scene: string, entities: unknown[]) => strict(repairBattlefieldAnswer({ battlefield: { scene, intent: { entities } } }, context).battlefield).entities.map(e => e.kind);
    expect(kinds('field', [{ id: 'camp_gate', kind: 'gate', label: '营门', state: 'closed' }])).toEqual(['position']);
    expect(kinds('field', [{ id: 'town', kind: 'city' }, { id: 'east_gate', kind: 'gate' }])).toEqual(['city', 'gate']);
    expect(kinds('interior', [{ id: 'hall', kind: 'building' }, { id: 'yard', kind: 'hill' }, { id: 'door', kind: 'gate' }])).toEqual(['room', 'gate']);
    expect(kinds('city_streets', [{ id: 'study', kind: 'room' }])).toEqual(['building']);
    expect(kinds('building_siege', [{ id: 'study', kind: 'room' }])).toEqual(['room']);
    expect(repairBattlefieldAnswer({ battlefield: { scene: 'field', intent: { entities: [{ id: 'g', kind: 'gate' }] } } }, context).notes).toContain('部分地点类型与所选场景不符，已改用相近类型或省略');
  });
  it('leaves an absent map absent and never resolves inherited object keys', () => {
    expect(repairBattlefieldAnswer({ selections: {} }, context)).toEqual({ battlefield: undefined, notes: [] });
    const { battlefield } = repairBattlefieldAnswer({ battlefield: { intent: { entities: [{ id: 'constructor', kind: 'constructor' }, { id: 'hill', kind: 'hill', state: 'toString' }],
      relations: [{ subject: 'constructor', relation: 'constructor', object: 'hill' }] } } }, context);
    expect(strict(battlefield)).toMatchObject({ entities: [{ id: 'hill', kind: 'hill' }], relations: [] });
  });
});
