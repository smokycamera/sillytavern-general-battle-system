import { describe, expect, it, vi } from 'vitest';
import { buildEmbeddedWorldbook, embeddedWorldbookEntries, embeddedWorldbookSettingsView, installEmbeddedWorldbook, updateEmbeddedWorldbookSettings } from '../../extension/src/embedded-worldbook.js';
import worldbook from '../../assets/worldbook/!通用战斗系统约束.json';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';

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

  it('uses the native global pipeline, preserving all source metadata and leaving external books untouched', async () => {
    const f = nativeFixture();
    f.context.eventTypes!.WORLDINFO_ENTRIES_LOADED = 'worldinfo';
    const stop = installEmbeddedWorldbook(f.host);
    expect(stop.mode).toBe('native');
    expect(f.context.setExtensionPrompt).not.toHaveBeenCalled();
    const external = structuredClone(Object.values(worldbook.entries));
    const original = structuredClone(external);
    const payload = { globalLore: external, characterLore: [{ content: 'unrelated character book' }] };
    await f.emit('worldinfo', payload);
    expect(payload.globalLore.slice(0, 4)).toEqual(original);
    expect(payload.characterLore).toEqual([{ content: 'unrelated character book' }]);
    const additions = payload.globalLore.slice(4);
    expect(additions).toHaveLength(4);
    for (const entry of additions) {
      const source = original.find(source => source.uid === entry.uid)!;
      expect(entry).toEqual({ ...source, world: 'tavern-battle-native:worldbook', constant: true, key: [], keysecondary: [], selective: false });
    }
    // Downstream regex/scanning must not mutate future generations or defaults.
    additions[0]!.content = 'host transformed';
    expect(embeddedWorldbookEntries()[0]!.content).toBe(worldbook.entries['0'].content);
    stop(); expect(f.handlers.get('worldinfo')?.size).toBe(0);
  });

  it('replaces native subscriptions on edits/toggles and does not inject while disabled', async () => {
    const f = nativeFixture(); f.context.eventTypes!.WORLDINFO_ENTRIES_LOADED = 'worldinfo';
    let stop = installEmbeddedWorldbook(f.host);
    stop();
    stop = installEmbeddedWorldbook(f.host, { entries: { '0': 'edited rule' } });
    expect(f.handlers.get('worldinfo')?.size).toBe(1);
    const payload = { globalLore: [] as { content: string }[] };
    await f.emit('worldinfo', payload);
    expect(payload.globalLore.filter(entry => entry.content === 'edited rule')).toHaveLength(1);
    stop(); stop = installEmbeddedWorldbook(f.host, { enabled: false });
    const disabled = { globalLore: [{ content: 'external book' }] };
    await f.emit('worldinfo', disabled);
    expect(disabled.globalLore).toEqual([{ content: 'external book' }]);
    stop();
  });

  it('cleans up depth fallback prompts on old hosts', () => {
    const host = { inject: vi.fn((_id: string, _content: string) => true), clearInjection: vi.fn((_id: string) => {}) };
    const stop = installEmbeddedWorldbook(host);
    expect(stop.mode).toBe('depth'); expect(host.inject).toHaveBeenCalledTimes(2);
    stop(); expect(host.clearInjection.mock.calls.map(([id]) => id)).toEqual(host.inject.mock.calls.map(([id]) => id));
  });
});
