import { generateUnit, traitRegistry, prepareCombatModel, V4_D20, V4_TW, SmallBattle, MassBattle, standardField, SeededRng } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { prepareInventoryState } from '../panel/src/inventory-state.js';
import { captureBattleArchive, captureBattleStart } from '../panel/src/report-history.js';
const mass = process.argv.includes('--mass'), registry = traitRegistry();
const units = ['A', 'D'].map(id => {
  const u = generateUnit({ rulesVersion: 'v2', name: id === 'A' ? '长枪护卫' : '持剑重甲卫兵', side: id === 'A' ? 'ally' : 'enemy',
    scale: mass ? 'company' : 'hero', level: 4, hpMax: mass ? 2 : 1000, weaponClass: id === 'A' ? 'spear' : 'sword', weaponLevel: 4,
    ...(id === 'A' ? { sidearmClass: 'sword', sidearmLevel: 4 } : {}), armorTier: 3, armorLevel: 4, traits: [] }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; prepareCombatModel(u, V4_D20, 1000);
  if (mass) u.tags.push('zone:中军', id === 'A' ? 'rank:rear' : 'rank:front');
  return u;
});
const before = prepareInventoryState({ schemaVersion: 2, factRevision: 1, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: ['A', 'D'], inventory: [],
  protagonistId: 'A', commanderId: 'A', mode: mass ? 'mass' : 'small', autoTurn: false, autoAllyOrders: false, autoSettleXp: true });
const field = standardField(); field.tiles.fill('open');
const b = mass ? new MassBattle({ combatants: units, rules: V4_TW, seed: 'melee-browser', traitRegistry: registry, commanderId: 'A' })
  : new SmallBattle({ combatants: units, rules: V4_D20, battlefield: field, seed: 'melee-browser', traitRegistry: registry });
b.start();
if (b instanceof SmallBattle) { b.turnOrder = ['A', 'D']; b.turnIndex = 0; b.byId('A').pos = 30; b.byId('D').pos = 16; }
else b.issue({ unitId: 'D', type: 'hold' });
const rng = b.rng as SeededRng; let state = rng.getState(); while (mass ? rng.next() > .1 : rng.d(20) < 18) state = rng.getState(); rng.setState(state);
console.log(JSON.stringify({ ...before, battle: { kind: mass ? 'mass' : 'small', snap: structuredClone(b.toSnapshot()) }, activeBattleStart: captureBattleStart(b, captureBattleArchive(before)) }));
