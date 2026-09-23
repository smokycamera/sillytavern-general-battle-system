import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeSourceFingerprint, sha256File } from './native-build-fingerprint.mjs';

const build = JSON.parse(readFileSync('dist/build-manifest.json', 'utf8'));
assert.equal(build.sourceFingerprint, nativeSourceFingerprint(), 'Installed dist is stale. Run npm run build:extension and commit dist with the source.');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
assert.equal(build.version, version);
assert.equal(JSON.parse(readFileSync('manifest.json', 'utf8')).version, version);
for (const file of build.files) {
  assert.equal(readFileSync(file.path).length, file.bytes, `Installed file size differs: ${file.path}`);
  assert.equal(sha256File(file.path), file.sha256, `Installed file differs: ${file.path}`);
}
console.log(`Installed bundle matches source and ${build.files.length} packaged files (${version}).`);
