import { describe, expect, it } from 'vitest';
import { buildEmbeddedWorldbook } from '../../extension/src/embedded-worldbook.js';

describe('embedded worldbook', () => {
  it('keeps at-depth placement and original same-depth order while remaining always-on', () => {
    const prompts = buildEmbeddedWorldbook();
    expect(prompts).toHaveLength(2);
    expect(prompts.map(prompt => ({ position: prompt.position, depth: prompt.depth, role: prompt.role, scan: prompt.scan }))).toEqual([
      { position: 1, depth: 0, role: 0, scan: false },
      { position: 1, depth: 1, role: 0, scan: false },
    ]);

    const depth0 = prompts[0]!.content;
    const depth1 = prompts[1]!.content;
    expect(depth0).toContain('<battle_contract>');
    expect(depth1.indexOf('<power_reference>')).toBeLessThan(depth1.indexOf('<unit_equipment_specs>'));
    expect(depth1.indexOf('<unit_equipment_specs>')).toBeLessThan(depth1.indexOf('<ability_effect_specs>'));
  });
});
