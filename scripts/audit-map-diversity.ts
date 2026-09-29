/** Reproducible offline structural audit. Usage: vite-node scripts/audit-map-diversity.ts [output.json]
 * Optional TB_MAP_BASELINE points to an archived v3 generator for matched-seed comparison. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { generatedField } from '../engine/src/small/field-generator.js';
import { measureMap, tileSimilarity, type MapMetrics } from '../engine/src/small/map-metrics.js';
import { ROUTE_TOPOLOGIES } from '../engine/src/small/route-graph.js';
import type { MapDesign } from '../engine/src/small/map-design.js';
import type { BattlefieldSpec } from '../engine/src/small/spatial.js';
const output = process.argv[2] ?? 'docs/map-route-v4-metrics.json';
const seeds = 160;
const cases = [
  { family: 'plains', w: 7, h: 13, tags: ['plains'] }, { family: 'forest', w: 7, h: 13, tags: ['forest'] },
  { family: 'mountain', w: 7, h: 13, tags: ['mountain'] }, { family: 'urban', w: 7, h: 13, tags: ['urban'] },
  { family: 'siege', w: 7, h: 13, tags: ['siege'] }, { family: 'indoor', w: 5, h: 7, tags: [] },
];
function spread(xs: number[]) {
  if (!xs.length) return { min: null, p10: null, median: null, p90: null, max: null, mean: null };
  const values = [...xs].sort((a, b) => a - b), at = (p: number) => values[Math.floor((values.length - 1) * p)]!;
  return { min: at(0), p10: at(.1), median: at(.5), p90: at(.9), max: at(1), mean: xs.reduce((s, n) => s + n, 0) / xs.length };
}
const metricsKeys = ['routeBranches', 'lateralLinks', 'narrowRegions', 'criticalCuts', 'shortestContactSteps',
  'shortestContactCost', 'alternativePaths', 'meanLOS', 'coverFraction'] as const;
function summary(fields: BattlefieldSpec[], metrics: MapMetrics[]) {
  const pairs: number[] = [], macroDistance: number[] = [];
  // Use all pairs, not just adjacent seeds; exact tile similarity and coarsened spatial-profile distance.
  for (let a = 0; a < fields.length; a++) for (let b = a + 1; b < fields.length; b++) {
    pairs.push(tileSimilarity(fields[a]!, fields[b]!));
    macroDistance.push(metrics[a]!.spatialProfile.reduce((s, v, i) => s + Math.abs(v - metrics[b]!.spatialProfile[i]!), 0) / (36 * 4));
  }
  const marks = fields.flatMap(f => f.generation?.landmark ? [f.generation.landmark] : []);
  return {
    count: fields.length, distinctTileArrays: new Set(fields.map(f => f.tiles.join(','))).size,
    distinctStructuralSignatures: new Set(metrics.map(m => m.signature)).size,
    tileSimilarity: spread(pairs), macroProfileDistance: spread(macroDistance),
    ...Object.fromEntries(metricsKeys.map(key => [key, spread(metrics.map(m => m[key]))])),
    terrainComponents: Object.fromEntries(['open', 'cover', 'wall', 'rough', 'forest', 'hill'].map(t =>
      [t, spread(metrics.map(m => m.terrainComponents[t as keyof MapMetrics['terrainComponents']]))])),
    coverCentroid: { x: spread(metrics.flatMap(m => m.coverCentroid ? [m.coverCentroid[0]] : [])), y: spread(metrics.flatMap(m => m.coverCentroid ? [m.coverCentroid[1]] : [])) },
    terrainCentroid: { x: spread(metrics.flatMap(m => m.terrainCentroid ? [m.terrainCentroid[0]] : [])), y: spread(metrics.flatMap(m => m.terrainCentroid ? [m.terrainCentroid[1]] : [])) },
    objectiveDistance: Object.fromEntries((['ally', 'enemy'] as const).map(side => [side, spread(metrics.map(m => m.objectiveDistances[side]))])),
    landmarkDistance: Object.fromEntries((['ally', 'enemy'] as const).map(side => [side, spread(metrics.flatMap(m => m.landmarkDistances ? [m.landmarkDistances[side]] : []))])),
    landmarks: { none: fields.length - marks.length, minor: marks.filter(m => m.scale !== 'major').length, major: marks.filter(m => m.scale === 'major').length },
    topologyCounts: Object.fromEntries(Object.keys(ROUTE_TOPOLOGIES).map(k => [k, fields.filter(f => f.generation?.routes?.kind === k).length])),
  };
}
const baseline = process.env.TB_MAP_BASELINE ? (await import(pathToFileURL(resolve(process.env.TB_MAP_BASELINE)).href)).generatedField as typeof generatedField : undefined;
const report = { schema: 1, seedPrefix: 'map-v4-audit-', mapsPerFamily: seeds, generatedMaps: 0,
  definitions: {
    similarity: 'All same-size pairs: fraction of equal tile types (1 means identical). Higher is not better.',
    spatialProfile: '3×3 zones, each with wall / costly terrain / ranged cover / hill coverage, quantized to quarters. Normalized L1 distance ignores names/seeds.',
    alternatives: 'Exact vertex-capacity max flow over actual ground-walkable tiles between deployment edges; graph routes themselves may share trunks.',
    routeBranches: 'Connected junction regions of the rasterized designed route graph; v3 has no graph, so its open-tile proxy is not directly comparable.',
    lateralLinks: 'Contiguous row groups with a route run spanning at least half the width; v3 uses open tiles as a proxy.',
    narrowRegions: 'Connected non-deployment traversable areas of grid degree ≤2. criticalCuts counts single blocked tiles that sever contact.',
    meanLOS: 'Average geometric visible length in 8 directions, existing wall/supercover rules, no unit occlusion or night restrictions.',
    distances: 'Minimum weighted ground movement from each deployment edge, not actual spawned units; actual roster deployment is tested separately.',
    interpretation: 'Structural proxies are not proof of human-perceived fun or match balance. More open terrain can increase LOS but reduce protected positions.',
  }, families: {} as Record<string, unknown>, topologyAblation: {} as Record<string, unknown> };
for (const c of cases) {
  const fields = Array.from({ length: seeds }, (_, n) => generatedField('map-v4-audit-' + n, c.w, c.h, c.tags));
  const measures = fields.map(measureMap);
  if (measures.some(m => m.alternativePaths < 2 || m.criticalCuts > 0 || !Number.isFinite(m.shortestContactCost))) throw Error('Unplayable map: ' + c.family);
  report.generatedMaps += fields.length;
  let previous;
  if (baseline) { const fs = Array.from({ length: seeds }, (_, n) => baseline('map-v4-audit-' + n, c.w, c.h, c.tags)); previous = summary(fs, fs.map(measureMap)); }
  report.families[c.family] = { current: summary(fields, measures), ...(previous ? { baseline: previous } : {}) };
}
const plan: MapDesign = { layout: 'lanes', orientation: 'diagonal', relief: 'balanced', cover: 'balanced', obstacles: 'dense', route: 'winding', breadth: 'normal', feature: 'none', featureZone: 'center' };
for (const topology of Object.keys(ROUTE_TOPOLOGIES) as (keyof typeof ROUTE_TOPOLOGIES)[]) {
  const fs = Array.from({ length: 40 }, (_, n) => generatedField('map-v4-ablation-' + n, 7, 13, ['urban'], { design: { ...plan, topology } }));
  report.topologyAblation[topology] = summary(fs, fs.map(measureMap)); report.generatedMaps += fs.length;
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ maps: report.generatedMaps, output, families: Object.keys(report.families) }));
