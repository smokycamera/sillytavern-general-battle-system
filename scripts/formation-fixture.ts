import { applyHealthLoss, generateUnit, MassBattle, SeededRng, traitRegistry, V2_TW } from '../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { createInventoryItem } from '../panel/src/inventory-state.js';
import { prepareBattleItems } from '../panel/src/battle-items.js';
const withPanic = process.argv.includes('--panic');
const withRecovery = process.argv.includes('--recovery');
const withItems = process.argv.includes('--items') || withRecovery;
const withFlight = process.argv.includes('--flight');
const registry = traitRegistry();
const storage = [
  { id: 'a', name: '中军前卫', side: 'ally' as const },
  { id: 'hero', name: '随队军官', side: 'ally' as const, scale: 'hero' as const, abilityBlueprints: ['bp-call-reinforce'], reserves: 1 },
  { id: 'reserve', name: '预备步队', side: 'ally' as const },
  { id: 'enemy', name: '对阵火枪队', side: 'enemy' as const },
].map(({ id, ...spec }) => {
  const u = generateUnit({ rulesVersion: 'v2', scale: 'company', level: 4, hpMax: withFlight ? 500 : 100, weaponClass: withFlight ? 'sword' : 'rifle', armorTier: 1, traits: withFlight && id === 'a' ? ['flying'] : withRecovery && id === 'a' ? ['regen'] : [], ...spec }, { seed: id, registry }).unit;
  u.id = id; if (withItems && !withRecovery && id === 'hero') u.hp = 10;
  u.tags.push('zone:中军', id === 'reserve' ? 'rank:reserve' : 'rank:front');
  return unitRecordFromCombatant(u);
});
const inventory = withItems ? [{ ...createInventoryItem('mass-dose', '随队恢复剂', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'mass-dose', 2), assignedTo: 'hero' }] : [];
const b = new MassBattle({ combatants: prepareBattleItems(storage.map((r) => materializeUnitRecord(r, registry)), { inventory }), rules: V2_TW, seed: 'formation-visual', zones: ['左翼', '中军', '右翼'], commanderId: 'hero', traitRegistry: registry });
b.start();
if (withPanic) { b.byId('a').morale = 45; b.byId('enemy').traits.push('terror'); (b.rng as SeededRng).setState(9); for (const u of b.combatants.filter((u) => !b.isAttached(u.id))) b.issue({ unitId: u.id, type: 'hold' }); }
if (withRecovery) { applyHealthLoss(b.byId('a'), 20); b.byId('enemy').conditions.push({ id: 'stunned', dur: 99 }); }
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, inventory, rosterIds: storage.map((r) => r.id), protagonistId: 'hero', autoTurn: false, autoAllyOrders: false, mode: 'mass', battle: { kind: 'mass', snap: b.toSnapshot() }, autoSettleXp: true }));
