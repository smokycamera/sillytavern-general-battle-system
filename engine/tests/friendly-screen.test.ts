import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V4_D20, V4_TW,
  compileGenericSkill, type Combatant, type GenerateInput } from '../src/index.js';
import { ignoresFriendlyScreen } from '../src/loadout.js';
import { bracePose } from '../src/tactics.js';

const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}) {
  const unit = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 4, hpMax: 500,
    armorTier: 0, weaponClass: 'sword', weaponLevel: 3, traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  unit.id = id; return unit;
}
function addShot(actor: Combatant) {
  const skill = { ...compileGenericSkill('generic:physical-single:ranged', 1, actor.id), customized: true,
    range: { min: 0, max: 10, metric: 'grid' as const, allowEngaged: true } };
  actor.abilities.push(skill); (actor.preparedAbilityIds ??= []).push(skill.id); return skill;
}
function setup(mechanism: string, sidearm = false) {
  const actor = make('a', 'ally', { weaponClass: sidearm ? 'sword' : mechanism, ...(sidearm ? { sidearmClass: mechanism, sidearmLevel: 3 } : {}) });
  const friend = make('f', 'ally'), enemy = make('e', 'enemy'), target = make('t', 'enemy');
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [actor, friend, enemy, target], battlefield: field, rules: V4_D20, traitRegistry: registry, seed: 'friendly-screen' });
  battle.start(); battle.turnOrder = ['a', 'f', 'e', 't']; battle.turnIndex = 0;
  actor.pos = 10; friend.pos = 24; enemy.pos = 28; target.pos = 38;
  const skill = addShot(actor);
  const option = (id: string) => battle.getActionOptions(actor.id).find(o => o.id === id)!.targets!.find(t => t.targetId === target.id)!;
  return { battle, actor, friend, enemy, target, skill, option, weaponId: sidearm ? 'weapon:sidearm' : 'weapon' };
}

describe('弓弩、法杖越友军不越敌军', () => {
  it.each(['bow', 'magic'])('%s 普通攻击和射击技能可越过友军，敌军遮挡时预览与执行均拒绝且不扣资源', mechanism => {
    for (const action of ['weapon', 'skill']) {
      const { battle, actor, enemy, target, skill, option, weaponId } = setup(mechanism);
      const id = action === 'weapon' ? weaponId : skill.id;
      expect(option(id).enabled).toBe(true);
      enemy.pos = 31;
      expect(option(id)).toMatchObject({ enabled: false, reason: expect.stringContaining('遮挡') });
      const before = JSON.stringify(battle.toSnapshot());
      if (action === 'weapon') expect(() => battle.attack(actor.id, target.id)).toThrow(/遮挡/);
      else expect(battle.useAbility(actor.id, skill.id, target.id)).toMatchObject({ ok: false, reason: expect.stringContaining('遮挡') });
      expect(JSON.stringify(battle.toSnapshot())).toBe(before);
      enemy.pos = 28;
      if (action === 'weapon') battle.attack(actor.id, target.id);
      else expect(battle.useAbility(actor.id, skill.id, target.id).ok).toBe(true);
      expect(battle.log.some(e => (e.resolutions ?? (e.resolution ? [e.resolution] : [])).some(r => r.attackerId === actor.id && r.defenderId === target.id))).toBe(true);
    }
  });
  it.each(['bow', 'magic'])('%s 越过友军不等于曲射：即使友军观测到目标也不能穿墙', mechanism => {
    const { battle, actor, friend, target, skill, option, weaponId } = setup(mechanism);
    friend.pos = 39; battle.battlefield!.tiles[24] = 'wall';
    expect(battle.visibleCombatants(actor.side)).toContain(target);
    expect(option(weaponId).enabled).toBe(false); expect(option(skill.id).enabled).toBe(false);
    expect(() => battle.attack(actor.id, target.id)).toThrow(/观测|视线/);
    expect(battle.useAbility(actor.id, skill.id, target.id).ok).toBe(false);
    expect(actor.weapon!.indirect).toBeFalsy();
  });
  it.each(['bow', 'magic'])('%s 副武器在读档后仍只忽略友军占位', mechanism => {
    const { battle, enemy, target, weaponId } = setup(mechanism, true);
    for (const blocked of [false, true]) {
      enemy.pos = blocked ? 31 : 28;
      const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry });
      expect(restored.getActionOptions('a').find(o => o.id === weaponId)!.targets!.find(t => t.targetId === target.id)!.enabled).toBe(!blocked);
    }
  });
  it.each(['bow', 'magic'])('%s 会战预备队可越过友军，敌方前线仍阻挡普通射击和武器技能', mechanism => {
    for (const action of ['weapon', 'skill']) {
      const actor = make('a', 'ally', { scale: 'company', hpMax: 20, weaponClass: mechanism });
      const friend = make('f', 'ally', { scale: 'company', hpMax: 20 }), target = make('t', 'enemy', { scale: 'company', hpMax: 20 });
      const enemy = make('e', 'enemy', { scale: 'company', hpMax: 20, shield: true });
      const battle = new MassBattle({ combatants: [actor, friend, target, enemy], rules: V4_TW, traitRegistry: registry, seed: 'friendly-mass' }); battle.start();
      actor.formationPosition = 'ally:中军:reserve'; friend.formationPosition = 'ally:中军:front';
      target.formationPosition = 'enemy:中军:front'; enemy.formationPosition = 'enemy:左翼:front';
      const skill = addShot(actor);
      const order = { unitId: actor.id, targetId: target.id, type: action === 'weapon' ? 'volley' as const : 'ability' as const, ...(action === 'skill' ? { abilityId: skill.id } : {}) };
      expect(battle.orderPreview(order).reason).toBeUndefined();
      target.formationPosition = 'enemy:中军:rear'; enemy.formationPosition = 'enemy:中军:front';
      expect(battle.orderPreview(order).reason).toContain('遮挡');
      const before = JSON.stringify(battle.toSnapshot()); expect(battle.issue(order).ok).toBe(false);
      expect(JSON.stringify(battle.toSnapshot())).toBe(before);
      enemy.formationPosition = 'enemy:左翼:front';
      expect(battle.issue(order).ok).toBe(true);
      for (const u of [friend, target, enemy]) battle.issue({ unitId: u.id, type: 'hold' });
      battle.resolveRound();
      expect(battle.log.some(e => e.resolution?.attackerId === actor.id && e.resolution.defenderId === target.id)).toBe(true);
    }
  });
  it('法杖不能绕过敌方固守盾卫的同格掩护；显示名称不会给步枪授予友军豁免', () => {
    const { battle, enemy, target, actor, option, weaponId } = setup('magic');
    enemy.shield = make('shield', 'enemy', { shield: true }).shield;
    enemy.pos = target.pos; enemy.tacticalPose = bracePose(enemy, actor, 'small', 7);
    expect(option(weaponId).enabled).toBe(false);
    const rifle = make('rifle', 'ally', { weaponClass: 'rifle' }).weapon!; rifle.name = '魔法弓';
    expect(ignoresFriendlyScreen(rifle)).toBe(false);
    const legacy = make('legacy', 'ally', { weaponClass: 'bow' }).weapon!; delete legacy.recipe;
    expect(ignoresFriendlyScreen(legacy)).toBe(true);
  });
});
