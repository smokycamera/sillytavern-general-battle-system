import { generateUnit, SmallBattle, MassBattle, SeededRng, standardField, traitRegistry, V2_D20, V2_TW, type GenerateInput } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const registry = traitRegistry();
function unit(id: string, extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id === 'a' ? '试验部队' : '对阵守卫', side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'sword', weaponLevel: 5, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
function fixture(kind: string) {
  const a = unit('a', kind === 'rider' ? { name: '骑射手', mount: true, traits: ['mounted-archer'], weaponClass: 'bow' }
    : kind === 'vehicle' ? { name: '稳定炮车', body: 'vehicle', weaponClass: 'cannon', weaponStabilized: true, armorTier: 3, armorLevel: 7, armorProfile: 'thermal' }
    : kind === 'physical' ? { name: '持双武器的前卫', scale: 'company', weaponClass: 'rifle', sidearmClass: 'sword', sidearmName: '近战副剑', sidearmLevel: 8, traits: ['poison-strike'], abilityBlueprints: [{ id: 'bp-crushing-blow', level: 10 }] }
    : kind === 'area' ? { name: '烈焰术士', abilityBlueprints: [{ id: 'bp-firestorm', level: 6 }] }
    : { name: '束缚术士', abilityBlueprints: [{ id: 'bp-binding', level: 10 }, { id: 'bp-arcane-bolt', level: 4 }] });
  const b = unit('b', kind === 'control' ? { level: 1, traits: ['flying'] } : kind === 'vehicle' ? { body: 'vehicle' } : kind === 'area' ? { scale: 'company' } : {});
  const mass = kind === 'vehicle';
  if (mass) for (const u of [a, b]) u.tags = ['zone:中军', 'rank:reserve'];
  const storage = [a, b].map(unitRecordFromCombatant);
  const field = standardField(); field.tiles.fill('open');
  const battle = mass ? new MassBattle({ combatants: [a, b], seed: 'p3c-browser', rules: V2_TW, traitRegistry: registry, commanderId: 'a' })
    : new SmallBattle({ combatants: [a, b], seed: 'p3c-browser', rules: V2_D20, traitRegistry: registry, battlefield: field });
  battle.start();
  if (battle instanceof MassBattle) battle.issue({ unitId: 'b', type: 'hold' });
  if (battle instanceof SmallBattle) {
    battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 45; b.pos = ['physical', 'rider'].includes(kind) ? 38 : 24;
    (battle.rng as SeededRng).setState(['physical', 'area'].includes(kind) ? 4 : 9);
  }
  return { schemaVersion: 2, factRevision: 1, storage, rosterIds: ['a', 'b'], protagonistId: 'a', autoTurn: false, autoAllyOrders: false, mode: mass ? 'mass' : 'small', battle: { kind: mass ? 'mass' : 'small', snap: battle.toSnapshot() } };
}
console.log(JSON.stringify(Object.fromEntries(['rider', 'vehicle', 'physical', 'control', 'area'].map((id) => [id, fixture(id)]))));
