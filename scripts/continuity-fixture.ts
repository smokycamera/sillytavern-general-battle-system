/** 脱敏 legacy 结构样本：真实引擎快照，仅用于本地浏览器回归。 */
import { generateUnit, SmallBattle, traitRegistry } from '../engine/src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../panel/src/unit-state.js';
const registry = traitRegistry();
const unit = generateUnit({ name: 'A军团', side: 'ally', scale: 'company', level: 4, traits: [], weaponClass: 'rifle', weaponLevel: 9 }, { registry, seed: 'p1-ally', noVariance: true }).unit;
unit.id = 'corp-a'; unit.hp = unit.base.hpMax = 560;
const enemy = generateUnit({ name: '测试敌军', side: 'enemy', scale: 'company', level: 1, traits: [] }, { registry, seed: 'p1-enemy', noVariance: true }).unit;
enemy.id = 'enemy-a'; enemy.xpValue = 0;
const storage = [unitRecordFromCombatant(unit), unitRecordFromCombatant(enemy)];
const battle = new SmallBattle({ combatants: storage.map((r) => materializeUnitRecord(r, registry)), seed: 'p1-battle-a', traitRegistry: registry });
battle.start();
battle.combatants[0]!.hp = 70;
battle.combatants[1]!.hp = 0; battle.combatants[1]!.status = 'dead';
battle.xpByUnit.set(unit.id, 6500);
battle.log.push({ round: 1, kind: 'battle-end', text: '测试：战斗胜利，A军团剩余70人' });
console.log(JSON.stringify({ schemaVersion: 2, rosterIds: storage.map((r) => r.id), storage, autoSettleXp: false, autoApprove: false, mode: 'small', battle: { kind: 'small', snap: battle.toSnapshot() } }));
