// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { embeddedWorldbookSettingsView, updateEmbeddedWorldbookSettings, type EmbeddedWorldbookSettings } from '../../extension/src/embedded-worldbook.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
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
  expect(f.service.snapshot()).not.toHaveProperty('worldbook');
  expect(saveArchive).not.toHaveBeenCalled();
  f.service.dispose();
});
