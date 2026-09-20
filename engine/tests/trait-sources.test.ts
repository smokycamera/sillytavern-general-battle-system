import { describe, expect, it } from 'vitest';
import { activeTraitIds, expireTraitSources, generateUnit, grantTraitSource, penetrationContext, previewAttack, resolveAttack, traitRegistry, V2_D20, V2_TW, SmallBattle, MassBattle, standardField, standardConditionMap, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, traits: string[] = [], body: Combatant['body'] = 'human') {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', rulesVersion: 'v2', body, traits, level: 3, hpMax: 400, weaponClass: 'sword', weaponLevel: 6, armorTier: 1 }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
function attack(a: Combatant, b: Combatant) { return { attacker: a, defender: b, rules: V2_D20, conditionDefs: new Map(), traitRegistry: registry, ranged: false }; }
describe('V2特质来源与明确前提', () => {
  it('步兵与机动反制读取身体和坐骑，默认原型不能把车辆当步兵或漏掉骑手', () => {
    for (const mode of ['small', 'mass']) for (const targetKind of ['foot', 'rider', 'vehicle']) {
      const a = unit('a'), b = unit('b', [], targetKind === 'vehicle' ? 'vehicle' : 'human');
      a.traits = ['anti-infantry', 'anti-mobile']; a.weapon!.recipe!.mechanism = 'spear';
      b.archetype = 'infantry'; b.mount = targetKind === 'rider';
      const rng = { seed: 'hit', next: () => 0, d: (n: number) => n };
      a.scale = b.scale = 'company';
      const battle = mode === 'small' ? new SmallBattle({ combatants: [a, b], battlefield: standardField(), rules: V2_D20, rng, traitRegistry: registry }) : new MassBattle({ combatants: [a, b], rules: V2_TW, rng, traitRegistry: registry });
      battle.start();
      if (battle instanceof SmallBattle) { battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 45; b.pos = 38; battle.attack('a', 'b'); }
      else { battle.issue({ unitId: 'a', type: 'attack', targetId: 'b' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1); }
      const hit = battle.log.find((l) => l.resolution?.attackerId === 'a')!.resolution!;
      expect(hit.atkDetail).toContain(targetKind === 'foot' ? '克制步兵' : '克制机动');
      expect(hit.atkDetail).not.toContain(targetKind === 'foot' ? '克制机动' : '克制步兵');
      expect(hit.netAtk).toBe(a.base.atk + 2);
    }
  });
  it('小战与军团实际攻击消费同一守护，整轮后到期，快照不续期', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b');
      grantTraitSource(b, { id: 'one-round', name: '一轮守护', kind: 'blessing', traitIds: ['guardian-greater'], duration: { kind: 'rounds', count: 1 } });
      const rng = { seed: 'hit', next: () => 0, d: (n: number) => n };
      if (mode === 'small') {
        const battle = new SmallBattle({ rules: V2_D20, battlefield: standardField(), combatants: [a, b], seed: 'source-round', rng, traitRegistry: registry }); battle.start();
        while (battle.active?.id !== 'a') battle.endTurn(); a.pos = 21; b.pos = 22;
        battle.attack('a', 'b'); expect(battle.log.find((l) => l.resolution)?.resolution?.wardMult).toBe(0.6);
        const round = battle.round; while (battle.round === round && !battle.isOver()) battle.endTurn();
        expect(activeTraitIds(b)).not.toContain('guardian-greater');
        expect(SmallBattle.fromSnapshot(battle.toSnapshot()).byId('b').traitSources![0]!.remaining).toBe(0);
      } else {
        a.scale = b.scale = 'company'; a.tags.push('zone:中军', 'rank:front'); b.tags.push('zone:中军', 'rank:front');
        const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], seed: 'source-round', rng, traitRegistry: registry }); battle.start();
        battle.issue({ unitId: 'a', type: 'attack', targetId: 'b' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === 'a')?.resolution?.wardMult).toBe(0.6);
        expect(activeTraitIds(b)).not.toContain('guardian-greater'); expect(MassBattle.fromSnapshot(battle.toSnapshot()).byId('b').traitSources![0]!.remaining).toBe(0);
      }
    }
  });
  it('破甲在武器允许范围内改善穿透，同组取强，不恢复无条件AP伤害', () => {
    const a = unit('a'), b = unit('b'); a.weapon!.penetration = 6; b.armor!.protection!.kinetic = 7;
    expect(penetrationContext(attack(a, b)).factor).toBe(0.3);
    a.traits = ['ap-weapon', 'ap-master', 'ap-master'];
    expect(penetrationContext(attack(a, b))).toMatchObject({ penetration: 8, factor: 1 });
    a.weapon!.penetration = 1; b.armor!.protection!.kinetic = 4;
    expect(previewAttack(attack(a, b)).expectedDamage).toBe(0);
    expect(resolveAttack({ ...attack(a, b), rng: { seed: 'hit', next: () => 0, d: (n) => n } }).finalDamage).toBe(0);
  });
  it('反大型按实际body识别载具/巨型，同组屠兽取强，假标签不制造大体型', () => {
    const a = unit('a', ['anti-large', 'monster-hunter']), b = unit('b', [], 'vehicle');
    const result = resolveAttack({ ...attack(a, b), rng: { seed: 'hit', next: () => 0, d: (n) => n } });
    expect(result.netAtk).toBe(a.base.atk + 3); expect(result.dmgMult).toBe(1.4);
    b.body = 'human'; b.tags.push('large');
    const small = resolveAttack({ ...attack(a, b), rng: { seed: 'hit', next: () => 0, d: (n) => n } });
    expect(small.netAtk).toBe(a.base.atk); expect(small.dmgMult).toBe(1);
  });
  it('有期限来源重放不刷新次数，来源和同组守护不双算，改名/序列化不影响结果', () => {
    const a = unit('a'), b = unit('b', ['guardian']);
    const source = { id: 'message:blessing', name: '神灵庇佑', kind: 'blessing' as const, traitIds: ['guardian-greater'], duration: { kind: 'rounds' as const, count: 2 } };
    grantTraitSource(b, source); grantTraitSource(b, source);
    const roll = () => resolveAttack({ ...attack(a, b), rng: { seed: 'hit', next: () => 0, d: (n) => n } });
    expect(roll().wardMult).toBe(0.6); b.name = '改名';
    const serialized = JSON.parse(JSON.stringify(b)); expect(activeTraitIds(serialized)).toContain('guardian-greater');
    expireTraitSources(b, 'rounds'); grantTraitSource(b, source); expireTraitSources(b, 'rounds');
    expect(activeTraitIds(b)).not.toContain('guardian-greater'); expect(roll().wardMult).toBe(0.75);
    grantTraitSource(b, source); expect(activeTraitIds(b)).not.toContain('guardian-greater');
    expect(() => grantTraitSource(b, { ...source, traitIds: ['anti-large'] })).toThrow(/来源|内容/);
  });
  it('装备来源只在实际穿戴该实例时生效，卸下不删除永久已知特质', () => {
    const a = unit('a'), b = unit('b', ['guardian']);
    grantTraitSource(b, { id: 'item-ward', name: '装备守护', kind: 'equipment', equipmentId: b.weapon!.id, traitIds: ['guardian-greater'], duration: { kind: 'permanent' } });
    const before = previewAttack(attack(a, b)).expectedDamage;
    delete b.weapon;
    expect(activeTraitIds(b)).toEqual(['guardian']); expect(previewAttack(attack(a, b)).expectedDamage).toBeGreaterThan(before);
    expect(b.traits).toEqual(['guardian']);
  });
  it('技能守护状态与同组特质取强，重复状态不乘成无敌，过期状态不生效', () => {
    const a = unit('a'), b = unit('b', ['guardian-greater']);
    b.conditions = [{ id: 'blessed', dur: 2 }, { id: 'blessed', dur: 3 }];
    const cast = () => resolveAttack({ ...attack(a, b), conditionDefs: standardConditionMap(), rng: { seed: 'hit', next: () => 0, d: (n) => n } });
    expect(cast().wardMult).toBe(0.6);
    b.traits = []; expect(cast().wardMult).toBe(0.8);
    b.conditions = [{ id: 'blessed', dur: 0 }]; expect(cast().wardMult).toBe(1);
  });
  it('士气专长按士气点结算，临时授予与原生同特质不是十倍差异', () => {
    const original = generateUnit({ name: '老兵', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 400, traits: ['veteran'] }, { seed: 'morale', registry }).unit;
    const blessed = generateUnit({ name: '受赐者', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 400, traits: [] }, { seed: 'morale', registry }).unit;
    grantTraitSource(blessed, { id: 'veteran-gift', name: '老练赐福', kind: 'blessing', traitIds: ['veteran'], duration: { kind: 'permanent' } });
    const dc = 10 + Math.floor(original.morale! / 10) + 1;
    const check = (u: Combatant) => { const battle = new MassBattle({ rules: V2_TW, combatants: [u], traitRegistry: registry, rng: { seed: 'ten', next: () => 0, d: () => 10 } }); return battle.moraleCheck(u, dc, '对照'); };
    expect(check(original)).toBe(true); expect(check(blessed)).toBe(true);
  });
  it('穿甲箭只服务真实动能投射；克制机动不会给持剑者凭空授予长枪', () => {
    const a = unit('a', ['armor-piercing-shot', 'anti-mobile']), b = unit('b'); b.archetype = 'mobile'; b.tags.push('mobile');
    a.weapon!.penetration = 6;
    expect(penetrationContext(attack(a, b)).penetration).toBe(6);
    const result = resolveAttack({ ...attack(a, b), rng: { seed: 'hit', next: () => 0, d: (n) => n } });
    expect(result.netAtk).toBe(a.base.atk); expect(a.tags).not.toContain('spear');
  });
});
