import { generateUnit, traitRegistry } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { createInventoryItem, prepareInventoryState } from '../panel/src/inventory-state.js';
const unit = generateUnit({ name: '护甲测试护卫', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 4, traits: [],
  hp: 37, hpMax: 100, weaponClass: 'sword', armorTier: 0 }, { registry: traitRegistry(), seed: 'armor-browser', noVariance: true }).unit;
unit.id = 'a';
console.log(JSON.stringify(prepareInventoryState({ schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(unit)], rosterIds: ['a'],
  inventory: [createInventoryItem('plate', '测试铠甲', { kind: 'armor', tier: 3, power: 4, quality: 3 }, 'plate')], protagonistId: 'a', mode: 'small', autoTurn: false })));
