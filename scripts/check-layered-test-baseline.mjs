/** Compare the unchanged main-branch failures, without hiding them from the normal CI job. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const report = JSON.parse(readFileSync(process.argv[2] ?? 'artifacts/review/full-tests.json', 'utf8'));
const known = new Set([
  'engine/tests/unified-replay.test.ts::V5 saved battles and V6 prototype replay compatibility V5 human-four T1',
  'engine/tests/unified-replay.test.ts::V5 saved battles and V6 prototype replay compatibility V5 giant-four T10',
  'engine/tests/unified-replay.test.ts::V5 saved battles and V6 prototype replay compatibility V6-prototype giant-four T6',
  'engine/tests/unified-replay.test.ts::V5 saved battles and V6 prototype replay compatibility V6-prototype giant-unbreakable T1',
  'engine/tests/unified-replay.test.ts::V5 saved battles and V6 prototype replay compatibility V6-prototype human4-vehicle2 T10',
  'panel/src/life-limit-state.test.ts::生命上限贯穿正文、编辑与档案 正文高生命自动截断并给出提示，编队人数保留原值',
  'panel/src/life-limit-state.test.ts::生命上限贯穿正文、编辑与档案 正文事务不能在生成后用旧事件值覆盖生命上限',
]);
const failures = report.testResults.flatMap(file => file.assertionResults.filter(t => t.status === 'failed').map(t => {
  const relative = file.name.replaceAll('\\','/').match(/(?:engine\/tests|panel\/src)\/.*$/)?.[0] ?? file.name;
  return relative + '::' + t.fullName;
}));
assert.ok(report.numTotalTests >= 1579, 'Expected the complete suite including layered-city tests');
assert.equal(report.numFailedTests, failures.length, 'Unaccounted suite/process failure');
assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0, 'Runtime-error suite is not a baseline test failure');
const additional = failures.filter(f => !known.has(f));
assert.deepEqual(additional, [], 'New failures are not covered by the baseline');
console.log(JSON.stringify({total:report.numTotalTests,passed:report.numPassedTests,knownFailures:failures,newFailures:additional},null,2));
