import { expect, it } from 'vitest';
import original from '../../release/baselines/user-20260918/tavern-battle-script.json';
import metadata from '../../release/script-metadata.json';

it('legacy packaging metadata is restored exactly from the frozen user release, without runtime or user data', () => {
  const { content: _runtime, ...expected } = original;
  expect(metadata).toEqual(expected);
  expect(metadata.id).toBe('a4c1f7d2-9b3e-4f6a-8d15-2e7c9b40a613');
  expect(metadata.data).toEqual({});
  expect(metadata.export_with.data).toBe(false);
});
