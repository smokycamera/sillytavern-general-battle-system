// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); });

it('显示多条剧情事件只读取一次存档，下一次更新仍显示新事实', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  try {
    await f.service.proposeAiScan('<tb>' + Array.from({ length: 30 }, (_, i) => `<add item="物品${i}" qty="1"/>`).join('') + '</tb>', 0, f.service.inventoryContext());
    Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, SillyTavern: { getContext: () => f.context } });
    document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
    await import('./main.js');
    const nav = (tab: string) => document.querySelector<HTMLButtonElement>(`[data-action="workspace-tab"][data-tab="${tab}"]`)!.click();
    nav('battle');
    const snapshot = vi.spyOn(f.service, 'snapshot');
    nav('units');
    expect(document.body.textContent).toContain('物品29');
    expect(snapshot.mock.calls.length).toBeLessThanOrEqual(1);
    await f.service.proposeAiScan('<tb><add item="新到物品"/></tb>', f.service.snapshot().factRevision ?? 0, f.service.inventoryContext());
    expect(document.body.textContent).toContain('新到物品');
  } finally { f.service.dispose(); }
});
