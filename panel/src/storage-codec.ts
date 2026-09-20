/** 同步、无损本地镜像编码。保留所有战报、开局快照、回滚档案及聊天隔离。 */
const PREFIX = 'tb:lzw:1:';
const LIMIT = 55000;
export function encodeSave(json: string): string {
  if (json.length < 2048) return json;
  const bytes = new TextEncoder().encode(json), dictionary = new Map<string, number>();
  let next = 256, word = '', codes: number[] = [];
  const emit = (s: string) => codes.push((s.length === 1 ? s.charCodeAt(0) : dictionary.get(s)!) + 32);
  for (const byte of bytes) {
    const char = String.fromCharCode(byte), joined = word + char;
    if (!word || dictionary.has(joined)) { word = joined; continue; }
    emit(word);
    if (next < LIMIT) dictionary.set(joined, next++);
    word = char;
  }
  if (word) emit(word);
  const chunks: string[] = [PREFIX];
  for (let i = 0; i < codes.length; i += 8192) chunks.push(String.fromCharCode(...codes.slice(i, i + 8192)));
  const compressed = chunks.join('');
  return compressed.length < json.length ? compressed : json;
}
export function decodeSave(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const dictionary: string[] = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
  let word = '', next = 256;
  const chunks: Uint8Array[] = [];
  let buffer = new Uint8Array(65536), used = 0, length = 0;
  for (let i = PREFIX.length; i < stored.length; i++) {
    const code = stored.charCodeAt(i) - 32;
    const entry = dictionary[code] ?? (code === next && word ? word + word[0] : undefined);
    if (entry === undefined) throw Error('本地压缩存档损坏');
    for (let j = 0; j < entry.length; j++) {
      if (used === buffer.length) { chunks.push(buffer); buffer = new Uint8Array(65536); used = 0; }
      buffer[used++] = entry.charCodeAt(j); length++;
    }
    if (word && next < LIMIT) dictionary[next++] = word + entry[0];
    word = entry;
  }
  chunks.push(buffer.subarray(0, used));
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
/** 只压缩本插件已有镜像；不删除聊天或其他应用数据，每个键仍原子替换。 */
export function compactLocalMirrors(storage: Storage, currentKey: string): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key || key === currentKey || !/^tavern-battle:(chat|character):.+:panel$/.test(key)) continue;
    try {
      const old = storage.getItem(key);
      if (!old || old.startsWith(PREFIX)) continue;
      JSON.parse(old);
      const packed = encodeSave(old);
      if (packed.length < old.length && decodeSave(packed) === old) storage.setItem(key, packed);
    } catch { /* 某个旧镜像不可读或不可写时保留原值。 */ }
  }
}
