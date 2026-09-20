import { describe, expect, it } from 'vitest';
import { generateUnit, MassBattle, SmallBattle, traitRegistry, V2_TW, V2_D20, standardField, setFormation, FORMATION_NODES, moraleProfile, moraleAttackMods, grantTraitSource, collectMods, resolveStack, standardConditionMap, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, side: 'ally' | 'enemy' = 'ally') {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'sword', traits: [] }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.morale = 70; u.base.moraleMax = 100; u.tags.push('zone:中军', 'rank:front'); return u;
}
const place = (u: Combatant, id: string) => setFormation(u, FORMATION_NODES.find((n) => n.id === id)!);
describe('空间士气与可观察压力', () => {
  it('会战远处或已经撤离的恐惧不影响全图，同类多个来源取强，统率必须靠近', () => {
    const a = unit('a'), f = unit('f', 'enemy'), c = unit('c'), f2 = unit('f2', 'enemy'); f.traits = f2.traits = ['fear']; c.traits = ['commander'];
    const battle = new MassBattle({ combatants: [a, f, f2, c], rules: V2_TW, traitRegistry: registry, seed: 'auras' }); battle.start();
    place(f, 'enemy:右翼:reserve'); place(f2, 'enemy:左翼:reserve'); place(c, 'ally:中军:reserve');
    expect(battle.effectiveMorale(a)).toBe(70);
    place(f, 'enemy:中军:front'); place(f2, 'enemy:中军:front'); expect(battle.effectiveMorale(a)).toBe(62);
    place(c, 'ally:中军:rear'); expect(battle.effectiveMorale(a)).toBe(72);
    f.status = f2.status = 'fled'; expect(battle.effectiveMorale(a)).toBe(80); c.status = 'dying'; expect(battle.effectiveMorale(a)).toBe(70);
  });
  it('两模式实际攻击受到近域恐惧影响，指挥支援与不溃可以抵消，预览只读', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), f = unit('f', 'enemy'), c = unit('c'); f.traits = ['fear']; c.traits = ['commander'];
      const battle = mode === 'small' ? new SmallBattle({ combatants: [a, f, c], rules: V2_D20, battlefield: standardField(), traitRegistry: registry, seed: 'aura-attack' }) : new MassBattle({ combatants: [a, f, c], rules: V2_TW, traitRegistry: registry, seed: 'aura-attack' }); battle.start();
      if (battle instanceof SmallBattle) { battle.turnOrder = ['a', 'f', 'c']; battle.turnIndex = 0; a.pos = 43; f.pos = 36; c.pos = 62; }
      else place(c, 'ally:右翼:reserve');
      const preview = () => battle instanceof SmallBattle ? battle.getActionOptions('a').find((o) => o.id === 'weapon')!.targets!.find((t) => t.targetId === 'f')!.preview!.hitChance : battle.orderPreview({ unitId: 'a', type: 'attack', targetId: 'f' }).preview!.hitChance;
      const before = structuredClone(battle.toSnapshot()), pressured = preview(); expect(battle.toSnapshot()).toEqual(before);
      a.traits = ['steadfast']; expect(preview()).toBeGreaterThan(pressured!); a.traits = [];
      if (battle instanceof SmallBattle) { c.pos = 44; } else place(c, 'ally:中军:rear');
      expect(preview()).toBeGreaterThan(pressured!); c.status = 'fled';
      if (battle instanceof SmallBattle) battle.attack('a', 'f'); else { battle.issue({ unitId: 'a', type: 'attack', targetId: 'f' }); battle.issue({ unitId: 'f', type: 'hold' }); battle.resolveRound(1); }
      expect(battle.log.find((l) => l.resolution?.attackerId === 'a')!.resolution!.netAtk).toBe(a.base.atk - 1);
    }
  });
  it('墙后或未侦察的恐惧不泄漏，AI移动候选按抵达位置判断范围', () => {
    const a = unit('a'), f = unit('f', 'enemy'); f.traits = ['fear', 'stalk'];
    const field = standardField(); field.tiles.fill('open');
    const battle = new SmallBattle({ combatants: [a, f], rules: V2_D20, battlefield: field, traitRegistry: registry, seed: 'visibility' }); battle.start();
    a.pos = 43; f.pos = 22;
    expect(moraleProfile(battle.observationContext(), a).fear).toBe(0);
    f.tacticalRevealed = true; expect(moraleProfile(battle.observationContext(), a).fear).toBe(8);
    battle.battlefield!.tiles[36] = 'wall'; expect(moraleProfile(battle.observationContext(), a).fear).toBe(0); battle.battlefield!.tiles[36] = 'open';
    const arrival = { ...a, pos: 57 }; expect(moraleAttackMods(battle.observationContext(battle.combatants.map((u) => u.id === a.id ? arrival : u)), arrival)).toEqual([]);
    expect(a.pos).toBe(43);
  });
  it('冲锋预览不能用尚未发现的恐惧来源反推目的地危险', () => {
    const a = unit('a'), target = unit('target', 'enemy'), hidden = unit('hidden', 'enemy'); hidden.traits = ['fear']; a.archetype = 'mobile';
    const field = standardField(); field.tiles.fill('open');
    const battle = new SmallBattle({ combatants: [a, target, hidden], rules: V2_D20, battlefield: field, field: { tags: ['night'] }, traitRegistry: registry, seed: 'hidden-aura' }); battle.start();
    battle.turnOrder = ['a', 'target', 'hidden']; battle.turnIndex = 0; a.pos = 43; target.pos = 22; hidden.pos = 8;
    expect(battle.visibleCombatants('ally')).not.toContain(hidden);
    const preview = () => { const option = battle.getActionOptions('a').find((o) => o.id === 'charge')!.targets!.find((t) => t.targetId === 'target')!; expect(option, option.reason).toMatchObject({ enabled: true }); return option.preview!.hitChance; };
    const nearbyHidden = preview(); hidden.pos = 6; expect(preview()).toBe(nearbyHidden);
  });
  it('随队统率用宿主阵位；同类多个指挥取强，宿主溃退或人物失能立即失效', () => {
    const a = unit('a'), host = unit('host'), officer = unit('officer'), other = unit('other'), enemy = unit('enemy', 'enemy');
    officer.scale = 'hero'; officer.traits = other.traits = ['commander'];
    place(host, 'ally:右翼:reserve'); place(officer, 'ally:右翼:reserve'); place(other, 'ally:右翼:reserve');
    const battle = new MassBattle({ combatants: [a, host, officer, other, enemy], rules: V2_TW, traitRegistry: registry, seed: 'command' }); battle.start();
    expect(battle.attached.get('host')).toBe('officer'); expect(battle.effectiveMorale(a)).toBe(70);
    place(host, 'ally:中军:rear'); expect(battle.effectiveMorale(a)).toBe(80);
    place(other, 'ally:中军:rear'); expect(battle.effectiveMorale(a)).toBe(80);
    host.status = other.status = 'routing'; expect(battle.effectiveMorale(a)).toBe(70);
    host.status = 'ready'; officer.conditions = [{ id: 'stunned', dur: 2 }]; expect(battle.effectiveMorale(a)).toBe(70);
  });
  it('个体顽固真实抵抗恐惧，不溃抵抗惊惧来源但保留其他减益和控制', () => {
    const a = unit('a'), fear = unit('fear', 'enemy'); a.scale = 'hero'; delete a.morale; delete a.base.moraleMax; fear.traits = ['terror'];
    const field = standardField(); field.tiles.fill('open'); a.pos = 43; fear.pos = 36;
    const context = { units: [a, fear], mode: 'small' as const, fieldTags: ['plains'], battlefield: field };
    expect(moraleProfile(context, a).attackPenalty).toBe(2);
    a.traits = ['stubborn']; expect(moraleProfile(context, a).attackPenalty).toBe(0);
    a.traits = ['steadfast']; a.conditions = [{ id: 'fearful', dur: 2 }, { id: 'stunned', dur: 2 }];
    grantTraitSource(a, { id: 'fearful-source', name: '惊惧', kind: 'effect', traitIds: [], conditionIds: ['fearful'], duration: { kind: 'rounds', count: 2 } });
    grantTraitSource(a, { id: 'curse-source', name: '诅咒', kind: 'effect', traitIds: [], conditionIds: ['cursed'], duration: { kind: 'rounds', count: 2 } });
    expect(moraleProfile(context, a).fear).toBe(0);
    const mods = collectMods(a, {}, standardConditionMap(), [], registry); expect(mods.some((m) => m.sourceId?.includes('fearful'))).toBe(false);
    expect(resolveStack(mods, 'atk', {}).flatTotal).toBe(-2); expect(a.conditions.some((c) => c.id === 'stunned')).toBe(true);
  });
});
