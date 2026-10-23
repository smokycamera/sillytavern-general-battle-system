import { writeFileSync } from 'node:fs';
import { generateUnit, prepareCombatModel, prepareArmsModel, V29_OVERFLOW_D20, traitRegistry,
  equipmentCapacity, equipmentLoad, movementPoints, equipmentLoadLabel, type GenerateInput } from '../engine/src/index.js';

const registry = traitRegistry();
function probe(patch: Partial<GenerateInput>) {
  const unit = generateUnit({ name: 'capacity-probe', side: 'ally', scale: 'hero', rulesVersion: 'v2',
    level: 5, body: 'human', damageModel: 'wounds-v2', numericModel: 'graded-v1', loadModel: 'capacity-v2',
    weaponClass: 'sword', weaponLevel: 5, armorTier: 0, traits: [], ...patch }, { registry, noVariance: true, seed: 'capacity-probe' }).unit;
  prepareCombatModel(unit, V29_OVERFLOW_D20); prepareArmsModel(unit, V29_OVERFLOW_D20);
  return { body: unit.body, scale: unit.scale, level: unit.level, weapon: unit.weapon?.recipe?.mechanism,
    weaponLoad: unit.weapon?.load, weight: unit.weapon?.recipe?.bonuses?.weight ?? 0, armorTier: unit.armor?.tier,
    armorLoad: unit.armor?.load, load: equipmentLoad(unit), capacity: equipmentCapacity(unit),
    ratio: equipmentLoad(unit) / equipmentCapacity(unit), movement: movementPoints(unit), label: equipmentLoadLabel(unit) };
}
const capacity = Array.from({ length: 10 }, (_, index) => Object.fromEntries([
  ['level', index + 1], ...(['human', 'large', 'giant', 'vehicle'] as const).map(body => [body, probe({ body, level: index + 1 }).capacity]),
]));
const loadouts = [
  ...(['human', 'large', 'giant', 'vehicle'] as const).flatMap(body => [4, 5].map(level => probe({ body, level,
    weaponClass: body === 'human' ? 'heavy-polearm' : body === 'large' ? 'autocannon' : 'cannon', armorTier: level === 4 ? 3 : 4 }))),
  probe({ body: 'human', scale: 'company', level: 2, weaponClass: 'cannon', armorTier: 1 }),
  probe({ body: 'human', scale: 'company', level: 2, weaponClass: 'autocannon', armorTier: 1 }),
  probe({ body: 'vehicle', level: 3, weaponClass: 'cannon', armorTier: 3 }),
  ...([-10, -5, -1, 0, 1, 5, 10]).map(weight => probe({ weaponClass: 'cannon', weaponBonuses: { weight } })),
];
const report = { rules: V29_OVERFLOW_D20.id, capacity, loadouts };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
