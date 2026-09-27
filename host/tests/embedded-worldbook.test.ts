import { describe, expect, it } from 'vitest';
import { buildEmbeddedWorldbook, embeddedWorldbookSettingsView, updateEmbeddedWorldbookSettings } from '../../extension/src/embedded-worldbook.js';

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

  it('supports a global switch and content edits without changing placement metadata', () => {
    expect(buildEmbeddedWorldbook({ enabled: false })).toEqual([]);
    const view = embeddedWorldbookSettingsView();
    const target = view.items.find(item => item.id === '8')!;
    const edited = updateEmbeddedWorldbookSettings(undefined, { entry: { id: target.id, content: '<power_reference>edited</power_reference>' } });
    const prompts = buildEmbeddedWorldbook(edited);
    expect(prompts.find(prompt => prompt.depth === 1)?.content).toContain('<power_reference>edited</power_reference>');
    expect(prompts.find(prompt => prompt.depth === 1)).toMatchObject({ position: 1, depth: 1, role: 0, scan: false });

    const reset = updateEmbeddedWorldbookSettings(edited, { entry: { id: target.id } });
    expect(embeddedWorldbookSettingsView(reset).items.find(item => item.id === target.id)?.content).toBe(target.defaultContent);
  });
});
