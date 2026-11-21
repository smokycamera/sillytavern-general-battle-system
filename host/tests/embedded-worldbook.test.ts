import { describe, expect, it, vi } from 'vitest';
import { buildEmbeddedWorldbook, CUSTOM_WORLD_NAME, embeddedWorldbookEntries, embeddedWorldbookSettingsView, installEmbeddedWorldbook, normalizeEmbeddedWorldbookSettings, updateEmbeddedWorldbookSettings } from '../../extension/src/embedded-worldbook.js';
import { preferences } from '../../extension/src/preferences.js';
import worldbook from '../../assets/worldbook/!通用战斗系统约束.json';
import englishWorldbook from '../../assets/worldbook/tavern-battle.en.json';
import { parseProtocol } from '../../panel/src/protocol.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';

describe('embedded worldbook', () => {
  it('localizes all built-in entries on both host paths and preserves overrides when switching languages', async () => {
    const source = embeddedWorldbookEntries();
    const english = embeddedWorldbookSettingsView(undefined, 'en').items;
    expect(english.map(item => item.id).sort()).toEqual(Object.keys(englishWorldbook).sort());
    const installed = source.map((entry, index) => {
      const rule = english[index]!;
      expect(rule).toMatchObject(englishWorldbook[rule.id as keyof typeof englishWorldbook]);
      expect(rule.defaultContent).toBe(rule.content);
      return { ...entry, comment: rule.title, content: rule.content };
    });
    const f = nativeFixture(); f.context.eventTypes!.WORLDINFO_ENTRIES_LOADED = 'worldinfo';
    const stop = installEmbeddedWorldbook(f.host, undefined, () => true, 'en');
    const payload = { globalLore: [] };
    await f.emit('worldinfo', payload);
    expect(payload.globalLore).toEqual(installed);
    stop();
    const fallback = buildEmbeddedWorldbook(undefined, 'en').map(prompt => prompt.content).join('\n');
    for (const entry of english) expect(fallback).toContain(entry.content);
    expect(fallback).toContain('Use the space-adapted trait for vacuum-capable units, from spacecraft to spacewalkers.');
    expect(embeddedWorldbookSettingsView().items.find(item => item.id === '5')?.content).toBe(worldbook.entries['5'].content);
    let edited = updateEmbeddedWorldbookSettings(undefined, { entry: { id: '5', content: 'My own rules' }, create: true });
    edited = updateEmbeddedWorldbookSettings(edited, { custom: { id: 'custom-1', patch: { title: '自定义', content: '原文' } } });
    expect(buildEmbeddedWorldbook(edited, 'en').some(prompt => prompt.content.includes('My own rules'))).toBe(true);
    expect(embeddedWorldbookSettingsView(edited, 'en').items.at(-1)).toMatchObject({ title: '自定义', content: '原文' });
    expect(embeddedWorldbookSettingsView(edited).items.find(item => item.id === '5')?.content).toBe('My own rules');
  });

  it('accepts all event examples shown in the English worldbook', () => {
    const content = Object.values(englishWorldbook).map(entry => entry.content).join('\n');
    const examples = [...content.matchAll(/^<tb>\n[\s\S]*?^<\/tb>$/gm)].map(match => match[0]);
    const effects = /## Applying and clearing effects\n([\s\S]*?)\n## Traits/.exec(englishWorldbook['5'].content)![1]!;
    examples.push('<tb>\n' + effects.split('\n').filter(line => /^<(?:spawn|effect) /.test(line)).join('\n') + '\n</tb>');
    expect(examples).toHaveLength(12);
    for (const example of examples) {
      const result = parseProtocol(example);
      expect(result.errors, example).toEqual([]);
      expect(result.events, example).toHaveLength([...example.matchAll(/^<\w+ .+\/>$/gm)].length);
      expect(result.warnings.join('\n'), example).not.toMatch(/未采用|未支持|未使用|保留原|忽略/);
    }
  });

  it('inherits the host locale until the player saves a plugin language', () => {
    const context = { extensionSettings: {} as Record<string, unknown>, saveSettingsDebounced: vi.fn() };
    const document = { documentElement: { lang: 'en-US' } };
    const prefs = preferences({ document, SillyTavern: { getContext: () => context } } as never);
    expect(prefs.read().language).toBe('en');
    expect(context.saveSettingsDebounced).not.toHaveBeenCalled();
    document.documentElement.lang = 'zh-TW';
    expect(prefs.read().language).toBe('zh-CN');
    prefs.write({ language: 'en' });
    expect(prefs.read().language).toBe('en');
    prefs.write({ language: 'zh-CN' });
    document.documentElement.lang = 'en-GB';
    expect(prefs.read().language).toBe('zh-CN');
  });
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
    let enabled = true;
    const stop = installEmbeddedWorldbook(f.host, undefined, () => enabled);
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
    enabled = false; await f.emit('worldinfo', payload);
    expect(payload.globalLore).toEqual(original);
    stop(); expect(f.handlers.get('worldinfo')?.size).toBe(0);
  });

  it('replaces native subscriptions on edits/toggles and does not inject while disabled', async () => {
    const f = nativeFixture(); f.context.eventTypes!.WORLDINFO_ENTRIES_LOADED = 'worldinfo';
    let stop = installEmbeddedWorldbook(f.host);
    stop();
    stop = installEmbeddedWorldbook(f.host, updateEmbeddedWorldbookSettings(undefined, { entry: { id: '0', content: 'edited rule' } }));
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

  it.each([undefined, 'old-version:old-defaults'])('updates all four built-ins from revision %s once while retaining custom entries and global settings', (oldRevision) => {
    let settings = updateEmbeddedWorldbookSettings(undefined, { create: true });
    settings = updateEmbeddedWorldbookSettings(settings, { custom: { id: 'custom-1', patch: {
      title: '自定义规则', content: 'CUSTOM', enabled: false, constant: false, keys: ['城堡'], depth: 7, role: 2, order: 23,
    } } });
    const old = { ...settings, enabled: false, builtinRevision: oldRevision,
      entries: Object.fromEntries(Object.keys(worldbook.entries).map(id => [id, `OLD ${id}`])), nextCustomId: 9 };
    const otherPreferences = { theme: 'light', geometry: { left: 12, top: 34, width: 600, height: 500 }, extra: 'KEEP' };
    const context = { extensionSettings: { tavernBattle: { ...otherPreferences, worldbook: old }, unrelated: { keep: true } }, saveSettingsDebounced: vi.fn() };
    const prefs = preferences({ SillyTavern: { getContext: () => context } } as never);
    const upgraded = prefs.read().worldbook!;
    expect(upgraded).toMatchObject({ enabled: false, entries: {}, customEntries: settings.customEntries, nextCustomId: 9 });
    expect(context.extensionSettings.tavernBattle).toEqual({ ...otherPreferences, worldbook: upgraded });
    expect(context.extensionSettings.unrelated).toEqual({ keep: true });
    expect(embeddedWorldbookSettingsView(upgraded).items.filter(item => !item.custom).map(item => [item.id, item.content]))
      .toEqual(Object.entries(worldbook.entries).sort(([, a], [, b]) => a.order - b.order).map(([id, entry]) => [id, entry.content]));
    expect(buildEmbeddedWorldbook(upgraded)).toEqual([]);
    prefs.read();
    expect(context.saveSettingsDebounced).toHaveBeenCalledOnce();
    const edited = updateEmbeddedWorldbookSettings(upgraded, { entry: { id: '0', content: 'CURRENT EDIT' } });
    prefs.write({ worldbook: edited });
    expect(JSON.parse(JSON.stringify(prefs.read().worldbook)).entries).toEqual({ '0': 'CURRENT EDIT' });
    expect(prefs.read().worldbook?.customEntries).toEqual(settings.customEntries);
    expect(context.saveSettingsDebounced).toHaveBeenCalledTimes(2);
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
