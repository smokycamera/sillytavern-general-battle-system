import { describe, it, expect } from 'vitest';
import { resolveStack, traitRuntimeMods, conditionMods, type Modifier } from '../src/bonus';
import { STANDARD_CONDITIONS } from '../src/conditions';
import type { Trait } from '../src/types';

const ctx = { attacker: undefined, defender: undefined };

describe('resolveStack 同名叠加规则', () => {
  it('同名平加值不叠加，取绝对值最高', () => {
    const mods: Modifier[] = [
      { source: 'intrinsic', name: '重甲', kind: 'atk', type: 'flat', value: 2 },
      { source: 'intrinsic', name: '重甲', kind: 'atk', type: 'flat', value: 3 },
      { source: 'stance', name: '冲锋', kind: 'atk', type: 'flat', value: 2 },
    ];
    const r = resolveStack(mods, 'atk', ctx);
    expect(r.flatTotal).toBe(5); // 重甲3 + 冲锋2
    expect(r.lines).toHaveLength(2);
  });

  it('同名允许叠加模式（规则包关闭）', () => {
    const mods: Modifier[] = [
      { source: 'intrinsic', name: '狂热', kind: 'atk', type: 'flat', value: 2 },
      { source: 'intrinsic', name: '狂热', kind: 'atk', type: 'flat', value: 2 },
    ];
    const r = resolveStack(mods, 'atk', ctx, { sameNameKeepsHighest: false });
    expect(r.flatTotal).toBe(4);
  });

  it('乘法修正相乘', () => {
    const mods: Modifier[] = [
      { source: 'intrinsic', name: '守护', kind: 'ward', type: 'mult', value: 0.8 },
      { source: 'condition', name: '祝福', kind: 'ward', type: 'mult', value: 0.75 },
    ];
    const r = resolveStack(mods, 'ward', ctx);
    expect(r.multTotal).toBeCloseTo(0.6);
  });

  it('平加值总量按上限截断', () => {
    const mods: Modifier[] = Array.from({ length: 10 }, () => ({
      source: 'temp' as const, name: '堆叠', kind: 'atk' as const, type: 'flat' as const, value: 5,
    }));
    // 同名去重后只剩一条 +5，换不同名
    const mods2: Modifier[] = Array.from({ length: 10 }, (_, i) => ({
      source: 'temp' as const, name: `堆叠${i}`, kind: 'atk' as const, type: 'flat' as const, value: 5,
    }));
    const r = resolveStack(mods2, 'atk', ctx, { maxFlat: 30 });
    expect(r.flatTotal).toBe(30);
    void mods;
  });

  it('kind 过滤：只取请求的类型', () => {
    const mods: Modifier[] = [
      { source: 'stance', name: '冲锋', kind: 'atk', type: 'flat', value: 2 },
      { source: 'stance', name: '坚守', kind: 'def', type: 'flat', value: 2 },
    ];
    expect(resolveStack(mods, 'atk', ctx).flatTotal).toBe(2);
    expect(resolveStack(mods, 'def', ctx).flatTotal).toBe(2);
  });
});

describe('条件修正（克制/冲锋/盾墙）', () => {
  const attackerTags = { attacker: undefined, defender: { tags: ['large'] } as never, charge: true };

  it('vsTag 条件：目标带标签才生效', () => {
    const mods: Modifier[] = [
      { source: 'intrinsic', name: '克制·大型', kind: 'atk', type: 'flat', value: 3, cond: { vsTag: 'large' } },
    ];
    expect(resolveStack(mods, 'atk', attackerTags).flatTotal).toBe(3);
    expect(resolveStack(mods, 'atk', { ...attackerTags, defender: { tags: ['infantry'] } as never }).flatTotal).toBe(0);
  });

  it('charge 条件：仅冲锋时生效', () => {
    const mods: Modifier[] = [
      { source: 'intrinsic', name: '冲锋强化', kind: 'atk', type: 'flat', value: 2, cond: { charge: true } },
    ];
    expect(resolveStack(mods, 'atk', { charge: true }).flatTotal).toBe(2);
    expect(resolveStack(mods, 'atk', { charge: false }).flatTotal).toBe(0);
  });

  it('ranged 条件：仅远程攻击时生效（盾墙）', () => {
    const mods: Modifier[] = [
      { source: 'intrinsic', name: '盾墙', kind: 'ward', type: 'mult', value: 0.5, cond: { ranged: true } },
    ];
    expect(resolveStack(mods, 'ward', { ranged: true }).multTotal).toBeCloseTo(0.5);
    expect(resolveStack(mods, 'ward', { ranged: false }).multTotal).toBeCloseTo(1);
  });
});

describe('特质与状态的修正收集', () => {
  it('特质效果包正确转译', () => {
    const traits: Trait[] = [
      {
        id: 'anti-large', name: '克制·大型', desc: '',
        effects: [{ kind: 'conditionalAtk', vsTag: 'large', value: 3 }],
      },
      {
        id: 'heavy-armor', name: '重甲', desc: '',
        effects: [{ kind: 'armorTier', value: 1 }, { kind: 'stat', stat: 'def', value: 2 }],
      },
    ];
    const registry = new Map(traits.map((t) => [t.id, t]));
    const mods = traitRuntimeMods(['anti-large', 'heavy-armor'], registry);
    const defMods = mods.filter((m) => m.kind === 'def');
    expect(defMods).toHaveLength(1);
    expect(defMods[0]!.value).toBe(2);
    // armorTier 不是运行时修正
    expect(mods.some((m) => (m as never as { kind2?: string }) && m.name === '重甲' && m.kind === 'def')).toBe(true);
  });

  it('激活状态提供修正', () => {
    const defs = new Map(STANDARD_CONDITIONS.map((c) => [c.id, c]));
    const mods = conditionMods([{ id: 'inspired', dur: 2 }], defs);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ kind: 'atk', value: 2, duration: 2 });
  });
});
