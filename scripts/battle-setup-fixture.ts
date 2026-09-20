import { generateUnit, generatedField, SmallBattle, traitRegistry, V2_D20 } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const registry = traitRegistry(), capacity = process.argv.includes('--capacity'), count = capacity ? 16 : 2;
const units = Array.from({ length: count }, (_, n) => {
  const side = n < count / 2 ? 'ally' as const : 'enemy' as const;
  const u = generateUnit({ rulesVersion: 'v2', name: capacity ? (side === 'ally' ? '我方步队' : '敌方步队') + (n % 8 + 1) : side === 'ally' ? '巡逻小队' : '对面小队', side,
    scale: 'company', hpMax: capacity ? 100 : 5, level: capacity ? 4 : 3, weaponClass: capacity ? n % 3 ? 'rifle' : 'sword' : 'sword',
    weaponLevel: capacity ? 5 : 1, armorTier: capacity ? 1 : 4, armorLevel: capacity ? 5 : 10, traits: [] },
    { seed: capacity ? 'capacity:' + n : side, registry, noVariance: true }).unit;
  u.id = capacity ? 'unit-' + n : side; return u;
});
const storage = units.map((u) => unitRecordFromCombatant(u));
const b = capacity ? new SmallBattle({ combatants: units, rules: V2_D20, traitRegistry: registry, seed: 'capacity',
  battlefield: generatedField('capacity', 7, 9, ['forest']) }) : undefined;
if (b) {
  b.start();
  for (let n = 0; n < count && b.active?.side !== 'ally' && !b.isOver(); n++) b.autoAction(b.active!.id);
}
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, rosterIds: storage.map((u) => u.id),
  protagonistId: b?.active?.id ?? 'ally', autoTurn: false, mode: capacity ? 'small' : 'mass',
  battle: b ? { kind: 'small', snap: b.toSnapshot() } : null, field: 'forest', autoSettleXp: true }));
