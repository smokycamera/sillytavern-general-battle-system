import { encodeSave, decodeSave, compactLocalMirrors } from './storage-codec.js';
/**
 * 酒馆助手（TavernHelper / JS-Slash-Runner）适配层。
 * 在酒馆内运行时使用其真实 API；脱离酒馆（本地开发/预览）自动降级到 localStorage 与剪贴板。
 * 所有调用防御式包装——API 缺失或版本差异不应导致面板崩溃。
 *
 * 事件订阅三层兜底（自动扫描/聊天切换曾长期静默失败的根治）：
 *   ① SillyTavern 核心 eventSource（主窗口全局，最可靠）
 *   ② TavernHelper 事件桥（_bind._eventOn / eventOn + tavern_events）
 *   ③ 轮询兜底（每 1.5s 检查最新消息指纹与聊天身份，变化即触发回调）——不依赖任何事件 API
 *
 * 「AI 输出完毕」的权威信号是 GENERATION_ENDED（中止为 GENERATION_STOPPED）；
 * MESSAGE_RECEIVED 在部分版本/流式场景下早于文本定稿。扫描触发同时绑定三类事件，
 * 且生成进行中（generation_started）轮询不触发——避免扫到半截标签提前消费。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const LS_PREFIX = 'tavern-battle:';
import { namespaceOf, type MessageEnvelope } from './narrative-state.js';

/** 存档作用域：chat=每个聊天一份（默认）；character=跟随角色卡 */
export type SaveScope = 'chat' | 'character';

export interface SaveReceipt {
  status: 'saved' | 'local-only' | 'failed';
  host: boolean;
  local: boolean;
  error?: string;
  nativeStatus?: 'confirmed' | 'pending' | 'conflict' | 'failed';
}

export interface DeliveryReceipt {
  status: 'sent' | 'inserted' | 'copied' | 'unknown' | 'failed' | 'sending';
  detail?: string;
  deliveryId?: string;
  messageDurable?: boolean;
  generation?: 'not-started' | 'started' | 'completed' | 'failed';
}

function getTH(): any | undefined {
  const w = window as any;
  return w.TavernHelper ?? (w.parent && w.parent !== w ? w.parent.TavernHelper : undefined);
}

/** 酒馆主窗口（面板跑在 srcdoc iframe 里，与主窗口同源） */
function getHost(): any {
  const w = window as any;
  return w.parent && w.parent !== w ? w.parent : w;
}

/** SillyTavern 核心上下文（主窗口全局；chatId/characterId 等身份信息来源） */
function stContext(): any | undefined {
  try {
    const host = getHost();
    const st = host.SillyTavern ?? (window as any).SillyTavern;
    return st?.getContext?.();
  } catch {
    return undefined;
  }
}

/** 当前聊天的稳定身份（localStorage 兜底键用——否则所有聊天共用一个键会互相串数据） */
function chatIdentity(): string {
  try {
    const ctx = stContext();
    const id = ctx?.chatId;
    if (id !== undefined && id !== null && `${id}` !== '') return `chat:${id}`;
    // 老版本 ST 无 chatId：用角色名兜底（至少不同角色卡之间不串）
    const name = ctx?.name ?? ctx?.characterId;
    if (name !== undefined && name !== null && `${name}` !== '') return `chr:${name}`;
  } catch {
    /* 跨域等异常 */
  }
  return 'default';
}

/** 当前角色卡身份（character 作用域用） */
function characterIdentity(): string {
  try {
    const ctx = stContext();
    const charId = ctx?.characterId;
    const avatar = typeof charId === 'number' ? ctx?.characters?.[charId]?.avatar : undefined;
    if (avatar) return `av:${avatar}`;
    if (ctx?.name) return `nm:${ctx.name}`;
  } catch {
    /* 同上 */
  }
  return 'default';
}

function scopeIdentity(scope: SaveScope): string {
  return scope === 'character' ? characterIdentity() : chatIdentity();
}

/** 事件绑定：SillyTavern 核心 eventSource 优先，TavernHelper 桥兜底。
 *  返回是否至少有一条订阅成功。 */
function bindEvent(
  kind: 'MESSAGE_RECEIVED' | 'MESSAGE_SENT' | 'CHAT_CHANGED' | 'GENERATION_ENDED' | 'GENERATION_STOPPED',
  handler: (...a: unknown[]) => void,
): boolean {
  let bound = false;
  // ① SillyTavern 核心：主窗口 eventSource + event_types（消息/聊天事件最可靠的来源）。
  //    老宿主可能不挂 window 全局，补 getContext() 取法。
  try {
    const host = getHost();
    const ctx = stContext();
    const source = host?.eventSource ?? ctx?.eventSource;
    const types = host?.event_types ?? ctx?.event_types;
    const evName = types?.[kind];
    if (typeof source?.on === 'function' && typeof evName === 'string') {
      source.on(evName, handler);
      bound = true;
    }
  } catch {
    /* 核心 API 不可用 */
  }
  // ② TavernHelper 事件桥：主窗口 TavernHelper 只可靠暴露 _bind._eventOn，
  //    且必须绑定到本窗口（PROJECT 坑#1），裸 eventOn 仅作最后兜底
  try {
    const w = window as any;
    const p = getHost();
    const th = w.TavernHelper ?? p.TavernHelper;
    const ev = th?.tavern_events?.[kind] ?? p.tavern_events?.[kind] ?? w.tavern_events?.[kind];
    if (ev === undefined) return bound;
    const bindEventOn =
      typeof th?._bind?._eventOn === 'function'
        ? (e: string, cb: (...a: unknown[]) => void) => th._bind._eventOn.call(w, e, cb)
        : undefined;
    const eventOn = bindEventOn ?? th?.eventOn ?? p.eventOn;
    if (typeof eventOn === 'function') {
      eventOn(ev as string, handler);
      bound = true;
    }
  } catch {
    /* TH 桥不可用 */
  }
  return bound;
}

/** 文本指纹：避免存整条消息（只需判断「变没变」） */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${h >>> 0}`;
}

/** AI 是否正在生成（SillyTavern 公开上下文标志）。读取失败视为未生成，保持旧行为。 */
function generationActive(): boolean {
  try {
    return stContext()?.generation_started === true;
  } catch {
    return false;
  }
}

export interface TavernAdapter {
  /** 是否运行在酒馆助手环境中 */
  inTavern: boolean;
  /** 读取持久数据（按作用域） */
  load<T>(key: string, scope?: SaveScope): T | undefined;
  /** 写入持久数据（按作用域） */
  save(key: string, value: unknown, scope?: SaveScope): SaveReceipt;
  identity(): string;
  namespace(): string | undefined;
  getEnvelope(messageId?: number): Promise<MessageEnvelope | undefined>;
  subscribe(kind: string, handler: (...args: unknown[]) => void): { available: boolean; stop(): void };
  /** 把结算/状态文本以 user 楼层发送给 AI（触发生成）；降级：插入 user 消息 → 复制到剪贴板 */
  sendAsUser(text: string, options?: { deliveryId?: string }): Promise<DeliveryReceipt>;
  /** 读取最新一条消息内容（待审队列扫描用）；不可用返回 undefined */
  getLastMessage(): Promise<string | undefined>;
  /** AI 是否正在生成（流式输出未定稿时为 true；用于避免扫到半截标签） */
  isGenerating(): boolean;
  /** 订阅新消息事件（自动扫描待审标签）；事件不可用时由内部轮询兜底；永不返回 undefined */
  onMessageReceived(cb: () => void): () => void;
  /** 订阅聊天/角色卡切换事件（存档隔离同步）；事件不可用时由内部轮询兜底 */
  onChatChanged(cb: () => void): () => void;
  /** 玩家点击发送 / 用户消息事件（`MESSAGE_SENT`）；事件不可用时由轮询兜底 */
  onUserMessage(cb: () => void): () => void;
  /** 静默注入：把扩展提示词挂进当前上下文（生成前 AI 可见）。
   *  need 检测 setExtensionPrompt/addExtensionPrompt 存在才生效；返回是否实际注入。
   *  prompts: [{id, content}]，每次调用全量替换，防叠加。 */
  injectPrompts(prompts: { id: string; content: string }[]): boolean;
  /** 仅供相关性筛选，不是可执行指令；同步读取最近消息，不发送请求。 */
  recentPromptText?(): string;
  /** 移除指定 id 的注入；无该 id 时静默。 */
  uninjectPrompts(id: string): void;
}

function lsKey(key: string, scope: SaveScope): string {
  // localStorage 键必须带上聊天/角色身份——否则切聊天后旧数据从兜底键里「复活」串进新聊天
  return `${LS_PREFIX}${scope}:${scopeIdentity(scope)}:${key}`;
}

/** 旧版兜底键（无身份隔离，跨聊天共用——正是串数据的来源）。读取时一次性迁移后删除。 */
function legacyLsKey(key: string, scope: SaveScope): string {
  return `${LS_PREFIX}${scope}:${key}`;
}

export function createAdapter(): TavernAdapter {
  const th = getTH();
  const inTavern = !!th?.getVariables;

  // ---------- 轮询兜底与去抖 ----------
  // 事件可能三路触发（ST 核心 / TH 桥 / 轮询），同一信号在短窗口内只放行一次
  const msgCbs = new Set<() => void>();
  const chatCbs = new Set<() => void>();
  const userMsgCbs = new Set<() => void>();
  let lastMsgFp: string | null = null;
  let lastIdentity: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastMsgFire = 0;
  let lastChatFire = 0;

  function fireUserMessage(): void {
    for (const cb of userMsgCbs) cb();
  }

  function fireMessages(): void {
    const now = Date.now();
    if (now - lastMsgFire < 300) return;
    lastMsgFire = now;
    for (const cb of msgCbs) cb();
  }

  function fireChatChanged(): void {
    const now = Date.now();
    if (now - lastChatFire < 500) return;
    lastChatFire = now;
    lastMsgFp = null; // 切换聊天：重置消息指纹基线，避免误扫旧聊天消息
    lastIdentity = chatIdentity();
    for (const cb of chatCbs) cb();
  }

  async function pollOnce(getLastMessage: () => Promise<string | undefined>): Promise<void> {
    // 聊天身份变化 → 触发切换回调
    const identity = chatIdentity();
    if (lastIdentity !== null && identity !== lastIdentity) fireChatChanged();
    lastIdentity = identity;
    if (!msgCbs.size) return;
    // 生成进行中：流式文本在变但还没定稿——不更新指纹基线、不触发。
    // 基线保持为「生成前的上一条消息」，生成结束后首个周期指纹必然不同 → 必扫一次完整文本。
    if (generationActive()) return;
    const text = await getLastMessage();
    if (text === undefined) return;
    const fp = fingerprint(text);
    if (lastMsgFp === null) {
      lastMsgFp = fp; // 首次只记录基线，不触发（面板刚打开不去翻旧消息）
      return;
    }
    if (fp !== lastMsgFp) {
      lastMsgFp = fp;
      fireMessages();
    }
  }

  function ensurePolling(getLastMessage: () => Promise<string | undefined>): void {
    if (pollTimer !== undefined || !inTavern) return;
    pollTimer = setInterval(() => {
      void pollOnce(getLastMessage).catch(() => undefined);
    }, 1500);
  }

  const self: TavernAdapter = {
    inTavern,
    identity: chatIdentity,
    namespace(): string | undefined {
      const ctx = stContext();
      if (ctx?.groupId !== undefined && ctx.groupId !== null) return undefined;
      const characterId = ctx?.characters?.[ctx?.characterId]?.avatar ?? th?.getCurrentCharacterId?.();
      const chatId = ctx?.chatId;
      if (characterId === undefined || chatId === undefined || chatId === null || !String(chatId)) return undefined;
      return namespaceOf({ characterId: String(characterId), chatId: String(chatId), branchId: String(ctx?.branchId ?? chatId) });
    },
    async getEnvelope(messageId = -1): Promise<MessageEnvelope | undefined> {
      const identity = self.identity(); const ns = self.namespace();
      try {
        const messages: unknown = await th?.getChatMessages?.(messageId, { include_swipes: true });
        if (identity !== self.identity() || ns !== self.namespace()) return undefined;
        const raw: unknown = Array.isArray(messages) ? messages.at(-1) : messages;
        if (!raw || typeof raw !== 'object') return undefined;
        const msg = raw as Record<string, unknown>;
        const rawIndex = msg.message_id ?? msg.messageId;
        const parsedIndex = typeof rawIndex === 'string' && /^\d+$/.test(rawIndex) ? Number(rawIndex) : rawIndex;
        const index = typeof parsedIndex === 'number' && Number.isSafeInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : undefined;
        const ctx = stContext();
        const native = index !== undefined ? ctx?.chat?.[index] : undefined;
        const rawSwipe = msg.swipe_id ?? native?.swipe_id;
        const parsedSwipe = typeof rawSwipe === 'string' && /^\d+$/.test(rawSwipe) ? Number(rawSwipe) : rawSwipe;
        const swipe = typeof parsedSwipe === 'number' && Number.isSafeInteger(parsedSwipe) && parsedSwipe >= 0 ? parsedSwipe : undefined;
        const text = Array.isArray(msg.swipes) && typeof swipe === 'number' ? msg.swipes[swipe] : msg.message;
        if (typeof text !== 'string') return undefined;
        const role = msg.role === 'assistant' || msg.role === 'user' || msg.role === 'system' ? msg.role : 'unknown';
        const parts: string[] = ns ? JSON.parse(ns) as string[] : ['', self.identity(), ''];
        return {
          characterId: parts[0]!, chatId: parts[1]!, branchId: parts[2]!,
          messageId: index !== undefined ? String(index) : '', swipeId: String(swipe ?? ''), role, text,
          // 不把 GENERATION_ENDED 本身当成功；必须有宿主消息完成时间且无错误/隐藏状态。
          complete: !self.isGenerating() && !!(native?.gen_finished || msg.gen_finished) && !native?.extra?.error && !(msg.extra && typeof msg.extra === 'object' && (msg.extra as Record<string, unknown>).error) && msg.is_hidden !== true,
        };
      } catch { return undefined; }
    },
    subscribe(kind: string, handler: (...args: unknown[]) => void) {
      const host = getHost(); const ctx = stContext();
      const source = host.eventSource ?? ctx?.eventSource;
      const types = host.event_types ?? ctx?.event_types;
      let active = true;
      const wrapped = (...args: unknown[]) => { if (active) handler(...args); };
      try {
        if (source?.on && typeof types?.[kind] === 'string') {
          source.on(types[kind], wrapped);
          return { available: true, stop: () => { active = false; source.off?.(types[kind], wrapped); } };
        }
        const event = th?.tavern_events?.[kind] ?? host.tavern_events?.[kind];
        if (event !== undefined && th?._bind?._eventOn) {
          const binding = th._bind._eventOn.call(window, event, wrapped);
          return { available: true, stop: () => { active = false; binding?.stop?.(); } };
        }
      } catch { /* 明确报告能力缺失 */ }
      return { available: false, stop: () => { active = false; } };
    },

    load<T>(key: string, scope: SaveScope = 'chat'): T | undefined {
      let hostValue: T | undefined;
      if (inTavern) {
        try {
          const vars = th.getVariables({ type: scope });
          if (vars && vars[key] !== undefined) hostValue = vars[key] as T;
          // 酒馆变量为空：回退到 localStorage 镜像（键已按聊天/角色隔离，不会串数据）
        } catch {
          /* 落到 localStorage */
        }
      }
      try {
        const raw = localStorage.getItem(lsKey(key, scope));
        if (raw) {
          const localValue = JSON.parse(decodeSave(raw)) as T;
          const revision = (value: unknown): number => Number((value as { __tbSaveRevision?: number } | undefined)?.__tbSaveRevision ?? 0);
          return JSON.parse(JSON.stringify(!hostValue || revision(localValue) > revision(hostValue) ? localValue : hostValue)) as T;
        }
      } catch {
        // 镜像不可读仍可使用宿主确认值；未知来源的旧全局键留待显式迁移。
      }
      return hostValue === undefined ? undefined : JSON.parse(JSON.stringify(hostValue)) as T;
    },

    save(key: string, value: unknown, scope: SaveScope = 'chat'): SaveReceipt {
      let host = false;
      let local = false;
      const errors: string[] = [];
      const previous = self.load<{ __tbSaveRevision?: number }>(key, scope);
      const payload: unknown = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value, __tbSaveRevision: Math.max(Date.now(), (previous?.__tbSaveRevision ?? 0) + 1) }
        : value;
      let serialized: string;
      try { serialized = JSON.stringify(payload); }
      catch (error) { return { status: 'failed', host, local, error: String(error) }; }
      if (inTavern) {
        try {
          const result: unknown = typeof th.insertOrAssignVariables === 'function'
            ? th.insertOrAssignVariables({ [key]: JSON.parse(serialized) }, { type: scope })
            : typeof th.replaceVariables === 'function'
              ? th.replaceVariables({ ...th.getVariables({ type: scope }), [key]: JSON.parse(serialized) }, { type: scope })
              : th.setVariables({ type: scope, [key]: JSON.parse(serialized) });
          // 异步宿主没有同步确认时，只能标记本地保存，不能声称已同步宿主。
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => undefined);
          }
          // Promise返回值不等于失败：部分宿主先同步更新变量，再异步落盘。
          host = JSON.stringify(th.getVariables({ type: scope })?.[key]) === serialized;
          if (!host) errors.push('酒馆未确认保存');
        } catch (error) {
          errors.push(`酒馆保存失败：${String(error)}`);
        }
      }
      try {
        const targetKey = lsKey(key, scope);
        const packed = encodeSave(serialized);
        try { localStorage.setItem(targetKey, packed); }
        catch (error) {
          if (!(error instanceof DOMException && error.name === 'QuotaExceededError') && !/quota/i.test(String(error))) throw error;
          compactLocalMirrors(localStorage, targetKey);
          localStorage.setItem(targetKey, packed);
        }
        const stored = localStorage.getItem(targetKey);
        local = stored !== null && decodeSave(stored) === serialized;
        if (!local) errors.push('本地存储未确认保存');
      } catch (error) {
        errors.push(`本地保存失败：${String(error)}`);
      }
      return { status: host || (!inTavern && local) ? 'saved' : local ? 'local-only' : 'failed', host, local, ...(errors.length ? { error: errors.join('；') } : {}) };
    },

    async sendAsUser(text: string): Promise<DeliveryReceipt> {
      if (inTavern) {
        // ① TavernHelper 原生 API：以 user 身份发送并触发生成（最干净）
        try {
          if (typeof th.sendMessageAsUser === 'function') {
            const result: unknown = await th.sendMessageAsUser(text);
            return result === false ? { status: 'failed', detail: '酒馆拒绝发送' } : { status: 'sent' };
          }
        } catch (error) {
          // 调用可能已经送达；不能再点 DOM 或创建第二条消息。用户草稿始终不被触碰。
          return { status: 'unknown', detail: String(error) };
        }
        // ③ 兜底：插入一条 user 楼层（不触发生成，AI 下一轮仍能看到）
        try {
          if (th.createChatMessages) {
            const result: unknown = await th.createChatMessages([{ role: 'user', message: text }]);
            return result === false ? { status: 'failed' } : { status: 'inserted' };
          }
        } catch (error) {
          return { status: 'unknown', detail: String(error) };
        }
      }
      return { status: await copyToClipboard(text) ? 'copied' : 'failed' };
    },

    async getLastMessage(): Promise<string | undefined> {
      if (!inTavern) return undefined;
      // 三层递降：任何一层成功即返回；一层失败（抛错/非字符串）必须落到下一层而非提前放弃
      // ① TavernHelper API
      try {
        if (th.getChatMessages) {
          const r = await th.getChatMessages(-1);
          const arr = Array.isArray(r) ? r : [r];
          const last = arr[arr.length - 1] as any;
          const content =
            typeof last === 'string' ? last : (last?.message ?? last?.content ?? last?.mes);
          if (typeof content === 'string') return content;
        }
      } catch {
        /* 落到 th.chat */
      }
      // ② TavernHelper chat 数组
      try {
        if (th.chat && Array.isArray(th.chat)) {
          const last = th.chat[th.chat.length - 1] as any;
          const content = last?.mes ?? last?.message ?? last?.content;
          if (typeof content === 'string') return content;
        }
      } catch {
        /* 落到主窗口 */
      }
      // ③ 主窗口 SillyTavern chat 数组（同源可访问）
      try {
        const host = getHost();
        const chat = host?.SillyTavern?.getContext?.()?.chat;
        if (Array.isArray(chat) && chat.length) {
          const content = chat[chat.length - 1]?.mes ?? chat[chat.length - 1]?.message;
          if (typeof content === 'string') return content;
        }
      } catch {
        /* 降级：返回 undefined，由面板提示手动操作 */
      }
      return undefined;
    },

    isGenerating(): boolean {
      return generationActive();
    },

    onMessageReceived(cb: () => void): () => void {
      msgCbs.add(cb);
      // 事件订阅（核心 eventSource + TH 桥，内部去抖）；即使全部失败，轮询也会兜底触发。
      // MESSAGE_RECEIVED 是「消息入档」信号；GENERATION_ENDED/STOPPED 才是「输出完毕/中止」的
      // 权威信号（流式场景下 MESSAGE_RECEIVED 可能早于文本定稿），三类都绑、去抖合并。
      bindEvent('MESSAGE_RECEIVED', () => fireMessages());
      bindEvent('GENERATION_ENDED', () => fireMessages());
      bindEvent('GENERATION_STOPPED', () => fireMessages());
      ensurePolling(() => self.getLastMessage());
      return () => {
        msgCbs.delete(cb);
      };
    },

    onChatChanged(cb: () => void): () => void {
      chatCbs.add(cb);
      bindEvent('CHAT_CHANGED', () => fireChatChanged());
      ensurePolling(() => self.getLastMessage());
      return () => {
        chatCbs.delete(cb);
      };
    },

    onUserMessage(cb: () => void): () => void {
      userMsgCbs.add(cb);
      // 玩家点击发送即 `MESSAGE_SENT`（生成前）；核心/桥事件优先，轮询兜底在 pollOnce 内无法区分 user/AI，
      // 因此这里仅绑定事件，轮询留给 onMessageReceived 的自动扫描。
      bindEvent('MESSAGE_SENT', () => fireUserMessage());
      return () => {
        userMsgCbs.delete(cb);
      };
    },

    recentPromptText(): string {
      const chat = stContext()?.chat;
      if (!Array.isArray(chat)) return '';
      return chat.slice(-3).flatMap((value: unknown) => {
        if (!value || typeof value !== 'object') return [];
        const m = value as { is_system?: boolean; is_hidden?: boolean; mes?: unknown };
        return !m.is_system && !m.is_hidden && typeof m.mes === 'string' ? [m.mes.replace(/<tb>[\s\S]*?(?:<\/tb>|$)/gi, '').slice(-1600)] : [];
      }).join('\n');
    },
    injectPrompts(prompts: { id: string; content: string }[]): boolean {
      if (!inTavern) return false;
      try {
        // SillyTavern 扩展提示 API：setExtensionPrompt (新版) / addExtensionPrompt (旧版)。
        // 取主窗口 SillyTavern.getContext()，检测存在才注入。
        const hostCtx = stContext();
        const set = hostCtx?.setExtensionPrompt;
        const add = hostCtx?.addExtensionPrompt;
        if (typeof set === 'function') {
          for (const p of prompts) set(p.id, p.content, 1 /* in-chat */, 0 /* 最末 */, false /* 不触发世界书递归 */, 0 /* system */);
          return true;
        }
        if (typeof add === 'function') {
          for (const p of prompts) add(p.id, p.content, 1, 0, false, 0);
          return true;
        }
      } catch {
        /* 宿主不支持则视为未注入 */
      }
      return false;
    },

    uninjectPrompts(id: string): void {
      if (!inTavern) return;
      try {
        const hostCtx = stContext();
        const set = hostCtx?.setExtensionPrompt;
        if (typeof set === 'function') {
          // 现行宿主将value转为String；null会变成字面文本，空串才是无注入。
          set(id, '', 1, 0, false, 0);
          return;
        }
        const remove = hostCtx?.removeExtensionPrompt;
        if (typeof remove === 'function') remove(id);
      } catch {
        /* 忽略 */
      }
    },
  };

  return self;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
