import { connectionUrl, fetchJevModels, directJevRequest, jevJsonRequest, JevConnectionError, type JevConnection } from './jev-connection.js';
import { JevTransportError } from './jev-transport.js';
import { retryJev, waitForJev, JevRequestTimeoutError, JevRetriesExhausted, JEV_MAX_RETRIES, JEV_RETRY_DELAY_MS, JEV_REQUEST_BUDGET_MS, JEV_ATTEMPT_TIMEOUT_MS } from './jev-retry.js';
export { connectionUrl, readJevConnection, saveJevConnection, type JevConnection } from './jev-connection.js';
import { SmallBattle, MassBattle, type Order } from "../../engine/src/index.js";
import {
  CommandRuntime,
  validateCheckpoint,
  validateContextSelectionAnswer,
  validateNarrativeContext,
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

function failureReason(error: unknown): string {
  if (error instanceof JevRetriesExhausted) error = error.cause;
  // Only local diagnostic text is safe to persist; never echo remote bodies or parser errors.
  return error instanceof JevConnectionError || error instanceof JevTransportError || error instanceof JevRequestTimeoutError
    ? error.message : '模型请求或返回格式无效，请检查连接与协议';
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
  private retry<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, check: () => void, onStatus?: () => void): Promise<T> {
    const detail = this.detail;
    return retryJev(operation, {
      signal, check,
      onRetry: retry => {
        this.detail = `JEV 正在重试 ${retry}/${JEV_MAX_RETRIES}，1 秒后发起请求，可随时暂停`;
        onStatus?.();
      },
    }).then(value => {
      this.detail = detail;
      onStatus?.();
      return value;
    });
  }
  private async resolveContext(
    input: EncounterContextInput,
    connection: JevConnection,
    signal: AbortSignal,
    beforeRequest: () => void = () => {},
    check: () => void = () => signal.throwIfAborted(),
    onStatus?: () => void,
  ): Promise<JevEncounterContext> {
    const { base, request } = encounterRequest(input);
    if (!request) return base;
    try {
      beforeRequest();
      return await this.retry(async attemptSignal => {
        const answer = await this.post<import("../../vendor/jev-core/src/index.js").ContextSelectionAnswer>(
          connection, "select-context", request, attemptSignal,
        );
        return applyEncounterSelection(input, base, request, answer);
      }, signal, check, onStatus);
    } catch (error) {
      check();
      if (signal.aborted) throw error;
      base.detail = `上下文判定暂不可用（已自动重试 ${JEV_MAX_RETRIES} 次）：${failureReason(error)}；沿用已有配置`;
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
        undefined,
        () => {
          if (aborter.signal.aborted || !options.valid()) throw Error("JEV 准备已取消，尚未开始战斗");
        },
        options.onStatus,
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
    if (connection.protocol && connection.protocol !== "bridge")
      return await directJevRequest(connection, path, body, signal, this.request) as T;
    return await jevJsonRequest(connection, this.request,
      connectionUrl(connection.url) + "/api/bridge/" + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(connection.token ? { Authorization: "Bearer " + connection.token } : {}),
        },
        body: JSON.stringify(body), signal,
      },
    ) as T;
  }

  async models(connection: JevConnection): Promise<string[]> {
    return fetchJevModels(connection, this.request);
  }
  /** A tiny real inference checks permissions and response format without sending chat/battle data. */
  async testInference(connection: JevConnection, onStatus?: () => void): Promise<string> {
    this.cancel();
    const aborter = new AbortController();
    this.aborter = aborter;
    this.busy = true;
    this.detail = "JEV 正在测试模型推理，可随时暂停";
    onStatus?.();
    const request = {
      messages: [], state: { weather: "day" },
      fields: [{ id: "lighting", question: "Select the stated lighting.", options: { day: "Day", night: "Night" } }],
    };
    try {
      await this.retry(async signal => {
        const answer = await this.post<import("../../vendor/jev-core/src/index.js").ContextSelectionAnswer>(connection, "select-context", request, signal);
        try { validateContextSelectionAnswer(answer, request); }
        catch { throw new JevConnectionError("模型返回无效选择，请检查所选协议和模型"); }
      }, aborter.signal, () => aborter.signal.throwIfAborted(), onStatus);
      return "模型推理测试通过，已验证实际 POST 请求和返回格式";
    } catch (error) {
      if (aborter.signal.aborted) return "已取消模型推理测试";
      return `模型推理测试失败（已自动重试 ${JEV_MAX_RETRIES} 次）：${failureReason(error)}`;
    } finally {
      if (this.aborter === aborter) { this.busy = false; this.aborter = undefined; }
    }
  }
  async test(connection: JevConnection): Promise<string> {
    if (connection.protocol && connection.protocol !== 'bridge') {
      const models = await this.models(connection);
      return `连接正常，获取到 ${models.length} 个模型（尚未调用决策）`;
    }
    const meta = await jevJsonRequest(connection, this.request,
      connectionUrl(connection.url) + "/api/meta",
      {
        headers: connection.token ? { Authorization: "Bearer " + connection.token } : {},
        signal: AbortSignal.timeout(5000),
      },
    );
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
    let modelFailure = "";
    let contextFailure = "";
    const provider: DecisionProvider = {
      id: "jev-bridge",
      evaluate: async (request: DecisionRequest, signal) => {
        check();
        if (modelFailed) throw Error("本轮模型重试已结束");
        // A logical-call cap is not a connection failure. Zero confidence preserves local scores.
        if (++calls > 10) return {
          model: "local-budget", confidence: 0,
          scores: Object.fromEntries(request.candidates.map(c => [c.id, 0.5])),
        };
        try {
          const answer = await this.retry(async attemptSignal => {
            const answer = await this.post<DecisionAnswer>(
              connection,
              "evaluate",
              request,
              attemptSignal,
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
              throw new JevConnectionError("JEV 返回无效评分");
            return answer;
          }, AbortSignal.any([signal, aborter.signal]), check, options.onStatus);
          this.cooldownUntil = 0;
          return answer;
        } catch (error) {
          check();
          if (!aborter.signal.aborted) {
            modelFailed = true;
            modelFailure = failureReason(error);
            this.cooldownUntil = Date.now() + JEV_RETRY_DELAY_MS;
          }
          throw error;
        }
      },
    };
    const extractor: TextExtractor = {
      extract: async (messages, observation, signal) => {
        check();
        if (contextFailure || ++calls > 10) return [];
        try {
          return await this.retry(async attemptSignal => {
            const answer = await this.post<Awaited<ReturnType<TextExtractor['extract']>>>(
              connection, "context", { messages, observation }, attemptSignal,
            );
            try { return validateNarrativeContext(answer, observation); }
            catch { throw new JevConnectionError("模型返回无效正文目标"); }
          }, AbortSignal.any([signal, aborter.signal]), check, options.onStatus);
        } catch (error) {
          check();
          contextFailure = `正文目标提取暂不可用（已自动重试 ${JEV_MAX_RETRIES} 次）：${failureReason(error)}`;
          return [];
        }
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
      if (Date.now() < this.cooldownUntil) {
        this.detail = "JEV 将在 1 秒内重新连接，可随时暂停";
        options.onStatus?.();
        await waitForJev(this.cooldownUntil - Date.now(), aborter.signal);
        check();
        this.detail = "JEV 正在规划，可随时暂停";
        options.onStatus?.();
      }
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
          check,
          options.onStatus,
        );
        check();
      }
      if (candidate instanceof MassBattle && !options.manualScan)
        configureDrafts(candidate);
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
            // Live combat must never wait through the full 10 x 30s retry envelope.
            // One model call gets roughly one normal attempt; if it still cannot answer,
            // the JEV core falls back to its local bounded planner and the turn advances.
            requestTimeoutMs: JEV_ATTEMPT_TIMEOUT_MS + 1000,
            decisionBudgetMs: 2 * (JEV_ATTEMPT_TIMEOUT_MS + 1000) + 1000,
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
        saved.detail = `JEV 暂不可用（已自动重试 ${JEV_MAX_RETRIES} 次）：${modelFailure}；已回退原有自动 AI（1 秒后可重试）`;
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
      if (contextFailure) saved.detail += `；${contextFailure}`;
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
