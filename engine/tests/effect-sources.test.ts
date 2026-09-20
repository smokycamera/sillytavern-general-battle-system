import { describe, expect, it } from 'vitest';
import { generateUnit, grantTraitSource, revokeTraitSource, expireTraitSources, collectMods, resolveStack, previewAttack, resolveAttack, traitRegistry, standardConditionMap, standardField, SmallBattle, MassBattle, V2_D20, V2_TW, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string) {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'hero', level: 3, hpMax: 400, weaponClass: 'sword', weaponLevel: 6, traits: [] }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
function source(u: Combatant, id: string, conditionIds: string[], rounds = 2) {
  grantTraitSource(u, { id, name: id, kind: 'effect', traitIds: [], conditionIds, duration: { kind: 'rounds', count: rounds } });
}
const rng = () => ({ seed: 'hit', next: () => 0, d: (n: number) => n });
const attack = (a: Combatant, b: Combatant) => ({ attacker: a, defender: b, rules: V2_D20, conditionDefs: standardConditionMap(), traitRegistry: registry, ranged: false });

describe('通用增减益共用来源和实际结算', () => {
  it('小战与会战实际攻击采用诅咒修正，整轮到期，重开不刷新', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b'); source(a, 'curse', ['cursed'], 1);
      const before = structuredClone(a.base);
      if (mode === 'small') {
        const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: standardField(), traitRegistry: registry, rng: rng() }); battle.start();
        while (battle.active?.id !== 'a') battle.endTurn(); a.pos = 21; b.pos = 22;
        const preview = previewAttack(attack(a, b)); expect(preview.expectedDamage).toBeLessThan(previewAttack(attack({ ...a, traitSources: [] }, b)).expectedDamage);
        battle.attack('a', 'b'); expect(battle.log.find((l) => l.resolution)?.resolution?.netAtk).toBe(a.base.atk - 2);
        const round = battle.round; while (battle.round === round && !battle.isOver()) battle.endTurn();
        expect(SmallBattle.fromSnapshot(battle.toSnapshot()).byId('a').traitSources![0]!.remaining).toBe(0);
      } else {
        a.scale = b.scale = 'company'; a.tags.push('zone:中军', 'rank:front'); b.tags.push('zone:中军', 'rank:front');
        const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], traitRegistry: registry, rng: rng() }); battle.start();
        battle.issue({ unitId: 'a', type: 'attack', targetId: 'b' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === 'a')?.resolution?.netAtk).toBe(a.base.atk - 2);
        expect(MassBattle.fromSnapshot(battle.toSnapshot()).byId('a').traitSources![0]!.remaining).toBe(0);
      }
      expect(a.base).toEqual(before);
      expect(resolveAttack({ ...attack(a, b), rng: rng() }).netAtk).toBe(a.base.atk);
    }
  });
  it('同类正负效果各取强，再相加；技能状态与剧情来源不重复，撤销不会删除技能状态', () => {
    const a = unit('a'), b = unit('b');
    source(a, 'curse', ['cursed']); source(a, 'curse-copy', ['cursed']); source(a, 'fear', ['fearful']); source(a, 'blessing', ['inspired']);
    a.conditions = [{ id: 'inspired', dur: 2 }];
    expect(resolveAttack({ ...attack(a, b), rng: rng() }).netAtk).toBe(a.base.atk);
    revokeTraitSource(a, 'blessing'); expect(a.conditions).toEqual([{ id: 'inspired', dur: 2 }]);
    expect(resolveAttack({ ...attack(a, b), rng: rng() }).netAtk).toBe(a.base.atk);
    a.conditions = []; expect(resolveAttack({ ...attack(a, b), rng: rng() }).netAtk).toBe(a.base.atk - 2);
  });
  it('虚弱削弱伤害，易伤和守护都生效但各组只计一次，穿透失败仍为零', () => {
    const a = unit('a'), b = unit('b'); b.traits = ['guardian'];
    source(a, 'weakness', ['weakened']); source(b, 'vulnerability', ['vulnerable']); source(b, 'second-vulnerability', ['vulnerable']);
    const result = resolveAttack({ ...attack(a, b), rng: rng() });
    expect(result.dmgMult).toBe(0.8); expect(result.wardMult).toBeCloseTo(0.75 * 1.25);
    a.weapon!.penetration = 0; b.armor!.protection!.kinetic = 8;
    expect(resolveAttack({ ...attack(a, b), rng: rng() }).finalDamage).toBe(0);
  });
  it('低落士气参与真实会战溃逃，振奋可抵消，不溃保留免疫且不篡改基础士气', () => {
    for (const counter of ['none', 'confident', 'steadfast']) {
      const a = unit('a'), b = unit('b'); a.scale = b.scale = 'company'; a.morale = V2_TW.morale.breakAt + 10;
      a.base.moraleMax = b.base.moraleMax = 100; b.morale = 80; source(a, 'low', ['demoralized']);
      if (counter === 'confident') source(a, 'rally', ['confident']);
      if (counter === 'steadfast') a.traits = ['steadfast'];
      const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], traitRegistry: registry, rng: rng() }); battle.start();
      battle.issue({ unitId: 'a', type: 'hold' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
      expect(a.status).toBe(counter === 'none' ? 'routing' : 'ready'); expect(a.morale).toBe(V2_TW.morale.breakAt + 10);
    }
  });
  it('陌生效果和不完整执行器拒绝；到期、撤销、序列化、同来源重放不续期', () => {
    const a = unit('a'); source(a, 'one', ['demoralized'], 1); expireTraitSources(a, 'rounds');
    source(a, 'one', ['demoralized'], 1);
    expect(resolveStack(collectMods(JSON.parse(JSON.stringify(a)), {}, standardConditionMap(), [], registry), 'morale', {}).flatTotal).toBe(0);
    expect(() => source(a, 'one', ['cursed'], 1)).toThrow(/内容/);
    for (const id of ['unknown', 'stunned', 'poisoned']) expect(() => source(a, id, [id])).toThrow();
  });
  it('两种模式的AI使用同一预览，优先攻击同等条件下的易伤目标', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b'), c = structuredClone(b); c.id = 'c'; c.name = 'c';
      source(c, 'exposed', ['vulnerable']);
      if (mode === 'small') {
        const field = standardField(); field.tiles.fill('open');
        const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b, c], battlefield: field, traitRegistry: registry, rng: rng() }); battle.start();
        battle.turnOrder = ['a', 'b', 'c']; battle.turnIndex = 0; a.pos = 31; b.pos = 24; c.pos = 32; battle.movementSpent.set('a', 3);
        battle.autoAction('a'); expect(battle.log.find((l) => l.resolution?.attackerId === 'a')?.resolution?.defenderId).toBe('c');
      } else {
        for (const u of [a, b, c]) { u.scale = 'company'; u.tags.push('zone:中军', 'rank:front'); }
        const battle = new MassBattle({ rules: V2_TW, combatants: [a, b, c], traitRegistry: registry, rng: rng() }); battle.start();
        battle.autoOrders('ally'); expect(battle.orders.get('a')?.targetId).toBe('c');
      }
    }
  });
  it('同阶段光环来源先后溃逃不改变其他编队的有效士气判定', () => {
    const run = (reverse: boolean) => {
      const a = unit('a'), c = unit('c'), b = unit('b'); c.side = 'ally'; c.traits = ['commander'];
      for (const u of [a, b, c]) { u.scale = 'company'; u.base.moraleMax = 100; u.morale = 80; }
      a.morale = V2_TW.morale.breakAt + 10; c.morale = V2_TW.morale.breakAt;
      source(a, 'low', ['demoralized']);
      const battle = new MassBattle({ rules: V2_TW, combatants: reverse ? [c, a, b] : [a, c, b], traitRegistry: registry, rng: rng() }); battle.start();
      for (const u of battle.combatants) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(1);
      return [a.status, c.status];
    };
    expect(run(false)).toEqual(['ready', 'routing']); expect(run(true)).toEqual(run(false));
  });
});
