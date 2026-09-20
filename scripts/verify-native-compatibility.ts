import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as engine from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { NativeHost } from '../host/src/sillytavern.js';
import { legacyCompatibleSave } from '../runtime/src/save-management.js';
import { importedModule } from './imported-baseline-oracle.mjs';
import type { NarrativeSave } from '../panel/src/narrative-state.js';

const baseline = importedModule('engine/src/index.ts') as typeof engine;
const oldController = importedModule('panel/src/narrative-controller.ts');
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const cases: string[] = [];
for (const mode of ['small', 'mass'] as const) {
  const units = (['ally', 'enemy'] as const).map(side => {
    const unit = engine.generateUnit({ rulesVersion: 'v2', name: '兼容核对' + side, side, scale: mode === 'mass' ? 'company' : 'hero', level: 4, weaponLevel: 4, weaponClass: 'sword', armorTier: 1, armorLevel: 3, traits: [] }, { seed: 'rollback-' + side, registry: engine.traitRegistry(), noVariance: true }).unit;
    unit.id = side; return unit;
  });
  const battle = mode === 'small'
    ? new engine.SmallBattle({ combatants: structuredClone(units), rules: engine.V4_OVERFLOW_D20, seed: 'rollback-small', traitRegistry: engine.traitRegistry() })
    : new engine.MassBattle({ combatants: structuredClone(units), rules: engine.V4_OVERFLOW_TW, seed: 'rollback-mass', traitRegistry: engine.traitRegistry() });
  battle.start();
  if (battle instanceof engine.SmallBattle) { battle.autoAction(battle.active!.id); if (!battle.isOver()) battle.endTurn(); }
  else battle.resolveRound(battle.round);
  const save: NarrativeSave = { schemaVersion: 2, storage: units.map(unit => unitRecordFromCombatant(unit)), rosterIds: units.map(unit => unit.id),
    battle: { kind: mode, snap: plain(battle.toSnapshot()) }, factRevision: 5, customValue: { preserve: true }, committedOutcomeIds: ['old-battle'] };
  const context = { chatId: 'compatibility', characterId: 0, characters: [{ avatar: 'fixture.png' }], chat: [], chatMetadata: {} };
  const host = new NativeHost({ SillyTavern: { getContext: () => context } }, 'test');
  const legacy = legacyCompatibleSave(save, host);
  const adapter = { load: () => plain(legacy), identity: () => 'fixture', namespace: () => host.namespace(),
    subscribe: () => ({ available: false, stop() {} }), injectPrompts: () => false, uninjectPrompts() {}, recentPromptText: () => '' };
  const controller = new oldController.NarrativeController(adapter);
  try {
    assert.equal(controller.migrationReview(), undefined, 'Frozen controller accepts the native-stage save without quarantine');
    const restored = plain(controller.snapshot()) as NarrativeSave;
    assert.deepEqual(restored.storage, plain(save.storage), 'unit identity/HP/XP/equipment/cooldown remain unchanged');
    assert.deepEqual(restored.battle, save.battle, 'snapshot including RNG remains unchanged');
    assert.deepEqual(restored.committedOutcomeIds, save.committedOutcomeIds);
    assert.deepEqual(restored.customValue, save.customValue);
    const prior = mode === 'small' ? baseline.SmallBattle.fromSnapshot(restored.battle!.snap) : baseline.MassBattle.fromSnapshot(restored.battle!.snap);
    assert.deepEqual(plain(prior.toSnapshot()), plain(battle.toSnapshot()));
    cases.push(mode + '-latest-progress-restores-in-frozen-release');
  } finally { controller.dispose(); }
}
const emptyHost = new NativeHost({ SillyTavern: { getContext: () => ({ chatId: 'empty', characterId: 0, characters: [{ avatar: 'fixture.png' }], chat: [], chatMetadata: {} }) } }, 'test');
const empty = legacyCompatibleSave({}, emptyHost);
const emptyController = new oldController.NarrativeController({ load: () => plain(empty), identity: () => 'empty', namespace: () => emptyHost.namespace(), subscribe: () => ({ available: false, stop() {} }), injectPrompts: () => false, uninjectPrompts() {} });
try { assert.deepEqual(plain(emptyController.snapshot()).storage, []); assert.deepEqual(plain(emptyController.snapshot()).inventory, []); cases.push('cleared-save-remains-empty-in-frozen-release'); }
finally { emptyController.dispose(); }
mkdirSync('artifacts/migration-m3', { recursive: true });
writeFileSync('artifacts/migration-m3/frozen-rollback.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', cases }, null, 2) + '\n');
console.log('PASS', cases);
