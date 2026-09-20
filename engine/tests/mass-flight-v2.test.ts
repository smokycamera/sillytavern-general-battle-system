import { describe, expect, it } from 'vitest';
import { generateUnit, MassBattle, formationNode, traitRegistry, V2_TW, type Combatant } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], traits: string[] = [], weaponClass: 'sword' | 'bow' = 'sword') {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass, weaponLevel: 3, armorTier: 1, traits }, { registry, seed: id, noVariance: true }).unit; u.id = id; return u;
}
function battle() {
  const a = unit('a', 'ally', ['flying']), b = unit('b', 'enemy'), rear = unit('rear', 'enemy'); rear.tags.push('rank:rear');
  const battle = new MassBattle({ rules: V2_TW, combatants: [a, b, rear], seed: 'mass-flight', rng: { seed: 'hit', next: () => 0, d: (n) => n } }); battle.start();
  return { a, b, rear, battle };
}
function holdEnemies(b: MassBattle) { for (const u of b.combatants.filter((u) => u.side === 'enemy' && !b.isAttached(u.id))) b.issue({ unitId: u.id, type: 'hold' }); }
describe('会战飞行空域与地面任务', () => {
  it('AI在己方地面前线拥挤时用空域跨线，下一轮选择合法落地扑击', () => {
    const a = unit('a', 'ally', ['flying']), b = unit('b', 'enemy'), ground = [unit('g1', 'ally'), unit('g2', 'ally'), unit('g3', 'ally')];
    const battle0 = new MassBattle({ rules: V2_TW, combatants: [a, b, ...ground], seed: 'air-ai' }); battle0.start();
    for (const u of ground) battle0.issue({ unitId: u.id, type: 'hold' }); battle0.autoOrders('ally'); expect(battle0.orders.get(a.id)?.type).toBe('rank-forward');
    holdEnemies(battle0); battle0.resolveRound(1); expect(formationNode(a).side).toBe('enemy'); expect(a.airborne).toBe(true);
    for (const u of ground) battle0.issue({ unitId: u.id, type: 'hold' }); battle0.autoOrders('ally'); expect(battle0.orders.get(a.id)?.type).toBe('attack');
    holdEnemies(battle0); battle0.resolveRound(2); expect(a.airborne).toBe(false);
  });
  it('空地分别容纳，两个合法降落意图挤占最后一个地面容量时同时拒绝', () => {
    const a = unit('a', 'ally', ['flying']), c = unit('c', 'ally', ['flying']), ground = [unit('g1', 'ally'), unit('g2', 'ally')], b = unit('b', 'enemy');
    const battle0 = new MassBattle({ rules: V2_TW, combatants: [a, c, ...ground, b], seed: 'air-capacity' }); expect(() => battle0.start()).not.toThrow();
    expect(battle0.issue({ unitId: a.id, type: 'land' }).ok).toBe(true); expect(battle0.issue({ unitId: c.id, type: 'land' }).ok).toBe(true); holdEnemies(battle0);
    battle0.resolveRound(1); expect(a.airborne).toBe(true); expect(c.airborne).toBe(true); expect(a.fatigue).toBe(0); expect(c.fatigue).toBe(0);
    expect(battle0.log.filter((e) => e.text.includes('同层冲突'))).toHaveLength(2);
  });
  it('起飞占主任务并触发已有反应，同一敌人不会因两个起飞重复反击', () => {
    const a = unit('a', 'ally', ['flying']), c = unit('c', 'ally', ['flying']), b = unit('b', 'enemy');
    const battle0 = new MassBattle({ rules: V2_TW, combatants: [a, c, b], seed: 'takeoff' }); battle0.start();
    battle0.issue({ unitId: a.id, type: 'land' }); battle0.issue({ unitId: c.id, type: 'land' }); holdEnemies(battle0); battle0.resolveRound(1);
    battle0.issue({ unitId: a.id, type: 'takeoff' }); battle0.issue({ unitId: c.id, type: 'takeoff' }); holdEnemies(battle0); battle0.resolveRound(2);
    expect(a.airborne).toBe(true); expect(c.airborne).toBe(true); expect(battle0.log.filter((e) => e.text.includes('起飞借机'))).toHaveLength(1);
    expect(battle0.previousOrders.has(a.id)).toBe(false); expect(a.fatigue).toBe(1);
  });
  it('飞行到期在后排无落点时受损撤出，来源与伤亡不会被重开刷新', () => {
    const a = unit('a', 'ally'); a.traitSources = [{ id: 'flight-source', name: '风神庇护', kind: 'blessing', traitIds: ['flying'], duration: { kind: 'rounds', count: 1 }, remaining: 1 }];
    const enemies = [['front', '中军'], ['rear', '中军'], ['reserve', '中军'], ['rear', '左翼'], ['rear', '右翼']].map(([rank, wing], i) => { const u = unit('e' + i, 'enemy'); u.tags.push('rank:' + rank, 'zone:' + wing); return u; });
    const battle0 = new MassBattle({ rules: V2_TW, combatants: [a, ...enemies], seed: 'expiry' }); battle0.start(); battle0.issue({ unitId: a.id, type: 'rank-forward' }); holdEnemies(battle0); battle0.resolveRound(1);
    expect(a.hp).toBe(450); expect(a.status).toBe('fled'); expect(a.airborne).toBe(false); expect(a.traitSources[0]!.remaining).toBe(0);
    const restored = MassBattle.fromSnapshot(JSON.parse(JSON.stringify(battle0.toSnapshot()))); expect(restored.byId(a.id).hp).toBe(450); expect(restored.byId(a.id).traitSources![0]!.remaining).toBe(0);
  });
  it('控制致命坠落归属施法者，重复阶段不能重复记经验', () => {
    const a = unit('a', 'ally'), b = unit('b', 'enemy', ['flying']); b.hp = 40;
    const expectedCasualtyXp = b.hp * b.xpValue!;
    a.abilities = [{ id: 'ground', name: '震慑', target: 'enemy', range: { metric: 'grid', min: 0, max: 5 }, effects: [{ op: 'condition', conditionId: 'stunned', dur: 2 }] }]; a.preparedAbilityIds = ['ground'];
    const battle0 = new MassBattle({ rules: V2_TW, combatants: [a, b], seed: 'fall-xp' }); battle0.start(); battle0.useAbility(a.id, 'ground', b.id); holdEnemies(battle0); battle0.resolveRound(1);
    expect(b.hp).toBe(0); expect(b.status).toBe('dead'); expect(battle0.xpByUnit.get(a.id)).toBe(expectedCasualtyXp); const xp = battle0.xpGained;
    expect(() => battle0.resolveRound(1)).toThrow(); expect(battle0.xpGained).toBe(xp);
  });
  it('空中溃逃和正常撤离不等于失能，不凭空追加坠落伤亡', () => {
    for (const retreat of [false, true]) {
      const { a, battle: battle0 } = battle(); if (!retreat) a.morale = 0;
      battle0.issue({ unitId: a.id, type: retreat ? 'retreat' : 'hold' }); holdEnemies(battle0); battle0.resolveRound(1);
      expect(a.hp).toBe(500); expect(a.status).toBe(retreat ? 'fled' : 'routing'); expect(MassBattle.fromSnapshot(JSON.parse(JSON.stringify(battle0.toSnapshot()))).byId(a.id).hp).toBe(500);
    }
  });
  it('真实飞行跨过地面前线进入敌方后排空域，不控制地面战线或消耗额外主任务', () => {
    const { a, b, battle: battle0 } = battle(); expect(a.airborne).toBe(true);
    expect(battle0.issue({ unitId: b.id, type: 'attack', targetId: a.id }).reason).toMatch(/空中/);
    expect(battle0.orderPreview({ unitId: a.id, type: 'rank-forward' }).destination?.id).toBe('enemy:中军:rear');
    battle0.issue({ unitId: a.id, type: 'rank-forward' }); holdEnemies(battle0); battle0.resolveRound(1);
    expect(formationNode(a).id).toBe('enemy:中军:rear'); expect(a.airborne).toBe(true); expect(a.fatigue).toBe(0.5);
    expect(battle0.frontControl['中军']).toBe('enemy');
    const snapshot = JSON.stringify(battle0.toSnapshot()); const restored = MassBattle.fromSnapshot(JSON.parse(snapshot)); restored.start(); expect(JSON.stringify(restored.toSnapshot())).toBe(snapshot);
  });
  it('后排扑击必须找到相邻地面落点，实际落地后攻击并支付额外疲劳', () => {
    const { a, rear, battle: battle0 } = battle();
    battle0.issue({ unitId: a.id, type: 'rank-forward' }); holdEnemies(battle0); battle0.resolveRound(1);
    const order = { unitId: a.id, type: 'attack' as const, targetId: rear.id }, before = JSON.stringify(battle0.toSnapshot());
    const preview = battle0.orderPreview(order); expect(preview.reason).toBeUndefined(); expect(preview.landing).toBeDefined(); expect(preview.extraFatigue).toBe(1);
    expect(JSON.stringify(battle0.toSnapshot())).toBe(before); const hp = rear.hp;
    battle0.issue(order); holdEnemies(battle0); battle0.resolveRound(2);
    expect(a.airborne).toBe(false); expect(formationNode(a).id).toBe(preview.landing!.id); expect(rear.hp).toBeLessThan(hp); expect(a.fatigue).toBe(1.5);
    const record = unitRecordFromCombatant(a); expect(record.snapshot?.formationPosition).toBeUndefined(); expect(record.snapshot?.airborne).toBeUndefined();
    expect(formationNode(materializeUnitRecord(record, registry)).id).toBe('ally:中军:front');
  });
  it('独立飞行人物可以入场，运输平台随队者共享层与位置而不获得独立飞行任务', () => {
    const carrier = unit('carrier', 'ally', ['flying']); carrier.body = 'vehicle';
    const rider = unit('rider', 'ally'); rider.scale = 'hero';
    const mage = unit('mage', 'enemy', ['flying']); mage.scale = 'hero';
    const battle0 = new MassBattle({ rules: V2_TW, combatants: [carrier, rider, mage], seed: 'air-host' }); expect(() => battle0.start()).not.toThrow();
    expect(battle0.attached.get(carrier.id)).toBe(rider.id); expect(battle0.isAttached(mage.id)).toBe(false); expect(battle0.effectiveUnit(rider).airborne).toBe(true); expect(rider.airborne).not.toBe(true);
    expect(battle0.issue({ unitId: rider.id, type: 'land' }).ok).toBe(false);
    expect(battle0.issue({ unitId: carrier.id, type: 'ability', abilityActorId: mage.id, abilityId: 'fake' }).reason).toMatch(/来源不属于/);
  });
  it('支援控制使飞行编队当阶段迫降，取消旧飞行机动且重开不再扣血', () => {
    const { a, b, battle: battle0 } = battle();
    b.abilities = [{ id: 'ground', name: '震慑', target: 'enemy', range: { metric: 'grid', min: 0, max: 5 }, effects: [{ op: 'condition', conditionId: 'stunned', dur: 2 }] }]; b.preparedAbilityIds = ['ground'];
    const preview = battle0.orderPreview({ unitId: b.id, type: 'ability', abilityId: 'ground', targetId: a.id }); expect(preview.fallDamage).toBe(50); expect(preview.forcedLanding?.id).toBe('ally:中军:front');
    battle0.issue({ unitId: a.id, type: 'rank-forward' }); holdEnemies(battle0); battle0.orders.delete(b.id); battle0.useAbility(b.id, 'ground', a.id); battle0.resolveRound(1);
    expect(a.airborne).toBe(false); expect(formationNode(a).id).toBe('ally:中军:front'); expect(a.hp).toBe(450); expect(a.fatigue).toBe(0);
    expect(MassBattle.fromSnapshot(JSON.parse(JSON.stringify(battle0.toSnapshot()))).byId(a.id).hp).toBe(450);
  });
});

