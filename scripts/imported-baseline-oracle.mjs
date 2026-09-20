import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Test oracle only: load the frozen bundle without executing its browser entry point.
const root = new URL('../', import.meta.url);
const imported = JSON.parse(fs.readFileSync(new URL('release/baselines/user-20260918/tavern-battle-script.json', root), 'utf8'));
const audit = JSON.parse(fs.readFileSync(new URL('release/baselines/user-20260918/module-map.json', root), 'utf8'));
const marker = "\n(function () {\n  'use strict';\n\n  const PANEL_HTML = ";
const compiled = imported.content.slice(0, imported.content.indexOf(marker));
if (!compiled.includes('return __tbRequire(0);')) throw Error('Unknown imported bundle layout');
const context = vm.createContext({ structuredClone, console, crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'DOMException', 'CSS', 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) {
  Object.defineProperty(context, key, { configurable: true, get: () => globalThis[key] });
}
vm.runInContext(compiled.replace('return __tbRequire(0);', 'return __tbRequire;'), context);
const ids = new Map(audit.find(r => r.label === 'controller').entries.map(e => [e.file, e.id]));
const html = fs.readFileSync(new URL('release/baselines/user-20260918/index.html', root), 'utf8');
const panel = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const panelRequire = vm.runInContext(panel.replace('return __tbRequire(0);', 'return __tbRequire;'), context);
const panelIds = new Map(audit.find(r => r.label === 'panel').entries.map(e => [e.file, e.id]));
export const importedFileNames = [...panelIds.keys()];
export function importedPanelModule(file) {
  const id = panelIds.get(file); if (id === undefined) throw Error(`Not in panel bundle: ${file}`);
  return panelRequire(id);
}
export function importedModule(file) {
  const id = ids.get(file); if (id === undefined) throw Error(`Not in controller bundle: ${file}`);
  return context.TavernBattleResident(id);
}
export function importedHelper(name) {
  const ast = ts.createSourceFile('bundle.js', compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let declaration;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node.getText(); ts.forEachChild(node, visit); }
  visit(ast); if (!declaration) throw Error(`Missing helper ${name}`);
  return vm.runInContext('(' + declaration + ')', context);
}
