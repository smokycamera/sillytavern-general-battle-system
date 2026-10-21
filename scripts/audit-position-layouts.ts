/** Matched-seed structural audit. Optional --baseline=archived/engine/src/small/layered-generator.ts. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generatedLayeredField } from '../engine/src/small/layered-generator.js';
import { geometrySignature } from '../engine/src/small/map-metrics.js';
import { COMPOUND_PATTERNS, TRENCH_PATTERNS } from '../engine/src/small/position-plan.js';
import type { BattlefieldSpec } from '../engine/src/small/spatial.js';
const folder = 'artifacts/position-layout-research'; mkdirSync(folder, { recursive: true });
const baselinePath = process.argv.find(a => a.startsWith('--baseline='))?.slice(11);
const baseline = baselinePath ? (await import(pathToFileURL(resolve(baselinePath)).href)).generatedLayeredField as typeof generatedLayeredField : undefined;
function skeleton(f: BattlefieldSpec): string {
  const cells = f.tiles.map((_, p) => {
    const s = f.structures?.[p]; return s && s.hp > 0 && ['wall', 'gate', 'building', 'tower', 'fortification'].includes(s.kind) ? s.kind : '.';
  });
  const variants: string[] = [];
  for (const fx of [false, true]) for (const fy of [false, true]) {
    const v: string[] = [];
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) v.push(cells[(fy ? f.height - 1 - y : y) * f.width + (fx ? f.width - 1 - x : x)]!);
    variants.push(v.join(','));
  }
  return variants.sort()[0]!;
}
const report: any = { date: '2026-10-21', mapsPerScene: 60, method: 'Same seed/size and actual generatedLayeredField. Skeleton retains intact wall, gate, building, tower, fortification; removes furnishings and combines horizontal/vertical reflections. Pattern count is separate from structural signatures.', conditions: [], unchanged: [], samples: [] };
for (const scene of ['building_siege', 'trenches'] as const) {
  const [w, h] = scene === 'building_siege' ? [11, 17] : [7, 13];
  for (const [name, generate] of [['before', baseline], ['after', generatedLayeredField]] as const) {
    if (!generate) continue;
    const exact = new Set<string>(), structural = new Set<string>(), patterns: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      const f = generate('position-audit-' + i, w, h, [], { scene });
      exact.add(geometrySignature(f)); structural.add(skeleton(f));
      const p = f.generation?.compound?.pattern ?? f.generation?.trenches?.pattern ?? 'legacy'; patterns[p] = (patterns[p] ?? 0) + 1;
    }
    report.conditions.push({ scene, stage: name, dimensions: `${w}x${h}`, exact: exact.size, skeletons: structural.size, patterns });
  }
}
if (baseline) for (const scene of ['field', 'city_siege', 'city_streets', 'interior'] as const) {
  let identical = 0;
  for (let i = 0; i < 30; i++) {
    const seed = 'unchanged-position-' + i, opts = { scene };
    if (geometrySignature(generatedLayeredField(seed, 7, 13, [], opts)) === geometrySignature(baseline(seed, 7, 13, [], opts))) identical++;
  }
  report.unchanged.push({ scene, identical, count: 30 });
}
for (const pattern of COMPOUND_PATTERNS) report.samples.push({ scene: 'building_siege', pattern, field: generatedLayeredField('sample-' + pattern, 7, 13, [], { plan: { scene: 'building_siege', size: 'standard', compound: { pattern } } }) });
for (const pattern of TRENCH_PATTERNS) report.samples.push({ scene: 'trenches', pattern, field: generatedLayeredField('sample-' + pattern, 7, 13, [], { plan: { scene: 'trenches', size: 'standard', trenches: { pattern } } }) });
writeFileSync(`${folder}/offline.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ conditions: report.conditions, unchanged: report.unchanged, samples: report.samples.length }, null, 2));
if (report.unchanged.some((c: any) => c.identical !== c.count)) process.exitCode = 1;
