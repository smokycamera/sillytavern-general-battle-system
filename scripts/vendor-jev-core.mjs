import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const source = path.resolve(process.argv[2] ?? '../jev-general-tactic-system');
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--', 'packages/core/src')) throw Error('Commit core source changes before vendoring');
const output = path.resolve('vendor/jev-core'); mkdirSync(path.join(output, 'src'), { recursive: true });
const files = {};
for (const name of readdirSync(path.join(source, 'packages/core/src')).sort()) {
  if (!name.endsWith('.ts')) continue;
  const text = readFileSync(path.join(source, 'packages/core/src', name), 'utf8').replaceAll('\r\n', '\n');
  writeFileSync(path.join(output, 'src', name), text);
  files[name] = createHash('sha256').update(text).digest('hex');
}
writeFileSync(path.join(output, 'source.json'), JSON.stringify({ repository: 'https://github.com/smokycamera/jev-general-tactic-system', commit: git('rev-parse', 'HEAD'), files }, null, 2) + '\n');
console.log(`Vendored ${Object.keys(files).length} core files from ${git('rev-parse', '--short', 'HEAD')}`);
