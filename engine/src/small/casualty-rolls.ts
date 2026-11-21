import { isVehicleBody } from '../vehicle-size.js';
import { SeededRng } from '../rng.js';
import { smallRescuePercent } from '../trait-parameters.js';
import { effectiveTraitLevel } from '../trait-sources.js';
import type { Combatant } from '../types.js';

// A complete block needs one binomial draw, even for a very large company.
// Conditional on its total, every placement of those successes is equally likely.
const blockSize = 1024;
const distributions = new Map<number, number[]>();
function distribution(percent: number): number[] {
  const existing = distributions.get(percent);
  if (existing) return existing;
  const odds = percent / (100 - percent);
  const mode = Math.floor((blockSize + 1) * percent / 100);
  const weights: number[] = [];
  weights[mode] = 1;
  for (let k = mode; k > 0; k--) weights[k - 1] = weights[k]! * k / ((blockSize - k + 1) * odds);
  for (let k = mode; k < blockSize; k++) weights[k + 1] = weights[k]! * (blockSize - k) * odds / (k + 1);
  for (let k = 1; k <= blockSize; k++) weights[k] = weights[k]! + weights[k - 1]!;
  distributions.set(percent, weights);
  return weights;
}

function blockTotal(cdf: number[], rng: SeededRng): number {
  const draw = rng.next() * cdf[blockSize]!;
  let low = 0, high = blockSize;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (draw < cdf[mid]!) high = mid;
    else low = mid + 1;
  }
  return low;
}

export class CasualtyRolls {
  private readonly cursors = new Map<string, number>();
  constructor(private readonly seed: string, private readonly rescueAtZero = false) {}

  retainsWounded(unit: Combatant): boolean {
    return this.rescueAtZero && unit.scale !== 'hero' && !isVehicleBody(unit.body);
  }

  roll(unit: Combatant, loss: number): number {
    const percent = smallRescuePercent(effectiveTraitLevel(unit, 'medic'), unit.traitLevelModel);
    const key = JSON.stringify([unit.transportOrigin ?? unit.id, percent]);
    let cursor = this.cursors.get(key) ?? 0;
    const end = cursor + loss;
    const rng = new SeededRng(JSON.stringify(['casualties', this.seed, key]));
    const initial = rng.getState(), cdf = distribution(percent);
    let wounded = 0;
    while (cursor < end) {
      const block = Math.floor(cursor / blockSize), offset = cursor % blockSize;
      const stop = Math.min(blockSize, offset + end - cursor);
      rng.setState(initial + Math.imul(block, 0x9e3779b1));
      let available = blockTotal(cdf, rng);
      if (offset === 0 && stop === blockSize) wounded += available;
      else {
        for (let i = 0; i < stop && available; i++) {
          if (rng.next() * (blockSize - i) < available) {
            available--;
            if (i >= offset) wounded++;
          }
        }
      }
      cursor += stop - offset;
    }
    this.cursors.set(key, end);
    return wounded;
  }

  snapshot(): [string, number][] { return [...this.cursors]; }
  restore(entries: unknown): void {
    if (!Array.isArray(entries)) throw Error('伤兵判定进度无效');
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Number.isSafeInteger(entry[1]) || entry[1] < 0 || this.cursors.has(entry[0])) throw Error('伤兵判定进度无效');
      this.cursors.set(entry[0], entry[1]);
    }
  }
}
