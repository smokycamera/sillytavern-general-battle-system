/** Stable min-heap for small Dijkstra searches. Duplicate entries are skipped by the caller. */
export class GridQueue {
  private entries: { cell: number; cost: number }[] = [];
  get size(): number { return this.entries.length; }
  private before(a: { cell: number; cost: number }, b: { cell: number; cost: number }): boolean { return a.cost < b.cost || a.cost === b.cost && a.cell < b.cell; }
  push(cell: number, cost: number): void {
    const item = { cell, cost }; let i = this.entries.length; this.entries.push(item);
    while (i > 0) { const parent = (i - 1) >> 1; if (!this.before(item, this.entries[parent]!)) break; this.entries[i] = this.entries[parent]!; i = parent; }
    this.entries[i] = item;
  }
  pop(): { cell: number; cost: number } | undefined {
    const first = this.entries[0], last = this.entries.pop(); if (!this.entries.length || !last) return first;
    let i = 0;
    while (i * 2 + 1 < this.entries.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.entries.length && this.before(this.entries[child + 1]!, this.entries[child]!)) child++;
      if (!this.before(this.entries[child]!, last)) break;
      this.entries[i] = this.entries[child]!; i = child;
    }
    this.entries[i] = last; return first;
  }
}
