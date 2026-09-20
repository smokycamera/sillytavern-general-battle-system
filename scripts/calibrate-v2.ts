import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateUnit, generatedField, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type GenerateInput, type Combatant } from '../engine/src/index.js';
const registry = traitRegistry();
const probe = process.argv.includes('--probe'), currentFields = process.argv.includes('--p6');
const pairs = probe ? 3 : 500;
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const outputName = (currentFields ? probe ? 'p6-ai-probe' : 'p6-ai-calibration' : probe ? 'p5-ai-probe' : 'v2-calibration') + (only ? '-' + only.join('_') : '');
const reportPath = `engine/sim/out/${outputName}.json`;
const sourcePaths = ['scripts/calibrate-v2.ts', 'package-lock.json', ...readdirSync('engine/src', { recursive: true }).filter((p) => String(p).endsWith('.ts')).map((p) => 'engine/src/' + String(p).split(String.fromCharCode(92)).join('/'))].sort();
const sourceFingerprint = createHash('sha256').update(sourcePaths.map((p) => p + ':' + createHash('sha256').update(readFileSync(p)).digest('hex')).join('\n')).digest('hex');
const traces: Record<string, unknown[]> = {};
const boundedMetrics = new Set(['win', 'draw', 'ownLoss', 'foeLoss', 'objective', 'limit', 'runaway']);
function confidenceInterval(mean: number, variance: number, n: number, bounded: boolean): number[] {
  // 成对样本作为独立聚类。边界全0/全1不用退化的0宽正态区间。
  if (bounded && mean === 0) return [0, 1 - Math.pow(0.025, 1 / n)];
  if (bounded && mean === 1) return [Math.pow(0.025, 1 / n), 1];
  const half = 1.96 * Math.sqrt(variance / n);
  return bounded ? [Math.max(0, mean - half), Math.min(1, mean + half)] : [mean - half, mean + half];
}
if (process.argv.includes('--refresh-intervals')) {
  const report = JSON.parse(readFileSync('engine/sim/out/v2-calibration.json', 'utf8')) as { pairs: number; intervalPolicy?: string; scenarios: Record<string, { metrics: Record<string, { mean: number; variance: number; interval95: number[] }> }> };
  for (const scenario of Object.values(report.scenarios)) for (const [key, metric] of Object.entries(scenario.metrics)) metric.interval95 = confidenceInterval(metric.mean, metric.variance, report.pairs, boundedMetrics.has(key));
  report.intervalPolicy = '成对聚类内点正态近似；有界指标全0/全1使用保守二项端点界限，95%';
  const markdown = readFileSync('engine/sim/out/v2-calibration.md', 'utf8').split('\n').map((line) => {
    const id = /^\| ([a-z-]+) \|/.exec(line)?.[1]; const metric = id ? report.scenarios[id]?.metrics.win : undefined;
    if (!metric) return line;
    const cells = line.split('|'); cells[3] = ' ' + metric.interval95.map((n) => (n * 100).toFixed(1)).join('–') + '% '; return cells.join('|');
  }).join('\n').replace(/\d+场景，各\d+对种子\/\d+场；共\d+场。/, `${Object.keys(report.scenarios).length}场景，各${report.pairs}对种子/${report.pairs * 2}场；共${Object.keys(report.scenarios).length * report.pairs * 2}场。`)
    .replace('成对聚类均值的95%正态区间', '成对聚类均值的95%区间（内点正态近似；全0/全1为保守二项端点界限）').replaceAll('原地基线', '追击基线');
  writeFileSync('engine/sim/out/v2-calibration.json', JSON.stringify(report, null, 2)); writeFileSync('engine/sim/out/v2-calibration.md', markdown);
  console.log('仅从已保存的均值/方差重算区间；样本、胜负和场次数保持不变。'); process.exit(0);
}
type Result = { win: number; draw: number; rounds: number; ownLoss: number; foeLoss: number; objective: number; limit: number; runaway: number; moves: number; summons: number; abilities: number; attacks: number };
const templates = new Map<string, Combatant>();
function unit(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}) {
  const key = JSON.stringify([id, side, extra]), cached = templates.get(key);
  if (cached) return structuredClone(cached);
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 4, weaponClass: 'rifle', weaponLevel: 5, armorTier: 1, traits: [], ...extra }, { seed: 'mechanism:' + id, registry, noVariance: true }).unit;
  u.id = id;
  if (id === 'reference' || id === 'opponent') templates.set(key, structuredClone(u));
  return u;
}
function result(b: SmallBattle | MassBattle, originals: Combatant[], side: 'ally' | 'enemy', runaway: boolean): Result {
  const loss = (own: boolean) => {
    const group = originals.filter((u) => (u.side === side) === own);
    return group.reduce((sum, original) => sum + original.hp - b.byId(original.id).hp, 0) / group.reduce((sum, u) => sum + u.hp, 0);
  };
  const winner = b.winner();
  for (const u of b.combatants) if (!Number.isInteger(u.hp) || u.hp < 0 || u.hp > u.base.hpMax) throw new Error('人员/生命守恒失败');
  return { win: winner === side ? 1 : 0, draw: winner === 'draw' ? 1 : 0, rounds: currentFields && b instanceof MassBattle ? Math.max(0, b.round - 1) : b.round, ownLoss: loss(true), foeLoss: loss(false),
    objective: b instanceof SmallBattle && b.objectiveWinner === side ? 1 : 0,
    limit: b instanceof SmallBattle ? b.objectiveWinner === 'draw' ? 1 : 0 : b.endingReason() === 'round-limit' ? 1 : 0, runaway: runaway ? 1 : 0, moves: b.log.filter((l) => l.kind === 'move').length,
    summons: b.combatants.filter((u) => u.summonerId).length, abilities: b.combatants.reduce((sum, u) => sum + u.abilityState.reduce((n, a) => n + a.used, 0), 0), attacks: b.log.filter((e) => e.resolution).length };
}
function grid(seed: number, reverse: boolean, scenario: 'rifle' | 'objective' | 'greedy' | 'weak' | 'counter' | 'dual' | 'single-close'): Result {
  const side = reverse ? 'enemy' : 'ally', foe = reverse ? 'ally' : 'enemy';
  const platform = scenario === 'weak' || scenario === 'counter';
  const close = scenario === 'dual' || scenario === 'single-close';
  const units = platform ? [
    unit('reference', side, { scale: 'company', hpMax: 80, weaponClass: scenario === 'weak' ? 'bow' : 'cannon', weaponLevel: scenario === 'weak' ? 2 : 10 }),
    unit('opponent', foe, { body: 'vehicle', hpMax: 180, armorTier: 4, armorLevel: 10, weaponClass: 'rifle', weaponLevel: 4 }),
  ] : close ? [unit('reference', side, { hpMax: 50, ...(scenario === 'dual' ? { sidearmClass: 'sword', sidearmLevel: 5 } : {}) }), unit('opponent', foe, { hpMax: 50, weaponClass: 'sword' })]
    : [unit('reference', side, scenario === 'rifle' ? {} : { weaponClass: 'bow', weaponLevel: 2, armorTier: 4, armorLevel: 10 }), unit('opponent', foe, scenario === 'rifle' ? {} : { weaponClass: 'bow', weaponLevel: 2, armorTier: 4, armorLevel: 10 })];
  const field = currentFields ? generatedField('paired:' + seed, 7, 9, [(['plains', 'forest', 'mountain', 'urban'] as const)[seed % 4]!]) : standardField();
  if (scenario === 'objective' || scenario === 'greedy') { field.objective = { kind: 'control', cell: reverse ? 28 : 34, rounds: 2, limit: 12 }; }
  const b = new SmallBattle({ combatants: units, seed: 'paired:' + seed, rules: V2_D20, battlefield: field, traitRegistry: registry });
  b.start();
  units.forEach((u) => { u.pos = u.side === 'ally' ? 52 : 10; });
  if (close) { units[0]!.pos = 31; units[1]!.pos = reverse ? 38 : 24; }
  const originals = structuredClone(units);
  let steps = 0;
  while (!b.isOver() && steps++ < 240) {
    const actor = b.active; if (!actor) break;
    if (scenario === 'greedy' && actor.id === 'reference') {
      // 消融基线：合法范围内先打最近目标，否则向敌前进；不读目标任务格。
      let option = b.getActionOptions(actor.id).find((o) => o.id === 'weapon');
      if (!option?.enabled && b.movementLeft(actor.id) > 0) { try { b.move(actor.id, 'advance'); } catch { /* 原地待命 */ } }
      option = b.getActionOptions(actor.id).find((o) => o.id === 'weapon');
      const target = option?.targets?.find((t) => t.enabled);
      if (target) b.attack(actor.id, target.targetId);
      if (!b.isOver()) b.endTurn();
    } else b.autoAction(actor.id);
  }
  return result(b, originals, side, !b.isOver());
}
function mass(seed: number, reverse: boolean, summon: boolean, offsetMelee = false): Result {
  const side = reverse ? 'enemy' : 'ally', foe = reverse ? 'ally' : 'enemy';
  const units = [unit('reference', side, { scale: 'company', hpMax: 50, ...(summon ? { abilityBlueprints: ['bp-call-reinforce'], reserves: 1 } : {}) }), unit('opponent', foe, { scale: 'company', hpMax: 50 })];
  units.forEach((u) => u.tags.push('zone:中军', 'rank:front'));
  if (offsetMelee) {
    units[0] = unit('reference', side, { scale: 'company', hpMax: 50, weaponClass: 'sword' });
    units[1] = unit('opponent', foe, { scale: 'company', hpMax: 50, weaponClass: 'sword' });
    units[0]!.tags.push('zone:左翼'); units[1]!.tags.push('zone:中军');
  }
  const b = new MassBattle({ combatants: units, seed: 'paired:' + seed, rules: V2_TW, traitRegistry: registry, zones: ['左翼', '中军', '右翼'],
    summonUnit: (_template, side, seed) => unit(seed!, side as 'ally' | 'enemy', { scale: 'company', hpMax: 10 }) });
  b.start(); const originals = structuredClone(units); let steps = 0;
  while (!b.isOver() && steps++ < 80) { b.autoOrders('ally'); b.autoOrders('enemy'); b.resolveRound(); }
  return result(b, originals, side, !b.isOver());
}
function advancedMass(seed: number, reverse: boolean, scenario: 'stealth' | 'air-control' | 'riding' | 'vehicle'): Result {
  const side = reverse ? 'enemy' : 'ally', foe = reverse ? 'ally' : 'enemy';
  const reference: Partial<GenerateInput> = scenario === 'stealth' ? { weaponClass: 'sword', traits: ['stalk', 'fast'] }
    : scenario === 'air-control' ? { abilityBlueprints: [{ id: 'bp-binding', level: 7 }, { id: 'bp-firestorm', level: 6 }] }
    : scenario === 'riding' ? { weaponClass: 'bow', mount: true, traits: ['mounted-archer'] }
    : { body: 'vehicle', weaponClass: 'cannon', weaponLevel: 7, stabilized: true, armorTier: 3 };
  const opponent: Partial<GenerateInput> = scenario === 'air-control' ? { weaponClass: 'sword', traits: ['flying'] }
    : { weaponClass: 'sword', traits: ['charge-strong'] };
  const units = [unit('reference', side, { scale: 'company', hpMax: 50, ...reference }), unit('opponent', foe, { scale: 'company', hpMax: 50, ...opponent })];
  units[0]!.tags.push('zone:左翼', 'rank:rear'); units[1]!.tags.push('zone:中军', 'rank:front');
  const b = new MassBattle({ combatants: units, rules: V2_TW, traitRegistry: registry, seed: 'paired:' + seed,
    field: { tags: scenario === 'stealth' ? ['night', 'forest'] : [] } });
  b.start(); const originals = structuredClone(units); let steps = 0;
  while (!b.isOver() && steps++ < 80) {
    b.autoOrders('ally'); b.autoOrders('enemy');
    const orders = probe ? [...b.orders.values()] : [];
    b.resolveRound();
    if (probe) (traces[scenario + ':' + reverse + ':' + seed] ??= []).push({ round: b.round - 1, orders,
      units: b.combatants.map((u) => ({ id: u.id, hp: u.hp, status: u.status, morale: u.morale, fatigue: u.fatigue,
        formation: u.formationPosition ?? u.tags.filter((t) => t.startsWith('rank:') || t.startsWith('zone:')), airborne: u.airborne,
        known: b.visibleCombatants(u.side === 'ally' ? 'enemy' : 'ally').some((t) => t.id === u.id) })) });
  }
  return result(b, originals, side, !b.isOver());
}
const scenarios: [string, string, (seed: number, reverse: boolean) => Result][] = [
  ['grid-rifle', '7×9对称步枪，T4/P5/轻甲P5', (s, r) => grid(s, r, 'rifle')],
  ['grid-objective', '双方无法互相穿甲、侧翼占点：任务AI', (s, r) => grid(s, r, 'objective')],
  ['grid-greedy', '同一侧翼占点：参考方仅追击开火基线', (s, r) => grid(s, r, 'greedy')],
  ['grid-weak', '80人弓P2→封闭载具180HP/超重甲P10', (s, r) => grid(s, r, 'weak')],
  ['grid-counter', '相同80人改用炮P10，其他输入不变', (s, r) => grid(s, r, 'counter')],
  ['mass-rifle', '18阵位对称50人编队', (s, r) => mass(s, r, false)],
  ['mass-summon', '相同对抗，参考方有1份10人预备支援', (s, r) => mass(s, r, true)],
  ['grid-single-close', '参考方步枪P5近距对剑P5，双方50HP', (s, r) => grid(s, r, 'single-close')],
  ['grid-dual', '相同近距对抗，参考方额外携带剑P5副武器', (s, r) => grid(s, r, 'dual')],
  ['mass-melee', '相邻翼50人近战编队自动汇合接战', (s, r) => mass(s, r, false, true)],
];
scenarios.push(
  ['mass-stealth', '林间夜战：潜伏快速近战与冲锋单位', (s, r) => advancedMass(s, r, 'stealth')],
  ['mass-air-control', '束缚与范围法术对飞行近战，机动与迫降反制', (s, r) => advancedMass(s, r, 'air-control')],
  ['mass-riding', '真实骑射与冲锋近战，有限后撤空间', (s, r) => advancedMass(s, r, 'riding')],
  ['mass-vehicle', '稳定车炮与冲锋近战，机动和装填成本', (s, r) => advancedMass(s, r, 'vehicle')],
);
const selectedScenarios = scenarios.filter(([id]) => !only || only.includes(id));
if (!selectedScenarios.length || only?.some((id) => !scenarios.some(([known]) => known === id))) throw Error('未知场景选择');
type Metric = { mean: number; variance: number; interval95: number[] };
type ScenarioReport = { label: string; completedPairs: number; samples: Result[]; metrics?: Record<string, Metric> };
type CalibrationReport = {
  date: string; finishedAt?: string; sourceFingerprint: string; sourcePaths: string[]; purpose: string;
  pairs: number; battlesPerScenario: number; seedPolicy: string; fieldPolicy: string; completed: boolean;
  scenarios: Record<string, ScenarioReport>; comparisons?: Record<string, { treatment: string; baseline: string; pairs: number; metrics: Record<string, Metric> }>;
  traces?: Record<string, unknown[]>;
};
const report: CalibrationReport = process.argv.includes('--resume') && existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, 'utf8'))
  : { date: new Date().toISOString(), sourceFingerprint, sourcePaths, completed: false,
      purpose: probe ? '少量完整对局诊断，不作胜率或平衡结论' : '完整AI对局校准', pairs, battlesPerScenario: pairs * 2,
      seedPolicy: 'paired:0至' + (pairs - 1) + '；每种子交换参考方阵营/出生边；固定配方与单位种子；区间以种子对为聚类单位',
      fieldPolicy: currentFields ? '本场种子地形；按种子轮换平原、森林、山地、城镇，同一对比使用相同地图；近距样例固定合法接战位置' : '历史固定standardField',
      scenarios: {} };
if (report.sourceFingerprint !== sourceFingerprint || report.pairs !== pairs) throw Error('源码或样本量已变化，拒绝混入旧批次；保留旧报告后另起批次');
mkdirSync('engine/sim/out', { recursive: true });
function saveProgress() {
  if (probe) report.traces = traces;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
function summary(values: number[], bounded: boolean): Metric {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, variance, interval95: confidenceInterval(mean, variance, values.length, bounded) };
}
function pairSamples(samples: Result[]): Result[] {
  if (samples.length % 2) throw Error('种子对不完整');
  return Array.from({ length: samples.length / 2 }, (_, i) => Object.fromEntries(Object.keys(samples[i * 2]!)
    .map((key) => [key, (samples[i * 2]![key as keyof Result] + samples[i * 2 + 1]![key as keyof Result]) / 2])) as Result);
}
for (const [id, label, run] of selectedScenarios) {
  const entry = report.scenarios[id] ??= { label, completedPairs: 0, samples: [] };
  if (entry.completedPairs * 2 !== entry.samples.length || entry.completedPairs > pairs) throw Error('保存的样本进度损坏');
  if (entry.completedPairs === pairs && entry.metrics) { console.log(id + ': 复用本批已完成的' + pairs + '对'); continue; }
  for (let seed = entry.completedPairs; seed < pairs; seed++) {
    entry.samples.push(run(seed, false), run(seed, true));
    entry.completedPairs = seed + 1;
    if ((seed + 1) % 100 === 0) { saveProgress(); console.log(id + ': ' + (seed + 1) + '/' + pairs + '对'); }
  }
  const paired = pairSamples(entry.samples);
  entry.metrics = Object.fromEntries(Object.keys(paired[0]!).map((key) =>
    [key, summary(paired.map((r) => r[key as keyof Result]), boundedMetrics.has(key))]));
  saveProgress();
  console.log(id + ': 完成，轮次' + entry.metrics.rounds!.mean.toFixed(2) + '，限时' + entry.metrics.limit!.mean.toFixed(3) + '，失控' + entry.metrics.runaway!.mean.toFixed(3));
}
const comparisons = [
  ['objective-policy', 'grid-objective', 'grid-greedy'],
  ['armor-counter', 'grid-counter', 'grid-weak'],
  ['reserve-support', 'mass-summon', 'mass-rifle'],
  ['sidearm', 'grid-dual', 'grid-single-close'],
] as const;
report.comparisons = {};
for (const [id, treatment, baseline] of comparisons) {
  const a = report.scenarios[treatment], b = report.scenarios[baseline];
  if (a?.completedPairs !== pairs || b?.completedPairs !== pairs) continue;
  const treated = pairSamples(a.samples), controls = pairSamples(b.samples);
  const metrics = Object.fromEntries(Object.keys(treated[0]!).map((key) => {
    const diffs = treated.map((r, i) => r[key as keyof Result] - controls[i]![key as keyof Result]);
    const metric = summary(diffs, false);
    if (boundedMetrics.has(key)) {
      // 有界配对差全相同时给未观察到差异的保守端点余量，不把0宽区间当成确定等效。
      const half = 1 - Math.pow(0.025, 1 / pairs);
      metric.interval95 = metric.variance === 0
        ? [Math.max(-1, metric.mean - 2 * half), Math.min(1, metric.mean + 2 * half)]
        : [Math.max(-1, metric.interval95[0]!), Math.min(1, metric.interval95[1]!)];
    }
    return [key, metric];
  }));
  report.comparisons[id] = { treatment, baseline, pairs, metrics };
}
report.completed = selectedScenarios.every(([id]) => report.scenarios[id]?.completedPairs === pairs);
report.finishedAt = new Date().toISOString();
saveProgress();
const rows = selectedScenarios.map(([id]) => {
  const metrics = report.scenarios[id]!.metrics!, mean = (key: string) => metrics[key]!.mean;
  return '| ' + [id, (mean('win') * 100).toFixed(1) + ' / ' + ((1 - mean('win') - mean('draw')) * 100).toFixed(1) + ' / ' + (mean('draw') * 100).toFixed(1),
    metrics.win!.interval95.map((n) => (n * 100).toFixed(1)).join('–'), mean('rounds').toFixed(2),
    (mean('ownLoss') * 100).toFixed(1) + ' / ' + (mean('foeLoss') * 100).toFixed(1), (mean('objective') * 100).toFixed(1),
    Math.round(mean('limit') * pairs * 2) + ' / ' + Math.round(mean('runaway') * pairs * 2), mean('summons').toFixed(2)].join(' | ') + ' |';
});
const comparisonRows = Object.entries(report.comparisons).map(([id, value]) => '| ' + id + ' | ' + value.treatment + ' − ' + value.baseline
  + ' | ' + (value.metrics.win!.mean * 100).toFixed(1) + ' | ' + value.metrics.win!.interval95.map((n) => (n * 100).toFixed(1)).join('–') + ' |');
writeFileSync('engine/sim/out/' + outputName + '.md', [
  '# V2 完整AI对局校准', '', report.finishedAt, '', report.purpose + '。' + selectedScenarios.length + '场景，各' + pairs + '对种子/' + pairs * 2 + '场；共' + selectedScenarios.length * pairs * 2 + '场。',
  '', report.fieldPolicy + '。' + report.seedPolicy + '。', '', '源码/驱动指纹：' + report.sourceFingerprint,
  '', '| 场景 | 胜/负/平 % | 胜率95%区间 % | 轮次均值 | 本方/敌方损失% | 目标成功% | 规则限时/失控超时 场 | 召唤数 |',
  '|---|---|---|---|---|---|---|---|', ...rows, '',
  '| 配对比较 | 处理减基线 | 胜率差 百分点 | 差值95%区间 百分点 |', '|---|---|---|---|', ...comparisonRows, '',
  '内点区间采用独立种子对均值的正态近似，有界指标全0/全1使用保守二项端点界限。处理/基线使用相同种子、阵营和地图逐对相减；不是两组独立区间作差。JSON保留逐场数据、全部指标方差与区间。',
  '', ...selectedScenarios.map(([id, label]) => '- ' + id + '：' + label),
  '', '损失率只计算原始参战单位，人员/生命只在各场景内比较；召唤另计。规则期限与失控循环分开，不要求不对称对抗50%胜率。P6批次会战轮次为实际完成轮数，历史报告的round字段可能包含结束后的下一轮编号。',
  '', '本报告为本地引擎统计，不能代表真实宿主验收。' + (probe ? '本批仅用于诊断，不能形成平衡结论。' : ''), '',
].join('\n'));
console.log('统计已写入 ' + reportPath);
