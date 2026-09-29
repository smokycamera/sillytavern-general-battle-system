/** Scope guard for the layered-city PR. Other worldbook edits require separate approval. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const digest = value => createHash('sha256').update(value).digest('hex');
const path = 'assets/worldbook/!通用战斗系统约束.json';
const text = readFileSync(path, 'utf8');
assert.equal(text.split('山地子民、航渡、登城、夜战').length, 2, 'Expected exactly the two approved trait-name insertions');
assert.equal(digest(text.replace('山地子民、航渡、登城、夜战', '山地子民、夜战')), 'abc0eab8a9ab8542953edb20fc15bc9cc8acf331fac7211b69f2a32c25b7dcdc', 'Worldbook changed outside the trait-name list');
assert.equal(digest(readFileSync('assets/worldbook/lorebook system explain.md')), '23d136985daa860f36ca8c840f23064b0bd4cc053040a04c6889102a22f48d41', 'Explanatory worldbook must remain byte-identical');
JSON.parse(text);
console.log('Worldbook scope verified: only 航渡、登城 inserted; every other original byte preserved.');
