import { mkdirSync, writeFileSync } from 'node:fs';
import { generateUnit, SmallBattle, standardField, V11_OVERFLOW_D20 } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';

const units = (['ally','enemy'] as const).map((side, i) => {
  const u = generateUnit({ name: side === 'ally' ? 'MCP 玩家' : 'MCP 隐藏敌军', side, scale: 'hero', level: 3, rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'sword', traits: [] }, { seed: side }).unit;
  u.id = 'mcp-u' + i; u.morale = u.base.moraleMax = 100; return u;
});
const field = standardField(7,13); field.tiles.fill('open');
const b = new SmallBattle({ combatants: units, battlefield: field, field: { tags: ['night'] }, rules: V11_OVERFLOW_D20, seed: 'mcp-browser' });
b.start(); b.turnOrder = ['mcp-u0','mcp-u1']; b.turnIndex = 0; b.byId('mcp-u0').pos = 79; b.byId('mcp-u1').pos = 9;
const ready = { schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id), protagonistId: 'mcp-u0', autoTurn: false };
mkdirSync('artifacts/mcp-smoke', { recursive: true });
writeFileSync('artifacts/mcp-smoke/fixture.json', JSON.stringify({ ready, battle: { ...ready, battle: { kind: 'small', snap: b.toSnapshot() } } }));
