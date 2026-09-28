import { describe, expect, it } from 'vitest';
import { SmallBattle, MassBattle, V9_OVERFLOW_D20, V9_OVERFLOW_TW, V8_OVERFLOW_D20, generateUnit, traitRegistry, standardField, compileGenericSkill, type Combatant, type Ability } from '../src/index.js';
import { nextResourceState, tacticalRestValue, tacticalSkillCost } from '../src/skill-economy.js';
import { skillResourceCost } from '../src/skill-runtime.js';
import { abilityCost, spCapacity } from '../src/resources.js';
import { skillEffectValue } from '../src/skill-effects.js';

const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy') {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 10, hpMax: 2000,
    weaponClass: 'sword', weaponLevel: 1, armorTier: 0, traits: ['steadfast'] }, { seed: id, noVariance: true, registry }).unit;
  u.id = id; return u;
}
function spell(u: Combatant, id: string, dice: string, cost: number): Ability {
  const a = { ...compileGenericSkill('generic:magic-single:arcane', 9, u.id), id, cooldownGroup: id, customized: true,
    cost: { resource: 'SP', amount: cost }, cooldown: 1, effects: [{ op: 'damage' as const, baseDice: dice }],
    damageScale: 1, range: { min: 0, max: 10, metric: 'grid' as const, allowEngaged: true } };
  u.abilities.push(a); (u.preparedAbilityIds ??= []).push(id); return a;
}
function setup(mode: 'small' | 'mass' = 'small') {
  const actor = make('caster', 'ally'), foe = make('foe', 'enemy');
  const weak = spell(actor, 'weak', '8d6', 3), strong = spell(actor, 'strong', '40d6', 7);
  if (mode === 'mass') { actor.traits.push('flying'); foe.traits.push('flying'); }
  const field = standardField(); field.tiles.fill('open');
  const b = mode === 'small'
    ? new SmallBattle({ combatants: [actor, foe], rules: V9_OVERFLOW_D20, battlefield: field, traitRegistry: registry, seed: 'economy' })
    : new MassBattle({ combatants: [actor, foe], rules: V9_OVERFLOW_TW, traitRegistry: registry, seed: 'economy' });
  b.start(); actor.pos = 31; foe.pos = 24; actor.formationPosition = 'ally:中军:front'; foe.formationPosition = 'enemy:中军:front';
  if (b instanceof SmallBattle) { b.turnOrder = [actor.id, foe.id]; b.turnIndex = 0; b.movementSpent.set(actor.id, 99); }
  actor.resources.SP = 7; actor.abilityState = [{ abilityId: strong.id, cdLeft: 1, used: 0 }];
  return { actor, foe, weak, strong, b, context: b.observationContext() };
}
function chosen(b: SmallBattle | MassBattle, actor: Combatant): string {
  if (b instanceof MassBattle) { const order = b.recommendedOrder(actor.id)!; return order.type === 'ability' ? order.abilityId! : order.type; }
  const used = actor.abilityState.reduce((n, s) => n + s.used, 0), old = b.log.length;
  b.autoAction(actor.id);
  if (actor.abilityState.reduce((n, s) => n + s.used, 0) > used) return actor.abilityState.find(s => s.used > 0)!.abilityId;
  return b.log.slice(old).some(e => e.resolution?.attackerId === actor.id) ? 'attack' : 'hold';
}

describe('V9 SP机会成本与休整反事实', () => {
  it.each(['small', 'mass'] as const)('%s：弱战技不能挤掉下次即将就绪的强技；不把共享冷却算成休整收益', mode => {
    const { actor, weak, context, b } = setup(mode);
    expect(tacticalSkillCost(context, actor, weak)).toBeGreaterThan(skillResourceCost(weak, actor) + 10);
    expect(tacticalRestValue(context, actor)).toBe(0);
    expect(['attack', 'charge', 'volley']).toContain(chosen(b, actor));
  });
  it.each(['small', 'mass'] as const)('%s：资源充足仍进攻，不为冷却空等，也不强制轮换', mode => {
    const { actor, weak, context, b } = setup(mode); actor.resources.SP = 30;
    expect(tacticalSkillCost(context, actor, weak)).toBe(skillResourceCost(weak, actor));
    expect(tacticalRestValue(context, actor)).toBe(0);
    expect(chosen(b, actor)).toBe(weak.id);
  });
  it.each(['small', 'mass'] as const)('%s：普攻后的自然恢复已经够下轮施法时不浪费整轮休整', mode => {
    const { actor, strong, b, context } = setup(mode); actor.resources.SP = 6; actor.preparedAbilityIds = [strong.id];
    expect(nextResourceState(context, actor).resources.SP).toBe(7);
    expect(nextResourceState(context, actor, true).resources.SP).toBe(9);
    expect(tacticalRestValue(context, actor)).toBe(0);
    expect(['attack', 'charge', 'volley']).toContain(chosen(b, actor));
  });
  it.each(['small', 'mass'] as const)('%s：只有完整休整能解锁高收益攻击时仍会休整', mode => {
    const { actor, strong, context, b } = setup(mode); actor.resources.SP = 4; actor.preparedAbilityIds = [strong.id];
    expect(tacticalRestValue(context, actor)).toBeGreaterThan(10);
    expect(chosen(b, actor)).toBe('hold');
  });
  it('残血收尾不为假想后续回合屯SP', () => {
    const { actor, foe, weak, context } = setup();
    expect(tacticalSkillCost(context, actor, weak, foe.hp)).toBe(skillResourceCost(weak, actor));
    expect(tacticalSkillCost(context, actor, weak, foe.hp * 0.5)).toBeLessThan(tacticalSkillCost(context, actor, weak));
  });
  it.each(['small', 'mass'] as const)('%s：预测严格沿用自身冷却/次数/扣费，不修改战斗或随机数', mode => {
    const { actor, weak, b, context } = setup(mode); weak.cooldown = 3; weak.usesPerBattle = 1;
    const before = JSON.stringify(b.toSnapshot());
    const next = nextResourceState(context, actor, false, weak);
    expect(next.resources.SP).toBe(5);
    expect(next.abilityState.find(s => s.abilityId === weak.id)).toMatchObject({ used: 1, cdLeft: mode === 'mass' ? 3 : 2 });
    const first = tacticalSkillCost(context, actor, weak); expect(tacticalSkillCost(context, actor, weak)).toBe(first);
    tacticalRestValue(context, actor);
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
  });
  it('共享冷却组沿用同一份已用次数，不创建同名第二份运行状态', () => {
    const { actor, weak, strong, context } = setup(); weak.cooldownGroup = strong.id; actor.abilityState[0]!.used = 2;
    const next = nextResourceState(context, actor, false, weak);
    expect(next.abilityState).toHaveLength(1); expect(next.abilityState[0]!.used).toBe(3);
  });
  it('满SP与低疲劳无空转收益；疲劳阈值、失能和压制沿用恢复规则', () => {
    const { actor, strong, context } = setup(); actor.resources.SP = spCapacity(actor); actor.abilityState = [];
    expect(tacticalRestValue(context, actor)).toBe(0);
    actor.resources.SP = 0; actor.fatigue = 8;
    expect(nextResourceState(context, actor).resources.SP).toBe(0.25);
    expect(nextResourceState(context, actor, true).resources.SP).toBe(1.5);
    actor.fatigue = 0; actor.conditions = [{ id: 'stunned', dur: 2 }];
    expect(nextResourceState(context, actor, true).resources.SP).toBe(0);
    actor.conditions = []; actor.suppression = 1;
    expect(nextResourceState(context, actor, true).resources.SP).toBe(1);
    expect(abilityCost(actor, strong)?.amount).toBe(7);
  });
  it('回能维持原防套利报价；非SP与旧规则不引入新机会成本', () => {
    const { actor, weak, context } = setup();
    const restore: Ability = { ...weak, target: 'self', effects: [{ op: 'resource', resource: 'SP', amount: 3, maximum: 'training' }] };
    expect(tacticalSkillCost(context, actor, restore)).toBe(skillResourceCost(restore, actor));
    const mana = { ...weak, cost: { resource: 'mana', amount: 2 } }; actor.resources.mana = 5;
    expect(tacticalSkillCost(context, actor, mana)).toBe(skillResourceCost(mana, actor));
    delete actor.resourceModel; const old = { ...context, rules: V8_OVERFLOW_D20 };
    expect(tacticalSkillCost(old, actor, weak)).toBe(skillResourceCost(weak, actor)); expect(tacticalRestValue(old, actor)).toBe(0);
  });
  it('飞行和仍生效的守护不为凑轮换而重复；评分只读取给定可见世界', () => {
    const { actor, context } = setup(); actor.traits.push('flying');
    const flight = compileGenericSkill('generic:buff:trait-flying', 9, actor.id);
    // Use an explicit trait effect so the test is independent of display-name aliases.
    flight.effects = [{ op: 'trait', traitId: 'flying', dur: 9 }];
    expect(skillEffectValue(context, actor, actor, flight)).toBe(0);
    const ward = compileGenericSkill('generic:buff:defense', 9, actor.id);
    ward.effects = [{ op: 'condition', conditionId: 'blessed', dur: 9, magnitude: 1.4 }];
    actor.conditions = [{ id: 'blessed', dur: 9, magnitude: 1.4 }];
    expect(skillEffectValue(context, actor, actor, ward)).toBe(0);
    const hidden = { ...context, units: [actor] };
    expect(tacticalRestValue(hidden, actor)).toBe(0);
  });
});
