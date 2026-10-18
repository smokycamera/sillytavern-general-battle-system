import { expect, it, vi } from 'vitest';
import { readChatHeader } from '../src/chat-header.js';

it('reads UTF-8, escaped quotes and nested values across single-byte chunks', async () => {
  const header = { chat_metadata: { text: '中文😀 \\" } ]', nested: [{ a: [1, 2] }] } };
  const bytes = new TextEncoder().encode(JSON.stringify([header, { mes: '正文' }]));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
    else controller.close();
  } }, { highWaterMark: 0 });
  expect(await readChatHeader(new Response(stream))).toEqual(header);
  expect(offset).toBeLessThan(bytes.length);
});

it('cancels before requesting the long message tail and does not wait for cancellation', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (pull.mock.calls.length > 1) throw Error('must not read message tail');
    controller.enqueue(new TextEncoder().encode('[{"chat_metadata":{"revision":1}},'));
  });
  const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }));
  expect(await readChatHeader(response)).toEqual({ chat_metadata: { revision: 1 } });
  expect(pull).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('accepts empty chats and rejects malformed or incomplete headers', async () => {
  expect(await readChatHeader(new Response(' [ ] '))).toBeUndefined();
  for (const text of ['{}', '[null]', '[{"chat_metadata":', '[{"x":1}oops]', '[{"x":]}]', '[{"x":1}']) {
    await expect(readChatHeader(new Response(text))).rejects.toThrow();
  }
});

it('supports hosts without response streams', async () => {
  expect(await readChatHeader({ body: null, json: async () => [{ chat_metadata: {} }] } as Response)).toEqual({ chat_metadata: {} });
  await expect(readChatHeader({ body: null, json: async () => ({}) } as Response)).rejects.toThrow();
});
