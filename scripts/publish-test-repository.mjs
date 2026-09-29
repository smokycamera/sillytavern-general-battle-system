/** Initial test-repository publication using the maintainer's own gh login.
 * Default is a read-only plan. Existing repositories are never overwritten.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const owner = 'smokycamera', target = owner + '/sillytavern-general-battle-system-test';
const root = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const execute = process.argv.includes('--publish');
if (process.argv.slice(2).some(a => !['--publish', '--dry-run'].includes(a))) throw Error('Use --dry-run or --publish');
console.log(JSON.stringify({ repository: target, visibility: 'public', version, prerelease: true, overwrite: false, execute }, null, 2));
if (!execute) process.exit(0);
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
if (!version.includes('-')) throw Error('Only explicitly prerelease versions may be published here');
if (run('git', ['status', '--porcelain'])) throw Error('Commit the verified candidate first; refusing a dirty checkout');
run(process.execPath, ['scripts/check-native-dist.mjs']);
run(process.execPath, ['scripts/check-worldbook-trait-only.mjs']);
if (run('gh', ['api', 'user', '--jq', '.login']) !== owner) throw Error('Log in as the repository owner first');
const existing = spawnSync('gh', ['api', 'repos/' + target], { encoding: 'utf8' });
if (existing.status === 0 || !existing.stderr?.includes('404')) throw Error('Target exists or access is uncertain; refusing to overwrite it');
const temp = mkdtempSync(path.join(tmpdir(), 'battle-test-release-'));
try {
  for (const file of run('git', ['ls-files', '-z']).split('\0').filter(Boolean)) {
    if (file.startsWith('.github/') || file.startsWith('.review-delivery')) continue;
    const destination = path.join(temp, file); mkdirSync(path.dirname(destination), { recursive: true }); copyFileSync(path.join(root, file), destination);
  }
  const manifestPath = path.join(temp, 'dist/build-manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const readme = path.join(temp, name);
    writeFileSync(readme, `# 通用战斗系统 Test\n\n候选版本 **${version}**，用于独立测试，不代表正式发布。请先备份聊天与战斗存档，勿与正式版同时启用。\n\n本库不自动执行原仓库的发布工作流；版本说明见 docs/breach-review.md。\n\n---\n\n` + readFileSync(readme, 'utf8').replaceAll('https://github.com/smokycamera/sillytavern-general-battle-system', 'https://github.com/' + target));
    // Only distribution READMEs change; retain verified runtime/source bytes and refresh those entries.
    const entry = manifest.files.find(f => f.path === name);
    if (!entry) throw Error('Package manifest does not include ' + name);
    const bytes = readFileSync(readme); entry.bytes = bytes.length; entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  run(process.execPath, ['scripts/check-native-dist.mjs'], temp);
  run('git', ['init', '-b', 'main'], temp); run('git', ['add', '--all'], temp);
  run('git', ['-c', 'user.name=' + owner, '-c', 'user.email=' + owner + '@users.noreply.github.com', 'commit', '-m', 'test: publish verified ' + version + ' candidate'], temp);
  run('gh', ['repo', 'create', target, '--public', '--description', '通用战斗系统 Test — independent prerelease builds', '--source', temp, '--remote', 'origin', '--push'], temp);
  const zip = path.join(temp, 'battle-' + version + '-test.zip');
  run('git', ['archive', '--format=zip', '--output=' + zip, 'HEAD'], temp);
  run('gh', ['release', 'create', 'v' + version, zip, '--repo', target, '--prerelease', '--title', '通用战斗系统 Test ' + version, '--notes-file', path.join(temp, 'docs/breach-review.md')], temp);
  console.log('Published https://github.com/' + target + '/releases/tag/v' + version);
} finally { rmSync(temp, { recursive: true, force: true }); }
