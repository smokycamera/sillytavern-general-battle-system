/** Synthetic data only; no user saves or paid API calls. */
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { serialized } from '../host/src/json.js';
import { readChatHeader } from '../host/src/chat-header.js';
import { NativeHost, type HostContext } from '../host/src/sillytavern.js';
import { prepareMessageTag } from '../host/src/message-identity.js';
import { NativeStore } from '../runtime/src/native-store.js';
import { MemoryJournal } from '../runtime/src/recovery-journal.js';
import { generateUnit, SmallBattle, standardField, traitRegistry, V39_OVERFLOW_D20 } from '../engine/src/index.js';

const registry = traitRegistry();
const units = Array.from({ length: 32 }, (_, i) => {
  const unit = generateUnit({ name: `u${i}`, side: i < 16 ? 'ally' : 'enemy', scale: 'company', hpMax: 20, level: 5,
    rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'bow', weaponLevel: 4, armorTier: 1, traits: [] },
    { registry, seed: `save-benchmark:${i}`, noVariance: true }).unit;
  unit.id = `u${i}`; return unit;
});
const battle = new SmallBattle({ combatants: units, battlefield: standardField(13, 19), rules: V39_OVERFLOW_D20, traitRegistry: registry, seed: 'save-benchmark' });
battle.start();
const snapshot = battle.toSnapshot();
// Match persisted JSON: snapshots/reports are independent objects after disk read.
const payload = JSON.parse(JSON.stringify({ factRevision: 1, battle: { kind: 'small', snap: snapshot },
  reports: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, start: { snapshot }, text: '战报。'.repeat(100) })) }));
const median = (values: number[]) => values.sort((a,b) => a-b)[Math.floor(values.length/2)]!;
async function timed(run: () => unknown) { const times = []; for (let i=0;i<5;i++) { const start=performance.now(); await run(); times.push(performance.now()-start); } return median(times); }
const jsonMs = await timed(() => serialized(payload));
const rows = [];
for (const floors of [100, 1000, 5000]) {
  const chat = Array.from({ length: floors }, (_, i) => ({ mes: '聊天正文。'.repeat(400), gen_finished: 'done', send_date: String(i) }));
  const context: HostContext = { characterId: 0, characters: [{ avatar: 'synthetic.png' }], chatId: 'benchmark', chat, chatMetadata: {}, getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
  let disk: Record<string, unknown> = {}, saveCalls=0;
  context.saveMetadata = async () => { saveCalls++; disk = structuredClone(context.chatMetadata!); };
  context.saveChat = context.saveMetadata;
  const host = new NativeHost({ SillyTavern: { getContext: () => context }, __TAURITAVERN__: { api: { chat: { open: () => ({ metadata: { get: async () => structuredClone(disk) } }) } } } }, 'synthetic');
  const store = new NativeStore(host, new MemoryJournal()); await store.load();
  if ((await store.commit(0, () => payload)).status !== 'confirmed') throw Error('initial commit failed');
  const loadMs = await timed(() => store.load());
  const commitMs = await timed(async () => { const receipt = await store.commit(store.head()!.revision, before => ({ ...before, factRevision: (before.factRevision ?? 0)+1 })); if (receipt.status !== 'confirmed') throw Error('commit failed'); });
  const tags = Array.from({ length: 100 }, (_, i) => prepareMessageTag(chat, floors - 100 + i));
  const tagsMs = await timed(() => host.applyMessageTags(host.session()!, tags));
  const bytes = new TextEncoder().encode(JSON.stringify([{ chat_metadata: disk }, ...chat]));
  let readBytes = 0;
  const headerMs = await timed(async () => {
    let offset = 0; readBytes = 0;
    const header = await readChatHeader(new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      const next = Math.min(offset+65536,bytes.length);
      if (next === offset) { controller.close(); return; }
      controller.enqueue(bytes.subarray(offset,next)); readBytes += next-offset; offset=next;
    } }, { highWaterMark: 0 })));
    if ((header as { chat_metadata?: { tavernBattle?: { revision?: number } } }).chat_metadata?.tavernBattle?.revision !== store.head()!.revision) throw Error('header mismatch');
  });
  rows.push({ floors, loadMs, commitMs, tagsMs, headerMs, readBytes, chatBytes: bytes.length, saveCalls, hash: createHash('sha256').update(serialized(store.snapshot())).digest('hex') });
}
const result = { node: process.version, payloadBytes: Buffer.byteLength(JSON.stringify(payload)), jsonMs, rows,
  note: 'CPU and copy costs with metadata API simulated in memory; excludes real host disk, network, UI, and full-chat writes.' };
console.log(JSON.stringify(result));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2)+'\n');
