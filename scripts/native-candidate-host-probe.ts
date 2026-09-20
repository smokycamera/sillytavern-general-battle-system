import { generateUnit } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import type { NativeRuntime } from '../extension/src/panel-runtime.js';
import type { HostWindow } from '../host/src/sillytavern.js';
const host = window as unknown as HostWindow & { __tavernBattleNative?: NativeRuntime; TavernHelper?: unknown };
const report: Record<string, unknown> = { time: new Date().toISOString(), stage: 'starting', checks: {} };
const checks = report.checks as Record<string, unknown>;
const publish = () => { const context = host.SillyTavern?.getContext(); if (context?.extensionSettings) { context.extensionSettings.tavernBattleNativeCandidateProbe = structuredClone(report); context.saveSettingsDebounced?.(); } };
const waitFor = async (check: () => boolean) => { for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error('等待隔离测试环境超时'); };
void (async () => {
  await waitFor(() => !!host.__tavernBattleNative);
  const runtime = host.__tavernBattleNative!;
  let context = host.SillyTavern!.getContext();
  const fixtureName = '战阵原生RC验收';
  if (!context.characters?.some(character => character.name === fixtureName)) {
    const response = await fetch('/api/characters/create', { method: 'POST', headers: context.getRequestHeaders?.(), body: JSON.stringify({ ch_name: fixtureName, description: '仅用于原生扩展 RC 隔离验收。', first_mes: '本地验收开始。' }) });
    if (!response.ok) throw Error('创建隔离验收角色失败：' + response.status);
    await context.getCharacters?.(); context = host.SillyTavern!.getContext();
  }
  const index = context.characters?.findIndex(character => character.name === fixtureName) ?? -1;
  if (index < 0 || !context.selectCharacterById) throw Error('隔离测试角色未准备好');
  if (String(context.characterId) !== String(index)) await context.selectCharacterById(index);
  await waitFor(() => runtime.service.status().phase === 'ready');
  if (host.TavernHelper || context.characters?.[Number(runtime.service.host.context().characterId)]?.name !== fixtureName) throw Error('仅限无助手的隔离战阵测试聊天');
  checks.helperAbsent = true; checks.initialized = true;
  if (!runtime.service.snapshot().storage?.length) {
    const units = (['ally', 'enemy'] as const).map((side, index) => {
      const unit = generateUnit({ name: side === 'ally' ? '迁移测试卫兵' : '迁移测试敌军', side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'sword', weaponLevel: 3 }, { seed: 'native-host-' + side }).unit;
      unit.id = 'native-host-unit-' + index; return unit;
    });
    const receipt = await runtime.service.transact(before => ({ ...before, schemaVersion: 2, factRevision: (before.factRevision ?? 0) + 1, storage: units.map(unit => unitRecordFromCombatant(unit)), rosterIds: units.map(unit => unit.id), nativeCandidateProbe: true }));
    checks.seedReceipt = receipt.status;
  }
  runtime.open();
  await waitFor(() => !!document.querySelector<HTMLIFrameElement>('#tavern-battle-native-panel iframe')?.contentDocument?.querySelector('#app h1'));
  checks.panelLoaded = true;
  const frame = document.querySelector<HTMLIFrameElement>('#tavern-battle-native-panel iframe')!;
  checks.nativeLabel = !!frame.contentDocument?.body.textContent?.includes('战阵');
  const before = runtime.service.store.envelope()!;
  const receipt = await runtime.service.transact(save => ({ ...save, nativeCandidateProbe: { verifiedAt: report.time } }));
  const disk = await runtime.service.host.readPersisted(receipt.session.scope);
  checks.serviceConfirmed = receipt.status === 'confirmed';
  checks.persistedVersion = (disk.tavernBattle as { lastOperationId?: string })?.lastOperationId === receipt.operationId;
  checks.revisionAdvanced = runtime.service.store.envelope()!.revision === before.revision + 1;
  for (let n = 0; n < 10; n++) { runtime.close(); runtime.open(); }
  checks.singleFrame = document.querySelectorAll('#tavern-battle-native-panel iframe').length === 1;
  checks.sameFrame = document.querySelector('#tavern-battle-native-panel iframe') === frame;
  const config = await fetch(new URL('fixture-config.json', import.meta.url));
  if (config.ok) {
    const { modelUrl } = await config.json();
    if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(modelUrl)) throw Error('只允许本地验收模型');
    const ctx = host.SillyTavern!.getContext() as typeof context & { chatCompletionSettings: Record<string, unknown>; onlineStatus: string };
    const keys = ['chat_completion_source', 'custom_url', 'custom_model', 'stream_openai', 'custom_include_body', 'custom_exclude_body', 'custom_include_headers'];
    const old = Object.fromEntries(keys.map(key => [key, ctx.chatCompletionSettings[key]]));
    const draft = document.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const attachment = document.querySelector<HTMLInputElement>('#file_form_input')!;
    const oldDraft = draft.value; const oldFiles = attachment.files;
    runtime.close();
    try {
      Object.assign(ctx.chatCompletionSettings, { chat_completion_source: 'custom', custom_url: modelUrl, custom_model: 'native-fixture', stream_openai: false, custom_include_body: '', custom_exclude_body: '', custom_include_headers: '' });
      const select = document.querySelector<HTMLSelectElement>('#chat_completion_source')!; select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector<HTMLButtonElement>('#api_button_openai')!.click();
      await waitFor(() => (host.SillyTavern!.getContext() as typeof ctx).onlineStatus !== 'no_connection');
      draft.value = '/echo pending-draft {{user}} | 原生验收草稿';
      const transfer = new DataTransfer(); transfer.items.add(new File(['pending synthetic attachment'], 'native-fixture.txt', { type: 'text/plain' })); attachment.files = transfer.files;
      const deliveryId = 'tauri-native-fixture:' + crypto.randomUUID();
      const delivery = await runtime.messages.send('原生验收战报：请根据本条生成一次完整叙述。', { deliveryId });
      checks.generationCompleted = delivery.status === 'sent';
      report.delivery = { status: delivery.status, generation: delivery.generation, detail: delivery.detail };
      checks.draftPreserved = draft.value === '/echo pending-draft {{user}} | 原生验收草稿';
      checks.attachmentPreserved = attachment.files?.[0]?.name === 'native-fixture.txt';
      const chat = runtime.service.host.context().chat!;
      checks.singleDelivery = chat.filter(message => message.extra?.tavernBattleDeliveryId === deliveryId).length === 1;
      const persisted = await runtime.service.host.readChat(runtime.service.host.session()!.scope);
      checks.generatedReplySaved = persisted.at(-1)?.mes === chat.at(-1)?.mes && !!chat.at(-1)?.mes?.includes('本地验收模型');
    } finally {
      Object.assign(ctx.chatCompletionSettings, old); draft.value = oldDraft; attachment.files = oldFiles;
      const select = document.querySelector<HTMLSelectElement>('#chat_completion_source')!; select.value = String(old.chat_completion_source); select.dispatchEvent(new Event('change', { bubbles: true }));
      runtime.open();
    }
  }
  report.stage = Object.entries(checks).every(([key, value]) => key === 'seedReceipt' ? value === 'confirmed' : value === true) ? 'passed' : 'failed';
})().catch(error => { report.stage = 'failed'; report.error = String(error); report.nativePhase = host.__tavernBattleNative?.service.status().phase; report.nativeError = host.__tavernBattleNative?.service.status().error; report.statusText = document.querySelector('.tb-status')?.textContent; }).finally(publish);
