import { legacyMirrorKey } from './contracts.js';
import { optionalStorage, withAbort } from './browser-compat.js';
import { sameChat, type ChatScope, type HostSession, type MetadataPort, type MessageTag, type LegacyHandoff } from './contracts.js';
import { namespaceOf, type MessageEnvelope } from '../../panel/src/narrative-state.js';
import { findMessageBySourceId, matchesMessageTag, SourceMessageChangedError, sourceId } from './message-identity.js';
import { replySaveWindow, type HostSaveState } from './reply-save.js';
import { serialized } from './json.js';
import type { FormattingContext } from './battle-message-format.js';
import { readChatHeader } from './chat-header.js';

export interface MessageFormatter {
  stage?: { AFTER_REGEX?: string; AFTER_MARKDOWN?: string };
  order?: { LATE?: number };
  addHook(hook: (text: string, context: FormattingContext) => string, options: { stage: string; order: number }): void;
}

export interface HostMessage {
  name?: string; is_user?: boolean; is_system?: boolean; mes?: string; send_date?: string | number;
  swipe_id?: number; swipes?: string[]; gen_finished?: string | number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface HostContext {
  messageFormatter?: MessageFormatter;
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

interface TauriChatHandle {
  metadata?: { get?(): Promise<unknown> };
  history?: { tail?(options: { limit: number }): Promise<{ messages?: unknown } | undefined> };
}
interface TauriChatApi {
  open(ref: { kind: 'character'; characterId: string; fileName: string }): TauriChatHandle | undefined;
}
/** Messages read back per page after a save; a longer span reads the whole chat. */
const TAIL_PAGE = 200;
/** Extra lines per page, for messages deleted in front of the one being checked. */
const TAIL_MARGIN = 8;

function chatMetadata(header: unknown): Record<string, unknown> {
  if (header === undefined) return {};
  const metadata = header && typeof header === 'object' ? (header as { chat_metadata?: unknown }).chat_metadata : undefined;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw Error('聊天附加记录头缺失，不能确认保存');
  return metadata as Record<string, unknown>;
}

function messageTagsMatch(messages: HostMessage[], tags: MessageTag[]): boolean {
  const wanted = new Set(tags.map(tag => tag.id));
  const found = new Map<string, HostMessage>();
  for (const message of messages) {
    const id = sourceId(message);
    if (!id || !wanted.has(id)) continue;
    if (found.has(id)) return false;
    found.set(id, message);
  }
  return tags.every(tag => { const message = found.get(tag.id); return !!message && matchesMessageTag(message, tag); });
}

/** Reads only the current host's public context. No TavernHelper dependency. */
export class NativeHost implements MetadataPort {
  private epoch = 0;
  private lastKey?: string;
  private lastMetadata?: Record<string, unknown>;
  private lastChat?: HostMessage[];
  private lastBranch?: string;
  private stops = new Set<() => void>();
  private generating = false;
  constructor(private host: HostWindow, private account: string, private request: typeof fetch = fetch, readonly legacyStorage: Storage | undefined = optionalStorage(), private saveState?: HostSaveState) {}
  replySaveWindow() {
    const session = this.session();
    return session && this.saveState && typeof this.saveState.isChatSaving === 'boolean'
      ? replySaveWindow(this.saveState, session, () => this.session()) : undefined;
  }
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
    const branchId = context.branchId ?? chatId;
    const key = JSON.stringify([this.account, avatar, chatId, ...(branchId !== chatId ? [branchId] : [])]);
    if (key !== this.lastKey || context.chatMetadata !== this.lastMetadata || context.chat !== this.lastChat || branchId !== this.lastBranch) {
      this.epoch++; this.lastKey = key; this.lastMetadata = context.chatMetadata; this.lastChat = context.chat; this.lastBranch = branchId;
    }
    return { scope: { key, account: this.account, avatar, chatId, branchId, characterName: character?.name ?? context.name2 ?? '' }, epoch: this.epoch };
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
      complete: !this.generating && (!!message.is_user || !!message.gen_finished) && !message.extra?.error && message.is_hidden !== true,
    };
  }
  recentPromptText(): string { return this.context().chat?.slice(-4).map(message => message.mes ?? '').join('\n') ?? ''; }
  messageBySource(id: string): MessageEnvelope | undefined {
    const index = findMessageBySourceId(this.context().chat ?? [], id);
    return index === undefined ? undefined : this.message(index);
  }
  async applyMessageTags(session: HostSession, tags: MessageTag[]): Promise<void> {
    const chat = this.context().chat;
    // The host may swap in new objects for the same chat; the fingerprints decide whether
    // these are still the scanned messages.
    if (!chat || !sameChat(session, this.session())) throw Error('绑定消息身份时聊天已切换');
    const targets = tags.map(tag => {
      const identified = chat.flatMap((message, index) => sourceId(message) === tag.id ? [index] : []);
      if (identified.length > 1) throw Error('消息身份重复，不能自动选择来源');
      const index = identified[0] ?? tag.index; const message = chat[index];
      if (!message || !matchesMessageTag(message, tag) || sourceId(message) && sourceId(message) !== tag.id) throw new SourceMessageChangedError();
      return { message, tag };
    });
    for (const { message, tag } of targets) { message.extra ??= {}; message.extra.tavernBattleSourceId = tag.id; }
  }
  verifyMessageTags(scope: ChatScope, tags: MessageTag[]): Promise<boolean> {
    // A page stands for the file only while each source ID is unique in the chat just saved.
    const chat = this.session()?.scope.key === scope.key ? this.context().chat ?? [] : [];
    const counts = new Map(tags.map(tag => [tag.id, 0]));
    for (const message of chat) { const id = sourceId(message); if (id && counts.has(id)) counts.set(id, counts.get(id)! + 1); }
    const unique = chat.length > 0 && [...counts.values()].every(count => count <= 1);
    return this.persistedSince(scope, unique ? Math.min(...tags.map(tag => tag.index)) : -1, messages => messageTagsMatch(messages, tags));
  }
  /**
   * Whether `accept` holds for the persisted messages from live index `from` to the end.
   * TauriTavern pages them from the chat file; a miss, or any other host, reads the whole chat.
   */
  async persistedSince(scope: ChatScope, from: number, accept: (messages: HostMessage[]) => boolean): Promise<boolean> {
    const handle = this.tauriChat(scope);
    const count = this.session()?.scope.key === scope.key ? (this.context().chat?.length ?? 0) - from : 0;
    if (typeof handle?.history?.tail === 'function' && from >= 0 && count > 0 && count <= TAIL_PAGE) {
      const page = await handle.history.tail({ limit: count + TAIL_MARGIN });
      if (!Array.isArray(page?.messages)) throw Error('酒馆返回了无法识别的聊天数据');
      if (accept(page.messages as HostMessage[])) return true;
    }
    return accept((await this.readChat(scope)).slice(1));
  }
  async applyLegacyHandoff(session: HostSession, handoff: LegacyHandoff): Promise<void> {
    const metadata = this.metadata();
    if (!metadata || !sameChat(session, this.session()) || this.hasLegacyRuntime()) throw Error('回退目标已变或脚本版战阵仍在运行');
    if (handoff.mirrorKey !== legacyMirrorKey(session.scope) || !this.legacyStorage) throw Error('无法确认脚本镜像键或本地存储不可用');
    const variables = metadata.variables;
    if (variables !== undefined && (!variables || typeof variables !== 'object' || Array.isArray(variables))) throw Error('脚本变量容器损坏，不能回退保存');
    this.legacyStorage.setItem(handoff.mirrorKey, handoff.mirrorValue);
    if (this.legacyStorage.getItem(handoff.mirrorKey) !== handoff.mirrorValue) throw Error('脚本镜像保存未确认');
    metadata.variables = { ...variables as Record<string, unknown> | undefined, panel: structuredClone(handoff.panel) };
  }
  async verifyLegacyHandoff(scope: ChatScope, handoff: LegacyHandoff): Promise<boolean> {
    const metadata = await this.readPersisted(scope);
    return this.legacyHandoffMatches(metadata, handoff);
  }
  private legacyHandoffMatches(metadata: Record<string, unknown>, handoff: LegacyHandoff): boolean {
    const variables = metadata.variables as { panel?: unknown } | undefined;
    return serialized(variables?.panel) === serialized(handoff.panel) && this.legacyStorage?.getItem(handoff.mirrorKey) === handoff.mirrorValue;
  }
  generationSettled(session: HostSession): void { if (sameChat(session, this.session())) this.generating = false; }
  hasLegacyRuntime(): boolean { return !!this.host.__tavernBattleController; }
  async saveMetadata(): Promise<void> {
    const context = this.context();
    if (!context.saveMetadata) throw Error('酒馆没有提供聊天附加记录保存接口');
    await context.saveMetadata();
  }
  /** Message changes require the full host save; metadata-only fallback would lose them. */
  async saveChat(): Promise<void> {
    const context = this.context();
    if (!context.saveChat) throw Error('酒馆没有提供聊天完整保存接口');
    await context.saveChat();
  }
  /**
   * Tauri's compatibility fetch materializes the entire chat before returning a Response;
   * its public chat API reads the persisted JSONL header or a page of lines instead.
   * Open the captured target explicitly; current.handle() could follow a chat switch.
   */
  private tauriChat(scope: ChatScope): TauriChatHandle | undefined {
    const api = (this.host.__TAURITAVERN__ as { api?: { chat?: TauriChatApi } } | undefined)?.api?.chat;
    if (typeof api?.open !== 'function' || !scope.avatar.endsWith('.png')) return undefined;
    return api.open({ kind: 'character', characterId: scope.avatar.slice(0, -4), fileName: scope.chatId });
  }
  async readPersisted(scope: ChatScope): Promise<Record<string, unknown>> {
    const handle = this.tauriChat(scope);
    // Propagate read/corruption errors; never substitute the unsaved live metadata.
    if (typeof handle?.metadata?.get === 'function') return chatMetadata({ chat_metadata: await handle.metadata.get() });
    return chatMetadata(await readChatHeader(await this.requestChat(scope)));
  }
  async readPersistedWithEffects(scope: ChatScope, effects: { messageTags?: MessageTag[]; legacyHandoff?: LegacyHandoff }): Promise<{ metadata: Record<string, unknown>; effectsVerified: boolean }> {
    const tags = effects.messageTags ?? [];
    // TauriTavern reads the header and a page of the newest messages, not the whole chat.
    if (tags.length && typeof this.tauriChat(scope)?.history?.tail === 'function') {
      const metadata = await this.readPersisted(scope);
      return { metadata, effectsVerified: await this.verifyMessageTags(scope, tags) && (!effects.legacyHandoff || this.legacyHandoffMatches(metadata, effects.legacyHandoff)) };
    }
    // When tags need checking, this full read already contains the archive header.
    const chat = tags.length ? await this.readChat(scope) : undefined;
    const metadata = chat ? chatMetadata(chat[0]) : await this.readPersisted(scope);
    const tagsVerified = !tags.length || messageTagsMatch(chat!.slice(1), tags);
    return { metadata, effectsVerified: tagsVerified && (!effects.legacyHandoff || this.legacyHandoffMatches(metadata, effects.legacyHandoff)) };
  }
  async readChat(scope: ChatScope): Promise<HostMessage[]> {
    const response = await this.requestChat(scope);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw Error('酒馆返回了无法识别的聊天数据');
    return data as HostMessage[];
  }
  private async requestChat(scope: ChatScope): Promise<Response> {
    const headers = this.context().getRequestHeaders?.();
    if (!headers) throw Error('酒馆没有提供保存读回接口所需的请求头');
    const request = this.request;
    const response = await request('/api/chats/get', {
      method: 'POST', headers, cache: 'no-store',
      body: JSON.stringify({ ch_name: scope.characterName, file_name: scope.chatId, avatar_url: scope.avatar }),
    });
    if (!response.ok) throw Error(`读取聊天持久状态失败（${response.status}）`);
    return response;
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
  inject(id: string, content: string, options: { position?: number; depth?: number; scan?: boolean; role?: number } = {}): boolean {
    const set = this.context().setExtensionPrompt;
    if (!set || this.hasLegacyRuntime()) return false;
    set(id, content, options.position ?? 1, options.depth ?? 0, options.scan ?? false, options.role ?? 0); return true;
  }
  clearInjection(id: string): void { this.context().setExtensionPrompt?.(id, '', 1, 0, false, 0); }
  dispose(): void { for (const stop of [...this.stops]) stop(); this.generating = false; }
}

interface UserModule { accountsEnabled?: boolean; currentUser?: { handle?: string } | null; getCurrentUserHandle?(): string }
const loadHostUser = (): Promise<UserModule> => import(/* @vite-ignore */ new URL('/scripts/user.js', globalThis.location.href).href);
const loadHostSaveState = (): Promise<HostSaveState> => import(/* @vite-ignore */ new URL('/script.js', globalThis.location.href).href);
export async function createNativeHost(host: HostWindow, request: typeof fetch = fetch, loadUser: () => Promise<UserModule> = loadHostUser, loadSaveState = loadHostSaveState): Promise<NativeHost> {
  const headers = host.SillyTavern?.getContext().getRequestHeaders?.();
  if (!headers) throw Error('酒馆上下文尚未就绪');
  let saveState: HostSaveState | undefined;
  try { const module = await withAbort({ timeout: 3000 }, () => loadSaveState()); if (typeof module.isChatSaving === 'boolean') saveState = module; } catch { /* Optional optimisation; retain the existing save contract. */ }
  // TauriTavern 2.1 has no /api/users/me route. Use its own account selector,
  // rather than guessing a shared fallback handle for a malformed API response.
  if (host.__TAURI_RUNNING__ === true || host.__TAURITAVERN__) {
    const user = await withAbort({ timeout: 10000 }, () => loadUser());
    if (user.accountsEnabled && !user.currentUser?.handle) throw Error('酒馆账户尚未初始化');
    const handle = user.getCurrentUserHandle?.();
    if (typeof handle !== 'string' || !handle) throw Error('TauriTavern 未提供可靠用户标识');
    return new NativeHost(host, handle, request, optionalStorage(), saveState);
  }
  const user: unknown = await withAbort({ timeout: 10000 }, async signal => {
    const response = await request('/api/users/me', { headers, cache: 'no-store', signal });
    if (!response.ok) throw Error('无法确定当前酒馆用户，不能建立存档作用域');
    return response.json();
  });
  const handle = user && typeof user === 'object' ? (user as { handle?: unknown }).handle : undefined;
  if (typeof handle !== 'string' || !handle) throw Error('酒馆未返回可靠用户标识');
  return new NativeHost(host, handle, request, optionalStorage(), saveState);
}
