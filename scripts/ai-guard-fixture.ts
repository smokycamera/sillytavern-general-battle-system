import { generateUnit, SmallBattle, standardField, traitRegistry, V4_D20 } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { prepareInventoryState } from '../panel/src/inventory-state.js';
const registry = traitRegistry(), cannon = process.argv.includes('--cannon'), airborne = process.argv.includes('--airborne');
const units = [
  { id: 'G', name: '敌方盾卫', side: 'enemy' as const, weaponClass: 'sword', shield: true, traits: ['shield-wall'] },
  { id: 'A', name: cannon ? '我方火炮' : '我方步枪手', side: 'ally' as const, weaponClass: cannon ? 'cannon' : 'rifle', shield: false, traits: [] },
  { id: 'R', name: '盾后弓手', side: 'enemy' as const, weaponClass: 'bow', shield: false, traits: [] },
].map(spec => {
  const unit = generateUnit({ rulesVersion: 'v2', name: spec.name, side: spec.side, scale: 'hero', level: 4, hpMax: 500,
    weaponClass: spec.weaponClass, weaponLevel: 3, armorTier: spec.shield ? 3 : 0, armorLevel: 3, shield: spec.shield, traits: spec.traits }, { registry, seed: spec.id, noVariance: true }).unit;
  unit.id = spec.id; return unit;
});
const field = standardField(); field.tiles.fill('open');
const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V4_D20, seed: 'guard-ui', traitRegistry: registry });
battle.start(); battle.turnOrder = ['G', 'A', 'R']; battle.turnIndex = 0;
battle.byId('G').pos = 31; battle.byId('A').pos = 52; battle.byId('R').pos = 24;
if (!process.argv.includes('--unbraced')) battle.brace('G');
if (airborne) { battle.byId('A').traits.push('flying'); battle.byId('A').airborne = true; }
battle.endTurn();
const save = prepareInventoryState({ schemaVersion: 2, factRevision: 1, storage: units.map(unit => unitRecordFromCombatant(unit)),
  rosterIds: units.map(unit => unit.id), protagonistId: 'A', commanderId: 'A', inventory: [], mode: 'small', autoTurn: false, autoAllyOrders: false });
console.log(JSON.stringify({ ...save, battle: { kind: 'small', snap: battle.toSnapshot() } }));
