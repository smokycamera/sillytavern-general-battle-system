import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V8_OVERFLOW_D20, V8_OVERFLOW_TW,
  type Combatant, type Ability } from '../src/index.js';
import { weaponTargetReason, abilityTargetReason, abilityRangeDistance } from '../src/actions.js';
import { rangedTargetDistance, groundToAirRangePenalty } from '../src/aerial.js';
import { isIndirectCannonWeapon } from '../src/loadout.js';
import { renderTacticalBattle } from '../../panel/src/tactical-view.js';
import { formationDistance, formationShotReason } from '../src/mass/formation.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], weaponClass = 'bow', scale: 'hero' | 'company' = 'hero') {
  const u = generateUnit({ name: id, side, weaponClass, weaponLevel: 3, scale, level: 3,
    ...(scale === 'company' ? { hpMax: 20 } : {}), rulesVersion: 'v2', damageModel: 'wounds-v2',
    armorTier: 0, traits: ['flying'] }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
function small(weapon = 'bow') {
  const a = unit('a', 'ally', weapon), d = unit('d', 'enemy', 'sword');
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, d], battlefield: field, rules: V8_OVERFLOW_D20, traitRegistry: registry, seed: 'air-range' });
  b.start(); b.turnOrder = [a.id, d.id]; b.turnIndex = 0; a.airborne = false; a.pos = 38; d.pos = 10;
  return { a, d, b };
}
const shot = (b: SmallBattle, sidearm = false) => b.getActionOptions('a').find(o => o.id === (sidearm ? 'weapon:sidearm' : 'weapon'))!.targets!.find(t => t.targetId === 'd')!;
function spell(extra: Partial<Ability> = {}): Ability {
  return { id: 'cast', name: '测试法术', target: 'enemy', range: { min: 0, max: 5, metric: 'grid', allowEngaged: true },
    effects: [{ op: 'condition', conditionId: 'stunned', dur: 1 }], ...extra };
}
describe('曲射禁对空与地面对空射程预算', () => {
  it.each(['indirect-cannon', 'cannon-legacy', 'tag-only'])('%s使用实际机制，改名不能绕过；落地后恢复合法', kind => {
    const { a, d, b } = small(kind === 'indirect-cannon' ? kind : 'cannon');
    if (kind !== 'indirect-cannon') a.weapon!.indirect = true;
    if (kind === 'tag-only') { delete a.weapon!.recipe; a.weapon!.tags = ['ranged', 'mechanism:indirect-cannon']; }
    a.weapon!.name = '防空神炮'; expect(isIndirectCannonWeapon(a.weapon)).toBe(true);
    const before = JSON.stringify(b.toSnapshot());
    expect(shot(b).reason).toContain('曲射'); expect(() => b.attack(a.id, d.id)).toThrow('曲射');
    expect(b.suppressReason(a.id, d.id)).toContain('曲射');
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    d.airborne = false; expect(shot(b).enabled).toBe(true);
  });
  it('直射炮、弓弩、法杖保留对空能力，显示名不改变类型', () => {
    for (const kind of ['cannon', 'bow', 'magic', 'rifle']) {
      const { a, d, b } = small(kind); a.weapon!.name = '曲射火炮';
      expect(isIndirectCannonWeapon(a.weapon)).toBe(false); expect(shot(b).enabled, kind).toBe(true);
      expect(() => b.attack(a.id, d.id)).not.toThrow();
    }
  });
  it('副槽曲射和读档后的判定一致；主槽直射不被误禁', () => {
    const { a, b } = small('rifle'); a.sidearm = unit('mortar', 'ally', 'indirect-cannon').weapon;
    expect(shot(b).enabled).toBe(true); expect(shot(b, true).reason).toContain('曲射');
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(shot(restored).enabled).toBe(true); expect(shot(restored, true).reason).toContain('曲射');
  });
  it('小地图射程边缘多算2格，预览/压制/执行一致，移动距离不变', () => {
    const { a, d, b } = small('bow');
    d.pos = 3; // horizontal distance 5, bow range 7 => 5+2 exactly legal
    expect(shot(b)).toMatchObject({ distance: 5, rangeDistance: 7, enabled: true });
    d.pos = 2; // distance 6; 6+2 beyond7
    expect(shot(b)).toMatchObject({ distance: 6, rangeDistance: 8, enabled: false });
    expect(shot(b).reason).toContain('距离8'); expect(b.suppressReason(a.id, d.id)).toContain('射程');
    const before = JSON.stringify(b.toSnapshot()); expect(() => b.attack(a.id, d.id)).toThrow('射程'); expect(JSON.stringify(b.toSnapshot())).toBe(before);
    const cost = b.pathPreview(a.id, 31).path!.cost; expect(cost).toBe(1);
    a.airborne = true; expect(shot(b)).toMatchObject({ distance: 6, rangeDistance: 6, enabled: true });
    d.airborne = false; expect(shot(b).rangeDistance).toBe(6);
  });
  it('目标所在同一格也保留现有跨层距离下限，不会被当成地面近战', () => {
    const { a, d, b } = small('bow'); d.pos = a.pos;
    expect(shot(b)).toMatchObject({ distance: 1, rangeDistance: 3, enabled: true });
    a.weapon = unit('sword', 'ally', 'sword').weapon; expect(shot(b).reason).toContain('空中');
  });
  it('拥有飞行但没有起飞不产生对空加值', () => {
    const { a, d } = small(); d.airborne = false;
    expect(groundToAirRangePenalty(a, d)).toBe(0); expect(rangedTargetDistance(a, d, 5)).toBe(5);
  });
  it('敌对有限射程法术/控制加2，友方支援与全域/接触/区域技能不加', () => {
    const { a, d } = small();
    expect(abilityTargetReason({ actor: a, target: d, ability: spell(), distance: 4 })).toContain('距离6');
    expect(abilityTargetReason({ actor: a, target: d, ability: spell(), distance: 3 })).toBeUndefined();
    for (const ability of [spell({ target: 'zone' }), spell({ requires: 'melee' }), spell({ range: { min: 0, max: 99, metric: 'global' } })])
      expect(abilityRangeDistance(a, ability, d, 4)).toBe(4);
    d.side = 'ally'; expect(abilityRangeDistance(a, spell({ target: 'ally' }), d, 4)).toBe(4);
  });
  it('远程武器技法不能绕过曲射禁对空，包括全域标签', () => {
    const { a, d, b } = small('indirect-cannon');
    const ability = spell({ damageBasis: 'weapon', weaponUse: 'ranged', range: { min: 0, max: 99, metric: 'global' }, effects: [{ op: 'damage', baseDice: '1d6', tag: 'ranged' }] });
    a.abilities = [ability]; a.preparedAbilityIds = [ability.id];
    expect(abilityTargetReason({ actor: a, target: d, ability, distance: 4 })).toContain('曲射');
    const before = JSON.stringify(b.toSnapshot()); const option = b.getActionOptions(a.id).find(o => o.id === ability.id)!;
    expect(option.targets![0]!.reason).toContain('曲射'); expect(option.targets![0]!.preview).toBeUndefined();
    expect(b.useAbility(a.id, ability.id, d.id).reason).toContain('曲射'); expect(JSON.stringify(b.toSnapshot())).toBe(before);
  });
  it('曲射范围技法打地面时不能顺带击中相邻空中目标', () => {
    const { a, d, b } = small('indirect-cannon'), ground = unit('ground', 'enemy', 'sword');
    ground.airborne = false; ground.pos = 17; b.combatants.push(ground);
    const ability = spell({ damageBasis: 'weapon', weaponUse: 'ranged', shape: 'burst', range: { min: 0, max: 12, metric: 'grid' },
      effects: [{ op: 'damage', baseDice: '1d6', tag: 'ranged', shape: 'burst' }] });
    a.abilities = [ability]; a.preparedAbilityIds = [ability.id];
    const before = d.hp; const result = b.useAbility(a.id, ability.id, ground.id);
    expect(result.ok, result.reason).toBe(true); expect(result.resolutions.some(r => r.defenderId === d.id)).toBe(false); expect(d.hp).toBe(before);
  });
  it.each(['bow', 'cannon', 'indirect-cannon'])('会战%s：+1阵位，军令和AI沿用相同规则', kind => {
    const a = unit('a', 'ally', kind, 'company'), d = unit('d', 'enemy', 'sword', 'company');
    const b = new MassBattle({ combatants: [a, d], rules: V8_OVERFLOW_TW, traitRegistry: registry, seed: 'mass-aerial' });
    b.start(); a.airborne = false; a.formationPosition = 'ally:中军:reserve'; const distance = formationDistance(a, d);
    const order = { unitId: a.id, type: 'volley' as const, targetId: d.id };
    a.weapon!.range = distance; a.weapon!.customized = true;
    expect(formationShotReason(a, d, [a, d])).toMatch(kind === 'indirect-cannon' ? /曲射/ : /射程/);
    expect(b.issue(order).ok).toBe(false);
    a.weapon!.range = distance + 1;
    expect(b.orderPreview(order).reason).toBe(kind === 'indirect-cannon' ? '曲射火炮不能攻击空中目标' : undefined);
    expect(b.issue(order).ok).toBe(kind !== 'indirect-cannon');
    if (kind === 'indirect-cannon') { b.autoOrders('ally'); expect(b.orders.get(a.id)?.type).not.toBe('volley'); }
    d.airborne = false; b.orders.clear(); const grounded = b.issue(order); expect(grounded.ok, grounded.reason).toBe(true);
  });
  it('小地图明确显示对空距离算式，拒绝目标没有虚假伤害预览', () => {
    const { d, b } = small(); d.pos = 2;
    const html = renderTacticalBattle(b, { selectedId: 'a', targetId: 'd', mode: 'weapon' });
    expect(html).toContain('距离 6 + 对空 2 = 射程距离 8'); expect(shot(b).preview).toBeUndefined();
  });
  it.each(['bow', 'indirect-cannon'])('%s警戒反应不能绕过对空射程和弹道限制', kind => {
    const { a, d, b } = small(kind); d.pos = 2;
    b.setOverwatch(a.id); b.endTurn(); b.moveTo(d.id, 1);
    expect(b.log.filter(l => l.text.startsWith('警戒反应'))).toHaveLength(0);
    // 从距离7进入距离5：弓弩恰好5+2=7，曲射依然不能对空。
    b.moveTo(d.id, 3);
    expect(b.log.filter(l => l.text.startsWith('警戒反应'))).toHaveLength(kind === 'bow' ? 1 : 0);
  });
  it('会战技能按+1而不是误用小地图+2', () => {
    const { a, d } = small();
    expect(abilityTargetReason({ space: 'mass', actor: a, target: d, ability: spell(), distance: 4 })).toBeUndefined();
    expect(abilityTargetReason({ space: 'small', actor: a, target: d, ability: spell(), distance: 4 })).toContain('射程');
    a.weapon!.range = 5;
    expect(weaponTargetReason({ space: 'mass', actor: a, target: d, weapon: a.weapon, ranged: true, distance: 4 })).toBeUndefined();
  });
});
