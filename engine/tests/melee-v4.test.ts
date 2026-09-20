import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, V3_D20, V3_TW, V4_D20, V4_TW, standardField,
  prepareCombatModel, resolveAttack, previewAttack, standardConditionMap, anchoredWeapon, type Combatant, type RulePack } from '../src/index.js';
import { compileWeapon } from '../src/gen/equipment.js';
import { gridWeapon, gridWeaponRange } from '../src/small/weapon-range.js';
import { formationWeaponRange } from '../src/melee.js';
import { skillAttack } from '../src/skill-attack.js';
import { itemDescription } from '../../panel/src/inventory-view.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
const hitRng = { seed: 'melee-hit', next: () => 0, d: (s: number) => s === 20 ? 15 : 4 };
const weapon = (mechanism: string, power = 4) => compileWeapon({ mechanism, power }, { id: mechanism, seed: 'fixed', quality: 3, noVariance: true });
function unit(id: string, side: 'ally' | 'enemy', mechanism = 'sword', group = false): Combatant {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: group ? 'company' : 'hero', level: 4,
    weaponClass: mechanism, weaponLevel: 4, armorTier: 3, armorLevel: 4, hpMax: group ? 2 : 1000, traits: [],
    abilityBlueprints: [{ id: 'generic:physical-single:melee', level: 4 }] }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
function small(mechanism = 'spear', rules: RulePack = V4_D20) {
  const a = unit('a', 'ally', mechanism), d = unit('d', 'enemy', 'axe');
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, d], battlefield: field, rules, seed: 'melee', rng: hitRng, traitRegistry: registry });
  b.start(); b.turnOrder = ['a', 'd']; b.turnIndex = 0; a.pos = 30; d.pos = 16;
  return { b, a, d };
}
function mass(mechanism = 'spear', rules: RulePack = V4_TW) {
  const a = unit('a', 'ally', mechanism, true), d = unit('d', 'enemy', 'axe', true);
  a.tags.push('zone:中军', 'rank:rear'); d.tags.push('zone:中军', 'rank:front');
  const b = new MassBattle({ combatants: [a, d], rules, seed: 'melee', rng: hitRng, traitRegistry: registry }); b.start();
  return { b, a, d };
}
function options(a: Combatant, d: Combatant, rules = V4_D20, distance = 1) {
  return { attacker: a, defender: d, rules, ranged: false, distance, conditionDefs, traitRegistry: registry };
}
describe('V4近战武器差异化', () => {
  it('长兵器能从2格攻击，剑斧锤只触及1格；预览和实际一致且库存不变', () => {
    const { b, a, d } = small(), original = JSON.stringify(a.weapon);
    for (const mechanism of ['sword', 'axe', 'blunt']) {
      a.weapon = weapon(mechanism);
      expect(b.getActionOptions(a.id).find(o => o.id === 'weapon')!.targets![0]!.enabled).toBe(false);
      expect(() => b.attack(a.id, d.id)).toThrow('武器触及1');
    }
    a.weapon = JSON.parse(original);
    const action = b.getActionOptions(a.id).find(o => o.id === 'weapon')!;
    expect(action.range!.max).toBe(2); expect(action.targets![0]!.enabled).toBe(true);
    const preview = action.targets![0]!.preview!, result = b.attack(a.id, d.id);
    expect(result.netAtk).toBe(preview.attackScore); expect(result.penetration).toBe(preview.penetration);
    expect(result.finalDamage).toBeGreaterThan(0); expect(JSON.stringify(a.weapon)).toBe(original);
    expect(gridWeaponRange(gridWeapon(a.weapon))).toBe(2);
  });
  it('长兵器不能穿墙；贴身后命中降低2，实际结算保留惩罚明细', () => {
    const { b, a, d } = small(); b.battlefield!.tiles[23] = 'wall';
    expect(() => b.attack(a.id, d.id)).toThrow('视线'); b.battlefield!.tiles[23] = 'open';
    const distant = b.getActionOptions(a.id).find(o => o.id === 'weapon')!.targets![0]!.preview!;
    d.pos = 23;
    const close = b.getActionOptions(a.id).find(o => o.id === 'weapon')!.targets![0]!.preview!;
    expect(close.attackScore).toBe(distant.attackScore! - 2);
    const result = b.attack(a.id, d.id); expect(result.netAtk).toBe(close.attackScore); expect(result.atkDetail).toContain('长柄贴身受限');
  });
  it.each([V4_D20, V4_TW])('$id 同级重甲下剑/长柄30%、斧55%、锤100%通过，穿透改变实际生命损失', rules => {
    const a = unit('a', 'ally'), d = unit('d', 'enemy', 'axe'); prepareCombatModel(a, rules); prepareCombatModel(d, rules);
    const rows = ['sword', 'spear', 'axe', 'blunt'].map(mechanism => {
      a.weapon = weapon(mechanism); d.hp = 1000;
      const opts = options(a, d, rules, 2), preview = previewAttack(opts), result = resolveAttack({ ...opts, rng: hitRng });
      expect(result.penetration).toBe(preview.penetration); expect(result.penetrationFactor).toBe(preview.penetrationFactor);
      return result;
    });
    expect(rows.map(r => r.penetration)).toEqual([8, 8, 9, 10]);
    expect(rows.map(r => r.penetrationFactor)).toEqual([0.3, 0.3, 0.55, 1]);
    expect(rows[3]!.finalDamage).toBeGreaterThan(rows[2]!.finalDamage);
    expect(rows[2]!.finalDamage).toBeGreaterThan(rows[0]!.finalDamage);
  });
  it.each([V4_D20, V4_TW])('$id 剑命中与格挡各+1，缴械/失能失去格挡，射击和独立魔法不享受剑术', rules => {
    const a = unit('a', 'ally'), d = unit('d', 'enemy'); prepareCombatModel(a, rules); prepareCombatModel(d, rules);
    const opts = options(a, d, rules), sword = previewAttack(opts);
    const neutral = { ...weapon('sword'), recipe: undefined, tags: [] };
    expect(sword.attackScore).toBe(previewAttack({ ...opts, weaponOverride: neutral }).attackScore! + 1);
    expect(sword.defenseModifiers).toContain('剑术格挡');
    for (const id of ['disarmed', 'stunned']) {
      d.conditions = [{ id, dur: 2 }];
      expect(previewAttack(opts).defenseScore).toBe(sword.defenseScore! - 1);
      expect(previewAttack(opts).defenseModifiers).not.toContain('剑术格挡');
    }
    d.conditions = []; d.status = 'dying'; expect(previewAttack(opts).defenseModifiers).not.toContain('剑术格挡'); d.status = 'ready';
    const ranged = previewAttack({ ...opts, weaponOverride: weapon('rifle'), ranged: true });
    expect(ranged.defenseModifiers).not.toContain('剑术格挡'); expect(ranged.attackModifiers).not.toContain('近战武器操控');
    const spell = previewAttack({ ...opts, abilityDamage: { baseDice: '1d6', channel: 'arcane', penetration: 8 } });
    expect(spell.attackModifiers).not.toContain('近战武器操控'); expect(spell.defenseModifiers).not.toContain('剑术格挡');
    expect(resolveAttack({ ...opts, rng: hitRng }).targetDef).toBe(sword.defenseScore);
  });
  it('会战长柄可从己方后排支援，剑不可；敌方前线仍能掩护后排，技能也不能绕过', () => {
    const { b, a, d } = mass();
    const order = { unitId: a.id, type: 'attack' as const, targetId: d.id };
    expect(b.orderPreview(order).reason).toBeUndefined(); expect(b.canMeleeReach(a, d)).toBe(true);
    const spear = a.weapon; a.weapon = weapon('sword'); expect(b.orderPreview(order).reason).toContain('可及范围'); a.weapon = spear;
    const preview = b.orderPreview(order).preview!; expect(b.issue(order).ok).toBe(true); b.issue({ unitId: d.id, type: 'hold' }); b.resolveRound();
    const result = b.log.find(e => e.resolution?.attackerId === a.id)!.resolution!;
    expect(result.netAtk).toBe(preview.attackScore); expect(result.finalDamage).toBeGreaterThan(0);
    const screened = mass(); screened.a.formationPosition = 'ally:中军:front'; screened.d.formationPosition = 'enemy:中军:rear';
    const guard = unit('guard', 'enemy', 'sword', true); guard.formationPosition = 'enemy:中军:front'; prepareCombatModel(guard, V4_TW); screened.b.combatants.push(guard);
    expect(screened.b.orderPreview(order).reason).toContain('前线掩护');
    expect(screened.b.orderPreview({ unitId: 'a', type: 'ability', targetId: 'd', abilityId: screened.a.abilities[0]!.id }).reason).toContain('前线掩护');
  });
  it('副武器长柄和武器技法继承距离/穿透，独立法术不借用破甲加成', () => {
    const { b, a, d } = small('rifle'); a.sidearm = weapon('spear');
    expect(b.getActionOptions(a.id).find(o => o.id === 'weapon:sidearm')!.targets![0]!.enabled).toBe(true);
    const ability = a.abilities[0]!, action = b.getActionOptions(a.id).find(o => o.id === ability.id)!;
    expect(action.range!.max).toBe(2); expect(action.targets![0]!.enabled).toBe(true);
    const result = b.useAbility(a.id, ability.id, d.id); expect(result.ok).toBe(true); expect(result.resolutions[0]!.penetration).toBe(8);
    a.sidearm = weapon('blunt');
    const effect = ability.effects.find(e => e.op === 'damage')!;
    if (effect.op !== 'damage') throw Error('missing damage');
    const params = skillAttack(b.observationContext(), a, d, ability, effect);
    expect(params.abilityDamage!.penetration).toBe(10);
    expect(previewAttack({ ...options(a, d), ...params }).penetration).toBe(10);
    expect(previewAttack({ ...options(a, d), abilityDamage: { baseDice: '1d6', penetration: 7 } }).penetration).toBe(7);
  });
  it('强化与近战性质只叠加一次，投影与快照恢复不重掷或修改实物', () => {
    const { b, a } = small('blunt'), original = JSON.stringify(a.weapon);
    const projected = anchoredWeapon(a.weapon)!;
    expect(anchoredWeapon(projected)).toBe(projected);
    const enhanced = compileWeapon({ mechanism: 'blunt', power: 4, bonuses: { penetration: 10 } }, { id: 'enhanced', seed: 'fixed', noVariance: true });
    expect(anchoredWeapon(enhanced)!.penetration).toBe(12);
    const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()), { traitRegistry: registry });
    expect(JSON.stringify(restored.byId(a.id).weapon)).toBe(original);
    expect(anchoredWeapon(restored.byId(a.id).weapon)).toEqual(projected);
  });
  it('自动行动使用长柄2格触及，不主动走入贴身惩罚', () => {
    const { b, a, d } = small(); a.abilities = []; a.preparedAbilityIds = [];
    b.autoAction(a.id);
    expect(b.dist(a, d)).toBe(2);
    expect(b.log.some(e => e.resolution?.attackerId === a.id)).toBe(true);
  });
  it('随身备用剑不与正在使用的另一把近战武器叠加格挡，副手可用剑则提供格挡', () => {
    const a = unit('a', 'ally'), d = unit('d', 'enemy', 'axe'); prepareCombatModel(a, V4_D20); prepareCombatModel(d, V4_D20);
    d.sidearm = weapon('sword'); expect(previewAttack(options(a, d)).defenseModifiers).not.toContain('剑术格挡');
    d.weapon = weapon('rifle'); expect(previewAttack(options(a, d)).defenseModifiers).toContain('剑术格挡');
    d.weapon = weapon('sword');
    const both = previewAttack(options(a, d)); delete d.sidearm;
    expect(previewAttack(options(a, d)).defenseScore).toBe(both.defenseScore);
  });
  it('既有V3战场保留近战触及和穿透；库存界面明确显示新格子/会战距离和性质', () => {
    const old = small('spear', V3_D20); expect(old.b.getActionOptions('a').find(o => o.id === 'weapon')!.targets![0]!.enabled).toBe(false);
    expect(mass('spear', V3_TW).b.orderPreview({ unitId: 'a', type: 'attack', targetId: 'd' }).reason).toContain('可及范围');
    expect(previewAttack(options(old.a, old.d, V3_D20)).penetration).toBe(3);
    expect(previewAttack(options(old.a, old.d, V3_D20)).attackModifiers).not.toContain('长柄贴身受限');
    const spear = weapon('spear'); expect(formationWeaponRange(spear)).toBe(2);
    expect(itemDescription({ id: 'spear', name: '长枪', qty: 1, lootType: 'weapon', mechanics: { kind: 'weapon', value: spear } })).toContain('格子射程2／会战2阵距');
  });
});
