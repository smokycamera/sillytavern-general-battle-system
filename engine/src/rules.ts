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

/** id → 规则包（战斗快照恢复用；面板只用默认两包） */
export const RULES_BY_ID: Record<string, RulePack> = {
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
  if (id && /^v[234]-/.test(id) && !RULES_BY_ID[id]) throw new Error(`不支持的规则版本 ${id}，不能静默回退`);
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
