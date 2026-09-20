import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type Combatant } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], traits: string[] = []) {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'bow', weaponLevel: 5, armorTier: 1, traits }, { registry, seed: id, noVariance: true }).unit; u.id = id; return u;
}
function small() {
  const a = unit('a', 'ally'), b = unit('b', 'enemy', ['stalk']);
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: field, seed: 'stalk', rng: { seed: 'miss', next: () => 0.99, d: () => 1 } });
  battle.start(); battle.turnOrder = [b.id, a.id]; battle.turnIndex = 0; a.pos = 31; b.pos = 10;
  return { a, b, battle };
}
describe('潜伏与暴露', () => {
  it('AI把合法掩护休整作为真实行动选择，两模式都能重新潜伏', () => {
    const { b, battle } = small(); b.tacticalRevealed = true; b.weapon = undefined; b.sidearm = undefined; b.abilities = [];
    battle.battlefield!.tiles[b.pos!] = 'forest'; battle.battlefield!.objective.cell = b.pos!;
    battle.autoAction(b.id); expect(b.tacticalRevealed).toBeUndefined(); expect(battle.actedThisTurn.has(b.id)).toBe(false);
    const a = unit('a', 'ally'), c = unit('c', 'enemy', ['stalk']); c.tags.push('rank:rear'); c.weapon = undefined; c.abilities = [];
    const mass = new MassBattle({ rules: V2_TW, combatants: [a, c], field: { tags: ['forest'] }, seed: 'stalk-ai' }); mass.start(); c.tacticalRevealed = true;
    mass.autoOrders('enemy'); expect(mass.orders.get(c.id)?.type).toBe('hold'); mass.issue({ unitId: a.id, type: 'hold' }); mass.resolveRound(1);
    expect(c.tacticalRevealed).toBeUndefined();
  });
  it('来源潜伏到期即时失效，暴露不进入永久档案，坏记录拒绝', () => {
    const { b, battle } = small(); b.traits = [];
    b.traitSources = [{ id: 'conceal-source', name: '林神庇护', kind: 'blessing', traitIds: ['stalk'], duration: { kind: 'rounds', count: 1 }, remaining: 1 }];
    expect(battle.visibleCombatants('ally')).not.toContain(b); b.traitSources[0]!.remaining = 0; expect(battle.visibleCombatants('ally')).toContain(b);
    b.tacticalRevealed = true;
    const record = unitRecordFromCombatant(b); expect(record.snapshot?.tacticalRevealed).toBeUndefined(); expect(materializeUnitRecord(record, registry).tacticalRevealed).toBeUndefined();
    const bad = JSON.parse(JSON.stringify(battle.toSnapshot())); bad.combatants[1].tacticalRevealed = 'true';
    expect(() => SmallBattle.fromSnapshot(bad)).toThrow('潜伏暴露记录损坏');
  });
  it('敌人在侦察距离内或有失能时无法休整复隐，潜伏者观察地图不缩短普通视野', () => {
    const { a, b, battle } = small(); b.tacticalRevealed = true; battle.battlefield!.tiles[b.pos!] = 'forest'; a.pos = 24;
    battle.endTurn(); expect(b.tacticalRevealed).toBe(true);
    a.pos = 45; expect(battle.cellVisible('enemy', 38)).toBe(true);
    b.conditions.push({ id: 'stunned', dur: 2 }); battle.endTurn(); expect(b.tacticalRevealed).toBe(true);
  });
  it('部署潜伏改变目标查询，攻击未命中也暴露，预览不提前暴露', () => {
    const { a, b, battle } = small(); expect(battle.visibleCombatants('ally')).not.toContain(b);
    const before = JSON.stringify(battle.toSnapshot()); battle.getActionOptions(b.id); expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    const result = battle.attack(b.id, a.id); expect(result.hit).toBe(false); expect(b.tacticalRevealed).toBe(true);
    expect(battle.visibleCombatants('ally')).toContain(b);
    expect(SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot()))).byId(b.id).tacticalRevealed).toBe(true);
  });
  it('近距侦察能发现，贴身接敌留下暴露；离开接敌后不能在旷地立即隐身', () => {
    const { a, b, battle } = small(); a.pos = 24; expect(battle.visibleCombatants('ally')).toContain(b);
    battle.moveTo(b.id, 17); expect(b.tacticalRevealed).toBe(true);
    a.pos = 45; expect(battle.visibleCombatants('ally')).toContain(b);
    battle.endTurn(); battle.endTurn(); battle.endTurn(); expect(b.tacticalRevealed).toBe(true);
  });
  it('暴露后在掩护中完整休整才重新隐匿，射击同次激活不能自动复隐', () => {
    const { a, b, battle } = small(); battle.battlefield!.tiles[b.pos!] = 'forest';
    battle.attack(b.id, a.id); battle.endTurn(); expect(b.tacticalRevealed).toBe(true);
    battle.endTurn(); battle.endTurn(); expect(b.tacticalRevealed).toBeUndefined(); expect(battle.visibleCombatants('ally')).not.toContain(b);
  });
  it('会战隐匿不复制随队专长，宿主隐匿覆盖随队显示，开火与掩护休整在阶段中真实生效', () => {
    const a = unit('a', 'ally'), b = unit('b', 'enemy', ['stalk']), hero = unit('hero', 'enemy'); hero.scale = 'hero';
    b.tags.push('rank:rear'); hero.tags.push('rank:rear');
    const battle = new MassBattle({ rules: V2_TW, combatants: [a, b, hero], field: { tags: ['forest'] }, seed: 'mass-stalk' }); battle.start();
    expect(battle.attached.get(b.id)).toBe(hero.id); expect(battle.visibleCombatants('ally')).not.toContain(b); expect(battle.visibleCombatants('ally')).not.toContain(hero);
    battle.issue({ unitId: a.id, type: 'hold' }); battle.issue({ unitId: b.id, type: 'volley', targetId: a.id }); battle.resolveRound(1);
    expect(b.tacticalRevealed).toBe(true); expect(battle.visibleCombatants('ally')).toContain(b);
    battle.issue({ unitId: a.id, type: 'hold' }); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(2);
    expect(b.tacticalRevealed).toBeUndefined(); expect(battle.visibleCombatants('ally')).not.toContain(hero);
    b.traits = []; hero.traits.push('stalk'); expect(battle.visibleCombatants('ally')).toContain(b);
  });
});
