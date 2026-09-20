/**
 * Read-only generation review probes. Run from the project root:
 * .\node_modules\.bin\vite-node.cmd scripts/audit-generation-v2.ts
 *
 * Only fresh in-memory units are mutated. This prints observations, not a test
 * suite requiring defects to remain present. No saves or product files change.
 */
import {
  generateUnit, applyXp, armorDR, LITE_D20, traitRegistry,
  abilitiesFromBlueprints, curveAt, resolveAttack, SeededRng,
  type GenerateInput,
} from '../engine/src/index.js';
import { weaponClassKey } from '../panel/src/tags.js';

const registry = traitRegistry();
const baseline: GenerateInput = {
  name: '生成审计样本', scale: 'hero', archetype: 'infantry',
  level: 4, traits: [], side: 'ally', era: 'medieval',
};
const make = (overrides: Partial<GenerateInput> = {}, seed = 'audit-generation') =>
  generateUnit({ ...baseline, ...overrides }, { seed, noVariance: true, registry }).unit;
const report = (probe: string, observed: unknown) =>
  console.log(JSON.stringify({ probe, observed }, null, 2));

const explicitArmor = make({ archetype: 'ranged', armorId: 'arm-terminator' });
report('G01 explicit armor identity', {
  armor: explicitArmor.armor, actualBaseDR: armorDR(explicitArmor, LITE_D20, registry),
});

report('G02 weapon level with/without class', [
  make({ weaponId: 'wpn-ar', loadout: 'ranged', weaponLevel: 8 }).weapon,
  make({ weaponId: 'wpn-ar', loadout: 'ranged', weaponLevel: 8, weaponClass: 'rifle' }).weapon,
]);

const upgrade = make({ weaponClass: 'axe', weaponLevel: 8 });
const before = structuredClone(upgrade.weapon);
const progression = applyXp(upgrade, 6500, registry);
report('G03 training rewrites weapon', { before, progression, after: upgrade.weapon });

const veteran = make({ traits: ['veteran'] });
const plain = make();
const attackValue = (attacker: typeof plain) => resolveAttack({
  attacker, defender: make({ side: 'enemy' }), rng: new SeededRng('audit-attack'),
  rules: LITE_D20, conditionDefs: new Map(), traitRegistry: registry,
}).netAtk;
report('G04 static trait applied again at runtime', {
  baseAtkDelta: veteran.base.atk - plain.base.atk,
  resolvedAtkDelta: attackValue(veteran) - attackValue(plain),
});

const blueprints = abilitiesFromBlueprints(
  ['bp-crushing-blow', 'bp-mending', 'bp-iron-guard'],
  { curve: curveAt(4), level: 4, jitter: 0, max: 2, rand: () => 0.5 },
);
report('G05 blueprint max', { requestedMax: 2, generatedCount: blueprints.abilities.length });

const summons = make({ abilityBlueprints: ['bp-call-reinforce', 'bp-raise-dead'] });
report('G06 distinct summon identities', summons.abilities.map(({ id, effects, cost }) => ({
  id, effects, cost: cost ?? null,
})));

const duplicates = make({ abilityBlueprints: [
  { id: 'bp-crushing-blow', level: 2, name: '低阶破击' },
  { id: 'bp-crushing-blow', level: 8, name: '高阶破击' },
] });
report('G07 duplicate blueprint ranks', duplicates.abilities.map(({ id, name }) => ({ id, name })));

report('G08 same declared armor level', {
  omitted: make({ armorId: 'arm-plate' }).armor,
  explicit: make({ armorId: 'arm-plate', armorLevel: 4 }).armor,
});

report('G09 parser keyword collisions', ['光剑', '等离子步枪', '轨道炮'].map(name => ({
  name, resolvedClass: weaponClassKey(name),
})));

report('G10 seed-prefix entity identity', {
  first: make({}, 'same-alpha').id, second: make({}, 'same-beta').id,
});

const membership = make({ scale: 'company' });
const beforeMembers = { current: membership.hp, capacity: membership.base.hpMax };
applyXp(membership, 6500, registry);
report('G11 company progression', {
  before: beforeMembers, after: { current: membership.hp, capacity: membership.base.hpMax },
});
