/**
 * 骰子表达式解析与掷骰。
 * 支持子集（与 rpg-dice-roller 记法兼容）：
 *   NdM、NdM+K、NdM-K、NdMkh#（保留最高#枚）、NdMkl#（保留最低#枚）
 * 例："1d20+5"、"2d6+3"、"2d20kh1"、"4d6kl3"
 */

import type { Rng } from './rng.js';

export interface DiceExpr {
  count: number;
  sides: number;
  keepHigh?: number;
  keepLow?: number;
  flat: number;
  /** 原始表达式（审计显示用） */
  source: string;
}

/** 单次掷骰的完整记录（审计与结算卡显示用） */
export interface DiceRollDetail {
  expr: string;
  /** 全部骰面 */
  rolls: number[];
  /** 实际计入的骰面（keep 之后） */
  kept: number[];
  flat: number;
  total: number;
}

const RE = /^(\d+)d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?$/i;

// 解析结果只读：同一表达式在预览抽样中会被反复掷出，冻结后共用。
const parsed = new Map<string, DiceExpr>();

export function parseDice(expr: string): DiceExpr {
  const known = parsed.get(expr); if (known) return known;
  const s = expr.replace(/\s+/g, '');
  const m = RE.exec(s);
  if (!m) throw new Error(`无法解析骰子表达式: "${expr}"`);
  const count = parseInt(m[1]!, 10);
  const sides = parseInt(m[2]!, 10);
  if (count < 1 || count > 1000) throw new Error(`骰子数量越界: ${count}`);
  if (sides < 2 || sides > 10000) throw new Error(`骰面越界: ${sides}`);
  const keepMode = m[3]?.toLowerCase();
  const keepN = m[4] ? parseInt(m[4], 10) : undefined;
  if (keepN !== undefined && (keepN < 1 || keepN > count)) {
    throw new Error(`保留数量必须在 1..${count}: ${keepN}`);
  }
  const flat = m[5] ? parseInt(m[5], 10) : 0;
  const result: DiceExpr = Object.freeze({
    count,
    sides,
    keepHigh: keepMode === 'kh' ? keepN : undefined,
    keepLow: keepMode === 'kl' ? keepN : undefined,
    flat,
    source: s,
  });
  if (parsed.size >= 512) parsed.clear();
  parsed.set(expr, result);
  return result;
}

export function rollDice(expr: string, rng: Rng): DiceRollDetail {
  const e = parseDice(expr);
  const rolls: number[] = [];
  for (let i = 0; i < e.count; i++) rolls.push(rng.d(e.sides));

  let kept = [...rolls];
  if (e.keepHigh !== undefined && e.keepHigh < rolls.length) {
    const sorted = [...rolls].sort((a, b) => b - a);
    kept = sorted.slice(0, e.keepHigh);
  } else if (e.keepLow !== undefined && e.keepLow < rolls.length) {
    const sorted = [...rolls].sort((a, b) => a - b);
    kept = sorted.slice(0, e.keepLow);
  }

  const total = kept.reduce((s, v) => s + v, 0) + e.flat;
  return { expr: e.source, rolls, kept: [...kept], flat: e.flat, total };
}

/**
 * 掷骰并返回仅骰面部分（不含固定加值）——暴击翻倍用：
 * 普攻骰面 ×2，固定加值不翻倍。
 */
export function rollDicePortion(expr: string, rng: Rng, times = 1): DiceRollDetail {
  const e = parseDice(expr);
  const details: DiceRollDetail[] = [];
  for (let t = 0; t < times; t++) details.push(rollDice(`${e.count}d${e.sides}${suffix(e)}`, rng));
  const merged: DiceRollDetail = {
    expr: `${e.source}${times > 1 ? `×${times}` : ''}`,
    rolls: details.flatMap((d) => d.rolls),
    kept: details.flatMap((d) => d.kept),
    flat: e.flat,
    // 骰面按次数翻倍，固定加值只计一次
    total: details.reduce((s, d) => s + d.total, 0) + e.flat,
  };
  return merged;
}

function suffix(e: DiceExpr): string {
  if (e.keepHigh !== undefined) return `kh${e.keepHigh}`;
  if (e.keepLow !== undefined) return `kl${e.keepLow}`;
  return '';
}

const meanCache = new Map<string, number>();
/** Exact keep-high/low mean, with stable mode-centred binomial weights. */
export function diceMean(expr: string): number {
  const cached = meanCache.get(expr); if (cached !== undefined) return cached;
  const e = parseDice(expr), keep = e.keepHigh ?? e.keepLow ?? e.count;
  if (keep === e.count) return e.count * (e.sides + 1) / 2 + e.flat;
  let high = keep;
  for (let face = 2; face <= e.sides; face++) {
    const p = (e.sides - face + 1) / e.sides, q = 1 - p, mode = Math.floor((e.count + 1) * p);
    let total = 1, weighted = Math.min(keep, mode), weight = 1;
    for (let i = mode; i > 0; i--) { weight *= i * q / ((e.count - i + 1) * p); total += weight; weighted += weight * Math.min(keep, i - 1); }
    weight = 1;
    for (let i = mode; i < e.count; i++) { weight *= (e.count - i) * p / ((i + 1) * q); total += weight; weighted += weight * Math.min(keep, i + 1); }
    high += weighted / total;
  }
  const mean = (e.keepLow !== undefined ? keep * (e.sides + 1) - high : high) + e.flat;
  if (meanCache.size >= 256) meanCache.clear(); meanCache.set(expr, mean); return mean;
}
