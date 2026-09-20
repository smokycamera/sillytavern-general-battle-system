import { sameSession, type ChatScope, type HostSession, type MetadataPort, type MessageTag, type LegacyHandoff } from './contracts.js';
import { namespaceOf, type MessageEnvelope } from '../../panel/src/narrative-state.js';
import { findMessageBySourceId, matchesMessageFingerprint, SourceMessageChangedError, sourceId } from './message-identity.js';
import { serialized } from './json.js';

export interface HostMessage {
  name?: string; is_user?: boolean; is_system?: boolean; mes?: string; send_date?: string | number;
  swipe_id?: number; swipes?: string[]; gen_finished?: string | number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface HostContext {
  characterId?: number | string; chatId?: string; branchId?: string; groupId?: string | number | false | null;
  name1?: string; name2?: string;
  characters?: { avatar?: string; name?: string; chat?: string }[];
  chat?: HostMessage[];
  chatMetadata?: Record<string, unknown>;
  extensionSettings?: Record<string, unknown>;
  eventTypes?: Record<string, string>; event_types?: Record<string, string>;
  eventSource?: { on(event: string, callback: (...args: unknown[]) => void): void; off?(event: string, callback: (...args: unknown[]) => void): void; removeListener?(event: string, callback: (...args: unknown[]) => void): void; emit?(event: string, ...args: unknown[]): Promise<unknown> | unknown };
  saveMetadata?(): Promise<unknown>;
  saveChat?(): Promise<unknown>;
  getRequestHeaders?(): Record<string, string>;
  setExtensionPrompt?(id: string, content: string, position: number, depth: number, scan: boolean, role: number): void;
  addOneMessage?(message: HostMessage): void;
  generate?(type: string, options: { automatic_trigger: boolean }): Promise<unknown>;
  getCharacters?(): Promise<unknown>;
  selectCharacterById?(id: number): Promise<unknown>;
  saveSettingsDebounced?(): void;
}
export interface HostWindow {
  SillyTavern?: { getContext(): HostContext };
  __tavernBattleController?: unknown;
  __TAURITAVERN__?: unknown;
  __TAURI_RUNNING__?: boolean;
}

/** Reads only the current host's public context. No TavernHelper dependency. */
export class NativeHost implements MetadataPort {
  private epoch = 0;
  private lastKey?: string;
  private lastMetadata?: Record<string, unknown>;
  private lastChat?: HostMessage[];
  private stops = new Set<() => void>();
  private generating = false;
  constructor(private host: HostWindow, private account: string, private request: typeof fetch = fetch, readonly legacyStorage: Storage | undefined = globalThis.localStorage) {}
  context(): HostContext { return this.host.SillyTavern?.getContext() ?? {}; }
  session(): HostSession | undefined {
    const context = this.context();
    const index = typeof context.characterId === 'number' ? context.characterId
      : typeof context.characterId === 'string' && /^\d+$/.test(context.characterId) ? Number(context.characterId) : NaN;
    const character = Number.isSafeInteger(index) && index >= 0 ? context.characters?.[index] : undefined;
    const avatar = character?.avatar;
    const chatId = context.chatId ?? character?.chat;
    // The current battle model does not support group chats or temporary chats.
    if (context.groupId !== undefined && context.groupId !== null && context.groupId !== '' && context.groupId !== false || !this.account || !avatar || !chatId || !context.chatMetadata || !context.chat) {
      if (this.lastKey !== undefined) this.epoch++;
      this.lastKey = undefined; this.lastMetadata = undefined; this.lastChat = undefined;
      return undefined;
    }
    const key = JSON.stringify([this.account, avatar, chatId]);
    if (key !== this.lastKey || context.chatMetadata !== this.lastMetadata || context.chat !== this.lastChat) {
      this.epoch++; this.lastKey = key; this.lastMetadata = context.chatMetadata; this.lastChat = context.chat;
    }
    return { scope: { key, account: this.account, avatar, chatId, characterName: character?.name ?? context.name2 ?? '' }, epoch: this.epoch };
  }
  metadata(): Record<string, unknown> | undefined { return this.context().chatMetadata; }
  namespace(): string | undefined {
    const session = this.session();
    return session ? namespaceOf({ characterId: session.scope.avatar, chatId: session.scope.chatId, branchId: this.context().branchId ?? session.scope.chatId }) : undefined;
  }
  message(messageId?: number): MessageEnvelope | undefined {
    const session = this.session(); const context = this.context();
    if (!session || !context.chat) return undefined;
    const index = messageId ?? context.chat.length - 1;
    if (!Number.isSafeInteger(index) || index < 0) return undefined;
    const message = context.chat[index];
    if (!message || typeof message.mes !== 'string') return undefined;
    const swipe = message.swipe_id;
    return {
      characterId: session.scope.avatar, chatId: session.scope.chatId, branchId: context.branchId ?? session.scope.chatId,
      messageId: sourceId(message) ?? String(index), swipeId: Number.isSafeInteger(swipe) && swipe! >= 0 ? String(swipe) : '',
      role: message.is_system ? 'system' : message.is_user ? 'user' : 'assistant', text: message.mes,
      complete: !this.generating && !!message.gen_finished && !message.extra?.error && message.is_hidden !== true,
    };
  }
  recentPromptText(): string { return this.context().chat?.slice(-4).map(message => message.mes ?? '').join('\n') ?? ''; }
  messageBySource(id: string): MessageEnvelope | undefined {
    const index = findMessageBySourceId(this.context().chat ?? [], id);
    return index === undefined ? undefined : this.message(index);
  }
  async applyMessageTags(session: HostSession, tags: MessageTag[]): Promise<void> {
    const chat = this.context().chat;
    if (!chat || !sameSession(session, this.session())) throw Error('绑定消息身份时聊天已切换');
    const targets = tags.map(tag => {
      const identified = chat.flatMap((message, index) => sourceId(message) === tag.id ? [index] : []);
      if (identified.length > 1) throw Error('消息身份重复，不能自动选择来源');
      const index = identified[0] ?? tag.index; const message = chat[index];
      if (!message || !matchesMessageFingerprint(message, tag.fingerprint) || sourceId(message) && sourceId(message) !== tag.id) throw new SourceMessageChangedError();
      return { message, tag };
    });
    for (const { message, tag } of targets) { message.extra ??= {}; message.extra.tavernBattleSourceId = tag.id; }
  }
  async verifyMessageTags(scope: ChatScope, tags: MessageTag[]): Promise<boolean> {
    const persisted = (await this.readChat(scope)).slice(1);
    return tags.every(tag => persisted.filter(message => sourceId(message) === tag.id).length === 1);
  }
  async applyLegacyHandoff(session: HostSession, handoff: LegacyHandoff): Promise<void> {
    const metadata = this.metadata();
    if (!metadata || !sameSession(session, this.session()) || this.hasLegacyRuntime()) throw Error('回退目标已变或旧脚本仍在运行');
    if (handoff.mirrorKey !== `tavern-battle:chat:chat:${session.scope.chatId}:panel` || !this.legacyStorage) throw Error('无法确认旧镜像键或本地存储不可用');
    const variables = metadata.variables;
    if (variables !== undefined && (!variables || typeof variables !== 'object' || Array.isArray(variables))) throw Error('旧变量容器损坏，不能回退写入');
    this.legacyStorage.setItem(handoff.mirrorKey, handoff.mirrorValue);
    if (this.legacyStorage.getItem(handoff.mirrorKey) !== handoff.mirrorValue) throw Error('旧镜像写入未确认');
    metadata.variables = { ...variables as Record<string, unknown> | undefined, panel: structuredClone(handoff.panel) };
  }
  async verifyLegacyHandoff(scope: ChatScope, handoff: LegacyHandoff): Promise<boolean> {
    const metadata = await this.readPersisted(scope);
    const variables = metadata.variables as { panel?: unknown } | undefined;
    return serialized(variables?.panel) === serialized(handoff.panel) && this.legacyStorage?.getItem(handoff.mirrorKey) === handoff.mirrorValue;
  }
  generationSettled(session: HostSession): void { if (sameSession(session, this.session())) this.generating = false; }
  hasLegacyRuntime(): boolean { return !!this.host.__tavernBattleController; }
  async saveMetadata(): Promise<void> {
    const context = this.context();
    if (!context.saveMetadata) throw Error('宿主没有提供聊天元数据保存接口');
    await context.saveMetadata();
  }
  /** Message changes require the full host save; metadata-only fallback would lose them. */
  async saveChat(): Promise<void> {
    const context = this.context();
    if (!context.saveChat) throw Error('宿主没有提供聊天完整保存接口');
    await context.saveChat();
  }
  async readPersisted(scope: ChatScope): Promise<Record<string, unknown>> {
    const data = await this.readChat(scope);
    if (!data.length) return {};
    const header = data[0] as { chat_metadata?: unknown };
    if (!header || typeof header !== 'object' || !header.chat_metadata || typeof header.chat_metadata !== 'object' || Array.isArray(header.chat_metadata)) throw Error('聊天元数据头缺失，不能确认保存');
    return header.chat_metadata as Record<string, unknown>;
  }
  async readChat(scope: ChatScope): Promise<HostMessage[]> {
    const headers = this.context().getRequestHeaders?.();
    if (!headers) throw Error('宿主没有提供持久化读回接口所需的请求头');
    const request = this.request;
    const response = await request('/api/chats/get', {
      method: 'POST', headers, cache: 'no-store',
      body: JSON.stringify({ ch_name: scope.characterName, file_name: scope.chatId, avatar_url: scope.avatar }),
    });
    if (!response.ok) throw Error(`读取聊天持久状态失败（${response.status}）`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw Error('宿主返回了无法识别的聊天数据');
    return data as HostMessage[];
  }
  subscribe(kind: string, callback: (...args: unknown[]) => void): { available: boolean; stop(): void } {
    const context = this.context(); const source = context.eventSource;
    const event = context.eventTypes?.[kind] ?? context.event_types?.[kind];
    const remove = source?.off ?? source?.removeListener;
    if (!source?.on || !remove || !event) return { available: false, stop() {} };
    let active = true;
    const handler = (...args: unknown[]) => {
      if (!active) return;
      if (kind === 'GENERATION_STARTED' && args[2] !== true) this.generating = true;
      if (kind === 'GENERATION_ENDED' || kind === 'GENERATION_STOPPED') this.generating = false;
      if (kind === 'CHAT_CHANGED') this.generating = false;
      return callback(...args);
    };
    source.on(event, handler);
    const stop = () => { if (!active) return; active = false; remove.call(source, event, handler); this.stops.delete(stop); };
    this.stops.add(stop); return { available: true, stop };
  }
  isGenerating(): boolean { return this.generating; }
  inject(id: string, content: string): boolean {
    const set = this.context().setExtensionPrompt;
    if (!set || !this.session() || this.hasLegacyRuntime()) return false;
    set(id, content, 1, 0, false, 0); return true;
  }
  clearInjection(id: string): void { this.context().setExtensionPrompt?.(id, '', 1, 0, false, 0); }
  dispose(): void { for (const stop of [...this.stops]) stop(); this.generating = false; }
}

interface UserModule { accountsEnabled?: boolean; currentUser?: { handle?: string } | null; getCurrentUserHandle?(): string }
const loadHostUser = (): Promise<UserModule> => import(/* @vite-ignore */ new URL('/scripts/user.js', globalThis.location.href).href);
export async function createNativeHost(host: HostWindow, request: typeof fetch = fetch, loadUser: () => Promise<UserModule> = loadHostUser): Promise<NativeHost> {
  const headers = host.SillyTavern?.getContext().getRequestHeaders?.();
  if (!headers) throw Error('酒馆上下文尚未就绪');
  // TauriTavern 2.1 has no /api/users/me route. Use its own account selector,
  // rather than guessing a shared fallback handle for a malformed API response.
  if (host.__TAURI_RUNNING__ === true || host.__TAURITAVERN__) {
    const user = await loadUser();
    if (user.accountsEnabled && !user.currentUser?.handle) throw Error('宿主账户尚未初始化');
    const handle = user.getCurrentUserHandle?.();
    if (typeof handle !== 'string' || !handle) throw Error('TauriTavern 未提供可靠用户标识');
    return new NativeHost(host, handle, request);
  }
  const response = await request('/api/users/me', { headers, cache: 'no-store' });
  if (!response.ok) throw Error('无法确定当前酒馆用户，不能建立存档作用域');
  const user: unknown = await response.json();
  const handle = user && typeof user === 'object' ? (user as { handle?: unknown }).handle : undefined;
  if (typeof handle !== 'string' || !handle) throw Error('宿主未返回可靠用户标识');
  return new NativeHost(host, handle, request);
}
