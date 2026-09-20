import { applyHealthLoss, generateUnit, SmallBattle, SeededRng, standardField, traitRegistry, V2_D20 } from '../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant } from '../panel/src/unit-state.js';
const reg = traitRegistry();
const withPanic = process.argv.includes('--panic');
const withRecovery = process.argv.includes('--recovery');
const withFlight = process.argv.includes('--flight');
const storage = [
  { id: 'a', name: '前锋射手', side: 'ally' as const }, { id: 'b', name: '守路军士', side: 'enemy' as const },
  { id: 'c', name: '随行医师', side: 'ally' as const }, { id: 'd', name: '敌方护卫', side: 'enemy' as const },
].map(({ id, ...identity }) => {
  const unit = generateUnit({ ...identity, rulesVersion: 'v2', level: 4, scale: (withRecovery || withPanic) && id === 'a' ? 'company' : 'hero', hpMax: 100, hp: withRecovery || withPanic ? 100 : 80, weaponClass: withFlight && id === 'a' ? 'sword' : 'rifle', weaponLevel: 5, armorTier: 1, traits: withFlight && id === 'a' ? ['flying'] : withRecovery && id === 'a' ? ['regen'] : [] }, { seed: id, registry: reg, noVariance: true }).unit;
  unit.id = id; return unitRecordFromCombatant(unit);
});
const b = new SmallBattle({ combatants: storage.map((r) => materializeUnitRecord(r, reg)), seed: 'grid-visual', battlefield: standardField(), rules: V2_D20, traitRegistry: reg });
b.start(); b.turnOrder = ['a', 'b', 'c', 'd']; b.turnIndex = 0;
b.byId('a').pos = 42; b.byId('b').pos = 21; b.byId('c').pos = 44; b.byId('d').pos = 18;
if (withRecovery) { applyHealthLoss(b.byId('a'), 20); for (const id of ['b', 'c', 'd']) b.byId(id).conditions.push({ id: 'stunned', dur: 99 }); }
if (withPanic) {
  b.byId('a').morale = 45; b.byId('b').traits.push('terror'); for (const id of ['b', 'd']) { delete b.byId(id).weapon; delete b.byId(id).sidearm; }
  b.turnOrder = ['a', 'c', 'b', 'd']; b.turnIndex = 3; (b.rng as SeededRng).setState(9); b.endTurn();
}
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, rosterIds: storage.map((r) => r.id), protagonistId: 'a', autoTurn: false, mode: 'small', battle: { kind: 'small', snap: b.toSnapshot() }, autoSettleXp: true }));
