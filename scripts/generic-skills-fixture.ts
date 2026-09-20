import { generateUnit, traitRegistry } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const registry = traitRegistry();
const storage = ['caster', 'friend', 'enemy'].map((id) => {
  const unit = generateUnit({ name: id === 'caster' ? '术士' : id === 'friend' ? '同行者' : '守卫', rulesVersion: 'v2', side: id === 'enemy' ? 'enemy' : 'ally',
    scale: 'hero', hpMax: 200, hp: id === 'enemy' ? 200 : 100, level: 5, weaponClass: 'sword', armorTier: 4, armorLevel: 10, traits: [],
    abilityBlueprints: id === 'caster' ? [{ id: 'bp-crushing-blow', name: '旧招式', level: 4 }] : [] }, { seed: 'skill-fixture:' + id, registry, noVariance: true }).unit;
  unit.id = id; if (id === 'caster') unit.base.spd = 100;
  return unitRecordFromCombatant(unit);
});
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, rosterIds: storage.map((r) => r.id), protagonistId: 'caster', autoTurn: false, storySync: true, battle: null }));
