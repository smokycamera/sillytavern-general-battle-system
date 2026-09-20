import type { DeliveryReceipt } from '../../panel/src/tavern.js';
import { sameSession, type HostSession } from './contracts.js';
import { NativeHost, type HostMessage } from './sillytavern.js';

/** Inserts structured data; never reads, clears or executes the user's draft. */
export class NativeMessages {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private host: NativeHost, private canSend: () => boolean = () => true) {}
  send(text: string, options: { deliveryId?: string; generate?: boolean } = {}): Promise<DeliveryReceipt> {
    const session = this.host.session();
    const deliveryId = options.deliveryId ?? crypto.randomUUID();
    const run = async (): Promise<DeliveryReceipt> => {
      if (!session || !sameSession(session, this.host.session()) || this.host.hasLegacyRuntime() || !this.canSend()) return { status: 'failed', detail: '发送目标已切换、档案保存尚待核实或旧战阵脚本仍在运行' };
      const ctx = this.host.context(); const chat = ctx.chat;
      if (!chat || !ctx.addOneMessage || !ctx.eventSource?.emit) return { status: 'failed', detail: '宿主缺少消息插入或渲染接口' };
      const existing = chat.find(message => message.extra?.tavernBattleDeliveryId === deliveryId);
      if (existing) {
        if (existing.mes !== text) return { status: 'failed', detail: '投递身份已用于不同内容' };
        try {
          const saved = await this.host.readChat(session.scope);
          return saved.some(item => item.extra?.tavernBattleDeliveryId === deliveryId && item.mes === text)
            ? { status: 'inserted', detail: '消息已经保存，不重复插入或触发生成' }
            : { status: 'unknown', detail: '此前插入的消息仍未确认保存，不重复发送' };
        } catch (error) { return { status: 'unknown', detail: String(error) }; }
      }
      const message: HostMessage = { name: ctx.name1 ?? 'User', is_user: true, is_system: false, mes: text, send_date: new Date().toISOString(), extra: { tavernBattleDeliveryId: deliveryId } };
      chat.push(message); if (ctx.chatMetadata) ctx.chatMetadata.tainted = true;
      try { await this.host.saveMetadata(); } catch { /* The independent read below decides whether delivery occurred. */ }
      try {
        const saved = await this.host.readChat(session.scope);
        if (!saved.some(item => item.extra?.tavernBattleDeliveryId === deliveryId && item.mes === text && item.is_user === true)) return { status: 'unknown', detail: '消息已插入内存，宿主尚未确认保存；不要重复发送' };
      } catch (error) { return { status: 'unknown', detail: String(error) }; }
      if (!sameSession(session, this.host.session())) return { status: 'inserted', detail: '消息已保存在原聊天；切聊天后未触发生成' };
      try {
        const events = { ...ctx.event_types, ...ctx.eventTypes };
        const index = chat.indexOf(message);
        if (events.MESSAGE_SENT) await ctx.eventSource.emit(events.MESSAGE_SENT, index);
        if (!sameSession(session, this.host.session())) return { status: 'inserted', detail: '消息事件期间聊天已切换' };
        ctx.addOneMessage(message);
        if (events.USER_MESSAGE_RENDERED) await ctx.eventSource.emit(events.USER_MESSAGE_RENDERED, index);
      } catch (error) { return { status: 'inserted', detail: '消息已保存，显示更新未完成：' + String(error) }; }
      if (options.generate === false || !sameSession(session, this.host.session()) || this.host.isGenerating()) return { status: 'inserted', messageDurable: true, generation: 'not-started' };
      return this.generateReply(session, message);
    };
    const promise = this.queue.then(run, run).then(receipt => ({ ...receipt, deliveryId })); this.queue = promise.catch(() => undefined); return promise;
  }
  retryGeneration(deliveryId: string): Promise<DeliveryReceipt> {
    const session = this.host.session();
    const run = async (): Promise<DeliveryReceipt> => {
      if (!session || !sameSession(session, this.host.session()) || this.host.hasLegacyRuntime()) return { status: 'failed', detail: '当前聊天已变化' };
      const message = this.host.context().chat?.find(item => item.extra?.tavernBattleDeliveryId === deliveryId && item.is_user);
      if (!message) return { status: 'unknown', detail: '找不到已保存的投递消息，请先核对聊天' };
      try {
        const disk = await this.host.readChat(session.scope);
        if (!disk.some(item => item.extra?.tavernBattleDeliveryId === deliveryId && item.mes === message.mes && item.is_user)) return { status: 'unknown', detail: '投递消息尚未确认保存' };
        return this.generateReply(session, message);
      } catch (error) { return { status: 'inserted', detail: String(error) }; }
    };
    const next = this.queue.then(run, run).then(receipt => ({ ...receipt, deliveryId })); this.queue = next.catch(() => undefined); return next;
  }
  private async generateReply(session: HostSession, message: HostMessage): Promise<DeliveryReceipt> {
    const ctx = this.host.context(); const chat = ctx.chat;
    if (!sameSession(session, this.host.session()) || this.host.hasLegacyRuntime() || this.host.isGenerating() || !this.canSend()) return { status: 'inserted', messageDurable: true, generation: 'not-started', detail: '当前正在生成、档案待核实或聊天已切换，未重复触发生成' };
    if (!ctx.generate || chat?.at(-1) !== message || !message.is_user) return { status: 'inserted', messageDurable: true, generation: 'not-started', detail: '聊天已有后续内容或生成接口不可用，请在宿主中核对后重生成' };
    let started = false, stopped = false;
    const subscriptions = [this.host.subscribe('GENERATION_STARTED', (_type, _options, dry) => { if (dry !== true) started = true; }),
      this.host.subscribe('GENERATION_STOPPED', () => { stopped = true; }), this.host.subscribe('GENERATION_ENDED', () => {})];
    const index = chat.length - 1;
    try {
      // Both verified host implementations bypass draft commands, draft clearing and
      // attachments for regenerate. With the last message being our user message,
      // this path creates the next assistant reply and removes no existing reply.
      await ctx.generate('regenerate', { automatic_trigger: true });
      if (!sameSession(session, this.host.session())) return { status: 'inserted', messageDurable: true, generation: started ? 'started' : 'not-started', detail: '生成期间聊天已切换，请核对原聊天' };
      const reply = chat.slice(index + 1).find(item => !item.is_user && !item.is_system && !!item.gen_finished && !!item.mes?.trim() && !item.extra?.error && !/^\[API Error\]/.test(item.mes));
      return reply && !stopped ? { status: 'sent', messageDurable: true, generation: 'completed' }
        : { status: 'inserted', messageDurable: true, generation: stopped ? 'failed' : started ? 'started' : 'not-started', detail: '战报已保存，但尚未确认完整模型回复；可核对聊天或单独重试生成' };
    } catch (error) { return { status: 'inserted', messageDurable: true, generation: 'failed', detail: '战报已保存；生成失败，可单独重试生成：' + String(error) }; }
    finally { subscriptions.forEach(subscription => subscription.stop()); this.host.generationSettled(session); }
  }
}
