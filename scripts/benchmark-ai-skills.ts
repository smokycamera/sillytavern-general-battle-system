/** Local CPU benchmark; no model requests. Compare hashes against the baseline before using timings.
 * BENCH_CASE selects a case, BENCH_TRIALS controls repetitions, BENCH_PROFILE writes a CPU profile.
 * node scripts/run-benchmark-ai-skills.mjs [baseline-ref]
 */
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { SmallBattle, generateUnit, standardField, traitRegistry, V32_OVERFLOW_D20, compileGenericSkill,
  attachCarriedItems, compileItem, type Side, type UnitIntent } from '../engine/src/index.js';
import { sampledPreviewComputations } from '../engine/src/damage.js';

const definitions = ['buff:attack', 'buff:defense', 'buff:barrier', 'buff:trait-berserk',
  'buff:heal', 'buff:restore', 'magic-single:arcane', 'debuff:stun'];
const cases = [
  { name: '4-hold-skills', count: 4, sides: 2, mode: 'hold', items: false },
  { name: '8-auto-skills', count: 8, sides: 2, mode: 'auto', items: false },
  { name: '32-auto-skills', count: 32, sides: 2, mode: 'auto', items: false },
  { name: '32-hold-skills', count: 32, sides: 3, mode: 'hold', items: false },
  { name: '32-buff-intent', count: 32, sides: 3, mode: 'buff', items: false },
  { name: '32-item-intent', count: 32, sides: 3, mode: 'item', items: true },
  { name: '32-hold-items', count: 32, sides: 3, mode: 'hold', items: true },
];
const trials = Number(process.env.BENCH_TRIALS ?? 1), rows: object[] = [];
if (!Number.isInteger(trials) || trials < 1 || trials > 5) throw Error('BENCH_TRIALS must be 1..5');
const profile = process.env.BENCH_PROFILE ? new Session() : undefined;
if (profile) { profile.connect(); profile.post('Profiler.enable'); profile.post('Profiler.start'); }
const selected = process.env.BENCH_CASE?.split(',');
for (const scenario of cases.filter(c => !selected || selected.includes(c.name))) {
  for (let trial = 0; trial < trials; trial++) {
    const seed = `ai-skills:${scenario.name}:${trial}`, registry = traitRegistry();
    const combatants = Array.from({ length: scenario.count }, (_, i) => {
      const group = scenario.sides === 2 ? Number(i >= scenario.count / 2) : i < 11 ? 0 : i < 22 ? 1 : 2;
      const side: Side = (['ally', 'enemy', 'neutral'] as const)[group]!;
      const unit = generateUnit({ name: `u${i}`, side, scale: 'company', hpMax: 20, level: 5,
        rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: i % 3 === 0 ? 'bow' : 'spear',
        weaponLevel: 4, armorTier: 1, traits: [] }, { registry, seed: `${seed}:u${i}`, noVariance: true }).unit;
      unit.id = `u${i}`;
      unit.abilities = definitions.map(id => compileGenericSkill('generic:' + id, 4, unit.id, undefined, 'wounds-v2', V32_OVERFLOW_D20.skillModel));
      unit.preparedAbilityIds = unit.abilities.map(a => a.id);
      if (scenario.items) Object.assign(unit, attachCarriedItems(unit, ['buff:attack', 'buff:defense', 'buff:barrier', 'buff:heal'].map((active, j) => ({
        id: `dose${j}`, name: active, quantity: 40, revision: 1,
        mechanics: compileItem({ kind: 'item', form: 'single', power: 4, active: 'generic:' + active }, { id: `dose${j}`, seed: `dose${j}` }),
      }))));
      return unit;
    });
    const field = standardField(13, 19); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null);
    const battle = new SmallBattle({ combatants, battlefield: field, rules: V32_OVERFLOW_D20, traitRegistry: registry, seed }); battle.start();
    const offsets = { ally: 0, enemy: 0, neutral: 0 };
    for (const u of combatants) {
      const n = offsets[u.side]++;
      u.pos = u.side === 'ally' ? (10 + Math.floor(n / 8)) * 13 + 2 + n % 8
        : u.side === 'enemy' ? (6 - Math.floor(n / 8)) * 13 + 2 + n % 8 : (5 + n % 10) * 13 + 11;
    }
    battle.turnOrder = combatants.map(u => u.id); battle.turnIndex = 0;
    const actor = combatants[0]!;
    const intent: UnitIntent | undefined = scenario.mode === 'hold' ? { mode: 'hold', cell: actor.pos }
      : scenario.mode === 'buff' ? { mode: 'use_ability', abilityId: actor.abilities[0]!.id, targetId: actor.id }
      : scenario.mode === 'item' ? { mode: 'use_ability', abilityId: 'item:dose0', targetId: actor.id } : undefined;
    const startSamples = sampledPreviewComputations(), start = performance.now();
    battle.autoAction(actor.id, intent);
    const ms = performance.now() - start;
    const row = { name: scenario.name, trial, ms, samples: sampledPreviewComputations() - startSamples,
      hash: createHash('sha256').update(JSON.stringify(battle.toSnapshot())).digest('hex') };
    rows.push(row); console.log(JSON.stringify(row));
  }
}
if (profile) {
  profile.post('Profiler.stop', (error, result) => {
    if (error) throw error;
    mkdirSync(dirname(process.env.BENCH_PROFILE!), { recursive: true });
    writeFileSync(process.env.BENCH_PROFILE!, JSON.stringify(result.profile)); profile.disconnect();
  });
}
const output = process.argv[2] ?? 'artifacts/ai-skills/results.json'; mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ node: process.version, rows }, null, 2) + '\n');
