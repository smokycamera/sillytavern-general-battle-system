import { describe, it, expect } from 'vitest';
import { SmallBattle, makeCombatant } from '../src/small/battle';
import type { Ability } from '../src/types';
import { SeededRng } from '../src/rng';
import { traitRegistry } from '../src/data/traits';

const reg = traitRegistry();

function squad() {
  const ally = makeCombatant({
    id: 'ally-1', name: '艾莉', side: 'ally', archetype: 'infantry', pos: 2,
    base: { atk: 6, def: 14, spd: 3, hpMax: 24 },
    weapon: { id: 'sword', name: '长剑', baseDice: '1d8+3' },
    armor: { id: 'chain', name: '锁子甲', tier: 1 },
    resources: { SP: 5 },
    abilities: [
      {
        id: 'flame-slash', name: '烈焰斩', target: 'enemy',
        cost: { resource: 'SP', amount: 2 }, cooldown: 1,
        effects: [{ op: 'damage', baseDice: '2d6+2' }],
      },
      {
        id: 'rally', name: '战吼', target: 'self',
        usesPerBattle: 1,
        effects: [{ op: 'condition', conditionId: 'inspired', dur: 2 }],
      },
    ],
  });
  const goblin = makeCombatant({
    id: 'gob-1', name: '哥布林', side: 'enemy', scale: 'mook', archetype: 'infantry', pos: 2,
    base: { atk: 3, def: 12, spd: 2, hpMax: 7 }, hp: 7,
    weapon: { id: 'spear', name: '短矛', baseDice: '1d6+1' },
    xpValue: 25,
  });
  return { ally, goblin };
}

describe('小规模战斗流程', () => {
  it('先攻排序按 d20+速度', () => {
    const { ally, goblin } = squad();
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'init-order' });
    b.start();
    expect(b.turnOrder).toHaveLength(2);
    const first = b.byId(b.turnOrder[0]!);
    expect(['艾莉', '哥布林']).toContain(first.name);
    expect(b.log[0]!.kind).toBe('initiative');
  });

  it('攻击结算与击杀经验入账', () => {
    const { ally, goblin } = squad();
    const b = new SmallBattle({ combatants: [ally, goblin], rng: new SeededRng('kill-test') });
    b.start();
    // 用高伤脚本保证击杀：直接调伤害管线（bypass 回合限制）
    const res = b.attack('ally-1', 'gob-1', { bypassTurn: true, extraMods: [{ source: 'temp', name: '必中', kind: 'atk', type: 'flat', value: 30 }] });
    expect(res.hit).toBe(true);
    expect(res.finalDamage).toBeGreaterThanOrEqual(4);
    if (res.finalDamage >= 7) {
      expect(goblin.status).toBe('dead');
      expect(b.xpGained).toBe(25);
      expect(b.isOver()).toBe(true);
      expect(b.winner()).toBe('ally');
    }
  });

  it('英雄归零进入濒死而非死亡', () => {
    const { ally, goblin } = squad();
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'dying' });
    b.start();
    goblin.base.atk = 30; goblin.weapon = { id: 'exe', name: '处刑斧', baseDice: '3d12+10', apDice: '2d8' };
    b.attack('gob-1', 'ally-1', { bypassTurn: true, extraMods: [{ source: 'temp', name: '必中', kind: 'atk', type: 'flat', value: 30 }] });
    if (ally.hp === 0) {
      expect(ally.status).toBe('dying');
      expect(b.winner()).toBe('enemy'); // 无 ready 的 ally（濒死）判负
    }
  });

  it('技能：资源消耗、冷却、每战次数', () => {
    const { ally, goblin } = squad();
    goblin.base.hpMax = 100;
    goblin.hp = 100;
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'ability' });
    b.start();
    const r1 = b.useAbility('ally-1', 'flame-slash', 'gob-1', { bypassTurn: true });
    expect(r1.ok).toBe(true);
    expect(ally.resources.SP).toBe(3);
    const r2 = b.useAbility('ally-1', 'flame-slash', 'gob-1', { bypassTurn: true });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain('冷却');
    // 资源不足
    ally.resources.SP = 1;
    ally.abilityState.find((s) => s.abilityId === 'flame-slash')!.cdLeft = 0;
    const r3 = b.useAbility('ally-1', 'flame-slash', 'gob-1', { bypassTurn: true });
    expect(r3.ok).toBe(false);
    expect(r3.reason).toContain('不足');
    // 每战一次
    const r4 = b.useAbility('ally-1', 'rally', undefined, { bypassTurn: true });
    expect(r4.ok).toBe(true);
    expect(ally.conditions.some((c) => c.id === 'inspired')).toBe(true);
    const r5 = b.useAbility('ally-1', 'rally', undefined, { bypassTurn: true });
    expect(r5.ok).toBe(false);
    expect(r5.reason).toContain('用尽');
  });

  it('冷却随回合递减', () => {
    const { ally, goblin } = squad();
    goblin.base.hpMax = 100;
    goblin.hp = 100;
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'cd-tick' });
    b.start();
    // 若先手不是艾莉，先推进到她的回合
    let guard = 0;
    while (!b.isTurnOf('ally-1') && guard++ < 4) b.endTurn();
    expect(b.useAbility('ally-1', 'flame-slash', 'gob-1').ok).toBe(true);
    // 推进完整一轮回到艾莉回合（其间她的回合结束已将冷却递减为 0）
    guard = 0;
    do { b.endTurn(); } while (!b.isTurnOf('ally-1') && guard++ < 4);
    const r = b.useAbility('ally-1', 'flame-slash', 'gob-1');
    expect(r.ok).toBe(true);
  });

  it('友方增益技能拒绝敌方目标，只作用于友军', () => {
    const { ally, goblin } = squad();
    const guard: Ability = {
      id: 'guard-ally', name: '守护', target: 'ally',
      effects: [{ op: 'condition', conditionId: 'encouraged', dur: 2 }],
    };
    ally.abilities.push(guard);
    ally.abilityState.push({ abilityId: guard.id, cdLeft: 0, used: 0 });
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'ally-target' });
    b.start();

    const rejected = b.useAbility(ally.id, guard.id, goblin.id, { bypassTurn: true });
    expect(rejected.ok).toBe(false);
    expect(goblin.conditions.some((c) => c.id === 'encouraged')).toBe(false);

    const accepted = b.useAbility(ally.id, guard.id, ally.id, { bypassTurn: true });
    expect(accepted.ok).toBe(true);
    expect(ally.conditions.some((c) => c.id === 'encouraged')).toBe(true);
  });

  it('非本人回合不可攻击', () => {
    const { ally, goblin } = squad();
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'turn-guard' });
    b.start();
    const actor = b.active!;
    const wrong = actor.id === 'ally-1' ? 'gob-1' : 'ally-1';
    expect(() => b.attack(wrong, actor.id)).toThrow(/回合/);
  });

  it('中毒持续伤害并最终过期', () => {
    const { ally, goblin } = squad();
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'poison' });
    b.start();
    // 提高血量避免被毒死（死亡单位不再结算状态）
    goblin.base.hpMax = 20;
    goblin.hp = 20;
    goblin.conditions.push({ id: 'poisoned', dur: 2 });
    const hp0 = goblin.hp;
    // 推进若干回合：哥布林的回合开始触发毒伤，回合结束时长递减
    for (let i = 0; i < 8; i++) b.endTurn();
    expect(goblin.hp).toBeLessThan(hp0);
    expect(goblin.conditions.some((c) => c.id === 'poisoned')).toBe(false);
    expect(b.log.some((l) => l.kind === 'condition' && l.text.includes('毒伤'))).toBe(true);
  });

  it('眩晕单位轮到时被跳过', () => {
    const { ally, goblin } = squad();
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'stun' });
    b.start();
    const first = b.byId(b.turnOrder[0]!);
    b.endTurn(); // 先手行动完毕，轮到第二人
    first.conditions.push({ id: 'stunned', dur: 1 });
    b.endTurn(); // 回合推进：轮到 first 时被跳过
    expect(b.log.some((l) => l.text.includes('眩晕'))).toBe(true);
    expect(b.active!.id).not.toBe(first.id);
  });
});

describe('距离、移动与骑射', () => {
  function line() {
    const archer = makeCombatant({
      id: 'arc-1', name: '弓手', side: 'ally', archetype: 'ranged', pos: 0,
      base: { atk: 5, def: 12, spd: 2, hpMax: 20 },
      weapon: { id: 'bow', name: '长弓', baseDice: '1d6+2', tags: ['ranged'], range: 3 },
    });
    const wolf = makeCombatant({
      id: 'wolf-1', name: '座狼', side: 'enemy', archetype: 'mobile', pos: 3,
      base: { atk: 5, def: 13, spd: 5, hpMax: 18 },
      weapon: { id: 'claw', name: '利爪', baseDice: '1d8+2' },
      xpValue: 40,
    });
    return { archer, wolf };
  }

  it('射程校验：超射程与贴身都不能射击', () => {
    const { archer, wolf } = line();
    wolf.pos = 4;
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'rng-far' });
    b.start();
    expect(() => b.attack('arc-1', 'wolf-1', { bypassTurn: true })).toThrow(/超出射程/);
    wolf.pos = 0;
    expect(() => b.attack('arc-1', 'wolf-1', { bypassTurn: true })).toThrow(/贴身/);
    // 近战打不到远距
    expect(() => b.attack('wolf-1', 'arc-1', { bypassTurn: true })).not.toThrow(); // 贴身近战可行
  });

  it('近战距离不足需要先移动', () => {
    const { archer, wolf } = line();
    wolf.pos = 1;
    archer.pos = 0;
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'melee-far' });
    b.start();
    expect(() => b.attack('wolf-1', 'arc-1', { bypassTurn: true })).toThrow(/距离不足/);
    b.move('wolf-1', 'advance', { bypassTurn: true }); // 敌军向左推进贴身
    expect(b.dist(wolf, archer)).toBe(0);
    expect(b.attack('wolf-1', 'arc-1', { bypassTurn: true })).toBeTruthy();
  });

  it('移动后射击 -2，骑射特质免疫', () => {
    const { archer, wolf } = line();
    archer.pos = 1; wolf.pos = 3;
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'moveshoot' });
    b.start();
    b.move('arc-1', 'withdraw', { bypassTurn: true }); // 0→? ally sign +1: 1→2（未被贴身，无借机）
    const res = b.attack('arc-1', 'wolf-1', { bypassTurn: true });
    expect(res.atkDetail).toContain('移动射击');
    // 骑射免疫
    const horseArcher = makeCombatant({
      ...archer, id: 'ha-1', name: '弓骑兵', traits: ['mounted-archer'], pos: 1,
    });
    const b2 = new SmallBattle({ combatants: [horseArcher, wolf], seed: 'moveshoot2', traitRegistry: reg });
    b2.start();
    b2.move('ha-1', 'withdraw', { bypassTurn: true });
    const res2 = b2.attack('ha-1', 'wolf-1', { bypassTurn: true });
    expect(res2.atkDetail).not.toContain('移动射击');
  });

  it('后撤被贴身触发借机攻击；骑射免疫借机', () => {
    const { archer, wolf } = line();
    archer.pos = 2; wolf.pos = 2;
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'opp' });
    b.start();
    b.move('arc-1', 'withdraw', { bypassTurn: true });
    expect(b.log.some((l) => l.text.includes('借机攻击'))).toBe(true);

    const ha = makeCombatant({ ...archer, id: 'ha-2', name: '弓骑', traits: ['mounted-archer'], pos: 2, hp: 20 });
    ha.conditions = [];
    const b2 = new SmallBattle({ combatants: [ha, wolf], seed: 'opp2', traitRegistry: reg });
    b2.start();
    b2.move('ha-2', 'withdraw', { bypassTurn: true });
    expect(b2.log.some((l) => l.text.includes('借机攻击'))).toBe(false);
  });

  it('贴身时远程单位换近战副武器还击；无副武器仍无法武器攻击', () => {
    const { archer, wolf } = line();
    archer.pos = 2; wolf.pos = 2;
    archer.sidearm = { id: 'w2-1', name: '短剑', baseDice: '1d6+2', range: 0 };
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'side-melee', traitRegistry: reg });
    b.start();
    const res = b.attack('arc-1', 'wolf-1', { bypassTurn: true });
    expect(res.atkDetail).not.toContain('武器不善近战');
    expect(b.log.some((l) => l.text.includes('［短剑］'))).toBe(true);

    const { archer: bare, wolf: foe } = line();
    bare.pos = 2; foe.pos = 2;
    const b2 = new SmallBattle({ combatants: [bare, foe], seed: 'side-none' });
    b2.start();
    expect(() => b2.attack('arc-1', 'wolf-1', { bypassTurn: true })).toThrow(/贴身缠斗/);
  });

  it('借机攻击：带副武器的射击单位换刀还击（免武器不善近战罚）', () => {
    const foeArcher = makeCombatant({
      id: 'fa-1', name: '敌弓', side: 'enemy', archetype: 'ranged', pos: 2,
      base: { atk: 5, def: 12, spd: 2, hpMax: 20 },
      weapon: { id: 'bow', name: '长弓', baseDice: '1d6+2', tags: ['ranged'], range: 3 },
      sidearm: { id: 'w2-2', name: '短剑', baseDice: '1d6+2', range: 0 },
    });
    const footman = makeCombatant({
      id: 'ft-1', name: '步兵', side: 'ally', archetype: 'infantry', pos: 2,
      base: { atk: 5, def: 13, spd: 3, hpMax: 22 },
      weapon: { id: 'sword', name: '长剑', baseDice: '1d8+3' },
    });
    const b = new SmallBattle({ combatants: [footman, foeArcher], seed: 'opp-side', traitRegistry: reg });
    b.start();
    b.move('ft-1', 'withdraw', { bypassTurn: true });
    const opp = b.log.find((l) => l.text.includes('借机攻击'));
    expect(opp).toBeTruthy();
    expect(opp!.resolution!.atkDetail).not.toContain('武器不善近战');
  });

  it('撤离战场：距离≥2 成功并移出战斗，贴身失败', () => {
    const { archer, wolf } = line();
    archer.pos = 2; wolf.pos = 2;
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'flee' });
    b.start();
    expect(() => b.retreat('arc-1', { bypassTurn: true })).toThrow(/距离不足/);
    wolf.pos = 4;
    b.retreat('arc-1', { bypassTurn: true });
    expect(archer.status).toBe('fled');
    expect(b.isOver()).toBe(true); // 友方全部离场 → 判负
    expect(b.winner()).toBe('enemy');
  });

  it('冲锋：机动单位距目标≥2 贴身重击，近战单位不能冲锋', () => {
    const { archer, wolf } = line();
    archer.pos = 0; wolf.pos = 3;
    const b = new SmallBattle({ combatants: [archer, wolf], seed: 'charge-s' });
    b.start();
    expect(() => b.attack('arc-1', 'wolf-1', { bypassTurn: true, charge: true })).toThrow(/冲锋/);
    const res = b.attack('wolf-1', 'arc-1', { bypassTurn: true, charge: true });
    expect(res.hit).toBeDefined();
    expect(wolf.pos).toBe(archer.pos); // 冲锋贴身
  });

  it('autoAction 自动推进直到战斗结束', () => {
    const { ally, goblin } = squad();
    goblin.base.hpMax = 7; goblin.hp = 7;
    const b = new SmallBattle({ combatants: [ally, goblin], seed: 'auto-act' });
    b.start();
    let guard = 0;
    while (!b.isOver() && guard++ < 60) {
      b.autoAction(b.active!.id);
    }
    expect(b.isOver()).toBe(true);
  });
});
