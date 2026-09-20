import { generateUnit, traitRegistry } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const registry = traitRegistry();
const storage = [
  { id: 'a', name: '试装车组', side: 'ally' as const, hp: 18 },
  { id: 'b', name: '后备车组', side: 'ally' as const, hp: 200 },
  { id: 'e', name: '测试靶标', side: 'enemy' as const, hp: 40 },
  { id: 'e2', name: '次战靶标', side: 'enemy' as const, hp: 40 },
].map(({ id, hp, ...identity }) => {
  const u = generateUnit({ ...identity, scale: 'hero', level: 3, rulesVersion: 'v2', body: 'vehicle', hp, hpMax: id === 'b' ? 400 : 40, traits: [], weaponClass: 'sword', weaponLevel: 2, armorTier: 1 }, { seed: `inventory-${id}`, registry }).unit;
  // 配装调用链的可命中靶标，避免把这条操作验收误当随机胜率或数值平衡测试。
  if (id === 'e' || id === 'e2') u.base.def = 0;
  u.id = id; return unitRecordFromCombatant(u);
});
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, rosterIds: ['a', 'e'], protagonistId: 'a', mode: 'small', autoTurn: false,
  inventory: [{ id: 'legacy-sword', name: '待鉴定旧剑', qty: 2, lootType: 'weapon', note: '旧剧情所得' }], reports: [], committedOutcomeIds: [] }));
