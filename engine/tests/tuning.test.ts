/**
 * v0.6 调优回归：濒死沙包修复 / 贴边脱离 / burst 溅射 / 机动冲锋倾向 / 40K T4 护甲。
 * 每条对应场景矩阵模拟中发现的病理样本（engine/sim/matrix.sim.ts 可复现）。
 */
import { describe, it, expect } from 'vitest';
import { SmallBattle } from '../src/small/battle';
import { MassBattle } from '../src/mass/battle';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { SYSTEM_PACKS } from '../src/rules';

const reg = traitRegistry();

const gen = (over: Partial<Parameters<typeof generateUnit>[0]> & Pick<Parameters<typeof generateUnit>[0], 'name' | 'side' | 'scale'>) =>
  generateUnit({ level: 3, traits: [], era: 'medieval', ...over } as Parameters<typeof generateUnit>[0], { seed: 'tuning', registry: reg }).unit;

describe('濒死单位不再是沙包', () => {
  it('autoAction 不再围殴濒死目标（索敌只看 ready）', () => {
    const ally = gen({ name: '我方英雄', scale: 'hero', archetype: 'infantry', side: 'ally' });
    const foeHero = gen({ name: '敌方英雄', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    const foeMook = gen({ name: '敌兵', scale: 'mook', archetype: 'infantry', side: 'enemy' });
    ally.base.hpMax = 1;
    ally.hp = 0;
    ally.status = 'dying'; // 已倒地
    foeHero.base.atk = 30;
    const b = new SmallBattle({ combatants: [ally, foeHero, foeMook], seed: 'bag', traitRegistry: reg });
    b.start();
    // 敌方英雄行动：目标应是活着的敌兵（或向其移动），而不是 0 血濒死者
    b.turnIndex = b.turnOrder.indexOf(foeHero.id);
    b.autoAction(foeHero.id);
    expect(ally.hp).toBe(0);
    expect(ally.status).toBe('dying'); // 未被补刀
    const attackedDying = b.log.some((l) => l.kind === 'attack' && l.text.includes('→ 我方英雄'));
    expect(attackedDying).toBe(false);
    expect(foeMook.status === 'dead' || b.log.some((l) => l.kind === 'move' && l.text.includes('敌方英雄'))).toBe(true);
  });

  it('濒死单位再受一击彻底离场（补刀）', () => {
    const ally = gen({ name: '我方英雄', scale: 'hero', archetype: 'infantry', side: 'ally' });
    const foe = gen({ name: '敌方英雄', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    foe.base.atk = 30;
    ally.hp = 0;
    ally.status = 'dying';
    ally.pos = 2;
    foe.pos = 2;
    const b = new SmallBattle({ combatants: [ally, foe], seed: 'finish', traitRegistry: reg });
    b.start();
    // 天然 1 必失手（5%）：重复补刀直到命中
    for (let i = 0; i < 10 && ally.status === 'dying'; i++) {
      b.attack(foe.id, ally.id, { bypassTurn: true });
    }
    expect(ally.status).toBe('dead');
    expect(b.log.some((l) => l.text.includes('伤重不治'))).toBe(true);
    expect(b.winner()).toBe('enemy');
  });
});

describe('贴边脱离', () => {
  it('被贴身且退无可退：侧身脱离，承接借机攻击并拉开 1 格', () => {
    const archer = gen({ name: '弓手', scale: 'hero', archetype: 'ranged', side: 'ally', loadout: 'ranged' });
    const brute = gen({ name: '蛮兵', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    archer.pos = 0;
    brute.pos = 0;
    const b = new SmallBattle({ combatants: [archer, brute], seed: 'disengage', traitRegistry: reg });
    b.start();
    expect(() => b.move(archer.id, 'withdraw', { bypassTurn: true })).not.toThrow();
    expect(archer.pos).toBe(1);
    expect(b.log.some((l) => l.text.includes('贴边脱离'))).toBe(true);
    expect(b.log.some((l) => l.text.includes('借机攻击'))).toBe(true);
  });

  it('未被贴身时退至边缘仍然报错（合法挡板保留）', () => {
    const archer = gen({ name: '弓手', scale: 'hero', archetype: 'ranged', side: 'ally', loadout: 'ranged' });
    const brute = gen({ name: '蛮兵', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    archer.pos = 0;
    brute.pos = 2;
    const b = new SmallBattle({ combatants: [archer, brute], seed: 'edge', traitRegistry: reg });
    b.start();
    expect(() => b.move(archer.id, 'withdraw', { bypassTurn: true })).toThrow('已退至战场边缘');
  });
});

describe('覆盖形态溅射', () => {
  it('burst 技能对主目标 1 格内敌人溅射（威力减半），日志带（溅射）', () => {
    const mage = gen({
      name: '焰法师', scale: 'hero', archetype: 'ranged', side: 'ally', level: 5,
      loadout: 'ranged', abilityBlueprints: ['bp-firestorm'],
    });
    const foes = [1, 2, 3].map((i) => gen({ name: `敌兵${i}`, scale: 'mook', archetype: 'infantry', side: 'enemy' }));
    mage.pos = 0;
    foes[0]!.pos = 2; // 主目标
    foes[1]!.pos = 1; // 溅射位
    foes[2]!.pos = 3; // 溅射位
    const b = new SmallBattle({ combatants: [mage, ...foes], seed: 'splash', traitRegistry: reg });
    b.start();
    const firestorm = mage.abilities.find((a) => a.id === 'bp-firestorm')!;
    const r = b.useAbility(mage.id, firestorm.id, foes[0]!.id, { bypassTurn: true });
    expect(r.ok).toBe(true);
    expect(b.log.some((l) => l.text.includes('（溅射）'))).toBe(true);
    // 溅射目标（1 血杂兵）至少倒下一个
    expect(foes.slice(1).some((f) => f.status === 'dead')).toBe(true);
  });

  it('单体目标无可蔓延：保留第二段全额结算（（覆盖）行为不变）', () => {
    const mage = gen({
      name: '焰法师', scale: 'hero', archetype: 'ranged', side: 'ally', level: 5,
      loadout: 'ranged', abilityBlueprints: ['bp-firestorm'],
    });
    const foe = gen({ name: '靶子', scale: 'hero', archetype: 'infantry', side: 'enemy', level: 5 });
    foe.base.hpMax = 200;
    foe.hp = 200;
    const b = new SmallBattle({ combatants: [mage, foe], seed: 'focus', traitRegistry: reg });
    b.start();
    const firestorm = mage.abilities.find((a) => a.id === 'bp-firestorm')!;
    b.useAbility(mage.id, firestorm.id, foe.id, { bypassTurn: true });
    expect(b.log.some((l) => l.text.includes('（覆盖）'))).toBe(true);
    expect(b.log.some((l) => l.text.includes('（溅射）'))).toBe(false);
  });
});

describe('机动冲锋倾向与 40K 护甲', () => {
  it('未接战的机动+射击单位：autoOrders 会混用冲锋与齐射', () => {
    let charges = 0;
    let volleys = 0;
    for (let i = 0; i < 30; i++) {
      const ha = gen({ name: '骑射连', scale: 'company', archetype: 'mobile', side: 'ally', level: 3, loadout: 'ranged' });
      const foe = gen({ name: '敌步连', scale: 'company', archetype: 'infantry', side: 'enemy', level: 3 });
      const b = new MassBattle({ combatants: [ha, foe], seed: `charge-${i}`, traitRegistry: reg });
      b.start();
      b.autoOrders('ally');
      const type = b.orders.get(ha.id)!.type;
      if (type === 'charge') charges++;
      if (type === 'volley') volleys++;
    }
    expect(charges).toBeGreaterThanOrEqual(3); // 40% 期望 ≈ 12
    expect(volleys).toBeGreaterThanOrEqual(3);
  });

  it('战锤40K T4 护甲降至 0.65（磨血调优）', () => {
    expect(SYSTEM_PACKS.w40k!.small.armorDR[4]).toBe(0.65);
    expect(SYSTEM_PACKS.w40k!.small.armorDR[4]).toBeGreaterThan(SYSTEM_PACKS.w40k!.small.armorDR[3]!);
  });
});
