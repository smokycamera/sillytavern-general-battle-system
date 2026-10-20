/** Restart guard shared with save compaction; same encoding as existing saved battle reports. */
export function archiveStateStamp(storage: unknown, inventory: unknown): string {
  const text = JSON.stringify([storage ?? [], inventory ?? []]);
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < text.length; i++) for (let n = 0; n < hashes.length; n++) {
    hashes[n] = Math.imul(hashes[n]! ^ (text.charCodeAt(i) + n), [16777619, 2246822519, 3266489917, 668265263][n]!);
  }
  return text.length + ':' + hashes.map(h => (h >>> 0).toString(16)).join(':');
}
