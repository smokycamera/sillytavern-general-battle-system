import { describe, expect, it } from 'vitest';
import { abilityTargetReason, turnEconomy, weaponRangeSpec } from '../src/actions';
import { MassBattle } from '../src/mass/battle';
import { SmallBattle, makeCombatant } from '../src/small/battle';
import type { Ability, Combatant, Weapon } from '../src/types';

function unit(input: {
  id: string;
  side: 'ally' | 'enemy';
  pos?: number;
  archetype?: Combatant['archetype'];
  weapon?: Weapon;
  abilities?: Ability[];
  resources?: Record<string, number>;
  tags?: string[];
}): Combatant {
  return makeCombatant({
    id: input.id,
    name: input.id,
    side: input.side,
    pos: input.pos ?? 0,
    archetype: input.archetype ?? 'infantry',
    weapon: input.weapon ?? { id: `${input.id}-blade`, name: '短刃', baseDice: '1d4', range: 0 },
    abilities: input.abilities ?? [],
    resources: input.resources ?? {},
    tags: input.tags ?? [],
    base: { atk: 8, def: 12, spd: 5, hpMax: 100 },
  });
}

function startOn(battle: SmallBattle, actorId: string): void {
  battle.start();
  let guard = 0;
  while (!battle.isTurnOf(actorId) && guard++ < 8) battle.endTurn();
  expect(battle.isTurnOf(actorId)).toBe(true);
}

describe('统一动作与射程规则', () => {
  it('移动额度与主行动额度彼此独立', () => {
    expect(turnEconomy({ isTurn: true, ready: true, moved: true, acted: false })).toEqual({
      moveAvailable: false,
      actionAvailable: true,
      reactionAvailable: true,
    });

    const rifle: Weapon = {
      id: 'rifle', name: '步枪', baseDice: '1d6', tags: ['ranged'], range: 3,
      minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2,
    };
    const actor = unit({ id: 'actor', side: 'ally', pos: 0, archetype: 'ranged', weapon: rifle });
    const target = unit({ id: 'target', side: 'enemy', pos: 3 });
    const battle = new SmallBattle({ combatants: [actor, target], seed: 'move-then-fire' });
    startOn(battle, actor.id);

    battle.move(actor.id, 'advance');
    expect(battle.getTurnEconomy(actor.id)).toMatchObject({ moveAvailable: false, actionAvailable: true });
    expect(() => battle.move(actor.id, 'advance')).toThrow(/移动额度/);
    const result = battle.attack(actor.id, target.id);
    expect(result.atkDetail).toContain('移动射击');
    expect(battle.getTurnEconomy(actor.id)).toMatchObject({ moveAvailable: false, actionAvailable: false });
    expect(() => battle.attack(actor.id, target.id)).toThrow(/主行动/);
  });

  it('冲锋同时消耗移动与主行动', () => {
    const charger = unit({ id: 'charger', side: 'ally', pos: 0, archetype: 'mobile' });
    const target = unit({ id: 'target', side: 'enemy', pos: 3 });
    const battle = new SmallBattle({ combatants: [charger, target], seed: 'charge-economy' });
    startOn(battle, charger.id);

    battle.attack(charger.id, target.id, { charge: true });
    expect(battle.getTurnEconomy(charger.id)).toMatchObject({ moveAvailable: false, actionAvailable: false });
    expect(() => battle.move(charger.id, 'withdraw')).toThrow(/移动额度/);
  });

  it('坦克炮可抵近直射并应用数据定义的惩罚', () => {
    const tankGun: Weapon = {
      id: 'wpn-tankgun', name: '坦克炮', baseDice: '1d10', tags: ['ranged'], range: 4,
      minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -3,
    };
    const tank = unit({ id: 'tank', side: 'ally', pos: 2, archetype: 'ranged', weapon: tankGun });
    const target = unit({ id: 'target', side: 'enemy', pos: 2 });
    const battle = new SmallBattle({ combatants: [tank, target], seed: 'tank-pointblank' });

    expect(weaponRangeSpec(tankGun, true)).toMatchObject({ min: 0, max: 4, allowEngaged: true });
    const result = battle.attack(tank.id, target.id, { bypassTurn: true, weaponMode: 'primary' });
    expect(result.atkDetail).toContain('抵近射击');
    expect(result.atkDetail).toContain('-3');
  });

  it('弓和间接火力遵守各自的最小射程', () => {
    const bow: Weapon = {
      id: 'bow', name: '长弓', baseDice: '1d6', tags: ['ranged'], range: 3,
      minRange: 1, pointBlankPolicy: 'forbid',
    };
    const mortar: Weapon = {
      id: 'mortar', name: '迫击炮', baseDice: '1d8', tags: ['ranged'], range: 4,
      minRange: 2, pointBlankPolicy: 'forbid', indirect: true,
    };
    const shooter = unit({ id: 'shooter', side: 'ally', pos: 1, archetype: 'ranged', weapon: bow });
    const target = unit({ id: 'target', side: 'enemy', pos: 1 });
    const battle = new SmallBattle({ combatants: [shooter, target], seed: 'minimum-range' });

    expect(() => battle.attack(shooter.id, target.id, { bypassTurn: true, weaponMode: 'primary' })).toThrow(/贴身/);
    shooter.weapon = mortar;
    target.pos = 2;
    expect(() => battle.attack(shooter.id, target.id, { bypassTurn: true, weaponMode: 'primary' })).toThrow(/最小射程/);
  });

  it('越界技能在扣资源、建冷却状态之前被拒绝，动作菜单给出同一原因', () => {
    const strike: Ability = {
      id: 'touch', name: '触击', target: 'enemy', cost: { resource: 'SP', amount: 2 }, cooldown: 2,
      range: { min: 0, max: 0, metric: 'grid', allowEngaged: true },
      effects: [{ op: 'damage', baseDice: '1d6' }],
    };
    const caster = unit({ id: 'caster', side: 'ally', pos: 0, abilities: [strike], resources: { SP: 3 } });
    const target = unit({ id: 'target', side: 'enemy', pos: 2 });
    const battle = new SmallBattle({ combatants: [caster, target], seed: 'ability-range' });
    startOn(battle, caster.id);

    const option = battle.getActionOptions(caster.id).find((item) => item.id === strike.id)!;
    const targetOption = option.targets!.find((item) => item.targetId === target.id)!;
    expect(targetOption.enabled).toBe(false);
    expect(targetOption.reason).toMatch(/技能射程/);
    expect(abilityTargetReason({ actor: caster, ability: strike, target, distance: 2 })).toBe(targetOption.reason);

    const result = battle.useAbility(caster.id, strike.id, target.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(targetOption.reason);
    expect(caster.resources.SP).toBe(3);
    expect(caster.abilityState).toEqual([]);
  });

  it('大会战也在扣费前用同一射程规则拒绝跨翼技能', () => {
    const strike: Ability = {
      id: 'same-wing', name: '同翼突袭', target: 'enemy', cost: { resource: 'SP', amount: 1 },
      range: { min: 0, max: 0, metric: 'zone', allowEngaged: true },
      effects: [{ op: 'damage', baseDice: '1d6' }],
    };
    const caster = unit({ id: 'caster', side: 'ally', abilities: [strike], resources: { SP: 2 }, tags: ['zone:左翼'] });
    const target = unit({ id: 'target', side: 'enemy', tags: ['zone:右翼'] });
    const battle = new MassBattle({ combatants: [caster, target], zones: ['左翼', '中军', '右翼'], seed: 'mass-range' });

    const result = battle.useAbility(caster.id, strike.id, target.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/技能射程/);
    expect(caster.resources.SP).toBe(2);
    expect(caster.abilityState).toEqual([]);
  });

  it('自动行动会在移动后重新规划并于同回合射击', () => {
    const rifle: Weapon = {
      id: 'rifle', name: '步枪', baseDice: '1d6', tags: ['ranged'], range: 3,
      minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2,
    };
    const actor = unit({ id: 'actor', side: 'ally', pos: 0, archetype: 'ranged', weapon: rifle });
    const target = unit({ id: 'target', side: 'enemy', pos: 4 });
    const battle = new SmallBattle({ combatants: [actor, target], seed: 'auto-move-fire' });
    startOn(battle, actor.id);

    battle.autoAction(actor.id);
    expect(actor.pos).toBe(1);
    expect(battle.log.some((entry) => entry.kind === 'move' && entry.text.includes(actor.name))).toBe(true);
    expect(battle.log.some((entry) => entry.kind === 'attack' && entry.text.includes(actor.name))).toBe(true);
  });

  it('兵力劣势时召唤 AI 不再受隐藏的五成概率门槛', () => {
    const summon: Ability = {
      id: 'reinforce', name: '呼叫援军', target: 'self', usesPerBattle: 1,
      range: { min: 0, max: 0, metric: 'self', allowEngaged: true },
      effects: [{ op: 'summon', templateId: 'helper', count: 1 }],
    };
    const summoner = unit({ id: 'summoner', side: 'ally', abilities: [summon] });
    summoner.weapon = undefined;
    const enemy1 = unit({ id: 'enemy-1', side: 'enemy', pos: 3 });
    const enemy2 = unit({ id: 'enemy-2', side: 'enemy', pos: 4 });
    let serial = 0;
    const battle = new SmallBattle({
      combatants: [summoner, enemy1, enemy2],
      seed: 'deterministic-summon',
      summonUnit: (_templateId, side) => unit({ id: `helper-${++serial}`, side: side as 'ally' | 'enemy', pos: 0 }),
    });
    startOn(battle, summoner.id);

    battle.autoAction(summoner.id);
    expect(serial).toBe(1);
    expect(battle.combatants.some((candidate) => candidate.id === 'helper-1')).toBe(true);
  });
});
