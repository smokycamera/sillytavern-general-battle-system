import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, V2_D20, V2_TW } from '../src/index.js';
import { previewAttack, resolveAttack } from '../src/damage.js';
import { SeededRng } from '../src/rng.js';
const registry = traitRegistry();
describe('V2预览与结算概率一致', () => {
  it('计算未命中、暴击加骰、穿透取整和群体换算的准确均值', () => {
    const actor = generateUnit({ name: 'a', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 4, traits: [] }, { seed: 'a', registry }).unit;
    const target = structuredClone(actor); target.id = 'b'; target.side = 'enemy'; target.scale = 'company'; target.hp = target.base.hpMax = 10000;
    actor.weapon!.baseDice = '1d6+2'; actor.weapon!.attacks = 1; actor.weapon!.penetration = 3;
    target.armor!.protection = { kinetic: 3, thermal: 3, arcane: 3 };
    actor.base.atk = 0; target.base.def = 11;
    const result = previewAttack({ attacker: actor, defender: target, rules: V2_D20, conditionDefs: new Map() });
    // 小数采用无偏取整；普通/暴击的完整期望经过穿透和编队换算后仍保留。
    expect(result.exact).toBe(true); expect(result.hitChance).toBeCloseTo(0.5);
    expect(result.expectedDamage).toBeCloseTo((0.45 * (3.5 + 2) + 0.05 * (7 + 2)) * 0.55 / 10);
    const advantage = previewAttack({ attacker: actor, defender: target, rules: V2_D20, advantage: 'adv', conditionDefs: new Map() });
    expect(advantage.hitChance).toBeCloseTo(0.75); expect(advantage.expectedDamage).toBeGreaterThan(result.expectedDamage);
  });
  it('固定种子实际样本均值与精确预览吻合；只预览不消耗实战随机状态', () => {
    const actor = generateUnit({ name: 'a', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 4, weaponClass: 'rifle', traits: [] }, { seed: 'a', registry }).unit;
    const target = structuredClone(actor); target.id = 'b'; target.side = 'enemy';
    const rng = new SeededRng('probability-audit'); const before = rng.getState();
    const opts = { attacker: actor, defender: target, rules: V2_TW, ranged: true, conditionDefs: new Map() };
    const preview = previewAttack(opts); expect(rng.getState()).toBe(before);
    let total = 0;
    for (let i = 0; i < 10000; i++) for (let shot = 0; shot < (actor.weapon?.attacks ?? 1); shot++) total += resolveAttack({ ...opts, defender: structuredClone(target), rng }).finalDamage;
    expect(Math.abs(total / 10000 - preview.expectedDamage)).toBeLessThan(0.12);
  });
});
