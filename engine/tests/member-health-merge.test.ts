import { expect, it } from 'vitest';
import { mergeHealth } from '../src/member-health.js';

it.each([
  { input: [], expected: [] },
  { input: [{ hp: 10, count: 20 }], expected: [{ hp: 10, count: 20 }] },
  { input: [{ hp: 2, count: 1 }, { hp: 2, count: 3 }, { hp: 9, count: 2 }], expected: [{ hp: 2, count: 4 }, { hp: 9, count: 2 }] },
  { input: [{ hp: 9, count: 2 }, { hp: 2, count: 1 }, { hp: 9, count: 3 }], expected: [{ hp: 2, count: 1 }, { hp: 9, count: 5 }] },
  { input: [{ hp: 0, count: 3 }, { hp: 4, count: 2 }, { hp: 1, count: 0 }, { hp: 4, count: 1 }], expected: [{ hp: 4, count: 3 }] },
])('normalizes health groups without retaining mutable input references: $input', ({ input, expected }) => {
  const before = structuredClone(input), merged = mergeHealth(input);
  expect(merged).toEqual(expected);
  if (merged[0]) merged[0].count++;
  expect(input).toEqual(before);
});
