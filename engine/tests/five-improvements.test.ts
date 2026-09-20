import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, generatedField, V2_D20, V2_TW, traitRegistry, previewAttack, diceAvg,
  fatigueAfter, abilityTargetReason, type Combatant, type GenerateInput } from '../src/index.js';
import { v2DamageAmount, roundDamage, damageMoments } from '../src/probability.js';
import { calibrateAutocannon } from '../src/gen/equipment.js';
import { calibrateSavedWeaponRanges, prepareInventoryState } from '../../panel/src/inventory-state.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
const make = (id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}): Combatant => {
  const u = generateUnit({ name: id, side, rulesVersion: 'v2', scale: 'hero', level: 5, weaponClass: 'rifle', weaponLevel: 5, armorTier: 0, traits: [], ...extra }, { seed: id, noVariance: true, registry }).unit;
  u.id = id; return u;
};
function grid(extra: Partial<GenerateInput> = {}, distance = 6) {
  const field = generatedField('five'); field.tiles.fill('open');
  const a = make('a', 'ally', extra), b = make('b', 'enemy', { hpMax: 500, scale: extra.scale ?? 'hero' });
  const battle = new SmallBattle({ combatants: [a, b], battlefield: field, rules: V2_D20, seed: 'five', traitRegistry: registry });
  battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 73; b.pos = 73 - 7 * distance;
  return { a, b, battle };
}
describe('五项平衡调整', () => {
  it('小额穿透保留完整期望，不给每段强制保底，零伤害不多掷随机数', () => {
    const raw = v2DamageAmount(3, 0, 0.12, 1); expect(raw).toBe(0.36);
    expect(roundDamage(raw, { next: () => 0.35 })).toBe(1); expect(roundDamage(raw, { next: () => 0.36 })).toBe(0);
    expect(roundDamage(0, { next: () => { throw Error('零伤害不应抽样'); } })).toBe(0);
    const moments = damageMoments('1d6', undefined, 1, 0.12, 1)!;
    expect(moments.mean).toBeCloseTo(0.42); expect(moments.second).toBeCloseTo(0.42); expect(moments.max).toBe(1); expect(moments.positive).toBeCloseTo(0.42);
    const a = make('a', 'ally', { scale: 'company', weaponLevel: 1 }), b = make('b', 'enemy', { scale: 'company', armorTier: 4, armorLevel: 1 });
    const p = previewAttack({ attacker: a, defender: b, rules: V2_TW, ranged: true, conditionDefs: new Map() });
    expect(p.penetrationFactor).toBe(0.12); expect(p.expectedDamage).toBeGreaterThan(0); expect(p.expectedDamage).toBeLessThan(1);
    const single = previewAttack({ attacker: a, defender: b, rules: V2_TW, ranged: true, conditionDefs: new Map(), weaponOverride: { ...a.weapon!, attacks: 1 } });
    expect(single.damageChance).toBeCloseTo(single.expectedDamage);
    b.armor!.protection!.kinetic++;
    expect(previewAttack({ attacker: a, defender: b, rules: V2_TW, ranged: true, conditionDefs: new Map() }).expectedDamage).toBe(0);
  });
  it('概率取整跟随战斗种子保存恢复，血量始终为整数', () => {
    const { a, b, battle } = grid({ weaponLevel: 1 }, 5); b.armor!.protection!.kinetic = 4;
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry });
    battle.attack(a.id, b.id); restored.attack(a.id, b.id);
    expect(restored.toSnapshot()).toEqual(battle.toSnapshot()); expect(Number.isInteger(b.hp)).toBe(true);
  });
  it('机炮提高总预算与穿透，三段合计不会变成三份完整火力', () => {
    const rifle = make('r', 'ally'), cannon = make('c', 'ally', { weaponClass: 'autocannon', scale: 'company' });
    const total = diceAvg(cannon.weapon!.baseDice) * 3, rifleTotal = diceAvg(rifle.weapon!.baseDice) * 2;
    expect(total).toBeGreaterThan(rifleTotal * 1.15); expect(total).toBeLessThan(rifleTotal * 1.5);
    expect(cannon.weapon!.penetration).toBe(rifle.weapon!.penetration! + 1); expect(cannon.weapon!.load).toBe(6);
  });
  it('旧机炮配方一次升级，库存和档案一起更新且身份不变', () => {
    const u = make('a', 'ally', { weaponClass: 'autocannon', scale: 'company' });
    u.weapon!.recipe!.version = 'mechanism-v2.3'; u.weapon!.baseDice = '1d6+2'; u.weapon!.penetration = 4;
    const save = prepareInventoryState({ storage: [unitRecordFromCombatant(u)], rosterIds: ['a'] });
    calibrateSavedWeaponRanges(save); const after = JSON.stringify(save); calibrateSavedWeaponRanges(save); expect(JSON.stringify(save)).toBe(after);
    const stored = save.storage![0]!.snapshot!.weapon!;
    expect(stored.penetration).toBe(5); expect(stored.id).toBe(u.weapon!.id); expect(stored.recipe!.seed).toBe(u.weapon!.recipe!.seed);
    expect(save.inventory!.find((i) => i.mechanics?.kind === 'weapon')!.mechanics).toEqual({ kind: 'weapon', value: stored });
    const old = structuredClone(u.weapon!); calibrateAutocannon(old); expect(old.baseDice).toBe(stored.baseDice);
  });
  it('攻击法术在7格预览和实际可用，AI主动施放；原技能配方与会战距离不被覆盖', () => {
    const { a, b, battle } = grid({ weaponClass: 'magic', abilityBlueprints: ['bp-arcane-bolt', 'bp-mending'] });
    const bolt = a.abilities[0]!;
    expect(bolt.range!.max).toBe(3); expect(battle.getActionOptions('a').find((o) => o.id === bolt.id)?.range?.max).toBe(7);
    expect(abilityTargetReason({ actor: a, ability: bolt, target: b, distance: 4 })).toContain('射程');
    battle.autoAction('a'); expect(battle.log.some((e) => e.kind === 'ability' && e.text.includes('奥术箭'))).toBe(true);
    expect(a.resources.SP).toBe(20); expect(bolt.range!.max).toBe(3);
  });
  it('会战森林的普通射击与武器技法都按8人展开', () => {
    for (const skill of [false, true]) {
      const a = make('a', 'ally', { scale: 'company', hpMax: 100, abilityBlueprints: ['generic:physical-single:ranged'] }), b = make('b', 'enemy', { scale: 'company', hpMax: 100 });
      const battle = new MassBattle({ combatants: [a, b], rules: V2_TW, field: { tags: ['forest'] }, traitRegistry: registry, rng: { seed: 'hit', next: () => 0, d: (n) => n } }); battle.start();
      const order = skill ? { unitId: 'a', type: 'ability' as const, abilityId: a.abilities[0]!.id, targetId: 'b' } : { unitId: 'a', type: 'volley' as const, targetId: 'b' };
      expect(battle.issue(order).ok).toBe(true); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound();
      expect(battle.log.find((e) => e.resolution?.attackerId === 'a')?.resolution?.participants).toBe(8);
    }
  });
  it('普通行动8次才满疲劳，冲锋更费力，耐力与休整规则一致', () => {
    const unit = make('a', 'ally');
    for (let n = 0; n < 4; n++) unit.fatigue = fatigueAfter(unit, 1); expect(unit.fatigue).toBe(2);
    for (let n = 0; n < 4; n++) unit.fatigue = fatigueAfter(unit, 1); expect(unit.fatigue).toBe(4);
    expect(fatigueAfter(unit, 0)).toBe(3);
    unit.fatigue = 0; expect(fatigueAfter(unit, 2)).toBe(1); unit.traits.push('fatigue-trained'); expect(fatigueAfter(unit, 1)).toBe(0.25);
  });
});
