import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = JSON.parse(readFileSync('vendor/jev-core/source.json', 'utf8'));
const names = readdirSync('vendor/jev-core/src').sort();
if (JSON.stringify(names) !== JSON.stringify(Object.keys(source.files).sort())) throw Error('JEV core file inventory changed');
for (const name of names) {
  const text = readFileSync('vendor/jev-core/src/' + name, 'utf8').replaceAll('\r\n', '\n');
  if (createHash('sha256').update(text).digest('hex') !== source.files[name]) throw Error('JEV core checksum changed: ' + name);
}
console.log('JEV core verified: ' + source.commit);
