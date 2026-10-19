import { describe, expect, it } from 'vitest';
import { applyXp, xpProgress, generateUnit, prepareCombatModel, V23_OVERFLOW_D20, traitRegistry,
  compileWornEffects, anchoredWeaponLabel, type Ability, type Combatant } from '../../engine/src/index.js';
import { narrativeProjection } from './narrative-controller.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { itemAbilitySummary, itemPassiveSummary } from './item-description.js';
import { formatPromptSection, renderPromptSettings } from './prompt-settings.js';
import type { NarrativeSave } from './narrative-state.js';

const registry = traitRegistry();
function unit(scale: 'hero' | 'company'): Combatant {
  const u = generateUnit({ name: scale, scale, side: 'ally', rulesVersion: 'v2', damageModel: 'wounds-v2',
    level: 1, hpMax: 10, hp: 6, weaponClass: 'sword', weaponLevel: 1, armorTier: 0, traits: [] },
  { registry, seed: scale, noVariance: true }).unit;
  u.id = scale; prepareCombatModel(u, V23_OVERFLOW_D20);
  return u;
}

describe('升级与正文资料', () => {
  it('升级治好现存成员，缺员与可救伤员保留；未升级和死亡个体不触发回血', () => {
    const company = unit('company');
    company.formation!.health = [{ hp: 1, count: company.hp }]; company.recoverableWounded = 1;
    const members = company.hp, capacity = company.base.hpMax;
    applyXp(company, 1, registry);
    expect(company.formation!.health).toEqual([{ hp: 1, count: members }]);
    applyXp(company, xpProgress(company)!.next, registry);
    expect(company.formation!.health).toEqual([{ hp: company.formation!.memberHp, count: members }]);
    expect([company.hp, company.base.hpMax, company.recoverableWounded]).toEqual([members, capacity, 1]);
    const dead = unit('hero'); dead.hp = 0; dead.status = 'dead';
    applyXp(dead, xpProgress(dead)!.next, registry);
    expect([dead.hp, dead.status]).toEqual([0, 'dead']);
  });

  it('战内外只发送本级经验，hero士气提示不会被战内士气描述覆盖；无快照档案也有进度', () => {
    const hero = unit('hero'), company = unit('company');
    hero.level = 3; hero.xp = 1000.125; hero.xpCurve = 'effort-v1'; hero.xpLevelStart = 1000;
    company.morale = 25; company.base.moraleMax = 80;
    const records = [hero, company].map(u => unitRecordFromCombatant(u));
    const save: NarrativeSave = { storage: records, rosterIds: [hero.id, company.id] };
    const rows = (text: string) => text.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    const out = rows(narrativeProjection(save));
    expect(out.find(r => r.name === 'hero')).toMatchObject({ xpProgress: .125, xpRequired: 1600, morale: '该单位士气锁定，请勿在tb修改' });
    expect(out.find(r => r.name === 'company').morale).toBe(25);
    expect(out.every(r => !Object.hasOwn(r, 'xp'))).toBe(true);
    const during = rows(narrativeProjection({ ...save, battle: { kind: 'small', snap: { seed: 'context', combatants: [hero, company], fieldTags: ['plains'] } } }));
    expect(during.find(r => r.name === 'hero').morale).toBe('该单位士气锁定，请勿在tb修改');
    const withoutSnapshot = { ...records[0]!, snapshot: undefined };
    expect(rows(narrativeProjection({ storage: [withoutSnapshot] }))[0]).toHaveProperty('xpRequired', 1600);
    hero.level = 10;
    expect(rows(narrativeProjection({ storage: [unitRecordFromCombatant(hero)] }))[0]).toHaveProperty('xpProgress', '已满级');
  });

  it('道具与装备说明最多两位小数，显示处理保留原始效果和武器数值', () => {
    const ability: Ability = { id: 'display', name: 'display', target: 'ally', effects: [
      { op: 'heal', amount: 12.345678 }, { op: 'resource', resource: 'SP', amount: 1.234567 },
      { op: 'morale', amount: -2.345678 }, { op: 'barrier', amount: 3.456789, dur: 2 },
    ] };
    const effects = compileWornEffects({ damage: 1, defense: 1 }, 5);
    effects.values.damage = .1234567; effects.values.defense = 1.234567;
    const weapon = unit('hero').weapon!;
    weapon.customized = true; weapon.recipe = undefined; weapon.penetration = 1.234567;
    const before = JSON.stringify({ ability, effects, weapon });
    const text = [itemAbilitySummary(ability), itemPassiveSummary({ traits: [], actualEffects: effects }), anchoredWeaponLabel(weapon)].join('；');
    expect(text).toContain('12.35'); expect(text).toContain('12.35%'); expect(text).toContain('1.23');
    expect(text).not.toMatch(/\d+\.\d{3,}/);
    expect(JSON.stringify({ ability, effects, weapon })).toBe(before);
  });

  it('物品提示采用确认文案，旧默认文本更新，自定义和关闭设置继续生效', () => {
    const legacy = '【实物清单】此处id用于reforge改造或take扣减，不能用单位id代替；give只入库，换装在面板完成。\n{{content}}';
    const settings = { sections: { items: { template: legacy } } };
    const text = formatPromptSection(settings, 'items', '物品数据');
    expect(text).toContain('reforge 为改造已有物品'); expect(text).toContain('spec="剑L5+2伤害"');
    expect(text).not.toMatch(/qty|面板完成/); expect(text).toContain('物品数据');
    expect(renderPromptSettings(settings)).toContain('reforge 为改造已有物品');
    expect(formatPromptSection({ sections: { items: { template: '自定义{{content}}' } } }, 'items', '清单')).toBe('自定义清单');
    expect(formatPromptSection({ sections: { items: { ...settings.sections.items, enabled: false } } }, 'items', '清单')).toBe('');
  });
});
