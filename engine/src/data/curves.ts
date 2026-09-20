/**
 * 等级基准曲线：威胁等级 L1~L10 的标准数值区间。
 * 造怪器以此为骨架，再叠原型/刻度/特质修正与小范围随机浮动。
 */

export interface CurveRow {
  level: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  /** 普通段伤害骰 */
  dmgBase: string;
  /** 破甲段伤害骰（空串=无） */
  dmgAp: string;
  xp: number;
  /** 连队刻度基准兵员数 */
  men: number;
  /** 连队基准士气上限 */
  morale: number;
}

export const CURVES: CurveRow[] = [
  { level: 1, atk: 3, def: 11, spd: 2, hp: 16, dmgBase: '1d6+1', dmgAp: '', xp: 25, men: 50, morale: 60 },
  { level: 2, atk: 4, def: 12, spd: 2, hp: 22, dmgBase: '1d8+1', dmgAp: '1d4', xp: 50, men: 60, morale: 63 },
  { level: 3, atk: 5, def: 13, spd: 3, hp: 28, dmgBase: '1d8+2', dmgAp: '1d4', xp: 100, men: 70, morale: 66 },
  { level: 4, atk: 6, def: 14, spd: 3, hp: 35, dmgBase: '2d6+2', dmgAp: '1d4', xp: 200, men: 80, morale: 69 },
  { level: 5, atk: 7, def: 15, spd: 3, hp: 42, dmgBase: '2d6+3', dmgAp: '1d6', xp: 350, men: 90, morale: 72 },
  { level: 6, atk: 8, def: 16, spd: 4, hp: 50, dmgBase: '2d8+3', dmgAp: '1d6', xp: 600, men: 100, morale: 75 },
  { level: 7, atk: 9, def: 17, spd: 4, hp: 58, dmgBase: '3d6+4', dmgAp: '2d4', xp: 900, men: 110, morale: 78 },
  { level: 8, atk: 10, def: 18, spd: 4, hp: 66, dmgBase: '3d6+5', dmgAp: '2d6', xp: 1400, men: 120, morale: 81 },
  { level: 9, atk: 11, def: 19, spd: 5, hp: 75, dmgBase: '4d6+5', dmgAp: '2d6', xp: 2000, men: 130, morale: 84 },
  { level: 10, atk: 12, def: 20, spd: 5, hp: 84, dmgBase: '4d6+6', dmgAp: '3d6', xp: 3000, men: 140, morale: 87 },
];

export function curveAt(level: number): CurveRow {
  const l = Math.max(1, Math.min(10, Math.round(level)));
  return CURVES[l - 1]!;
}

/** 原型修正：数值倾向（冷热兵器时代通用，机制中立） */
export const ARCHETYPE_MODS = {
  infantry: { atk: 0, def: 2, spd: -1, hp: 4, dmgFlat: 1, armorTier: 1, apBonus: 0 },
  ranged: { atk: 1, def: -1, spd: 0, hp: 0, dmgFlat: 0, armorTier: 0, apBonus: -1 },
  mobile: { atk: 1, def: 0, spd: 3, hp: 2, dmgFlat: 0, armorTier: 1, apBonus: 0 },
} as const;

/** 刻度修正 */
export const SCALE_MODS = {
  hero: { hpMult: 1, atkAdj: 0, defAdj: 0, xpMult: 1 },
  mook: { hpMult: 0, atkAdj: -2, defAdj: -2, xpMult: 0.25 },
  company: { hpMult: 1, atkAdj: 0, defAdj: 0, xpMult: 3 },
} as const;

/** 升级难度以同级奖励为基准，防止后期奖励增长快于升级所需经验。 */
export const MAX_TRAINING_LEVEL = CURVES.length;
export const XP_LEVEL_EFFORT = [12, 14, 16, 18, 20, 22, 24, 26, 28] as const;
export const XP_LEVEL_COSTS = XP_LEVEL_EFFORT.map((effort, index) => effort * curveAt(index + 1).xp);
/** 从训练1连续成长的累计阈值；索引0是训练1，索引9是训练10。 */
export const XP_THRESHOLDS = XP_LEVEL_COSTS.reduce<number[]>((totals, cost) => [...totals, totals[totals.length - 1]! + cost], [0]);
/** 仅供旧档本级进度换算。旧85000是不可达的第11级门槛，不再使用。 */
export const LEGACY_XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];
