import {
  needsFormationHost,
  hasFlightAbility,
  isAirborne,
  deployOnGrid,
  standardField,
  type Combatant,
} from "../../engine/src/index.js";
import {
  defaultStyles,
  narrativeWindow,
  validateContextSelectionAnswer,
  type ContextSelectionRequest,
  type ContextSelectionAnswer,
  type NarrativeMessage,
} from "../../vendor/jev-core/src/index.js";
import {
  recommendBattleMode,
  prepareMassRoster,
  type BattleObjectiveMode,
} from "./battle-setup.js";

export const ABILITY_LABELS = {
  novice: "新手",
  regular: "常规",
  skilled: "熟练",
  expert: "专家",
  master: "大师",
} as const;
export type CommanderAbility = keyof typeof ABILITY_LABELS;
export const STYLE_PRESETS = {
  balanced: { label: "均衡", style: {} },
  aggressive: {
    label: "积极进攻",
    style: { initiative: 85, risk: 80, patience: 25 },
  },
  cautious: {
    label: "谨慎保全",
    style: { preservation: 85, recon: 80, risk: 20, patience: 80 },
  },
  flanking: {
    label: "迂回机动",
    style: { flank: 85, mobility: 85, feint: 75 },
  },
  firepower: {
    label: "集中火力",
    style: { firepower: 85, concentration: 80, hold: 70 },
  },
  ambush: {
    label: "伏击固守",
    style: { hold: 85, patience: 85, feint: 75, initiative: 25 },
  },
} as const;
export interface JevContextSettings {
  enemy: "auto" | "manual";
  enemyAbility: CommanderAbility;
  enemyStyle: keyof typeof STYLE_PRESETS;
  scene: "auto" | "manual";
  battleMode: "auto" | "small" | "mass";
}
export function normalizeContextSettings(
  value?: Partial<JevContextSettings>,
  ability: CommanderAbility = "skilled",
): JevContextSettings {
  if (!Object.hasOwn(ABILITY_LABELS, ability)) ability = "skilled";
  return {
    enemy: value?.enemy === "manual" ? "manual" : "auto",
    enemyAbility:
      value?.enemyAbility && Object.hasOwn(ABILITY_LABELS, value.enemyAbility)
        ? value.enemyAbility
        : ability,
    enemyStyle:
      value?.enemyStyle && Object.hasOwn(STYLE_PRESETS, value.enemyStyle)
        ? value.enemyStyle
        : "balanced",
    scene: value?.scene === "manual" ? "manual" : "auto",
    battleMode:
      value?.battleMode === "small" || value?.battleMode === "mass"
        ? value.battleMode
        : "auto",
  };
}
export interface EncounterSetup {
  mode: "small" | "mass";
  field: string;
  lighting: "day" | "night";
  mapLayout: "standard" | "indoor";
  objectiveMode: BattleObjectiveMode;
  siegeAttacker: "ally" | "enemy";
}
export interface JevEncounterContext extends EncounterSetup {
  enemy: {
    ability: CommanderAbility;
    style: Record<string, number>;
    source: "context" | "default" | "manual";
  };
  messageKey: string;
  messageKeys?: string[];
  detail: string;
  model?: string;
}
export interface EncounterContextInput {
  roster: Combatant[];
  setup: EncounterSetup;
  settings: JevContextSettings;
  messages: NarrativeMessage[];
  windowSize: number;
  roles: string[];
  phase: "preparation" | "battle";
  previous?: JevEncounterContext;
  force?: boolean;
}
const fields = defaultStyles().all();
const unknown = "正文没有明确依据，保持已有设置；不凭姓名或战斗数值推断";
function messageKey(messages: NarrativeMessage[]): string {
  const source = JSON.stringify(messages);
  let h = 2166136261;
  for (let i = 0; i < source.length; i++)
    h = Math.imul(h ^ source.charCodeAt(i), 16777619);
  return `${source.length}:${h >>> 0}`;
}
function massAvailable(roster: Combatant[]): boolean {
  for (const side of ["ally", "enemy"]) {
    const group = roster.filter(
      (u) => u.side === side && u.hp > 0 && u.status === "ready",
    );
    const people = group.filter(needsFormationHost).length;
    const hosts = group.filter(
      (u) =>
        u.scale !== "hero" &&
        ((u.body ?? "human") !== "human" ||
          (!isAirborne(u) && !hasFlightAbility(u))),
    ).length;
    if (people > hosts) return false;
  }
  try {
    prepareMassRoster(roster);
    return true;
  } catch {
    return false;
  }
}
function finishSetup(
  context: JevEncounterContext,
  input: EncounterContextInput,
): JevEncounterContext {
  if (input.phase === "battle") return context; // Existing battle geometry and victory rules are immutable.
  if (input.settings.battleMode !== "auto")
    context.mode = input.settings.battleMode;
  if (context.mode === "mass" && !massAvailable(input.roster)) {
    context.mode = "small";
    context.detail += "；当前编制需要独立人物行动，采用小战";
  }
  if (
    input.settings.battleMode === "auto" &&
    (["siege", "escort", "intercept"].includes(context.objectiveMode) ||
      context.mapLayout === "indoor")
  )
    context.mode = "small";
  if (context.mode === "mass") {
    if (
      input.settings.scene === "manual" &&
      ["siege", "escort", "intercept"].includes(context.objectiveMode)
    )
      throw Error("当前会战只支持歼灭结算；护送、拦截或攻城夺点请选择小战地图");
    context.objectiveMode = "annihilation";
    context.mapLayout = "standard";
  }
  if (context.mode === "small" && context.mapLayout === "indoor") {
    try {
      deployOnGrid(standardField(5, 7), structuredClone(input.roster));
    } catch {
      context.mapLayout = "standard";
      context.detail += "；室内地图容量不足，采用标准地图";
    }
  }
  return context;
}
export function encounterRequest(input: EncounterContextInput): {
  base: JevEncounterContext;
  request?: ContextSelectionRequest;
} {
  const messages = narrativeWindow(
    input.messages,
    input.windowSize,
    input.roles,
  ).map((m) => ({ ...m, text: m.text.slice(-6000) }));
  const key = messageKey(messages);
  const messageKeys = messages.map((m) => messageKey([m]));
  const base: JevEncounterContext = input.previous
    ? structuredClone(input.previous)
    : {
        ...input.setup,
        enemy: {
          ability: input.settings.enemyAbility,
          style: { ...STYLE_PRESETS[input.settings.enemyStyle].style },
          source: "default",
        },
        messageKey: key,
        detail: "沿用准备设置",
      };
  if (input.settings.enemy === "manual")
    base.enemy = {
      ability: input.settings.enemyAbility,
      style: { ...STYLE_PRESETS[input.settings.enemyStyle].style },
      source: "manual",
    };
  else if (base.enemy.source === "default" || base.enemy.source === "manual")
    base.enemy = {
      ability: input.settings.enemyAbility,
      style: { ...STYLE_PRESETS[input.settings.enemyStyle].style },
      source: "default",
    };
  const same =
    input.phase === "battle" &&
    input.previous?.messageKey === key &&
    !(input.settings.enemy === "auto" && input.previous?.enemy.source === "manual") &&
    !input.force;
  base.messageKey = key;
  base.messageKeys = messageKeys;
  const request: ContextSelectionRequest = {
    messages,
    state: JSON.parse(
      JSON.stringify({
        phase: input.phase,
        previous: input.previous?.enemy,
        preparation: input.setup,
        changedMessageIds: messages
          .filter(
            (_, i) => !input.previous?.messageKeys?.includes(messageKeys[i]!),
          )
          .map((m) => m.id),
        units: input.roster
          .filter((u) => input.phase === "preparation" || u.side === "enemy")
          .map((u) => ({
            id: u.id,
            name: u.name,
            side: u.side,
            scale: u.scale,
            tags: u.tags,
          })),
        constraints:
          "只选择配置，不改变单位属性、人数、伤亡或战斗事实。战斗中仅明确指挥官更换、能力或性格状态变化才更新敌方配置；常规战况、战法描述不算变化。",
      }),
    ),
    fields: [],
  };
  if (input.settings.enemy === "auto") {
    if (
      input.phase === "battle" &&
      input.previous &&
      input.previous.enemy.source === "context"
    )
      request.fields.push({
        id: "commander_change",
        question:
          "仅依据 changedMessageIds 指明的新消息，是否明确改变敌方实际指挥官，或其指挥能力/性格状态？之前消息只作背景；仅战术行动、伤亡和一般情绪描写不足以重置指挥配置。",
        options: {
          keep: "没有明确变化，沿用本场指挥配置",
          replace: "明确更换为另一名指挥者",
          update: "当前指挥者发生明确的能力/人格状态变化",
        },
      });
    request.fields.push({
      id: "enemy_ability",
      question:
        "当前实际敌方指挥者的战术经验、纪律、规划与协同能力处于哪档？不要用个体战斗等级、兵力或胜负代替指挥能力。",
      options: {
        unknown,
        novice: "缺乏经验、混乱指挥",
        regular: "基本训练，普通指挥",
        skilled: "老练可靠，有战术经验",
        expert: "明确的高级战术专家或优秀统帅",
        master: "正文明确为顶级战略/战术大师",
      },
    });
    for (const d of fields)
      request.fields.push({
        id: "style_" + d.id,
        question: `依据敌方指挥者的明确设定或反复体现的倾向，判断“${d.label}”；只判断当前敌方，不套用我方或旁观者性格。`,
        options: {
          unknown,
          low: d.low,
          balanced: "无明显偏向或明确保持均衡",
          high: d.high,
        },
      });
  }
  if (input.phase === "preparation" && input.settings.scene === "auto") {
    if (input.settings.battleMode === "auto")
      request.fields.push({
        id: "battle_mode",
        question:
          "当前遭遇更适合逐单位战术地图，还是编队军令阶段会战？依据实际场景；编队人数不等于可操作实体数。",
        options: {
          unknown,
          small: "独立人物、局部遭遇、护送或具体地点争夺",
          ...(massAvailable(input.roster)
            ? { mass: "可组织成阵列的军团/大规模正面会战" }
            : {}),
        },
      });
    request.fields.push({
      id: "field",
      question:
        "最新正文中当前战斗发生的主要地理环境是什么？只选已支持的最贴近类别。",
      options: {
        unknown,
        plains: "开阔平原/普通野战",
        urban: "街道、城镇、建筑群",
        siege: "城墙、堡垒或攻城环境",
        forest: "树林/丛林",
        mountain: "山地、山谷或高地",
      },
    });
    request.fields.push({
      id: "lighting",
      question: "当前交战时段的光照是什么？未明确时不要推断夜战。",
      options: { unknown, day: "白天/正常光照", night: "明确为夜间/夜战" },
    });
    request.fields.push({
      id: "map_layout",
      question:
        "当前战斗是否实际发生在建筑内部等紧凑空间？城镇外街道不等同于室内。",
      options: {
        unknown,
        standard: "室外野战或街道，标准战术地图",
        indoor: "明确在房间、室内建筑等紧凑空间",
      },
    });
    if (input.settings.battleMode !== "mass")
      request.fields.push({
        id: "objective",
        question:
          "本场交战的主要胜利任务是什么？没有具体护送/城防目标时保留默认歼灭。",
        options: {
          unknown,
          annihilation: "击败敌军/普通遭遇战",
          siege: "攻取或守住城堡据点",
          escort: "我方护送目标到出口，敌方拦截",
          intercept: "我方拦截，敌方护送目标到出口",
        },
      });
    request.fields.push({
      id: "siege_attacker",
      question:
        "如果是攻城夺点，哪一方进攻？以 ally 为玩家我方、enemy 为敌方。",
      options: {
        unknown,
        ally: "我方攻城，敌方守城",
        enemy: "敌方攻城，我方守城",
      },
    });
  }
  if (same || !messages.length || !request.fields.length)
    return { base: finishSetup(base, input) };
  return { base: finishSetup(base, input), request };
}
export function applyEncounterSelection(
  input: EncounterContextInput,
  base: JevEncounterContext,
  request: ContextSelectionRequest,
  answer: ContextSelectionAnswer,
): JevEncounterContext {
  validateContextSelectionAnswer(answer, request);
  const result = structuredClone(base);
  const chosen = (id: string, minimumConfidence = 0) => {
    const s = answer.selections[id];
    return s && s.confidence >= minimumConfidence && s.value !== "unknown"
      ? s.value
      : undefined;
  };
  const change = answer.selections.commander_change;
  const changed =
    change &&
    change.confidence >= 0.8 &&
    ["replace", "update"].includes(change.value);
  const update =
    input.phase === "preparation" ||
    !input.previous ||
    input.previous.enemy.source !== "context" ||
    changed;
  if (input.settings.enemy === "auto" && update) {
    if (changed && change.value === "replace")
      result.enemy = {
        ability: input.settings.enemyAbility,
        style: { ...STYLE_PRESETS[input.settings.enemyStyle].style },
        source: "default",
      };
    const ability = chosen("enemy_ability", 0.6);
    if (ability) result.enemy.ability = ability as CommanderAbility;
    for (const d of fields) {
      const value = chosen("style_" + d.id, 0.6);
      if (value)
        result.enemy.style[d.id] =
          value === "low" ? 20 : value === "high" ? 80 : 50;
    }
    if (ability || fields.some((d) => chosen("style_" + d.id, 0.6)))
      result.enemy.source = "context";
  }
  if (input.phase === "preparation" && input.settings.scene === "auto") {
    const mode = chosen("battle_mode"),
      field = chosen("field"),
      lighting = chosen("lighting"),
      layout = chosen("map_layout"),
      objective = chosen("objective"),
      attacker = chosen("siege_attacker");
    if (mode) result.mode = mode as EncounterSetup["mode"];
    if (field) result.field = field;
    if (lighting) result.lighting = lighting as EncounterSetup["lighting"];
    if (layout) result.mapLayout = layout as EncounterSetup["mapLayout"];
    if (objective) result.objectiveMode = objective as BattleObjectiveMode;
    if (attacker)
      result.siegeAttacker = attacker as EncounterSetup["siegeAttacker"];
    if (result.objectiveMode === "auto")
      result.objectiveMode =
        result.field === "siege" ? "siege" : "annihilation";
  }
  result.model = answer.model;
  result.detail =
    input.phase === "battle" && !update
      ? "近期正文未明确改变指挥官，沿用本场配置"
      : "已按当前上下文选择；依据不足的项目沿用原设置";
  return finishSetup(result, input);
}
export function encounterSummary(context: JevEncounterContext): string {
  const traits = fields
    .filter((d) => Math.abs((context.enemy.style[d.id] ?? 50) - 50) >= 20)
    .map((d) => (context.enemy.style[d.id]! > 50 ? d.high : d.low))
    .slice(0, 4);
  return `敌方：${ABILITY_LABELS[context.enemy.ability]}${traits.length ? " · " + traits.join(" / ") : " · 均衡"}；${context.mode === "small" ? "小战" : "会战"} · ${{ plains: "野战", urban: "巷战", siege: "攻城", forest: "森林", mountain: "山地" }[context.field] ?? context.field} / ${context.lighting === "night" ? "夜间" : "日间"} · ${{ auto: "默认目标", control: "夺点", annihilation: "歼灭", siege: "攻城夺点", escort: "我方护送", intercept: "拦截敌方" }[context.objectiveMode]}`;
}
