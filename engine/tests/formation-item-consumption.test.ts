import { describe, expect, it } from 'vitest';
import {
  applyCombatDamage, attachCarriedItems, compileItem, generateUnit, itemUseAbility, MassBattle, memberHealth,
  parseSkillMechanism, recoveryCapacity, skillMechanismId, SmallBattle, standardField, traitRegistry,
  V14_OVERFLOW_D20, V15_OVERFLOW_D20, V15_OVERFLOW_TW, type Combatant,
} from '../src/index.js';
import { itemAbilitySummary } from '../../panel/src/item-description.js';

const registry = traitRegistry();
function unit(id: string, members = 100, side: Combatant['side'] = 'ally', hero = false): Combatant {
  const u = generateUnit({ name: id, side, scale: hero ? 'hero' : 'company', rulesVersion: 'v2', damageModel: 'wounds-v2',
    level: 4, hpMax: hero ? 72 : members, traits: [], weaponClass: 'rifle', armorTier: 1 }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.tags.push('zone:中军', 'rank:front'); return u;
}
function carry(u: Combatant, effect: string, quantity = 100): Combatant {
  return attachCarriedItems(u, [{ id: 'dose', name: effect, quantity, revision: 1,
    mechanics: compileItem({ kind: 'item', form: 'single', power: 3, active: skillMechanismId(parseSkillMechanism(effect)!) }, { id: 'dose', name: effect, seed: 'dose' }) }]);
}
function fight(mode: 'small' | 'mass', allies: Combatant[], old = false) {
  const enemy = unit('enemy', 100, 'enemy');
  if (mode === 'mass') {
    const battle = new MassBattle({ combatants: [...allies, enemy], rules: V15_OVERFLOW_TW, seed: 'item-consumption', traitRegistry: registry });
    battle.start(); battle.issue({ unitId: enemy.id, type: 'hold' }); return battle;
  }
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [...allies, enemy], battlefield: field, rules: old ? V14_OVERFLOW_D20 : V15_OVERFLOW_D20, seed: 'item-consumption', traitRegistry: registry });
  battle.start(); battle.turnOrder = [...allies, enemy].map(u => u.id); battle.turnIndex = 0;
  allies.forEach((u, i) => { u.pos = 40 + i; }); enemy.pos = 26; return battle;
}
function execute(battle: SmallBattle | MassBattle, actor: Combatant, target = actor) {
  const result = battle.useAbility(actor.id, 'item:dose', target.id);
  if (battle instanceof MassBattle && result.ok) {
    for (const ally of battle.combatants.filter(u => u.side === 'ally' && u.id !== actor.id)) battle.issue({ unitId: ally.id, type: 'hold' });
    battle.resolveRound();
  }
  return result;
}
const listed = (actor: Combatant) => actor.abilities.find(a => a.itemSourceId)!;
const amount = (actor: Combatant) => listed(actor).effects.reduce((n, e) => n + (e.op === 'heal' || e.op === 'barrier' ? e.amount ?? 0 : 0), 0);

describe('编队治疗按实际伤量使用，护盾按本次总件数计算', () => {
  it.each(['small', 'mass'] as const)('%s：100人编队只有一人掉1血，只扣一件；满血拒绝，预览不改状态，快照保持余量', mode => {
    const actor = carry(unit('actor'), 'buff治疗'), battle = fight(mode, [actor]);
    const fielded = battle.byId(actor.id); applyCombatDamage(fielded, 1, 1);
    const before = structuredClone(battle.toSnapshot()), life = memberHealth(fielded);
    expect(battle.itemUse(fielded, listed(fielded), fielded).ability.cost?.amount).toBe(1);
    const preview = battle instanceof SmallBattle ? battle.getActionOptions(actor.id).find(a => a.id === 'item:dose')?.targets?.find(t => t.targetId === actor.id)?.preview
      : battle.orderPreview({ unitId: actor.id, type: 'ability', abilityId: 'item:dose', targetId: actor.id });
    expect(preview?.healing).toBe(1); expect(battle.toSnapshot()).toEqual(before);
    expect(execute(battle, fielded).ok).toBe(true);
    expect(fielded.resources['item:dose']).toBe(99); expect(memberHealth(fielded)).toBe(life + 1);
    const restored = battle instanceof SmallBattle ? SmallBattle.fromSnapshot(battle.toSnapshot(), { traitRegistry: registry }) : MassBattle.fromSnapshot(battle.toSnapshot(), { traitRegistry: registry });
    expect(restored.byId(actor.id).resources['item:dose']).toBe(99); expect(recoveryCapacity(restored.byId(actor.id))).toBe(0);
    const full = battle instanceof SmallBattle ? battle.useAbility(actor.id, 'item:dose', actor.id, { bypassTurn: true }) : battle.useAbility(actor.id, 'item:dose', actor.id);
    expect(full.ok).toBe(false); expect(fielded.resources['item:dose']).toBe(99);
  });
  it.each([1, 24, 25, 49])('缺%d点血：按L3每件24点恢复量向上取整，实际回血不超过缺口', missing => {
    const actor = carry(unit('actor'), 'buff治疗'), battle = fight('small', [actor]);
    applyCombatDamage(actor, missing, 1); const life = memberHealth(actor);
    expect(execute(battle, actor).ok).toBe(true);
    expect(actor.resources['item:dose']).toBe(100 - Math.ceil(missing / 24)); expect(memberHealth(actor)).toBe(life + missing);
  });
  it('医护的25%治疗加成计入件数；给独立人物用药只扣一件', () => {
    const actor = carry(unit('actor'), 'buff治疗'), hero = unit('hero', 1, 'ally', true);
    actor.traits.push('medic'); const battle = fight('small', [actor, hero]);
    applyCombatDamage(actor, 25, 1); expect(execute(battle, actor).ok).toBe(true); expect(actor.resources['item:dose']).toBe(99);
    applyCombatDamage(hero, 1, 1);
    expect(battle.useAbility(actor.id, 'item:dose', hero.id, { bypassTurn: true }).ok).toBe(true); expect(actor.resources['item:dose']).toBe(98);
  });
  it.each([[5, 100, 100, 5], [100, 3, 100, 3], [100, 100, 3, 3]])('库存%d、使用者%d人、目标%d人仍限制单次件数', (quantity, users, recipients, expected) => {
    const actor = carry(unit('actor', users), 'buff治疗', quantity), target = unit('target', recipients), battle = fight('small', [actor, target]);
    applyCombatDamage(target, 144, Math.min(6, recipients));
    expect(execute(battle, actor, target).ok).toBe(true); expect(actor.resources['item:dose']).toBe(quantity - expected);
  });
  it.each(['small', 'mass'] as const)('%s：范围治疗按实际波及者较大的伤量用药，轻伤主目标不截断其他伤员', mode => {
    const actor = carry(unit('actor'), 'buff范围治疗'), target = unit('target'), battle = fight(mode, [actor, target]);
    const a = battle.byId(actor.id), t = battle.byId(target.id), healing = amount(a);
    applyCombatDamage(a, 1, 1); applyCombatDamage(t, healing * 2 + 1, 3);
    expect(battle.itemUse(a, listed(a), a).ability.cost?.amount).toBe(3);
    expect(execute(battle, a).ok).toBe(true); expect(a.resources['item:dose']).toBe(97);
    expect(recoveryCapacity(a)).toBe(0); expect(recoveryCapacity(t)).toBe(0);
  });
  it('会战同轮两队治疗同一轻伤队，前一队补满后后一队不耗药', () => {
    const first = carry(unit('first'), 'buff治疗'), second = carry(unit('second'), 'buff治疗'), target = unit('target');
    const battle = fight('mass', [first, second, target]) as MassBattle;
    applyCombatDamage(battle.byId(target.id), 1, 1);
    expect(battle.useAbility(first.id, 'item:dose', target.id).ok).toBe(true);
    expect(battle.useAbility(second.id, 'item:dose', target.id).ok).toBe(true);
    battle.issue({ unitId: target.id, type: 'hold' }); battle.resolveRound();
    expect(battle.byId(first.id).resources['item:dose']! + battle.byId(second.id).resources['item:dose']!).toBe(199);
    expect(recoveryCapacity(battle.byId(target.id))).toBe(0);
  });
  it.each(['small', 'mass'] as const)('%s：50/100/200张护盾分别消耗50/100/100张，容量等于26点（新实物L3预算）乘本次件数，快照保存总容量', mode => {
    for (const quantity of [50, 100, 200]) {
      const actor = carry(unit('actor'), 'buff屏障', quantity), battle = fight(mode, [actor]), a = battle.byId(actor.id);
      const doses = Math.min(100, quantity), expected = 26 * doses;
      const derived = battle.itemUse(a, listed(a), a).ability;
      expect(derived.effects).toEqual([{ op: 'barrier', amount: expected, dur: 2, defensePower: 3 }]);
      const preview = battle instanceof SmallBattle ? battle.getActionOptions(actor.id).find(o => o.id === 'item:dose')!.targets!.find(t => t.targetId === actor.id)!.preview
        : battle.orderPreview({ unitId: actor.id, type: 'ability', abilityId: 'item:dose', targetId: actor.id });
      expect(preview?.effects?.join()).toContain(`吸收${expected}点`);
      expect(execute(battle, a).ok).toBe(true); expect(a.resources['item:dose']).toBe(quantity - doses); expect(a.barrier?.remaining).toBe(expected);
      const restored = battle instanceof SmallBattle ? SmallBattle.fromSnapshot(battle.toSnapshot(), { traitRegistry: registry }) : MassBattle.fromSnapshot(battle.toSnapshot(), { traitRegistry: registry });
      expect(restored.byId(a.id).barrier?.remaining).toBe(expected);
    }
  });
  it('重复使用护盾批次取较强容量，旧规则仍一次一件；复合道具保留其他效果的覆盖用量', () => {
    const actor = carry(unit('actor'), 'buff屏障', 150), battle = fight('small', [actor]);
    expect(execute(battle, actor).ok).toBe(true); expect(actor.resources['item:dose']).toBe(50); expect(actor.barrier?.remaining).toBe(2600);
    expect(battle.useAbility(actor.id, 'item:dose', actor.id, { bypassTurn: true }).ok).toBe(false); expect(actor.resources['item:dose']).toBe(50);
    const old = carry(unit('old'), 'buff屏障'), legacy = fight('small', [old], true);
    expect(execute(legacy, old).ok).toBe(true); expect(old.resources['item:dose']).toBe(99); expect(old.barrier?.remaining).toBe(26);
    const combined = carry(unit('combined'), 'buff治疗+屏障'); fight('small', [combined]); applyCombatDamage(combined, 1, 1);
    expect(itemUseAbility(combined, listed(combined), combined).ability.cost?.amount).toBe(100);
  });
  it('道具说明只写用法与效果，不解释编队件数规则', () => {
    expect(itemAbilitySummary(listed(carry(unit('healer'), 'buff治疗')))).not.toContain('件数');
    expect(itemAbilitySummary(listed(carry(unit('shield'), 'buff屏障')))).toMatch(/^自身或相邻友军，可用加速动作，屏障\d+点，\d+轮$/);
    const charged = compileItem({ kind: 'item', form: 'charged', power: 3, active: 'generic:buff:barrier' }, { id: 'wand', seed: 'wand' });
    if (charged.kind !== 'item') throw Error('fixture');
    expect(itemAbilitySummary(charged.value.ability!)).not.toContain('按本次件数累加');
  });
});
