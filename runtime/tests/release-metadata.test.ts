import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('legacy packaging metadata is restored exactly from the frozen user release, without runtime or user data', () => {
  const original = JSON.parse(readFileSync(new URL('../../release/baselines/user-20260918/tavern-battle-script.json', import.meta.url), 'utf8'));
  const metadata = JSON.parse(readFileSync(new URL('../../release/script-metadata.json', import.meta.url), 'utf8'));
  const { content: _runtime, ...expected } = original;
  expect(metadata).toEqual(expected);
  expect(metadata.id).toBe('a4c1f7d2-9b3e-4f6a-8d15-2e7c9b40a613');
  expect(metadata.data).toEqual({});
  expect(metadata.export_with.data).toBe(false);
});
