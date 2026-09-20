#!/usr/bin/env node
/**
 * 分发打包器：panel/dist/index.html（vite 单文件面板）→ 酒馆助手脚本 JSON。
 *
 * 产物 panel/dist/tavern-battle-script.json 的导入路径：
 *   酒馆助手 → 脚本库 → 全局脚本库 → 导入 → 启用脚本。
 *
 * 用法：npm run build:dist（= vite build panel && node scripts/pack-loader.mjs）
 *
 * 脚本 JSON 结构对齐 JS-Slash-Runner 的 Script zod 模式
 * （type/enabled/name/id/content/info/button/data/export_with）。
 */
const candidate = process.argv.includes('--candidate');
if (!candidate) await import('./check-source-baseline.mjs');
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = candidate ? 'release/source-aligned-candidate' : 'panel/dist';
const HTML_PATH = resolve(root, distDir, 'index.html');
const TEMPLATE_PATH = resolve(root, 'scripts/loader.template.js');
const OUT_PATH = resolve(root, distDir, 'tavern-battle-script.json');

/** 固定脚本 id：版本更新后重复导入会被识别为同一脚本，避免越积越多 */
const SCRIPT_ID = 'a4c1f7d2-9b3e-4f6a-8d15-2e7c9b40a613';
const BTN_NAME = '战阵面板';

const html = readFileSync(HTML_PATH, 'utf8');
if (!/<html/i.test(html) || html.length < 10000) {
  throw new Error('panel/dist/index.html 缺失或不完整——请先执行 npm run build:panel');
}

/**
 * 把面板 HTML 打成 JS 表达式：["分片", …].join('')
 * 酒馆助手会把脚本 content 内联进 <script> 标签执行，HTML 里的 </script 与 <!--
 * 会提前截断标签——因此每个危险序列都在第 2、3 字符之间切断，任一分片都不含完整序列，
 * 拼接执行后再逐字节还原。
 */
function packHtmlAsExpr(source) {
  const re = /<\/script|<!--/gi;
  const cuts = [];
  let m;
  while ((m = re.exec(source))) cuts.push(m.index + 2);
  const chunks = [];
  let last = 0;
  for (const cut of cuts) {
    chunks.push(source.slice(last, cut));
    last = cut;
  }
  chunks.push(source.slice(last));
  return {
    expr: '[' + chunks.map((c) => JSON.stringify(c)).join(',\n') + "].join('')",
    chunkCount: chunks.length,
  };
}

const { expr, chunkCount } = packHtmlAsExpr(html);
const roundTrip = vm.runInNewContext('(' + expr + ')');
if (roundTrip !== html) {
  throw new Error('HTML 分片回环校验失败：拼接结果与原文不一致');
}

const loader = readFileSync(TEMPLATE_PATH, 'utf8')
  .replaceAll('__CONTROLLER_JS__', () => readFileSync(resolve(root, distDir, 'controller.js'), 'utf8').replace(/<(?=!--|\/script)/gi, '\\x3c'))
  .replaceAll('__PANEL_HTML__', () => expr)
  .replaceAll('__BTN_NAME__', () => JSON.stringify(BTN_NAME));

if (/__PANEL_HTML__|__BTN_NAME__|__CONTROLLER_JS__/.test(loader)) {
  throw new Error('模板占位符未全部替换（检查 loader.template.js 是否混入同名文本）');
}
if (/<\/script|<!--/i.test(loader)) {
  throw new Error('loader 源码仍含未切断的危险序列');
}
new vm.Script(loader); // 语法校验：SyntaxError 直接抛出

const metadata = JSON.parse(readFileSync(resolve(root, 'release/script-metadata.json'), 'utf8'));
if (metadata.id !== SCRIPT_ID || metadata.type !== 'script' || Object.keys(metadata.data ?? {}).length || metadata.export_with?.data !== false) throw Error('Invalid release metadata');
const script = { ...metadata, content: loader };

writeFileSync(OUT_PATH, JSON.stringify(script, null, 2));

const hash = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const filesIn = (folder) => readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesIn(folder + '/' + entry.name) : [folder + '/' + entry.name]);
const inputPaths = [...filesIn('engine/src'), ...filesIn('panel/src'), ...filesIn('assets'), 'panel/index.html', 'panel/vite.config.ts', 'panel/controller.vite.config.ts', 'scripts/loader.template.js', 'scripts/pack-loader.mjs', 'scripts/build-worldbook.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'release/script-metadata.json'].sort();
const inputs = inputPaths.map((path) => ({ path, sha256: hash(path) }));
writeFileSync(resolve(root, distDir, 'release-manifest.json'), JSON.stringify({
    label: metadata.name, builtAt: new Date().toISOString(),
  sourceFingerprint: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'), inputs,
  outputs: ['index.html', 'controller.js', 'tavern-battle-script.json'].map(name => distDir + '/' + name).map((path) => ({ path, sha256: hash(path) })),
}, null, 2));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('[pack] 面板 HTML        ' + kb(html.length));
console.log('[pack] 加载器 JS        ' + kb(loader.length) + '（HTML 分片 ' + chunkCount + ' 段）');
console.log('[pack] 脚本 JSON        ' + kb(JSON.stringify(script).length) + ' → ' + OUT_PATH);
