import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'artifacts/migration-m0');
fs.mkdirSync(out, { recursive: true });
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function parse(text) { return ts.createSourceFile('module.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); }
function registry(text) {
  const modules = new Map();
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText() === '__tbModules' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isFunctionExpression(prop.initializer)) throw Error('Unexpected module wrapper');
        const body = prop.initializer.body;
        modules.set(Number(prop.name.getText()), text.slice(body.getStart() + 1, body.end - 1).trim());
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(parse(text));
  if (!modules.size) throw Error('Missing module registry');
  return modules;
}
function dependencies(text, name) {
  const result = [];
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText() === name && node.arguments.length === 1) {
      let parent = node.parent;
      while (parent && !ts.isVariableDeclaration(parent) && !ts.isExpressionStatement(parent)) parent = parent.parent;
      const key = parent && ts.isVariableDeclaration(parent) ? parent.name.getText() : `expression:${result.length}`;
      result.push({ key, value: node.arguments[0].text, start: node.getStart(), end: node.end });
    }
    ts.forEachChild(node, walk);
  }
  walk(parse(text)); return result;
}
function transpile(file) {
  if (file.endsWith('.css')) return '';
  if (file.endsWith('.json')) return `module.exports = ${JSON.stringify(JSON.parse(read(file)))};`;
  return ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
}
function resolveImport(file, specifier) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  const candidates = [target.replace(/\.js$/, '.ts'), target, target + '.ts', target + '/index.ts'];
  const found = candidates.find(candidate => fs.existsSync(path.join(root, candidate)));
  if (!found) throw Error(`Missing source ${file}: ${specifier}`);
  return found;
}
function canonical(text) {
  // The supplied bundle uses a wrapper-level helper; the recovered source imports it.
  text = text.replace(/^const weapon_name_js_1 = require\([^\n]+\);\n/gm, '').replaceAll('(0, weapon_name_js_1.tbWeaponShortName)', 'tbWeaponShortName');
  const result = ts.transform(parse(text), [context => {
    const visit = node => ts.isStringLiteral(node) ? ts.factory.createStringLiteral(node.text) : ts.visitEachChild(node, visit, context);
    return node => ts.visitNode(node, visit);
  }]);
  try { return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0]).trim(); }
  finally { result.dispose(); }
}
const html = read('release/baselines/user-20260918/index.html');
const panel = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!panel) throw Error('Missing panel script');
const reports = [];
for (const [label, text, entry] of [['controller', read('release/baselines/user-20260918/controller.js'), 'panel/src/controller-entry.ts'], ['panel', panel, 'panel/src/main.ts']]) {
  const modules = registry(text);
  const mapped = new Map([[0, entry]]);
  const warnings = [];
  for (const [id, file] of mapped) {
    const source = transpile(file);
    const wanted = dependencies(source, 'require');
    const actual = dependencies(modules.get(id), '__tbRequire');
    for (const dep of actual) {
      const match = wanted.find(item => item.key === dep.key);
      if (!match) { warnings.push({ id, file, dependency: dep }); continue; }
      const target = resolveImport(file, match.value);
      const previous = mapped.get(Number(dep.value));
      if (previous && previous !== target) throw Error(`Conflicting mapping ${previous} / ${target}`);
      mapped.set(Number(dep.value), target);
    }
  }
  const entries = [];
  for (const [id, file] of mapped) {
    let actual = modules.get(id);
    for (const dep of dependencies(actual, '__tbRequire').reverse()) {
      const target = mapped.get(Number(dep.value));
      let spec = target && path.posix.relative(path.posix.dirname(file), target).replace(/\.ts$/, '.js');
      if (spec && !spec.startsWith('.')) spec = './' + spec;
      actual = actual.slice(0, dep.start) + `require(${JSON.stringify(spec ?? `UNMAPPED:${dep.value}`)})` + actual.slice(dep.end);
    }
    const expected = transpile(file);
    const same = canonical(expected) === canonical(actual);
    if (!same) {
      const folder = path.join(out, label, path.dirname(file)); fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(out, label, file + '.baseline.js'), actual + '\n');
      fs.writeFileSync(path.join(out, label, file + '.source.js'), expected);
      fs.writeFileSync(path.join(out, label, file + '.baseline.normalized.js'), canonical(actual) + '\n');
      fs.writeFileSync(path.join(out, label, file + '.source.normalized.js'), canonical(expected) + '\n');
    }
    entries.push({ id, file, same, baselineHash: hash(canonical(actual)), sourceHash: hash(canonical(expected)) });
  }
  const unmapped = [...modules.keys()].filter(id => !mapped.has(id));
  reports.push({ label, moduleCount: modules.size, mapped: entries.length, warnings, unmapped, entries });
}
fs.writeFileSync(path.join(out, 'module-audit.json'), JSON.stringify(reports, null, 2) + '\n');
for (const report of reports) console.log(JSON.stringify({ label: report.label, moduleCount: report.moduleCount, mapped: report.mapped, unmapped: report.unmapped, warnings: report.warnings, changed: report.entries.filter(item => !item.same).map(item => item.file) }, null, 2));
