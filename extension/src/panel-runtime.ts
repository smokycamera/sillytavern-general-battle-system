import type { PanelController } from '../../panel/src/controller-port.js';
import type { PanelRuntime } from '../../panel/src/panel-runtime.js';
import type { SaveReceipt, TavernAdapter } from '../../panel/src/tavern.js';
import type { PersistReceipt } from '../../host/src/contracts.js';
import { sameSession } from '../../host/src/contracts.js';
import { NativeMessages } from '../../host/src/messages.js';
import type { BattleService } from '../../runtime/src/battle-service.js';
import { preferences } from './preferences.js';

export interface NativeRuntime { service: BattleService; messages: NativeMessages; open(): void; close(): void; dispose(): void }
export function legacyReceipt(receipt: PersistReceipt): SaveReceipt {
  const confirmed = receipt.status === 'confirmed';
  return { status: confirmed ? 'saved' : 'failed', host: confirmed, local: confirmed || receipt.status === 'pending', nativeStatus: receipt.status,
    ...(confirmed ? {} : { error: receipt.status === 'pending' ? '保存结果待核实，已保留本次待确认内容；请使用“核实并重试保存”。' + (receipt.error ? ' 原因：' + receipt.error : '') : receipt.error ?? '当前操作未保存' }) };
}
export function createPanelRuntime(): PanelRuntime {
  const runtime = (window.parent as unknown as { __tavernBattleNative?: NativeRuntime }).__tavernBattleNative;
  if (!runtime) throw Error('原生战阵服务未启动，请从扩展入口打开面板');
  const { service, messages } = runtime; const host = service.host;
  const display = preferences(window.parent as unknown as import('../../host/src/sillytavern.js').HostWindow);
  let panelCommit = 0;
  const convert = async (action: Promise<PersistReceipt>) => {
    const receipt = await action;
    if (!sameSession(receipt.session, host.session())) throw Error('聊天已切换，旧面板操作已停止');
    return legacyReceipt(receipt);
  };
  const controller: PanelController = {
    capabilities: service.capabilities,
    snapshot: () => service.snapshot(), migrationReview: () => service.migrationReview(),
    inventoryContext: () => service.inventoryContext(), previewInventory: (action, id) => service.previewInventory(action, id),
    listen: listener => service.listen(state => { if (!panelCommit) listener(state.save, state.receipt ? legacyReceipt(state.receipt) : undefined); }),
    async persistPanel(next, revision) {
      panelCommit++;
      try { const receipt = await convert(service.persistPanel(next, revision)); return { receipt, revision: service.snapshot().factRevision ?? 0 }; }
      finally { panelCommit--; }
    },
    setPromptSettings: settings => convert(service.setPromptSettings(settings)), setStorySync: enabled => convert(service.setStorySync(enabled)),
    deleteBattleReport: id => convert(service.deleteBattleReport(id)), restoreBattleReport: () => convert(service.restoreBattleReport()),
    restartBattleReport: (id, revision, seed) => convert(service.restartBattleReport(id, revision, seed)),
    revokeBlessing: (id, source, revision, context) => convert(service.revokeBlessing(id, source, revision, context)),
    inventoryAction: intent => convert(service.inventoryAction(intent)), commitInventoryPreview: preview => convert(service.commitInventoryPreview(preview)),
    deleteUnit: id => convert(service.deleteUnit(id)), restoreDeployment: id => convert(service.restoreDeployment(id)), approve: id => convert(service.approve(id)),
    correctProposal: (id, text) => convert(service.correctProposal(id, text)), reject: id => convert(service.reject(id)), deleteRecords: ids => convert(service.deleteRecords(ids)),
    acceptMigration: () => convert(service.acceptMigration()), restoreMigrationBackup: () => convert(service.restoreMigrationBackup()),
    beginGeneration: () => service.beginGeneration(), scan: (id, options) => service.scan(id, options), rebind: id => service.rebind(id), dispose() {},
  };
  const adapter: TavernAdapter = {
    inTavern: true, identity: () => host.session()?.scope.key ?? '', namespace: () => host.namespace(),
    load: <T>(key: string) => key === 'panel' ? service.snapshot() as T : undefined,
    save: () => ({ status: 'failed', local: false, host: false, error: '原生保存必须通过异步业务服务' }),
    getEnvelope: async id => host.message(id), getLastMessage: async () => host.message()?.text,
    subscribe: (kind, callback) => host.subscribe(kind, callback), isGenerating: () => host.isGenerating(),
    onMessageReceived: cb => host.subscribe('MESSAGE_RECEIVED', cb).stop,
    onChatChanged: cb => host.subscribe('CHAT_CHANGED', cb).stop, onUserMessage: cb => host.subscribe('MESSAGE_SENT', cb).stop,
    injectPrompts: prompts => prompts.every(prompt => host.inject(prompt.id, prompt.content)), uninjectPrompts: id => host.clearInjection(id),
    recentPromptText: () => host.recentPromptText(), sendAsUser: (text, options) => messages.send(text, options),
  };
  return { adapter, controller, resident: true, native: true,
    recentNarrative: () => {
      const count = host.context().chat?.length ?? 0;
      return Array.from({length: Math.min(count, 100)}, (_, i) => host.message(count - Math.min(count, 100) + i)).flatMap(m => m ? [{ id: m.messageId + ':' + m.swipeId, role: m.role, text: m.text, completed: m.complete }] : []);
    },
    getTheme: () => display.read().theme ?? 'dark', setTheme: theme => display.write({ theme }),
    retryGeneration: deliveryId => messages.retryGeneration(deliveryId),
    canWrite: () => service.canWrite(),
    retrySave: async () => service.store.pendingOperation() ? convert(service.retry()) : (await controller.persistPanel(service.snapshot(), service.snapshot().factRevision ?? 0)).receipt,
  };
}
