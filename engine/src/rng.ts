/**
 * 种子随机源：crypto 真随机（实战）+ 可复现种子（测试与审计回放）。
 * 所有骰子必须经由此处掷出，禁止直接 Math.random。
 */

export interface Rng {
  /** 返回 [0, 1) 浮点 */
  next(): number;
  /** 掷一枚 sides 面骰，返回 1..sides */
  d(sides: number): number;
  /** 当前种子（seeded 源可复现，crypto 源为 'crypto'） */
  readonly seed: string;
}

/** 字符串种子 → 32 位整数（FNV-1a） */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class SeededRng implements Rng {
  readonly seed: string;
  private s: number;

  constructor(seed: string) {
    this.seed = seed;
    this.s = hashSeed(seed);
  }

  next(): number {
    // 内联 mulberry32 单步：状态可序列化（快照回放需要逐步还原）
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  d(sides: number): number {
    return 1 + Math.floor(this.next() * sides);
  }

  /** 当前内部状态（快照序列化用；恢复后掷骰序列与快照时刻完全一致） */
  getState(): number {
    return this.s >>> 0;
  }

  setState(v: number): void {
    this.s = v | 0;
  }
}

export class CryptoRng implements Rng {
  readonly seed = 'crypto';

  next(): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] ?? 0) / 0x100000000;
  }

  d(sides: number): number {
    return 1 + Math.floor(this.next() * sides);
  }
}

/** 随机生成一个十六进制种子（开战/造怪时用） */
export function randomSeed(len = 8): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 默认实战随机源（无 crypto 环境退化为种子随机） */
export function liveRng(): Rng {
  try {
    return new CryptoRng();
  } catch {
    return new SeededRng(randomSeed());
  }
}
