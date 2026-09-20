import { describe, it, expect } from 'vitest';
import { resolveAttack, armorDR } from '../src/damage';
import { LITE_D20 } from '../src/rules';
import { standardConditionMap } from '../src/conditions';
import type { Combatant, Trait } from '../src/types';
import type { Rng } from '../src/rng';

/** 脚本化随机源：按序消费 [0,1) 浮点，循环兜底 */
class FakeRng implements Rng {
  seed = 'fake';
  private i = 0;
  constructor(private seq: number[]) {}
  next(): number {
    return this.seq[this.i++ % this.seq.length] ?? 0;
  }
  d(sides: number): number {
    return 1 + Math.floor(this.next() * sides);
  }
}

const condDefs = standardConditionMap();

function hero(p: Partial<Combatant> & { atk?: number; def?: number } = {}): Combatant {
  const { atk = 5, def = 12, base, hp, ...rest } = p;
  const b = { atk, def, spd: base?.spd ?? 2, hpMax: base?.hpMax ?? 20 };
  return {
    id: 'u', name: '测试单位', side: 'ally', scale: 'hero', level: 1, tags: [],
    base: b, hp: hp ?? b.hpMax, conditions: [], abilities: [], abilityState: [],
    resources: {}, traits: [], engagedWith: [], status: 'ready', fatigue: 0,
    ...rest,
  };
}

const f = (die: number, sides: number) => (die - 1) / sides; // 把想要的骰面转成浮点

describe('命中判定（d20 模式）', () => {
  it('普通命中：骰面+加成 ≥ 防御', () => {
    const a = hero({ id: 'a', weapon: { id: 'w', name: '长剑', baseDice: '1d8+3' } });
    const d = hero({ id: 'd', side: 'enemy', def: 12 });
    // d20=15 → 15+5=20 ≥ 12 命中；d8=4
    const rng = new FakeRng([f(15, 20), f(4, 8)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs });
    expect(r.hit).toBe(true);
    expect(r.crit).toBe(false);
  });

  it('天然 1 自动未命中', () => {
    const a = hero({ id: 'a', weapon: { id: 'w', name: '长剑', baseDice: '1d8+3' } });
    const d = hero({ id: 'd', side: 'enemy', def: 5 });
    const rng = new FakeRng([f(1, 20)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs });
    expect(r.hit).toBe(false);
    expect(r.finalDamage).toBe(0);
  });

  it('tw 模式：命中率公式与截断', () => {
    const a = hero({ id: 'a', atk: 5, weapon: { id: 'w', name: '步枪', baseDice: '1d8' } });
    const d = hero({ id: 'd', side: 'enemy', def: 12 });
    // chance = 0.35 + (5-(12-10))*0.05 = 0.5
    const rng = new FakeRng([0.49, f(4, 8)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: { ...LITE_D20, hitMode: 'tw' }, conditionDefs: condDefs });
    expect(r.hitChance).toBeCloseTo(0.5);
    expect(r.hit).toBe(true);
    expect(r.finalDamage).toBe(4);
    // 攻防差极大时截断到下限
    const rng2 = new FakeRng([0.99]);
    const r2 = resolveAttack({
      attacker: hero({ id: 'a2', atk: 0, weapon: { id: 'w', name: '步枪', baseDice: '1d8' } }),
      defender: hero({ id: 'd2', side: 'enemy', def: 40 }),
      rng: rng2, rules: { ...LITE_D20, hitMode: 'tw' }, conditionDefs: condDefs,
    });
    expect(r2.hitChance).toBeCloseTo(0.05);
  });
});

describe('分段伤害：减伤比例 / 破甲 / 守护 / 暴击', () => {
  const mk = () => ({
    a: hero({ id: 'a', weapon: { id: 'w', name: '长剑', baseDice: '1d8+3' } }),
    d: hero({ id: 'd', side: 'enemy', armor: { id: 'ar', name: '板甲', tier: 2 } }),
  });

  it('护甲减伤只作用于普通段', () => {
    const { a, d } = mk();
    const rng = new FakeRng([f(15, 20), f(4, 8)]); // d20=15 命中；d8=4
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs });
    // 普通段 4+3=7，DR 35% → floor(7*0.65)=4
    expect(r.drPercent).toBe(35);
    expect(r.baseAfterDR).toBe(4);
    expect(r.finalDamage).toBe(4);
    expect(d.hp).toBe(16);
  });

  it('破甲段无视护甲全额结算', () => {
    const { a, d } = mk();
    a.weapon = { id: 'w', name: '战锤', baseDice: '1d8+3', apDice: '1d6' };
    const rng = new FakeRng([f(15, 20), f(4, 8), f(3, 6)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs });
    // 普通 7→DR→4；破甲 3 全额 → 7
    expect(r.apTotal).toBe(3);
    expect(r.finalDamage).toBe(7);
  });

  it('暴击：骰面翻倍、固定加值不翻倍', () => {
    const { a, d } = mk();
    const rng = new FakeRng([f(20, 20), f(4, 8), f(5, 8)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs });
    expect(r.crit).toBe(true);
    // 骰面 4+5=9，加值 3 一次 → 12 → DR35% → floor(7.8)=7
    expect(r.baseRoll!.total).toBe(12);
    expect(r.finalDamage).toBe(7);
  });

  it('守护：全伤害乘法减免，不可被破甲绕过', () => {
    const { a, d } = mk();
    d.traits = ['ward-25'];
    const traits = new Map<string, Trait>([
      ['ward-25', { id: 'ward-25', name: '守护25', desc: '', effects: [{ kind: 'ward', percent: 25 }] }],
    ]);
    a.weapon = { id: 'w', name: '战锤', baseDice: '1d8+3', apDice: '1d6' };
    const rng = new FakeRng([f(15, 20), f(4, 8), f(3, 6)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs, traitRegistry: traits });
    // (floor(7*0.65) + 3) * 0.75 = (4+3)*0.75 = 5.25 → round 5
    expect(r.wardMult).toBeCloseTo(0.75);
    expect(r.finalDamage).toBe(5);
  });

  it('破甲占比特质：普通段按比例转入破甲段', () => {
    const { a, d } = mk();
    a.traits = ['ap-half'];
    const traits = new Map<string, Trait>([
      ['ap-half', { id: 'ap-half', name: '破甲强化', desc: '', effects: [{ kind: 'apShare', percent: 50 }] }],
    ]);
    const rng = new FakeRng([f(15, 20), f(4, 8)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs, traitRegistry: traits });
    // 普通段 7 → 3.5≈4 转破甲（round），剩 3 → floor(3*0.65)=1；破甲 4 → 共 5
    expect(r.apTotal).toBe(4);
    expect(r.baseAfterDR).toBe(1);
    expect(r.finalDamage).toBe(5);
  });
});

describe('护甲等级映射', () => {
  it('等级 → 减伤比例，特质可升降档', () => {
    const u = hero({ armor: { id: 'ar', name: '中甲', tier: 1 } });
    expect(armorDR(u, LITE_D20)).toBeCloseTo(0.2);
    const traits = new Map<string, Trait>([
      ['heavy', { id: 'heavy', name: '重甲', desc: '', effects: [{ kind: 'armorTier', value: 1 }] }],
    ]);
    u.traits = ['heavy'];
    expect(armorDR(u, LITE_D20, traits)).toBeCloseTo(0.35);
    // 越界截断
    u.armor!.tier = 4;
    u.traits = ['heavy'];
    expect(armorDR(u, LITE_D20, traits)).toBeCloseTo(0.6);
  });

  it('等级差压制：低级武器打高级甲，减伤按差距提升、加成封顶 36%', () => {
    const a = hero({ id: 'a', weapon: { id: 'w', name: '柴刀', baseDice: '1d6+1', level: 1 } });
    const d = hero({ id: 'd', side: 'enemy', armor: { id: 'ar', name: '龙鳞宝铠', tier: 3, level: 9 } });
    const rng = new FakeRng([f(15, 20), f(4, 6)]);
    const r = resolveAttack({ attacker: a, defender: d, rng, rules: LITE_D20, conditionDefs: condDefs });
    // 重甲表值 50% + 差距 8 级 ×4% = 82%
    expect(r.drPercent).toBe(82);
    // 差距拉满（护甲 L10 vs 武器 L1）：50% + 36%（上限）= 86%
    d.armor!.level = 10;
    const r2 = resolveAttack({ attacker: a, defender: d, rng: new FakeRng([f(15, 20), f(4, 6)]), rules: LITE_D20, conditionDefs: condDefs });
    expect(r2.drPercent).toBe(86);
  });

  it('同级对决与无甲不吃等级差加成', () => {
    const a = hero({ id: 'a', level: 5, weapon: { id: 'w', name: '长剑', baseDice: '1d8+3', level: 5 } });
    const same = hero({ id: 'd', side: 'enemy', level: 5, armor: { id: 'ar', name: '板甲', tier: 3, level: 5 } });
    const rng = new FakeRng([f(15, 20), f(4, 8)]);
    expect(resolveAttack({ attacker: a, defender: same, rng, rules: LITE_D20, conditionDefs: condDefs }).drPercent).toBe(50);
    // 无甲（tier 0）：即便佩戴者等级高也无压制加成
    const naked = hero({ id: 'd2', side: 'enemy', level: 9, armor: { id: 'ar0', name: '无甲', tier: 0, level: 9 } });
    const r = resolveAttack({ attacker: a, defender: naked, rng: new FakeRng([f(15, 20), f(4, 8)]), rules: LITE_D20, conditionDefs: condDefs });
    expect(r.drPercent).toBe(0);
  });
});
