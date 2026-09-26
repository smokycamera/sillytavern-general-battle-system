import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as current from '../engine/src/index.js';
import { tbWeaponShortName } from '../engine/src/weapon-name.js';
import { combatantFromUnknown } from '../panel/src/unit-state.js';
import { importedModule, importedHelper } from './imported-baseline-oracle.mjs';

const old = importedModule('engine/src/index.ts') as typeof current;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
// 新字段只为屏障保留生命上限裁剪前的伤害。旧场景仍逐项比较命中、实际伤害、状态、随机源和存档；不忽略其他差异。
const baselineDamagePlans = (value: unknown) => JSON.parse(JSON.stringify(value, function(key, entry) {
  return (key === 'incomingDirect' || key === 'incomingSplash') && typeof this.direct === 'number' && typeof this.targets === 'number' ? undefined : entry;
}));
const scenarios: string[] = [];
function equal(name: string, run: (engine: typeof current) => unknown) {
  assert.deepEqual(baselineDamagePlans(run(current)), baselineDamagePlans(run(old)), name); scenarios.push(name);
}
const specs = ['bp-binding', 'bp-shield-bash', 'bp-force-wave', 'bp-purify', 'bp-unravel', 'bp-call-reinforce'];
for (const scale of ['hero', 'company'] as const) equal(`generation-${scale}-five-slots`, engine => {
  const result = engine.generateUnit({ name: '基线单位', side: 'ally', scale, rulesVersion: 'v2', level: 5, abilityBlueprints: specs }, { seed: 'baseline-five-slots', registry: engine.traitRegistry(), noVariance: true });
  assert.equal(result.unit.preparedAbilityIds?.length, 5);
  assert.equal(result.unit.weapon?.level, 1);
  assert.equal(result.unit.armor?.tier, 0);
  return result;
});
for (const mode of ['small', 'mass'] as const) equal(`${mode}-seeded-actions-and-restore`, engine => {
  const registry = engine.traitRegistry();
  const units = ['ally', 'enemy'].map(side => {
    const unit = engine.generateUnit({ name: side, side: side as 'ally' | 'enemy', scale: mode === 'small' ? 'hero' : 'company', rulesVersion: 'v2', level: 4, weaponClass: 'sword', weaponLevel: 4, weaponName: '霜之哀伤剑L4', armorTier: 1, armorLevel: 3 }, { seed: 'baseline-' + side, registry, noVariance: true }).unit;
    unit.id = side; unit.pos = 2; return unit;
  });
  if (mode === 'small') {
    const battle = new engine.SmallBattle({ combatants: units, rules: engine.V4_OVERFLOW_D20, seed: 'migration-small', traitRegistry: registry });
    battle.start();
    for (let n = 0; n < 12 && !battle.isOver(); n++) { battle.autoAction(battle.active!.id); if (!battle.isOver()) battle.endTurn(); }
    const restored = engine.SmallBattle.fromSnapshot(plain(battle.toSnapshot()), { traitRegistry: registry });
    assert.deepEqual(plain(restored.toSnapshot()), plain(battle.toSnapshot()));
    return { snap: battle.toSnapshot(), report: engine.smallStateSummary(battle, 'dnd', registry) };
  }
  const battle = new engine.MassBattle({ combatants: units, rules: engine.V4_OVERFLOW_TW, seed: 'migration-mass', traitRegistry: registry });
  battle.start();
  for (let n = 0; n < 5 && !battle.isOver(); n++) battle.resolveRound(battle.round);
  const restored = engine.MassBattle.fromSnapshot(plain(battle.toSnapshot()), { traitRegistry: registry });
  assert.deepEqual(plain(restored.toSnapshot()), plain(battle.toSnapshot()));
  return { snap: battle.toSnapshot(), report: engine.massStateSummary(battle, 'dnd', registry) };
});
const oldState = importedModule('panel/src/unit-state.ts');
const base = current.generateUnit({ name: '坏档核对', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 2 }, { seed: 'invalid-fixture', registry: current.traitRegistry(), noVariance: true }).unit;
for (const patch of [{ hp: NaN }, { hp: '4' }, { status: 'invalid' }, { resources: { SP: -1 } }, { conditions: [{ id: 'stun', dur: -1 }] }]) {
  const error = (fn: (value: unknown) => unknown) => { try { fn({ ...structuredClone(base), ...patch }); return 'accepted'; } catch (value) { return String(value); } };
  const actual = error(combatantFromUnknown); assert.notEqual(actual, 'accepted'); assert.equal(actual, error(oldState.combatantFromUnknown).replaceAll('快照','存档记录'));
}
scenarios.push('invalid-save-rejection-five-cases');
const oldName = importedHelper('tbWeaponShortName');
for (const name of ['霜之哀伤剑L7', '幽影长剑L1+10', '长枪', '', '步枪·L5', '刀L3']) assert.equal(tbWeaponShortName({ name }), oldName({ name }));
scenarios.push('weapon-name-six-cases');
mkdirSync('artifacts/migration-m0', { recursive: true });
writeFileSync('artifacts/migration-m0/scenarios.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', scenarios }, null, 2) + '\n');
console.log('PASS:', scenarios.join(', '));
