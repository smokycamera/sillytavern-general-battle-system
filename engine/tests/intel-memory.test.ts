import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V12_OVERFLOW_D20, V2_TW, gridDistance, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, side: Combatant['side'], extra: Record<string, unknown> = {}): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'sword', weaponLevel: 5, armorTier: 1, traits: [], ...extra },
    { registry, seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
/** 7×9 空旷夜战；位置在开战后指定，行动顺序按传入顺序。 */
function night(units: Combatant[], positions: Record<string, number>) {
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V12_OVERFLOW_D20, combatants: units, battlefield: field, field: { tags: ['night'] }, seed: 'intel', traitRegistry: registry });
  battle.start();
  for (const u of battle.combatants) u.pos = positions[u.id];
  battle.turnOrder = units.map((u) => u.id); battle.turnIndex = 0;
  return battle;
}
const at = (x: number, y: number) => y * 7 + x;

describe('阵营共享敌情记忆', () => {
  function sighting(scoutSees: boolean) {
    // 侦察兵在右后方看见渗透的敌人后阵亡；左侧队友自己从未看见它。
    const scout = unit('scout', 'ally'), runner = unit('runner', 'ally'), enemy = unit('enemy', 'enemy');
    const battle = night([scout, runner, enemy], { scout: scoutSees ? at(6, 5) : at(6, 0), runner: at(0, 7), enemy: at(6, 7) });
    enemy.conditions.push({ id: 'stunned', dur: 9 });
    battle.moveTo(scout.id, scoutSees ? at(5, 5) : at(5, 0));
    scout.hp = 0; scout.status = 'dead';
    battle.endTurn();
    expect(battle.active?.id).toBe(runner.id);
    expect(battle.visibleCombatants('ally').map((u) => u.id)).not.toContain(enemy.id);
    return { battle, runner, enemy };
  }
  it('看见者阵亡后最后目击仍归全阵营所有，队友循线去查并接敌', () => {
    const { battle, runner, enemy } = sighting(true);
    expect(battle.enemyIntel('ally').traces).toEqual([expect.objectContaining({ id: enemy.id, cell: at(6, 7), name: enemy.name })]);
    battle.autoAction(runner.id);
    expect(gridDistance(battle.battlefield!, runner.pos!, at(6, 7))).toBe(4);
    battle.autoAction(enemy.id); battle.autoAction(runner.id);
    expect(battle.visibleCombatants('ally').map((u) => u.id)).toContain(enemy.id);
    // 没有这条目击时，同一位置的队友按敌方来向往前扫视，不会摸到己方后方的渗透者。
    const blind = sighting(false);
    expect(blind.battle.enemyIntel('ally').traces).toEqual([]);
    blind.battle.autoAction(blind.runner.id);
    expect(Math.floor(blind.runner.pos! / 7)).toBeLessThan(7);
    expect(blind.battle.visibleCombatants('ally').map((u) => u.id)).not.toContain(blind.enemy.id);
  });
  it('追索只用最后目击：敌人离开视野后去了哪里不影响队友的决定', () => {
    const moves = [at(0, 1), at(6, 1)].map((hidden) => {
      const { battle, runner, enemy } = sighting(true);
      enemy.pos = hidden;
      battle.autoAction(runner.id);
      return [runner.pos, battle.log.slice(-3).map((e) => e.text)];
    });
    expect(moves[0]).toEqual(moves[1]);
  });
  it('看不见的来袭留下线索：队友转向受击处附近搜索，而不是照常向前扫视', () => {
    function shot(fired: boolean) {
      const shooter = unit('shooter', 'enemy', { weaponClass: 'bow', traits: ['night-fighter'] }), runner = unit('runner', 'ally'), victim = unit('victim', 'ally');
      shooter.weapon!.range = 8;
      const battle = night([shooter, runner, victim], { shooter: at(6, 3), runner: at(0, 4), victim: at(6, 8) });
      if (fired) battle.attack(shooter.id, victim.id);
      battle.endTurn();
      battle.autoAction(runner.id);
      return { battle, runner };
    }
    const hit = shot(true), quiet = shot(false);
    expect(hit.battle.enemyIntel('ally').clues).toEqual([expect.objectContaining({ victimId: 'victim', cell: at(6, 8), victim: 'victim' })]);
    expect(hit.battle.visibleLog('ally').some((e) => e.text.includes('未定位攻击'))).toBe(true);
    const field = hit.battle.battlefield!;
    expect(gridDistance(field, hit.runner.pos!, at(6, 8))).toBeLessThan(gridDistance(field, quiet.runner.pos!, at(6, 8)));
  });
  it('开局看不见敌人时全队朝敌方来向推进，后排不去搜己方阵地的角落', () => {
    // 旧做法按“谁离得近谁负责”分片搜索，后排单位会被分到己方身后与两侧的角落。
    const units = [unit('a', 'ally', { weaponClass: 'rifle' }), unit('b', 'ally'), unit('c', 'ally'), unit('d', 'ally', { weaponClass: 'bow' }), unit('e1', 'enemy'), unit('e2', 'enemy')];
    const field = standardField(7, 13); field.tiles.fill('open');
    const battle = new SmallBattle({ rules: V12_OVERFLOW_D20, combatants: units, battlefield: field, field: { tags: ['night'] }, seed: 'sweep', traitRegistry: registry });
    battle.start();
    const start: Record<string, number> = { a: at(3, 12), b: at(3, 10), c: at(0, 10), d: at(1, 12), e1: at(2, 0), e2: at(4, 1) };
    for (const u of battle.combatants) u.pos = start[u.id];
    battle.turnOrder = units.map((u) => u.id); battle.turnIndex = 0;
    for (const id of ['a', 'b', 'c', 'd']) {
      while (battle.active?.id !== id) battle.endTurn();
      battle.autoAction(id);
      const u = battle.byId(id);
      expect([id, Math.floor(u.pos! / 7)]).toEqual([id, Math.floor(start[id]! / 7) - 2]);
      expect([id, u.pos! % 7]).toEqual([id, start[id]! % 7]);
    }
  });
  it('藏在暗处时估算落点危险按“走过去会不会被看见”，不会走进火力网再退回来', () => {
    // 夜视哨兵替全队看见两支火枪队；重伤的主角在它们视野外，走近三格内就会被集火。
    const scout = unit('scout', 'ally', { weaponClass: 'bow', traits: ['night-fighter'] }), hero = unit('hero', 'ally');
    const rifles = [unit('r1', 'enemy', { scale: 'company', weaponClass: 'rifle', weaponLevel: 8 }), unit('r2', 'enemy', { scale: 'company', weaponClass: 'rifle', weaponLevel: 8 })];
    const battle = night([hero, scout, ...rifles], { hero: at(3, 8), scout: at(0, 6), r1: at(2, 3), r2: at(4, 3) });
    hero.hp = 120;
    const path: number[] = [hero.pos!];
    for (let turn = 0; turn < 3; turn++) {
      while (battle.active?.id !== hero.id) battle.endTurn();
      battle.autoAction(hero.id); path.push(hero.pos!);
    }
    expect(battle.visibleCombatants('ally').map((u) => u.id)).toEqual(expect.arrayContaining(['r1']));
    const backAndForth = path.some((cell, i) => i >= 2 && cell === path[i - 2] && cell !== path[i - 1]);
    expect(backAndForth, path.map((p) => `${p % 7},${Math.floor(p / 7)}`).join(' → ')).toBe(false);
    expect(battle.visibleCombatants('enemy').map((u) => u.id)).not.toContain(hero.id);
  });
  it('敌情记忆随存档保存，恢复后的AI决定与不中断时一致', () => {
    const { battle, runner } = sighting(true);
    const snapshot = JSON.parse(JSON.stringify(battle.toSnapshot()));
    expect(snapshot.intel.ally.traces).toHaveLength(1);
    const restored = SmallBattle.fromSnapshot(structuredClone(snapshot), { traitRegistry: registry });
    expect(restored.enemyIntel('ally')).toEqual(battle.enemyIntel('ally'));
    battle.autoAction(runner.id); restored.autoAction(runner.id);
    expect(JSON.parse(JSON.stringify(restored.toSnapshot()))).toEqual(JSON.parse(JSON.stringify(battle.toSnapshot())));
    // 旧存档没有记忆字段，读档从空记忆开始；损坏的条目丢弃而不阻止读档。
    const legacy = SmallBattle.fromSnapshot({ ...structuredClone(snapshot), intel: undefined }, { traitRegistry: registry });
    expect(legacy.enemyIntel('ally').traces).toEqual([]);
    const damaged = SmallBattle.fromSnapshot({ ...structuredClone(snapshot), intel: { ally: { traces: [{ id: 'enemy', round: -1, cell: 999 }], clues: 'x' } } }, { traitRegistry: registry });
    expect(damaged.enemyIntel('ally')).toEqual({ traces: [], clues: [] });
  });
  it('会战看不见敌军时先去本阵营最后目击的一翼，不按固定路线巡视', () => {
    function mass(seen: boolean) {
      const scout = unit('a', 'ally'), guard = unit('e', 'enemy');
      scout.scale = guard.scale = 'company';
      scout.tags.push('zone:右翼', seen ? 'rank:front' : 'rank:reserve'); guard.tags.push('zone:中军', 'rank:front');
      const battle = new MassBattle({ rules: V2_TW, combatants: [scout, guard], field: { tags: ['night'] }, seed: 'mass-intel', traitRegistry: registry });
      battle.start();
      // 开战时右翼前排在夜视两阵距内；随后退到预备队，离开敌方视野。
      const live = battle.byId('a'); live.tags = live.tags.map((t) => t === 'rank:front' ? 'rank:reserve' : t);
      expect(battle.visibleCombatants('enemy').map((u) => u.id)).not.toContain('a');
      return battle;
    }
    const remembered = mass(true), unseen = mass(false);
    expect(remembered.enemyIntel('enemy').traces).toEqual([expect.objectContaining({ id: 'a', node: 'ally:右翼:front' })]);
    expect(unseen.enemyIntel('enemy').traces).toEqual([]);
    // 没有目击时第1轮按固定路线先巡左翼；记得右翼有敌时转向右翼。
    expect(unseen.recommendedOrder('e')?.type).toBe('shift-left');
    expect(remembered.recommendedOrder('e')?.type).toBe('shift-right');
    const restored = MassBattle.fromSnapshot(JSON.parse(JSON.stringify(remembered.toSnapshot())), { traitRegistry: registry });
    expect(restored.enemyIntel('enemy')).toEqual(remembered.enemyIntel('enemy'));
    expect(restored.recommendedOrder('e')?.type).toBe('shift-right');
  });
});
