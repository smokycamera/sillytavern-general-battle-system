import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nativeSourceFingerprint } from './native-build-fingerprint.mjs';
const output = path.resolve('release/native-candidate');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const extensionManifest = { ...JSON.parse(readFileSync('extension/manifest.json', 'utf8')), version };
if (JSON.parse(readFileSync('extension/manifest.json', 'utf8')).version !== version) throw Error('Extension template version differs from package.json');
extensionManifest.display_name += `v${version}`;
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(extensionManifest, null, 2) + '\n');
for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE', 'LICENSE-NOTES.md', 'THIRD_PARTY_NOTICES.md']) copyFileSync(file, path.join(output, file));
for (const directory of ['assets', 'licenses', 'docs']) {
  if (directory === 'docs') {
    mkdirSync(path.join(output, directory), { recursive: true });
    for (const name of ['README.md', 'current-release.md', 'release-channels.md', 'battlefield-refactor-implementation.md', 'battle-planning-v2.md', 'battle-save-policy-20261016.md', 'embedded-worldbook.md', 'native-event-display.md', 'secondary-api-two-step-20261002.md', 'jev-integration.md', 'mcp-player-bridge.md', 'update-2.6-20261019.md', 'worn-anchoring-20261020.md', 'traits-items-stacking-revision-20261019.md', 'level-anchoring-v21-20261019.md', 'control-worn-v20-20261018.md', 'item-system-20261011.md', 'worldbook-xml-markdown.md', 'worldbook-format-review-20261026.md', 'clear-count-review-20261026.md', 'numeric-v26-20261023.md', 'artillery-recovery-v27-20261023.md', 'rocket-sprayer-v28-20261023.md', 'capacity-weight-v29-20261023.md', 'version-rollback.md']) copyFileSync(path.join(directory, name), path.join(output, directory, name));
  } else cpSync(directory, path.join(output, directory), { recursive: true });
}
mkdirSync(path.join(output, 'scripts'), { recursive: true });
copyFileSync('docs/mvu-save-history-20261020.md', path.join(output, 'docs/mvu-save-history-20261020.md'));
copyFileSync('docs/performance-battle-save-20261028.md', path.join(output, 'docs/performance-battle-save-20261028.md'));
copyFileSync('docs/effect-source-migration-review-20261026.md', path.join(output, 'docs/effect-source-migration-review-20261026.md'));
copyFileSync('docs/effect-round-end-stacking-review-20261026.md', path.join(output, 'docs/effect-round-end-stacking-review-20261026.md'));
copyFileSync('docs/indoor-layouts-20261020.md', path.join(output, 'docs/indoor-layouts-20261020.md'));
copyFileSync('docs/siege-trenches-20261021.md', path.join(output, 'docs/siege-trenches-20261021.md'));
copyFileSync('docs/llm-command-20261021.md', path.join(output, 'docs/llm-command-20261021.md'));
copyFileSync('docs/character-worldbooks-20261024.md', path.join(output, 'docs/character-worldbooks-20261024.md'));
copyFileSync('docs/worldbook-start-20261024.md', path.join(output, 'docs/worldbook-start-20261024.md'));
copyFileSync('docs/region-battlefields-20261024.md', path.join(output, 'docs/region-battlefields-20261024.md'));
copyFileSync('docs/region-battlefields-proposal-20261024.md', path.join(output, 'docs/region-battlefields-proposal-20261024.md'));
copyFileSync('docs/worldbook-map-review-20261024.md', path.join(output, 'docs/worldbook-map-review-20261024.md'));
copyFileSync('docs/standard-skill-damage-v31-20261023.md', path.join(output, 'docs/standard-skill-damage-v31-20261023.md'));
copyFileSync('docs/standard-skill-damage-v32-20261023.md', path.join(output, 'docs/standard-skill-damage-v32-20261023.md'));
copyFileSync('docs/sprayer-mobility-command-fixes-20261024.md', path.join(output, 'docs/sprayer-mobility-command-fixes-20261024.md'));
copyFileSync('docs/small-three-way-result-20261018.md', path.join(output, 'docs/small-three-way-result-20261018.md'));
cpSync('docs/prompt-backups', path.join(output, 'docs/prompt-backups'), { recursive: true });
mkdirSync(path.join(output, 'mcp'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'server.mjs', 'broker.mjs', 'tools.mjs', 'start.ps1', 'README.md', 'GAMEPLAY.md']) copyFileSync(path.join('mcp', name), path.join(output, 'mcp', name));
cpSync('mcp/test', path.join(output, 'mcp/test'), { recursive: true });
copyFileSync('scripts/jev-cors-relay.mjs', path.join(output, 'scripts/jev-cors-relay.mjs'));
const files = [];
function visit(dir) { for (const name of readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, name.name); if (name.isDirectory()) visit(file); else files.push(file); } }
visit(output);
for (const file of files.filter(file => /\.(js|html)$/.test(file))) {
  const text = readFileSync(file, 'utf8');
  if (/TavernHelper|executeSlashCommands|JS-Slash-Runner|https?:\/\/[^\s"'`<>]+\.js/.test(text)) throw Error('原生运行包含有助手或远程脚本依赖: ' + file);
}
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceFingerprint = nativeSourceFingerprint();
const manifest = { format: 'tavern-battle-native-build', version, builtAt: new Date().toISOString(), sourceFingerprint,
  baselineSha256: JSON.parse(readFileSync('release/baselines/user-20260918/metadata.json', 'utf8')).sourceSha256,
  files: files.filter(file => !file.endsWith('build-manifest.json')).map(file => ({ path: path.relative(output, file).replaceAll('\\', '/'), bytes: readFileSync(file).length, sha256: hash(file) })),
  validation: { dependencyAudit: 'not-run-by-build', status: 'release-candidate', report: 'docs/current-release.md' } };
writeFileSync(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// The repository itself is directly installable by the host extension manager.
const dist=path.resolve('dist');
if (dist !== path.join(process.cwd(), 'dist') || path.dirname(dist) !== process.cwd()) throw Error('Unexpected output directory');
rmSync(dist,{recursive:true,force:true});
mkdirSync(dist,{recursive:true});
for(const name of ['index.js','assets','panel']) cpSync(path.join(output,name),path.join(dist,name),{recursive:true});
const rootManifest={...extensionManifest,js:'dist/index.js'};
writeFileSync('manifest.json',JSON.stringify(rootManifest,null,2)+'\n');
const repositoryManifest={...manifest,layout:'paths relative to repository root',files:manifest.files.map(file=>{
  const runtime=file.path==='index.js'||file.path.startsWith('panel/')||/^assets\/[^/]+\.(js|css)$/.test(file.path);
  return file.path==='manifest.json'?{path:file.path,bytes:readFileSync(file.path).length,sha256:hash(file.path)}:{...file,path:runtime?'dist/'+file.path:file.path};
})};
writeFileSync(path.join(dist,'build-manifest.json'),JSON.stringify(repositoryManifest,null,2)+'\n');
console.log(`Native package: ${manifest.files.length} files; dependency audit is a separate check.`);
