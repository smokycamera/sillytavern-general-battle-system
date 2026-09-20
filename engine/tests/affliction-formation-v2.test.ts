import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, grantTraitSource, expireTraitSources, poisonDamage, resolveAttack, bracePose, standardConditionMap, type Combatant, type GenerateInput } from '../src/index.js';
const registry = traitRegistry(), rng = { seed: 'hit', next: () => 0, d: (n: number) => n };
function unit(id: string, extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'light-ranged', weaponLevel: 8, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit; u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
function battle(mode: string, units: Combatant[]) {
  if (mode === 'mass') { const b = new MassBattle({ combatants: units, rules: V2_TW, traitRegistry: registry, rng }); b.start(); return b; }
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V2_D20, traitRegistry: registry, rng }); b.start(); b.turnOrder = units.map((u) => u.id); b.turnIndex = 0; units[0]!.pos = 52; units[1]!.pos = 38; return b;
}
describe('毒性来源与疏散队形', () => {
  it('毒击依赖实际武器和损伤，两模式毒伤一致，车辆与未穿透不挂毒，多来源不叠层', () => {
    for (const mode of ['small', 'mass']) for (const kind of ['normal', 'vehicle', 'blocked', 'arcane']) {
      const a = unit('a', { traits: ['poison-strike'], ...(kind === 'arcane' ? { weaponEnchantment: 'arcane' as const } : {}) }), b = unit('b', kind === 'vehicle' ? { body: 'vehicle' } : {});
      if (kind === 'blocked') b.armor!.protection!.kinetic = 99;
      grantTraitSource(a, { id: 'venom', name: '毒性来源', kind: 'blessing', traitIds: ['poison-strike'], duration: { kind: 'rounds', count: 2 } });
      const combat = battle(mode, [a, b]); let afterWeapon: number;
      if (combat instanceof SmallBattle) { const r = combat.attack(a.id, b.id); afterWeapon = r.hpAfter; combat.endTurn(); }
      else { combat.issue({ unitId: a.id, type: 'volley', targetId: b.id }); combat.issue({ unitId: b.id, type: 'hold' }); combat.resolveRound(); afterWeapon = combat.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!.hpAfter; }
      const poison = b.conditions.filter((c) => c.id === 'poisoned'); expect(poison.length).toBe(kind === 'normal' ? 1 : 0);
      if (kind === 'normal') { expect(poison[0]!.sourceId).toBe(a.id); expect(afterWeapon - b.hp).toBe(1); expect(poison[0]!.dur).toBe(mode === 'small' ? 3 : 2); }
    }
    expect(poisonDamage(unit('b', { scale: 'hero', body: 'giant' }), 4)).toBe(1);
  });
  it('持续毒伤击败目标保留来源归功，回合恢复不重复杀敌或洗掉伤员', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a'), b = unit('b'), reserve = unit('c'); b.hp = 1; b.conditions.push({ id: 'poisoned', dur: 3, sourceId: a.id });
      const combat = battle(mode, [a, b, reserve]);
      if (combat instanceof SmallBattle) combat.endTurn(); else { for (const u of [a, b, reserve]) combat.issue({ unitId: u.id, type: 'hold' }); combat.resolveRound(); }
      expect(b.status).toBe('dead'); expect(combat.xpByUnit.get(a.id)).toBe(b.xpValue); expect(b.recoverableWounded ?? 0).toBe(0);
    }
  });
  it('真实范围技能对疏散编队减轻暴露，目标集合最多两名且预览不消耗RNG；固守或近战可反制', () => {
    for (const mode of ['small', 'mass']) for (const dispersed of [false, true]) {
      const a = unit('a', { weaponClass: 'magic', abilityBlueprints: [{ id: 'bp-firestorm', level: 8 }] }), b = unit('b', { sidearmClass: 'sword' }), c = unit('c');
      a.tags = ['zone:中军', 'rank:rear'];
      if (dispersed) grantTraitSource(b, { id: 'loose', name: '疏散训练', kind: 'blessing', traitIds: ['loose-formation'], duration: { kind: 'rounds', count: 2 } });
      const combat = battle(mode, [a, b, c]);
      if (combat instanceof SmallBattle) { b.pos = 31; c.pos = 38; }
      const before = structuredClone(combat.toSnapshot()), ability = a.abilities[0]!;
      const expected = () => combat instanceof SmallBattle ? combat.getActionOptions(a.id).find((o) => o.id === ability.id)!.targets!.find((t) => t.targetId === b.id)!.preview!.expectedDamage! : combat.orderPreview({ unitId: a.id, type: 'ability', abilityId: ability.id, targetId: b.id }).preview!.expectedDamage;
      const dense = expected(); delete ability.areaExposure;
      const frozen = expected(); ability.areaExposure = 4;
      expect(dense).toBeGreaterThan(frozen); // 旧冻结范围技能不被自动升级；新技能才具备有限群体暴露。
      b.hp = 2; expect(expected()).toBeLessThan(dense); b.hp = 500;
      b.scale = 'hero'; const individual = expected(); delete ability.areaExposure; expect(expected()).toBe(individual); ability.areaExposure = 4; b.scale = 'company';
      if (combat instanceof SmallBattle) expect(combat.getActionOptions(a.id).find((o) => o.id === ability.id)!.targets!.find((t) => t.targetId === b.id)!.preview!.areaTargets).toHaveLength(2); else { const preview = combat.orderPreview({ unitId: a.id, type: 'ability', abilityId: ability.id, targetId: b.id }); expect(preview.preview?.expectedDamage).toBeGreaterThan(0); expect(preview.areaTargets).toHaveLength(2); }
      expect(combat.toSnapshot()).toEqual(before);
      let resolutions;
      if (combat instanceof SmallBattle) { const result = combat.useAbility(a.id, ability.id, b.id); expect(result.ok).toBe(true); resolutions = result.resolutions; }
      else { combat.useAbility(a.id, ability.id, b.id); combat.issue({ unitId: b.id, type: 'hold' }); combat.issue({ unitId: c.id, type: 'hold' }); combat.resolveRound(); resolutions = combat.log.flatMap((l) => l.resolution?.attackerId === a.id ? [l.resolution] : []); }
      expect(resolutions).toHaveLength(2); expect(resolutions.find((r) => r.defenderId === b.id)!.wardMult).toBe(dispersed ? 0.5 : 1);
      if (dispersed) {
        const opts = { rules: mode === 'small' ? V2_D20 : V2_TW, rng, traitRegistry: registry, conditionDefs: standardConditionMap() };
        expect(resolveAttack({ ...opts, attacker: b, defender: structuredClone(a), weaponOverride: b.sidearm, ranged: false, participants: 6 }).participants).toBe(3);
        b.tacticalPose = bracePose(b, a, mode === 'small' ? 'small' : 'mass', mode === 'small' ? 7 : undefined);
        expect(resolveAttack({ ...opts, attacker: a, defender: structuredClone(b), abilityDamage: { baseDice: '2d6', shape: 'burst', channel: 'arcane', penetration: 5 } }).wardMult).toBe(1);
        expireTraitSources(b, 'rounds'); expireTraitSources(b, 'rounds'); expect(b.traitSources![0]!.remaining).toBe(0); }
    }
  });
});
