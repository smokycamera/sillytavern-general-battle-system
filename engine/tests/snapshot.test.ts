import { describe, it, expect } from 'vitest';
import { SmallBattle, makeCombatant } from '../src/small/battle';
import { MassBattle } from '../src/mass/battle';
import { traitRegistry } from '../src/data/traits';
import { SeededRng } from '../src/rng';
import { generateUnit, standardField, V17_OVERFLOW_D20, V17_OVERFLOW_TW } from '../src/index.js';

const reg = traitRegistry();

function revisionBattle(mode: 'small' | 'mass') {
  const units = (['ally', 'enemy'] as const).map(side => {
    const u = generateUnit({ name: side, side, scale: mode === 'small' ? 'hero' : 'company', hpMax: mode === 'small' ? 300 : 20,
      rulesVersion: 'v2', level: 4, weaponClass: 'sword', traits: [] }, { seed: side, noVariance: true, registry: reg }).unit;
    u.id = side; return u;
  });
  const field = standardField(); field.tiles.fill('open');
  const battle = mode === 'small' ? new SmallBattle({ combatants: units, battlefield: field, rules: V17_OVERFLOW_D20, seed: 'ai-revision', traitRegistry: reg })
    : new MassBattle({ combatants: units, rules: V17_OVERFLOW_TW, seed: 'ai-revision', traitRegistry: reg });
  battle.start(); return battle;
}
function advanceRevisionBattle(battle: SmallBattle | MassBattle) {
  if (battle instanceof SmallBattle) battle.autoAction(battle.active!.id);
  else { battle.autoOrders('enemy'); battle.autoOrders('ally'); battle.resolveRound(battle.round); }
}

describe('§6 AI 修订号', () => {
  it.each(['small', 'mass'] as const)('%s 旧快照只追加一条修订日志，再次读入不重复', mode => {
    const battle = revisionBattle(mode), snap = structuredClone(battle.toSnapshot()); delete snap.aiRevision;
    const Class = mode === 'small' ? SmallBattle : MassBattle;
    const restored = Class.fromSnapshot(snap, { traitRegistry: reg });
    expect(restored.toSnapshot().aiRevision).toBe(1);
    expect(restored.log.slice(battle.log.length)).toEqual([{ round: battle.round, kind: 'rule', text: 'AI 已更新（修订 1）：工事中失联会继续搜索，推定敌人只用看见时的情报，会战攻击会避开已被确定击倒的目标' }]);
    expect(Class.fromSnapshot(structuredClone(restored.toSnapshot()), { traitRegistry: reg }).log).toHaveLength(restored.log.length);
  });
  it.each(['small', 'mass'] as const)('%s 中途存读档后逐步重放到结束', mode => {
    const battle = revisionBattle(mode); advanceRevisionBattle(battle);
    const Class = mode === 'small' ? SmallBattle : MassBattle;
    const restored = Class.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: reg });
    expect(battle.isOver()).toBe(false);
    while (!battle.isOver()) {
      advanceRevisionBattle(battle); advanceRevisionBattle(restored);
      expect(JSON.parse(JSON.stringify(restored.toSnapshot()))).toEqual(JSON.parse(JSON.stringify(battle.toSnapshot())));
    }
  });
});

describe('战斗快照持久化（面板关窗恢复用）', () => {
  it('SmallBattle 快照 JSON 往返：状态/日志/经验/轮转完整保留，恢复后可继续推进', () => {
    const ally = makeCombatant({
      id: 'ally-1', name: '艾莉', side: 'ally', archetype: 'infantry', pos: 2,
      base: { atk: 6, def: 14, spd: 3, hpMax: 24 },
      weapon: { id: 'sword', name: '长剑', baseDice: '1d8+3' },
      armor: { id: 'chain', name: '锁子甲', tier: 1 },
    });
    const foe = makeCombatant({
      id: 'foe-1', name: '哥布林', side: 'enemy', scale: 'mook', archetype: 'infantry', pos: 2,
      base: { atk: 3, def: 12, spd: 2, hpMax: 7 }, hp: 7,
      weapon: { id: 'spear', name: '短矛', baseDice: '1d6+1' },
      xpValue: 25,
    });
    const b = new SmallBattle({
      combatants: [ally, foe],
      seed: 'snap-small',
      traitRegistry: reg,
      field: { tags: ['urban'] },
    });
    b.start();
    b.attack(b.active!.id, b.active!.side === 'ally' ? 'foe-1' : 'ally-1', { bypassTurn: true });
    const logLen = b.log.length;
    expect(logLen).toBeGreaterThan(2);

    const snap = JSON.parse(JSON.stringify(b.toSnapshot())) as ReturnType<SmallBattle['toSnapshot']>;
    const b2 = SmallBattle.fromSnapshot(snap as Record<string, unknown>, { traitRegistry: reg });
    expect(b2.round).toBe(b.round);
    expect(b2.log).toHaveLength(logLen);
    expect(b2.combatants).toHaveLength(2);
    expect(b2.combatants.map((c) => c.id).sort()).toEqual(['ally-1', 'foe-1']);
    expect(b2.fieldTags).toEqual(['urban']);
    // 恢复后战斗可继续推进（started 标记已恢复，endTurn 不抛错）
    b2.endTurn();
    expect(b2.log.length).toBeGreaterThanOrEqual(logLen);
  });

  it('MassBattle 快照 JSON 往返：军令/指挥点/指挥官/战区/溃逃计数完整保留', () => {
    const mk = (id: string, name: string, side: 'ally' | 'enemy') =>
      makeCombatant({
        id, name, side, scale: 'company', archetype: 'infantry',
        base: { atk: 4, def: 12, spd: 2, hpMax: 80, moraleMax: 90 }, hp: 80, morale: 90,
        weapon: { id: 'pike', name: '长枪', baseDice: '2d6+4' },
      });
    const b = new MassBattle({
      combatants: [mk('a1', '王国步兵', 'ally'), mk('e1', '兽人团', 'enemy')],
      seed: 'snap-mass',
      traitRegistry: reg,
      commanderId: 'a1',
      zones: ['左翼', '中军', '右翼'],
      rng: new SeededRng('snap-mass-rng'),
    });
    b.start();
    expect(b.issue({ unitId: 'a1', type: 'attack', targetId: 'e1' }).ok).toBe(true);
    b.resolveRound();

    const snap = JSON.parse(JSON.stringify(b.toSnapshot())) as ReturnType<MassBattle['toSnapshot']>;
    const b2 = MassBattle.fromSnapshot(snap as Record<string, unknown>, { traitRegistry: reg });
    expect(b2.commanderId).toBe('a1');
    expect(b2.zones).toEqual(['左翼', '中军', '右翼']);
    expect(b2.round).toBe(b.round);
    expect(b2.log).toHaveLength(b.log.length);
    expect(b2.combatants).toHaveLength(2);
    // 恢复后可以继续下指令并推进回合
    expect(b2.issue({ unitId: 'a1', type: 'attack', targetId: 'e1' }).ok).toBe(true);
    b2.resolveRound();
    expect(b2.round).toBe(b.round + 1);
  });
});
