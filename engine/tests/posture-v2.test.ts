import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, resolveAttack, standardConditionMap, grantTraitSource, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, weaponClass: string, traits: string[] = []) {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', rulesVersion: 'v2', level: 4, hpMax: 500, weaponClass, weaponLevel: 5, armorTier: 1, archetype: 'mobile', shield: traits.includes('shield-wall'), traits }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
function grid(trait = 'shield-wall', weapon = 'sword') {
  const field = standardField(); field.tiles.fill('open');
  const a = unit('a', weapon, [trait]), b = unit('b', trait === 'pike-wall' ? 'sword' : 'bow');
  const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: field, traitRegistry: registry, seed: 'pose', rng: { seed: 'pose', next: () => 0, d: (n) => n } });
  battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 31; b.pos = 10;
  return { battle, a, b };
}
describe('V2稳固姿态与真实受击方向', () => {
  it('无姿态不白送盾墙，固守消耗主行动，正面射击防护而背袭无效', () => {
    for (const rear of [false, true]) {
      const { battle, a, b } = grid();
      expect(resolveAttack({ attacker: b, defender: structuredClone(a), rules: V2_D20, ranged: true, conditionDefs: standardConditionMap(), traitRegistry: registry, rng: { seed: 'hit', next: () => 0, d: (n) => n } }).wardMult).toBe(1);
      battle.brace('a'); expect(battle.actedThisTurn.has('a')).toBe(true);
      expect(() => battle.brace('a')).toThrow(); battle.endTurn(); if (rear) b.pos = 52;
      const preview = battle.getActionOptions('b').find((o) => o.id === 'weapon')!.targets!.find((t) => t.targetId === 'a')!.preview!;
      const result = battle.attack('b', 'a'); expect(result.wardMult).toBe(rear ? 1 : 0.6); expect(preview.expectedDamage).toBeGreaterThan(0);
    }
  });
  it('移动取消固守，卸盾或失能即时失效；快照保留姿态但下次激活结束旧姿态', () => {
    const { battle, a } = grid(); battle.brace('a');
    const saved = JSON.parse(JSON.stringify(battle.toSnapshot()));
    const restored = SmallBattle.fromSnapshot(saved, { traitRegistry: registry }); expect(restored.byId('a').tacticalPose).toEqual(a.tacticalPose);
    battle.moveTo('a', 32); expect(a.tacticalPose).toBeUndefined();
    for (const change of ['shield', 'stun']) {
      const b = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(saved)), { traitRegistry: registry }); b.endTurn();
      if (change === 'shield') delete b.byId('a').shield; else b.byId('a').conditions.push({ id: 'stunned', dur: 2 });
      expect(b.attack('b', 'a').wardMult).toBe(1);
    }
    restored.endTurn(); restored.endTurn(); expect(restored.byId('a').tacticalPose).toBeUndefined();
  });
  it('拒马只抵御稳固正面的真实近战冲锋，普通近战与后方冲锋无效', () => {
    for (const rear of [false, true]) {
      const { battle, a, b } = grid('pike-wall', 'spear'); battle.brace('a'); battle.endTurn(); if (rear) b.pos = 52;
      const result = battle.attack('b', 'a', { charge: true }); expect(result.wardMult).toBe(rear ? 1 : 0.5); expect(battle.dist(a, b)).toBe(1);
    }
  });
  it('会战固守进入同一姿态管线，计划预览不偷读敌方新军令，换令清除姿态', () => {
    const a = unit('a', 'sword', ['shield-wall']), b = unit('b', 'bow'); a.scale = b.scale = 'company'; b.tags.push('zone:中军', 'rank:rear');
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], traitRegistry: registry, seed: 'mass-pose' }); battle.start();
    const attack = { unitId: 'b', type: 'volley' as const, targetId: 'a' };
    const before = battle.orderPreview(attack);
    battle.issue({ unitId: 'a', type: 'brace' }); expect(battle.orderPreview(attack)).toEqual(before);
    battle.issue(attack); battle.resolveRound(1);
    expect(battle.log.find((l) => l.resolution?.attackerId === 'b')?.resolution?.wardMult).toBe(0.6);
    expect(a.tacticalPose?.mode).toBe('mass');
    const restored = MassBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry });
    expect(restored.byId('a').tacticalPose).toEqual(a.tacticalPose);
    restored.issue({ unitId: 'a', type: 'hold' }); restored.issue({ unitId: 'b', type: 'hold' }); restored.resolveRound(2);
    expect(restored.byId('a').tacticalPose).toBeUndefined();
  });
  it('实际AI会在无法还击时用合法固守减轻射击威胁，外部盾墙仍需要实物', () => {
    const { battle, a } = grid(); a.traits = [];
    grantTraitSource(a, { id: 'shield-training', name: '盾阵训练', kind: 'blessing', traitIds: ['shield-wall'], duration: { kind: 'battles', count: 1 } });
    battle.movementSpent.set('a', 3); battle.autoAction('a');
    expect(a.tacticalPose).toBeDefined(); expect(battle.actedThisTurn.has('a')).toBe(true);
    expect(battle.attack('b', 'a').wardMult).toBe(0.6);
  });
});
