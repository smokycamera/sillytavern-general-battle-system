/** Read the metadata header without decoding/allocating every message in a long chat. */
export async function readChatHeader(response: Response): Promise<unknown> {
  if (!response.body?.getReader) {
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw Error('酒馆返回了无法识别的聊天数据');
    return data[0];
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let phase: 'array' | 'header' | 'object' | 'delimiter' = 'array';
  let depth = 0, quoted = false, escaped = false, length = 0;
  const invalid = () => Error('酒馆返回了无法识别的聊天数据');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw invalid();
      let start = phase === 'object' ? 0 : -1;
      for (let i = 0; i < value.length; i++) {
        const byte = value[i]!;
        if (phase !== 'object') {
          if (byte === 32 || byte === 9 || byte === 10 || byte === 13) continue;
          if (phase === 'array') {
            if (byte !== 91) throw invalid();
            phase = 'header'; continue;
          }
          if (phase === 'header') {
            if (byte === 93) return undefined;
            if (byte !== 123) throw invalid();
            phase = 'object'; start = i;
          } else {
            if (byte !== 44 && byte !== 93) throw invalid();
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const part of parts) { bytes.set(part, offset); offset += part.length; }
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          }
        }
        if (quoted) {
          // Large saved reports contain long JSON strings. Skip to their closing
          // quote with the native byte search instead of branching on every byte.
          const end = value.indexOf(34, i);
          const boundary = end < 0 ? value.length : end;
          let back = boundary - 1, slash = false;
          while (back >= i && value[back] === 92) { slash = !slash; back--; }
          if (back < i) slash = slash !== escaped;
          if (end < 0) { escaped = slash; break; }
          quoted = slash; escaped = false; i = end;
        } else if (byte === 34) quoted = true;
        else if (byte === 123 || byte === 91) depth++;
        else if (byte === 125 || byte === 93) {
          if (--depth === 0) {
            const part = value.slice(start, i + 1);
            parts.push(part); length += part.length; start = -1; phase = 'delimiter';
          }
        }
      }
      if (start >= 0) { const part = value.slice(start); parts.push(part); length += part.length; }
    }
  } finally {
    // Some transports buffer the response; others can stop downloading the message tail.
    // Cancellation is cleanup, and must not delay a verified header or hide a read error.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
