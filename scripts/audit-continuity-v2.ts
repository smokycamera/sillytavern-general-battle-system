/**
 * Read-only continuity probes. Fresh in-memory records only; no host, chat or
 * player save writes. Updating a record here models an already accepted update;
 * it does NOT test main.ts approval or actual host persistence.
 */
import { generateUnit, traitRegistry, applyXp, type Combatant } from '../engine/src/index.js';
import {
  unitRecordFromCombatant, materializeUnitRecord, commitBattleState,
  commitBattleOutcome, type UnitRecord,
} from '../panel/src/unit-state.js';
import { parseSuggestionTags } from '../panel/src/tags.js';

const registry = traitRegistry();
const report = (probe: string, observed: unknown) => console.log(JSON.stringify({ probe, observed }, null, 2));
function make(id: string, scale: 'hero' | 'company', max: number): Combatant {
  const { unit } = generateUnit({
    name: scale === 'company' ? 'A军团' : '小规模角色', side: 'ally',
    scale, archetype: 'infantry', level: 4, traits: [],
    weaponClass: 'rifle', weaponLevel: 4, armorTier: 2,
  }, { seed: 'continuity-' + id, noVariance: true, registry });
  unit.id = id;
  unit.base.hpMax = max;
  unit.hp = max;
  return unit;
}
function roundTrip(record: UnitRecord) {
  const persisted = JSON.parse(JSON.stringify(record)) as UnitRecord;
  const next = materializeUnitRecord(persisted, registry);
  return { id: next.id, hp: next.hp, hpMax: next.base.hpMax, weapon: next.weapon?.id };
}

const army = make('corp-a', 'company', 560);
const initial = unitRecordFromCombatant(army);
army.hp = 70;
const committed = commitBattleState({ records: [initial], roster: [], combatants: [army] });
const record = committed.records[0]!;
report('C01 damaged army survives serialization and repeated materialization', [
  roundTrip(record), roundTrip(record), roundTrip(record),
]);

report('C02 accepted record values determine next deployment', [500, 560, 1000].map(hp => {
  const updated = structuredClone(record);
  updated.hp = hp;
  if (hp === 1000) updated.base.hpMax = 1000;
  return roundTrip(updated);
}));

const hero = make('hero-a', 'hero', 40);
hero.hp = 18;
const heroRecord = unitRecordFromCombatant(hero);
report('C03 small-scale persistence', {
  damaged: roundTrip(heroRecord),
  afterAcceptedHealing: roundTrip({ ...heroRecord, hp: 34 }),
});

report('C04 existing short tags parse', parseSuggestionTags([
  '<tb>', '<deploy id="corp-a"/>',
  '<unit_update id="corp-a" hp="500"/>',
  '<unit_update id="corp-a" hp="1000" hpMax="1000"/>', '</tb>',
].join('\n')).suggestions);

const progressed = materializeUnitRecord(record, registry);
applyXp(progressed, 6500, registry);
report('C05 current company upgrade still overwrites capacity', {
  before: { level: 4, hp: record.hp, hpMax: record.base.hpMax },
  after: { level: progressed.level, hp: progressed.hp, hpMax: progressed.base.hpMax },
});

const first = commitBattleOutcome({
  battleId: 'continuity-old-outcome', committedIds: [], records: [initial],
  roster: [], combatants: [structuredClone(army)], awards: [], registry,
});
const replenished = structuredClone(first.records);
replenished[0]!.hp = 500;
const replay = commitBattleOutcome({
  battleId: 'continuity-old-outcome', committedIds: first.committedIds,
  records: replenished, roster: [], combatants: [structuredClone(army)],
  awards: [], registry,
});
report('C06 old outcome replay can overwrite later replenishment', {
  alreadyCommitted: true, beforeReplay: replenished[0]!.hp,
  xpAppliedAgain: replay.applied, afterReplay: replay.records[0]!.hp,
});
