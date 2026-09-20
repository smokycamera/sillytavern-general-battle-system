/** Run every historical browser smoke entry point without hiding failed assertions.
 * Prerequisites: build:panel, resident controller build, pack-loader; Chromium installed.
 * Native metadata-only / legacy-full checks run separately in CI. A real-host test
 * is not run against an arbitrary existing server: provision an isolated host first.
 */
import { readdirSync, mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const directory = path.join(root, 'artifacts/review/all-smokes');
mkdirSync(directory, { recursive: true });
const timeoutMs = Number(process.env.TB_SMOKE_TIMEOUT_MS ?? 75000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw Error('Invalid TB_SMOKE_TIMEOUT_MS');
const files = readdirSync('scripts').filter(name => name.endsWith('-smoke.mjs') && !['native-extension-smoke.mjs', 'real-sillytavern-smoke.mjs'].includes(name)).sort();
const results = [];
async function run(script) {
  const started = Date.now();
  const logPath = path.join(directory, script.replace('.mjs', '.log'));
  const stream = createWriteStream(logPath);
  let timedOut = false;
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', './scripts/smoke-browser.mjs', 'scripts/' + script], {
      cwd: root, env: process.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); resolve({ status: 'failed', error: String(error), exitCode: null }); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed', exitCode: code, signal });
    });
  });
  await new Promise(resolve => stream.end(resolve));
  const text = readFileSync(logPath, 'utf8');
  const entry = { script: 'scripts/' + script, ...result, durationMs: Date.now() - started, log: path.relative(root, logPath),
    ...(result.status === 'passed' ? {} : { diagnosticTail: text.slice(-3000) }) };
  console.log(entry.status.toUpperCase(), entry.script, entry.durationMs + 'ms');
  results.push(entry);
}
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
  while (cursor < files.length) { const script = files[cursor++]; await run(script); }
}));
results.sort((a, b) => a.script.localeCompare(b.script));
const report = { checkedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA ?? null, realHost: false,
  scope: 'All historical *-smoke.mjs entry points with their default arguments; native and real-host checks are separate.',
  total: results.length, passed: results.filter(r => r.status === 'passed').length,
  failed: results.filter(r => r.status === 'failed').length, timedOut: results.filter(r => r.status === 'timeout').length, results };
writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, timedOut: report.timedOut }));
if (report.failed || report.timedOut) process.exitCode = 1;
