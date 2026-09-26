import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, activeTraitIds,
  SKILL_CATEGORIES, STANDARD_CONDITIONS, TRAITS, allowedSkillModifiers, skillMechanismId, skillMechanismName, parseSkillMechanism, compileGenericSkill, learnAbilities,
  conditionMods, standardConditionMap, skillConditionDescription, type Combatant, type GenerateInput } from '../src/index.js';
import { parseProtocol } from '../../panel/src/protocol.js';
import { parseAbilitySpec } from '../../panel/src/tags.js';
import { materializeUnitRecord, unitRecordFromCombatant, commitBattleOutcome } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
const specs = (text: string) => parseAbilitySpec(text).map((s) => ({ id: s.blueprintId, name: s.name, level: s.level }));
function unit(id: string, side: 'ally' | 'enemy', skills = '', input: Partial<GenerateInput> = {}) {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 5, hpMax: 500, weaponClass: 'sword', armorTier: 0,
    traits: [], abilityBlueprints: specs(skills), ...input }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
function grid(skills: string, input: Partial<GenerateInput> = {}) {
  const a = unit('a', 'ally', skills, input), f = unit('f', 'ally'), e = unit('e', 'enemy');
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, f, e], battlefield: field, rules: V2_D20, traitRegistry: registry, seed: 'generic',
    rng: { seed: 'fixed', next: () => 0.1, d: (sides) => sides === 20 ? 1 : sides } });
  b.start(); b.turnOrder = ['a', 'f', 'e']; b.turnIndex = 0; a.pos = 31; f.pos = 32; e.pos = 24;
  return { b, a, f, e };
}
function mass(skills: string) {
  const units = [unit('a', 'ally', skills, { scale: 'company', hpMax: 200 }), unit('f', 'ally', '', { scale: 'company', hpMax: 200 }), unit('e', 'enemy', '', { scale: 'company', hpMax: 200 })];
  for (const u of units) u.tags.push('zone:中军', 'rank:front');
  const b = new MassBattle({ combatants: units, rules: V2_TW, traitRegistry: registry, seed: 'generic-mass' }); b.start();
  for (const u of units) if (u.id !== 'a') b.issue({ unitId: u.id, type: 'hold' });
  return { b, a: b.byId('a'), f: b.byId('f'), e: b.byId('e') };
}
describe('通用六类技能配方', () => {
  it('增益预览列出按效力缩放的属性值，与小战/会战实际施加的修正一致', () => {
    for (const setup of [grid, mass]) for (const [effect, text, value] of [
      ['攻击', '攻击命中 +2.4', 2.4], ['防御', '防御 +2.4', 2.4],
      ['伤害', '造成伤害 +24%', 1.24], ['守护', '受到伤害 -24%', 0.76],
    ] as const) {
      const { b, a, f } = setup(`增益:buff+${effect}L7`), ability = a.abilities[0]!;
      const before = JSON.stringify(b.toSnapshot());
      const preview = b instanceof SmallBattle
        ? b.getActionOptions(a.id).find(o => o.id === ability.id)!.targets!.find(t => t.targetId === f.id)!.preview
        : b.orderPreview({ unitId: a.id, type: 'ability', abilityId: ability.id, targetId: f.id });
      expect(preview?.effects?.join('；')).toContain(text);
      expect(JSON.stringify(b.toSnapshot())).toBe(before);
      if (b instanceof SmallBattle) expect(b.useAbility(a.id, ability.id, f.id).ok).toBe(true);
      else { expect(b.issue({ unitId: a.id, type: 'ability', abilityId: ability.id, targetId: f.id }).ok).toBe(true); b.resolveRound(); }
      expect(conditionMods(f.conditions, standardConditionMap(), f)[0]!.value).toBeCloseTo(value);
    }
    const { a } = grid('复合增益:buff+攻击+防御L7');
    const descriptions = a.abilities[0]!.effects.flatMap(e => e.op === 'condition' ? [skillConditionDescription(e, a)] : []);
    expect(descriptions).toEqual(['攻击命中 +1.7', '防御 +1.7']);
    expect(skillConditionDescription({ op: 'condition', conditionId: 'inspired', potency: 3, dur: 2 }, a)).toBe('攻击命中 +3');
    expect(skillConditionDescription({ op: 'condition', conditionId: 'hasted', magnitude: 0.5, dur: 2 }, a)).toContain('先攻速度 +1、移动点 +1');
  });
  it('六类直接编译全部登记效果，名称不决定数值，等级/矛盾机制严格校验', () => {
    const covered = new Set<string>(), conditions = new Set<string>(), traits = new Set<string>();
    for (const category of SKILL_CATEGORIES) for (const modifier of [undefined, ...allowedSkillModifiers(category.id)]) {
      const mechanism = { category: category.id, area: category.id.endsWith('area'), modifiers: modifier ? [modifier.id] : [] };
      if (modifier?.id === 'summon' && mechanism.area) continue;
      const id = skillMechanismId(mechanism), label = skillMechanismName(id);
      expect(parseSkillMechanism(label), label).toEqual(mechanism);
      for (const power of [1, 5, 10]) {
        const a = compileGenericSkill(id, power, 'owner', '自定义甲'), b = compileGenericSkill(id, power, 'owner', '自定义乙');
        expect(a.recipe).toMatchObject({ category: category.id, power }); expect(a.effects.length).toBeGreaterThan(0);
        expect(a.effects).toEqual(b.effects); expect(a.cooldownGroup).toBe(b.cooldownGroup);
        for (const e of a.effects) { covered.add(e.op); if (e.op === 'condition') conditions.add(e.conditionId); if (e.op === 'trait') traits.add(e.traitId); }
        const restored = materializeUnitRecord(unitRecordFromCombatant(unit('matrix', 'ally', `自定义:${label}L${power}`)), registry);
        expect(restored.abilities[0]!.effects).toEqual(a.effects);
      }
    }
    expect([...covered].sort()).toEqual(['barrier', 'condition', 'damage', 'dispel', 'heal', 'morale', 'push', 'resource', 'summon', 'trait', 'zone']);
    expect([...conditions].sort()).toEqual(STANDARD_CONDITIONS.map((c) => c.id).sort());
    expect([...traits].sort()).toEqual(TRAITS.filter((t) => t.v2SourceReady).map((t) => t.id).sort());
    for (const text of ['物理单体近战+射击', '魔法范围热能+奥术', 'buff范围召唤', 'debuff不存在']) expect(parseSkillMechanism(text)).toBeUndefined();
    expect(parseProtocol('<tb><learn id="a" skills="破空:物理单体L99"/></tb>').events).toEqual([]);
    expect(parseProtocol('<tb><learn id="a" skills="烈焰风暴:buff不存在L5"/></tb>').events).toEqual([]);
  });
  it('四种伤害分类实际扣血；近战范围以施术者为中心，枪械技法不能绕过装填', () => {
    for (const category of ['物理单体', '物理范围', '魔法单体', '魔法范围']) {
      const { b, a, e } = grid(`自定义招式:${category}L7`); b.rng.d = (sides) => sides;
      const other = unit('e2', 'enemy'); other.pos = category === '物理范围' ? 30 : 23; b.combatants.push(other);
      const skill = a.abilities[0]!, preview = b.getActionOptions('a').find((o) => o.id === skill.id)!.targets!.find((t) => t.targetId === 'e')!;
      expect(preview.preview!.expectedDamage).toBeGreaterThan(0);
      const result = b.useAbility('a', skill.id, 'e'); expect(result.ok).toBe(true); expect(e.hp).toBeLessThan(500);
      if (category.endsWith('范围')) { expect(other.hp).toBeLessThan(500); expect(result.resolutions.map((r) => r.defenderId)).toEqual(preview.preview!.areaTargetIds); }
    }
    const gun = grid('齐射:物理单体射击L7', { weaponClass: 'cannon', body: 'vehicle' }); gun.e.pos = 10;
    gun.b.reloadCd.set('a', 2); const before = structuredClone(gun.a);
    expect(gun.b.useAbility('a', gun.a.abilities[0]!.id, 'e').ok).toBe(false); expect(gun.a).toEqual(before);
    gun.b.reloadCd.delete('a'); expect(gun.b.useAbility('a', gun.a.abilities[0]!.id, 'e').ok).toBe(true);
    expect(gun.b.reloadCd.get('a')).toBeGreaterThan(0);
  });
  it('同类不同名技能可并存，学习/改名/删除重学都不刷新共享冷却，旧实例保留', () => {
    const { b, a, e } = grid('斩击:物理单体L5,穿刺:物理单体L7');
    expect(a.abilities).toHaveLength(2); expect(new Set(a.abilities.map((s) => s.id)).size).toBe(2);
    const ability = a.abilities[0]!, before = structuredClone(ability);
    expect(b.useAbility(a.id, ability.id, e.id).ok).toBe(true);
    expect(b.useAbility(a.id, a.abilities[1]!.id, e.id).reason).toMatch(/冷却/);
    const renamed = learnAbilities(a, [{ id: ability.definitionId!, instanceId: ability.id, name: '新名字' }]);
    expect(renamed.abilities[0]).toEqual({ ...before, name: '新名字' });
    expect(renamed.abilityState).toEqual(a.abilityState);
    const removed = learnAbilities(renamed, [], { replace: true });
    const relearned = learnAbilities(removed, specs('回旋斩:物理单体L9'));
    expect(relearned.abilityState).toEqual(a.abilityState);
    const old = unit('old', 'ally', '旧技:重击L5'); const frozen = structuredClone(old.abilities[0]);
    expect(learnAbilities(old, specs('新法:魔法单体L5')).abilities[0]).toEqual(frozen);
  });
  it('治疗/增益/控制实际生效；范围列出两个目标，非法动作无资源损失', () => {
    const heal = grid('群体恢复:buff范围治疗L7'); heal.a.hp = heal.f.hp = 100;
    const skill = heal.a.abilities[0]!;
    const choice = heal.b.getActionOptions('a').find((o) => o.id === skill.id)!.targets!.find((t) => t.targetId === 'f')!;
    expect(choice.enabled).toBe(true); expect(choice.preview?.areaTargetIds).toHaveLength(2);
    const auto = SmallBattle.fromSnapshot(structuredClone(heal.b.toSnapshot())); auto.autoAction('a');
    expect(auto.byId('a').abilityState.some((s) => s.abilityId === 'generic:buff' && s.used > 0)).toBe(true);
    expect(heal.b.useAbility('a', skill.id, 'f').ok).toBe(true); expect(heal.a.hp).toBeGreaterThan(100); expect(heal.f.hp).toBeGreaterThan(100);
    const control = grid('止步:debuff定身L8');
    expect(control.b.useAbility('a', control.a.abilities[0]!.id, 'e').ok).toBe(true);
    expect(control.e.conditions.some((c) => c.id === 'restrained')).toBe(true);
    const pull = grid('牵引:debuff拉拽L10'); pull.e.pos = 10;
    expect(pull.b.useAbility('a', pull.a.abilities[0]!.id, 'e').ok).toBe(true); expect(pull.e.pos).toBe(17);
    const miss = grid('重推:debuff击退L1'); miss.e.body = 'giant'; const before = miss.a.resources.SP;
    expect(miss.b.useAbility('a', miss.a.abilities[0]!.id, 'e').ok).toBe(false); expect(miss.a.resources.SP).toBe(before);
  });
  it('范围支援在会战生效，资源转移受上限约束，临时飞行归档后撤销', () => {
    const heal = mass('群体恢复:buff范围治疗L7'); heal.a.hp = heal.f.hp = 100; heal.a.recoverableWounded = heal.f.recoverableWounded = 30;
    expect(heal.b.recommendedOrder('a')?.type).toBe('ability');
    expect(heal.b.issue({ unitId: 'a', type: 'ability', abilityId: heal.a.abilities[0]!.id, targetId: 'f' }).ok).toBe(true);
    heal.b.resolveRound(); expect(heal.a.hp).toBeGreaterThan(100); expect(heal.f.hp).toBeGreaterThan(100);
    const energy = mass('供能:buff回能L7'); energy.f.resources.SP = 0;
    expect(energy.b.issue({ unitId: 'a', type: 'ability', abilityId: energy.a.abilities[0]!.id, targetId: 'f' }).ok).toBe(true);
    energy.b.resolveRound(); expect(energy.f.resources.SP).toBeGreaterThan(0); expect(energy.f.resources.SP).toBeLessThanOrEqual(8);
    const fly = grid('升空:buff飞行L5'), original = fly.b.combatants.map((u) => unitRecordFromCombatant(u));
    expect(fly.b.useAbility('a', fly.a.abilities[0]!.id, 'f').ok).toBe(true); expect(activeTraitIds(fly.f)).toContain('flying');
    const outcome = commitBattleOutcome({ battleId: 'test', committedIds: [], records: original, roster: fly.b.combatants, combatants: fly.b.combatants, awards: [], registry });
    expect(activeTraitIds(materializeUnitRecord(outcome.records.find((r) => r.id === 'f')!, registry))).not.toContain('flying');
  });
  it('新召唤不依赖命名模板，等级改变造物，消耗资源并在下一轮才行动', () => {
    for (const setup of [grid, mass]) {
      const { b, a } = setup('援手:buff召唤L7');
      const beforeSP = a.resources.SP!;
      if (b instanceof SmallBattle) expect(b.useAbility('a', a.abilities[0]!.id).ok).toBe(true);
      else { expect(b.issue({ unitId: 'a', type: 'ability', abilityId: a.abilities[0]!.id, targetId: 'a' }).ok).toBe(true); b.resolveRound(); }
      const summoned = b.combatants.filter((u) => u.summonerId === 'a');
      expect(summoned).toHaveLength(1); expect(summoned[0]!.level).toBe(7); expect(summoned[0]!.bornRound).toBe(1);
      expect(a.resources.SP).toBe(beforeSP - a.abilities[0]!.cost!.amount);
    }
  });
});
