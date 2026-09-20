import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, activeTraitIds, grantTraitSource, expireTraitSources, applyXp, movementPoints, effectiveProtection, type GenerateInput, type Combatant } from '../src/index.js';
const registry = traitRegistry(), rng = { seed: 'hit', next: () => 0, d: (n: number) => Math.min(n, 10) };
function unit(extra: Partial<GenerateInput> = {}, id = 'a') {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 80, weaponClass: 'light-ranged', weaponLevel: 1, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit; u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
function battle(mode: string, a: Combatant, b: Combatant) {
  if (mode === 'mass') { const result = new MassBattle({ combatants: [a, b], rules: V2_TW, traitRegistry: registry, rng }); result.start(); return result; }
  delete a.pos; delete b.pos;
  const field = standardField(); field.tiles.fill('open');
  const result = new SmallBattle({ combatants: [a, b], rules: V2_D20, traitRegistry: registry, battlefield: field, rng }); result.start(); result.turnOrder = [a.id, b.id]; result.turnIndex = 0; a.pos = 45; b.pos = 31; return result;
}
function fire(combat: SmallBattle | MassBattle, a: Combatant, b: Combatant) {
  if (combat instanceof SmallBattle) return combat.attack(a.id, b.id);
  combat.issue({ unitId: a.id, type: 'volley', targetId: b.id }); combat.issue({ unitId: b.id, type: 'hold' }); combat.resolveRound(); return combat.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!;
}
describe('身体、重装与训练特质同源', () => {
  it('重甲与超重在实际护甲下取强；卸甲撤销，来源到期保留装备自带效果', () => {
    for (const mode of ['small', 'mass']) for (const invalid of [false, true]) {
      const a = unit(), b = unit({ armorTier: 4 }, 'b'), combat = battle(mode, a, b), base = b.base.def;
      grantTraitSource(b, { id: 'armor-skill', name: '重装专长', kind: 'blessing', traitIds: ['heavy-armor', 'super-heavy'], duration: { kind: 'rounds', count: 1 } });
      if (invalid) delete b.armor;
      const result = fire(combat, a, b); expect(result.targetDef).toBe(base);
      expireTraitSources(b, 'rounds');
      const reopened = battle(mode, unit(), b); expect(fire(reopened, reopened.combatants[0]!, b).targetDef).toBe(base);
    }
    const plain = unit({ armorTier: 4 }), stacked = unit({ armorTier: 4, traits: ['heavy-armor', 'super-heavy'] });
    expect(stacked.base.def - plain.base.def).toBe(0); expect(stacked.base.spd - plain.base.spd).toBe(-2);
  });
  it('大型与泰坦由身体自动提供，结构防护与装备取强，生命不叠加且两模式真实减伤', () => {
    const ordinary = unit({ body: 'giant', scale: 'hero', hpMax: undefined }), named = unit({ body: 'giant', scale: 'hero', hpMax: undefined, traits: ['large', 'titan'] });
    expect(ordinary.base.hpMax).toBe(named.base.hpMax); expect(activeTraitIds(ordinary)).toEqual(expect.arrayContaining(['large', 'titan'])); expect(movementPoints(ordinary)).toBe(2);
    expect(effectiveProtection(ordinary, 'kinetic')).toBe(2); ordinary.armor!.protection!.kinetic = 5; expect(effectiveProtection(ordinary, 'kinetic')).toBe(5);
    const group = unit({ body: 'giant', traits: ['large', 'titan'], hp: 70, hpMax: 80 }), frozen = structuredClone(group.weapon); applyXp(group, 9999, registry); expect(group.base.hpMax).toBe(80); expect(group.hp).toBe(70); expect(group.weapon).toEqual(frozen);
    expect(() => grantTraitSource(unit(), { id: 'size', name: '巨化', kind: 'blessing', traitIds: ['titan'], duration: { kind: 'permanent' } })).toThrow(/身体/);
    for (const mode of ['small', 'mass']) { const a = unit(), b = unit({ body: 'giant' }, 'b'); const result = fire(battle(mode, a, b), a, b); expect(result.drPercent).toBe(70); }
  });
  it('精锐的默认个体体能、显式上限与编队人数分开；机械化收益需要实际车辆及装甲', () => {
    const base = unit({ scale: 'hero', hpMax: undefined }), elite = unit({ scale: 'hero', hpMax: undefined, traits: ['elite'] }); expect(elite.base.hpMax - base.base.hpMax).toBe(8);
    const explicit = unit({ scale: 'hero', hp: 18, hpMax: 43, traits: ['elite'] }); expect(explicit.base.hpMax).toBe(43); expect(explicit.hp).toBe(18);
    const group = unit({ hp: 70, traits: ['elite'] }); grantTraitSource(group, { id: 'training', name: '精锐训练', kind: 'blessing', traitIds: ['elite'], duration: { kind: 'rounds', count: 1 } });
    expect(group.hp).toBe(70); expect(group.base.hpMax).toBe(80); expect(group.base.atk - unit().base.atk).toBe(2);
    const naked = unit({ traits: ['mechanized'] }), vehicle = unit({ body: 'vehicle', armorTier: 1, traits: ['mechanized'] }), car = unit({ body: 'vehicle', armorTier: 1 }), tank = unit({ body: 'vehicle', armorTier: 4, weaponClass: 'cannon' });
    expect(naked.base.spd).toBe(unit().base.spd); expect(vehicle.base.spd - car.base.spd).toBe(2); expect(vehicle.base.def - car.base.def).toBe(1); expect(movementPoints(vehicle)).toBe(4); expect(movementPoints(tank)).toBe(2);
  });
});
