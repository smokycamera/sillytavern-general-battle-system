import { compileArmor } from '../src/gen/equipment.js';
import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, formationNode, diceAvg, type Combatant } from '../src/index.js';
const registry = traitRegistry(), rng = { seed: 'hit', next: () => 0, d: (n: number) => Math.min(n, 10) };
function unit(id: string, stable = false): Combatant {
  const result = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'company', body: 'vehicle', level: 3, hpMax: 500, weaponClass: 'cannon', weaponStabilized: stable, armorTier: 0, traits: [] }, { seed: id, registry, noVariance: true }).unit;
  result.id = id; result.morale = result.base.moraleMax = 100; result.base.atk = 5; return result;
}
function small(a: Combatant, b: Combatant) {
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [a, b], battlefield: field, rules: V2_D20, rng, traitRegistry: registry }); battle.start(); battle.turnOrder = [a.id, b.id]; battle.turnIndex = 0; a.pos = 45; b.pos = 24; return battle;
}
function mass(a: Combatant, b: Combatant) {
  const battle = new MassBattle({ combatants: [a, b], rules: V2_TW, rng, traitRegistry: registry }); battle.start(); return battle;
}
describe('车辆武器稳定与防护构型', () => {
  it('稳定车载武器让出火力换行进射击，两模式真移动并保留主任务和装填，骑乘不能使用', () => {
    expect(diceAvg(unit('a', true).weapon!.baseDice)).toBeLessThan(diceAvg(unit('a').weapon!.baseDice));
    // 新建规格可保留稳定属性；实际行进射击仍由下方车辆与骑乘运行时断言约束。
    const rider = generateUnit({ name: '骑手', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', mount: true, traits: ['mounted-archer'], weaponClass: 'rifle', weaponStabilized: true }, { seed: 'illegal', registry }).unit;
    expect(rider.body).toBe('human'); expect(rider.mount).toBe(true);
    for (const stable of [false, true]) {
      const a = unit('a', stable), b = unit('b'); a.traits.push('mounted-archer');
      const grid = small(a, b); grid.moveTo(a.id, 52); const result = grid.attack(a.id, b.id);
      expect(result.atkDetail.includes('移动射击')).toBe(!stable); expect(grid.reloadCd.get(a.id)).toBe(2); expect(grid.actedThisTurn.has(a.id)).toBe(true);
      const actor = unit('a', stable), target = unit('b'); actor.tags = target.tags = ['zone:中军', 'rank:reserve'];
      actor.weapon!.range = 4; // 两侧预备列相隔5阵距，明确制造需要行进射击的场景。
      const army = mass(actor, target), order = { unitId: actor.id, type: 'volley' as const, targetId: target.id };
      expect(army.orderPreview(order).vehicleMove?.id).toBe(stable ? 'ally:中军:rear' : undefined); expect(army.issue(order).ok).toBe(stable);
      if (stable) { army.issue({ unitId: target.id, type: 'hold' }); army.resolveRound(); expect(formationNode(actor).rank).toBe('rear'); expect(actor.fatigue).toBe(0.5); expect(army.reloadCd.get(actor.id)).toBe(1); expect(army.log.filter((l) => l.resolution?.attackerId === actor.id)).toHaveLength(1); }
    }
  });
  it('专项防护在同预算内转移，抗热降低真实热能伤害并让出动能防护，两模式预览与结算同源', () => {
    const context = { id: 'armor', seed: 'armor', body: 'vehicle' as const, noVariance: true }, balanced = compileArmor({ tier: 3, power: 7 }, context), thermal = compileArmor({ tier: 3, power: 7, profile: 'thermal' }, context);
    expect(Object.values(thermal.protection!).reduce((a, b) => a + b, 0)).toBe(Object.values(balanced.protection!).reduce((a, b) => a + b, 0));
    expect(thermal.protection!.kinetic).toBeLessThan(balanced.protection!.kinetic);
    for (const mode of ['small', 'mass']) for (const focused of [false, true]) {
      const a = unit('a'), b = unit('b'); a.weapon!.channel = 'thermal'; a.weapon!.penetration = 4; b.armor = structuredClone(focused ? thermal : balanced);
      a.base.atk = 10; // 固定命中以单独验证通道防护；重甲现在自动提供防御+1。
      const battle = mode === 'small' ? small(a, b) : mass(a, b);
      if (battle instanceof SmallBattle) { const preview = battle.getActionOptions(a.id).find((o) => o.id === 'weapon')!.targets![0]!.preview!; expect(preview.penetrationFactor).toBe(focused ? 0.12 : 0.55); expect(battle.attack(a.id, b.id).penetrationFactor).toBe(focused ? 0.12 : 0.55); }
      else { const order = { unitId: a.id, type: 'volley' as const, targetId: b.id }; expect(battle.orderPreview(order).preview!.penetrationFactor).toBe(focused ? 0.12 : 0.55); battle.issue(order); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(); expect(battle.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!.penetrationFactor).toBe(focused ? 0.12 : 0.55); }
    }
  });
});
