import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { readChatHeader } from '../host/src/chat-header.js';
import { payloadHash } from '../runtime/src/save-envelope.js';

// Local-only: the supplied save is never copied into the repository or sent anywhere.
const backup = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
if (await payloadHash(backup.envelope.payload) !== backup.envelope.payloadHash) throw Error('Backup hash mismatch');
const header = { chat_metadata: { tavernBattle: backup.envelope } };
const rows = [];
for (const floors of [100, 1000, 5000]) {
  const message = { mes: '高楼层聊天正文。'.repeat(500), swipes: ['历史回复。'.repeat(500)] };
  const bytes = new TextEncoder().encode(JSON.stringify([header, ...Array(floors).fill(message)]));
  let consumed = 0;
  const response = () => {
    let offset = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const next = Math.min(offset + 65536, bytes.length);
      controller.enqueue(bytes.subarray(offset, next)); consumed += next - offset; offset = next;
    } }, { highWaterMark: 0 }));
  };
  let start = performance.now();
  const old = (await response().json())[0];
  const fullMs = performance.now() - start;
  consumed = 0; start = performance.now();
  const current = await readChatHeader(response());
  const headerMs = performance.now() - start;
  if (JSON.stringify(old) !== JSON.stringify(current)) throw Error('Header mismatch');
  rows.push({ floors, fullMiB: +(bytes.length / 1048576).toFixed(2), readMiB: +(consumed / 1048576).toFixed(2), fullMs: +fullMs.toFixed(1), headerMs: +headerMs.toFixed(1) });
}
console.table(rows);
