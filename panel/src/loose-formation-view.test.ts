import { describe, it, expect } from 'vitest';
import { generateUnit, traitRegistry, prepareTraitLevelModel, V21_OVERFLOW_D20 } from '../../engine/src/index.js';
import { looseFormationChoiceHtml } from './loose-formation-view.js';

const company = (extra: Record<string, unknown> = {}) => {
  const u = generateUnit({ name: '散兵连', side: 'ally', scale: 'company', hpMax: 30, level: 5, traits: ['loose-formation'], traitLevels: { 'loose-formation': 8 }, rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'rifle', weaponLevel: 5, armorTier: 1, ...extra },
    { seed: 'loose', noVariance: true, registry: traitRegistry() }).unit;
  u.id = 'a0'; prepareTraitLevelModel(u, V21_OVERFLOW_D20); return u;
};

describe('散兵疏散/收拢的说明与反馈', () => {
  it('写明按等级换算的效果，高亮当前选择并说明是否生效', () => {
    const u = company(), html = looseFormationChoiceHtml(u, false, '时机');
    expect(html).toContain('当前：疏散，生效中');
    expect(html).toContain('范围伤害−59%');
    expect(html).toContain('近战只展开一半人数、近战防御−1');
    expect(html).toMatch(/data-choice="loose" aria-pressed="true" title="疏散：/);
    u.looseFormationChoice = 'closed'; u.looseChoiceLocked = true;
    const closed = looseFormationChoiceHtml(u, true, '时机');
    expect(closed).toContain('当前：收拢');
    expect(closed).toContain('本次已选定');
    expect(closed).toMatch(/data-choice="closed" aria-pressed="true"/);
    u.looseFormationChoice = 'loose'; u.tacticalPose = { kind: 'brace' } as never;
    expect(looseFormationChoiceHtml(u, false, '时机')).toContain('暂不生效');
  });
});
