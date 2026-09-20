import { generateUnit, traitRegistry } from '../engine/src/index.js';
import { createInventoryItem } from '../panel/src/inventory-state.js';
const u = generateUnit({ name: '旧军团', side: 'ally', scale: 'company', level: 4, traits: [], era: 'modern' }, { seed: 'legacy-browser', registry: traitRegistry() }).unit;
u.hp = 70; u.base.hpMax = 560;
const oldMook = generateUnit({ name: '旧V2地方民兵', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 2, hpMax: 20, hp: 7, weaponClass: 'sword', traits: [] }, { seed: 'old-mook-browser', registry: traitRegistry() }).unit;
oldMook.scale = 'mook'; oldMook.tags = ['infantry', 'human', 'mook']; oldMook.genAudit!.input.scale = 'mook';
console.log(JSON.stringify({ schemaVersion: 1, roster: [u, oldMook], storage: [], storySync: true, autoTurn: false, inventory: [
  createInventoryItem('good-dose', '原有恢复剂', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'migration-dose', 2),
  { id: 'broken-dose', name: '损坏规格药剂', qty: 1, lootType: 'consumable', mechanics: null },
  { id: 'old-story', name: '旧剧情物品', qty: 0, lootType: 'misc' },
] }));
