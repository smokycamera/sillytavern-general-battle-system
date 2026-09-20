import { generateUnit, traitRegistry } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const registry = traitRegistry();
const storage = Array.from({ length: 33 }, (_, n) => {
  const unit = generateUnit({ rulesVersion: 'v2', name: (n < 16 ? '我方步队' : '敌方步队') + n, side: n < 16 ? 'ally' : 'enemy', scale: 'company', hpMax: 80,
    level: 3, weaponClass: 'sword', traits: [] }, { registry, seed: 'narrative-capacity:' + n, noVariance: true }).unit;
  unit.id = 'unit-' + n.toString().padStart(2, '0'); return unitRecordFromCombatant(unit);
});
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, rosterIds: storage.map((r) => r.id),
  protagonistId: storage[0]!.id, autoTurn: false, storySync: true, field: 'plains', battle: null }));
