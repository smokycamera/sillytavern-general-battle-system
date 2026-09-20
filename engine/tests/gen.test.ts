import { describe, it, expect } from 'vitest';
import { generateUnit, traitCatalog } from '../src/gen/generator';
import { TRAITS, traitRegistry } from '../src/data/traits';
import { CURVES } from '../src/data/curves';
import { armorDR } from '../src/damage';
import { LITE_D20 } from '../src/rules';
import { SKINS, getSkin } from '../src/data/skins';

const reg = traitRegistry();

describe('造怪器基准与浮动', () => {
  const input = {
    name: '黑鸢重骑兵', scale: 'company' as const, archetype: 'mobile' as const,
    level: 3, traits: ['heavy-armor'], side: 'enemy' as const, era: 'medieval',
  };

  it('同种子输出完全一致（可复现）', () => {
    const a = generateUnit(input, { seed: 'aaaa1111' });
    const b = generateUnit(input, { seed: 'aaaa1111' });
    expect(a.unit).toEqual(b.unit);
    expect(a.audit.seed).toBe('aaaa1111');
  });

  it('不同种子产生不同浮动，且在 ±2 / ±10% 区间内', () => {
    const base = generateUnit({ ...input, traits: [] }, { seed: 'bbbb2222', noVariance: true }).unit;
    for (const seed of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      const { unit, audit } = generateUnit({ ...input, traits: [] }, { seed });
      for (const key of ['atk', 'def', 'spd'] as const) {
        const delta = unit.base[key] - base.base[key];
        expect(Math.abs(delta)).toBeLessThanOrEqual(2);
      }
      const hpDelta = unit.base.hpMax - base.base.hpMax;
      expect(Math.abs(hpDelta)).toBeLessThanOrEqual(Math.ceil(base.base.hpMax * 0.1));
      expect(audit.deltas).toBeDefined();
    }
    // 多个种子里至少出现两种不同结果
    const set = new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((s) => JSON.stringify(generateUnit({ ...input, traits: [] }, { seed: s }).unit.base)));
    expect(set.size).toBeGreaterThan(1);
  });

  it('连队刻度：HP=兵员数，带士气', () => {
    const { unit } = generateUnit(input, { seed: 'comp-test', noVariance: true });
    const curve = CURVES[2]!;
    expect(unit.base.hpMax).toBe(curve.men);
    expect(unit.morale).toBe(curve.morale);
    expect(unit.xpValue).toBe(curve.xp * 3);
  });

  it('杂兵刻度：HP=1，经验按 1/4', () => {
    const { unit } = generateUnit(
      { name: '鼠群', scale: 'mook', archetype: 'infantry', level: 1, traits: [], side: 'enemy' },
      { seed: 'mook-test' },
    );
    expect(unit.base.hpMax).toBe(1);
    expect(unit.xpValue).toBe(Math.round(CURVES[0]!.xp * 0.25));
    expect(unit.tags).toContain('mook');
  });

  it('特质静态修正生效（精锐 +2/+2/+8HP，重甲护甲档 +1）', () => {
    const plain = generateUnit({ name: '剑士', scale: 'hero', archetype: 'infantry', level: 3, traits: [], side: 'enemy' }, { seed: 't1', noVariance: true }).unit;
    const elite = generateUnit({ name: '精锐剑士', scale: 'hero', archetype: 'infantry', level: 3, traits: ['elite'], side: 'enemy' }, { seed: 't1', noVariance: true }).unit;
    expect(elite.base.atk - plain.base.atk).toBe(2);
    expect(elite.base.def - plain.base.def).toBe(2);
    expect(elite.base.hpMax - plain.base.hpMax).toBe(8);

    const heavy = generateUnit({ name: '重装兵', scale: 'hero', archetype: 'infantry', level: 3, traits: ['heavy-armor'], side: 'enemy' }, { seed: 't1', noVariance: true }).unit;
    // infantry 默认轻甲(tier1)，重甲特质运行时 +1 档 → DR 35%
    expect(armorDR(heavy, LITE_D20, reg)).toBeCloseTo(0.35);
  });

  it('英雄带 SP 资源；技能不自动硬塞（无 AI 声明则无法术）', () => {
    const { unit } = generateUnit({ name: '艾莉', scale: 'hero', archetype: 'ranged', level: 2, traits: [], side: 'ally' }, { seed: 'hero-test' });
    expect(unit.resources.SP).toBe(5);
    // 无 persona / abilityIds / abilityBlueprints 声明 → 不带任何技能（去掉旧的自动签名技能）
    expect(unit.abilities).toHaveLength(0);
    expect(unit.weapon!.tags).toContain('ranged');
  });

  it('原型倾向：机动快、远程脆、步兵硬', () => {
    const mk = (arch: 'infantry' | 'ranged' | 'mobile') =>
      generateUnit({ name: 'T', scale: 'hero', archetype: arch, level: 3, traits: [], side: 'enemy' }, { seed: 'x', noVariance: true }).unit;
    const inf = mk('infantry'), rng = mk('ranged'), mob = mk('mobile');
    expect(mob.base.spd).toBeGreaterThan(inf.base.spd);
    expect(inf.base.def).toBeGreaterThan(rng.base.def);
    expect(inf.armor!.tier).toBeGreaterThanOrEqual(1);
    // 远程 L3 破甲段渐进（约 62.5% 系数）：不再是零，也不再 L5 整段解锁
    expect(rng.weapon!.apDice).toBeDefined();
    expect(rng.weapon!.level).toBe(3); // 品质等级戳随佩戴者
  });

  it('远程风格独立于原型：机动+远程=骑射手，破甲段随等级渐进（L5 起全额）', () => {
    const mk = (level: number) =>
      generateUnit(
        { name: '弓骑', scale: 'hero', archetype: 'mobile', level, traits: [], side: 'enemy', loadout: 'ranged', era: 'medieval' },
        { seed: 'hr', noVariance: true, registry: reg },
      ).unit;
    const low = mk(3);
    expect(low.weapon!.name).toBe('骑弓');
    expect(low.weapon!.tags).toContain('ranged');
    expect(low.weapon!.range).toBe(4);
    expect(low.abilities).toHaveLength(0); // 无 AI 声明 → 不自动给骑弓配跑射技能
    expect(low.weapon!.apDice).toBeDefined(); // L3 渐进系数 62.5%，小骰面
    const hi = mk(6);
    expect(hi.weapon!.apDice).toBeDefined(); // L6 ≥ 5 全额
    expect(hi.weapon!.apDice).toBe(CURVES[5]!.dmgAp);
  });

  it('护甲浮动有区分度且被输入覆盖', () => {
    const tiers = new Set<number>();
    for (const seed of ['ar1', 'ar2', 'ar3', 'ar4', 'ar5', 'ar6', 'ar7', 'ar8', 'ar9', 'ar10', 'ar11', 'ar12']) {
      const { unit } = generateUnit(
        { name: '兵', scale: 'hero', archetype: 'ranged', level: 1, traits: [], side: 'enemy' },
        { seed, registry: reg },
      );
      expect(unit.armor!.tier).toBeGreaterThanOrEqual(0);
      expect(unit.armor!.tier).toBeLessThanOrEqual(1); // 远程基准 0，浮动 ±1
      tiers.add(unit.armor!.tier);
    }
    expect(tiers.size).toBeGreaterThan(1); // 同类单位护甲不再零差异
    const fixed = generateUnit(
      { name: '兵', scale: 'hero', archetype: 'ranged', level: 1, traits: [], side: 'enemy', armorTier: 3 },
      { seed: 'ar-fix', registry: reg },
    ).unit;
    expect(fixed.armor!.tier).toBe(3);
    expect(fixed.armor!.name).toBe('重甲');
  });
});

describe('特质库与皮肤', () => {
  it('特质库 ≥30 且 id 唯一', () => {
    expect(TRAITS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(TRAITS.map((t) => t.id)).size).toBe(TRAITS.length);
  });

  it('目录分组覆盖全部特质', () => {
    const cat = traitCatalog();
    const listed = cat.flatMap((g) => g.traits.map((t) => t.id));
    expect(new Set(listed).size).toBe(TRAITS.length);
  });

  it('四套时代皮肤齐备且术语映射有效', () => {
    expect(Object.keys(SKINS).length).toBe(4);
    expect(getSkin('scifi').weapons.mobile).toBe('脉冲炮');
    expect(getSkin(undefined!).id).toBe('medieval');
  });
});
