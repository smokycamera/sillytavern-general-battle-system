import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, V2_D20, LITE_D20, type Combatant } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], traits: string[] = [], weaponClass: 'sword' | 'bow' = 'sword') {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass, weaponLevel: 3, armorTier: 1, traits }, { registry, seed: id, noVariance: true }).unit; u.id = id; return u;
}
function battle() {
  const a = unit('a', 'ally', ['flying']), b = unit('b', 'enemy'); const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: field, seed: 'flight' }); battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0;
  a.pos = 31; b.pos = 10; return { a, b, battle, field: battle.battlefield! };
}
describe('有限飞行与真实空地状态', () => {
  it('进行中的旧规则不自动获得新版飞行，空中状态要求V2二维战场', () => {
    const a = unit('a', 'ally', ['flying']), b = unit('b', 'enemy');
    const legacy = new SmallBattle({ rules: LITE_D20, combatants: [a, b], battlefield: standardField(), seed: 'legacy-flight' }); legacy.start(); expect(a.airborne).toBeUndefined();
    a.airborne = true; expect(() => new SmallBattle({ rules: V2_D20, combatants: [a, b], seed: 'no-map' })).toThrow('二维');
  });
  it('起飞触发地面借机且只花同一反应预算，移动耗尽后拒绝起落', () => {
    const { a, b, battle: battle0 } = battle(); b.pos = 24;
    battle0.changeFlight(a.id, false); battle0.changeFlight(a.id, true); expect(battle0.reactionSpent.has(b.id)).toBe(true);
    expect(battle0.log.filter((e) => e.text.startsWith('起飞借机'))).toHaveLength(1);
    battle0.changeFlight(a.id, false); const before = JSON.stringify(battle0.toSnapshot());
    expect(() => battle0.changeFlight(a.id, true)).toThrow('移动'); expect(JSON.stringify(battle0.toSnapshot())).toBe(before);
  });
  it('警戒控制击落后立即终止旧飞行路径，不继续穿墙或重复移动', () => {
    const { a, b, battle: battle0, field } = battle(); field.tiles[24] = 'wall';
    b.weapon = unit('gunner', 'enemy', [], 'bow').weapon; b.weapon!.range = 5; b.base.atk = 100;
    battle0.traitRegistry.set('grounding-shot', { id: 'grounding-shot', name: '震慑射击', desc: '仅用于控制反应测试', effects: [{ kind: 'onHitCondition', conditionId: 'stunned', dur: 2 }] }); b.traits.push('grounding-shot');
    battle0.overwatch.add(b.id); battle0.moveTo(a.id, 17);
    expect(a.airborne).toBe(false); expect(a.conditions.some((c) => c.id === 'stunned')).toBe(true);
    expect(battle0.movementSpent.get(a.id)).toBe(1); expect(field.tiles[a.pos!]).not.toBe('wall');
    expect(battle0.log.filter((e) => e.text.includes('坠落损失'))).toHaveLength(1);
  });
  it('空中扑击预览计入降落与地面环境，执行与先手动降落的结果一致', () => {
    const { a, b, battle: battle0, field } = battle(); b.pos = 24; field.tiles[a.pos!] = 'forest';
    const before = JSON.stringify(battle0.toSnapshot()), grounded = SmallBattle.fromSnapshot(JSON.parse(before)); grounded.changeFlight(a.id, false);
    const preview = battle0.getActionOptions(a.id).find((o) => o.id === 'weapon')!.targets!.find((t) => t.targetId === b.id)!.preview!;
    expect(preview.movementCost).toBe(1); expect(preview.lands).toBe(true);
    expect(preview.expectedDamage).toBe(grounded.getActionOptions(a.id).find((o) => o.id === 'weapon')!.targets!.find((t) => t.targetId === b.id)!.preview!.expectedDamage);
    expect(JSON.stringify(battle0.toSnapshot())).toBe(before); expect(battle0.attack(a.id, b.id).finalDamage).toBe(grounded.attack(a.id, b.id).finalDamage);
  });
  it('迫降附近无合法落点时受损撤出，落点拒绝和恢复不制造额外伤亡', () => {
    const { a, b, battle: battle0, field } = battle();
    field.objective.cell = 0;
    for (let n = 0; n < field.tiles.length; n++) if (Math.abs(n % 7 - 3) + Math.abs(Math.floor(n / 7) - 4) <= 2) field.tiles[n] = 'wall';
    const before = JSON.stringify(battle0.toSnapshot()); expect(() => battle0.changeFlight(a.id, false)).toThrow('落点'); expect(JSON.stringify(battle0.toSnapshot())).toBe(before);
    b.abilities = [{ id: 'grounding', name: '震慑', target: 'enemy', range: { metric: 'grid', min: 0, max: 5 }, effects: [{ op: 'condition', conditionId: 'stunned', dur: 2 }] }]; b.preparedAbilityIds = ['grounding']; battle0.turnOrder = ['b', 'a'];
    expect(battle0.useAbility(b.id, 'grounding', a.id).ok).toBe(true); expect(a.status).toBe('fled'); expect(a.hp).toBe(450);
    expect(SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle0.toSnapshot()))).byId(a.id).hp).toBe(450);
  });
  it('AI飞行抵达任务格后会降落，空中停留不能冒充地面占领', () => {
    const { a, b, battle: battle0, field } = battle(); a.pos = 45; b.pos = 0; field.objective = { kind: 'control', cell: 31, rounds: 2, limit: 60 };
    battle0.autoAction(a.id); expect(a.pos).toBe(31); expect(a.airborne).toBe(false); expect(battle0.movementSpent.get(a.id)).toBe(3);
  });
  it('飞行开局进入空中，越墙与林地按空中路径花费，地面占位不阻塞空中', () => {
    const { a, b, battle: battle0, field } = battle(); expect(a.airborne).toBe(true);
    field.tiles[24] = 'wall'; field.tiles[17] = 'forest'; b.pos = 17;
    expect(battle0.pathPreview(a.id, 17).path?.cost).toBe(2); battle0.moveTo(a.id, 17); expect(a.pos).toBe(17); expect(a.airborne).toBe(true);
    expect(battle0.flightReason(a.id, false)).toMatch(/落点|敌人/);
  });
  it('地面近战不能打空中，射击可反制；飞行近战落地后才能扑击地面目标', () => {
    const { a, b, battle: battle0 } = battle(); a.pos = 31; b.pos = 24; battle0.turnOrder = ['b', 'a'];
    const before = JSON.stringify(battle0.toSnapshot()); expect(() => battle0.attack(b.id, a.id)).toThrow(/空中/); expect(JSON.stringify(battle0.toSnapshot())).toBe(before);
    b.weapon = unit('ranged', 'enemy', [], 'bow').weapon; expect(() => battle0.attack(b.id, a.id)).not.toThrow(); battle0.endTurn();
    const points = battle0.movementLeft(a.id); battle0.attack(a.id, b.id); expect(a.airborne).toBe(false); expect(battle0.movementLeft(a.id)).toBe(points - 1);
    expect(battle0.actedThisTurn.has(a.id)).toBe(true);
  });
  it('起落消耗同一移动账本，空中不占地面任务，重开不发新额度', () => {
    const { a, battle: battle0, field } = battle(); field.objective.cell = a.pos!;
    battle0.endTurn(); battle0.endTurn(); expect(battle0.controlRounds.ally).toBe(0);
    battle0.changeFlight(a.id, false); const left = battle0.movementLeft(a.id); battle0.changeFlight(a.id, true); expect(battle0.movementLeft(a.id)).toBe(left - 1);
    const snapshot = JSON.stringify(battle0.toSnapshot()); const restored = SmallBattle.fromSnapshot(JSON.parse(snapshot)); restored.start(); expect(JSON.stringify(restored.toSnapshot())).toBe(snapshot);
  });
  it('真实控制技能触发合法迫降和一次坠落损失，恢复快照不再次扣血', () => {
    const { a, b, battle: battle0 } = battle();
    b.abilities = [{ id: 'grounding', name: '震慑', target: 'enemy', range: { metric: 'grid', min: 0, max: 5 }, effects: [{ op: 'condition', conditionId: 'stunned', dur: 2 }] }]; b.preparedAbilityIds = ['grounding'];
    battle0.turnOrder = ['b', 'a']; battle0.turnIndex = 0; const before = a.hp;
    const preview = battle0.getActionOptions(b.id).find((o) => o.id === 'grounding')!.targets!.find((t) => t.targetId === a.id)!.preview!;
    expect(preview.fallDamage).toBe(50); expect(preview.forcedExit).toBe(false);
    expect(battle0.useAbility(b.id, 'grounding', a.id).ok).toBe(true); expect(a.airborne).toBe(false); expect(a.hp).toBe(before - 50);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle0.toSnapshot()))); expect(restored.byId(a.id).hp).toBe(a.hp);
  });
  it('归档不保留空中坐标状态，非法空中记录不被恢复成飞行能力', () => {
    const { a, battle: battle0 } = battle(); const record = unitRecordFromCombatant(a);
    expect(record.snapshot?.airborne).toBeUndefined(); expect(materializeUnitRecord(record, registry).airborne).toBeUndefined(); expect(a.airborne).toBe(true);
    const bad = JSON.parse(JSON.stringify(battle0.toSnapshot())); bad.combatants[0].airborne = 'true'; expect(() => SmallBattle.fromSnapshot(bad)).toThrow('空地状态损坏');
    bad.combatants[0].airborne = true; bad.combatants[0].traits = []; expect(() => SmallBattle.fromSnapshot(bad)).toThrow('飞行能力');
  });
});
