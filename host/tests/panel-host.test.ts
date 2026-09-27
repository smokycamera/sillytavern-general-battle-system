// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelHost } from '../../extension/src/panel-host.js';
import type { DisplayPreferences } from '../../extension/src/preferences.js';

const panels: PanelHost[] = [];
const size = (width: number, height: number) => { vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height); };
function mount(saved: DisplayPreferences = {}) {
  const display = { read: () => saved, write: vi.fn((value: DisplayPreferences) => Object.assign(saved, value)) };
  const panel = new PanelHost('about:blank', display); panels.push(panel);
  const entry = document.getElementById('tavern-battle-native-entry') as HTMLButtonElement;
  const root = document.getElementById('tavern-battle-native-panel')!;
  return { panel, entry, root, display, saved };
}
beforeEach(() => { size(390, 844); vi.stubGlobal('visualViewport', null); });
afterEach(() => { panels.splice(0).forEach(panel => panel.dispose()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('places a first-run entry using explicit screen coordinates without saving a default preference', () => {
  const { entry, display } = mount();
  expect(entry.style.left).toBe('328px'); expect(entry.style.top).toBe('712px');
  expect(entry.style.bottom).toBe('auto'); expect(entry.hidden).toBe(false);
  size(844, 390); window.dispatchEvent(new Event('resize'));
  expect(entry.style.left).toBe('774px'); expect(entry.style.top).toBe('263px');
  expect(display.write).not.toHaveBeenCalled();
});

it('keeps an off-screen saved position reachable after rotation, then restores it on a larger screen', () => {
  const { entry, display } = mount({ entryPosition: { left: 900, top: 800 } });
  expect(entry.style.left).toBe('330px'); expect(entry.style.top).toBe('784px');
  size(844, 390); window.dispatchEvent(new Event('resize'));
  expect(entry.style.left).toBe('784px'); expect(entry.style.top).toBe('330px');
  size(1440, 1000); window.dispatchEvent(new Event('resize'));
  expect(entry.style.left).toBe('900px'); expect(entry.style.top).toBe('800px');
  expect(display.write).not.toHaveBeenCalled();
});

it('follows the visible viewport when the keyboard opens or the viewport pans, and removes its listeners', () => {
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const remove = vi.spyOn(viewport, 'removeEventListener');
  const { entry, panel, display } = mount({ entryPosition: { left: 300, top: 700 } });
  viewport.height = 400; viewport.dispatchEvent(new Event('resize'));
  expect(entry.style.top).toBe('340px');
  viewport.offsetTop = 100; viewport.offsetLeft = 320; viewport.dispatchEvent(new Event('scroll'));
  expect(entry.style.top).toBe('440px'); expect(entry.style.left).toBe('328px');
  viewport.height = 844; viewport.offsetTop = 0; viewport.offsetLeft = 0; viewport.dispatchEvent(new Event('resize'));
  expect(entry.style.top).toBe('700px'); expect(entry.style.left).toBe('300px');
  expect(display.write).not.toHaveBeenCalled();
  panel.dispose();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
});

it('saves a clamped drag without opening the panel and restores it after remounting', () => {
  const { entry, panel, root, saved } = mount();
  entry.setPointerCapture = vi.fn(); entry.hasPointerCapture = () => false;
  vi.spyOn(entry, 'getBoundingClientRect').mockReturnValue(new DOMRect(328, 712, 52, 52));
  entry.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 350, clientY: 735 }));
  entry.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: -50, clientY: -50 }));
  entry.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  entry.dispatchEvent(new MouseEvent('click', { detail: 1 }));
  expect(root.hidden).toBe(true); expect(saved.entryPosition).toEqual({ left: 8, top: 8 });
  entry.click(); expect(root.hidden).toBe(false); expect(entry.hidden).toBe(true);
  panel.close(); expect(root.hidden).toBe(true); expect(entry.hidden).toBe(false);
  panel.dispose();
  const restored = mount(saved);
  expect(restored.entry.style.left).toBe('8px'); expect(restored.entry.style.top).toBe('8px');
});
