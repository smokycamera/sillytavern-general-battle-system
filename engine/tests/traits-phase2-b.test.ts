import { describe, expect, it } from 'vitest';
import { generateUnit, V17_OVERFLOW_D20, V17_OVERFLOW_TW, V16_OVERFLOW_D20, prepareCombatModel, prepareTraitModel,
  prepareItemModel, prepareTraitLevelModel, prepareSkillModel, upgradeCombatSkills, compileSkill, parseSkillMechanism,
  skillMechanismId, healingYield, healingGradeMultiplier, applyCombatDamage, recoveryCapacity, applyRecovery,
  regenerationAmount, settleRegeneration, memberHealth, itemUseAbility, itemAbilityTemplate, placeZone, settleZones,
  weaponConditions, applyWeaponConditions, conditionDamage, moraleRisk, decideMorale, traitLevel, SmallBattle, MassBattle,
  type Combatant, type ObservationContext, type Rng,
} from '../src/index.js';

function unit(id = 'a', scale: 'hero' | 'company' = 'hero', L = 5): Combatant {
  const u = generateUnit({ name: id, side: id === 'e' ? 'enemy' : 'ally', scale, hpMax: scale === 'hero' ? 10000 : 100,
    level: L, rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'sword', weaponLevel: 5, armorTier: 0, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, V17_OVERFLOW_D20); prepareTraitModel(u, V17_OVERFLOW_D20); prepareItemModel(u, V17_OVERFLOW_D20);
  prepareTraitLevelModel(u, V17_OVERFLOW_D20); prepareSkillModel(u, V17_OVERFLOW_D20); return u;
}
const mechanism = (text: string) => skillMechanismId(parseSkillMechanism(text)!);
function heal(u: Combatant, power: number) {
  const a = compileSkill({ id: mechanism('buff治疗') }, power, u.id, 'skills-v2'); u.abilities = [a]; u.preparedAbilityIds = [a.id]; upgradeCombatSkills(u); return a;
}
const tick = (u: Combatant) => settleRegeneration(u, regenerationAmount(u));

describe('P2-B 恢复、毒性与心理结算', () => {
  it.each(['small', 'mass'] as const)('%s主动治疗预览与实际跨代一致，存档不重编旧技能', mode => {
    const a = unit('a', 'company'), e = unit('e', 'company'); const ability = heal(a, 8); a.resources.SP = 20;
    const b = mode === 'small' ? new SmallBattle({ combatants: [a, e], rules: V17_OVERFLOW_D20, seed: 'heal' }) : new MassBattle({ combatants: [a, e], rules: V17_OVERFLOW_TW, seed: 'heal' });
    b.start();
    const actor = b.byId('a'); applyCombatDamage(actor, 10, 50); const before = memberHealth(actor);
    const effect = ability.effects.find(e => e.op === 'heal')!; if (effect.op !== 'heal') throw Error('fixture');
    const expected = Math.min(recoveryCapacity(actor), Math.floor(healingYield(actor, actor, effect.amount!, false, effect.power)));
    if (b instanceof SmallBattle) { while (b.active?.id !== 'a') b.endTurn(); expect(b.useAbility('a', ability.id, 'a').ok).toBe(true); }
    else { b.orders.set('e', { unitId: 'e', type: 'hold', automatic: true }); b.issue({ unitId: 'a', type: 'ability', abilityId: ability.id, targetId: 'a' }); b.resolveRound(); }
    expect(memberHealth(actor) - before).toBe(expected);
    const saved = JSON.parse(JSON.stringify(b.toSnapshot()));
    const restored = mode === 'small' ? SmallBattle.fromSnapshot(saved) : MassBattle.fromSnapshot(saved);
    expect(restored.byId('a').hp).toBe(actor.hp); expect(restored.byId('a').abilities[0]).toEqual(actor.abilities[0]);
  });
  it('治疗药品按跨代后每件预算估件；只扣实际剂量，P保留且不重复乘剂量', () => {
    const source = unit('a', 'company'), target = unit('b', 'company'); applyCombatDamage(target, 100, 8);
    const a = itemAbilityTemplate(mechanism('buff治疗'), 8, undefined, 'single');
    a.itemSourceId = 'dose'; a.itemScaling = 'member'; a.cost = { resource: 'item:dose', amount: 1 }; source.resources['item:dose'] = 100;
    const e = a.effects.find(e => e.op === 'heal')!; if (e.op !== 'heal') throw Error('fixture');
    const perDose = healingYield(source, target, e.amount!, true, e.power), capacity = recoveryCapacity(target);
    const used = itemUseAbility(source, a, target).ability;
    expect(used.cost!.amount).toBe(Math.min(8, Math.ceil(capacity / perDose)));
    const scaled = used.effects.find(e => e.op === 'heal')!; if (scaled.op !== 'heal') throw Error('fixture');
    expect(scaled.power).toBe(8); expect(healingYield(source, target, scaled.amount!, true, scaled.power)).toBeCloseTo(perDose * used.cost!.amount);
  });
  it('区域保存施放时医护，目标level每次读取；自身治疗和载荷各只跨代一次', () => {
    const source = unit(), target = unit('b'); source.traits = ['medic']; source.traitLevels = { medic: 5 }; source.pos = target.pos = 0; target.hp = 100;
    const context: ObservationContext = { mode: 'small', fieldTags: [], units: [source, target], rules: V17_OVERFLOW_D20 };
    const zone = placeZone(context, source, target, { op: 'zone', kind: 'healing', power: 8, healingModel: 'healing-grades-v1', amount: 10, radius: 1, dur: 3, effects: [{ op: 'heal', amount: 20, power: 8 }] }, 1, 'zone');
    source.traits = []; settleZones(context, 1);
    const first = Math.floor(10 * 1.25 * healingGradeMultiplier(8, 5, target.healingModel)) + Math.floor(20 * 1.25 * healingGradeMultiplier(8, 5, target.healingModel));
    expect(target.hp - 100).toBe(first); const hp = target.hp;
    target.level = 8; settleZones(context, 2); expect(target.hp - hp).toBe(Math.floor(12.5) + 25);
    expect(zone.sourceMedicSnapshot).toBe(1.25); expect(settleZones(context, 2)).toEqual([]);
  });
  it('再生余量只积真实周期：失能暂停、换级保留、满血/源失效清零，旧规则冻结', () => {
    const u = unit(); u.hp = 100; u.traits = ['regen']; u.traitLevels = { regen: 1 };
    expect(tick(u)).toBe(0); expect(u.regenerationRemainder).toBe(7500);
    const before = JSON.stringify(u); regenerationAmount(u); expect(JSON.stringify(u)).toBe(before);
    u.conditions.push({ id: 'stunned', dur: 1 }); expect(tick(u)).toBe(0); expect(u.regenerationRemainder).toBe(7500);
    u.conditions = []; u.traitLevels.regen = 2; expect(tick(u)).toBe(2); expect(u.regenerationRemainder).toBe(2500);
    u.hp = u.base.hpMax; tick(u); expect(u.regenerationRemainder).toBe(0); u.hp = 100;
    u.regenerationRemainder = 5000; u.traits = []; tick(u); expect(u.regenerationRemainder).toBe(0);
    u.traits = ['regen']; u.traitLevels.regen = 8; expect(regenerationAmount(u)).toBeCloseTo(4.5 * Math.sqrt(6000 / 420));
    prepareTraitLevelModel(u, V16_OVERFLOW_D20); expect(regenerationAmount(u)).toBe(3);
  });
  it('医护伤兵百分比按新伤亡守恒，换级不补历史账；毒冻结效力且同组不续期', () => {
    const many = unit('a', 'company'), single = structuredClone(many);
    for (const u of [many, single]) { u.traits = ['medic']; u.traitLevels = { medic: 6 }; u.formation!.memberHp = 1; u.formation!.health = [{ hp: 1, count: 100 }]; }
    for (let n = 0; n < 10; n++) applyCombatDamage(many, 1, 1); applyCombatDamage(single, 10, 10);
    expect(many.recoverableWounded).toBe(single.recoverableWounded); expect(many.woundedPercentRemainder).toBe(70);
    const old = many.recoverableWounded; many.traitLevels!.medic = 10; applyRecovery(many, 1); expect(many.recoverableWounded).toBeLessThanOrEqual(old!);
    const poisoner = unit(), target = unit('e'); poisoner.traits = ['poison-strike']; poisoner.traitLevels = { 'poison-strike': 8 };
    applyWeaponConditions(target, weaponConditions(poisoner, target, poisoner.weapon, 1));
    expect(target.conditions[0]).toMatchObject({ id: 'poisoned', dur: 3, magnitude: 1.5 }); poisoner.traits = [];
    expect(conditionDamage(target, 4, target.conditions[0]!)).toBe(6);
    poisoner.traits = ['poison-strike']; poisoner.traitLevels['poison-strike'] = 10; applyWeaponConditions(target, weaponConditions(poisoner, target, poisoner.weapon, 1));
    expect(target.conditions[0]).toMatchObject({ dur: 3, magnitude: 1.5 }); expect(target.conditions).toHaveLength(1);
  });
  it('恐惧逐级、恐怖以本体身份和最高DC一次检定，等级/来源变化不重置', () => {
    const a = unit(), e = unit('e'); a.pos = 0; e.pos = 1; a.morale = 50; e.traits = ['terror'];
    const context: ObservationContext = { mode: 'small', fieldTags: [], units: [a, e], rules: V17_OVERFLOW_D20 };
    expect(traitLevel(e, 'fear')).toBe(8); expect(moraleRisk(context, a, 25).terrorDC).toBe(12);
    let rolls = 0; const rng = { d: () => { rolls++; return 20; } } as unknown as Rng;
    const decision = decideMorale(context, a, 1, rng, 25); a.moraleState = decision.state;
    expect(rolls).toBe(1); e.traits = ['fear']; e.traitLevels = { fear: 10 }; decideMorale(context, a, 2, rng, 25); expect(rolls).toBe(1);
  });
});
