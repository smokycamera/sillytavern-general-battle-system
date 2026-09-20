import { describe, it, expect } from 'vitest';
import { SeededRng, hashSeed } from '../src/rng';

describe('SeededRng', () => {
  it('同种子序列完全可复现', () => {
    const a = new SeededRng('battle-42');
    const b = new SeededRng('battle-42');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('不同种子序列不同', () => {
    const a = new SeededRng('seed-a');
    const b = new SeededRng('seed-b');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('d(sides) 落在 1..sides', () => {
    const rng = new SeededRng('dice-bounds');
    for (let i = 0; i < 500; i++) {
      const v = rng.d(20);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('hashSeed 对相同字符串稳定', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});
