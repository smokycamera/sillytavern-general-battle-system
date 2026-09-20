/**
 * 体系 × 场景矩阵模拟（用户基准报告生成器，非回归断言）。
 *
 * 体系（含指定要素）：DND（法术/法杖）· 战锤40K（链锯剑+终结者甲）· 赛博朋克（皮下装甲义体）
 *   · 现实12世纪 · 现实17世纪（长枪/火绳枪/射石炮）· 现实21世纪（机步/坦克/反坦克导弹）
 * 场景：1v1 / 1v3 / 3v3 / 1v10 / 10v10（小规模）；团v团 / 军v团 / 军v军（军团，团=3连、军=9连）
 * 每场换种子重复 RUNS 次，统计胜率/回合/剩余战力/伤亡结构/射击伤害占比，报告写入 engine/sim/out/。
 */
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SmallBattle } from '../src/small/battle';
import { MassBattle } from '../src/mass/battle';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { SYSTEM_PACKS } from '../src/rules';
import type { Combatant, GenerateInput, Side } from '../src/types';

const reg = traitRegistry();
const RUNS = 400;

// ---------- 体系定义（数值差异 = 规则包 + 武器/护甲原型 + 编制配方） ----------

interface UnitSpec {
  archetype: 'infantry' | 'ranged' | 'mobile';
  level: number;
  loadout?: 'melee' | 'ranged';
  armorTier?: 0 | 1 | 2 | 3 | 4;
  armorId?: string;
  traits?: string[];
  weaponId?: string;
  abilityIds?: string[];
  persona?: string[];
}

interface SysDef {
  id: string;
  name: string;
  note: string;
  era: string;
  packId: keyof typeof SYSTEM_PACKS;
  /** 体系顶尖单兵等级（1v10 用） */
  eliteLv: number;
  hero: (lv: number) => UnitSpec;
  mook: () => UnitSpec;
  /** 10v10 混编池（缺省 [mook]）：17 世纪 = 长枪+火绳枪混编（pike and shot） */
  mookPool?: UnitSpec[];
  roster: UnitSpec[];
}

const SYSTEMS: SysDef[] = [
  {
    id: 'dnd', name: 'DND奇幻', note: '魔法：英雄法师（火球术+烈焰风暴蓝图）与法师连队（军团支援阶段自动施放）',
    era: 'medieval', packId: 'dnd', eliteLv: 8,
    hero: (lv) => ({
      archetype: 'ranged', level: lv, loadout: 'ranged', weaponId: 'wpn-staff', armorTier: 0,
      traits: ['veteran'], abilityIds: ['fireball'], persona: ['火焰', '法师'],
    }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'melee' }),
    roster: [
      { archetype: 'infantry', level: 4, loadout: 'melee' },
      { archetype: 'ranged', level: 4, loadout: 'ranged', weaponId: 'wpn-staff', abilityIds: ['fireball'] },
      { archetype: 'mobile', level: 5, loadout: 'melee' },
    ],
  },
  {
    id: 'w40k', name: '战锤40K', note: '英雄=终结者甲+链锯剑；杂兵=激光枪卫队；编制=爆弹战术连/卫队/悬浮机车',
    era: 'scifi', packId: 'w40k', eliteLv: 8,
    hero: (lv) => ({
      archetype: 'infantry', level: lv, loadout: 'melee', weaponId: 'wpn-chainsword',
      armorId: 'arm-terminator', armorTier: 4, traits: ['elite'],
    }),
    mook: () => ({ archetype: 'infantry', level: 1, loadout: 'ranged', weaponId: 'wpn-lasgun', armorTier: 1 }),
    roster: [
      { archetype: 'infantry', level: 5, loadout: 'ranged', weaponId: 'wpn-bolter', armorId: 'arm-arament', armorTier: 4 },
      { archetype: 'infantry', level: 2, loadout: 'ranged', weaponId: 'wpn-lasgun', armorTier: 1 },
      { archetype: 'mobile', level: 4, loadout: 'ranged' },
    ],
  },
  {
    id: 'cyber', name: '赛博朋克', note: '英雄/精锐=皮下装甲义体+智能枪；杂兵=无甲持枪帮众',
    era: 'scifi', packId: 'cyber', eliteLv: 6,
    hero: (lv) => ({
      archetype: 'infantry', level: lv, loadout: 'ranged', weaponId: 'wpn-smartgun',
      armorId: 'arm-subdermal', traits: ['veteran'],
    }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'ranged', weaponId: 'wpn-smartgun', armorTier: 0 }),
    roster: [
      { archetype: 'infantry', level: 3, loadout: 'ranged', weaponId: 'wpn-smartgun', armorId: 'arm-subdermal' },
      { archetype: 'ranged', level: 3, loadout: 'ranged', weaponId: 'wpn-railgun' },
      { archetype: 'mobile', level: 3, loadout: 'ranged' },
    ],
  },
  {
    id: 'c12', name: '现实12世纪', note: '板甲重骑 vs 民兵：经典中世纪',
    era: 'medieval', packId: 'medieval', eliteLv: 7,
    hero: (lv) => ({ archetype: 'mobile', level: lv, loadout: 'melee', armorId: 'arm-plate', armorTier: 3, traits: ['charge-strong'] }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'melee', armorTier: 1 }),
    roster: [
      { archetype: 'infantry', level: 3, loadout: 'melee' },
      { archetype: 'ranged', level: 2 },
      { archetype: 'mobile', level: 4, loadout: 'melee' },
    ],
  },
  {
    id: 'c17', name: '现实17世纪', note: '长枪方阵（拒马/克骑）+火绳枪（隔回合一发）+射石炮（重装填）',
    era: 'gunpowder', packId: 'gunpowder', eliteLv: 6,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'ranged', weaponId: 'wpn-matchlock', armorTier: 1 }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'melee', weaponId: 'wpn-pike', armorTier: 0 }),
    mookPool: [
      { archetype: 'infantry', level: 2, loadout: 'melee', weaponId: 'wpn-pike', armorTier: 0 },
      { archetype: 'infantry', level: 2, loadout: 'ranged', weaponId: 'wpn-matchlock', armorTier: 0 },
    ],
    roster: [
      { archetype: 'infantry', level: 3, loadout: 'melee', weaponId: 'wpn-pike', traits: ['anti-mobile', 'pike-wall'] },
      { archetype: 'infantry', level: 3, loadout: 'ranged', weaponId: 'wpn-matchlock' },
      { archetype: 'ranged', level: 4, loadout: 'ranged', weaponId: 'wpn-stonegun' },
    ],
  },
  {
    id: 'c21', name: '现实21世纪', note: '机步连（机械化）/坦克连（泰坦+坦克炮+复合装甲）/反坦克连（ATGM+克大型）',
    era: 'modern', packId: 'modern', eliteLv: 6,
    hero: (lv) => ({ archetype: 'infantry', level: lv, loadout: 'ranged', armorTier: 2, traits: ['veteran'] }),
    mook: () => ({ archetype: 'infantry', level: 2, loadout: 'ranged', armorTier: 1 }),
    roster: [
      { archetype: 'infantry', level: 4, loadout: 'ranged', traits: ['mechanized'] },
      { archetype: 'mobile', level: 5, loadout: 'ranged', weaponId: 'wpn-tankgun', armorId: 'arm-composite', armorTier: 4, traits: ['titan'] },
      { archetype: 'ranged', level: 4, loadout: 'ranged', weaponId: 'wpn-atgm', traits: ['anti-large'] },
    ],
  },
];

// ---------- 单位生成 ----------

function genUnit(sys: SysDef, name: string, side: Side, scale: 'hero' | 'mook' | 'company', spec: UnitSpec, seed: string): Combatant {
  const inp: GenerateInput = {
    name, side, scale,
    archetype: spec.archetype,
    level: spec.level,
    traits: spec.traits ?? [],
    era: sys.era,
    loadout: spec.loadout,
    ...(spec.weaponId !== undefined ? { weaponId: spec.weaponId } : {}),
    ...(spec.armorId !== undefined ? { armorId: spec.armorId } : {}),
    ...(spec.armorTier !== undefined ? { armorTier: spec.armorTier } : {}),
    ...(spec.abilityIds !== undefined && spec.abilityIds.length > 0 ? { abilityIds: spec.abilityIds } : {}),
    ...(spec.persona !== undefined ? { persona: spec.persona } : {}),
  };
  return generateUnit(inp, { seed, registry: reg }).unit;
}

function armyRoster(sys: SysDef, reps: number): UnitSpec[] {
  const out: UnitSpec[] = [];
  for (let i = 0; i < reps; i++) out.push(...sys.roster);
  return out;
}

// ---------- 场景构建 ----------

type ScenKey = '1v1' | '1v3' | '3v3' | '1v10' | '10v10';

function buildSmall(sys: SysDef, key: ScenKey, runSeed: string): Combatant[] {
  const mk = (name: string, side: Side, spec: UnitSpec, scale: 'hero' | 'mook') =>
    genUnit(sys, name, side, scale, spec, `${runSeed}:${side}:${name}`);
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
    const pool = sys.mookPool ?? [m];
    for (let i = 1; i <= 10; i++) {
      units.push(mk(`我方兵${i}`, 'ally', pool[(i - 1) % pool.length]!, 'mook'));
      units.push(mk(`敌兵${i}`, 'enemy', pool[(i - 1) % pool.length]!, 'mook'));
    }
  }
  return units;
}

function buildMass(sys: SysDef, allyReps: number, enemyReps: number, runSeed: string): Combatant[] {
  const units: Combatant[] = [];
  armyRoster(sys, allyReps).forEach((spec, i) =>
    units.push(genUnit(sys, `我军${i + 1}队`, 'ally', 'company', spec, `${runSeed}:a${i}`)));
  armyRoster(sys, enemyReps).forEach((spec, i) =>
    units.push(genUnit(sys, `敌军${i + 1}队`, 'enemy', 'company', spec, `${runSeed}:e${i}`)));
  return units;
}

// ---------- 战斗驱动与统计 ----------

interface SideStat { pct: number; dead: number; routed: number; total: number }

function sideStat(cs: Combatant[], side: Side): SideStat {
  const mine = cs.filter((c) => c.side === side);
  const hp = mine.reduce((s, c) => s + Math.max(0, c.hp), 0);
  const max = mine.reduce((s, c) => s + c.base.hpMax, 0);
  return {
    pct: max > 0 ? hp / max : 0,
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
  heroAlive: boolean;
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

function runSmall(sys: SysDef, key: ScenKey, runSeed: string): RunResult {
  const units = buildSmall(sys, key, runSeed);
  const b = new SmallBattle({ combatants: units, seed: runSeed, rules: SYSTEM_PACKS[sys.packId]!.small, traitRegistry: reg });
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
  const hero = b.combatants.find((c) => c.side === 'ally' && c.scale === 'hero');
  return {
    winner: b.winner() ?? 'draw',
    rounds: b.round,
    timeout: !b.isOver(),
    ally: sideStat(b.combatants, 'ally'),
    enemy: sideStat(b.combatants, 'enemy'),
    heroAlive: hero ? hero.status === 'ready' : true,
    ...d,
  };
}

function runMass(sys: SysDef, allyReps: number, enemyReps: number, runSeed: string): RunResult {
  const b = new MassBattle({ combatants: buildMass(sys, allyReps, enemyReps, runSeed), seed: runSeed, rules: SYSTEM_PACKS[sys.packId]!.mass, traitRegistry: reg });
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
    heroAlive: true,
    ...d,
  };
}

// ---------- 汇总 ----------

function agg(runs: RunResult[]) {
  const n = runs.length;
  const ally = runs.filter((r) => r.winner === 'ally').length;
  const draw = runs.filter((r) => r.winner === 'draw').length;
  const avg = (f: (r: RunResult) => number) => runs.reduce((s, r) => s + f(r), 0) / n;
  const totalDmg = avg((r) => r.totalDmg);
  return {
    n,
    allyWin: (ally / n) * 100,
    draw: (draw / n) * 100,
    rounds: avg((r) => r.rounds),
    maxRounds: Math.max(...runs.map((r) => r.rounds)),
    allyPct: avg((r) => r.ally.pct) * 100,
    enemyPct: avg((r) => r.enemy.pct) * 100,
    allyDead: avg((r) => r.ally.dead),
    enemyDead: avg((r) => r.enemy.dead),
    allyRout: avg((r) => r.ally.routed),
    enemyRout: avg((r) => r.enemy.routed),
    heroSurvive: (runs.filter((r) => r.heroAlive).length / n) * 100,
    shotPct: (avg((r) => r.rangedDmg) / Math.max(1, totalDmg)) * 100,
    timeouts: runs.filter((r) => r.timeout).length,
  };
}

interface Row { sys: string; scen: string; a: ReturnType<typeof agg> }

const HEADER = '| 体系 | 场景 | 我胜% | 平% | 回合(均/最大) | 我余% | 敌余% | 射击占比% | 超时 | 击杀(敌亡/我亡) | 溃逃(敌/我) | 精英存活% |\n|---|---|---|---|---|---|---|---|---|---|---|---|';

function fmtRow(r: Row): string {
  const p = (x: number, d = 0) => x.toFixed(d);
  return `| ${r.sys} | ${r.scen} | ${p(r.a.allyWin)} | ${p(r.a.draw)} | ${p(r.a.rounds, 1)}/${r.a.maxRounds} | ${p(r.a.allyPct)} | ${p(r.a.enemyPct)} | ${p(r.a.shotPct)} | ${r.a.timeouts} | ${r.a.enemyDead.toFixed(1)}/${r.a.allyDead.toFixed(1)} | ${r.a.enemyRout.toFixed(1)}/${r.a.allyRout.toFixed(1)} | ${p(r.a.heroSurvive)} |`;
}

function runScenario(sys: SysDef, scen: string, kind: 'small' | 'mass', key: ScenKey | [number, number]): Row {
  const runs: RunResult[] = [];
  for (let i = 0; i < RUNS; i++) {
    const seed = `${sys.id}-${scen}-r${i}`;
    runs.push(kind === 'small' ? runSmall(sys, key as ScenKey, seed) : runMass(sys, (key as [number, number])[0], (key as [number, number])[1], seed));
  }
  return { sys: sys.name, scen, a: agg(runs) };
}

it('体系×场景矩阵模拟', () => {
  const rows: Row[] = [];
  for (const sys of SYSTEMS) {
    rows.push(runScenario(sys, '1v1', 'small', '1v1'));
    rows.push(runScenario(sys, '1v3', 'small', '1v3'));
    rows.push(runScenario(sys, '3v3', 'small', '3v3'));
    rows.push(runScenario(sys, '1v10', 'small', '1v10'));
    rows.push(runScenario(sys, '10v10', 'small', '10v10'));
    rows.push(runScenario(sys, '团v团(3连v3连)', 'mass', [1, 1]));
    rows.push(runScenario(sys, '军v团(9连v3连)', 'mass', [3, 1]));
    rows.push(runScenario(sys, '军v军(9连v9连)', 'mass', [3, 3]));
  }

  const lines: string[] = [];
  lines.push(`# 体系×场景矩阵模拟报告（RUNS=${RUNS}/场，种子固定可复现）`);
  lines.push('');
  lines.push('> 体系要素：' + SYSTEMS.map((s) => `${s.name}=${s.note}`).join('；'));
  lines.push('');
  for (const sys of SYSTEMS) {
    lines.push(`## ${sys.name}`);
    lines.push(HEADER);
    for (const r of rows.filter((x) => x.sys === sys.name)) lines.push(fmtRow(r));
    lines.push('');
  }
  lines.push('## 全矩阵');
  lines.push(HEADER);
  for (const r of rows) lines.push(fmtRow(r));

  const out = path.resolve(process.cwd(), 'engine/sim/out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'matrix-report.md');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`\n==== 矩阵报告已写入 ${file} ====\n`);
  console.log(lines.join('\n'));
}, 3_600_000);
