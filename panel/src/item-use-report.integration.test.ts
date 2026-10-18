// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('收兵后的终章按钮带出道具事实，并在自定义结算提示后要求最后叙述使用及效果', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const epilogue = '【战阵·战斗终章】停战\n【道具使用和效果】\n前锋 使用【急救剂】：共1次，消耗1件。\n效果：治疗 1 → 前锋\n【叙述任务】\n默认提示';
  await f.service.transact(() => ({ schemaVersion: 2, storage: [], rosterIds: [], selectedReportId: 'small:items',
    reports: [{ id: 'small:items', card: '已归档', summary: '停战', digest: '', deliveries: {}, epilogue }],
    promptSettings: { sections: { settlement: { template: '按前锋视角叙述。' } } } }));
  const send = vi.fn(async (_text: string, _options?: unknown) => ({ status: 'inserted', deliveryId: 'fixture-items' }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: { send } }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  vi.stubGlobal('fetch', vi.fn());
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="reports"]')!.click();
  document.querySelector<HTMLButtonElement>('.report-send-actions [data-action="out-epilogue"]')!.click();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const text = send.mock.calls[0]![0];
  expect(text).toContain('【道具使用和效果】\n前锋 使用【急救剂】：共1次，消耗1件。\n效果：治疗 1 → 前锋');
  expect(text).toContain('按前锋视角叙述。');
  expect(text).toMatch(/终章最后补充本场道具使用及实际效果；只依据记录，未使用或效果缺失时如实说明，不补造道具、消耗或效果。$/);
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
  expect(f.service.snapshot().reports![0]!.epilogue).toBe(epilogue);
  f.service.dispose();
}, 30000);
