import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// 只核对证据集合与文件完整性；行为与视觉通过情况见执行记录，不由文件存在推断。
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = json('panel/dist/release-manifest.json');
for (const entry of [...manifest.inputs, ...manifest.outputs]) assert.equal(hash(readFileSync(entry.path)), entry.sha256, entry.path);
assert.equal(hash(JSON.stringify(manifest.inputs)), manifest.sourceFingerprint);
const traitText = readFileSync('engine/src/data/traits.ts', 'utf8');
const catalog = [...traitText.matchAll(/id: '([^']+)', name: '([^']+)'/g)].map((m) => ({ id: m[1], name: m[2] }));
assert.equal(catalog.length, 46);
assert.equal(new Set(catalog.map((t) => t.name)).size, 46);
assert.ok(catalog.every((t) => /^[\p{Script=Han}]+$/u.test(t.name)));
const evidence = json('docs/v2-trait-evidence.json');
const covered = evidence.groups.flatMap((g) => g.ids);
assert.equal(covered.length, 46);
assert.deepEqual(covered.sort(), catalog.map((t) => t.id).sort());
const paths = new Set();
function collect(value) {
  if (typeof value === 'string' && /^(engine|panel|scripts|docs)\/[^\s]+\.(ts|mjs|json|md)$/.test(value)) paths.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(evidence); for (const path of paths) assert.ok(existsSync(path), path);
const report = json('engine/sim/out/p6-ai-calibration.json');
assert.equal(report.completed, true); assert.equal(report.pairs, 500);
assert.equal(Object.keys(report.scenarios).length, 14);
let samples = 0;
for (const [id, scenario] of Object.entries(report.scenarios)) {
  assert.equal(scenario.completedPairs, 500, id); assert.equal(scenario.samples.length, 1000, id);
  assert.ok(scenario.samples.every((s) => Object.values(s).every(Number.isFinite)), id);
  assert.equal(scenario.metrics.runaway.mean, 0, id);
  for (const metric of Object.values(scenario.metrics)) {
    assert.ok(Number.isFinite(metric.mean) && Number.isFinite(metric.variance) && metric.variance >= 0);
    assert.ok(metric.interval95.every(Number.isFinite) && metric.interval95[0] <= metric.interval95[1]);
  }
  samples += scenario.samples.length;
}
assert.equal(Object.keys(report.comparisons).length, 4);
for (const comparison of Object.values(report.comparisons)) assert.equal(comparison.pairs, 500);
const frozenRoot = 'engine/sim/out/p6-calibration-inputs/';
const frozenHashes = report.sourcePaths.map((path) => ({ path, sha256: hash(readFileSync(frozenRoot + path)) }));
assert.equal(hash(frozenHashes.map((e) => e.path + ':' + e.sha256).join('\n')), report.sourceFingerprint);
const changed = frozenHashes.filter((e) => hash(readFileSync(e.path)) !== e.sha256).map((e) => e.path);
// 后续通用技能属于新规则；历史校准只对冻结输入有效，逐项列出差异，不挪用旧统计。
const genericEvidencePaths = ['engine/tests/generic-skills.test.ts', 'scripts/generic-skills-smoke.mjs', 'panel/src/protocol.test.ts', 'panel/src/narrative-controller.test.ts'];
const genericEvidenceFiles = genericEvidencePaths.map((path) => ({ path, sha256: hash(readFileSync(path)) }));
const result = { checkedAt: new Date().toISOString(), releaseFingerprint: manifest.sourceFingerprint,
  inputFiles: manifest.inputs.length, outputFiles: manifest.outputs.length,
  traits: catalog.length, evidenceFiles: paths.size, calibrationGames: samples,
  calibrationFingerprint: report.sourceFingerprint, calibrationFrozenFiles: frozenHashes.length,
  laterEngineChanges: changed,
  genericEvidenceFiles,
  scope: '文件/集合完整性通过。原14000场只对应冻结P6规则，不能说明后续通用技能/护送的平衡。通用技能和正文记录补强的实际运行结果见执行记录；文件存在不代替行为通过。按用户要求未追加大批量模拟。真实宿主延期。' };
writeFileSync('engine/sim/out/p6-candidate-integrity.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
