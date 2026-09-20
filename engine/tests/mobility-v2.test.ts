import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, grantTraitSource, movementPoints, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, traits: string[] = [], body: Combatant['body'] = 'human') {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'hero', level: 3, hpMax: 500, traits, body, weaponClass: 'sword', armorTier: 1, archetype: 'mobile' }, { registry, seed: id, noVariance: true }).unit; u.id = id; return u;
}
function grid(traits: string[] = []) {
  const a = unit('a', traits), b = unit('b'); const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: field, traitRegistry: registry, seed: 'move' }); battle.start();
  battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 42; b.pos = 7; return { a, b, battle };
}
describe('实际机动与疲劳', () => {
  it('体量、重甲和合法机动前提共用有界预算；多来源不无限叠移动', () => {
    expect(movementPoints(unit('a', [], 'vehicle'))).toBe(3);
    expect(movementPoints(unit('a', ['mechanized'], 'vehicle'))).toBe(4);
    expect(movementPoints(unit('a', ['mechanized']))).toBe(3);
    const a = unit('a', ['fast', 'skirmisher']); expect(movementPoints(a)).toBe(4);
    a.armor!.tier = 3; expect(movementPoints(a)).toBe(3);
    a.traits = ['skirmisher']; expect(movementPoints(a)).toBe(2);
    a.fatigue = 4; expect(movementPoints(a)).toBe(1);
  });
  it('加速来源也参与实际开战先攻，状态不能只写一个显示速度', () => {
    const first = (hasted: boolean) => {
      const a = unit('a'), b = unit('b'); b.base.spd = a.base.spd + 1;
      if (hasted) grantTraitSource(a, { id: 'haste', name: '加速', kind: 'effect', traitIds: [], conditionIds: ['hasted'], duration: { kind: 'rounds', count: 1 } });
      const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: standardField(), traitRegistry: registry, rng: { seed: 'equal', next: () => 0, d: () => 10 } }); battle.start(); return battle.active!.id;
    };
    expect(first(false)).toBe('b'); expect(first(true)).toBe('a');
  });
  it('快速增加真实可达格，移动分段不复制点数，加速减速即时改变剩余预算', () => {
    const normal = grid(), fast = grid(['fast']);
    expect(normal.battle.pathPreview('a', 14).path).toBeUndefined(); expect(fast.battle.pathPreview('a', 14).path?.cost).toBe(4);
    fast.battle.moveTo('a', 35); fast.battle.moveTo('a', 28); expect(fast.battle.movementLeft('a')).toBe(2);
    grantTraitSource(fast.a, { id: 'slow', name: '减速', kind: 'effect', traitIds: [], conditionIds: ['slowed'], duration: { kind: 'rounds', count: 2 } });
    expect(fast.battle.movementLeft('a')).toBe(1);
    grantTraitSource(fast.a, { id: 'haste', name: '加速', kind: 'effect', traitIds: [], conditionIds: ['hasted'], duration: { kind: 'rounds', count: 2 } });
    expect(fast.battle.movementLeft('a')).toBe(2);
  });
  it('连续进攻与长距离移动累积疲劳，耐力训练减半，休整恢复且快照不清账', () => {
    for (const trained of [false, true]) {
      const { a, b, battle } = grid(trained ? ['fatigue-trained'] : []); b.pos = 14;
      battle.moveTo('a', 21); battle.attack('a', 'b');
      const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry }); restored.endTurn();
      expect(restored.byId('a').fatigue).toBe(trained ? 0.25 : 0.5);
      restored.endTurn(); expect(restored.movementLeft('a')).toBe(3);
      restored.brace('a'); restored.endTurn(); expect(restored.byId('a').fatigue).toBe(0);
      expect(a.fatigue).toBe(0);
    }
  });
  it('会战快速/加速能从预备直达前线，减速禁止冲锋，满员中间阵位不能穿过', () => {
    for (const effect of ['fast', 'haste', 'blocked']) {
      const a = unit('a', effect === 'fast' || effect === 'blocked' ? ['fast'] : []), b = unit('b');
      a.scale = b.scale = 'company'; a.tags.push('rank:reserve');
      if (effect === 'haste') grantTraitSource(a, { id: 'haste', name: '加速', kind: 'effect', traitIds: [], conditionIds: ['hasted'], duration: { kind: 'rounds', count: 2 } });
      const blockers = effect === 'blocked' ? [0, 1, 2].map((n) => { const u = unit('c' + n); u.side = 'ally'; u.scale = 'company'; u.tags.push('rank:rear'); return u; }) : [];
      const battle = new MassBattle({ rules: V2_TW, combatants: [a, b, ...blockers], traitRegistry: registry, seed: 'march' }); battle.start();
      const accepted = battle.issue({ unitId: 'a', type: 'rank-forward' });
      if (effect === 'blocked') { expect(accepted.ok).toBe(false); expect(battle.rankOf(a)).toBe('reserve'); continue; }
      expect(accepted.ok).toBe(true); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1); expect(battle.rankOf(a)).toBe('front');
      grantTraitSource(a, { id: 'slow', name: '减速', kind: 'effect', traitIds: [], conditionIds: ['slowed'], duration: { kind: 'rounds', count: 2 } });
      expect(battle.issue({ unitId: 'a', type: 'charge', targetId: 'b' })).toMatchObject({ ok: false });
    }
  });
  it('会战连续射击同样产生疲劳，耐力与休整使用共同规则', () => {
    for (const trained of [false, true]) {
      const a = generateUnit({ name: '射手', side: 'ally', rulesVersion: 'v2', scale: 'company', level: 3, hpMax: 500, weaponClass: 'bow', traits: trained ? ['fatigue-trained'] : [] }, { registry, seed: 'archer', noVariance: true }).unit; a.id = 'a';
      const b = unit('b'); b.scale = 'company'; a.tags.push('rank:rear');
      const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], traitRegistry: registry, seed: 'volley-fatigue' }); battle.start();
      battle.issue({ unitId: 'a', type: 'volley', targetId: 'b' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
      expect(a.fatigue).toBe(trained ? 0.25 : 0.5);
      battle.issue({ unitId: 'a', type: 'brace' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(2); expect(a.fatigue).toBe(0);
    }
  });
  it('合法军令在阶段中因目标撤离而未执行时，不白扣计划疲劳', () => {
    const a = unit('a'), b = unit('b'); a.scale = b.scale = 'company'; a.tags.push('rank:rear'); a.fatigue = 1;
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], traitRegistry: registry, seed: 'cancelled-charge' }); battle.start();
    expect(battle.issue({ unitId: 'a', type: 'charge', targetId: 'b' }).ok).toBe(true);
    battle.issue({ unitId: 'b', type: 'retreat' }); battle.resolveRound(1);
    expect(b.status).toBe('fled'); expect(a.fatigue).toBe(0); expect(battle.log.some((l) => l.resolution?.attackerId === 'a')).toBe(false);
  });
});
