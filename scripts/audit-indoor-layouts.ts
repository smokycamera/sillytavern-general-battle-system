import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generatedLayeredField } from '../engine/src/small/layered-generator.js';
import { geometrySignature } from '../engine/src/small/map-metrics.js';
import { compileLayout, type LayoutContext } from '../panel/src/llm-layout.js';
import type { BattlefieldSpec } from '../engine/src/small/spatial.js';
import type { SceneArchetype } from '../engine/src/small/scene-intent.js';

const seedCount = 60;
const sizes = ['compact', 'standard', 'large'] as const;
const archetypes = ['residence', 'great_hall', 'fortress'] as const;
const names = { residence: '住宅院落', great_hall: '仓库大厅', fortress: '堡垒内部' };
const structural = (f: BattlefieldSpec) => f.tiles.map((_, p) => {
  const s = f.structures?.[p];
  return s && s.hp > 0 && ['building', 'wall', 'tower'].includes(s.kind) ? '#'
    : s?.kind === 'gate' && s.hp > 0 ? 'G' : '.';
});
function canonical(f: BattlefieldSpec): string {
  const cells = structural(f), variants: string[] = [];
  for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const v: string[] = [];
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      v.push(cells[(flipY ? f.height - 1 - y : y) * f.width + (flipX ? f.width - 1 - x : x)]!);
    }
    variants.push(v.join(''));
  }
  return variants.sort()[0]!;
}
function straightSpine(f: BattlefieldSpec): boolean {
  return Array.from({ length: f.width }, (_, x) => x).some(x =>
    Array.from({ length: f.height - 4 }, (_, d) => (d + 2) * f.width + x)
      .every(p => structural(f)[p] === '.' && f.overlays?.[p]?.includes('road')));
}
function rows(f: BattlefieldSpec): string[] {
  const cells = structural(f);
  return Array.from({ length: f.height }, (_, y) => cells.slice(y * f.width, (y + 1) * f.width).join(''));
}
const report = {
  date: '2026-10-20',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  seedCount,
  method: 'Actual generatedLayeredField; exact geometry ignores labels/IDs/durability; skeleton keeps intact wall/building/tower/gate placement, removes furnishings, canonicalizes horizontal/vertical reflections. A structural signature is not a room-connectivity graph or a fun score. No real model API requests and no battle simulations.',
  conditions: [] as object[],
  semanticRoomComparisons: [] as object[],
  samples: [] as object[],
  generatedMaps: 0,
  failures: [] as object[],
};
for (const size of sizes) for (const mode of ['local', ...archetypes] as const) {
  // Without a plan the generator's width=7 entry selects compact indoor space.
  // Audit that default once, and keep explicit 9x15 local generation as a separate condition.
  if (mode === 'local' && size === 'standard') continue;
  const exact = new Set<string>(), skeletons = new Set<string>();
  let spines = 0, dims = '';
  const distribution: Record<string, number> = {};
  for (let i = 0; i < seedCount; i++) {
    const seed = `indoor-research-${size}-${i}`;
    try {
      // Dimensions below are recorded after generation, rather than inferred from the requested size.
      const [w, h] = size === 'compact' ? [5, 7] : size === 'standard' ? [7, 13] : [9, 15];
      const f = generatedLayeredField(seed, w, h, ['indoor'], {
        scene: 'interior', ...(mode === 'local' ? {} : { plan: { scene: 'interior', size, archetype: mode } }),
      });
      report.generatedMaps++;
      exact.add(geometrySignature(f)); skeletons.add(canonical(f));
      if (straightSpine(f)) spines++;
      dims = `${f.width}x${f.height}`;
      const a = f.scene?.archetype ?? 'unset'; distribution[a] = (distribution[a] ?? 0) + 1;
      if (size === 'standard' && mode !== 'local' && i === 0) report.samples.push({ mode, name: names[mode], seed, rows: rows(f), objective: f.objective.cell });
    } catch (error) { report.failures.push({ size, mode, seed, error: String(error) }); }
  }
  report.conditions.push({ size, mode, dimensions: dims, generated: seedCount, exactGeometries: exact.size, mirroredStructuralSkeletons: skeletons.size, straightSpines: spines, archetypes: distribution });
}
for (const size of sizes) for (const archetype of archetypes) {
  const ctx: LayoutContext = { scene: 'interior', size, attacker: 'ally', objectiveMode: 'annihilation', units: [], map: size === 'compact' ? [5, 7] : size === 'standard' ? [7, 13] : [9, 15] };
  const seed = `indoor-room-comparison-${size}-${archetype}`;
  const a = compileLayout({ archetype, places: [{ type: 'room', name: '书房', at: 'N' }] }, ctx).plan;
  const b = compileLayout({ archetype, places: [{ type: 'room', name: '厨房', at: 'SE' }, { type: 'room', name: '卧室', at: 'NW' }] }, ctx).plan;
  try {
    const fieldA = generatedLayeredField(seed, 7, 13, ['indoor'], { scene: 'interior', plan: a });
    const fieldB = generatedLayeredField(seed, 7, 13, ['indoor'], { scene: 'interior', plan: b });
    report.generatedMaps += 2;
    report.semanticRoomComparisons.push({ size, archetype: archetype as SceneArchetype, sameGeometry: geometrySignature(fieldA) === geometrySignature(fieldB), markedCellsA: fieldA.landmarks?.map(l => l.cells), markedCellsB: fieldB.landmarks?.map(l => l.cells) });
  } catch (error) { report.failures.push({ size, archetype, pair: 'semantic-room', error: String(error) }); }
}
writeFileSync(process.env.TB_AUDIT_REPORT ?? 'artifacts/indoor-layout-research/after-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, samples: report.samples.map(({ rows, ...rest }: any) => rest) }, null, 2));
if (report.failures.length) process.exitCode = 1;

