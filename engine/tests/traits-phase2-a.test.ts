import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, V17_OVERFLOW_D20, V17_OVERFLOW_TW, V16_OVERFLOW_D20, prepareTraitLevelModel,
  prepareTraitModel, prepareCombatModel, prepareSkillModel, prepareItemModel, upgradeCombatSkills, compileSkill,
  skillMechanismId, parseSkillMechanism, applySkillTrait, traitLevel, expireTraitSources, grantTraitSource,
  defensePower, anchoredProtection, collectMods, resolveStack, standardConditionMap, narrativeTraitLevel,
  applySkillCondition, healingGradeMultiplier, resolveHealingBudget, SmallBattle, MassBattle, type Combatant,
} from '../src/index.js';
import { parseAbilitySpec } from '../../panel/src/tags.js';
import { normalizeNarrativeSkill } from '../../panel/src/spec-tolerance.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';

const reg = traitRegistry(), defs = standardConditionMap();
function unit(id = 'a'): Combatant {
  const u = generateUnit({ name: id, side: id === 'e' ? 'enemy' : 'ally', scale: 'hero', level: 5, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [], armorTier: 0 }, { seed: id, noVariance: true }).unit;
  u.id = id; prepareSkillModel(u, V17_OVERFLOW_D20); prepareCombatModel(u, V17_OVERFLOW_D20); prepareTraitModel(u, V17_OVERFLOW_D20);
  prepareItemModel(u, V17_OVERFLOW_D20); prepareTraitLevelModel(u, V17_OVERFLOW_D20); return u;
}
function compile(input: string, owner: Combatant) {
  const p = parseAbilitySpec(input)[0]!;
  const a = compileSkill({ id: p.blueprintId, name: p.name }, p.level ?? 1, owner.id, 'skills-v2');
  owner.abilities = [a]; upgradeCombatSkills(owner); return a;
}
const ward = (u: Combatant) => resolveStack(collectMods(u, {}, defs, [], reg), 'ward', {}).multTotal;

describe('P2-A 输入、冻结版本与真实来源', () => {
  it('共享L与单项覆盖保留实际等级；旧名规范化、显式特质、重复组合及预算无绕级', () => {
    for (const L of [1, 5, 8, 10]) for (const name of ['吸血', '特质吸血', '破甲大师', '屠兽者', '守护', '特质守护']) {
      const u = unit(), a = compile(`测试:buff+${name}L${L}`, u);
      const effect = a.effects.find(e => e.op === 'trait')!;
      expect(effect).toMatchObject({ op: 'trait', level: L, dur: 1 + Math.floor((L - 1) / 4) });
      if (effect.op !== 'trait') throw Error('fixture');
      applySkillTrait(u, u, a, effect, name); expect(traitLevel(u, effect.traitId)).toBe(L);
      for (let round = 0; round < effect.dur; round++) expireTraitSources(u, 'rounds');
      expect(traitLevel(u, effect.traitId)).toBe(0);
    }
    const u = unit(), a = compile('复合:buff+破甲+破甲大师+吸血+偷袭L10', u);
    expect(a.effects.filter(e => e.op === 'trait')).toHaveLength(3); expect(a.cost!.amount).toBeGreaterThan(6);
    for (const text of ['buff+吸血L3+偷袭L8', normalizeNarrativeSkill('buff+吸血L3+偷袭L8', [])]) {
      const mixed = compile(text, unit());
      expect(mixed.power).toBe(8);
      expect(mixed.effects).toEqual(expect.arrayContaining([
        expect.objectContaining({ op: 'trait', traitId: 'lifesteal', level: 3 }),
        expect.objectContaining({ op: 'trait', traitId: 'sneak-attack', level: 8 }),
      ]));
    }
    expect(narrativeTraitLevel('破甲大师L1')).toMatchObject({ id: 'ap-weapon', level: 1 });
    expect(narrativeTraitLevel('破甲大师')).toMatchObject({ id: 'ap-weapon', level: 8 });
  });
  it('守护本体/技能同级同减伤和规格；跨代防御不增加抗穿', () => {
    const intrinsic = unit(), temporary = unit(); intrinsic.traits = ['guardian']; intrinsic.traitLevels = { guardian: 8 };
    const a = compile('护体:buff+守护L8', temporary), effect = a.effects[0]!;
    if (effect.op !== 'trait') throw Error('fixture'); applySkillTrait(temporary, temporary, a, effect, 'cast');
    expect(ward(intrinsic)).toBeCloseTo(.6); expect(ward(temporary)).toBeCloseTo(.6);
    expect(defensePower(intrinsic, 'kinetic')).toBe(8); expect(defensePower(temporary, 'kinetic')).toBe(8);
    expect(anchoredProtection(intrinsic, 'kinetic')).toBe(anchoredProtection(temporary, 'kinetic'));
    prepareTraitLevelModel(intrinsic, V16_OVERFLOW_D20); expect(defensePower(intrinsic, 'kinetic')).toBe(5);
  });
  it('普通高短/低长状态独立到期；旧规则继续保留其合并语义', () => {
    const u = unit(); applySkillCondition(u, { id: 'inspired', dur: 1, magnitude: 1.5, sourceId: 'high' });
    applySkillCondition(u, { id: 'inspired', dur: 5, magnitude: .5, sourceId: 'low' });
    expect(u.conditions).toHaveLength(2); u.conditions.forEach(c => c.dur--); u.conditions = u.conditions.filter(c => c.dur > 0);
    expect(u.conditions).toMatchObject([{ magnitude: .5, dur: 4 }]);
    prepareTraitLevelModel(u, V16_OVERFLOW_D20); applySkillCondition(u, { id: 'inspired', dur: 1, magnitude: 1.5 });
    expect(u.conditions).toMatchObject([{ magnitude: 1.5, dur: 4 }]);
  });
  it.each(['small', 'mass'] as const)('%s存档保留模型、短高长低、旧编译结果', mode => {
    const u = unit(), e = unit('e'); u.traits = ['guardian']; u.traitLevels = { guardian: 3 };
    for (const [id, L, count] of [['high', 8, 1], ['long', 6, 3]] as const) grantTraitSource(u, { id, name: id, kind: 'blessing', traitIds: ['guardian'], traitLevels: { guardian: L }, duration: { kind: 'rounds', count } });
    const old = compileSkill({ id: skillMechanismId(parseSkillMechanism('buff+守护')!) }, 8, u.id, 'skills-v1'); u.abilities = [old];
    const before = JSON.stringify(old); upgradeCombatSkills(u); expect(JSON.stringify(old)).toBe(before);
    const b = mode === 'small' ? new SmallBattle({ combatants: [u, e], rules: V17_OVERFLOW_D20, seed: 'p2' }) : new MassBattle({ combatants: [u, e], rules: V17_OVERFLOW_TW, seed: 'p2' });
    const snap = JSON.parse(JSON.stringify(b.toSnapshot()));
    const restored = mode === 'small' ? SmallBattle.fromSnapshot(snap) : MassBattle.fromSnapshot(snap);
    const loaded = materializeUnitRecord(JSON.parse(JSON.stringify(unitRecordFromCombatant(restored.byId('a')))), reg);
    expect(loaded.healingModel).toBe('healing-grades-v1'); expect(traitLevel(loaded, 'guardian')).toBe(8);
    expireTraitSources(loaded, 'rounds'); expect(traitLevel(loaded, 'guardian')).toBe(6);
    expireTraitSources(loaded, 'rounds'); expireTraitSources(loaded, 'rounds'); expect(traitLevel(loaded, 'guardian')).toBe(3);
  });
  it('治疗纯函数只比较P/T；医护、施术者训练、护甲与守护不抬高P', () => {
    const source = unit(), target = unit();
    expect(healingGradeMultiplier(8, 5, target.healingModel)).toBeCloseTo(Math.sqrt(6000 / 420));
    const base = resolveHealingBudget({ source, target, power: 8, baseAmount: 48 });
    source.level = 1; target.traits = ['guardian']; target.traitLevels = { guardian: 10 }; target.armor!.level = 10;
    expect(resolveHealingBudget({ source, target, power: 8, baseAmount: 48 })).toBe(base);
    target.level = 8; expect(resolveHealingBudget({ source, target, power: 8, baseAmount: 48 })).toBe(48);
    expect(healingGradeMultiplier(10, 10, target.healingModel)).toBe(1);
    expect(resolveHealingBudget({ source, target, baseAmount: 12 })).toBe(12);
  });
});
