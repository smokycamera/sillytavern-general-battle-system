import fs from 'node:fs';
import path from 'node:path';
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const directory = 'artifacts/review'; fs.mkdirSync(directory, { recursive: true });
const full = read(directory + '/full-tests.json');
const native = read(directory + '/native-tests.json');
const baseline = read('docs/validation-results.json');
const known = new Set((baseline?.knownBaselineFailures ?? []).map(line => line.trim().replace(/^FAIL\s+/, '')));
const failures = (full?.testResults ?? []).flatMap(suite => suite.assertionResults.filter(a => a.status === 'failed').map(a =>
  path.relative(process.cwd(), suite.name).replaceAll('\\', '/') + ' > ' + [...(a.ancestorTitles ?? []), a.title].join(' > ')));
const newFailures = failures.filter(name => !known.has(name));
const totals = result => result ? { files: result.testResults.length, total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests } : null;
const names = ['TYPES', 'TESTS', 'NATIVE', 'AUDIT', 'COMPATIBILITY', 'BUILD', 'SMOKE', 'LEGACY_BUILD', 'EXTENDED', 'REAL_HOST'];
const checks = Object.fromEntries(names.map(key => [key, process.env[key] ?? 'not-run']));
const audit = read(directory + '/npm-audit.json');
const report = {
  checkedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA ?? null,
  runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  checks, fullSuite: totals(full), nativeSuite: totals(native), knownBaselineFailures: failures.filter(name => known.has(name)), newFailures,
  nativeBrowser: ['metadata-only', 'legacy-full'].map(mode => read(`artifacts/native-extension-smoke/${mode}/report.json`)),
  historicalSmokes: read(directory + '/all-smokes/summary.json'),
  realHost: read('artifacts/real-sillytavern/report.json'),
  audit: { counts: audit?.metadata?.vulnerabilities ?? null, production: read(directory + '/npm-audit-production.json')?.metadata?.vulnerabilities ?? null,
    packages: Object.entries(audit?.vulnerabilities ?? {}).map(([name, value]) => ({ name, severity: value.severity, fixAvailable: value.fixAvailable })) },
};
fs.writeFileSync(directory + '/summary.json', JSON.stringify(report, null, 2) + '\n');
const packageReady = ['TYPES', 'TESTS', 'NATIVE', 'COMPATIBILITY', 'BUILD', 'SMOKE', 'LEGACY_BUILD', 'EXTENDED'].every(name => checks[name] === 'success') && !!full?.numTotalTests && full.numFailedTests === 0 && full.numPendingTests === 0;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `package_ready=${packageReady}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = Object.entries(checks).map(([name, outcome]) => `| ${name} | ${outcome} |`).join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| Check | Outcome |\n| --- | --- |\n${rows}\n\nFull suite: ${full?.numPassedTests ?? '?'} passed, ${full?.numFailedTests ?? '?'} failed. New failures versus the recorded baseline: ${newFailures.length}.\n\nA native package being built does not imply that historical tests or the dependency audit are green.\n`);
}
console.log(JSON.stringify({ full: totals(full), native: totals(native), baselineFailures: failures.length - newFailures.length, newFailures, packageReady }, null, 2));
