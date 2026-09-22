import { describe, expect, it } from "vitest";
import {
  SmallBattle,
  MassBattle,
  generateUnit,
  standardField,
  traitRegistry,
  V4_OVERFLOW_D20,
  V4_OVERFLOW_TW,
  memberHealth,
  memberHealthMax,
} from "../../engine/src/index.js";
import { formationNode } from "../../engine/src/mass/formation.js";
import {
  JevCommandController,
  defaultJevSettings,
  type JevBattleState,
} from "./jev-command.js";
import { TavernJevAdapter } from "./jev-adapter.js";
import type { DecisionRequest } from "../../vendor/jev-core/src/index.js";

const registry = traitRegistry();
function unit(
  id: string,
  side: "ally" | "enemy",
  weaponClass = "rifle",
  scale: "hero" | "company" = "hero",
) {
  const u = generateUnit(
    {
      name: id,
      side,
      scale,
      rulesVersion: "v2",
      level: 4,
      weaponClass,
      weaponLevel: 4,
      armorTier: 1,
      hpMax: scale === "hero" ? 80 : 30,
      traits: [],
    },
    { registry, seed: id, noVariance: true },
  ).unit;
  u.id = id;
  u.morale = 100;
  u.base.moraleMax = 100;
  return u;
}
function fixture(seed: string, night = false) {
  const field = standardField(7, 13, night ? ["night"] : []);
  field.tiles.fill("open");
  const b = new SmallBattle({
    combatants: [
      unit("a1", "ally"),
      unit("a2", "ally"),
      unit("e1", "enemy"),
      unit("e2", "enemy"),
    ],
    battlefield: field,
    rules: V4_OVERFLOW_D20,
    seed,
    traitRegistry: registry,
  });
  b.start();
  b.turnOrder = ["a1", "e1", "a2", "e2"];
  b.turnIndex = 0;
  b.combatants.forEach((u, i) => {
    u.pos = [65, 67, 23, 25][i]!;
    delete u.tacticalRevealed;
  });
  return b;
}
async function run(initial: SmallBattle | MassBattle, count: number) {
  let battle = initial,
    state: JevBattleState | undefined,
    controller = new JevCommandController(model);
  const requests: DecisionRequest[] = [];
  async function model(_url: RequestInfo | URL, init?: RequestInit) {
    const r = JSON.parse(String(init?.body)) as DecisionRequest;
    requests.push(r);
    return new Response(
      JSON.stringify({
        model: "test",
        confidence: 0.8,
        scores: Object.fromEntries(r.candidates.map((c) => [c.id, 0.5])),
      }),
    );
  }
  const positions = [];
  for (let i = 0; i < count && !battle.isOver(); i++) {
    if (i === 5) {
      state = JSON.parse(JSON.stringify(state));
      controller = new JevCommandController(model);
    }
    const before = JSON.stringify(battle.toSnapshot());
    const next = await controller.prepare(
      battle,
      state,
      { ...defaultJevSettings(), mode: "jev" },
      { url: "http://127.0.0.1:4317", token: "test" },
      { battleId: "behavior", namespace: "synthetic", valid: () => true },
    );
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    expect(next.state.detail).not.toContain("回退");
    battle = next.battle;
    state = next.state;
    positions.push(battle.combatants.map((u) => u.pos));
  }
  return { battle, state: state!, requests, positions };
}
describe("JEV battle behavior regressions", () => {
  it.each(["night-1", "night-2", "night-3"])(
    "searches and makes contact in %s without exposing hidden enemies",
    async (seed) => {
      const initial = fixture(seed, true);
      const adapter = new TavernJevAdapter(
        initial,
        "ally",
        "night",
        0,
        new AbortController().signal,
      );
      expect((await adapter.observe()).units.map((u) => u.id)).toEqual([
        "a1",
        "a2",
      ]);
      const { battle, requests, state } = await run(initial, 32);
      expect(battle.log.some((l) => l.kind === "attack")).toBe(true);
      expect(battle.combatants.some((u) => u.hp < u.base.hpMax)).toBe(true);
      expect(
        requests.every((r) =>
          r.observation.units.some((u) => u.side !== r.commander.side),
        ),
      ).toBe(true);
      expect(
        Object.values(state.sides).some((cp) =>
          Object.values(cp!.memory ?? {}).some((m) =>
            m.history.some((a) => a.action.kind === "attack"),
          ),
        ),
      ).toBe(true);
    },
  );
  it("keeps ranged units firing instead of marching to the opposite deployment", async () => {
    const { battle } = await run(fixture("ranged"), 24);
    for (const u of battle.combatants) {
      if (u.side === "ally") expect(u.pos!).toBeGreaterThanOrEqual(49);
      else expect(u.pos!).toBeLessThan(42);
    }
    expect(
      battle.log.filter((l) => l.kind === "attack").length,
    ).toBeGreaterThan(20);
  });
  it("uses group geometry in symmetric formations and reports member health in consistent units", async () => {
    const combatants = [];
    for (const side of ["ally", "enemy"] as const)
      for (let i = 0; i < 3; i++) {
        const u = unit(
          (side === "ally" ? "a" : "e") + (i + 1),
          side,
          i === 1 ? "sword" : "rifle",
          "company",
        );
        u.tags.push("zone:" + ["左翼", "中军", "右翼"][i], "rank:front");
        combatants.push(u);
      }
    const b = new MassBattle({
      combatants,
      rules: V4_OVERFLOW_TW,
      seed: "formation",
      traitRegistry: registry,
    });
    b.start();
    const o = await new TavernJevAdapter(
      b,
      "ally",
      "formation",
      0,
      new AbortController().signal,
    ).observe();
    for (const u of o.units) {
      expect(u.hp).toBe(memberHealth(b.byId(u.id)));
      expect(u.maxHp).toBe(memberHealthMax(b.byId(u.id)));
    }
    expect(o.capabilities!.mechanisms!.flanking).toBe(true);
    const { battle } = await run(b, 8);
    expect(
      new Set(
        battle.combatants
          .filter((u) => u.side === "ally")
          .map((u) => formationNode(u).wing),
      ).size,
    ).toBeGreaterThan(1);
  });
});
