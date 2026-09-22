import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const output = path.resolve('release/native-candidate');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
copyFileSync('extension/manifest.json', path.join(output, 'manifest.json'));
for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE', 'COMMERCIAL-LICENSE.md', 'THIRD_PARTY_NOTICES.md']) copyFileSync(file, path.join(output, file));
mkdirSync(path.join(output, 'release'), { recursive: true });
copyFileSync('release/current-baseline.json', path.join(output, 'release/current-baseline.json'));
for (const directory of ['assets', 'licenses', 'docs']) {
  if (directory === 'docs') {
    mkdirSync(path.join(output, directory), { recursive: true });
    for (const name of ['native-extension-validation.md', 'validation-results.json', 'extension-migration-assessment-20260919.md', 'native-extension-migration-plan-20260919.md', 'script-baseline-20260919.md', 'jev-integration.md', 'jev-cors-validation.md', 'jev-retry-validation.md', 'jev-command-validation-20260922.md', 'jev-context-validation-20260922.md']) copyFileSync(path.join(directory, name), path.join(output, directory, name));
  } else cpSync(directory, path.join(output, directory), { recursive: true });
}
mkdirSync(path.join(output, 'scripts'), { recursive: true });
copyFileSync('scripts/jev-cors-relay.mjs', path.join(output, 'scripts/jev-cors-relay.mjs'));
const files = [];
function visit(dir) { for (const name of readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, name.name); if (name.isDirectory()) visit(file); else files.push(file); } }
visit(output);
for (const file of files.filter(file => /\.(js|html)$/.test(file))) {
  const text = readFileSync(file, 'utf8');
  if (/TavernHelper|executeSlashCommands|JS-Slash-Runner|https?:\/\/[^\s"'`<>]+\.js/.test(text)) throw Error('原生运行包含有助手或远程脚本依赖: ' + file);
}
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceFiles=[];
const collect=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file);else sourceFiles.push(file)}};
for (const dir of ['engine/src', 'panel/src', 'host/src', 'runtime/src', 'extension', 'assets', 'vendor/jev-core']) collect(dir);
sourceFiles.push('panel/index.html','package.json','package-lock.json','scripts/package-extension.mjs','scripts/jev-cors-relay.mjs');
const sourceFingerprint=createHash('sha256').update(sourceFiles.sort().map(file=>`${file.replaceAll('\\','/')}\0${hash(file)}`).join('\n')).digest('hex');
const manifest = { format: 'tavern-battle-native-build', version, builtAt: new Date().toISOString(), sourceFingerprint,
  baselineSha256: JSON.parse(readFileSync('release/current-baseline.json', 'utf8')).sourceSha256,
  files: files.filter(file => !file.endsWith('build-manifest.json')).map(file => ({ path: path.relative(output, file).replaceAll('\\', '/'), bytes: readFileSync(file).length, sha256: hash(file) })),
  validation: { dependencyAudit: 'not-run-by-build', status: 'release-candidate', report: 'docs/native-extension-validation.md' } };
writeFileSync(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// The repository itself is directly installable by the host extension manager.
const dist=path.resolve('dist');
if (dist !== path.join(process.cwd(), 'dist') || path.dirname(dist) !== process.cwd()) throw Error('Unexpected output directory');
rmSync(dist,{recursive:true,force:true});
mkdirSync(dist,{recursive:true});
for(const name of ['index.js','assets','panel']) cpSync(path.join(output,name),path.join(dist,name),{recursive:true});
const rootManifest={...JSON.parse(readFileSync('extension/manifest.json','utf8')),js:'dist/index.js'};
writeFileSync('manifest.json',JSON.stringify(rootManifest,null,2)+'\n');
const repositoryManifest={...manifest,layout:'paths relative to repository root',files:manifest.files.map(file=>{
  const runtime=file.path==='index.js'||file.path.startsWith('panel/')||/^assets\/[^/]+\.(js|css)$/.test(file.path);
  return file.path==='manifest.json'?{path:file.path,bytes:readFileSync(file.path).length,sha256:hash(file.path)}:{...file,path:runtime?'dist/'+file.path:file.path};
})};
writeFileSync(path.join(dist,'build-manifest.json'),JSON.stringify(repositoryManifest,null,2)+'\n');
console.log(`Native package: ${manifest.files.length} files; dependency audit is a separate check.`);
