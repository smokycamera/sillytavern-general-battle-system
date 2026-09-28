/** Run on baseline and candidate with the same Node/runtime, then compare outcomeHash.
 * npx vite-node scripts/benchmark-barrier-preview.ts
 * BENCH_OUT=report.json BENCH_TRIALS=5 npx vite-node scripts/benchmark-barrier-preview.ts
 * Timings are diagnostic, never a flaky wall-clock CI gate. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SmallBattle, generateUnit, standardField, traitRegistry, V8_OVERFLOW_D20, grantBarrier,
  prepareCombatModel, previewAttack, standardConditionMap } from '../engine/src/index.js';
const registry = traitRegistry(), trials = Number(process.env.BENCH_TRIALS ?? 5);
if (!Number.isInteger(trials) || trials < 1 || trials > 20) throw Error('BENCH_TRIALS must be 1..20');
const results: { scale: string; members: number; barrier: boolean; trial: number; previewMs: number; activationMs: number; outcomeHash: string }[] = [];
for (const [scale, members] of [['hero', 1], ['company', 20], ['company', 100]] as const) {
  for (const barrier of [false, true]) for (let trial = 0; trial < trials; trial++) {
    const units = ['a', 'd'].map(side => {
      const id = `${scale}-${members}-${barrier}-${trial}-${side}`;
      const u = generateUnit({ name: id, side: side === 'a' ? 'ally' : 'enemy', scale, rulesVersion: 'v2',
        damageModel: 'wounds-v2', level: 4, ...(scale === 'company' ? { hpMax: members } : {}),
        weaponClass: 'bow', weaponLevel: 4, armorTier: 1, traits: [] }, { registry, seed: id, noVariance: true }).unit;
      u.id = id; prepareCombatModel(u, V8_OVERFLOW_D20); if (scale === 'hero') u.weapon!.attacks = 2; return u;
    });
    const [a, d] = units as [typeof units[number], typeof units[number]];
    if (barrier) grantBarrier(d, 120, 4, d.id, 4);
    const opts = { attacker: a, defender: d, rules: V8_OVERFLOW_D20, conditionDefs: standardConditionMap(), traitRegistry: registry, ranged: true, distance: 4 };
    const start = performance.now(), predictions = [];
    for (let i = 0; i < 40; i++) { a.pos = i; predictions.push(previewAttack(opts)); }
    const previewMs = performance.now() - start;
    delete a.pos; delete d.pos; const field = standardField(); field.tiles.fill('open');
    const b = new SmallBattle({ combatants: units, rules: V8_OVERFLOW_D20, traitRegistry: registry, battlefield: field, seed: 'barrier-benchmark' });
    b.start(); b.turnOrder = [a.id, d.id]; b.turnIndex = 0; a.pos = 38; d.pos = 10;
    const activation = performance.now(); b.autoAction(a.id); const activationMs = performance.now() - activation;
    results.push({ scale, members, barrier, trial, previewMs, activationMs,
      outcomeHash: createHash('sha256').update(JSON.stringify({ predictions, log: b.log, snapshot: b.toSnapshot() })).digest('hex') });
  }
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const summary = [...new Set(results.map(r => `${r.scale}/${r.members}/${r.barrier}`))].map(key => {
  const rows = results.filter(r => `${r.scale}/${r.members}/${r.barrier}` === key);
  return { scenario: key, previewMedianMs: median(rows.map(r => r.previewMs)), activationMedianMs: median(rows.map(r => r.activationMs)) };
});
const report = { node: process.version, trials, notes: '40 equivalent previews and one AI activation, not entire browser turn latency; snapshots and every prediction are hashed.', summary, results };
console.table(summary); if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 2) + '\n');
