import './audit-imported-baseline.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createHash } from 'node:crypto';

const read = file => fs.readFileSync(file, 'utf8');
const reports = JSON.parse(read('artifacts/migration-m0/module-audit.json'));
for (const report of reports) {
  assert.equal(report.unmapped.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.ok(report.entries.every(entry => entry.same), `${report.label}: remaining module differences`);
}
const parse = text => ts.createSourceFile('baseline.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const print = text => ts.createPrinter({ removeComments: true }).printFile(parse(text)).trim();
const helperIn = text => {
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'tbWeaponShortName') result = node.getText();
    ts.forEachChild(node, visit);
  }
  visit(parse(text)); assert.ok(result); return print(result);
};
const controller = read('release/baselines/user-20260918/controller.js');
const html = read('release/baselines/user-20260918/index.html');
const helperSource = ts.transpileModule(read('engine/src/weapon-name.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
assert.equal(helperIn(helperSource), helperIn(controller), 'Recovered weapon-name helper');
assert.equal(helperIn(helperSource), helperIn(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]), 'Both bundles share the same helper');
const styles = text => [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1].trim());
assert.deepEqual(styles(html), [styles(read('panel/index.html'))[0], read('panel/src/battle-ui.css').trim()], 'Panel CSS');
const script = JSON.parse(read('release/baselines/user-20260918/tavern-battle-script.json'));
let loader = script.content.slice(script.content.indexOf("\n(function () {\n  'use strict';\n\n  const PANEL_HTML = "));
loader = loader.slice(0, loader.indexOf('const PANEL_HTML = ')) + 'const PANEL_HTML = __PANEL_HTML__' + loader.slice(loader.indexOf("].join('');") + 10);
loader = loader.replace('const BTN_NAME = "战阵面板"', 'const BTN_NAME = __BTN_NAME__');
assert.equal(print(loader), print(read('scripts/loader.template.js').split('__CONTROLLER_JS__')[1]), 'Loader template');
const baseline = JSON.parse(read('release/current-baseline.json'));
for (const item of baseline.outputs) assert.equal(createHash('sha256').update(fs.readFileSync(item.path)).digest('hex'), item.sha256, item.path);
const result = { checkedAt: new Date().toISOString(), baseline: baseline.sourceSha256, modules: reports.map(r => ({ bundle: r.label, count: r.moduleCount, matched: r.entries.length })), helper: 'identical after TypeScript erasure', styles: 'identical', loader: 'identical', distribution: 'untouched', comparison: 'Parsed JavaScript with comments removed, literal spelling normalized, module IDs resolved; wrapper helper independently compared.' };
fs.writeFileSync('artifacts/migration-m0/parity.json', JSON.stringify(result, null, 2) + '\n');
console.log('PASS: all recovered modules, shared helper, styles and loader match the imported baseline.');
