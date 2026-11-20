import { CasualtyRolls } from '../src/small/casualty-rolls.js';
import { smallRescuePercent } from '../src/trait-parameters.js';
import { V43_OVERFLOW_D20, V44_OVERFLOW_D20 } from '../src/rules.js';
import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, standardConditionMap, resolveAttack, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, attachCarriedItems, compileItem, applyHealthLoss, applyRecovery, grantTraitSource, regenerationAmount, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, side: 'ally' | 'enemy' = 'ally') {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, traits: [], weaponClass: 'sword', armorTier: 0 }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.tags.push('zone:中军', 'rank:front'); u.morale = 100; u.base.moraleMax = 100; return u;
}
const woundCount = (u: Combatant) => (u as Combatant & { recoverableWounded?: number }).recoverableWounded ?? 0;
function injure(u: Combatant) {
  const a = unit('attacker', 'enemy'); a.base.atk = 100; a.weapon!.baseDice = '1d2+20'; a.weapon!.penetration = 20;
  return resolveAttack({ attacker: a, defender: u, rules: V2_TW, conditionDefs: standardConditionMap(), rng: { seed: 'hit', next: () => 0, d: () => 2 }, traitRegistry: registry });
}
describe('可救伤兵与再生守恒', () => {
  it('实际伤亡记账，只记录本次有效损失，不推测旧缺员，未穿透不增加伤兵', () => {
    const a = unit('a'); a.hp = 70;
    const r = injure(a);
    expect(woundCount(a)).toBe(Math.floor((70 - a.hp) / 2)); expect(woundCount(a)).toBeGreaterThan(0);
    expect(a.hp + woundCount(a)).toBeLessThan(70);
    const before = structuredClone(a); const attacker = unit('enemy', 'enemy'); attacker.weapon!.penetration = 0; a.armor!.protection!.kinetic = 20;
    expect(resolveAttack({ attacker, defender: a, rules: V2_TW, conditionDefs: standardConditionMap(), rng: { seed: 'hit', next: () => 0, d: () => 2 }, traitRegistry: registry }).finalDamage).toBe(0);
    expect(woundCount(a)).toBe(woundCount(before)); expect(r.hpAfter).toBe(a.hp);
  });
  it('两模式每次固定结算至多再生三人，耗尽伤兵后不能恢复永久伤亡，重开不发放恢复', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b', 'enemy'); injure(a); a.traits = ['regen']; const hp = a.hp, pool = woundCount(a);
      if (mode === 'small') {
        const battle = new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: standardField(), traitRegistry: registry, seed: 'regen' }); battle.start();
        while (battle.active?.id !== a.id) battle.endTurn(); battle.endTurn();
        expect(a.hp).toBe(hp + 3); expect(woundCount(a)).toBe(pool - 3);
        const snap = battle.toSnapshot(); expect(SmallBattle.fromSnapshot(snap).toSnapshot()).toEqual(snap);
        for (let n = 0; n < 12 && !battle.isOver(); n++) battle.endTurn();
      } else {
        const battle = new MassBattle({ combatants: [a, b], rules: V2_TW, traitRegistry: registry, seed: 'regen' }); battle.start();
        for (let n = 0; n < 5; n++) { battle.issue({ unitId: a.id, type: 'hold' }); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(battle.round);
          if (!n) { expect(a.hp).toBe(hp + 3); expect(woundCount(a)).toBe(pool - 3); const snap = battle.toSnapshot(); expect(MassBattle.fromSnapshot(snap).toSnapshot()).toEqual(snap); }
        }
      }
      expect(a.hp).toBe(hp + pool); expect(woundCount(a)).toBe(0); expect(a.hp).toBeLessThan(500);
    }
  });
  it('物品可救已记账伤兵，预览与实际同上限，同一行动扣量，旧缺员仍拒绝', () => {
    for (const mode of ['small', 'mass']) {
      let a = unit('a'); const b = unit('b', 'enemy'); injure(a);
      const mechanics = compileItem({ kind: 'item', form: 'single', power: 3, active: 'generic:buff:heal' }, { id: 'dose', seed: 'dose' }); if (mechanics.kind !== 'item') throw new Error('fixture');
      a = attachCarriedItems(a, [{ id: 'dose', name: '急救剂', quantity: 2, revision: 1, mechanics }]);
      const hp = a.hp, pool = woundCount(a), ability = a.abilities.find((x) => x.itemSourceId)!;
      if (mode === 'small') {
        const battle = new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: standardField(), traitRegistry: registry, seed: 'triage' }); battle.start(); while (battle.active?.id !== a.id) battle.endTurn();
        const before = structuredClone(battle.toSnapshot()); const option = battle.getActionOptions(a.id).find((o) => o.id === ability.id)!;
        expect(option.targets!.find((t) => t.targetId === a.id)!.preview!.healing).toBe(Math.min(24, pool)); expect(battle.toSnapshot()).toEqual(before);
        expect(battle.useAbility(a.id, ability.id, a.id).ok).toBe(true);
      } else {
        const battle = new MassBattle({ combatants: [a, b], rules: V2_TW, traitRegistry: registry, seed: 'triage' }); battle.start();
        expect(battle.useAbility(a.id, ability.id, a.id).ok).toBe(true); expect(a.hp).toBe(hp); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(1);
      }
      expect(a.hp).toBe(hp + Math.min(24, pool)); expect(woundCount(a)).toBe(pool - Math.min(24, pool)); expect(a.resources['item:dose']).toBe(1);
    }
  });
  it('实际会战攻击只记真实减员一次，不按预览副本重复入池；阶段异常彻底回退新增字段', () => {
    const a = unit('a'), b = unit('b', 'enemy'); a.base.atk = 100; a.weapon!.penetration = 20;
    const battle = new MassBattle({ combatants: [a, b], rules: V2_TW, seed: 'actual-wounded', traitRegistry: registry }); battle.start();
    battle.issue({ unitId: a.id, type: 'attack', targetId: b.id }); battle.issue({ unitId: b.id, type: 'hold' });
    const before = structuredClone(battle.toSnapshot()); battle.orderPreview({ unitId: a.id, type: 'attack', targetId: b.id }); expect(battle.toSnapshot()).toEqual(before);
    battle.resolveRound(1); expect(woundCount(b)).toBe(Math.floor((500 - b.hp) / 2)); expect(woundCount(b)).toBeGreaterThan(0);
    const failing = MassBattle.fromSnapshot(before, { traitRegistry: registry }); const target = failing.byId('b');
    failing.conditions.register({ id: 'broken', name: '损坏测试', dot: { dice: 'not-dice' } }); target.conditions.push({ id: 'broken', dur: 2 });
    const failedBefore = structuredClone(failing.toSnapshot()); expect(() => failing.resolveRound(1)).toThrow();
    expect(failing.toSnapshot()).toEqual(failedBefore); expect(target.recoverableWounded).toBeUndefined();
  });
  it('死亡、失能与来源期限约束再生，永久和重复祝福取强，随队个人不替宿主恢复', () => {
    const host = unit('a'), enemy = unit('e', 'enemy'), officer = unit('officer'); officer.scale = 'hero'; officer.hp = 70;
    applyHealthLoss(host, 20); officer.traits = ['regen'];
    for (const id of ['first', 'duplicate']) grantTraitSource(officer, { id, name: '再生祝福', kind: 'blessing', traitIds: ['regen'], duration: { kind: 'rounds', count: 1 } });
    expect(regenerationAmount(officer)).toBe(3);
    const battle = new MassBattle({ combatants: [host, officer, enemy], rules: V2_TW, seed: 'passive', traitRegistry: registry }); battle.start();
    battle.issue({ unitId: host.id, type: 'hold' }); battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound(1);
    expect(officer.hp).toBe(73); expect(host.hp).toBe(480); expect(woundCount(host)).toBe(10);
    officer.traits = []; expect(regenerationAmount(officer)).toBe(0);
    host.traits = ['regen']; host.conditions = [{ id: 'stunned', dur: 1 }];
    battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound(2); expect(host.hp).toBe(480);
    battle.issue({ unitId: host.id, type: 'hold' }); battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound(3); expect(host.hp).toBe(483);
    for (const status of ['dying', 'dead', 'routing', 'fled'] as const) expect(regenerationAmount({ ...host, status })).toBe(0);
    applyHealthLoss(host, 9999); expect(host.hp).toBe(0); expect(woundCount(host)).toBe(0); expect(applyRecovery(host, 9999)).toBe(0);
  });
  it('坏池快照拒绝，缺字段旧战斗保持零池；AI只选择确有伤兵的治疗目标', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b', 'enemy'), target = unit('target'); a.hp = 70; target.hp = 70; applyHealthLoss(target, 20);
      delete a.weapon;
      a.abilities = [{ id: 'heal', name: '急救', target: 'ally', range: { min: 0, max: 2, metric: 'grid', allowEngaged: true }, effects: [{ op: 'heal', amount: 8 }] }]; a.preparedAbilityIds = ['heal'];
      const battle = mode === 'small' ? new SmallBattle({ combatants: [a, target, b], rules: V2_D20, battlefield: standardField(), seed: 'medic', traitRegistry: registry }) : new MassBattle({ combatants: [a, target, b], rules: V2_TW, seed: 'medic', traitRegistry: registry }); battle.start();
      const snapshot = battle.toSnapshot();
      for (const count of [-1, 0.5, 1000, '10']) { const bad = structuredClone(snapshot); ((bad.combatants as Combatant[])[0] as unknown as Record<string, unknown>).recoverableWounded = count;
        expect(() => mode === 'small' ? SmallBattle.fromSnapshot(bad as ReturnType<SmallBattle['toSnapshot']>) : MassBattle.fromSnapshot(bad as ReturnType<MassBattle['toSnapshot']>)).toThrow(/伤兵/); }
      if (battle instanceof SmallBattle) {
        battle.turnOrder = ['a', 'target', 'b']; battle.turnIndex = 0; a.pos = 43; target.pos = 44; b.pos = 22;
        battle.autoAction('a'); expect(target.hp).toBe(58); expect(a.hp).toBe(70); expect(woundCount(target)).toBe(2);
      } else {
        expect(battle.orderPreview({ unitId: 'a', type: 'ability', abilityId: 'heal', targetId: 'target' }).healing).toBe(8);
        battle.autoOrders('ally'); expect(battle.orders.get('a')).toMatchObject({ type: 'ability', targetId: 'target' });
      }
    }
  });
});

it('V43 samples individual losses once across detachments, damage packets and save/reload', () => {
  const rules = V43_OVERFLOW_D20;
  expect([0, 1, 5, 10].map(level => smallRescuePercent(level, rules.traitLevelModel))).toEqual([25, 30, 50, 70]);
  const parent = unit('company'), part = { ...parent, id: 'part', transportOrigin: parent.id };
  const stream = new CasualtyRolls('split');
  const first = stream.roll(parent, 17);
  const resumed = new CasualtyRolls('split');
  resumed.restore(stream.snapshot());
  expect(first + resumed.roll(part, 2200)).toBe(new CasualtyRolls('split').roll(parent, 2217));
  const outcomes = new Set(Array.from({ length: 100 }, (_, i) => new CasualtyRolls(String(i)).roll(parent, 2)));
  expect(outcomes).toEqual(new Set([0, 1, 2]));

  const battle = new SmallBattle({rules, seed: 'recoveries', combatants: [parent, unit('enemy', 'enemy')], battlefield: standardField()});
  battle.start();
  function injureNine(b: SmallBattle) {
    const [target, carrier] = b.combatants;
    const f = target!.formation!;
    f.health = [{hp: 1, count: 9}, {hp: f.memberHp, count: target!.hp - 9}];
    b.transportInjury(target!, carrier!, '摔落');
  }
  injureNine(battle);
  const snapshot = structuredClone(battle.toSnapshot());
  expect(snapshot.casualtyCursors).toEqual([[JSON.stringify([parent.id, 25]), 9]]);
  const replay = SmallBattle.fromSnapshot(snapshot);
  injureNine(battle); injureNine(replay);
  expect(replay.toSnapshot().casualtyCursors).toEqual(battle.toSnapshot().casualtyCursors);
  expect(woundCount(replay.combatants[0]!)).toBe(woundCount(parent));
  const before = woundCount(parent), progress = battle.toSnapshot().casualtyCursors;
  battle.setNonLethal(true); injureNine(battle);
  expect(woundCount(parent)).toBe(before + 9);
  expect(battle.toSnapshot().casualtyCursors).toEqual(progress);
});

it('keeps previous and newly rolled wounded at zero in V44, including after settlement and reload', () => {
  for (const rules of [V43_OVERFLOW_D20,V44_OVERFLOW_D20]) {
    const target = unit('troops'), enemy = unit('enemy','enemy');
    const b = new SmallBattle({rules,seed:'last-group',combatants:[target,enemy],battlefield:standardField()});
    b.start();
    target.hp = target.formation!.members = 64;
    target.formation!.health = [{hp:1,count:64}]; target.recoverableWounded = 9;
    const expected = rules.rescueAtZero ? 9 + new CasualtyRolls(b.seed).roll(target,64) : 0;
    b.transportInjury(target,enemy,'摔落');
    b.finalizeCasualties();
    expect(target).toMatchObject({hp:0,status:expected ? 'dying' : 'dead',recoverableWounded:expected});
    const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    expect(restored.byId(target.id)).toMatchObject({hp:0,status:target.status,recoverableWounded:expected});
  }
});
