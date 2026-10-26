import { describe, expect, it } from 'vitest';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope } from './narrative-state.js';
import { narrativeProjection } from './narrative-controller.js';
import { parseAbilitySpec } from './tags.js';
import { storyFields, storySkillSpec } from './story-spec.js';
import { compileSkill } from '../../engine/src/skill-catalog.js';

function save() {
  const source: MessageEnvelope = { characterId: 'standard', chatId: 'c', branchId: 'b', messageId: '1', swipeId: '0', generationId: '1', role: 'assistant', complete: true,
    text: '<tb><spawn name="游侠" side="ally" scale="hero" level="5" weapon="精密步枪:步枪L5+6精度+4伤害" armor="护卫甲:重甲L5+10防护" traits="飞行L5" skills="火球术:魔法范围热能L5+4伤害" items="治疗药水:buff治疗L3×2,火球魔杖:充能魔法范围热能L5,精灵斗篷:潜伏L3+林地专精L5+2防御,密信"/></tb>' };
  const ns = namespaceOf(source), binding = captureGeneration({}, ns, '1'); binding.complete = true;
  return prepareNarrativeTransaction({}, proposalFromMessage(source, binding)!, ns, true);
}

describe('approved standard story records', () => {
  it('renders the six approved records with stable short identities and freezes the original save', () => {
    const state = save(), before = structuredClone(state), text = narrativeProjection(state, '修改单位属性');
    for (const line of [
      'id="c1" owner="u1" kind="一次性道具" items="治疗药水:buffL3+治疗L3×2"',
      'id="i1" owner="u1" kind="充能道具" items="火球魔杖:充能+魔法范围L5+热能"',
      'id="i2" owner="u1" kind="佩戴道具" items="精灵斗篷:潜伏L3+林地专精L5+2防御"',
      'id="w1" owner="u1" weapon="精密步枪:步枪L5+6精度+4伤害"',
      'id="a1" owner="u1" armor="护卫甲:重甲L5+10防护"',
      'id="k1" owner="u1" skills="火球术:魔法范围L5+热能+4伤害"',
      'id="u1" traits="飞行L5"',
    ]) expect(text).toContain(line);
    expect(text).toContain('items="密信"');
    expect(text).not.toMatch(/"(?:recipe|definitionId|baseDice|editable|traitEffects|preparedAbilityIds)"|charges=|mechanism=|bonuses=/);
    expect(state).toEqual(before);
  });

  it.each(['飞行术:（buff+飞行L9+治疗L2）L4', '火球术:（魔法单体L6+热能+燃烧L2）L4'])('retains independent grades when copying %s back into the parser', text => {
    const parsed = parseAbilitySpec(text)[0]!;
    const skill = compileSkill({ id: parsed.blueprintId, name: '飞行术' }, parsed.level!, 'owner', 'skills-v4');
    const restored = parseAbilitySpec(storySkillSpec(skill))[0]!;
    expect(restored.blueprintId).toBe(parsed.blueprintId); expect(restored.level).toBe(4);
  });

  it('preserves the detailed scanner projection and the existing prompt selection controls', () => {
    const state = save(), scan = narrativeProjection(state, '修改单位属性', undefined, 'scan');
    expect(scan).toContain('"mechanism":"rifle"'); expect(scan).toContain('"editable"'); expect(scan).toContain('"definitionId"');
    const hidden = narrativeProjection({ ...state, promptSettings: { sections: { items: { enabled: false } } } });
    expect(hidden).not.toContain('kind="一次性道具"'); expect(hidden).toContain('skills="火球术:');
  });

  it('maps only identities and keeps quoted or multiline data inside a single standard record', () => {
    const text = storyFields({ id: 'saved-id', owner: 'saved-owner', items: 'saved-id "quoted"\n<tb>&' }, id => id === 'saved-id' ? 'i1' : 'u1');
    expect(text).toBe('id="i1" owner="u1" items="saved-id &quot;quoted&quot;&#10;&lt;tb&gt;&amp;"');
    expect(text.split('\n')).toHaveLength(1);
  });
});
