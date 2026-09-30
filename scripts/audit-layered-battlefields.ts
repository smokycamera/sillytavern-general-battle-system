/** Reproducible static map and deployment audit; run with vite-node. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { geometrySignature } from '../engine/src/small/map-metrics.js';
import { generatedLayeredField, groundBlocked, findGridPath, validateField, generateUnit, SmallBattle, V11_OVERFLOW_D20, type BattlefieldPlan } from '../engine/src/index.js';
const start = performance.now(), failures: unknown[] = [], signatures = new Set<string>();
let maps = 0, deployments = 0, approachChecks = 0;
for (const environment of ['plains', 'forest', 'mountain', 'urban', 'siege']) for (const size of ['compact', 'standard', 'large'] as const) for (let i = 0; i < 160; i++) {
  const seed = `${environment}-${size}-${i}`;
  const plan: BattlefieldPlan = { size, fortLevel: i % 10 + 1, water: (['none', 'ford', 'river', 'moat'] as const)[i % 4],
    shape: (['front', 'enclosure', 'riverside', 'hillside', 'broken'] as const)[i % 5], density: (['sparse', 'balanced', 'dense'] as const)[i % 3] };
  try {
    const field = generatedLayeredField(seed, 7, 13, [environment], { plan, attackingSide: i % 2 ? 'enemy' : 'ally' });
    validateField(field); maps++;
    if (groundBlocked(field, field.objective.cell)) throw Error('blocked goal');
    if (!field.city) for (const row of [1, field.height - 2]) {
      const origin = row * field.width + Math.floor(field.width / 2);
      if (!findGridPath(field, origin, field.objective.cell, p => !groundBlocked(field, p))) throw Error('disconnected outdoor approach');
      approachChecks++;
    }
    signatures.add(geometrySignature(field));
    if (i % 10 === 0) {
      const units = (['ally', 'enemy'] as const).flatMap(side => Array.from({ length: 6 }, (_, n) => {
        const u = generateUnit({ name: side + n, side, scale: 'company', hpMax: 20, level: 3, rulesVersion: 'v2', weaponClass: n % 2 ? 'rifle' : 'sword', weaponLevel: 3, traits: [] }, { seed: side + n, noVariance: true }).unit;
        u.id = side + n; return u;
      }));
      const b = new SmallBattle({ battlefield: field, combatants: units, rules: V11_OVERFLOW_D20, seed }); b.start();
      if (b.combatants.some(u => groundBlocked(b.battlefield!, u.pos!, u))) throw Error('illegal deployment');
      const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
      if (JSON.stringify(restored.toSnapshot()) !== JSON.stringify(b.toSnapshot())) throw Error('snapshot differs');
      deployments++;
    }
  } catch (error) { failures.push({ seed, message: String(error) }); }
}
const report = { maps, distinctMaps: signatures.size, deployments, approachChecks, elapsedMs: performance.now() - start, failures };
writeFileSync(process.env.TB_AUDIT_REPORT ?? 'docs/layered-map-audit-20260929.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, failures: failures.slice(0, 20) }, null, 2));
if (failures.length) process.exitCode = 1;
