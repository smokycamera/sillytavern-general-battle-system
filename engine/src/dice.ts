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

export function parseDice(expr: string): DiceExpr {
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
  return {
    count,
    sides,
    keepHigh: keepMode === 'kh' ? keepN : undefined,
    keepLow: keepMode === 'kl' ? keepN : undefined,
    flat,
    source: s,
  };
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
