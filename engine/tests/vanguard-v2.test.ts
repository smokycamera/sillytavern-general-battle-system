import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, deployOnGrid, formationNode, traitRegistry, V2_D20, V2_TW, type Combatant } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], traits: string[] = []) {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'sword', weaponLevel: 3, armorTier: 1, traits }, { registry, seed: id, noVariance: true }).unit; u.id = id; return u;
}
describe('先锋实际部署', () => {
  it('真实小战开局和恢复只部署一次，来源到期后下一场恢复常规域', () => {
    const a = unit('a', 'ally'), b = unit('b', 'enemy');
    a.traitSources = [{ id: 'forward-source', name: '先遣训练', kind: 'blessing', traitIds: ['vanguard'], duration: { kind: 'battles', count: 1 }, remaining: 1 }];
    const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: standardField(), seed: 'real-vanguard' }); battle.start();
    expect(Math.floor(a.pos! / 7)).toBe(5); expect(battle.movementLeft(a.id)).toBe(battle.movementBudget(a.id)); expect(a.hp).toBe(500);
    const snapshot = JSON.stringify(battle.toSnapshot()); battle.start(); expect(JSON.stringify(battle.toSnapshot())).toBe(snapshot);
    const restored = SmallBattle.fromSnapshot(JSON.parse(snapshot)); restored.start(); expect(JSON.stringify(restored.toSnapshot())).toBe(snapshot);
    a.traitSources[0]!.remaining = 0; const next = materializeUnitRecord(unitRecordFromCombatant(a), registry);
    new SmallBattle({ rules: V2_D20, combatants: [next, unit('b', 'enemy')], battlefield: standardField(), seed: 'after-source' }).start(); expect(Math.floor(next.pos! / 7)).toBe(6);
  });
  it('会战拥挤预部署整批拒绝，来源不能引用另一阵营位置', () => {
    const units = Array.from({ length: 4 }, (_, i) => unit('a' + i, 'ally', ['vanguard'])); units.push(unit('b', 'enemy'));
    const battle = new MassBattle({ rules: V2_TW, combatants: units, seed: 'overfull' }); const before = JSON.stringify(battle.toSnapshot());
    expect(() => battle.start()).toThrow('容量'); expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    const a = unit('a', 'ally'); a.vanguardOrigin = 'enemy:中军:reserve';
    expect(() => new MassBattle({ rules: V2_TW, combatants: [a, unit('b', 'enemy')], seed: 'wrong-side' })).toThrow('跨阵营');
  });
  it('两种小战地图扩大先锋前出域，双方不共格、不直接占任务格', () => {
    for (const [width, height] of [[7, 9], [5, 7]]) {
      const field = standardField(width, height), a = unit('a', 'ally', ['vanguard']), b = unit('b', 'enemy', ['vanguard']);
      const cells = deployOnGrid(field, [a, b]);
      expect(Math.floor(cells[0]! / width!)).toBe(height! - 4); expect(Math.floor(cells[1]! / width!)).toBe(3);
      expect(cells[0]).not.toBe(cells[1]); expect(cells).not.toContain(field.objective.cell); expect(a.pos).toBeUndefined();
      const ordinary = deployOnGrid(field, [unit('a', 'ally'), unit('b', 'enemy')]); expect(ordinary).not.toEqual(cells);
      const invalid = { ...a, pos: 0 }; const before = JSON.stringify([invalid, b]);
      expect(() => deployOnGrid(field, [invalid, b])).toThrow('部署越界'); expect(JSON.stringify([invalid, b])).toBe(before);
    }
  });
  it('显式合法前出位置保留且优先占位，过量部署原子拒绝', () => {
    const field = standardField(), a = unit('z-fixed', 'ally', ['vanguard']); a.pos = 35; a.body = 'vehicle';
    const b = unit('a-auto', 'ally', ['vanguard']); b.body = 'vehicle';
    expect(deployOnGrid(field, [b, a])[1]).toBe(35);
    const units = Array.from({ length: 100 }, (_, i) => ({ ...b, id: String(i) })); const before = JSON.stringify(units);
    expect(() => deployOnGrid(field, units)).toThrow(); expect(JSON.stringify(units)).toBe(before);
  });
  it('会战先锋在己方前出一层，开局/重开不累计推进，档案保留部署偏好', () => {
    const a = unit('a', 'ally', ['vanguard']), b = unit('b', 'enemy'); a.tags.push('rank:reserve');
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], seed: 'vanguard' }); battle.start();
    expect(formationNode(a).rank).toBe('rear'); expect(formationNode(a).side).toBe('ally'); expect(a.fatigue).toBe(0);
    const snapshot = JSON.stringify(battle.toSnapshot()); battle.start(); expect(JSON.stringify(battle.toSnapshot())).toBe(snapshot);
    const restored = MassBattle.fromSnapshot(JSON.parse(snapshot)); restored.start(); expect(JSON.stringify(restored.toSnapshot())).toBe(snapshot);
    const record = unitRecordFromCombatant(a); expect(record.rank).toBe('reserve'); expect(record.snapshot?.vanguardOrigin).toBeUndefined();
    const next = materializeUnitRecord(record, registry), enemy = unit('b', 'enemy');
    new MassBattle({ rules: V2_TW, combatants: [next, enemy], seed: 'next' }).start(); expect(formationNode(next).rank).toBe('rear');
  });
  it('会战前线先锋可先遣到己方侧翼，随队个人不带宿主免费前出', () => {
    const a = unit('a', 'ally', ['vanguard']), b = unit('b', 'enemy'), hero = unit('hero', 'enemy', ['vanguard']); hero.scale = 'hero'; b.tags.push('rank:reserve');
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b, hero], seed: 'flanks' }); battle.start();
    expect(formationNode(a).wing).not.toBe('中军'); expect(formationNode(a).side).toBe('ally'); expect(formationNode(b).rank).toBe('reserve');
    expect(formationNode(hero).id).toBe(formationNode(b).id); expect(hero.vanguardOrigin).toBeUndefined();
  });
});
