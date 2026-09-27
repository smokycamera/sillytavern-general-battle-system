// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { embeddedWorldbookSettingsView, updateEmbeddedWorldbookSettings, type EmbeddedWorldbookSettings } from '../../extension/src/embedded-worldbook.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
vi.mock('./view-dom.js', async importOriginal => {
  const original = await importOriginal<typeof import('./view-dom.js')>();
  return { ...original, updateRegion(root: HTMLElement, html: string) {
    original.updateRegion(root, html);
    // happy-dom 20.8.8 parses a selected last option as the preceding option.
    // Restore the explicit HTML selection to match browser parsing in this fixture.
    for (const select of root.querySelectorAll<HTMLSelectElement>('.worldbook-settings select')) {
      const selected = select.querySelector<HTMLOptionElement>('option[selected]');
      if (selected) select.value = selected.value;
    }
  } };
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('edits and resets rules through the settings UI and retains global choices across chats', async () => {
  const f = nativeFixture(); await f.service.start();
  const saveArchive = vi.spyOn(f.context, 'saveMetadata');
  let saved: EmbeddedWorldbookSettings | undefined;
  const view = () => ({ ...embeddedWorldbookSettingsView(saved), injectionMode: 'native' as const });
  const update = vi.fn((change) => { saved = updateEmbeddedWorldbookSettings(saved, change); return view(); });
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {}, worldbook: { view, update } }, SillyTavern: { getContext: () => f.context } });
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const nav = () => document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="settings"]')!.click();
  const editor = () => document.querySelector<HTMLTextAreaElement>('[data-role="worldbook-template"][data-entry="0"]')!;
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"][data-entry="0"]`)!;
  const toggle = () => document.querySelector<HTMLInputElement>('[data-role="worldbook-enabled"]')!;
  nav(); expect(document.querySelectorAll('[data-role="worldbook-template"]')).toHaveLength(4);
  const original = editor().value;
  editor().value = '<battle_contract>edited & <literal></battle_contract>';
  editor().dispatchEvent(new Event('input', { bubbles: true }));
  button('worldbook-save').click();
  await vi.waitFor(() => expect(saved?.entries?.['0']).toBe('<battle_contract>edited & <literal></battle_contract>'));
  expect(editor().value).toBe(saved!.entries!['0']);
  toggle().click(); expect(saved?.enabled).toBe(false);
  f.switchTo('another-chat'); await f.service.load(); nav();
  expect(toggle().checked).toBe(false); expect(editor().value).toBe(saved!.entries!['0']);
  button('worldbook-reset').click(); await vi.waitFor(() => expect(editor().value).toBe(original));
  expect(saved?.enabled).toBe(false);
  toggle().click(); expect(saved?.enabled).toBe(true);
  const click = (action: string, id?: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]${id ? `[data-entry="${id}"]` : ''}`)!.click();
  const field = (name: string, id = 'custom-1') => document.getElementById(`wb-${id}-${name}`) as HTMLInputElement;
  const change = (name: string, value: string) => { field(name).value = value; field(name).dispatchEvent(new Event('input', { bubbles: true })); field(name).dispatchEvent(new Event('change', { bubbles: true })); };
  click('worldbook-create');
  await vi.waitFor(() => expect(field('title')).toBeTruthy());
  expect(document.querySelector<HTMLDetailsElement>('[data-detail-id="worldbook-editor-custom-1"]')!.open).toBe(true);
  change('title', '城堡 & <规则>'); change('content', '守城补充规则');
  change('depth', '3'); change('role', '2'); change('order', '25');
  expect(field('role').value).toBe('2');
  change('constant', 'false');
  expect(field('keys').closest('label')!.hidden).toBe(false);
  expect(field('role').value).toBe('2');
  // Changing strategy and toggling the entire book must retain all unsaved fields.
  toggle().click(); expect(field('role').value).toBe('2'); toggle().click(); expect(field('role').value).toBe('2');
  expect(field('title').value).toBe('城堡 & <规则>'); expect(field('content').value).toBe('守城补充规则');
  click('worldbook-save', 'custom-1');
  await vi.waitFor(() => expect(document.getElementById('toast')!.textContent).toContain('关键词'));
  expect(saved?.customEntries?.[0]?.constant).toBe(true);
  change('keys', '城堡\n攻城'); click('worldbook-save', 'custom-1');
  await vi.waitFor(() => expect(saved?.customEntries?.[0]).toMatchObject({ title: '城堡 & <规则>', content: '守城补充规则', constant: false, keys: ['城堡', '攻城'], depth: 3, role: 2, order: 25 }));
  field('enabled').click(); expect(saved!.customEntries![0]!.enabled).toBe(false);
  f.switchTo('third-chat'); await f.service.load(); nav();
  expect(field('enabled').checked).toBe(false); expect(field('content').value).toBe('守城补充规则');
  click('worldbook-create'); await vi.waitFor(() => expect(saved!.customEntries).toHaveLength(2));
  click('worldbook-delete', 'custom-1'); click('worldbook-delete-cancel');
  expect(saved!.customEntries).toHaveLength(2);
  click('worldbook-delete', 'custom-1'); click('worldbook-delete-confirm', 'custom-1');
  await vi.waitFor(() => expect(saved!.customEntries).toHaveLength(1));
  expect(saved!.customEntries![0]!.id).toBe('custom-2');
  expect(document.querySelectorAll('[data-role="worldbook-template"]')).toHaveLength(5);
  expect(f.service.snapshot()).not.toHaveProperty('worldbook');
  expect(saveArchive).not.toHaveBeenCalled();
  f.service.dispose();
});
