import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateUnit, SmallBattle, standardField, traitRegistry, V12_OVERFLOW_D20 } from '../engine/src/index.js';
import { renderTacticalBattle, selectTacticalElement, type TacticalView } from '../panel/src/tactical-view.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const rows = [];
for (const count of [8, 30]) for (const mount of [false, true]) {
  const registry = traitRegistry(), seed = `tactical-clicks:${count}:${mount}`;
  const units = Array.from({ length: count }, (_, i) => {
    const u = generateUnit({ name: `unit${i}`, side: i < count / 2 ? 'ally' : 'enemy', scale: 'company', hpMax: 20,
      rulesVersion: 'v2', level: 4, weaponClass: 'spear', weaponLevel: 4, armorTier: 1, traits: [],
      archetype: mount ? 'mobile' : 'infantry' }, { registry, seed: `${seed}:${i}`, noVariance: true }).unit;
    u.id = `u${i}`; u.mount = mount; return u;
  });
  const field = standardField(13, 19); field.tiles.fill('open');
  field.layerVersion = 1; field.structures = field.tiles.map(() => null);
  const b = new SmallBattle({ combatants: units, rules: V12_OVERFLOW_D20, traitRegistry: registry, battlefield: field, seed });
  b.start(); b.turnOrder = units.map(u => u.id); b.turnIndex = 0;
  units.forEach((u, i) => {
    const n = i % (count / 2);
    u.pos = (i < count / 2 ? 10 + Math.floor(n / 10) : 7 - Math.floor(n / 10)) * 13 + 1 + n % 10;
  });
  const snapshot = b.toSnapshot(); delete snapshot.feedback;
  mkdirSync('artifacts/tactical-clicks/fixtures', { recursive: true });
  writeFileSync(`artifacts/tactical-clicks/fixtures/${count}-${mount ? 'cavalry' : 'infantry'}.json`, JSON.stringify({
    schemaVersion: 2, storage: units.map(unitRecordFromCombatant), rosterIds: units.map(u => u.id), protagonistId: 'u0',
    autoTurn: false, mode: 'small', battle: { kind: 'small', snap: snapshot }, autoSettleXp: false,
  }));
  const view: TacticalView = { mode: 'weapon', selectedId: 'u0' };
  const before = hash(b.toSnapshot()), menuTimes: number[] = [], clickTimes: number[] = [], rendered: string[] = [];
  let options;
  for (let trial = -2; trial < 12; trial++) {
    const menuStart = performance.now(); options = b.getActionOptions('u0');
    if (trial >= 0) menuTimes.push(performance.now() - menuStart);
    for (const input of [{ mode: 'move' }, { cell: 12 * 13 + 2 }, { mode: 'charge' }, { unitId: `u${count / 2}` }, { mode: 'guard' }, { mode: 'weapon' }]) {
      const start = performance.now();
      const html = b.withReadOnlyQueries(() => {
        const query = selectTacticalElement(b, view, input);
        return renderTacticalBattle(b, view, undefined, query);
      });
      if (trial >= 0) { clickTimes.push(performance.now() - start); rendered.push(hash(html)); }
    }
  }
  if (before !== hash(b.toSnapshot())) throw Error('Inspection changed the battle');
  rows.push({ count, mount, menuMedianMs: Math.round(median(menuTimes) * 10) / 10,
    clickMedianMs: Math.round(median(clickTimes) * 10) / 10, optionsHash: hash(options), renderHash: hash(rendered),
    snapshotHash: before, menuTimes, clickTimes });
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ node: process.version, rows }, null, 2) + '\n');
console.table(rows.map(({ count, mount, menuMedianMs, clickMedianMs }) => ({ count, mount, menuMedianMs, clickMedianMs })));
