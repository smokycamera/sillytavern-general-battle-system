import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V4_D20, V4_TW, type GenerateInput } from '../src/index.js';
import { compileWeapon } from '../src/gen/equipment.js';
import { anchoredWeapon } from '../src/power-anchors.js';
import { isCannonWeapon } from '../src/loadout.js';
import { resolveWeaponClass } from '../src/data/weapons.js';

const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}) {
  const unit = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 4, hpMax: 500,
    armorTier: 0, weaponClass: 'sword', weaponLevel: 3, traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  unit.id = id; return unit;
}
function setup(weaponClass: string, wall = false, sidearm = false) {
  const actor = make('gun', 'ally', { body: 'vehicle', weaponClass: sidearm ? 'sword' : weaponClass,
    ...(sidearm ? { sidearmClass: weaponClass, sidearmLevel: 3 } : {}),
    abilityBlueprints: [{ id: 'generic:physical-single:ranged', level: 3, name: '炮击' }] });
  const blocker = make('screen', 'ally'), target = make('target', 'enemy');
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [actor, blocker, target], rules: V4_D20, traitRegistry: registry, battlefield: field, seed: 'artillery-los' });
  battle.start(); battle.turnOrder = [actor.id, blocker.id, target.id]; battle.turnIndex = 0;
  actor.pos = 10; blocker.pos = wall ? 39 : 31; target.pos = 38;
  if (wall) battle.battlefield!.tiles[24] = 'wall';
  actor.abilities[0]!.range = { min: 0, max: 10, metric: 'grid', allowEngaged: true };
  actor.abilities[0]!.customized = true;
  actor.preparedAbilityIds = [actor.abilities[0]!.id];
  return { battle, actor, blocker, target };
}
const shot = (battle: SmallBattle, target: string, sidearm = false) => battle.getActionOptions('gun')
  .find(option => option.id === (sidearm ? 'weapon:sidearm' : 'weapon'))!.targets!.find(option => option.targetId === target)!;

describe('普通直射、直射火炮与曲射火炮', () => {
  it('名称与别名映射明确，两种火炮共享重炮伤害、装填与弹种规则', () => {
    expect(resolveWeaponClass('直射火炮')).toBe('cannon');
    expect(resolveWeaponClass('火炮')).toBe('cannon');
    for (const name of ['曲射火炮', '榴弹炮', '迫击炮']) expect(resolveWeaponClass(name)).toBe('indirect-cannon');
    const direct = compileWeapon({ mechanism: 'cannon', power: 5 }, { id: 'direct', seed: 'same', noVariance: true });
    const indirect = compileWeapon({ mechanism: 'indirect-cannon', power: 5 }, { id: 'indirect', seed: 'same', noVariance: true });
    expect(isCannonWeapon(indirect)).toBe(true); expect(indirect.indirect).toBe(true); expect(direct.indirect).toBeFalsy();
    for (const ammunition of ['he', 'ap'] as const) {
      const a = anchoredWeapon(direct, ammunition)!, b = anchoredWeapon(indirect, ammunition)!;
      for (const key of ['baseDice', 'damageScale', 'penetration', 'reload', 'splashTargets', 'ammunition'] as const) expect(b[key], key).toEqual(a[key]);
    }
  });
  it.each(['rifle', 'cannon', 'indirect-cannon'])('%s：单位遮挡的预览和攻击一致，拒绝攻击不扣资源', weaponClass => {
    const { battle, actor, target } = setup(weaponClass);
    expect(shot(battle, target.id).enabled).toBe(weaponClass === 'indirect-cannon');
    const before = JSON.stringify(battle.toSnapshot());
    if (weaponClass === 'indirect-cannon') {
      battle.attack(actor.id, target.id);
      expect(battle.log.some(entry => entry.resolution?.defenderId === target.id)).toBe(true);
    } else {
      expect(() => battle.attack(actor.id, target.id)).toThrow(/遮挡/);
      expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    }
  });
  it.each(['cannon', 'indirect-cannon'])('%s：地形遮挡的射击技能沿用武器LOS，曲射仍需观察者', weaponClass => {
    const { battle, actor, target } = setup(weaponClass, true);
    expect(battle.visibleCombatants(actor.side)).toContain(target);
    expect(shot(battle, target.id).enabled).toBe(weaponClass === 'indirect-cannon');
    const skill = actor.abilities[0]!;
    const before = JSON.stringify(battle.toSnapshot());
    const result = battle.useAbility(actor.id, skill.id, target.id);
    expect(result.ok, result.reason).toBe(weaponClass === 'indirect-cannon');
    if (!result.ok) expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    const fresh = setup(weaponClass, true); fresh.blocker.status = 'dead'; fresh.blocker.hp = 0;
    expect(() => fresh.battle.attack(fresh.actor.id, fresh.target.id)).toThrow(/观测|观察者/);
    expect(fresh.battle.useAbility(fresh.actor.id, fresh.actor.abilities[0]!.id, fresh.target.id).ok).toBe(false);
  });
  it('副武器与存档恢复保留两种火炮的视线规则，旧indirect标记仍有效', () => {
    for (const mechanism of ['cannon', 'indirect-cannon']) {
      const { battle, actor, target } = setup(mechanism, false, true);
      const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry });
      expect(shot(restored, target.id, true).enabled).toBe(mechanism === 'indirect-cannon');
      expect(restored.byId(actor.id).sidearm!.recipe!.mechanism).toBe(mechanism);
    }
    const legacy = setup('cannon'); legacy.actor.weapon!.indirect = true;
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(legacy.battle.toSnapshot())), { traitRegistry: registry });
    expect(shot(restored, legacy.target.id).enabled).toBe(true);
  });
  it.each(['cannon', 'indirect-cannon'])('会战%s：预备队隔着己方前线射击的军令预览与结算一致', weaponClass => {
    const actor = make('gun', 'ally', { scale: 'company', hpMax: 20, body: 'vehicle', weaponClass });
    const observer = make('observer', 'ally', { scale: 'company', hpMax: 20 });
    const target = make('target', 'enemy', { scale: 'company', hpMax: 20 });
    actor.tags.push('rank:reserve'); observer.tags.push('rank:front'); target.tags.push('rank:front');
    const battle = new MassBattle({ combatants: [actor, observer, target], rules: V4_TW, traitRegistry: registry, seed: 'artillery-mass' }); battle.start();
    const order = { unitId: actor.id, type: 'volley' as const, targetId: target.id };
    if (weaponClass === 'cannon') expect(battle.orderPreview(order).reason).toContain('遮挡');
    expect(battle.issue(order).ok).toBe(weaponClass === 'indirect-cannon');
    battle.issue({ unitId: observer.id, type: 'hold' }); battle.issue({ unitId: target.id, type: 'hold' });
    battle.resolveRound();
    expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id)).toBe(weaponClass === 'indirect-cannon');
  });
});
