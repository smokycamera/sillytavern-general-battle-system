import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V38_OVERFLOW_D20, V38_OVERFLOW_TW, prepareCombatModel, type Combatant } from '../../engine/src/index.js';
import { expireRoundEffects } from '../../engine/src/effect-expiry.js';
import { expireTraitSources, traitSourceActive } from '../../engine/src/trait-sources.js';
import { settleStoryRoundEndEffects } from '../../engine/src/round-end-effects.js';
import { resolveHealingBudget } from '../../engine/src/healing.js';
import { spCapacity } from '../../engine/src/resources.js';
import { applyDispel, dispelCandidates } from '../../engine/src/skill-effects.js';
import { grantStoryEffects } from './story-effects.js';
import { parseAbilitySpec, parseEffectAttributes } from './tags.js';
import { parseProtocol } from './protocol.js';
import { clearUnitEffects } from './unit-clear.js';
import { materializeUnitRecord, migratePanelUnits, unitRecordFromCombatant, commitBattleOutcome } from './unit-state.js';
import { narrativeProjection } from './narrative-controller.js';

const registry = traitRegistry();
function unit(id = 'a', scale: 'hero' | 'company' = 'hero', body: 'human' | 'vehicle' = 'human'): Combatant {
  const u = generateUnit({ name: id, side: id === 'b' ? 'enemy' : 'ally', scale, level: 3, hpMax: scale === 'company' ? 20 : 100,
    body, rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'sword', traits: [] }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, V38_OVERFLOW_D20); return u;
}
function grant(u: Combatant, text: string, rounds = 2, id = 'round-test') {
  grantStoryEffects(u, parseAbilitySpec(text), { kind: 'rounds', count: rounds }, id);
}
function finishRound(battle: SmallBattle | MassBattle): void {
  if (battle instanceof SmallBattle) {
    const round = battle.round;
    for (let n = 0; battle.round === round && n < 12; n++) battle.endTurn();
    expect(battle.round).toBe(round + 1);
  } else {
    for (const u of battle.combatants) if (u.status === 'ready') battle.issue({ unitId: u.id, type: 'hold' });
    battle.resolveRound();
  }
}

describe('剧情效果每轮末触发', () => {
  it('解析全部七种轮末效果及三种期限，入账和读档不提前结算', () => {
    for (const spec of ['buffL3+治疗L3', 'buffL3+士气L3', 'debuffL3+士气L3', 'buffL3+回能L3', 'debuffL3+耗能L3', 'buffL3+净化L3', 'debuffL3+驱散L3']) {
      for (const duration of ['rounds="2"', 'battles="2"', 'permanent="true"']) expect(parseProtocol(`<effect id="a" effects="来源:${spec}" ${duration}/>`).errors, spec).toEqual([]);
    }
    const u = unit(); u.hp = 1; u.resources.SP = 0; u.conditions = [{ id: 'bleeding', dur: 3 }];
    grant(u, '疗养:buffL3+治疗L3+回能L3+士气L3+净化L3');
    expect(u.hp).toBe(1); expect(u.resources.SP).toBe(0); expect(u.moraleState).toBeUndefined(); expect(u.conditions[0]!.id).toBe('bleeding');
    const record = unitRecordFromCombatant(u), saved = JSON.parse(JSON.stringify(record));
    expect(migratePanelUnits({ storage: [saved], registry }).warnings).toEqual([]);
    const loaded = materializeUnitRecord(saved, registry);
    expect(loaded.hp).toBe(1); expect(loaded.conditions[0]!.id).toBe('bleeding'); expect(loaded.moraleState).toBeUndefined();
    expect(loaded.traitSources).toEqual(u.traitSources);
    const context = narrativeProjection({ storage: [record], rosterIds: ['a'] });
    for (const word of ['治疗L3', '回能L3', '士气L3', '净化L3']) expect(context).toContain(word);
  });

  it.each(['small', 'mass'] as const)('%s完整轮边界才触发，读快照不触发，最后一轮先触发再到期', mode => {
    const body = mode === 'mass' ? 'vehicle' : 'human';
    const a = unit('a', 'hero', body), b = unit('b', 'hero', body); a.hp = 1; a.resources.SP = 0;
    grant(a, '轮末疗养:buffL1+治疗L1+回能L1+士气L1');
    let battle: SmallBattle | MassBattle = mode === 'small'
      ? new SmallBattle({ rules: V38_OVERFLOW_D20, battlefield: standardField(), combatants: [a, b], seed: 'round-heal' })
      : new MassBattle({ rules: V38_OVERFLOW_TW, combatants: [a, b], seed: 'round-heal' });
    battle.start();
    if (battle instanceof SmallBattle) {
      battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; battle.endTurn();
      expect(a.hp).toBe(1); expect(battle.log.some(l => l.text.includes('轮末疗养：'))).toBe(false);
    }
    finishRound(battle);
    const healed = a.hp, sp = a.resources.SP;
    expect(healed).toBeGreaterThan(1); expect(sp).toBeGreaterThan(0); expect(a.traitSources![0]!.remaining).toBe(1);
    const snap = battle.toSnapshot();
    battle = battle instanceof SmallBattle ? SmallBattle.fromSnapshot(snap) : MassBattle.fromSnapshot(snap);
    expect(battle.byId('a').hp).toBe(healed); expect(battle.byId('a').resources.SP).toBe(sp);
    finishRound(battle); finishRound(battle);
    expect(battle.byId('a').hp).toBeGreaterThan(healed); expect(battle.byId('a').traitSources![0]!.remaining).toBe(0);
    expect(battle.log.filter(l => /轮末疗养：恢复/.test(l.text))).toHaveLength(2);
    expect(battle.byId('a').resources.SP).toBeLessThanOrEqual(spCapacity(battle.byId('a')));
  });

  it.each(['battles', 'permanent'] as const)('%s来源跨战斗保留，每场精力刷新后仍按轮触发', lifetime => {
    const a = unit(), b = unit('b');
    grantStoryEffects(a, parseAbilitySpec('长效回能:buffL3+回能L3'), lifetime === 'battles' ? { kind: lifetime, count: 2 } : { kind: lifetime }, 'long');
    let record = unitRecordFromCombatant(a);
    for (let n = 0; n < 2; n++) {
      const actor = materializeUnitRecord(record, registry), foe = structuredClone(b); actor.resources.SP = 0;
      const battle = new SmallBattle({ rules: V38_OVERFLOW_D20, battlefield: standardField(), combatants: [actor, foe], seed: `long-${n}` }); battle.start();
      finishRound(battle);
      expect(battle.log.some(l => l.text.includes('长效回能：精力+'))).toBe(true);
      const result = commitBattleOutcome({ battleId: `long-${n}`, committedIds: [], records: [record], roster: [actor], combatants: [actor], awards: [], registry });
      record = result.records[0]!;
      expect(materializeUnitRecord(record, registry).resources.SP).toBe(spCapacity(materializeUnitRecord(record, registry)));
      expect(record.snapshot!.traitSources![0]!.roundEndEffects).toEqual(a.traitSources![0]!.roundEndEffects);
    }
    const loaded = materializeUnitRecord(record, registry);
    expect(traitSourceActive(loaded, loaded.traitSources![0]!)).toBe(lifetime === 'permanent');
  });

  it('部分解除保留其他轮末操作与原期限，原来源重放不恢复已解除内容', () => {
    const u = unit(); grant(u, '复合疗养:buffL2+治疗L2+回能L2+士气L2', 3);
    const original = structuredClone(u.traitSources![0]!); expireTraitSources(u, 'rounds');
    clearUnitEffects(u, ['回能', '士气'], 'clear');
    const remaining = u.traitSources!.find(s => traitSourceActive(u, s))!;
    expect(remaining.remaining).toBe(2); expect(remaining.roundEndEffects!.map(e => e.op)).toEqual(['heal']);
    grant(u, '复合疗养:buffL2+治疗L2+回能L2+士气L2', 3);
    expect(u.traitSources![0]!.roundEndEffects).toEqual(original.roundEndEffects); expect(u.traitSources![0]!.revoked).toBe(true);
    expect(u.traitSources!.filter(s => traitSourceActive(u, s))).toHaveLength(1);
    clearUnitEffects(u, ['all'], 'all'); expect(settleStoryRoundEndEffects(u)).toEqual([]);
  });

  it('同类同方向每轮取强，强效到期后弱效继续；来源排序不改变结果', () => {
    const u = unit(); u.hp = 1;
    grant(u, '短强疗养:buffL4+治疗L4', 1, 'strong'); grant(u, '长弱疗养:buffL1+治疗L1', 3, 'weak');
    const reversed = structuredClone(u); reversed.traitSources!.reverse();
    const e = u.traitSources![0]!.roundEndEffects![0]!; if (e.op !== 'heal') throw Error('fixture');
    const expected = Math.floor(resolveHealingBudget({ source: u, target: u, delivery: 'zone', recoveryModel: u.recoveryModel, sourceMedicSnapshot: 1, baseAmount: e.amount, power: e.power }));
    expect(expireRoundEffects(u).filter(t => /恢复/.test(t))).toHaveLength(1); expireRoundEffects(reversed);
    expect(u.hp).toBe(1 + expected); expect(reversed.hp).toBe(u.hp);
    const healed = u.hp; expect(expireRoundEffects(u).filter(t => /长弱疗养：恢复/.test(t))).toHaveLength(1); expect(u.hp).toBeGreaterThan(healed);
  });

  it('净化/驱散可解除对应轮末来源，不移除固有能力；负向精力不能扣成负数', () => {
    const u = unit(); u.resources.SP = 1;
    grant(u, '消耗诅咒:debuffL3+耗能L3', 3, 'drain');
    expect(settleStoryRoundEndEffects(u).join('')).toContain('精力-1'); expect(u.resources.SP).toBe(0);
    grant(u, '净化来源:buffL3+净化L3', 3, 'cleanse');
    expect(settleStoryRoundEndEffects(u).join('')).toContain('解除消耗诅咒');
    expect(u.traitSources!.find(s => s.name === '消耗诅咒')!.revoked).toBe(true);
    const candidates = dispelCandidates(u, { op: 'dispel', polarity: 'positive', count: 99 });
    expect(candidates.some(c => c.name === '净化来源')).toBe(true); applyDispel(u, candidates);
    expect(settleStoryRoundEndEffects(u)).toEqual([]);
  });

  it('死者/离场者不触发，坏冻结操作隔离，旧来源不凭规格文字新增轮末能力', () => {
    const u = unit(); grant(u, '治疗来源:buffL1+治疗L1');
    for (const status of ['dead', 'fled'] as const) expect(settleStoryRoundEndEffects({ ...u, status })).toEqual([]);
    const record = unitRecordFromCombatant(u), bad = structuredClone(record);
    (bad.snapshot!.traitSources![0]!.roundEndEffects![0] as { amount: number }).amount = -1;
    const migrated = migratePanelUnits({ storage: [bad], registry }); expect(migrated.records).toEqual([]); expect(migrated.backup).toEqual([bad]);
    const old = unit(); grant(old, '旧战意:buffL3+攻击L3'); old.traitSources![0]!.specification = '旧战意:buffL3+治疗L3';
    expect(settleStoryRoundEndEffects(old)).toEqual([]);
  });
});
