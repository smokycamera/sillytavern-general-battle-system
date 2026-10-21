/** Build saved native-panel fixtures from the actual, offline-replayed Flash responses. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generateUnit, SmallBattle, V11_OVERFLOW_D20 } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const objectives = process.argv.includes('--objectives');
const report = objectives ? { cases: [
  ...JSON.parse(readFileSync('artifacts/indoor-layout-research/live-objectives.json', 'utf8')).cases.filter((c: any) => c.id.endsWith('-escort')),
  ...JSON.parse(readFileSync('artifacts/indoor-layout-research/live-objectives-control-confirm.json', 'utf8')).cases,
] } : JSON.parse(readFileSync('artifacts/indoor-layout-research/replay-positions.json', 'utf8'));
const seen = new Set<string>(), fixtures: object[] = [];
for (const c of report.cases) {
  const pattern = objectives ? c.id : c.field?.generation?.compound?.pattern ?? c.field?.generation?.trenches?.pattern;
  if (!c.success || !pattern || seen.has(pattern)) continue;
  seen.add(pattern);
  const third = Object.keys(c.field.initialDeployment).some(id => id.startsWith('neutral'));
  const units = (third ? ['ally', 'enemy', 'neutral'] as const : ['ally', 'enemy'] as const).flatMap(side => Array.from({ length: side === 'neutral' ? 2 : 4 }, (_, i) => {
    const u = generateUnit({ name: (side === 'ally' ? '我方' : side === 'enemy' ? '敌方' : '第三方') + (i + 1), side, scale: 'hero', rulesVersion: 'v2', level: 3,
      weaponClass: i % 2 ? 'bow' : 'sword', weaponLevel: 3, traits: [] }, { seed: side + i, noVariance: true }).unit;
    u.id = side + i; return u;
  }));
  const battle = new SmallBattle({ battlefield: structuredClone(c.field), combatants: units, rules: V11_OVERFLOW_D20, seed: 'position-browser-' + pattern }); battle.start();
  fixtures.push({ pattern, id: c.id, width: c.field.width, height: c.field.height, units: units.length,
    goalKind: c.field.objective.kind, goalCell: c.field.objective.cell, goalArea: c.field.objective.kind === 'control' ? c.field.objective.cells?.length ?? 1 : 0, state: {
    schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), autoTurn: false,
    protagonistId: 'ally0', field: 'plains', lighting: 'day', battle: { kind: 'small', snap: battle.toSnapshot() },
  } });
}
if (fixtures.length !== (objectives ? 6 : 12)) throw Error('Expected every selected layout from successful real responses');
mkdirSync('artifacts/position-browser', { recursive: true });
writeFileSync(`artifacts/position-browser/fixtures${objectives ? '-objectives' : ''}.json`, JSON.stringify(fixtures));
console.log(`Prepared ${fixtures.length} real-answer native panel fixtures`);
