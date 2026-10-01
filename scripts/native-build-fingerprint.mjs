import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const sha256File = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function nativeSourceFingerprint() {
  const files = [];
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(file); else files.push(file);
    }
  }
  for (const dir of ['engine/src', 'panel/src', 'host/src', 'runtime/src', 'extension', 'assets', 'vendor/jev-core']) collect(dir);
  files.push('panel/index.html', 'package.json', 'package-lock.json', 'scripts/package-extension.mjs', 'scripts/jev-cors-relay.mjs', 'scripts/native-build-fingerprint.mjs');
  for (const name of ['package.json', 'package-lock.json', 'server.mjs', 'broker.mjs', 'tools.mjs', 'start.ps1', 'README.md']) files.push('mcp/' + name);
  return createHash('sha256').update(files.sort().map(file => `${file.replaceAll('\\', '/')}\0${sha256File(file)}`).join('\n')).digest('hex');
}
