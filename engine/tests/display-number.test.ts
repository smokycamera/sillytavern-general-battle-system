import { describe, it, expect } from 'vitest';
import { approx, approxDelta, displayNumber } from '../src/index.js';

describe('display-only number rounding', () => {
  it('caps player values at two decimal places without padding integers or changing stored values', () => {
    const values = [12, 12.5, 12.34567, -12.34567, 0.1 + 0.2, 0.004, -0];
    const original = [...values];
    expect(values.map(displayNumber)).toEqual(['12', '12.5', '12.35', '-12.35', '0.3', '0', '0']);
    expect(values).toEqual(original);
  });
  it('keeps exact values and marks rounded ones', () => {
    expect([approx(6), approx(6.5), approx(0.1 + 0.2), approx(2 / 3), approx(1.18, 2), approx(6.25, 1, 'down')]).toEqual(['6', '6.5', '0.3', '≈0.7', '1.18', '≈6.2']);
  });
  it('never shows a threshold as reached early or a remainder as nothing', () => {
    expect([approx(49.96, 1, 'down'), approx(0.04, 1, 'up'), approx(66.6667, 0)]).toEqual(['≈49.9', '≈0.1', '≈67']);
  });
  it('signs changes and drops binary noise', () => {
    expect([approxDelta(0.7699999999999999), approxDelta(-0.38), approxDelta(3), approxDelta(-2), approxDelta(0.04)]).toEqual(['≈+0.8', '≈-0.4', '+3', '-2', '≈0']);
  });
});
