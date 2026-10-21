/**
 * 规则包：公式与数值全部数据化，可整包替换。
 * 内置两套：lite-d20（小规模默认掷骰）、lite-tw（军团默认概率公式）。
 */

import type { RulePack } from './types.js';

export const LITE_D20: RulePack = {
  id: 'lite-d20',
  name: '轻量d20（小规模战斗）',
  hitMode: 'd20',
  critMin: 20,
  tw: { base: 0.35, perDiff: 0.05, min: 0.05, max: 0.95, defOffset: 10 },
  armorDR: [0, 0.2, 0.35, 0.5, 0.6],
  sameNameKeepsHighest: true,
  maxFlat: 30,
  critRule: 'doubleDice',
  counterMatrix: {
    // 机动 ▶ 远程 ▶ 步兵 ▶ 机动
    mobile: { ranged: 2 },
    ranged: { infantry: 2 },
    infantry: { mobile: 2 },
  },
  morale: { dieMax: 20, baseDC: 10, breakAt: 25 },
  injuryThreshold: 0.4,
  rangedMeleePenalty: -2,
};

/** 军团规则包：同数值骨架，命中换全面战争式概率公式（无暴击，减少大数噪声） */
export const MASS_TW: RulePack = {
  ...LITE_D20,
  id: 'lite-tw',
  name: '轻量概率（军团战斗）',
  hitMode: 'tw',
};

export const V2_D20: RulePack = { ...LITE_D20, id: 'v2-d20', name: 'V2 效果对抗', resolutionVersion: 'v2', counterMatrix: { infantry: {}, ranged: {}, mobile: {} } };
export const V2_TW: RulePack = { ...MASS_TW, id: 'v2-tw', name: 'V2 会战对抗', resolutionVersion: 'v2', counterMatrix: { infantry: {}, ranged: {}, mobile: {} } };
export const V3_D20: RulePack = {...V2_D20,id:'v3-d20',name:'V3 个体与编队战术',combatModel:'cohort-v1'};
export const V3_TW: RulePack = {...V2_TW,id:'v3-tw',name:'V3 聚合会战',combatModel:'cohort-v1'};
export const V4_D20:RulePack={...V3_D20,id:'v4-d20',name:'V4 成员生命与武器规格',combatModel:'cohort-v2'};
export const V4_TW:RulePack={...V3_TW,id:'v4-tw',name:'V4 成员生命会战',combatModel:'cohort-v2'};
export const V4_OVERFLOW_D20:RulePack={...V4_D20,id:'v4-overflow-d20',name:'V4 连队溢出伤害',weaponOverflow:true};
export const V4_OVERFLOW_TW:RulePack={...V4_TW,id:'v4-overflow-tw',name:'V4 连队溢出会战',weaponOverflow:true};
export const V5_D20:RulePack={...V4_D20,id:'v5-d20',name:'V5 通道防护与单体毁伤',damageModel:'wounds-v1'};
export const V5_TW:RulePack={...V4_TW,id:'v5-tw',name:'V5 通道防护会战',damageModel:'wounds-v1'};
export const V5_OVERFLOW_D20:RulePack={...V5_D20,id:'v5-overflow-d20',name:'V5 连队溢出伤害',weaponOverflow:true};
export const V5_OVERFLOW_TW:RulePack={...V5_TW,id:'v5-overflow-tw',name:'V5 连队溢出会战',weaponOverflow:true};

/** Unified life, frontage, wound budgets and bounded area coverage. Old ids stay frozen. */
export const V6_D20:RulePack={...V5_D20,id:'v6-d20',name:'V6 统一生命与创伤',damageModel:'wounds-v2'};
export const V6_TW:RulePack={...V5_TW,id:'v6-tw',name:'V6 统一生命会战',damageModel:'wounds-v2'};
export const V6_OVERFLOW_D20:RulePack={...V6_D20,id:'v6-overflow-d20',name:'V6 统一生命与溢出',weaponOverflow:true};
export const V6_OVERFLOW_TW:RulePack={...V6_TW,id:'v6-overflow-tw',name:'V6 统一生命溢出会战',weaponOverflow:true};

/** Only new battles opt in; V2–V6 ids and their replay formulas remain frozen. */
export const V7_OVERFLOW_D20:RulePack={...V6_OVERFLOW_D20,id:'v7-overflow-d20',name:'V7 跨代毁伤与溢出',overmatch:true};
export const V7_OVERFLOW_TW:RulePack={...V6_OVERFLOW_TW,id:'v7-overflow-tw',name:'V7 跨代毁伤溢出会战',overmatch:true};

/** New battles soften stacked burst damage; saved V2–V7 rules and skill instances stay intact. */
export const V8_OVERFLOW_D20:RulePack={...V7_OVERFLOW_D20,id:'v8-overflow-d20',name:'V8 训练与武技增伤校准',trainingDamagePerLevel:.06,singleWeaponSkillMultiplier:1.5};
export const V8_OVERFLOW_TW:RulePack={...V7_OVERFLOW_TW,id:'v8-overflow-tw',name:'V8 训练与武技增伤会战',trainingDamagePerLevel:.06,singleWeaponSkillMultiplier:1.5};

/** Resource economy is opt-in; all previous saved rules retain their costs and recovery. */
export const V9_OVERFLOW_D20: RulePack = { ...V8_OVERFLOW_D20, id: 'v9-overflow-d20', name: 'V9 等级精力与耐力', resourceModel: 'endurance-v1' };
export const V9_OVERFLOW_TW: RulePack = { ...V8_OVERFLOW_TW, id: 'v9-overflow-tw', name: 'V9 等级精力与耐力会战', resourceModel: 'endurance-v1' };

/** Only new battles opt in; snapshots without a curve keep the V7–V9 safe band. */
export const V10_OVERFLOW_D20: RulePack = { ...V9_OVERFLOW_D20, id: 'v10-overflow-d20', name: 'V10 连续跨级毁伤', overmatchCurve: 'continuous-v1' };
export const V10_OVERFLOW_TW: RulePack = { ...V9_OVERFLOW_TW, id: 'v10-overflow-tw', name: 'V10 连续跨级毁伤会战', overmatchCurve: 'continuous-v1' };

/** V11 only opts new battles into soft low grades and a smaller SP reserve. */
export const V11_OVERFLOW_D20: RulePack = { ...V10_OVERFLOW_D20, id: 'v11-overflow-d20', name: 'V11 低阶柔化与精力约束', overmatchCurve: 'continuous-soft40-v1', resourceModel: 'endurance-v2' };
export const V11_OVERFLOW_TW: RulePack = { ...V10_OVERFLOW_TW, id: 'v11-overflow-tw', name: 'V11 低阶柔化与精力约束会战', overmatchCurve: 'continuous-soft40-v1', resourceModel: 'endurance-v2' };

/** V12 only opts new battles into the weapon/armor calibration; V2–V11 snapshots keep their projection. */
export const V12_OVERFLOW_D20: RulePack = { ...V11_OVERFLOW_D20, id: 'v12-overflow-d20', name: 'V12 武器与护甲校准', armsModel: 'arms-v1' };
export const V12_OVERFLOW_TW: RulePack = { ...V11_OVERFLOW_TW, id: 'v12-overflow-tw', name: 'V12 武器与护甲校准会战', armsModel: 'arms-v1' };

/** V13 only opts new battles into the trait overhaul; V2–V12 snapshots keep their trait rules. */
export const V13_OVERFLOW_D20: RulePack = { ...V12_OVERFLOW_D20, id: 'v13-overflow-d20', name: 'V13 特质翻修', traitModel: 'traits-v1' };
export const V13_OVERFLOW_TW: RulePack = { ...V12_OVERFLOW_TW, id: 'v13-overflow-tw', name: 'V13 特质翻修会战', traitModel: 'traits-v1' };

/** V14 only opts new battles into composite-state skill pricing; V2–V13 snapshots keep their compiled skill numbers. */
export const V14_OVERFLOW_D20: RulePack = { ...V13_OVERFLOW_D20, id: 'v14-overflow-d20', name: 'V14 技能补全', skillModel: 'skills-v1' };
export const V14_OVERFLOW_TW: RulePack = { ...V13_OVERFLOW_TW, id: 'v14-overflow-tw', name: 'V14 技能补全会战', skillModel: 'skills-v1' };

/** V15 only opts new battles into the item system rules (see item-model.ts); V2–V14 snapshots keep their item, trait and archetype rules. */
export const V15_OVERFLOW_D20: RulePack = { ...V14_OVERFLOW_D20, id: 'v15-overflow-d20', name: 'V15 道具系统', itemModel: 'items-v1' };
export const V15_OVERFLOW_TW: RulePack = { ...V14_OVERFLOW_TW, id: 'v15-overflow-tw', name: 'V15 道具系统会战', itemModel: 'items-v1' };

/** P1 十一类特质分级。旧规则 id 和进行中的战斗保持冻结。 */
export const V16_OVERFLOW_D20: RulePack = { ...V15_OVERFLOW_D20, id: 'v16-overflow-d20', name: 'V16 特质分级', traitLevelModel: 'traits-levels-v1' };
export const V16_OVERFLOW_TW: RulePack = { ...V15_OVERFLOW_TW, id: 'v16-overflow-tw', name: 'V16 特质分级会战', traitLevelModel: 'traits-levels-v1' };

export const V17_OVERFLOW_D20: RulePack = { ...V16_OVERFLOW_D20, id: 'v17-overflow-d20', name: 'V17 特质第二阶段', traitLevelModel: 'traits-levels-v2', skillModel: 'skills-v2', healingModel: 'healing-grades-v1', controlModel: 'activation-controls-v1' };
export const V17_OVERFLOW_TW: RulePack = { ...V16_OVERFLOW_TW, id: 'v17-overflow-tw', name: 'V17 特质第二阶段会战', traitLevelModel: 'traits-levels-v2', skillModel: 'skills-v2', healingModel: 'healing-grades-v1', controlModel: 'activation-controls-v1' };

export const V18_OVERFLOW_D20: RulePack = { ...V17_OVERFLOW_D20, id: 'v18-overflow-d20', name: 'V18 百兵谱', armsModel: 'arms-v2', barrierModel: 'barrier-grades-v1' };
export const V18_OVERFLOW_TW: RulePack = { ...V17_OVERFLOW_TW, id: 'v18-overflow-tw', name: 'V18 百兵谱会战', armsModel: 'arms-v2', barrierModel: 'barrier-grades-v1' };

/** V19 统帅：只有新战斗启用；V18 及以前的战斗保留原指挥评分。 */
export const V19_OVERFLOW_D20: RulePack = { ...V18_OVERFLOW_D20, id: 'v19-overflow-d20', name: 'V19 统帅', commandModel: 'command-v2' };
export const V19_OVERFLOW_TW: RulePack = { ...V18_OVERFLOW_TW, id: 'v19-overflow-tw', name: 'V19 统帅会战', commandModel: 'command-v2' };

/** V20：组合控制每多一项效果抵抗难度 −1（原 −2）；佩戴修正按道具 L 换算。只有新战斗启用，V19 及以前的战斗按原规则。 */
export const V20_OVERFLOW_D20: RulePack = { ...V19_OVERFLOW_D20, id: 'v20-overflow-d20', name: 'V20 组合控制与佩戴等级', skillModel: 'skills-v3', itemModel: 'items-v2' };
export const V20_OVERFLOW_TW: RulePack = { ...V19_OVERFLOW_TW, id: 'v20-overflow-tw', name: 'V20 组合控制与佩戴等级会战', skillModel: 'skills-v3', itemModel: 'items-v2' };

/**
 * V21 等级锚定校准（docs/level-anchoring-v21-20261019.md）：能量盾容量按同级预算与平台、跨代换算（arms-v3），实体盾耐久随平台；
 * 屏障基础量、状态效力与士气量按单体创伤预算比例（skills-v4）。只有新战斗启用，V20 及以前的战斗按原规则。
 */
export const V21_OVERFLOW_D20: RulePack = { ...V20_OVERFLOW_D20, id: 'v21-overflow-d20', name: 'V21 等级锚定校准', skillModel: 'skills-v4', armsModel: 'arms-v3' };
export const V21_OVERFLOW_TW: RulePack = { ...V20_OVERFLOW_TW, id: 'v21-overflow-tw', name: 'V21 等级锚定校准会战', skillModel: 'skills-v4', armsModel: 'arms-v3' };

/** id → 规则包（战斗快照恢复用；面板只用默认两包） */
export const V22_OVERFLOW_D20: RulePack = { ...V21_OVERFLOW_D20, id: 'v22-overflow-d20', name: 'V22 特质与道具成长', traitLevelModel: 'traits-items-v1' };
export const V22_OVERFLOW_TW: RulePack = { ...V21_OVERFLOW_TW, id: 'v22-overflow-tw', name: 'V22 特质与道具成长会战', traitLevelModel: 'traits-items-v1' };
export const V23_OVERFLOW_D20: RulePack = { ...V22_OVERFLOW_D20, id: 'v23-overflow-d20', name: 'V23 特质与道具组合', traitLevelModel: 'traits-items-v2' };
export const V23_OVERFLOW_TW: RulePack = { ...V22_OVERFLOW_TW, id: 'v23-overflow-tw', name: 'V23 特质与道具组合会战', traitLevelModel: 'traits-items-v2' };
/** V24 只为新战斗启用分级统率范围，历史战斗继续使用原规则。 */
export const V24_OVERFLOW_D20: RulePack = { ...V23_OVERFLOW_D20, id: 'v24-overflow-d20', name: 'V24 统率范围成长', commandRangeModel: 'graded-v1' };
export const V24_OVERFLOW_TW: RulePack = { ...V23_OVERFLOW_TW, id: 'v24-overflow-tw', name: 'V24 统率范围成长会战', commandRangeModel: 'graded-v1' };
export const RULES_BY_ID: Record<string, RulePack> = {
  [V24_OVERFLOW_D20.id]: V24_OVERFLOW_D20, [V24_OVERFLOW_TW.id]: V24_OVERFLOW_TW,
  [V23_OVERFLOW_D20.id]: V23_OVERFLOW_D20, [V23_OVERFLOW_TW.id]: V23_OVERFLOW_TW,
  [V22_OVERFLOW_D20.id]: V22_OVERFLOW_D20, [V22_OVERFLOW_TW.id]: V22_OVERFLOW_TW,
  [V21_OVERFLOW_D20.id]: V21_OVERFLOW_D20, [V21_OVERFLOW_TW.id]: V21_OVERFLOW_TW,
  [V20_OVERFLOW_D20.id]: V20_OVERFLOW_D20, [V20_OVERFLOW_TW.id]: V20_OVERFLOW_TW,
  [V19_OVERFLOW_D20.id]: V19_OVERFLOW_D20, [V19_OVERFLOW_TW.id]: V19_OVERFLOW_TW,
  [V18_OVERFLOW_D20.id]: V18_OVERFLOW_D20, [V18_OVERFLOW_TW.id]: V18_OVERFLOW_TW,
  [V17_OVERFLOW_D20.id]: V17_OVERFLOW_D20, [V17_OVERFLOW_TW.id]: V17_OVERFLOW_TW,
  [V16_OVERFLOW_D20.id]: V16_OVERFLOW_D20, [V16_OVERFLOW_TW.id]: V16_OVERFLOW_TW,
  [V15_OVERFLOW_D20.id]: V15_OVERFLOW_D20, [V15_OVERFLOW_TW.id]: V15_OVERFLOW_TW,
  [V14_OVERFLOW_D20.id]: V14_OVERFLOW_D20, [V14_OVERFLOW_TW.id]: V14_OVERFLOW_TW,
  [V13_OVERFLOW_D20.id]: V13_OVERFLOW_D20, [V13_OVERFLOW_TW.id]: V13_OVERFLOW_TW,
  [V12_OVERFLOW_D20.id]: V12_OVERFLOW_D20, [V12_OVERFLOW_TW.id]: V12_OVERFLOW_TW,
  [V11_OVERFLOW_D20.id]: V11_OVERFLOW_D20, [V11_OVERFLOW_TW.id]: V11_OVERFLOW_TW,
  [V10_OVERFLOW_D20.id]: V10_OVERFLOW_D20, [V10_OVERFLOW_TW.id]: V10_OVERFLOW_TW,
  [V9_OVERFLOW_D20.id]: V9_OVERFLOW_D20, [V9_OVERFLOW_TW.id]: V9_OVERFLOW_TW,
  [V8_OVERFLOW_D20.id]:V8_OVERFLOW_D20,[V8_OVERFLOW_TW.id]:V8_OVERFLOW_TW,
  [V7_OVERFLOW_D20.id]:V7_OVERFLOW_D20,[V7_OVERFLOW_TW.id]:V7_OVERFLOW_TW,
  [V6_D20.id]:V6_D20,[V6_TW.id]:V6_TW,[V6_OVERFLOW_D20.id]:V6_OVERFLOW_D20,[V6_OVERFLOW_TW.id]:V6_OVERFLOW_TW,
  [V5_D20.id]:V5_D20,
  [V5_TW.id]:V5_TW,
  [V5_OVERFLOW_D20.id]:V5_OVERFLOW_D20,
  [V5_OVERFLOW_TW.id]:V5_OVERFLOW_TW,
  [V4_OVERFLOW_D20.id]:V4_OVERFLOW_D20,
  [V4_OVERFLOW_TW.id]:V4_OVERFLOW_TW,
  [V4_D20.id]:V4_D20,
  [V4_TW.id]:V4_TW,
  [V3_D20.id]: V3_D20,
  [V3_TW.id]: V3_TW,
  [V2_D20.id]: V2_D20,
  [V2_TW.id]: V2_TW,
  [LITE_D20.id]: LITE_D20,
  [MASS_TW.id]: MASS_TW,
};

/** 按 id 取规则包；未知 id 回退小规模默认 */
export function rulesById(id?: string): RulePack {
  if (id && /^v\d+-/.test(id) && !RULES_BY_ID[id]) throw new Error(`不支持的规则版本 ${id}，不能静默回退`);
  return (id ? RULES_BY_ID[id] : undefined) ?? LITE_D20;
}

/** 按原型克制取攻击加值（作为态势修正注入加成栈） */
export function counterMod(rules: RulePack, attackerArch?: string, defenderArch?: string): number {
  if (!attackerArch || !defenderArch) return 0;
  const row = rules.counterMatrix[attackerArch as keyof RulePack['counterMatrix']];
  if (!row) return 0;
  return row[defenderArch as keyof typeof row] ?? 0;
}

// ---------- 预置体系规则包 ----------
// 时代/题材的数值差异 = 武器原型（data/weapons.ts，伤害/破甲/射程）+ 本表（护甲/命中斜率）。
// 与皮肤解耦：DND 与 12 世纪共用 medieval 皮肤，但可各自微调。

/** 体系包：小规模（d20）与军团（概率公式）各一套 */
export interface SystemPack {
  id: string;
  name: string;
  small: RulePack;
  mass: RulePack;
}

function pack(id: string, name: string, over: Partial<RulePack>, twOver?: Partial<RulePack['tw']>): SystemPack {
  const small: RulePack = { ...LITE_D20, ...over, id: `sys-${id}-d20`, name: `${name}（小规模）` };
  const mass: RulePack = {
    ...MASS_TW, ...over, ...(twOver ? { tw: { ...MASS_TW.tw, ...twOver } } : {}),
    id: `sys-${id}-tw`, name: `${name}（军团）`, hitMode: 'tw',
  };
  return { id, name, small, mass };
}

export const SYSTEM_PACKS: Record<string, SystemPack> = {
  /** DND 奇幻：标准骨架，英雄层靠高等级单位表达 */
  dnd: pack('dnd', 'DND奇幻', {}),
  /** 现实12世纪：板甲链甲有效，弓弩破甲有限 */
  medieval: pack('medieval', '现实12世纪', {}),
  /** 现实17世纪：火器让护甲减伤大幅贬值 */
  gunpowder: pack('gunpowder', '现实17世纪', { armorDR: [0, 0.1, 0.18, 0.25, 0.3] }),
  /** 现实21世纪：防弹材料只挡破片，命中斜率更陡（火力代差拉开） */
  modern: pack('modern', '现实21世纪', { armorDR: [0, 0.05, 0.12, 0.18, 0.25] }, { perDiff: 0.06 }),
  /** 战锤40K：动力甲普及，减伤表整体上移（T4 0.65：同级破甲近战不再陷入数百回合磨血） */
  w40k: pack('w40k', '战锤40K', { armorDR: [0, 0.25, 0.4, 0.55, 0.65] }),
  /** 赛博朋克：街头护甲拦不住枪，命中斜率陡（谁先手谁占尽便宜） */
  cyber: pack('cyber', '赛博朋克', { armorDR: [0, 0.05, 0.1, 0.15, 0.25] }, { perDiff: 0.06 }),
};

export function getSystemPack(id?: string): SystemPack {
  return SYSTEM_PACKS[id ?? 'medieval'] ?? SYSTEM_PACKS.medieval!;
}
