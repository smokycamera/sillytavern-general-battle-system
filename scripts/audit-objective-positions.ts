/** Offline objective placement audit over actual layout families; no model calls. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { generatedLayeredField, generateUnit, SmallBattle, V11_OVERFLOW_D20, type BattlefieldPlan } from '../engine/src/index.js';
import { findGridPath, validateField, gridDistance } from '../engine/src/small/spatial.js';
import { groundBlocked } from '../engine/src/small/layers.js';
import { COMPOUND_PATTERNS, TRENCH_PATTERNS } from '../engine/src/small/position-plan.js';
import { INTERIOR_PATTERNS } from '../engine/src/small/interior-plan.js';
import { prepareBattleObjective } from '../panel/src/battle-setup.js';
const plans: BattlefieldPlan[] = [
  ...COMPOUND_PATTERNS.map(pattern => ({ scene: 'building_siege' as const, compound: { pattern } })),
  ...INTERIOR_PATTERNS.map(pattern => ({ scene: 'interior' as const, interior: { pattern } })),
  ...TRENCH_PATTERNS.map(pattern => ({ scene: 'trenches' as const, trenches: { pattern } })),
  ...(['field', 'city_siege', 'city_streets'] as const).map(scene => ({ scene })),
];
const rows: any[] = [];
for (const plan of plans) for (const seed of ['objective-a', 'objective-b']) for (const mode of ['escort', 'intercept', 'control'] as const) {
  const units = (['ally', 'enemy'] as const).flatMap(side => Array.from({ length: 4 }, (_, i) => {
    const u = generateUnit({ name: side + i, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'sword', traits: [] }, { seed: side + i, noVariance: true }).unit;
    u.id = side + i; return u;
  }));
  const label = plan.compound?.pattern ?? plan.interior?.pattern ?? plan.trenches?.pattern ?? 'local';
  const row: any = { scene: plan.scene, pattern: label, seed, mode };
  try {
    const f = prepareBattleObjective(generatedLayeredField(seed, 7, 13, [], { roster: units, plan }), units, mode);
    validateField(f);
    const side = mode === 'intercept' ? 'enemy' : 'ally', vip = f.initialDeployment![side + '0']!.pos;
    const hypothetical = structuredClone(f);
    for (const s of hypothetical.structures ?? []) if (s?.kind === 'gate' && s.hp > 0) s.gateState = 'open';
    const starts = mode === 'control' ? ['ally0', 'enemy0'].map(id => f.initialDeployment![id]!.pos) : [vip];
    const reachable = starts.every(p => !!findGridPath(hypothetical, p, f.objective.cell, n => !groundBlocked(hypothetical, n)));
    const edge = f.objective.cell % f.width === 0 || f.objective.cell % f.width === f.width - 1 || Math.floor(f.objective.cell / f.width) === 0 || Math.floor(f.objective.cell / f.width) === f.height - 1;
    const battle = new SmallBattle({ battlefield: f, combatants: units, rules: V11_OVERFLOW_D20, seed }); battle.start();
    row.success = reachable && (mode === 'control' || edge);
    row.cell = f.objective.cell; row.dimensions = [f.width, f.height]; row.edge = edge; row.reachableWithDoorsOpen = reachable;
    row.distanceFromVip = gridDistance(f, vip, f.objective.cell);
    row.restored = JSON.stringify(SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot())).toSnapshot()) === JSON.stringify(battle.toSnapshot());
    row.success &&= row.restored;
  } catch (e) { row.success = false; row.error = e instanceof Error ? e.message : String(e); }
  rows.push(row);
}
const summary = { total: rows.length, passed: rows.filter(r => r.success).length, failures: rows.filter(r => !r.success) };
const output = process.argv[2] ?? 'artifacts/position-layout-research/objectives.json';
mkdirSync('artifacts/position-layout-research', { recursive: true });
writeFileSync(output, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.passed !== summary.total) process.exitCode = 1;
