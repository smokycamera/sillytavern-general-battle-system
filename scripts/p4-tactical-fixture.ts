import { generateUnit, SmallBattle, standardField, traitRegistry, V2_D20, type GenerateInput } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
export function tacticalFixture() {
  const registry = traitRegistry();
  const make = (id: string, input: Partial<GenerateInput>) => {
    const u = generateUnit({ name: id, side: 'enemy', rulesVersion: 'v2', scale: 'hero', level: 4, hp: 80, hpMax: 100,
      weaponClass: 'rifle', weaponLevel: 1, armorTier: 0, traits: [], ...input }, { seed: id, registry, noVariance: true }).unit;
    u.id = id; return u;
  };
  const units = [
    make('a', { name: '前锋术士', side: 'ally', abilityBlueprints: [{ id: 'bp-firestorm', level: 6 }, { id: 'bp-mending', level: 5 }] }),
    make('b', { name: '铁甲守卫', body: 'vehicle', armorTier: 4, armorLevel: 10 }),
    make('c', { name: '受伤队友', side: 'ally', hp: 40 }),
    make('d', { name: '守点步兵', scale: 'company' }),
    make('e', { name: '未发现的伏兵', traits: ['stalk'] }),
  ];
  const storage = units.map((u) => unitRecordFromCombatant(u)), field = standardField();
  field.objective = { kind: 'control', cell: 24, rounds: 2, limit: 60, attackingSide: 'ally' };
  field.tiles[44] = 'forest'; field.tiles[46] = 'hill';
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V2_D20, seed: 'p4-tactical', traitRegistry: registry });
  b.start(); b.turnOrder = ['a', 'b', 'c', 'd', 'e']; b.turnIndex = 0;
  for (const [id, pos] of [['a', 45], ['b', 31], ['c', 44], ['d', 24], ['e', 0]] as const) b.byId(id).pos = pos;
  const snapshot = b.toSnapshot(); delete snapshot.feedback; // 夹具直接布置坐标后，从正式恢复入口建立观察基线。
  return { b, save: { schemaVersion: 2, factRevision: 1, storage, rosterIds: storage.map((r) => r.id), protagonistId: 'a',
    autoTurn: false, mode: 'small', battle: { kind: 'small', snap: snapshot }, autoSettleXp: true } };
}
if ((globalThis as { process?: { argv: string[] } }).process?.argv.includes('--json')) console.log(JSON.stringify(tacticalFixture().save));
