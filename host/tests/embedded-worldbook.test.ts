import { describe, expect, it, vi } from 'vitest';
import { buildEmbeddedWorldbook, CUSTOM_WORLD_NAME, embeddedWorldbookEntries, embeddedWorldbookSettingsView, installEmbeddedWorldbook, normalizeEmbeddedWorldbookSettings, updateEmbeddedWorldbookSettings } from '../../extension/src/embedded-worldbook.js';
import { preferences } from '../../extension/src/preferences.js';
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

  it('persists custom entries separately through preferences, reset and JSON reload without reusing deleted IDs', () => {
    let settings = updateEmbeddedWorldbookSettings(undefined, { create: true });
    settings = updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { title: '补充规则', content: 'CUSTOM', depth: 3, role: 2, order: 7 } } });
    settings = updateEmbeddedWorldbookSettings(settings, { entry: { id: '0', content: 'OVERRIDE' } });
    const context = { extensionSettings: {}, saveSettingsDebounced: vi.fn() };
    const prefs = preferences({ SillyTavern: { getContext: () => context } } as never);
    prefs.write({ worldbook: settings });
    prefs.write({ theme: 'light' });
    const restored = JSON.parse(JSON.stringify(prefs.read().worldbook));
    const reset = updateEmbeddedWorldbookSettings(restored, { entry: { id: '0' } });
    expect(reset.customEntries).toEqual(settings.customEntries);
    expect(embeddedWorldbookEntries(reset).find(entry => entry.world === CUSTOM_WORLD_NAME)).toMatchObject({ uid: 1, content: 'CUSTOM', position: 4, depth: 3, role: 2, order: 7, ignoreBudget: false });
    const deleted = updateEmbeddedWorldbookSettings(reset, { custom: { id: 'custom-1', delete: true } });
    expect(embeddedWorldbookEntries(deleted)).toHaveLength(4);
    expect(updateEmbeddedWorldbookSettings(deleted, { create: true }).customEntries[0]!.id).toBe('custom-2');
  });

  it('keeps green metadata for native activation, supports disable, and never sends green entries through unconditional fallback', () => {
    let settings = updateEmbeddedWorldbookSettings(undefined, { create: true });
    settings = updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { content: 'GREEN', constant: false, keys: ['城堡', ' Castle ', '城堡'], depth: 5, role: 1 } } });
    const green = embeddedWorldbookEntries(settings).find(entry => entry.world === CUSTOM_WORLD_NAME)!;
    expect(green).toMatchObject({ constant: false, key: ['城堡', 'Castle'], scanDepth: null, depth: 5, role: 1 });
    expect(buildEmbeddedWorldbook(settings).some(prompt => prompt.content.includes('GREEN'))).toBe(false);
    const disabled = updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { enabled: false } } });
    expect(embeddedWorldbookEntries(disabled)).toHaveLength(4);
    expect(() => updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { keys: [] } } })).toThrow('关键词');
    expect(() => updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { depth: -1 } } })).toThrow('深度');
    expect(() => updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { role: 3 } } })).toThrow('提示词类型');
    expect(() => updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { order: NaN } } })).toThrow('顺序');
    expect(normalizeEmbeddedWorldbookSettings({ ...settings, customEntries: [null, ...settings.customEntries, ...settings.customEntries, { id: '0' }] } as never).customEntries).toHaveLength(1);
  });

  it('replaces custom content, depth and role cleanly on both host paths', async () => {
    let settings = updateEmbeddedWorldbookSettings(undefined, { create: true });
    settings = updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { content: 'OLD_CUSTOM', depth: 6 } } });
    const f = nativeFixture(); f.context.eventTypes!.WORLDINFO_ENTRIES_LOADED = 'worldinfo';
    let stop = installEmbeddedWorldbook(f.host, settings);
    const payload = { globalLore: [{ world: 'external', content: 'KEEP' }] };
    await f.emit('worldinfo', payload); await f.emit('worldinfo', payload);
    expect(payload.globalLore.filter(entry => entry.content === 'OLD_CUSTOM')).toHaveLength(1);
    const prompts = new Map<string, string>();
    const fallback = { inject: (id: string, content: string) => { prompts.set(id, content); return true; }, clearInjection: (id: string) => { prompts.delete(id); } };
    let cleanup = installEmbeddedWorldbook(fallback, settings);
    stop(); cleanup();
    settings = updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: { content: 'NEW_CUSTOM', depth: 7, role: 2 } } });
    stop = installEmbeddedWorldbook(f.host, settings); cleanup = installEmbeddedWorldbook(fallback, settings);
    await f.emit('worldinfo', payload);
    expect(payload.globalLore.filter(entry => entry.world === CUSTOM_WORLD_NAME)).toEqual([expect.objectContaining({ content: 'NEW_CUSTOM', depth: 7, role: 2 })]);
    expect([...prompts.values()].join('')).not.toContain('OLD_CUSTOM');
    expect(prompts.get('tavern-battle-native:worldbook:depth-7:role-2')).toBe('NEW_CUSTOM');
    stop(); cleanup(); expect(prompts.size).toBe(0);
  });
});
