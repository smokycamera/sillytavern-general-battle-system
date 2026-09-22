import { SmallBattle, MassBattle, type Order } from "../../engine/src/index.js";
import {
  CommandRuntime,
  validateCheckpoint,
  defaultEvaluator,
  NetworkExecutor,
  defaultOperators,
  type TaskExecutor,
  type Checkpoint,
  type PlanStore,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionAnswer,
  type NarrativeMessage,
  type NarrativeContextPolicy,
  type TextExtractor,
} from "../../vendor/jev-core/src/index.js";
import { TavernJevAdapter } from "./jev-adapter.js";
import {
  encounterRequest,
  applyEncounterSelection,
  normalizeContextSettings,
  type EncounterContextInput,
  type JevContextSettings,
  type JevEncounterContext,
} from "./jev-context.js";

export interface JevSettings {
  mode: "builtin" | "jev";
  ability: "novice" | "regular" | "skilled" | "expert" | "master";
  narrative: NarrativeContextPolicy;
  context: JevContextSettings;
}
export interface JevBattleState {
  battleId: string;
  version: number;
  sides: Partial<Record<"ally" | "enemy", Checkpoint>>;
  detail: string;
  hostStamp?: string;
  context?: JevEncounterContext;
}
/** Change detector only; the actual commit guard uses the host revision and chat generation. */
function battleStamp(battle: SmallBattle | MassBattle): string {
  const text = JSON.stringify(battle.toSnapshot());
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export interface JevConnection {
  url: string;
  token: string;
}
export const defaultJevSettings = (): JevSettings => ({
  mode: "builtin",
  ability: "skilled",
  context: normalizeContextSettings(),
  narrative: {
    windowSize: 6,
    roles: ["assistant"],
    trigger: ["battle-start", "message-change", "manual"],
    mode: "off",
  },
});
export function normalizeJevSettings(
  value?: Partial<JevSettings>,
): JevSettings {
  const defaults = defaultJevSettings();
  const n = value?.narrative;
  return {
    mode: value?.mode === "jev" ? "jev" : "builtin",
    ability: ["novice", "regular", "skilled", "expert", "master"].includes(
      value?.ability ?? "",
    )
      ? value!.ability!
      : defaults.ability,
    context: normalizeContextSettings(
      value?.context,
      value?.ability ?? defaults.ability,
    ),
    narrative:
      n &&
      ["auto", "manual", "off"].includes(n.mode) &&
      Number.isInteger(n.windowSize) &&
      n.windowSize >= 0 &&
      n.windowSize <= 100 &&
      Array.isArray(n.roles) &&
      n.roles.every((r) => typeof r === "string") &&
      Array.isArray(n.trigger) &&
      n.trigger.every((t) =>
        ["battle-start", "message-change", "decision", "manual"].includes(t),
      )
        ? structuredClone(n)
        : defaults.narrative,
  };
}
export function connectionUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("请输入完整的 HTTP 服务地址");
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw Error("远程 JEV 服务请使用 HTTPS");
  return url.href.replace(/\/$/, "");
}
export function readJevConnection(): JevConnection {
  try {
    return {
      url: connectionUrl(
        localStorage.getItem("tb:jev:url") ?? "http://127.0.0.1:4317",
      ),
      token: sessionStorage.getItem("tb:jev:token") ?? "",
    };
  } catch {
    return { url: "http://127.0.0.1:4317", token: "" };
  }
}
export function saveJevConnection(connection: JevConnection): void {
  localStorage.setItem("tb:jev:url", connectionUrl(connection.url));
  sessionStorage.setItem("tb:jev:token", connection.token.trim());
}
class CandidateStore implements PlanStore {
  constructor(private current: Checkpoint | null) {}
  async load(): Promise<Checkpoint | null> {
    return structuredClone(this.current);
  }
  async save(checkpoint: Checkpoint, revision: number): Promise<void> {
    validateCheckpoint(checkpoint);
    if ((this.current?.revision ?? 0) !== revision)
      throw Error("JEV 计划版本冲突");
    this.current = structuredClone(checkpoint);
  }
}
/** Tavern support policy lives here; the core knows only generic executor options. */
function tavernTaskExecutor(): TaskExecutor {
  const network = new NetworkExecutor(defaultOperators());
  return {
    update: (...args) => network.update(...args),
    options: (action, ...args) =>
      action.kind === "support"
        ? [{ score: 0 }]
        : network.options(action, ...args),
  };
}

export class JevCommandController {
  private aborter?: AbortController;
  private cooldownUntil = 0;
  private connectionKey = "";
  busy = false;
  detail = "";
  // Keep the browser fetch receiver; calling a stored window.fetch as this.request is illegal in WebView.
  constructor(
    private request: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  cancel(): void {
    this.aborter?.abort();
  }
  private async resolveContext(
    input: EncounterContextInput,
    connection: JevConnection,
    signal: AbortSignal,
    beforeRequest: () => void = () => {},
  ): Promise<JevEncounterContext> {
    const { base, request } = encounterRequest(input);
    if (!request) return base;
    try {
      beforeRequest();
      const answer = await this.post<
        import("../../vendor/jev-core/src/index.js").ContextSelectionAnswer
      >(
        connection,
        "select-context",
        request,
        AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      );
      return applyEncounterSelection(input, base, request, answer);
    } catch (error) {
      if (signal.aborted) throw error;
      base.detail =
        "上下文判定暂不可用，沿用已有配置；可检查 JEV 服务版本与连接";
      return base;
    }
  }
  async prepareEncounter(
    input: EncounterContextInput,
    connection: JevConnection,
    options: { valid(): boolean; onStatus?(): void },
  ): Promise<JevEncounterContext> {
    this.cancel();
    const aborter = new AbortController();
    this.aborter = aborter;
    this.busy = true;
    this.detail = "JEV 正在选择敌方指挥与战场，可随时暂停";
    options.onStatus?.();
    try {
      if (!options.valid()) throw Error("准备信息已改变，请重新开始");
      const result = await this.resolveContext(
        input,
        connection,
        aborter.signal,
      );
      if (aborter.signal.aborted || !options.valid())
        throw Error("JEV 准备已取消，尚未开始战斗");
      return result;
    } finally {
      if (this.aborter === aborter) {
        this.aborter = undefined;
        this.busy = false;
      }
    }
  }
  private async post<T>(
    connection: JevConnection,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const response = await this.request(
      connectionUrl(connection.url) + "/api/bridge/" + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(connection.token
            ? { Authorization: "Bearer " + connection.token }
            : {}),
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!response.ok) throw Error("JEV 服务返回 " + response.status);
    return (await response.json()) as T;
  }
  async test(connection: JevConnection): Promise<string> {
    const response = await this.request(
      connectionUrl(connection.url) + "/api/meta",
      {
        headers: connection.token
          ? { Authorization: "Bearer " + connection.token }
          : {},
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw Error("连接失败：HTTP " + response.status);
    const meta = await response.json();
    if (meta.bridge?.protocol !== 1)
      throw Error("请更新 JEV 服务以支持酒馆接入");
    return meta.provider === "local"
      ? "服务可达，尚未配置 JEV 模型密钥"
      : "JEV 服务连接正常" +
          (meta.bridge.selection
            ? "，开战上下文选择可用"
            : "，请更新服务以启用开战上下文选择") +
          (meta.bridge.context ? "，正文提取可用" : "，正文提取尚未配置");
  }
  /** A cancelled/stale candidate never touches the caller's battle or checkpoint. */
  async prepare(
    battle: SmallBattle | MassBattle,
    previous: JevBattleState | undefined,
    settings: JevSettings,
    connection: JevConnection,
    options: {
      battleId: string;
      namespace: string;
      valid(): boolean;
      messages?: NarrativeMessage[];
      manualScan?: boolean;
      drafts?: Order[];
      automatic?: boolean;
      summonUnit?: NonNullable<
        Parameters<typeof SmallBattle.fromSnapshot>[1]
      >["summonUnit"];
      onStatus?: () => void;
    },
  ): Promise<{ battle: SmallBattle | MassBattle; state: JevBattleState }> {
    this.cancel();
    const aborter = new AbortController();
    this.aborter = aborter;
    this.busy = true;
    const check = () => {
      if (aborter.signal.aborted || !options.valid())
        throw Error("JEV 指挥已取消，战场未改变");
    };
    const copy = () =>
      battle instanceof SmallBattle
        ? SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()), {
            traitRegistry: battle.traitRegistry,
            summonUnit: options.summonUnit,
          })
        : MassBattle.fromSnapshot(structuredClone(battle.toSnapshot()), {
            traitRegistry: battle.traitRegistry,
            summonUnit: options.summonUnit,
          });
    let candidate = copy();
    const saved: JevBattleState =
      previous?.battleId === options.battleId
        ? structuredClone(previous)
        : { battleId: options.battleId, version: 0, sides: {}, detail: "" };
    if (saved.hostStamp && saved.hostStamp !== battleStamp(battle)) {
      saved.sides = {};
      saved.version++;
    }
    const session = JSON.stringify([options.namespace, options.battleId]);
    const key = JSON.stringify(connection);
    if (key !== this.connectionKey) {
      this.cooldownUntil = 0;
      this.connectionKey = key;
    }
    let modelFailed = false,
      calls = 0;
    const provider: DecisionProvider = {
      id: "jev-bridge",
      evaluate: async (request: DecisionRequest, signal) => {
        check();
        if (++calls > 10 || Date.now() < this.cooldownUntil) {
          modelFailed = true;
          throw Error("JEV 调用预算或冷却中");
        }
        try {
          const answer = await this.post<DecisionAnswer>(
            connection,
            "evaluate",
            request,
            AbortSignal.any([signal, aborter.signal]),
          );
          if (
            !answer ||
            typeof answer.model !== "string" ||
            !Number.isFinite(answer.confidence) ||
            answer.confidence < 0 ||
            answer.confidence > 1 ||
            request.candidates.some(
              (c) =>
                !Number.isFinite(answer.scores?.[c.id]) ||
                answer.scores[c.id]! < 0 ||
                answer.scores[c.id]! > 1,
            )
          )
            throw Error("JEV 返回无效评分");
          return answer;
        } catch (error) {
          if (!aborter.signal.aborted) {
            modelFailed = true;
            this.cooldownUntil = Date.now() + 30000;
          }
          throw error;
        }
      },
    };
    const extractor: TextExtractor = {
      extract: async (messages, observation, signal) => {
        check();
        if (++calls > 10) return [];
        return this.post(
          connection,
          "context",
          { messages, observation },
          AbortSignal.any([signal, aborter.signal]),
        );
      },
    };
    const configureDrafts = (b: MassBattle) => {
      if (options.automatic && options.drafts?.length)
        throw Error("当前由系统指挥；请先取消尚未提交的草案");
      if (options.drafts?.some((o) => b.byId(o.unitId).side !== "ally"))
        throw Error("草案包含非我方单位");
      const result = b.replaceOrders(options.drafts ?? [], b.round);
      if (!result.ok) throw Error(result.reason);
    };
    try {
      this.detail = "JEV 正在规划，可随时暂停";
      options.onStatus?.();
      check();
      if (
        settings.context?.enemy === "auto" ||
        settings.context?.enemy === "manual"
      ) {
        const tags = candidate.fieldTags;
        saved.context = await this.resolveContext(
          {
            roster: candidate.combatants,
            settings: settings.context,
            setup: saved.context ?? {
              mode: candidate instanceof SmallBattle ? "small" : "mass",
              field:
                tags.find((t) =>
                  ["plains", "urban", "siege", "forest", "mountain"].includes(
                    t,
                  ),
                ) ?? "plains",
              lighting: tags.includes("night") ? "night" : "day",
              mapLayout:
                candidate instanceof SmallBattle &&
                candidate.battlefield?.width === 5
                  ? "indoor"
                  : "standard",
              objectiveMode: "auto",
              siegeAttacker: "ally",
            },
            messages: options.messages ?? [],
            windowSize: settings.narrative.windowSize,
            roles: settings.narrative.roles,
            phase: "battle",
            previous: saved.context,
            force: options.manualScan,
          },
          connection,
          aborter.signal,
          () => {
            calls++;
          },
        );
        check();
      }
      if (candidate instanceof MassBattle && !options.manualScan)
        configureDrafts(candidate);
      if (Date.now() < this.cooldownUntil) modelFailed = true;
      const sides: ("ally" | "enemy")[] =
        candidate instanceof SmallBattle
          ? candidate.active?.side === "neutral" || !candidate.active
            ? []
            : [candidate.active.side]
          : ["ally", "enemy"];
      for (const side of sides) {
        if (modelFailed) break;
        const adapter = new TavernJevAdapter(
          candidate,
          side,
          session + ":" + side,
          saved.version,
          aborter.signal,
        );
        const observation = await adapter.observe();
        const commanders = adapter.commanders(
          side === "enemy"
            ? (saved.context?.enemy.ability ?? settings.ability)
            : settings.ability,
          side === "ally" && battle.allyTactic === "defensive"
            ? { hold: 85, risk: 20 }
            : side === "ally" && battle.allyTactic === "aggressive"
              ? { initiative: 85, risk: 80 }
              : side === "enemy"
                ? (saved.context?.enemy.style ?? {})
                : {},
        );
        if (!commanders[0]?.unitIds.length) continue;
        let checkpoint = saved.sides[side] ?? null;
        if (checkpoint) {
          validateCheckpoint(checkpoint);
          if (
            checkpoint.sessionId !== observation.sessionId ||
            checkpoint.pending
          )
            checkpoint = null;
          else {
            checkpoint.commanders = commanders;
            checkpoint.paused = false;
          }
        }
        const runtime = new CommandRuntime({
          adapter,
          commanders,
          store: new CandidateStore(checkpoint),
          goals: observation.goals,
          provider,
          narrative: { recent: async () => options.messages ?? [] },
          extractor,
          policy: {
            narrativeContext: settings.narrative,
            requestTimeoutMs: 10000,
            decisionBudgetMs: 12000,
            retries: 0,
            maxModelCallsPerDecision: 2,
            modelActionMode: "local",
          },
          taskExecutor: tavernTaskExecutor(),
          evaluators: [
            defaultEvaluator,
            {
              id: "tavern-support",
              evaluate: (a) => ({
                utility: (a.features.support ?? 0) * 15,
                risk: 0,
                continuity: 0,
              }),
            },
          ],
        });
        await runtime.initialize();
        check();
        if (options.manualScan) {
          await runtime.scanNarrative();
          check();
        } else {
          const actor =
            candidate instanceof SmallBattle ? candidate.active?.id : undefined;
          const limit =
            candidate instanceof SmallBattle
              ? 12
              : candidate.readyUnits(side).length + 1;
          for (let i = 0; i < limit; i++) {
            check();
            const current = candidate;
            if (
              current.isOver() ||
              (current instanceof SmallBattle &&
                current.active?.id !== actor) ||
              (current instanceof MassBattle &&
                !current
                  .readyUnits(side)
                  .some(
                    (u) =>
                      !current.orders.has(u.id) && !current.isAttached(u.id),
                  ))
            )
              break;
            const result = await runtime.step();
            check();
            if (result.state === "stopped") throw Error(result.detail);
            if (modelFailed || result.state === "waiting") break;
          }
        }
        checkpoint = await runtime.exportCheckpoint();
        check();
        if (checkpoint.pending) throw Error("JEV 动作尚未完成");
        checkpoint.records = []; // No duplicated observations or raw narrative in chat saves.
        checkpoint.receipts = checkpoint.receipts.slice(-32);
        checkpoint.revisions = checkpoint.revisions.slice(-32);
        const taskIds = new Set(checkpoint.plan.tasks.map((t) => t.id));
        checkpoint.progress = Object.fromEntries(
          Object.entries(checkpoint.progress).filter(([id]) => taskIds.has(id)),
        );
        saved.sides[side] = checkpoint;
        saved.version = adapter.stateVersion;
        const tactic = checkpoint.plan.tasks.find((t) => t.level === "tactics");
        saved.detail = `${side === "ally" ? "我方" : "敌方"}：${tactic ? runtime.doctrines.get(tactic.doctrineId).label : "等待行动"}`;
        const selection = checkpoint.lastModelSelection;
        if (tactic?.target?.kind === "search") saved.detail += "（搜索接触中）";
        else if (
          selection?.purpose === "doctrine" &&
          selection.selectedId === tactic?.doctrineId
        )
          saved.detail +=
            selection.confidence === 0
              ? "（本地规划）"
              : selection.selectedId === selection.localId
                ? "（模型维持方案）"
                : "（模型调整方案）";
      }
      check();
      if (modelFailed) {
        candidate = copy();
        saved.sides = {};
        saved.version++;
        if (candidate instanceof MassBattle && !options.manualScan)
          configureDrafts(candidate);
        saved.detail = "JEV 暂不可用，已回退原有自动 AI（30 秒后重试）";
      }
      if (!options.manualScan) {
        if (candidate instanceof SmallBattle) {
          if (
            !candidate.isOver() &&
            candidate.active?.id === (battle as SmallBattle).active?.id
          ) {
            if (candidate.active?.side === "neutral") candidate.endTurn();
            else if (candidate.active)
              candidate.autoAction(candidate.active.id);
          }
        } else {
          candidate.autoOrders("ally");
          candidate.autoOrders("enemy");
          candidate.resolveRound(candidate.round);
        }
      }
      check();
      this.detail = saved.detail || "JEV 行动完成";
      saved.detail = this.detail;
      saved.version++;
      saved.hostStamp = battleStamp(candidate);
      return { battle: candidate, state: saved };
    } finally {
      if (this.aborter === aborter) {
        this.busy = false;
        this.aborter = undefined;
      }
    }
  }
}
