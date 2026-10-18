import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SmallBattle, generateUnit, standardField, traitRegistry, V17_OVERFLOW_D20, type Side } from '../engine/src/index.js';
import { sampledPreviewComputations } from '../engine/src/damage.js';

// Measure 32 total units, including every side's AI. Setup and snapshot hashing are untimed.
const rows: object[] = [];
const trials = Number(process.env.BENCH_TRIALS ?? 3);
for (const sides of [2, 3]) for (const mixed of [false, true]) {
  for (let trial = -1; trial < trials; trial++) {
    const seed = `small32:${sides}:${mixed}:${trial}`, registry = traitRegistry();
    const units = Array.from({ length: 32 }, (_, i) => {
      const group = sides === 2 ? (i < 16 ? 0 : 1) : (i < 11 ? 0 : i < 22 ? 1 : 2);
      const side: Side = (['ally', 'enemy', 'neutral'] as const)[group]!;
      const u = generateUnit({ name: `u${i}`, side, scale: 'company', hpMax: 20, level: 4,
        rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: mixed && i % 3 === 0 ? 'bow' : 'spear',
        weaponLevel: 4, armorTier: 1, traits: [] }, { registry, seed: `${seed}:u${i}`, noVariance: true }).unit;
      u.id = `u${i}`;
      u.mount = mixed && i % 3 === 1; u.archetype = u.mount ? 'mobile' : mixed && i % 3 === 0 ? 'ranged' : 'infantry';
      return u;
    });
    const field = standardField(13, 19); field.tiles.fill('open');
    field.layerVersion = 1; field.structures = field.tiles.map(() => null);
    const b = new SmallBattle({ combatants: units, rules: V17_OVERFLOW_D20, traitRegistry: registry, battlefield: field, seed });
    b.start();
    // Distinct cells near contact; third side approaches from the right.
    const offsets = { ally: 0, enemy: 0, neutral: 0 };
    for (const u of units) {
      const n = offsets[u.side]++;
      u.pos = u.side === 'ally' ? (11 + Math.floor(n / 8)) * 13 + 3 + n % 8
        : u.side === 'enemy' ? (6 - Math.floor(n / 8)) * 13 + 3 + n % 8
        : (5 + n % 10) * 13 + 11 + Math.floor(n / 10);
    }
    const times: number[] = [], hashes: string[] = [], actors: Side[] = [];
    const count = sampledPreviewComputations();
    const initialRound = b.round;
    for (let step = 0; step < (trial < 0 ? 3 : 32) && !b.isOver() && b.round === initialRound; step++) {
      const id = b.turnOrder[b.turnIndex]!; actors.push(b.byId(id).side);
      const start = performance.now(); b.autoAction(id); times.push(performance.now() - start);
      hashes.push(createHash('sha256').update(JSON.stringify(b.toSnapshot())).digest('hex'));
    }
    if (trial < 0) continue;
    const sorted = [...times].sort((a, c) => a - c);
    const row = { sides, mixed, trial, actions: times.length, actors, totalMs: times.reduce((a, c) => a + c, 0),
      medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
      maxMs: sorted.at(-1), computations: sampledPreviewComputations() - count, hashes };
    rows.push(row); console.log(JSON.stringify({ ...row, hashes: undefined, actors: undefined }));
  }
}
writeFileSync(process.argv[2] ?? '.diagnostics/small32.json', JSON.stringify({ node: process.version, rows }, null, 2) + '\n');
