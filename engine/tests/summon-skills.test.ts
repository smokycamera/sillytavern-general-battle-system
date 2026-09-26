import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW,
  prepareCombatModel, anchoredWeapon, memberHealthMax, previewAttack, standardConditionMap, traitRegistry,
  compileSkill, type Combatant } from '../src/index.js';
import { conjureSkillUnit, summonedMemberLife } from '../src/skill-runtime.js';
import { parseAbilitySpec } from '../../panel/src/tags.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';
import { parseSkillMechanism, skillMechanismId } from '../src/data/skill-mechanisms.js';
import { diceAvg } from '../src/data/weapons.js';
import { gridWeaponRange } from '../src/small/weapon-range.js';
import { formationWeaponRange } from '../src/melee.js';
import { gridAbility } from '../src/small/skill-range.js';
import { skillEffectLines } from '../src/skill-effects.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
import { needsFormationHost } from '../src/mass/formation.js';
import { pointBlankModifier } from '../src/actions.js';
import type { Enhancements } from '../src/enhancements.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
function summoned(group = false, bonuses?: Enhancements, level = 3) {
  const u = conjureSkillUnit(`conjured:${group ? 'group' : 'single'}:${level}`, 'ally', 'summon', 'small', bonuses)!;
  prepareCombatModel(u, V4_OVERFLOW_D20, summonedMemberLife(u)); return u;
}
function setup(mode: 'small' | 'mass', text: string) {
  const units = ['a', 'e'].map((id, i) => {
    const u = generateUnit({ name: id, side: i ? 'enemy' : 'ally', scale: mode === 'mass' ? 'company' : 'hero',
      rulesVersion: 'v2', level: 5, hpMax: 100, weaponClass: 'sword', weaponLevel: 1, armorTier: 0, traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; u.tags.push('zone:中军', 'rank:front'); return u;
  });
  const [a, e] = units as [Combatant, Combatant], spec = parseAbilitySpec(text)[0]!;
  a.abilities = [compileSkill({ id: spec.blueprintId, name: spec.name, bonuses: spec.bonuses }, spec.level!, a.id)];
  a.preparedAbilityIds = [a.abilities[0]!.id];
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = mode === 'small' ? new SmallBattle({ combatants: units, battlefield: field, rules: V4_OVERFLOW_D20, seed: 'summons' })
    : new MassBattle({ combatants: units, rules: V4_OVERFLOW_TW, seed: 'summons' });
  b.start();
  if (b instanceof SmallBattle) { a.pos = 45; e.pos = 17; b.turnOrder = ['a', 'e']; b.turnIndex = 0; }
  return { b, a, e, ability: a.abilities[0]! };
}
const mean = (u: Combatant) => { const w = anchoredWeapon(u.weapon)!; return diceAvg(w.baseDice) * (w.damageScale ?? 1); };

describe('单体／群体召唤及召唤武器', () => {
  it('支持直接简写、距离别名和自由组合；召唤形态冲突取最后一项，旧模板仍可用', () => {
    expect(parseAbilitySpec('箭灵:群体召唤L3+5距离')[0]).toMatchObject({ blueprintId: 'generic:buff:summon-group', bonuses: { range: 5 } });
    const m = parseSkillMechanism('单体召唤+群体召唤+屏障+净化')!;
    expect(m.modifiers).toEqual(['barrier', 'cleanse', 'summon-group']);
    expect(compileSkill(skillMechanismId(m), 3, 'a').effects.map(e => e.op).sort()).toEqual(['barrier', 'dispel', 'summon']);
    expect(conjureSkillUnit('conjured:3', 'ally', 'old', 'small')!.scale).toBe('hero');
    expect(conjureSkillUnit('conjured:3', 'ally', 'old', 'mass')!.scale).toBe('company');
  });
  it('等级只决定基准；群体分摊生命和伤害预算，强化不抬高等级或人数', () => {
    for (const level of [1, 3, 6, 10]) for (const power of [-10, 0, 10]) {
      const one = summoned(false, { power }, level), group = summoned(true, { power }, level), count = 4 + 2 * level;
      expect(group.hp).toBe(count); expect(group.level).toBe(level);
      expect(group.weapon!.level).toBe(level); expect(group.armor!.level).toBe(level);
      expect(memberHealthMax(group)).toBeLessThanOrEqual(memberHealthMax(one));
      expect(memberHealthMax(one) - memberHealthMax(group)).toBeLessThan(count);
      expect(mean(group) * count).toBeCloseTo(mean(one));
    }
    const base = summoned(), boost = summoned(false, { power: 5, damage: 5, accuracy: 5, penetration: 5 });
    expect(mean(boost) / mean(base)).toBeCloseTo(1.5);
    expect(boost.hp).toBeGreaterThan(base.hp);
    const target = summoned(); target.id = 'target'; target.side = 'enemy';
    const preview = (attacker: Combatant) => previewAttack({ attacker, defender: target, rules: V4_OVERFLOW_D20, distance: 1, conditionDefs, traitRegistry: registry });
    expect(preview(boost).attackScore! - preview(base).attackScore!).toBe(2);
    expect(preview(boost).penetration! - preview(base).penetration!).toBe(1);
    expect(mean(summoned(false, { damage: -5 })) / mean(base)).toBeCloseTo(.75);
  });
  it('距离超过1实际成为远程武器，格子与会战距离一致并保留抵近惩罚', () => {
    for (const [range, expected] of [[-10, 1], [0, 1], [1, 2], [5, 6], [10, 11]]) {
      const u = summoned(false, { range }), w = u.weapon!;
      expect(w.name).toBe('召唤武器'); expect(w.hands).toBe(0);
      expect(gridWeaponRange(w)).toBe(expected); expect(formationWeaponRange(w)).toBe(expected);
      expect(w.tags!.includes('ranged')).toBe(expected! > 1);
    }
    const attacker = summoned(false, { range: 5 });
    expect(pointBlankModifier(attacker.weapon, true, 0, attacker)).toBe(-2);
    expect(pointBlankModifier(attacker.weapon, true, 2, attacker)).toBe(0);
  });
  it.each(['small', 'mass'] as const)('%s：两种形态实际生成、扣费一次、下轮行动、预览和读档一致', mode => {
    for (const group of [false, true]) {
      const { b, a, e, ability } = setup(mode, `灵卫:${group ? '群体' : '单体'}召唤L3+5射程+5伤害`), sp = a.resources.SP!;
      const before = JSON.stringify(b.toSnapshot());
      expect(skillEffectLines(b.observationContext(), a, a, ability).join('；')).toContain('远程距离6');
      expect(JSON.stringify(b.toSnapshot())).toBe(before);
      expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(true);
      if (b instanceof MassBattle) { b.issue({ unitId: e.id, type: 'hold' }); b.resolveRound(); }
      const u = b.combatants.find(u => u.summonerId === a.id)!;
      expect(u.scale).toBe(group ? 'company' : 'hero'); expect(u.bornRound).toBe(1);
      expect(u.weapon!.recipe!.bonuses).toMatchObject({ range: 5, damage: 5 });
      expect(a.resources.SP).toBe(sp - ability.cost!.amount);
      expect(mean(u)).toBeCloseTo(mean(summoned(group, { range: 5, damage: 5 })));
      if (b instanceof SmallBattle) expect(b.turnOrder).not.toContain(u.id);
      else { expect(needsFormationHost(u)).toBe(false); expect(b.issue({ unitId: u.id, type: 'hold' }).ok).toBe(true); }
      const restored = b instanceof SmallBattle ? SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot()))) : MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
      expect(restored.byId(u.id).weapon).toEqual(u.weapon); expect(restored.byId(u.id).formation).toEqual(u.formation);
      expect(mean(restored.byId(u.id))).toBeCloseTo(mean(u));
      expect(() => combatantFromUnknown(JSON.parse(JSON.stringify(u)))).not.toThrow();
    }
  });
  it('射程强化不改变召唤落点或复合技能施放距离；远程召唤不能穿墙射击', () => {
    for (const mechanism of ['单体召唤', '魔法单体+单体召唤', '火墙+群体召唤']) {
      const id = skillMechanismId(parseSkillMechanism(mechanism)!);
      const base = summoned(), boosted = summoned();
      base.abilities = [compileSkill({ id }, 3, 'a')]; boosted.abilities = [compileSkill({ id, bonuses: { range: 10 } }, 3, 'a')];
      upgradeCombatSkills(base); upgradeCombatSkills(boosted);
      expect(gridAbility(boosted.abilities[0]!).range).toEqual(gridAbility(base.abilities[0]!).range);
    }
    const { b, a, e, ability } = setup('small', '箭灵:单体召唤L3+10射程');
    if (!(b instanceof SmallBattle)) throw Error('expected small battle');
    expect(b.useAbility(a.id, ability.id).ok).toBe(true);
    const u = b.combatants.find(u => u.summonerId === a.id)!;
    expect([38, 44, 46, 52]).toContain(u.pos);
    b.endTurn(); b.endTurn(); u.pos = 45; e.pos = 31; a.pos = 60; b.turnOrder = [u.id, e.id, a.id]; b.turnIndex = 0;
    b.battlefield!.tiles[38] = 'wall';
    expect(() => b.attack(u.id, e.id)).toThrow(/视线/);
    b.battlefield!.tiles[38] = 'open';
    expect(() => b.attack(u.id, e.id)).not.toThrow();
  });
  it.each(['small', 'mass'] as const)('%s：落点不足不扣费、不留下部分召唤', mode => {
    const { b, a, e, ability } = setup(mode, '灵群:群体召唤L3'), sp = a.resources.SP;
    if (b instanceof SmallBattle) {
      for (const cell of [38, 44, 46, 52]) b.battlefield!.tiles[cell] = 'wall';
      expect(b.useAbility(a.id, ability.id).ok).toBe(false);
    } else {
      for (let i = 0; i < 3; i++) { const u = structuredClone(a); u.id = `reserve-${i}`; u.tags = ['zone:中军', 'rank:reserve']; b.combatants.push(u); b.issue({ unitId: u.id, type: 'hold' }); }
      const result = b.useAbility(a.id, ability.id, a.id);
      if (result.ok) { b.issue({ unitId: e.id, type: 'hold' }); b.resolveRound(); }
    }
    expect(a.resources.SP).toBe(sp); expect(b.combatants.filter(u => u.summonerId === a.id)).toHaveLength(0);
  });
});
