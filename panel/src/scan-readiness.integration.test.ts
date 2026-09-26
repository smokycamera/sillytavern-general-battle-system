// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('扫描按钮恢复失效会话，读取失败显示原因并可重试，全程保留原档', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const unit = generateUnit({ name: '原有友军', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [] }, { seed: 'existing-unit' }).unit;
  unit.id = 'existing';
  await f.service.transact(() => ({ schemaVersion: 2, storage: [unitRecordFromCombatant(unit)], rosterIds: ['existing'], field: 'forest' }));
  const before = f.service.snapshot(), envelope = f.store.envelope()!;
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 5000 });
  const click = async (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    expect(button, selector).not.toBeNull(); expect(button!.disabled).toBe(false);
    button!.click(); await idle();
  };
  await click('[data-action="workspace-tab"][data-tab="units"]');
  f.context.chatMetadata = { ...f.context.chatMetadata, variablePlugin: { count: 1 } };
  f.context.chat!.push({ mes: '<tb><spawn name="本轮新单位" side="enemy" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  await f.saveNormally();
  expect(f.service.canWrite()).toBe(false);
  await click('[data-action="narrative-scan"]');
  expect(f.service.canWrite()).toBe(true);
  expect(f.service.snapshot().proposals).toHaveLength(1);
  expect(document.querySelector('.narrative-sync')?.textContent).toContain('本轮新单位');
  expect(f.service.snapshot().storage).toEqual(before.storage); expect(f.service.snapshot().rosterIds).toEqual(before.rosterIds);
  expect(f.store.envelope()).toMatchObject({ documentId: envelope.documentId, generation: envelope.generation });
  expect(f.context.chatMetadata.variablePlugin).toEqual({ count: 1 });

  // A failed read must not leave the iframe saying "准备就绪" with no recovery button.
  const read = vi.spyOn(f.host, 'readPersisted').mockRejectedValueOnce(Error('读回暂时不可用'));
  await f.service.load(); await idle();
  expect(document.querySelector('[data-role="save-status"]')?.textContent).toContain('读回暂时不可用');
  await click('[data-action="archive-reload"]');
  expect(f.service.canWrite()).toBe(true); expect(f.service.snapshot().storage).toEqual(before.storage);
  expect(document.querySelector('[data-action="archive-reload"]')).toBeNull();
  read.mockRestore();

  // Recovery is read-only until the old pending save is explicitly verified.
  f.setSave(async () => {});
  await f.service.transact(save => ({ ...save, field: 'urban' })); await idle();
  const pending = f.store.pendingOperation();
  expect(pending).toBeDefined();
  await click('[data-action="narrative-scan"]');
  expect(document.querySelector('#toast')?.textContent).toContain('上一笔保存尚待核实');
  expect(f.store.pendingOperation()).toEqual(pending);
  expect(f.service.snapshot().field).toBe('forest');
  f.setSave(f.saveNormally);
  await click('[data-action="save-retry"]');
  expect(f.service.canWrite()).toBe(true); expect(f.service.snapshot().field).toBe('urban');
  expect(f.service.snapshot().proposals).toHaveLength(1); expect(f.service.snapshot().storage).toEqual(before.storage);
  f.service.dispose();
}, 15000);
