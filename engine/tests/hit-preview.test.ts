import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, previewAttack, resolveAttack, standardConditionMap, traitRegistry,
  V7_OVERFLOW_D20, V8_OVERFLOW_D20, V8_OVERFLOW_TW, grantBarrier, type AttackOpts } from '../src/index.js';

function options(): Omit<AttackOpts, 'rng'> {
  const registry = traitRegistry();
  const units = ['a', 'd'].map(id => {
    const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', level: 1,
      rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'sword', armorTier: 0, traits: [] },
    { seed: id, registry, noVariance: true }).unit;
    prepareCombatModel(u, V8_OVERFLOW_D20); u.base.atk = 0; u.base.def = 13; u.hp = u.base.hpMax = 1000; return u;
  });
  return { attacker: units[0]!, defender: units[1]!, rules: V8_OVERFLOW_D20, conditionDefs: standardConditionMap(),
    traitRegistry: registry, ranged: true, abilityDamage: { baseDice: '1d2+9', damageScale: 1, channel: 'kinetic', penetration: 100, delivery: 'magic' } };
}

describe('玩家的命中后伤害', () => {
  it.each([V7_OVERFLOW_D20, V8_OVERFLOW_D20])('$id 与实际普通命中、暴击、剩余生命裁剪的完整骰分布相符', rules => {
    const opts = options(); opts.rules = rules; opts.defender.hp = 11;
    const before = JSON.stringify([opts.attacker, opts.defender]);
    const preview = previewAttack(opts);
    let sum = 0, hits = 0, normal = 0, normalSum = 0, crit = 0, critSum = 0;
    for (let natural = 1; natural <= 20; natural++) for (const x of [1, 2]) for (const y of [1, 2]) {
      const dice = [natural, x, y];
      const result = resolveAttack({ ...opts, defender: structuredClone(opts.defender), rng: { seed: 'enumerated', next: () => .5, d: () => dice.shift()! } });
      sum += result.finalDamage;
      if (result.hit) { hits++; if (result.crit) { crit++; critSum += result.finalDamage; } else { normal++; normalSum += result.finalDamage; } }
    }
    expect(preview.expectedDamage).toBeCloseTo(sum / 80, 8);
    expect(preview.damageOnHit).toBeCloseTo(sum / hits, 8);
    expect(preview.normalHitDamage).toBeCloseTo(normalSum / normal, 8);
    expect(preview.criticalHitDamage).toBeCloseTo(critSum / crit, 8);
    expect(preview.damageOnHit).toBeLessThanOrEqual(11);
    expect(JSON.stringify([opts.attacker, opts.defender])).toBe(before);
  });

  it('无暴击时，提高命中率不提高命中后的伤害；AI期望仍随命中率变化', () => {
    const opts = options(); opts.rules = V8_OVERFLOW_TW;
    const low = previewAttack(opts);
    opts.attacker.base.atk += 5;
    const high = previewAttack(opts);
    expect(high.hitChance).toBeGreaterThan(low.hitChance);
    expect(high.expectedDamage).toBeGreaterThan(low.expectedDamage);
    expect(high.damageOnHit).toBeCloseTo(low.damageOnHit!, 8);
    expect(high.criticalHitDamage).toBeUndefined();
  });

  it('连射采用整次行动命中概率，命中但被屏障吸收仍算命中', () => {
    const opts = options(); opts.rules = { ...V8_OVERFLOW_TW, tw: { ...V8_OVERFLOW_TW.tw, min: .5, max: .5 } };
    delete opts.abilityDamage;
    opts.attacker.weapon = { id: 'two', name: '双发', baseDice: '1d2+9', damageScale: 1, customized: true, powerModel: 'anchors-v1', penetration: 100, attacks: 2, range: 3, tags: ['ranged'] };
    const preview = previewAttack(opts);
    expect(preview.hitChance).toBe(.5);
    expect(preview.anyHitChance).toBe(.75);
    expect(preview.expectedDamage).toBeCloseTo(10.5, 8);
    expect(preview.damageOnHit).toBeCloseTo(14, 8);
    expect(preview.normalHitDamage).toBeUndefined();
    grantBarrier(opts.defender, 10, 3);
    // 两发各50%命中：零/一/两次命中后损失0/平均0.5/平均11，条件均值为4。
    // 屏障完全吸收的命中不能从分母剔除；否则显示会虚高。
    const partial = previewAttack(opts);
    expect(partial.damageOnHit).toBeGreaterThan(3);
    expect(partial.damageOnHit).toBeLessThan(5);
    grantBarrier(opts.defender, 100, 3);
    const before = JSON.stringify(opts.defender), blocked = previewAttack(opts);
    expect(blocked.anyHitChance).toBe(.75);
    expect(blocked.damageOnHit).toBe(0);
    expect(blocked.expectedDamage).toBe(0);
    expect(JSON.stringify(opts.defender)).toBe(before);
  });

  it('无法穿透时仍显示实际零伤害', () => {
    const opts = options(); opts.abilityDamage!.penetration = 0;
    opts.defender.armor = { id: 'plate', name: '重甲', tier: 3, level: 8 };
    const preview = previewAttack(opts);
    expect(preview.hitChance).toBeGreaterThan(0);
    expect(preview.damageOnHit).toBe(0);
    expect(preview.normalHitDamage).toBe(0);
    expect(preview.criticalHitDamage).toBe(0);
  });
});
