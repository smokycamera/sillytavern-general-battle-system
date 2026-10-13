import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SmallBattle, generateUnit, standardField, traitRegistry, V8_OVERFLOW_D20, prepareCombatModel } from '../engine/src/index.js';
import { sampledPreviewComputations } from '../engine/src/damage.js';

const rows: { layered: boolean; mount: boolean; trial: number; ms: number; computations: number; hash: string }[] = [];
for (const layered of [true, false]) for (const mount of [false, true]) {
  for (let trial = -1; trial < 3; trial++) {
    const seed = `cavalry-bench:${layered}:${mount}:${trial}`, registry = traitRegistry();
    const units = Array.from({ length: 8 }, (_, i) => {
      const u = generateUnit({ name: `${seed}:u${i}`, side: i < 4 ? 'ally' : 'enemy', scale: 'company', hpMax: 20,
        rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4, weaponClass: 'spear', weaponLevel: 4, armorTier: 1, traits: [] },
      { registry, seed: `${seed}:u${i}`, noVariance: true }).unit;
      u.id = `${seed}:u${i}`; u.mount = mount; u.archetype = mount ? 'mobile' : 'infantry';
      prepareCombatModel(u, V8_OVERFLOW_D20); return u;
    });
    const field = standardField(13, 19); field.tiles.fill('open');
    if (layered) { field.layerVersion = 1; field.structures = field.tiles.map(() => null); }
    const b = new SmallBattle({ combatants: units, rules: V8_OVERFLOW_D20, traitRegistry: registry, battlefield: field, seed });
    b.start(); b.turnOrder = units.map(u => u.id); b.turnIndex = 0;
    units.forEach((u, i) => u.pos = (i < 4 ? 10 : 7) * 13 + 4 + i % 4);
    const computations = sampledPreviewComputations(), start = performance.now();
    b.autoAction(units[0]!.id);
    const ms = performance.now() - start;
    if (trial >= 0) rows.push({ layered, mount, trial, ms, computations: sampledPreviewComputations() - computations,
      hash: createHash('sha256').update(JSON.stringify(b.toSnapshot())).digest('hex') });
  }
}
const summary = [true, false].flatMap(layered => [false, true].map(mount => {
  const matching = rows.filter(r => r.layered === layered && r.mount === mount);
  return { layered, mount, medianMs: Math.round(matching.map(r => r.ms).sort((a, b) => a - b)[1]!),
    computations: matching.map(r => r.computations) };
}));
const output = process.argv[2] ?? process.env.BENCH_OUT;
if (output) writeFileSync(output, JSON.stringify({ node: process.version, summary, rows }, null, 2) + '\n');
console.table(summary);
