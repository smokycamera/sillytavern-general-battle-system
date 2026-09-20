/** 为已完成T8–T10后的界面尾段提供两个真实引擎战果，不重放已通过的消息流程。 */
import { generateUnit, SmallBattle, standardField, traitRegistry, V2_D20, settlementCard, roundDigest, smallStateSummary } from '../engine/src/index.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
const registry = traitRegistry(), storage = [], reports = [], lastBattleUnitIds: string[] = [];
for (const n of [1, 2]) {
  const units = (['ally', 'enemy'] as const).map((side) => generateUnit({ rulesVersion: 'v2', name: side === 'ally' ? '旧主控' : '对阵守卫',
    side, scale: 'hero', level: 3, traits: [], hpMax: 30, weaponClass: 'sword', weaponLevel: 4, armorTier: 0 }, { seed: 'tail-' + n + side, registry }).unit);
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, seed: 'tail-battle-' + n, battlefield: field, rules: V2_D20, traitRegistry: registry });
  battle.start();
  for (let i = 0; i < 80 && !battle.isOver(); i++) battle.autoAction(battle.active!.id);
  if (!battle.isOver()) throw Error('尾段夹具对局未结束');
  storage.push(...battle.combatants.map((u) => unitRecordFromCombatant(u)));
  reports.push({ id: 'small:' + battle.seed, card: settlementCard(battle.log, battle.round, false, { wholeBattle: true }),
    digest: roundDigest(battle, undefined, registry, { wholeBattle: true }), summary: smallStateSummary(battle), deliveries: {} });
  if (n === 2) lastBattleUnitIds.push(...battle.combatants.filter((u) => u.status === 'ready').map((u) => u.id));
}
console.log(JSON.stringify({ schemaVersion: 2, factRevision: 1, storage, reports, rosterIds: [], lastBattleUnitIds,
  committedOutcomeIds: reports.map((r) => r.id), selectedReportId: reports.at(-1)!.id, protagonistId: storage[0]!.id, battle: null }));
