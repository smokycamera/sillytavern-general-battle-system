import { describe, expect, it } from 'vitest';
import {
  generateUnit, prepareCombatModel, prepareArmsModel, prepareTraitModel, prepareTraitLevelModel,
  prepareItemModel, prepareResourceModel, V27_OVERFLOW_D20, V28_OVERFLOW_D20,
  standardConditionMap, traitRegistry, resolveAttack, previewAttack, SeededRng, SmallBattle,
  standardField, applyDamagePlan, applyXp, XP_LEVEL_COSTS, fullMorale, setMoraleLock,
  type Combatant, type RulePack,
} from '../src/index.js';
import { anchoredWeaponLabel, combatWeapon } from '../src/power-anchors.js';
import { BOUNDED_BLAST_MODEL } from '../src/artillery-model.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';

const conditions = standardConditionMap(), registry = traitRegistry();
function unit(kind = 'sprayer', count = 50, level = 5, rules: RulePack = V28_OVERFLOW_D20, hero = false): Combatant {
  const u = generateUnit({ name: kind, side: kind === 'sword' ? 'enemy' : 'ally', scale: hero ? 'hero' : 'company',
    rulesVersion: 'v2', damageModel: 'wounds-v2', numericModel: 'graded-v1', body: 'human', level,
    ...(!hero ? { hpMax: count } : {}), weaponClass: kind, weaponLevel: level, armorTier: kind === 'sword' ? 1 : 0,
    armorLevel: level, traits: [] }, { seed: `${kind}:${count}:${level}`, noVariance: true }).unit;
  for (const prepare of [prepareCombatModel, prepareArmsModel, prepareTraitModel, prepareTraitLevelModel, prepareItemModel, prepareResourceModel]) prepare(u, rules);
  return u;
}
function opts(a: Combatant, d: Combatant, rules: RulePack = V28_OVERFLOW_D20) {
  return { attacker: a, defender: d, rules, conditionDefs: conditions, traitRegistry: registry, ranged: true, distance: 1 };
}

describe('V28 火箭筒与喷射范围', () => {
  it('火箭筒按自身规格逐级波及，旧配方不重编，火炮名额和旧战斗保留', () => {
    const oldSlots = [0, 0, 1, 1, 2, 2, 4, 10, 14, 22];
    for (let level = 1; level <= 10; level++) {
      const a = unit('rocket', 50, level), d = unit('sword', 100, level), before = JSON.stringify(a.weapon);
      expect(combatWeapon(a.weapon, a, d)?.splashTargets).toBe(Math.max(0, level - 2));
      expect(combatWeapon(a.weapon, { ...a, artilleryModel: 'blast-decay-v1' }, d)?.splashTargets).toBe(oldSlots[level - 1]);
      expect(JSON.stringify(a.weapon)).toBe(before);
      const cannon = unit('cannon', 50, level);
      expect(combatWeapon(cannon.weapon, cannon, d)).toEqual(combatWeapon(cannon.weapon, { ...cannon, artilleryModel: 'blast-decay-v1' }, d));
    }
    const rocket = unit('rocket', 50, 10);
    expect(anchoredWeaponLabel(rocket.weapon, 'wounds-v2', rocket.artilleryModel)).toContain('另及8名额');
    expect(anchoredWeaponLabel(rocket.weapon, 'wounds-v2', 'blast-decay-v1')).toContain('另及22名额');
    expect(anchoredWeaponLabel(unit().weapon, 'wounds-v2', BOUNDED_BLAST_MODEL)).toContain('另及7名额');
  });

  it('会战喷射波及有界，人数增加不会无界放大整次攻击，真实命中包含余伤和伤员累积', () => {
    const a = unit(), old = unit('sprayer', 50, 5, V27_OVERFLOW_D20);
    let currentLoss = 0, historicalLoss = 0;
    for (let i = 0; i < 48; i++) {
      const d = unit('sword', 100), previous = unit('sword', 100, 5, V27_OVERFLOW_D20);
      const hit = resolveAttack({ ...opts(a, d), rng: new SeededRng(`spray:${i}`) });
      for (const plan of hit.damagePlans ?? []) expect(plan.splashTargets ?? 0).toBeLessThanOrEqual(plan.targets * 7);
      resolveAttack({ ...opts(old, previous, V27_OVERFLOW_D20), rng: new SeededRng(`spray:${i}`) });
      currentLoss += 100 - d.hp; historicalLoss += 100 - previous.hp;
    }
    expect(currentLoss).toBeGreaterThan(0);
    expect(currentLoss).toBeLessThan(historicalLoss / 3);
  });

  it('预览只读，混用规则不会命中旧缓存；延后伤损提交与实际结算一致', () => {
    const a = unit(), d = unit('sword', 100), before = JSON.stringify(d);
    const next = previewAttack(opts(a, d));
    const old = previewAttack(opts(a, d, V27_OVERFLOW_D20));
    expect(old.expectedDamage).toBeGreaterThan(next.expectedDamage);
    expect(previewAttack(opts(a, d))).toEqual(next);
    expect(JSON.stringify(d)).toBe(before);
    const actual = structuredClone(d), deferred = structuredClone(d);
    const result = resolveAttack({ ...opts(a, actual), rng: new SeededRng('deferred') });
    for (const plan of result.damagePlans ?? []) applyDamagePlan(deferred, plan);
    expect(deferred.formation).toEqual(actual.formation);
    expect(deferred.hp).toBe(actual.hp);
  });

  it('格子喷射保持既有扇形入口；油箱自动命中的显式预算不套用新范围规则', () => {
    for (const tank of [false, true]) {
      const a = unit(), d = unit('sword', 100), oldD = structuredClone(d);
      if (!tank) { a.pos = 20; d.pos = oldD.pos = 21; }
      const input = { ...opts(a, d), ...(tank ? { autoHit: true, weaponOverride: { ...a.weapon!, splashTargets: 3 } } : {}) };
      const next = resolveAttack({ ...input, rng: new SeededRng('grid-tank') });
      const old = resolveAttack({ ...input, defender: oldD, rules: V27_OVERFLOW_D20, rng: new SeededRng('grid-tank') });
      expect(next.finalDamage).toBe(old.finalDamage);
      expect(d.formation).toEqual(oldD.formation);
    }
  });

  it('旧V27和新V28快照分别保留范围规则，新标记能通过单位读档校验', () => {
    for (const rules of [V27_OVERFLOW_D20, V28_OVERFLOW_D20]) {
      const a = unit('rocket', 50, 10, rules), d = unit('sword', 100, 10, rules), field = standardField(); field.tiles.fill('open');
      const battle = new SmallBattle({ combatants: [a, d], rules, battlefield: field, seed: 'saved-area', traitRegistry: registry });
      battle.start(); const saved = battle.toSnapshot();
      expect(SmallBattle.fromSnapshot(structuredClone(saved), { traitRegistry: registry }).toSnapshot()).toEqual(saved);
      expect(combatantFromUnknown(JSON.parse(JSON.stringify(a))).artilleryModel).toBe(rules.artilleryModel);
    }
    const bad = unit(); (bad as { artilleryModel?: string }).artilleryModel = 'unknown';
    expect(() => combatantFromUnknown(bad)).toThrow();
  });

  it('hero基础士气按训练每级+3，单位修正按当级换算，锁满与升级上限一致', () => {
    const hero = unit('sword', 1, 1, V28_OVERFLOW_D20, true);
    hero.bonuses = { morale: 1 }; hero.base.moraleMax! += 3; hero.morale = hero.base.moraleMax;
    setMoraleLock(hero, true);
    for (let level = 1; level <= 10; level++) {
      expect(hero.level).toBe(level);
      expect(hero.base.moraleMax).toBe(60 + 3 * (level - 1) + level + 2);
      expect(fullMorale(hero)).toBe(hero.base.moraleMax);
      expect(hero.morale).toBe(hero.base.moraleMax);
      if (level < 10) applyXp(hero, XP_LEVEL_COSTS[level - 1]!, registry);
    }
  });
});
