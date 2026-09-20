import { createNativeHost, type HostContext, type HostWindow } from '../host/src/sillytavern.js';
import { NativeMessages } from '../host/src/messages.js';
import { NativeStore } from '../runtime/src/native-store.js';
import { IndexedDbJournal } from '../runtime/src/recovery-journal.js';

// Isolated acceptance harness, never included in the production extension.
const ID = 'tavern-battle-native-probe';
const hostWindow = window as unknown as HostWindow & { TavernHelper?: unknown };
const button = document.createElement('button');
button.id = ID; button.textContent = '运行战阵原生接口验证';
button.style.cssText = 'position:fixed;right:12px;bottom:100px;z-index:100000;padding:10px;background:#25443b;color:white;border:1px solid #8dd8b8;border-radius:8px';
const output = document.createElement('pre');
output.id = ID + '-result';
output.style.cssText = 'position:fixed;right:12px;bottom:150px;z-index:100000;max-width:520px;max-height:65vh;overflow:auto;background:#151d1b;color:#dcf8e9;padding:12px;font-size:12px;white-space:pre-wrap;display:none';
document.getElementById(ID)?.remove(); document.getElementById(output.id)?.remove();
document.body.append(button, output);
button.addEventListener('click', () => { void run(); });
// The harness exists only in the separate portable profile. Enter the explicitly
// prepared fixture through the host API; no UI-coordinate automation is required.
void (async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    const context = hostWindow.SillyTavern?.getContext();
    const index = context?.characters?.findIndex(character => ['战阵测试', '战阵迁移测试'].includes(character.name ?? '')) ?? -1;
    if (index >= 0 && context?.selectCharacterById) {
      if (context.characterId !== index) await context.selectCharacterById(index);
      await run(); return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  output.style.display = 'block'; output.textContent = '测试角色未就绪；未执行任何数据写入。';
})().catch(error => { output.style.display = 'block'; output.textContent = String(error); });
async function run() {
  button.disabled = true;
  const report: Record<string, unknown> = { time: new Date().toISOString(), stage: 'starting', checks: {} };
  const checks = report.checks as Record<string, unknown>;
  const publish = () => {
    output.style.display = 'block'; output.textContent = JSON.stringify(report, null, 2);
    const ctx = hostWindow.SillyTavern?.getContext();
    if (ctx?.extensionSettings) { ctx.extensionSettings.tavernBattleNativeProbe = structuredClone(report); ctx.saveSettingsDebounced?.(); }
  };
  let host: Awaited<ReturnType<typeof createNativeHost>> | undefined;
  let stop = () => {};
  try {
    const ctx = hostWindow.SillyTavern?.getContext();
    const character = ctx?.characters?.[Number(ctx.characterId ?? -1)];
    if (character?.name !== '战阵测试' && character?.name !== '战阵迁移测试') throw Error('仅允许在明确命名的迁移测试角色中运行');
    if (hostWindow.TavernHelper) throw Error('此测试需要不加载酒馆助手');
    checks.helperAbsent = true;
    report.stage = 'account-and-context'; publish();
    host = await createNativeHost(hostWindow);
    const session = host.session();
    if (!session) {
      const actual = host.context();
      report.identityDiagnostics = { characterIdType: typeof actual.characterId, characterId: actual.characterId, groupId: actual.groupId, chatIdType: typeof actual.chatId, chatPresent: Array.isArray(actual.chat), metadataPresent: !!actual.chatMetadata, avatarPresent: !!actual.characters?.[Number(actual.characterId)]?.avatar };
      throw Error('测试聊天身份不完整');
    }
    checks.identity = true;
    checks.eventNames = !!(ctx?.eventTypes ?? ctx?.event_types);
    checks.generationEntry = typeof ctx?.generate === 'function';
    checks.tauri = !!hostWindow.__TAURITAVERN__;
    const store = new NativeStore(host, new IndexedDbJournal());
    await store.load();
    report.stage = 'save-round-trip'; publish();
    const version = store.envelope()?.revision ?? 0;
    const receipt = await store.commit(version, before => ({ ...before, nativeProbe: { count: version + 1, verified: true } }), { operationId: 'probe:' + crypto.randomUUID() });
    checks.saveReceipt = receipt.status;
    if (receipt.status !== 'confirmed') throw Error(receipt.error ?? '原生保存未确认');
    const disk = await host.readPersisted(session.scope);
    checks.savedEnvelope = (disk.tavernBattle as { lastOperationId?: string })?.lastOperationId === receipt.operationId;
    checks.storePublished = store.envelope()?.lastOperationId === receipt.operationId;
    report.stage = 'events-and-message'; publish();
    let received = 0;
    const subscription = host.subscribe('MESSAGE_SENT', () => { received++; }); stop = subscription.stop;
    checks.eventSubscription = subscription.available;
    const draft = document.querySelector<HTMLTextAreaElement>('#send_textarea');
    const draftBefore = draft?.value;
    const deliveryId = 'native-probe:' + crypto.randomUUID();
    const messages = new NativeMessages(host);
    const text = '【战阵原生接口测试】本地保存和消息接口验证；本条不请求模型生成。';
    const delivery = await messages.send(text, { deliveryId, generate: false });
    checks.delivery = delivery.status;
    checks.messageSaved = (await host.readChat(session.scope)).filter(message => message.extra?.tavernBattleDeliveryId === deliveryId).length === 1;
    checks.messageEventCount = received;
    checks.draftPreserved = draftBefore === draft?.value;
    const duplicate = await messages.send(text, { deliveryId, generate: false });
    checks.duplicateReceipt = duplicate.status;
    checks.singleMessageAfterRetry = host.context().chat?.filter(message => message.extra?.tavernBattleDeliveryId === deliveryId).length === 1;
    checks.singleEventAfterRetry = received === 1;
    stop();
    const promptId = 'tavern-battle-native:probe';
    checks.injectionAvailable = host.inject(promptId, '原生接口测试事实');
    const prompts = (host.context() as HostContext & { extensionPrompts?: Record<string, { value?: string }> }).extensionPrompts;
    checks.injectionValue = prompts?.[promptId]?.value === '原生接口测试事实';
    host.clearInjection(promptId);
    checks.injectionCleared = !prompts?.[promptId]?.value;
    const passed = checks.savedEnvelope && checks.storePublished && checks.messageSaved && checks.draftPreserved && checks.singleMessageAfterRetry && checks.singleEventAfterRetry && checks.injectionValue && checks.injectionCleared;
    report.stage = passed ? 'passed' : 'failed';
  } catch (error) { report.stage = 'failed'; report.error = String(error); }
  finally { stop(); host?.dispose(); publish(); button.disabled = false; }
}
