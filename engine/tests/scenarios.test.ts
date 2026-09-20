/**
 * 多体系 × 多规模场景矩阵模拟（评审用基准，非回归断言）。
 *
 * 体系：DND / 战锤40K / 赛博朋克 / 现实12世纪 / 现实17世纪 / 现实21世纪
 *   —— 引擎皮肤本身是纯术语层（机制零差异），因此各体系差异通过
 *      ① 规则包变体（护甲减伤表 / 命中斜率）② 单位配方（等级/护甲/loadout/特质）构造。
 * 场景：1v1 / 1v3 / 3v3 / 1v10 / 10v10 / 团v团 / 军v团 / 军v军
 *   —— 团 = 3 连队；军 = 9 连队。小规模用 SmallBattle.autoAction 驱动，
 *      军团用 MassBattle.autoOrders + resolveRound 驱动。
 * 每场以不同种子重复 RUNS 次，统计胜率 / 回合数 / 剩余战力 / 射击伤害占比。
 */
import { describe, it, expect } from 'vitest';
import { SmallBattle } from '../src/small/battle';
import { MassBattle } from '../src/mass/battle';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { SYSTEM_PACKS } from '../src/rules';
import type { Combatant, GenerateInput, Side } from '../src/types';

const reg = traitRegistry();
const RUNS = 30;

// ---------- 体系定义 ----------
// 数值差异分两层：规则包（SYSTEM_PACKS：护甲/命中斜率/近战惩罚）+ 武器原型（weaponId：伤害/破甲/射程）。

interface UnitSpec {
  archetype: 'infantry' | 'ranged' | 'mobile';
  level: number;
  loadout?: 'melee' | 'ranged';
  armorTier?: 0 | 1 | 2 | 3 | 4;
  traits?: string[];
  weaponId?: string;
  abilityIds?: string[];
}

interface SysDef {
  id: string;
  name: string;
  era: string;
  packId: keyof typeof SYSTEM_PACKS;
  /** 体系单兵精英等级（1v10 用）：体现"该时代一个顶尖战士值多少杂兵" */
  eliteLv: number;
  hero: (lv: number) => UnitSpec;
  mook: () => UnitSpec;
  /** 团（3 连队）编制配方；军 = 3 × 团 */
  roster: UnitSpec[];
}

const SYSTEMS: SysDef[] = [
  {
    id: 'dnd', name: 'DND奇幻', era: 'medieval', packId: 'dnd',
    eliteLv: 8,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'melee', traits: ['veteran'] }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'melee' }),
    roster: [
      { archetype: 'infantry', level: 4 },
      { archetype: 'ranged', level: 3 },
      { archetype: 'mobile', level: 5 },
    ],
  },
  {
    id: 'w40k', name: '战锤40K', era: 'scifi', packId: 'w40k',
    eliteLv: 8,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'melee', armorTier: 4, traits: ['elite'], weaponId: 'wpn-chainsword' }),
    mook: () => ({ archetype: 'infantry', level: 1, loadout: 'ranged', armorTier: 1, weaponId: 'wpn-lasgun' }),
    roster: [
      { archetype: 'infantry', level: 5, armorTier: 4, loadout: 'ranged', weaponId: 'wpn-bolter' },
      { archetype: 'ranged', level: 4 },
      { archetype: 'mobile', level: 5 },
    ],
  },
  {
    id: 'cyber', name: '赛博朋克', era: 'scifi', packId: 'cyber',
    eliteLv: 6,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'ranged', armorTier: 1, weaponId: 'wpn-smartgun' }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'ranged', armorTier: 0, weaponId: 'wpn-smartgun' }),
    roster: [
      { archetype: 'infantry', level: 3, loadout: 'ranged', weaponId: 'wpn-smartgun' },
      { archetype: 'ranged', level: 3 },
      { archetype: 'mobile', level: 3, loadout: 'ranged' },
    ],
  },
  {
    id: 'c12', name: '现实12世纪', era: 'medieval', packId: 'medieval',
    eliteLv: 7,
    hero: (lv) => ({ archetype: 'mobile', level: lv, loadout: 'melee', armorTier: 3, traits: ['charge-strong'] }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'melee', armorTier: 1 }),
    roster: [
      { archetype: 'infantry', level: 3 },
      { archetype: 'ranged', level: 2 },
      { archetype: 'mobile', level: 4 },
    ],
  },
  {
    id: 'c17', name: '现实17世纪', era: 'gunpowder', packId: 'gunpowder',
    eliteLv: 6,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'ranged', armorTier: 1 }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'ranged', armorTier: 0 }),
    roster: [
      { archetype: 'infantry', level: 3, loadout: 'ranged' },
      { archetype: 'ranged', level: 4 },
      { archetype: 'mobile', level: 3 },
    ],
  },
  {
    id: 'c21', name: '现实21世纪', era: 'modern', packId: 'modern',
    eliteLv: 6,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'ranged', armorTier: 2 }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'ranged', armorTier: 1 }),
    roster: [
      { archetype: 'infantry', level: 4, loadout: 'ranged' },
      { archetype: 'ranged', level: 5 },
      { archetype: 'mobile', level: 4, loadout: 'ranged' },
    ],
  },
];

// ---------- 单位生成 ----------

function genUnit(sys: SysDef, name: string, side: Side, scale: 'hero' | 'mook' | 'company', spec: UnitSpec, seed: string): Combatant {
  const inp: GenerateInput = {
    name,
    side,
    scale,
    archetype: spec.archetype,
    level: spec.level,
    traits: spec.traits ?? [],
    era: sys.era,
    loadout: spec.loadout,
    ...(spec.weaponId !== undefined ? { weaponId: spec.weaponId } : {}),
    ...(spec.abilityIds !== undefined && spec.abilityIds.length > 0 ? { abilityIds: spec.abilityIds } : {}),
    ...(spec.armorTier !== undefined ? { armorTier: spec.armorTier } : {}),
  };
  return generateUnit(inp, { seed, registry: reg }).unit;
}

/** 军编制：reps × 团编制 */
function armyRoster(sys: SysDef, reps: number): UnitSpec[] {
  const out: UnitSpec[] = [];
  for (let i = 0; i < reps; i++) out.push(...sys.roster);
  return out;
}

// ---------- 场景构建 ----------

type ScenKey = '1v1' | '1v3' | '3v3' | '1v10' | '10v10';

// ---------- 场景变体（环境标签 / 支援技能） ----------

interface VariantOpts {
  /** 我方全员附加特质 */
  allyTraits?: string[];
  /** 敌方全员附加特质 */
  enemyTraits?: string[];
  /** 战场环境标签 */
  field?: string[];
  /** 我方全员附加技能模板 */
  allyAbilities?: string[];
  /** 敌方全员附加技能模板 */
  enemyAbilities?: string[];
}

function applySide(v: VariantOpts | undefined, side: Side): { traits: string[]; abilities: string[] } {
  const mine = side === 'ally' ? v?.allyTraits : v?.enemyTraits;
  const myAb = side === 'ally' ? v?.allyAbilities : v?.enemyAbilities;
  return { traits: mine ?? [], abilities: myAb ?? [] };
}

function buildSmall(sys: SysDef, key: ScenKey, runSeed: string, v?: VariantOpts): Combatant[] {
  const mk = (name: string, side: Side, spec: UnitSpec, scale: 'hero' | 'mook') => {
    const extra = applySide(v, side);
    return genUnit(
      sys, name, side, scale,
      { ...spec, traits: [...(spec.traits ?? []), ...extra.traits], abilityIds: extra.abilities },
      `${runSeed}:${side}:${name}`,
    );
  };
  const units: Combatant[] = [];
  const m = sys.mook();
  const heroLv = key === '1v10' ? sys.eliteLv : key === '1v3' ? 6 : 5;
  if (key === '1v1') {
    units.push(mk('我方勇士', 'ally', sys.hero(heroLv), 'hero'));
    units.push(mk('敌方勇士', 'enemy', sys.hero(heroLv), 'hero'));
  } else if (key === '1v3') {
    units.push(mk('我方英雄', 'ally', sys.hero(heroLv), 'hero'));
    for (let i = 1; i <= 3; i++) units.push(mk(`敌兵${i}`, 'enemy', m, 'mook'));
  } else if (key === '3v3') {
    units.push(mk('我方队长', 'ally', sys.hero(5), 'hero'), mk('我方兵1', 'ally', m, 'mook'), mk('我方兵2', 'ally', m, 'mook'));
    units.push(mk('敌方队长', 'enemy', sys.hero(5), 'hero'), mk('敌兵1', 'enemy', m, 'mook'), mk('敌兵2', 'enemy', m, 'mook'));
  } else if (key === '1v10') {
    units.push(mk('我方传奇', 'ally', sys.hero(heroLv), 'hero'));
    for (let i = 1; i <= 10; i++) units.push(mk(`敌兵${i}`, 'enemy', m, 'mook'));
  } else {
    for (let i = 1; i <= 10; i++) units.push(mk(`我方兵${i}`, 'ally', m, 'mook'));
    for (let i = 1; i <= 10; i++) units.push(mk(`敌兵${i}`, 'enemy', m, 'mook'));
  }
  return units;
}

function buildMass(sys: SysDef, allyReps: number, enemyReps: number, runSeed: string, v?: VariantOpts): Combatant[] {
  const units: Combatant[] = [];
  armyRoster(sys, allyReps).forEach((spec, i) => {
    const extra = applySide(v, 'ally');
    units.push(genUnit(sys, `我军${i + 1}队`, 'ally', 'company', { ...spec, traits: [...(spec.traits ?? []), ...extra.traits], abilityIds: extra.abilities }, `${runSeed}:a${i}`));
  });
  armyRoster(sys, enemyReps).forEach((spec, i) => {
    const extra = applySide(v, 'enemy');
    units.push(genUnit(sys, `敌军${i + 1}队`, 'enemy', 'company', { ...spec, traits: [...(spec.traits ?? []), ...extra.traits], abilityIds: extra.abilities }, `${runSeed}:e${i}`));
  });
  return units;
}

// ---------- 战斗驱动与统计 ----------

interface SideStat {
  pct: number;
  alive: number;
  dead: number;
  routed: number;
  total: number;
}

function sideStat(cs: Combatant[], side: Side): SideStat {
  const mine = cs.filter((c) => c.side === side);
  const hp = mine.reduce((s, c) => s + Math.max(0, c.hp), 0);
  const max = mine.reduce((s, c) => s + c.base.hpMax, 0);
  return {
    pct: max > 0 ? hp / max : 0,
    alive: mine.filter((c) => c.status === 'ready').length,
    dead: mine.filter((c) => c.status === 'dead' || c.status === 'dying').length,
    routed: mine.filter((c) => c.status === 'routing' || c.status === 'fled').length,
    total: mine.length,
  };
}

interface RunResult {
  winner: 'ally' | 'enemy' | 'draw';
  rounds: number;
  timeout: boolean;
  ally: SideStat;
  enemy: SideStat;
  totalDmg: number;
  rangedDmg: number;
}

function dmgStats(units: Combatant[], log: { kind: string; resolution?: { attackerId: string; finalDamage: number } }[]): { totalDmg: number; rangedDmg: number } {
  let total = 0;
  let ranged = 0;
  for (const e of log) {
    if (e.kind !== 'attack' || !e.resolution) continue;
    total += e.resolution.finalDamage;
    const att = units.find((c) => c.id === e.resolution!.attackerId);
    if (att?.weapon?.tags?.includes('ranged')) ranged += e.resolution.finalDamage;
  }
  return { totalDmg: total, rangedDmg: ranged };
}

function runSmall(sys: SysDef, key: ScenKey, runSeed: string, v?: VariantOpts): RunResult {
  const b = new SmallBattle({
    combatants: buildSmall(sys, key, runSeed, v), seed: runSeed,
    rules: SYSTEM_PACKS[sys.packId]!.small, traitRegistry: reg,
    ...(v?.field ? { field: { tags: v.field } } : {}),
  });
  b.start();
  let guard = 0;
  let stall = 0;
  let lastKey = '';
  while (!b.isOver() && guard++ < 900) {
    const u = b.active;
    if (!u || u.status !== 'ready') break;
    const k = `${b.round}:${b.turnIndex}`;
    if (k === lastKey && ++stall > 60) break;
    lastKey = k;
    b.autoAction(u.id);
  }
  const d = dmgStats(b.combatants, b.log);
  return {
    winner: b.winner() ?? 'draw',
    rounds: b.round,
    timeout: !b.isOver(),
    ally: sideStat(b.combatants, 'ally'),
    enemy: sideStat(b.combatants, 'enemy'),
    ...d,
  };
}

function runMass(sys: SysDef, allyReps: number, enemyReps: number, runSeed: string, v?: VariantOpts): RunResult {
  const b = new MassBattle({
    combatants: buildMass(sys, allyReps, enemyReps, runSeed, v), seed: runSeed,
    rules: SYSTEM_PACKS[sys.packId]!.mass, traitRegistry: reg,
    ...(v?.field ? { field: { tags: v.field } } : {}),
  });
  b.start();
  let guard = 0;
  while (!b.isOver() && guard++ < 80) {
    b.autoOrders('ally');
    b.autoOrders('enemy');
    b.resolveRound();
  }
  const d = dmgStats(b.combatants, b.log);
  return {
    winner: b.winner() ?? 'draw',
    rounds: b.round,
    timeout: !b.isOver(),
    ally: sideStat(b.combatants, 'ally'),
    enemy: sideStat(b.combatants, 'enemy'),
    ...d,
  };
}

// ---------- 汇总 ----------

function agg(runs: RunResult[]) {
  const n = runs.length;
  const ally = runs.filter((r) => r.winner === 'ally').length;
  const draw = runs.filter((r) => r.winner === 'draw').length;
  const avg = (f: (r: RunResult) => number) => runs.reduce((s, r) => s + f(r), 0) / n;
  return {
    n,
    allyWin: (ally / n) * 100,
    draw: (draw / n) * 100,
    rounds: avg((r) => r.rounds),
    allyPct: avg((r) => r.ally.pct) * 100,
    enemyPct: avg((r) => r.enemy.pct) * 100,
    allyDead: avg((r) => r.ally.dead),
    enemyDead: avg((r) => r.enemy.dead),
    allyRout: avg((r) => r.ally.routed),
    enemyRout: avg((r) => r.enemy.routed),
    shotPct: (avg((r) => r.rangedDmg) / Math.max(1, avg((r) => r.totalDmg))) * 100,
    timeouts: runs.filter((r) => r.timeout).length,
  };
}

function fmtRow(sysName: string, scen: string, a: ReturnType<typeof agg>): string {
  const p = (x: number, d = 0) => x.toFixed(d);
  return `| ${sysName} | ${scen} | ${p(a.allyWin)}% | ${p(a.draw)}% | ${p(a.rounds, 1)} | ${p(a.allyPct)}% | ${p(a.enemyPct)}% | ${p(a.shotPct)}% | ${a.timeouts} | ${a.allyDead.toFixed(1)}/${a.enemyDead.toFixed(1)} | ${a.allyRout.toFixed(1)}/${a.enemyRout.toFixed(1)} |`;
}

const HEADER = '| 体系 | 场景 | 我方胜 | 平 | 回合 | 我方余 | 敌方余 | 射击伤害占比 | 超时 | 击杀(我/敌) | 溃逃(我/敌) |\n|---|---|---|---|---|---|---|---|---|---|---|';

const ALL_ROWS: string[] = [];

function runScenario(sys: SysDef, scen: string, kind: 'small' | 'mass', key: ScenKey | [number, number], v?: VariantOpts): void {
  const runs: RunResult[] = [];
  for (let i = 0; i < RUNS; i++) {
    const seed = `${sys.id}-${scen}-r${i}`;
    const r = kind === 'small' ? runSmall(sys, key as ScenKey, seed, v) : runMass(sys, (key as [number, number])[0], (key as [number, number])[1], seed, v);
    runs.push(r);
  }
  ALL_ROWS.push(fmtRow(sys.name, scen, agg(runs)));
}

describe('多体系 × 多规模场景矩阵', () => {
  it('小规模：1v1 / 1v3 / 3v3 / 1v10 / 10v10', { timeout: 600_000 }, () => {
    for (const sys of SYSTEMS) {
      runScenario(sys, '1v1', 'small', '1v1');
      runScenario(sys, '1v3', 'small', '1v3');
      runScenario(sys, '3v3', 'small', '3v3');
      runScenario(sys, '1v10', 'small', '1v10');
      runScenario(sys, '10v10', 'small', '10v10');
    }
    expect(ALL_ROWS.length).toBe(30);
  });

  it('军团：团v团 / 军v团 / 军v军', { timeout: 600_000 }, () => {
    for (const sys of SYSTEMS) {
      runScenario(sys, '团v团(3v3连)', 'mass', [1, 1]);
      runScenario(sys, '军v团(9v3连)', 'mass', [3, 1]);
      runScenario(sys, '军v军(9v9连)', 'mass', [3, 3]);
    }
    expect(ALL_ROWS.length).toBe(48);
  });

  it('环境与支援变体：巷战 / 攻城 / 跨刻度支援火力', { timeout: 600_000 }, () => {
    // 巷战：我方全员「巷战大师」（对照主表 10v10 无环境基线，胜率应显著上移）
    for (const sys of SYSTEMS) {
      runScenario(sys, '10v10巷战(我方大师)', 'small', '10v10', { allyTraits: ['urban-fighter'], field: ['urban'] });
    }
    // 攻城：守方（敌方）全员「守城工事」（对照主表 团v团，守方胜率应显著上移）
    for (const sys of SYSTEMS.filter((s) => s.id === 'c12' || s.id === 'dnd')) {
      runScenario(sys, '团v团攻城(守方工事)', 'mass', [1, 1], { enemyTraits: ['fortification'], field: ['siege'] });
    }
    // 跨刻度支援：军v军 双方全员挂支援技能（对照主表 军v军，回合数应显著下降）
    const support: Record<string, string> = { w40k: 'orbital-strike', c21: 'artillery-barrage', dnd: 'fireball' };
    for (const sys of SYSTEMS.filter((s) => support[s.id])) {
      runScenario(sys, `军v军支援(${support[sys.id]})`, 'mass', [3, 3], {
        allyAbilities: [support[sys.id]!], enemyAbilities: [support[sys.id]!],
      });
    }
    console.log('\n==== 场景矩阵结果 ====\n' + HEADER + '\n' + ALL_ROWS.join('\n') + '\n');
  });
});
