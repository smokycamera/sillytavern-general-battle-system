import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, compileItem, previewAttack, resolveAttack, standardConditionMap, traitRegistry,
  V38_OVERFLOW_D20, V39_OVERFLOW_D20, V39_OVERFLOW_TW, SmallBattle, MassBattle, standardField, SeededRng, compileSkill, type Combatant, type GenerateInput } from '../src/index.js';
import { grantBarrier, barrierAmount, absorbBarrier, decayBarrier, prepareBarrierModel, barrierDefensePower, barrierSourceKey, validateBarrier } from '../src/barrier.js';
import { applyDamagePlan } from '../src/recovery.js';
import { overmatchMultiplier } from '../src/power-anchors.js';
import { memberHealth } from '../src/member-health.js';
import { grantTraitSource, expireTraitSources } from '../src/trait-sources.js';
import { applyDispel } from '../src/skill-effects.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';

const registry = traitRegistry(), definitions = standardConditionMap();
function unit(id = 'd', patch: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'enemy' : 'ally', scale: 'hero', level: 3, hpMax: 1000, numericModel: 'graded-v1', loadModel: 'capacity-v2',
    rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'rifle', weaponLevel: 4, traits: [], ...patch }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, V39_OVERFLOW_D20); prepareArmsModel(u, V39_OVERFLOW_D20); return u;
}
function energy(u: Combatant): void {
  const item = compileItem({ kind: 'shield', mechanism: 'energy-shield', power: 3 }, { id: 'energy', seed: 'energy' });
  if (item.kind !== 'shield') throw Error('fixture'); u.shield = item.value; prepareArmsModel(u, V39_OVERFLOW_D20); u.energyShield!.remaining = 10;
}

describe('V39 独立屏障容量与联动', () => {
  it('独立容量相加、只扣一份伤害，同规格先消耗早到期层；同源取强刷新', () => {
    const d = unit(); grantBarrier(d, 30, 1, 'one', 3); grantBarrier(d, 20, 4, 'two', 3);
    expect(barrierAmount(d)).toBe(50); expect(absorbBarrier(d, 10)).toBe(0); expect(barrierAmount(d)).toBe(40);
    expect(d.barrier!.grants!.map(g => g.remaining)).toEqual([20, 20]);
    grantBarrier(d, 15, 5, 'one', 3); expect(barrierAmount(d)).toBe(40);
    expect(d.barrier!.grants!.find(g => g.sourceId === 'one')!.duration).toBe(5);
    grantBarrier(d, 10, 2, 'one', 3, 'different-skill'); expect(barrierAmount(d)).toBe(50);
    expect(() => validateBarrier(d.barrier)).not.toThrow();
  });

  it('同规格拆成多层不通过反复取整增加防护，同总容量的结果一致', () => {
    const one = unit(), many = unit(); grantBarrier(one, 20, 3, 'one', 3);
    for (let n = 0; n < 20; n++) grantBarrier(many, 1, 3, 'thin-' + n, 3);
    expect(absorbBarrier(many, 100, 1, () => .3)).toBe(absorbBarrier(one, 100, 1, () => .3));
    expect(barrierAmount(one)).toBe(barrierAmount(many));
  });

  it('短高阶薄盾耗尽后低阶层使用自己的规格，不能借走高阶防护', () => {
    const d = unit('d', { level: 1, hpMax: 6000 });
    grantBarrier(d, 10, 1, 'high', 9); grantBarrier(d, 100, 4, 'low', 1);
    const high = d.barrier!.grants!.find(g => g.sourceId === 'high')!.remaining, low = d.barrier!.grants!.find(g => g.sourceId === 'low')!.remaining;
    const context = { power: 5, channel: 'kinetic' as const, penetration: 11, area: false, canBlock: false,
      multiplier: overmatchMultiplier(5, d, 'kinetic', 11, false, false, false, V39_OVERFLOW_D20.overmatchCurve), curve: V39_OVERFLOW_D20.overmatchCurve };
    const highRatio = overmatchMultiplier(5, d, 'kinetic', 11, false, false, 9, context.curve) / context.multiplier;
    const incoming = Math.ceil(high / highRatio + low * 2);
    const before = memberHealth(d), loss = applyDamagePlan(d, { direct: incoming, targets: 1, overmatch: context });
    expect(loss.direct).toBeGreaterThan(0); expect(loss.direct).toBe(before - memberHealth(d));
    expect(d.barrier).toBeUndefined();
    const borrowed = unit('d', { level: 1, hpMax: 6000 });
    borrowed.barrier = { remaining: high + low, duration: 4, defenses: [{ power: 9, duration: 4 }] };
    expect(applyDamagePlan(borrowed, { direct: incoming, targets: 1, overmatch: context }).direct).toBeLessThan(loss.direct);
  });

  it.each(['hero', 'company'] as const)('%s屏障先吸收直击/溅射，再扣能量盾，剩余生命仅扣一次', scale => {
    const d = unit('d', { scale, hpMax: scale === 'company' ? 20 : 1000 }); energy(d);
    grantBarrier(d, 30, 2, 'one', 3); grantBarrier(d, 20, 3, 'two', 3);
    const before = memberHealth(d), result = applyDamagePlan(d, { direct: 40, incomingDirect: 40, targets: 1, splash: 40, incomingSplash: 40, splashTargets: 1, energyRatio: 1 });
    expect(result.energyAbsorbed).toBe(10); expect(result.energySpent ?? result.energyAbsorbed).toBe(10);
    expect(result.direct + result.splash).toBe(20); expect(before - memberHealth(d)).toBe(20);
    expect(d.energyShield!.remaining).toBe(0); expect(d.barrier).toBeUndefined();
  });

  it('屏障全挡重击时能量盾不消耗、不发生过载；直击被全挡只让溅射触及能量盾', () => {
    const d = unit('d', { scale: 'company', hpMax: 20 }); energy(d); d.energyShield!.remaining = 100;
    grantBarrier(d, 100, 3, 'full', 3);
    const before = structuredClone(d.energyShield);
    const full = applyDamagePlan(d, { direct: 40, targets: 2, splash: 40, splashTargets: 1, heavy: true, energyRatio: 2 });
    expect(full.direct + full.splash).toBe(0); expect(full.energyAbsorbed).toBeUndefined(); expect(d.energyShield).toEqual(before); expect(barrierAmount(d)).toBe(20);
    const partial = unit('d', { scale: 'company', hpMax: 20 }); energy(partial); partial.energyShield!.remaining = 100;
    grantBarrier(partial, 50, 3, 'partial', 3);
    const hit = applyDamagePlan(partial, { direct: 40, targets: 2, splash: 40, splashTargets: 1, heavy: true, energyRatio: 2 });
    expect(hit.energyOverloaded).toBe(1); expect(partial.energyShield!.overloaded).toBe(1);
    const legacy = unit(); energy(legacy); prepareBarrierModel(legacy, V38_OVERFLOW_D20); grantBarrier(legacy, 100, 3, 'old', 3);
    expect(applyDamagePlan(legacy, { direct: 20, targets: 1 }).energyAbsorbed).toBe(10);
    expect(legacy.energyShield!.remaining).toBe(0); expect(barrierAmount(legacy)).toBe(90);
  });

  it.each(['hero','company'] as const)('%s屏障后的跨级能量盾换算保留实际耗盾，生命最终取整并能保存', scale => {
    const d = unit('d', { scale, hpMax: scale === 'company' ? 20 : 1000 }); energy(d); d.energyShield!.remaining = 1; grantBarrier(d, 1, 3, 'thin', 3);
    const before = memberHealth(d), hit = applyDamagePlan(d, { direct: 20, targets: 1, energyRatio: 2/3 });
    expect(hit.energySpent).toBe(1); expect(hit.energyAbsorbed).toBe(1.5); expect(hit.direct).toBe(18); expect(memberHealth(d)).toBe(before - 18);
    expect(memberHealth(combatantFromUnknown(JSON.parse(JSON.stringify(d))))).toBe(memberHealth(d));
  });

  it('重击过载与跨级耗盾保持原能量盾结果，屏障只接收未被能量盾吸收的份额', () => {
    const d = unit('d', { scale: 'company', hpMax: 20 }); energy(d); d.energyShield!.remaining = 100;
    const plain = structuredClone(d), plan = { direct: 60, incomingDirect: 60, targets: 2, splash: 40, incomingSplash: 40, splashTargets: 1, heavy: true as const, energyRatio: 2 };
    grantBarrier(d, 10, 3, 'one', 3); grantBarrier(d, 20, 3, 'two', 3);
    const a = applyDamagePlan(d, plan), b = applyDamagePlan(plain, plan);
    expect(a.energySpent).toBe(b.energySpent); expect(a.energyAbsorbed).toBe(b.energyAbsorbed); expect(a.energyOverloaded).toBe(b.energyOverloaded);
    expect(a.direct + a.splash + (30 - barrierAmount(d))).toBe(b.direct + b.splash);
    expect(d.energyShield).toEqual(plain.energyShield);
  });

  it('V38快照保留取强；旧剧情来源进入V39只保留旧有效容量，期限仍各自有效', () => {
    const d = unit(); prepareBarrierModel(d, V38_OVERFLOW_D20);
    for (const [id, amount, count] of [['one',30,1], ['two',20,3]] as const) {
      grantTraitSource(d, { id, name: id, kind: 'effect', traitIds: [], conditionIds: [], conditions: [], specification: '屏障:buffL3+屏障L3', barrier: { amount, defensePower: 3 }, duration: { kind: 'rounds', count } });
      grantBarrier(d, amount, count, id, 3);
    }
    const frozen = combatantFromUnknown(JSON.parse(JSON.stringify(d))); expect(barrierAmount(frozen)).toBe(30);
    expect(frozen.barrier!.stacking).toBeUndefined(); absorbBarrier(frozen, 10); expect(barrierAmount(frozen)).toBe(20);
    prepareBarrierModel(d, V39_OVERFLOW_D20); expect(barrierAmount(d)).toBe(30);
    grantBarrier(d, 20, 4, 'new', 3); expect(barrierAmount(d)).toBe(50);
    absorbBarrier(d, 10); expect(barrierAmount(d)).toBe(40);
    expireTraitSources(d, 'rounds'); expect(barrierAmount(d)).toBe(30);
    expect(combatantFromUnknown(JSON.parse(JSON.stringify(d))).barrier).toEqual(d.barrier);
  });

  it.each(['small', 'mass'] as const)('%s新战斗保存/读回分层与能量盾，不刷新余额；驱散只移除技能屏障', mode => {
    const body = mode === 'mass' ? 'vehicle' : 'human', d = unit('d', { body }), a = unit('a', { body }); energy(d);
    const battle = mode === 'small' ? new SmallBattle({ combatants: [d,a], rules: V39_OVERFLOW_D20, battlefield: standardField(), seed: 'layers' })
      : new MassBattle({ combatants: [d,a], rules: V39_OVERFLOW_TW, seed: 'layers' });
    battle.start(); grantBarrier(d, 30, 2, 'one', 3); grantBarrier(d, 20, 4, 'two', 3); absorbBarrier(d, 7);
    const snapshot = battle.toSnapshot(), restored = mode === 'small' ? SmallBattle.fromSnapshot(snapshot) : MassBattle.fromSnapshot(snapshot);
    const u = restored.byId('d'); expect(u.barrier).toEqual(d.barrier); expect(u.energyShield).toEqual(d.energyShield);
    const energyBefore = structuredClone(u.energyShield); applyDispel(u, [{ kind: 'barrier', id: 'barrier', name: '屏障' }]);
    expect(u.barrier).toBeUndefined(); expect(u.energyShield).toEqual(energyBefore);
  });

  it('同机制改名不复制来源，实物身份独立；短高阶到期不能被长低阶续期', () => {
    const d = unit();
    expect(barrierSourceKey('a', { id: 'old-name', definitionId: 'same' })).toBe(barrierSourceKey('a', { id: 'new-name', definitionId: 'same' }));
    expect(barrierSourceKey('a', { id: 'spell', itemSourceId: 'wand-one' })).not.toBe(barrierSourceKey('a', { id: 'spell', itemSourceId: 'wand-two' }));
    grantBarrier(d, 10, 1, 'high', 9); grantBarrier(d, 20, 4, 'low', 3); decayBarrier(d);
    expect(barrierAmount(d)).toBe(20); expect(barrierDefensePower(d)).toBe(3);
    const bad = structuredClone(d.barrier)!; bad.remaining++;
    expect(() => validateBarrier(bad)).toThrow(/容量/);
  });

  it.each(['small', 'mass'] as const)('%s真实施放允许另一施术者追加屏障，候选与执行都保留独立来源', mode => {
    const body = mode === 'mass' ? 'vehicle' : 'human', d = unit('d', { body }), e = unit('e', { body }), a = unit('a', { body });
    for (const caster of [d,e]) {
      const skill = compileSkill('generic:buff:barrier', 3, caster.id, 'skills-v4'); caster.abilities = [skill]; caster.preparedAbilityIds = [skill.id]; caster.resources.SP = 100;
    }
    const battle = mode === 'small' ? new SmallBattle({ combatants: [d,e,a], rules: V39_OVERFLOW_D20, battlefield: standardField(), seed: 'cast-layers' })
      : new MassBattle({ combatants: [d,e,a], rules: V39_OVERFLOW_TW, seed: 'cast-layers' });
    battle.start();
    if (battle instanceof SmallBattle) { battle.turnOrder = ['d','e','a']; battle.turnIndex = 0; d.pos = 21; e.pos = 22; a.pos = 29; }
    expect(battle.useAbility(d.id, d.abilities[0]!.id, d.id).ok).toBe(true);
    if (battle instanceof SmallBattle) battle.endTurn();
    expect(battle.useAbility(e.id, e.abilities[0]!.id, d.id).ok).toBe(true);
    if (battle instanceof MassBattle) { battle.issue({ unitId: a.id, type: 'hold' }); battle.resolveRound(); }
    expect(d.barrier!.grants!.filter(g => !g.legacy)).toHaveLength(2);
    expect(barrierAmount(d)).toBe(d.barrier!.grants!.reduce((sum,g) => sum + g.remaining, 0));
  });

  it.each([['none','rifle'], ['energy','rifle'], ['shield','rifle'], ['energy','cannon'], ['energy','sprayer'], ['legacy','rifle']] as const)('%s、%s与多层屏障的连射预览和96种子实际逐段结算一致，不污染原件', (shield, mechanism) => {
    const d = unit('d', { scale: 'company', hpMax: 20 }), a = unit('a', { scale: 'company', hpMax: 20 });
    if (mechanism !== 'rifle') {
      const weapon = compileItem({ kind: 'weapon', mechanism, power: 4 }, { id: mechanism, seed: mechanism });
      if (weapon.kind !== 'weapon') throw Error('fixture'); a.weapon = weapon.value; prepareArmsModel(a, V39_OVERFLOW_D20);
    }
    if (shield === 'energy') { energy(d); d.energyShield!.remaining = 3; }
    else if (shield === 'shield') {
      const item = compileItem({ kind: 'shield', mechanism: 'shield', power: 3 }, { id: 'solid', seed: 'solid' });
      if (item.kind !== 'shield') throw Error('fixture'); d.shield = item.value; prepareArmsModel(d, V39_OVERFLOW_D20); d.shieldDurability!.remaining = 2;
    } else if (shield === 'legacy') {
      prepareBarrierModel(d, V38_OVERFLOW_D20);
      for (const [id,amount,power] of [['old-high',1,5], ['old-low',20,3]] as const) {
        grantTraitSource(d, { id, name:id, kind:'effect', traitIds:[], conditions:[], conditionIds:[], specification:`旧盾:buffL${power}+屏障L${power}`, barrier:{amount,defensePower:power}, duration:{kind:'rounds',count:4} });
        grantBarrier(d, amount, 4, id, power);
      }
      prepareBarrierModel(d, V39_OVERFLOW_D20);
      const weapon = compileItem({ kind:'weapon', mechanism:'rifle', power:7 }, {id:'legacy-shot',seed:'legacy-shot'});
      if(weapon.kind!=='weapon')throw Error('fixture'); a.weapon=weapon.value; a.weapon.damageScale=(a.weapon.damageScale??1)*.02;
    }
    const attacks = shield === 'legacy' ? 5 : 3;
    a.weapon!.attacks = attacks; grantBarrier(d, 3, 2, 'one', 4); grantBarrier(d, 4, 4, 'two', 2);
    const opts = { attacker: a, defender: d, rules: V39_OVERFLOW_D20, conditionDefs: definitions, traitRegistry: registry, ranged: true, distance: 4 };
    const before = JSON.stringify(opts), preview = previewAttack(opts); let total = 0;
    for (let n = 0; n < 96; n++) {
      const attacker = structuredClone(a), defender = structuredClone(d), hp = memberHealth(defender), rng = new SeededRng('barrier-preview:' + n);
      for (let i = 0; i < attacks && defender.hp > 0; i++) resolveAttack({ ...opts, attacker, defender, rng });
      total += hp - memberHealth(defender);
    }
    expect(preview.expectedDamage).toBe(total / 96); expect(JSON.stringify(opts)).toBe(before); expect(previewAttack(opts)).toEqual(preview);
  });
});
