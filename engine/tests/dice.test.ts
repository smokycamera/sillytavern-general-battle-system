import { describe, it, expect } from 'vitest';
import { parseDice, rollDice, rollDicePortion, rollDicePortionTotal } from '../src/dice';
import { SeededRng } from '../src/rng';

describe('parseDice', () => {
  it('解析基本式', () => {
    const e = parseDice('2d6+3');
    expect(e).toMatchObject({ count: 2, sides: 6, flat: 3 });
  });
  it('解析减值与保留', () => {
    expect(parseDice('1d20-2')).toMatchObject({ count: 1, sides: 20, flat: -2 });
    expect(parseDice('2d20kh1')).toMatchObject({ count: 2, sides: 20, keepHigh: 1, flat: 0 });
    expect(parseDice('4d6kl3')).toMatchObject({ count: 4, sides: 6, keepLow: 3 });
  });
  it('非法表达式抛错', () => {
    expect(() => parseDice('abc')).toThrow();
    expect(() => parseDice('0d6')).toThrow();
    expect(() => parseDice('2d6kh3')).toThrow(); // 保留数超过骰数
    expect(() => parseDice('1d1')).toThrow();
  });
});

describe('rollDice', () => {
  it('仅取总值与完整记录在普通、保留骰、暴击和固定加减值下保持总值与随机状态一致', () => {
    for (const expr of ['1d20', '2d6+3', '3d8-5', '2d20kh1', '2d20kl1', '4d6kh3+2', '4d6kl3-2', '2d6kh2']) {
      const full = new SeededRng(expr), compact = new SeededRng(expr);
      for (let i = 0; i < 32; i++) {
        const times = i % 2 + 1;
        expect(rollDicePortionTotal(expr, compact, times)).toBe(rollDicePortion(expr, full, times).total);
        expect(compact.getState()).toBe(full.getState());
      }
    }
  });
  it('kh 保留最高', () => {
    const rng = new SeededRng('kh-test');
    // 找一组 2d20 使两次骰面不同
    for (let i = 0; i < 20; i++) {
      const r = rollDice('2d20kh1', rng);
      expect(r.kept).toHaveLength(1);
      expect(r.kept[0]).toBe(Math.max(...r.rolls));
    }
  });
  it('kl 保留最低', () => {
    const rng = new SeededRng('kl-test');
    const r = rollDice('4d6kl3', rng);
    expect(r.kept).toHaveLength(3);
    expect(r.kept.reduce((s, v) => s + v, 0)).toBe([...r.rolls].sort((a, b) => a - b).slice(0, 3).reduce((s, v) => s + v, 0));
  });

  it('千次 d20 分布：均值与覆盖率合理', () => {
    const rng = new SeededRng('distribution');
    const N = 60000;
    const counts = new Array(21).fill(0);
    for (let i = 0; i < N; i++) counts[rng.d(20)]!++;
    // 每个面都应出现
    for (let face = 1; face <= 20; face++) {
      expect(counts[face]).toBeGreaterThan(N / 20 * 0.7);
    }
    let sum = 0;
    for (let face = 1; face <= 20; face++) sum += face * counts[face]!;
    const mean = sum / N;
    expect(mean).toBeGreaterThan(10.2);
    expect(mean).toBeLessThan(10.8); // 理论均值 10.5
  });
});
