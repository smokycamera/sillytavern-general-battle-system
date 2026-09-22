import { afterEach, describe, it, expect, vi } from "vitest";
import {
  SmallBattle,
  MassBattle,
  generateUnit,
  standardField,
  traitRegistry,
  V2_D20,
  V2_TW,
  type Combatant,
} from "../../engine/src/index.js";
import { TavernJevAdapter } from "./jev-adapter.js";
import {
  JevCommandController,
  defaultJevSettings,
  normalizeJevSettings,
  connectionUrl,
} from "./jev-command.js";
import type { DecisionRequest } from "../../vendor/jev-core/src/index.js";
const registry = traitRegistry();
function unit(id: string, side: "ally" | "enemy"): Combatant {
  const u = generateUnit(
    {
      name: id,
      side,
      scale: "hero",
      rulesVersion: "v2",
      level: 4,
      weaponClass: "rifle",
      weaponLevel: 5,
      armorTier: 1,
      hpMax: 500,
      traits: [],
    },
    { registry, seed: id, noVariance: true },
  ).unit;
  u.id = id;
  return u;
}
function small() {
  const field = standardField();
  field.tiles.fill("open");
  const b = new SmallBattle({
    combatants: [unit("a", "ally"), unit("b", "enemy")],
    battlefield: field,
    rules: V2_D20,
    seed: "jev-small",
    traitRegistry: registry,
  });
  b.start();
  b.turnOrder = ["a", "b"];
  b.turnIndex = 0;
  b.byId("a").pos = 42;
  b.byId("b").pos = 28;
  return b;
}
function mass() {
  const units = [unit("a", "ally"), unit("b", "enemy")];
  units.forEach((u) => {
    u.scale = "company";
    u.tags.push("zone:中军", "rank:front");
  });
  const b = new MassBattle({
    combatants: units,
    rules: V2_TW,
    seed: "jev-mass",
    traitRegistry: registry,
  });
  b.start();
  return b;
}
const requests: DecisionRequest[] = [];
const model: typeof fetch = async (_url, init) => {
  const r = JSON.parse(String(init?.body)) as DecisionRequest;
  requests.push(r);
  return new Response(
    JSON.stringify({
      model: "fake-jev",
      confidence: 0.9,
      scores: Object.fromEntries(r.candidates.map((c) => [c.id, 0.5])),
    }),
    { status: 200 },
  );
};
const options = () => ({
  battleId: "test-battle",
  namespace: "test-chat",
  valid: () => true,
});
const connection = { url: "http://127.0.0.1:4317", token: "service-token" };
afterEach(() => vi.useRealTimers());
describe("JEV planning latency and recovery", () => {
  it("keeps the outer decision alive through ten timed-out attempts and a successful last retry", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const controller = new JevCommandController(async (url, init) => {
      if (++calls <= 10) return new Promise<Response>(() => {});
      return model(url, init);
    });
    const pending = controller.prepare(small(), undefined, defaultJevSettings(), connection, options());
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(calls).toBeGreaterThanOrEqual(11);
    expect(result.state.detail).not.toContain("回退");
    expect(result.state.sides.ally?.lastModelSelection?.confidence).toBe(0.9);
  });
  it("accepts an 11-second model answer without silently discarding its scores", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const controller = new JevCommandController(async (url, init) => {
      seen.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 11000));
      return model(url, init);
    });
    const pending = controller.prepare(small(), undefined, defaultJevSettings(), connection, options());
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.state.detail).not.toContain("回退");
    expect(seen.length).toBeGreaterThan(0);
    expect(result.state.sides.ally?.lastModelSelection?.confidence).toBe(0.9);
    expect(result.state.sides.ally?.plan.tasks.length).toBeGreaterThan(0);
  });
  it("waits one second between ten retries, then accepts the last retry without a failure banner", async () => {
    vi.useFakeTimers();
    const seen: number[] = [], statuses: string[] = [];
    const controller = new JevCommandController(async (url, init) => {
      seen.push(Date.now());
      if (seen.length <= 10) return new Response("{}", { status: 503 });
      return model(url, init);
    });
    const battle = small(), before = battle.toSnapshot();
    const pending = controller.prepare(battle, undefined, defaultJevSettings(), connection, {
      ...options(), onStatus: () => statuses.push(controller.detail),
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(seen.length).toBeGreaterThanOrEqual(11);
    expect(seen.slice(1, 11).map((at, i) => at - seen[i]!)).toEqual(Array(10).fill(1000));
    expect(statuses.some(s => s.includes("10/10"))).toBe(true);
    expect(statuses.join(" ")).not.toMatch(/暂不可用|回退/);
    expect(result.state.detail).not.toContain("回退");
    expect(battle.toSnapshot()).toEqual(before);
    expect((result.battle as SmallBattle).active?.id).toBe("b");
  });
});
describe("optional JEV command integration", () => {
  it("old saves default to original AI and connection inputs cannot embed credentials", () => {
    expect(normalizeJevSettings().mode).toBe("builtin");
    expect(() => connectionUrl("http://secret@example.com")).toThrow();
    expect(() => connectionUrl("http://example.com")).toThrow();
    expect(connectionUrl("http://localhost:4317/")).toBe(
      "http://localhost:4317",
    );
  });
  it("legal queries do not change battle or consume dice, and duplicate receipts apply once", async () => {
    const b = small(),
      before = JSON.stringify(b.toSnapshot()),
      adapter = new TavernJevAdapter(
        b,
        "ally",
        "battle",
        0,
        new AbortController().signal,
      );
    const o = await adapter.observe(),
      actions = await adapter.legalActions(o, ["a"]);
    expect(actions.some((a) => a.kind === "attack")).toBe(true);
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    expect(await adapter.legalActions(o, ["b"])).toEqual([]);
    const envelope = {
      sessionId: "battle",
      stateVersion: 0,
      planVersion: 1,
      key: "command-one",
      action: actions.find((a) => a.kind === "attack")!,
    };
    const first = await adapter.execute(envelope),
      after = JSON.stringify(b.toSnapshot());
    expect(await adapter.execute(envelope)).toEqual(first);
    expect(JSON.stringify(b.toSnapshot())).toBe(after);
    await expect(
      adapter.execute({ ...envelope, key: "stale" }),
    ).rejects.toThrow("版本");
  });
  it("completes a small activation on a private candidate, persists side plans and resumes", async () => {
    requests.length = 0;
    const b = small(),
      before = JSON.stringify(b.toSnapshot()),
      controller = new JevCommandController(model),
      settings = { ...defaultJevSettings(), mode: "jev" as const };
    const result = await controller.prepare(
      b,
      undefined,
      settings,
      connection,
      options(),
    );
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    expect((result.battle as SmallBattle).active?.id).toBe("b");
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.commander.side === "ally")).toBe(true);
    expect(result.state.sides.ally?.pending).toBeNull();
    expect(result.state.sides.ally?.plan.tasks.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.state)).not.toContain("service-token");
    const resumed = await controller.prepare(
      result.battle,
      JSON.parse(JSON.stringify(result.state)),
      settings,
      connection,
      options(),
    );
    expect(resumed.state.sides.enemy?.plan.tasks.length).toBeGreaterThan(0);
    expect(requests.some((r) => r.commander.side === "enemy")).toBe(true);
  });
  it("mass plans preserve explicit player orders and resolve exactly one round", async () => {
    const b = mass(),
      before = JSON.stringify(b.toSnapshot()),
      controller = new JevCommandController(model);
    const result = await controller.prepare(
      b,
      undefined,
      { ...defaultJevSettings(), mode: "jev" },
      connection,
      { ...options(), drafts: [{ unitId: "a", type: "hold" }] },
    );
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    expect(result.battle.round).toBe(b.round + 1);
    expect((result.battle as MassBattle).previousOrders.get("a")?.type).toBe(
      "hold",
    );
    expect(result.state.sides.enemy?.plan.tasks.length).toBeGreaterThan(0);
  });
  it("server failure falls back only after ten retries and reconnects after one second", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const b = small(),
      before = JSON.stringify(b.toSnapshot());
    const expected = SmallBattle.fromSnapshot(JSON.parse(before), {
      traitRegistry: registry,
    });
    expected.autoAction(expected.active!.id);
    const controller = new JevCommandController(async () => {
      calls++;
      return new Response("service-token private-server-content", { status: 503 });
    });
    const pending = controller.prepare(
      b,
      undefined,
      { ...defaultJevSettings(), mode: "jev" },
      connection,
      options(),
    );
    await vi.advanceTimersByTimeAsync(9999);
    expect(calls).toBe(10);
    expect(controller.busy).toBe(true);
    expect(controller.detail).not.toContain("暂不可用");
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(calls).toBe(11);
    expect(result.state.detail).toContain("重试 10 次");
    expect(result.state.detail).toContain("HTTP 503");
    expect(result.state.detail).toContain("1 秒");
    expect(JSON.stringify(result.state)).not.toMatch(/service-token|private-server-content/);
    expect(result.state.detail).toContain("回退原有");
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    expect(JSON.stringify(result.battle.toSnapshot())).toBe(
      JSON.stringify(expected.toSnapshot()),
    );
    const next = controller.prepare(result.battle, result.state, defaultJevSettings(), connection, options());
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(11);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(12);
    await vi.runAllTimersAsync();
    await next;
    expect(calls).toBe(22);
  });
  it("pause aborts a waiting provider and cannot apply its late response", async () => {
    const b = small(),
      before = JSON.stringify(b.toSnapshot());
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => (started = resolve));
    const controller = new JevCommandController(async (_url, init) => {
      started();
      return new Promise((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(Error("cancelled")),
          { once: true },
        ),
      );
    });
    const pending = controller.prepare(
      b,
      undefined,
      { ...defaultJevSettings(), mode: "jev" },
      connection,
      options(),
    );
    await waiting;
    controller.cancel();
    await expect(pending).rejects.toThrow("取消");
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    expect(controller.busy).toBe(false);
  });
  it("a chat switch invalidates an otherwise successful model result", async () => {
    const b = small(),
      before = JSON.stringify(b.toSnapshot());
    let valid = true;
    const controller = new JevCommandController(async (url, init) => {
      valid = false;
      return model(url, init);
    });
    await expect(
      controller.prepare(
        b,
        undefined,
        { ...defaultJevSettings(), mode: "jev" },
        connection,
        { ...options(), valid: () => valid },
      ),
    ).rejects.toThrow("取消");
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
  });
  it("manual context scanning cannot submit pending mass drafts or advance the round", async () => {
    const b = mass(),
      controller = new JevCommandController(
        async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          return new Response(JSON.stringify(request.fields ? {
            model: "fake-jev", selections: Object.fromEntries(request.fields.map((f: { id: string }) => [f.id, { value: "unknown", confidence: 0 }])),
          } : { goals: [], environment: ["night"] }));
        },
      );
    const settings = { ...defaultJevSettings(), mode: "jev" as const };
    settings.narrative.mode = "manual";
    const result = await controller.prepare(
      b,
      undefined,
      settings,
      connection,
      {
        ...options(),
        manualScan: true,
        drafts: [{ unitId: "a", type: "hold" }],
        messages: [
          { id: "story", role: "assistant", text: "夜战", completed: true },
        ],
      },
    );
    expect(result.battle.round).toBe(b.round);
    expect((result.battle as MassBattle).orders.size).toBe(b.orders.size);
    expect(result.state.sides.ally?.narrativeContext?.environment).toEqual([
      "night",
    ]);
  });
  it("invalid model answers fall back without committing a partial JEV candidate", async () => {
    vi.useFakeTimers();
    const b = small(),
      controller = new JevCommandController(
        async () =>
          new Response(
            JSON.stringify({ confidence: 1, model: "bad", scores: {} }),
          ),
      );
    const pending = controller.prepare(
      b,
      undefined,
      { ...defaultJevSettings(), mode: "jev" },
      connection,
      options(),
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.state.detail).toContain("回退原有");
    expect(result.state.sides).toEqual({});
  });
  it("observation and requests never include a hidden enemy or neutral ownership", async () => {
    const b = small();
    b.visibleCombatants = () => [b.byId("a")];
    const adapter = new TavernJevAdapter(
      b,
      "ally",
      "battle",
      0,
      new AbortController().signal,
    );
    const observation = await adapter.observe();
    expect(observation.units.map((u) => u.id)).toEqual(["a"]);
    const commands = await adapter.legalActions(observation, ["a"]);
    expect(commands.some((a) => a.targetId === "b")).toBe(false);
  });
});

describe('direct remote models execute battle decisions', () => {
  it.each(['typesafe', 'openai'] as const)('uses selected %s model without a local bridge', async protocol => {
    const calls: { url: string; body: any }[] = [];
    const controller = new JevCommandController(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), body });
      if (protocol === 'typesafe') return new Response(JSON.stringify({ model: 'selected-model', answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, q.type === 'score' ? { type: 'score', score: 2, confidence: 0.9 } : { type: 'noul', noul: 0.2 }])) }));
      const state = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ model: 'selected-model', choices: [{ message: { content: JSON.stringify({ confidence: 0.9, scores: Object.fromEntries(state.candidates.map((c: any) => [c.id, 0.6])) }) } }] }));
    });
    const battle = small(), before = battle.toSnapshot();
    const result = await controller.prepare(battle, undefined, defaultJevSettings(), { protocol, url: 'https://models.example/v1', token: 'test-key', model: 'selected-model' }, options());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(c => c.body.model === 'selected-model' && c.url === 'https://models.example/v1/' + (protocol === 'typesafe' ? 'systemone' : 'chat/completions'))).toBe(true);
    expect(result.state.detail).not.toContain('回退');
    expect(battle.toSnapshot()).toEqual(before);
  });
});
