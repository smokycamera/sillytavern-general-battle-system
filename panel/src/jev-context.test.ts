import { afterEach, describe, it, expect, vi } from "vitest";
afterEach(() => vi.useRealTimers());
import {
  generateUnit,
  traitRegistry,
  SmallBattle,
  standardField,
  V4_OVERFLOW_D20,
} from "../../engine/src/index.js";
import {
  encounterRequest,
  applyEncounterSelection,
  normalizeContextSettings,
  type EncounterContextInput,
} from "./jev-context.js";
import {
  JevCommandController,
  defaultJevSettings,
  normalizeJevSettings,
} from "./jev-command.js";
import type {
  ContextSelectionRequest,
  ContextSelectionAnswer,
} from "../../vendor/jev-core/src/index.js";
const reg = traitRegistry();
function fixture(): EncounterContextInput {
  return {
    roster: (["ally", "enemy"] as const).map((side, i) => {
      const u = generateUnit(
        {
          name: "u" + i,
          side,
          scale: "company",
          rulesVersion: "v2",
          level: 4,
          weaponClass: "rifle",
          weaponLevel: 4,
          armorTier: 1,
          hpMax: 30,
          traits: [],
        },
        { registry: reg, seed: side, noVariance: true },
      ).unit;
      u.id = side;
      return u;
    }),
    setup: {
      mode: "mass",
      field: "plains",
      lighting: "day",
      mapLayout: "standard",
      objectiveMode: "auto",
      siegeAttacker: "ally",
    },
    settings: normalizeContextSettings(),
    messages: [
      {
        id: "m1",
        role: "assistant",
        completed: true,
        text: "夜间室内护送，敌方专家谨慎迂回。",
      },
    ],
    windowSize: 6,
    roles: ["assistant"],
    phase: "preparation",
  };
}
function answer(
  r: ContextSelectionRequest,
  values: Record<string, string> = {},
): ContextSelectionAnswer {
  return {
    model: "test",
    selections: Object.fromEntries(
      r.fields.map((f) => [
        f.id,
        {
          value:
            values[f.id] ??
            (Object.hasOwn(f.options, "unknown") ? "unknown" : "keep"),
          confidence: 0.95,
        },
      ]),
    ),
  };
}
function selected() {
  const input = fixture(),
    { base, request } = encounterRequest(input);
  return applyEncounterSelection(
    input,
    base,
    request!,
    answer(request!, {
      enemy_ability: "expert",
      style_flank: "high",
      style_risk: "low",
      battle_mode: "mass",
      field: "urban",
      lighting: "night",
      map_layout: "indoor",
      objective: "escort",
    }),
  );
}
describe("contextual battle preparation", () => {
  it("resolves commander and scene together, constraining objectives to a supported battle type", () => {
    const c = selected();
    const input = fixture(),
      draft = encounterRequest(input),
      recorded = answer(draft.request!, { lighting: "night" });
    recorded.selections.lighting!.confidence = 0.1;
    expect(
      applyEncounterSelection(input, draft.base, draft.request!, recorded)
        .lighting,
    ).toBe("night");
    expect(c.enemy.ability).toBe("expert");
    expect(c.enemy.style).toMatchObject({ flank: 80, risk: 20 });
    expect(c).toMatchObject({
      mode: "small",
      field: "urban",
      lighting: "night",
      mapLayout: "indoor",
      objectiveMode: "escort",
    });
  });
  it("preserves manual choices, zero message windows, and old ability defaults", () => {
    const input = fixture();
    input.settings = {
      ...input.settings,
      enemy: "manual",
      enemyAbility: "master",
      enemyStyle: "cautious",
      scene: "manual",
      battleMode: "small",
    };
    const result = encounterRequest(input);
    expect(result.request).toBeUndefined();
    expect(result.base.enemy).toMatchObject({
      ability: "master",
      source: "manual",
      style: { risk: 20 },
    });
    input.settings = normalizeContextSettings();
    input.phase = "battle";
    input.previous = result.base;
    const resumed = encounterRequest(input);
    expect(resumed.request).toBeDefined();
    expect(resumed.base.enemy.source).toBe("default");
    expect(resumed.request!.fields.some(f => f.id === "commander_change")).toBe(false);
    input.previous.enemy.source = "default";
    input.messages.push({ id: "late", role: "assistant", completed: true, text: "这位敌方指挥官是一位战术专家。" });
    const late = encounterRequest(input);
    expect(applyEncounterSelection(input, late.base, late.request!, answer(late.request!, {enemy_ability: "expert"})).enemy.ability).toBe("expert");
    input.windowSize = 0;
    expect(encounterRequest(input).request).toBeUndefined();
    expect(
      normalizeJevSettings({ ability: "master" }).context.enemyAbility,
    ).toBe("master");
  });
  it("caches the completed window, retains personality on ordinary messages, and updates an explicit replacement without changing geometry", () => {
    const previous = JSON.parse(JSON.stringify(selected())),
      input = { ...fixture(), phase: "battle" as const, previous };
    expect(encounterRequest(input).request).toBeUndefined();
    input.messages.push({
      id: "m2",
      role: "assistant",
      completed: true,
      text: "敌军向前移动。",
    });
    let draft = encounterRequest(input);
    expect(draft.request!.fields.some((f) => f.id === "field")).toBe(false);
    let result = applyEncounterSelection(
      input,
      draft.base,
      draft.request!,
      answer(draft.request!, {
        commander_change: "keep",
        enemy_ability: "novice",
      }),
    );
    expect(result.enemy).toEqual(previous.enemy);
    input.previous = result;
    input.messages.push({
      id: "m3",
      role: "assistant",
      completed: true,
      text: "指挥官被撤换，由一个新手接任。",
    });
    draft = encounterRequest(input);
    expect(
      (draft.request!.state as { changedMessageIds: string[] })
        .changedMessageIds,
    ).toEqual(["m3"]);
    result = applyEncounterSelection(
      input,
      draft.base,
      draft.request!,
      answer(draft.request!, {
        commander_change: "replace",
        enemy_ability: "novice",
      }),
    );
    expect(result.enemy.ability).toBe("novice");
    expect(result.enemy.style.flank).toBeUndefined();
    expect(result.mode).toBe(previous.mode);
    expect(result.mapLayout).toBe(previous.mapLayout);
    expect(result.objectiveMode).toBe(previous.objectiveMode);
  });
  it("uses the saved enemy profile in the real command controller after restoration", async () => {
    const input = fixture(),
      context = selected();
    const battle = new SmallBattle({
      combatants: input.roster,
      battlefield: standardField(),
      rules: V4_OVERFLOW_D20,
      seed: "context",
      traitRegistry: reg,
    });
    battle.start();
    battle.turnOrder = ["enemy", "ally"];
    battle.turnIndex = 0;
    const c = new JevCommandController(async (_url, init) => {
      const r = JSON.parse(String(init?.body));
      expect(r.fields).toBeUndefined();
      return new Response(
        JSON.stringify({
          model: "test",
          confidence: 0.8,
          scores: Object.fromEntries(
            r.candidates.map((x: { id: string }) => [x.id, 0.5]),
          ),
        }),
      );
    });
    const result = await c.prepare(
      battle,
      {
        battleId: "b",
        version: 0,
        sides: {},
        detail: "",
        context: JSON.parse(JSON.stringify(context)),
      },
      { ...defaultJevSettings(), mode: "jev" },
      { url: "http://127.0.0.1:4317", token: "" },
      {
        battleId: "b",
        namespace: "test",
        valid: () => true,
        messages: input.messages,
      },
    );
    expect(result.state.sides.enemy!.commanders[0]).toMatchObject({
      ability: "expert",
      style: { flank: 80, risk: 20 },
    });
  });
  it("falls back on an unavailable selector and cancels a pending preparation without mutating the input", async () => {
    const input = fixture(),
      original = JSON.stringify(input),
      connection = { url: "http://127.0.0.1:4317", token: "" };
    const offline = new JevCommandController(
      async () => new Response("{}", { status: 404 }),
    );
    vi.useFakeTimers();
    const unavailable = offline.prepareEncounter(input, connection, { valid: () => true });
    await vi.runAllTimersAsync();
    expect((await unavailable).detail).toContain("暂不可用");
    expect((await unavailable).detail).toContain("重试 10 次");
    vi.useRealTimers();
    let started!: () => void;
    const waiting = new Promise<void>((r) => (started = r));
    const pending = new JevCommandController(async (_url, init) => {
      started();
      return new Promise((_r, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(Error("cancelled")),
          { once: true },
        ),
      );
    });
    const result = pending.prepareEncounter(input, connection, {
      valid: () => true,
    });
    await waiting;
    pending.cancel();
    await expect(result).rejects.toThrow();
    expect(JSON.stringify(input)).toBe(original);
  });
});
