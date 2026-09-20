/** P3c数值消融：固定种子的有限交战窗口，不将这些窗口冒称完整AI胜率。 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, SeededRng, hashSeed, V2_D20, V2_TW, type GenerateInput, type Combatant } from '../engine/src/index.js';
const registry = traitRegistry(), pairs = 500;
const selectedCase = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
type Mode = 'small' | 'mass';
type Case = { id: string; label: string; a: (variant: boolean) => Partial<GenerateInput>; b: (variant: boolean) => Partial<GenerateInput>; action?: 'ability' | 'pressure'; ranged?: boolean; moving?: boolean; rounds?: number };
const cases: Case[] = [
  { id: 'penetration', label: '同一火炮P2→P10对车体超重甲P10，检验弱火力零损伤与专用反制', a: (v) => ({ weaponClass: 'cannon', weaponLevel: v ? 10 : 2, body: 'vehicle' }), b: () => ({ body: 'vehicle', armorTier: 4, armorLevel: 10 }), ranged: true },
  { id: 'thermal-armor', label: '综合→抗热重甲P7抵御能量P5，其他输入一致', a: () => ({ weaponClass: 'energy', weaponLevel: 5 }), b: (v) => ({ body: 'vehicle', armorTier: 3, armorLevel: 7, armorProfile: v ? 'thermal' : 'balanced' }), ranged: true },
  { id: 'kinetic-tradeoff', label: '同样综合→抗热重甲，抵御动能火炮P5，检验专项构型代价', a: () => ({ weaponClass: 'cannon', weaponLevel: 5, body: 'vehicle' }), b: (v) => ({ body: 'vehicle', armorTier: 3, armorLevel: 7, armorProfile: v ? 'thermal' : 'balanced' }), ranged: true },
  { id: 'stable-moving', label: '普通→稳定火炮P5：小战移动后射击；会战预备位短移并开火，对照先机动', a: (v) => ({ weaponClass: 'cannon', weaponLevel: 5, body: 'vehicle', weaponStabilized: v }), b: () => ({ body: 'vehicle' }), ranged: true, moving: true },
  { id: 'stable-cost', label: '普通→稳定火炮P5原地开火，检验让出的火力预算', a: (v) => ({ weaponClass: 'cannon', weaponLevel: 5, body: 'vehicle', weaponStabilized: v }), b: () => ({ body: 'vehicle' }), ranged: true },
  { id: 'poison', label: '普通→毒击剑P5，首次攻击后双方休整至三个结算边界', a: (v) => ({ traits: v ? ['poison-strike'] : [] }), b: () => ({}), rounds: 3 },
  { id: 'loose-area', label: '普通→疏散多人编队遭烈焰风暴P6，未接敌', a: () => ({ weaponClass: 'magic', abilityBlueprints: [{ id: 'bp-firestorm', level: 6 }] }), b: (v) => ({ traits: v ? ['loose-formation'] : [] }), action: 'ability', ranged: true },
  { id: 'physical-skill', label: '重击P10使用副剑P1→P8，对重甲P7；主枪P10不参与', a: (v) => ({ weaponClass: 'rifle', weaponLevel: 10, sidearmClass: 'sword', sidearmLevel: v ? 8 : 1, abilityBlueprints: [{ id: 'bp-crushing-blow', level: 10 }] }), b: () => ({ armorTier: 3, armorLevel: 7 }), action: 'ability' },
  { id: 'control-power', label: '束缚P2→P10对飞行目标，比较真实抵抗/迫降而非假定必控', a: (v) => ({ abilityBlueprints: [{ id: 'bp-binding', level: v ? 10 : 2 }] }), b: () => ({ traits: ['flying'] }), action: 'ability', ranged: true },
  { id: 'regeneration', label: '普通→再生编队受剑伤后休整三次；只能救回已记账伤兵', a: () => ({}), b: (v) => ({ traits: v ? ['regen'] : [] }), rounds: 3 },
  { id: 'terror', label: '恐惧→恐怖对45士气编队，记录三轮惊退/重整，不造成攻击损伤', a: (v) => ({ traits: v ? ['terror'] : ['fear'] }), b: () => ({}), action: 'pressure', rounds: 3 },
];
const templates = new Map<string, Combatant[]>();
function getUnits(c: Case, variant: boolean, reverse: boolean): Combatant[] {
  const key = c.id + variant;
  if (!templates.has(key)) templates.set(key, [c.a(variant), c.b(variant)].map((extra, i) => {
    const u = generateUnit({ name: i ? '目标' : '行动者', side: i ? 'enemy' : 'ally', rulesVersion: 'v2', scale: 'company', level: 3, hpMax: 200, weaponClass: 'sword', weaponLevel: 5, armorTier: 0, traits: [], ...extra }, { seed: 'p3c:' + i, registry, noVariance: true }).unit;
    u.id = i ? 'b' : 'a'; u.morale = u.base.moraleMax = 100; return u;
  }));
  return structuredClone(templates.get(key)!).map((u) => { if (reverse) u.side = u.side === 'ally' ? 'enemy' : 'ally'; return u; });
}
function run(c: Case, mode: Mode, seed: number, variant: boolean) {
  const reverse = seed % 2 === 1, units = getUnits(c, variant, reverse), [a, b] = units as [Combatant, Combatant];
  if (c.id === 'terror') b.morale = 45;
  for (const u of units) u.tags = ['zone:中军', 'rank:' + (c.moving && mode === 'mass' ? 'reserve' : c.ranged && u.id === 'a' ? 'rear' : 'front')];
  const rng = new SeededRng('p3c-pair:' + seed), field = standardField(); field.tiles.fill('open');
  const battle = mode === 'small' ? new SmallBattle({ combatants: units, rng, rules: V2_D20, battlefield: field, traitRegistry: registry }) : new MassBattle({ combatants: units, rng, rules: V2_TW, traitRegistry: registry });
  battle.start(); rng.setState(hashSeed('p3c-pair:' + seed));
  if (battle instanceof SmallBattle) { battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = reverse ? 17 : 45; b.pos = reverse ? c.ranged ? 31 : 24 : c.ranged ? 31 : 38; }
  let preview = 0, landed = false, routing = false, shots = 0;
  if (c.moving && battle instanceof SmallBattle) battle.moveTo('a', reverse ? 10 : 52);
  if (c.action !== 'pressure') {
    if (battle instanceof SmallBattle) {
      const id = c.action === 'ability' ? a.abilities[0]!.id : 'weapon';
      const state = rng.getState(), option = battle.getActionOptions('a').find((o) => o.id === id)?.targets?.find((t) => t.targetId === 'b');
      if (!option?.enabled) throw Error(c.id + '/small illegal: ' + option?.reason);
      preview = option.preview?.expectedDamage ?? 0;
      if (rng.getState() !== state) throw Error('预览消费RNG');
      if (c.action === 'ability') { const result = battle.useAbility('a', id, 'b'); if (!result.ok) throw Error(result.log); }
      else battle.attack('a', 'b');
    } else {
      const order = c.moving && !variant ? { unitId: 'a', type: 'rank-forward' as const } : c.action === 'ability'
        ? { unitId: 'a', type: 'ability' as const, abilityId: a.abilities[0]!.id, targetId: 'b' }
        : { unitId: 'a', type: c.ranged ? 'volley' as const : 'attack' as const, targetId: 'b' };
      const state = rng.getState(), shown = battle.orderPreview(order); preview = shown.preview?.expectedDamage ?? 0;
      if (rng.getState() !== state) throw Error('预览消费RNG');
      const result = battle.issue(order); if (!result.ok) throw Error(c.id + '/mass illegal: ' + result.reason);
    }
  }
  for (let n = 0; n < (c.rounds ?? 1); n++) {
    if (battle instanceof SmallBattle) {
      landed ||= c.id === 'control-power' && !b.airborne; routing ||= b.status === 'routing';
      const round = battle.round;
      for (let step = 0; step < 4 && battle.round === round && !battle.isOver(); step++) { battle.endTurn(); landed ||= c.id === 'control-power' && !b.airborne; routing ||= b.status === 'routing'; }
    } else {
      if (!battle.orders.has('a')) battle.issue({ unitId: 'a', type: 'hold' });
      battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound();
      landed ||= c.id === 'control-power' && !b.airborne; routing ||= b.status === 'routing';
    }
    if (battle.isOver()) break;
  }
  const attacks = battle.log.filter((l) => l.resolution?.attackerId === 'a'); shots = attacks.length;
  const direct = attacks.reduce((sum, l) => sum + (l.resolution?.finalDamage ?? 0), 0), loss = 200 - b.hp;
  for (const u of units) if (!Number.isInteger(u.hp) || u.hp < 0 || u.hp > 200 || u.hp + (u.recoverableWounded ?? 0) > 200) throw Error('人员/伤兵守恒失败');
  return { loss, direct, preview, healed: c.id === 'regeneration' ? direct - loss : 0, landed: Number(landed), routing: Number(routing), shots,
    fatigue: a.fatigue, spCost: 7 - (a.resources.SP ?? 7), rounds: battle.round - 1, survivors: b.hp, wounded: b.recoverableWounded ?? 0 };
}
function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length, variance = values.reduce((n, v) => n + (v - mean) ** 2, 0) / (values.length - 1), half = 1.96 * Math.sqrt(variance / values.length);
  return { mean, variance, interval95: [mean - half, mean + half] };
}
function sourceFiles(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? sourceFiles(dir + '/' + e.name) : [dir + '/' + e.name]).sort(); }
const sourceHash = createHash('sha256'); for (const path of [...sourceFiles('engine/src'), 'scripts/calibrate-p3c.ts']) sourceHash.update(path + '\0').update(readFileSync(path));
const report = { date: new Date().toISOString(), sourceFingerprint: sourceHash.digest('hex'), pairs, encounters: 0,
  method: '每个对比每模式500对种子；一对为同种子/同侧的基线与处理，奇偶种子交换阵营和空间。单位配方冻结，开战后统一战斗RNG；每窗口仅第一次执行指定动作，之后双方休整1或3个边界。均值差用配对样本方差和95%正态近似区间；不是完整AI对局，不报告胜率。概率端点零方差只代表样本。',
  scenarios: {} as Record<string, unknown> };
const rows: string[] = [];
for (const c of cases.filter((c) => !selectedCase || c.id === selectedCase)) for (const mode of ['small', 'mass'] as const) {
  const a: ReturnType<typeof run>[] = [], b: ReturnType<typeof run>[] = [];
  for (let seed = 0; seed < pairs; seed++) { a.push(run(c, mode, seed, false)); b.push(run(c, mode, seed, true)); }
  const metrics = Object.fromEntries((Object.keys(a[0]!) as (keyof typeof a[number])[]).map((key) => [key, { baseline: stats(a.map((r) => r[key])), treatment: stats(b.map((r) => r[key])), difference: stats(a.map((r, i) => b[i]![key] - r[key])) }]));
  report.scenarios[c.id + '-' + mode] = { label: c.label, metrics }; report.encounters += pairs * 2;
  const m = metrics.loss!, d = m.difference;
  rows.push(`| ${c.id}/${mode} | ${m.baseline.mean.toFixed(2)} → ${m.treatment.mean.toFixed(2)} | ${d.mean.toFixed(2)} [${d.interval95.map((n) => n.toFixed(2)).join(', ')}] | ${metrics.landed!.treatment.mean.toFixed(3)} | ${metrics.routing!.treatment.mean.toFixed(3)} | ${metrics.healed!.treatment.mean.toFixed(2)} |`);
  console.log(`${c.id}/${mode}: ${pairs}对完成，损失${m.baseline.mean.toFixed(2)}→${m.treatment.mean.toFixed(2)}`);
}
mkdirSync('engine/sim/out', { recursive: true });
const outputName = selectedCase ? 'p3c-calibration-' + selectedCase : 'p3c-calibration';
writeFileSync('engine/sim/out/' + outputName + '.json', JSON.stringify(report, null, 2));
writeFileSync('engine/sim/out/' + outputName + '.md', `# P3c 有限交战窗口的机制消融\n\n${report.date}\n\n源码/脚本指纹：${report.sourceFingerprint}。${selectedCase ? 1 : cases.length}组对比×2模式，每组500对，共${report.encounters}窗口。\n\n${report.method}\n\n本报告隔离新机制的实际边际作用；完整任务成功、胜负、对局长度和AI超时另在P6e综合对抗记录。\n\n| 对比/模式 | 目标实际损失 基线→处理 | 配对差及95%区间 | 处理迫降率 | 处理曾溃退率 | 处理救回人数 |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n${cases.filter((c) => !selectedCase || c.id === selectedCase).map((c) => '- ' + c.id + '：' + c.label).join('\n')}\n\n全部指标、基线/处理方差、资源、实际射击次数、结算轮数及存活/伤兵数见JSON。没有把休整窗口的未歼灭视为超时，也没有将其当作完整对局通过证据。\n`);
console.log('已写入engine/sim/out/' + outputName + '.{json,md}');
