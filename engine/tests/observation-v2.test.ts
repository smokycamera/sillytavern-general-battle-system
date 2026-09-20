import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], traits: string[] = []) {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'bow', weaponLevel: 5, armorTier: 1, traits }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.weapon!.range = 8; return u;
}
function small(traits: string[] = []) {
  const a = unit('a', 'ally', traits), b = unit('hiddenEnemy', 'enemy');
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: field, field: { tags: ['night'] }, seed: 'observation' });
  battle.start(); battle.turnOrder = [a.id, b.id]; battle.turnIndex = 0; a.pos = 45; b.pos = 17;
  return { a, b, battle };
}
describe('按阵营观测事实', () => {
  it('AI探索不读取未发现敌军的位置，会战无目标时按公共路线巡视三翼', () => {
    const moves = [0, 6].map((pos) => {
      const { a, b, battle } = small(); a.pos = 56; b.pos = pos;
      battle.autoAction(a.id); return { pos: a.pos, action: battle.log.filter((e) => e.participants?.includes(a.id) && e.kind === 'move').map((e) => e.text) };
    });
    expect(moves[0]).toEqual(moves[1]);
    const a = unit('a', 'ally'), b = unit('b', 'enemy'); a.scale = b.scale = 'company'; a.tags.push('zone:左翼'); b.tags.push('zone:右翼');
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], field: { tags: ['night'] }, seed: 'scout-mass' }); battle.start();
    expect(battle.visibleCombatants('ally')).not.toContain(b); battle.autoOrders('ally');
    expect(battle.orders.get(a.id)?.targetId).toBeUndefined();
    battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(); battle.autoOrders('ally');
    expect(battle.orders.get(a.id)?.type).toBe('shift-right'); expect(battle.orders.get(a.id)?.targetId).toBeUndefined();
  });
  it('看不见的施法目标不会扣资源，未定位的夜战射手只能向受害方报告己方损失', () => {
    const { a, b, battle } = small();
    a.abilities.push({ id: 'spell', name: '测试法术', target: 'enemy', range: { metric: 'grid', min: 0, max: 8 }, cost: { resource: 'MP', amount: 1 }, effects: [{ op: 'damage', baseDice: '1d6' }] }); a.resources.MP = 2; a.preparedAbilityIds = ['spell'];
    const before = JSON.stringify(battle.toSnapshot()); expect(battle.useAbility(a.id, 'spell', b.id).ok).toBe(false); expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    b.traits.push('night-fighter'); battle.turnOrder = [b.id, a.id]; battle.turnIndex = 0;
    battle.attack(b.id, a.id);
    const entries = battle.visibleLog('ally').filter((e) => e.kind === 'attack');
    expect(entries).toHaveLength(1); expect(entries[0]!.text).toContain('未定位攻击'); expect(entries[0]!.resolution).toBeUndefined(); expect(entries[0]!.text).not.toContain(b.name);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())));
    expect(restored.visibleLog('ally')).toEqual(battle.visibleLog('ally'));
  });
  it('夜间看不见的敌军不进入候选，强行指定攻击或冲锋不耗行动和随机数', () => {
    const { a, b, battle } = small();
    expect(battle.visibleCombatants('ally').map((u) => u.id)).toEqual(['a']);
    expect(battle.getActionOptions(a.id).flatMap((o) => o.targets ?? []).some((t) => t.targetId === b.id)).toBe(false);
    const before = JSON.stringify(battle.toSnapshot());
    expect(() => battle.attack(a.id, b.id)).toThrow(/观测/);
    expect(() => battle.attack(a.id, b.id, { charge: true })).toThrow();
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    b.pos = 24; expect(battle.visibleCombatants('ally').map((u) => u.id)).toContain(b.id);
  });
  it('夜战延伸观测，墙体照常；同队观测仅为间接火力提供目标', () => {
    const { a, b, battle } = small(['night-fighter']);
    expect(battle.visibleCombatants('ally')).toContain(b);
    battle.battlefield!.tiles[31] = 'wall'; expect(battle.visibleCombatants('ally')).not.toContain(b);
    const scout = unit('scout', 'ally', ['night-fighter']); scout.pos = 18; battle.combatants.push(scout);
    expect(battle.visibleCombatants('ally')).toContain(b);
    expect(() => battle.attack(a.id, b.id)).toThrow();
    a.weapon!.indirect = true; expect(() => battle.attack(a.id, b.id)).not.toThrow();
  });
  it('移动预览不泄漏夜间敌方警戒，实际移动可发现目标，重开保持相同观测', () => {
    const { a, b, battle } = small(); battle.overwatch.add(b.id);
    expect(battle.pathPreview(a.id, 38).risks).toEqual([]);
    battle.moveTo(a.id, 38); expect(battle.visibleCombatants('ally')).toContain(b);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())));
    expect(restored.visibleCombatants('ally').map((u) => u.id)).toEqual(battle.visibleCombatants('ally').map((u) => u.id));
  });
  it('会战夜间目标过滤与实际下令共用观测，随队夜视只按宿主位置侦察', () => {
    const a = unit('a', 'ally'), b = unit('hiddenEnemy', 'enemy'); a.scale = b.scale = 'company';
    a.tags.push('rank:rear'); b.tags.push('rank:rear');
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], field: { tags: ['night'] }, seed: 'mass-observation' }); battle.start();
    expect(battle.visibleCombatants('ally')).not.toContain(b);
    expect(battle.issue({ unitId: a.id, type: 'volley', targetId: b.id })).toEqual({ ok: false, reason: '尚未观测到目标' });
    const scout = unit('scout', 'ally', ['night-fighter']); scout.tags.push('rank:reserve', 'zone:左翼');
    battle.combatants.push(scout); battle.attached.set(a.id, scout.id);
    expect(battle.visibleCombatants('ally')).toContain(b);
    expect(battle.issue({ unitId: a.id, type: 'volley', targetId: b.id }).ok).toBe(true);
  });
});
