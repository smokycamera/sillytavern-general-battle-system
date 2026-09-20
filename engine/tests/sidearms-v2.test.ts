import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, formationNode, grantTraitSource, revokeTraitSource, movementPoints, footprint, mountedShooting, equipmentReason, WEAPON_CLASSES, type Combatant } from '../src/index.js';
const registry = traitRegistry();
const input = { name: '双武器', side: 'ally' as const, scale: 'company' as const, rulesVersion: 'v2' as const, level: 3, hpMax: 500, weaponClass: 'sword', sidearmClass: 'light-ranged', traits: [] };
function unit(id: string, side: 'ally' | 'enemy' = 'ally', weaponClass = 'sword') {
  const u = generateUnit({ ...input, name: id, side, weaponClass }, { seed: id, registry, noVariance: true }).unit; u.id = id; u.morale = 100; u.base.moraleMax = 100; u.tags.push('zone:中军', 'rank:front'); return u;
}
function small(a: Combatant, b: Combatant) {
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: field, traitRegistry: registry, seed: 'loadout', rng: { seed: 'hit', next: () => 0, d: (n) => Math.min(n, 10) } });
  battle.start(); battle.turnOrder = [a.id, b.id]; battle.turnIndex = 0; a.pos = 45; b.pos = 38; return battle;
}
function mass(a: Combatant, b: Combatant, others: Combatant[] = []) {
  const battle = new MassBattle({ combatants: [a, b, ...others], rules: V2_TW, traitRegistry: registry, seed: 'loadout', rng: { seed: 'hit', next: () => 0, d: (n) => Math.min(n, 10) } }); battle.start(); return battle;
}
describe('轻型远程副武器', () => {
  it('远近双全仅消除允许的抵近射击罚，两模式来源撤销立刻失效，长弓仍受牵制', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a', 'ally', 'light-ranged'), b = unit('b', 'enemy'); delete a.sidearm; a.base.atk = 3;
      const battle = mode === 'small' ? small(a, b) : mass(a, b);
      const preview = () => battle instanceof SmallBattle ? battle.getActionOptions(a.id).find((o) => o.id === 'weapon')!.targets![0]!.preview! : battle.orderPreview({ unitId: a.id, type: 'volley', targetId: b.id }).preview!;
      const before = preview().hitChance!;
      grantTraitSource(a, { id: 'close', name: '熟练', kind: 'blessing', traitIds: ['versatile'], duration: { kind: 'permanent' } });
      expect(preview().hitChance!).toBeGreaterThan(before); revokeTraitSource(a, 'close'); expect(preview().hitChance).toBe(before);
      a.traits.push('versatile');
      if (battle instanceof SmallBattle) expect(battle.attack(a.id, b.id).netAtk).toBe(3);
      else { battle.issue({ unitId: a.id, type: 'volley', targetId: b.id }); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(); expect(battle.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!.netAtk).toBe(3); }
      const archer = unit('archer', 'ally', 'bow'), enemy = unit('enemy', 'enemy'); archer.traits.push('versatile'); delete archer.sidearm;
      const constrained = mode === 'small' ? small(archer, enemy) : mass(archer, enemy);
      expect(constrained instanceof SmallBattle ? constrained.getActionOptions(archer.id).find((o) => o.id === 'weapon')!.enabled : !constrained.orderPreview({ unitId: archer.id, type: 'volley', targetId: enemy.id }).reason).toBe(false);
    }
  });
  it('冲锋真实接近后才有强化，接敌原地不能重复冲锋，拥挤不会隔空命中', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b', 'enemy'); a.traits.push('charge-strong');
      if (mode === 'mass') a.tags = ['zone:中军', 'rank:rear'];
      const battle = mode === 'small' ? small(a, b) : mass(a, b);
      if (battle instanceof SmallBattle) {
        b.pos = 31; const start = a.pos!; const cost = battle.getActionOptions(a.id).find((o) => o.id === 'charge')!.targets![0]!.preview!.movementCost;
        const result = battle.attack(a.id, b.id, { charge: true }); expect(a.pos).not.toBe(start); expect(battle.dist(a, b)).toBe(1); expect(cost).toBe(battle.movementSpent.get(a.id)); expect(result.atkDetail).toContain('冲锋强化');
      } else {
        const order = { unitId: a.id, type: 'charge' as const, targetId: b.id }, snapshot = structuredClone(battle.toSnapshot());
        expect(battle.orderPreview(order).approach?.id).toBe('ally:中军:front'); expect(battle.toSnapshot()).toEqual(snapshot);
        battle.issue(order); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound();
        expect(formationNode(a).id).toBe('ally:中军:front'); expect(a.fatigue).toBe(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!.atkDetail).toContain('冲锋强化');
        a.fatigue = 0; expect(battle.orderPreview(order).reason).toContain('助跑');
      }
    }
    const a = unit('a'), b = unit('b', 'enemy'); a.traits.push('charge-strong'); a.tags = ['zone:中军', 'rank:rear'];
    const blockers = ['c', 'd', 'e'].map((id) => unit(id));
    const crowded = mass(a, b, blockers); expect(crowded.issue({ unitId: a.id, type: 'charge', targetId: b.id }).ok).toBe(false);
    expect(formationNode(a).rank).toBe('rear');
  });
  it('骑射需要明确平台，后撤射击共用预算，小战仍受警戒，会战自动选择合法后方', () => {
    for (const mount of [false, true]) {
      const a = unit('a', 'ally', 'bow'), b = unit('b', 'enemy'); delete a.sidearm; a.traits.push('mounted-archer'); a.mount = mount;
      expect(movementPoints(a)).toBe(mount ? 4 : 3); expect(footprint(a)).toBe(mount ? 2 : 1);
      const battle = small(a, b);
      battle.moveTo(a.id, 52);
      expect(battle.log.some((l) => l.resolution?.attackerId === b.id)).toBe(!mount);
      const result = battle.attack(a.id, b.id);
      expect(result.atkDetail.includes('移动射击')).toBe(!mount); expect(battle.actedThisTurn.has(a.id)).toBe(true);
      const archer = unit('archer', 'ally', 'bow'), enemy = unit('enemy', 'enemy'); delete archer.sidearm; archer.mount = mount; archer.traits.push('mounted-archer');
      const army = mass(archer, enemy), order = { unitId: archer.id, type: 'volley' as const, targetId: enemy.id };
      expect(army.orderPreview(order).withdrawal?.id).toBe(mount ? 'ally:中军:rear' : undefined);
      expect(army.issue(order).ok).toBe(mount);
      if (mount) { army.issue({ unitId: enemy.id, type: 'hold' }); army.resolveRound(); expect(formationNode(archer).rank).toBe('rear'); expect(archer.fatigue).toBe(0.5); expect(army.log.filter((l) => l.resolution?.attackerId === archer.id)).toHaveLength(1); }
    }
    const vehicle = unit('vehicle', 'ally', 'rifle'); vehicle.body = 'vehicle'; vehicle.traits.push('mounted-archer'); expect(mountedShooting(vehicle)).toBe(false);
    const rider = unit('rider', 'ally', 'bow'), watcher = unit('watcher', 'enemy', 'light-ranged'); rider.mount = true; rider.traits.push('mounted-archer'); delete watcher.sidearm;
    const watched = small(rider, watcher); watched.overwatch.add(watcher.id); watched.moveTo(rider.id, 52);
    expect(watched.reactionSpent.has(watcher.id)).toBe(true);
  });

  it('所有武器种类都能放入副槽，只遵守通用平台与负载条件', () => {
    const u = unit('a'); expect(u.sidearm).toMatchObject({ hands: 1, load: 1, range: 2, recipe: { mechanism: 'light-ranged' } });
    for (const sidearmClass of Object.keys(WEAPON_CLASSES)) {
      const generated=generateUnit({ ...input, body:'vehicle', sidearmClass }, { seed: 'free-secondary', registry }).unit;
      expect(generated.sidearm?.recipe?.mechanism).toBe(sidearmClass); expect(equipmentReason(generated)).toBeUndefined();
    }
    expect(equipmentReason(generateUnit({...input,sidearmClass:'rifle'},{registry,seed:'rifle-secondary'}).unit)).toBeUndefined();
  });
  it('小战副武器真正远射，支付同一主行动；主武器仍用于近战，不能用副枪借机挥砍', () => {
    const a = unit('a'), b = unit('b', 'enemy');
    const battle = new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: standardField(), seed: 'secondary-small', traitRegistry: registry, rng: { seed: 'hit', next: () => 0, d: (n) => Math.min(n, 10) } }); battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 45; b.pos = 31;
    const option = battle.getActionOptions('a').find((o) => o.id === 'weapon:sidearm')!; expect(option.targets![0]!.enabled).toBe(true); expect(option.range?.max).toBe(2);
    const before = structuredClone(battle.toSnapshot()); battle.getActionOptions('a'); expect(battle.toSnapshot()).toEqual(before);
    battle.attack('a', 'b', { weaponMode: 'sidearm' }); expect(battle.actedThisTurn.has('a')).toBe(true); expect(battle.log.find((l) => l.resolution)?.resolution?.baseRoll?.expr).toBe(a.sidearm!.baseDice);
    expect(() => battle.attack('a', 'b', { weaponMode: 'sidearm' })).toThrow(/主行动/);
  });
  it('会战按任务自动选择合法副武器，齐射用投射，近战仍用主剑', () => {
    const a = unit('a'), b = unit('b', 'enemy');
    const battle = new MassBattle({ combatants: [a, b], rules: V2_TW, seed: 'secondary-mass', traitRegistry: registry, rng: { seed: 'hit', next: () => 0, d: () => 10 } }); battle.start();
    const preview = battle.orderPreview({ unitId: 'a', type: 'volley', targetId: 'b' }); expect(preview.reason).toBeUndefined(); expect(preview.preview!.expectedDamage).toBeGreaterThan(0);
    expect(battle.issue({ unitId: 'a', type: 'volley', targetId: 'b' }).ok).toBe(true); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
    expect(battle.log.find((l) => l.resolution?.attackerId === 'a')!.resolution!.baseRoll!.expr).toBe(a.sidearm!.baseDice);
    expect(a.fatigue).toBe(0.5);
  });
  it('远程副武器不能借机挥砍；警戒选中的副枪与实际弹道相同，不重置主炮装填', () => {
    for (const watching of [false, true]) {
      const a = unit('a'), b = unit('b', 'enemy', 'cannon'); b.base.atk = 100;
      const battle = new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: standardField(), seed: 'secondary-reaction', traitRegistry: registry, rng: { seed: 'hit', next: () => 0, d: (n) => Math.min(n, 10) } }); battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 52; b.pos = 31;
      battle.reloadCd.set(b.id, 2); if (watching) battle.overwatch.add(b.id);
      battle.moveTo(a.id, 45);
      if (watching) {
        const shot = battle.log.find((l) => l.resolution?.attackerId === b.id)!.resolution!;
        expect(shot.baseRoll!.expr).toBe(b.sidearm!.baseDice); expect(shot.netAtk).toBe(100); expect(battle.reactionSpent.has(b.id)).toBe(true); expect(battle.reloadCd.get(b.id)).toBe(2);
      } else {
        battle.moveTo(a.id, 38); expect(battle.pathPreview(a.id, 45).risks).toEqual([]); battle.moveTo(a.id, 45);
        expect(battle.log.some((l) => l.resolution?.attackerId === b.id)).toBe(false);
      }
    }
  });
  it('两模式主炮装填时仍可使用副枪，但不能同时再获主行动或把副枪作为冲锋武器', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a', 'ally', 'cannon'), b = unit('b', 'enemy'); a.base.atk = 100; a.archetype = 'mobile';
      const battle = mode === 'small' ? new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: standardField(), traitRegistry: registry, seed: 'reload-side', rng: { seed: 'hit', next: () => 0, d: (n) => Math.min(n, 10) } }) : new MassBattle({ combatants: [a, b], rules: V2_TW, traitRegistry: registry, seed: 'reload-side', rng: { seed: 'hit', next: () => 0, d: () => 10 } }); battle.start(); battle.reloadCd.set(a.id, 2);
      if (battle instanceof SmallBattle) {
        battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 45; b.pos = 31;
        expect(battle.getActionOptions(a.id).find((o) => o.id === 'charge')!.enabled).toBe(false);
        battle.attack(a.id, b.id, { weaponMode: 'sidearm' }); expect(battle.reloadCd.get(a.id)).toBe(2); expect(battle.actedThisTurn.has(a.id)).toBe(true);
      } else {
        expect(battle.issue({ unitId: a.id, type: 'charge', targetId: b.id }).ok).toBe(false);
        expect(battle.issue({ unitId: a.id, type: 'volley', targetId: b.id }).ok).toBe(true); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!.baseRoll!.expr).toBe(a.sidearm!.baseDice); expect(battle.reloadCd.get(a.id)).toBe(1);
      }
    }
  });
});

