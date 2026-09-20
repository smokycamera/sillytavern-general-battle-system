import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, type Combatant, type GenerateInput } from '../src/index.js';
const registry = traitRegistry(), rng = { seed: 'hit', next: () => 0, d: (n: number) => n };
function unit(id: string, extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'company', level: 3, hpMax: 500, weaponClass: 'rifle', weaponLevel: 10, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit; u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
function battle(mode: string, a: Combatant, b: Combatant) {
  if (mode === 'mass') { const x = new MassBattle({ combatants: [a, b], rules: V2_TW, rng, traitRegistry: registry }); x.start(); return x; }
  const field = standardField(); field.tiles.fill('open'); const x = new SmallBattle({ combatants: [a, b], rules: V2_D20, rng, traitRegistry: registry, battlefield: field }); x.start(); x.turnOrder = ['a', 'b']; x.turnIndex = 0; a.pos = 45; b.pos = 38; return x;
}
function preview(x: SmallBattle | MassBattle, a: Combatant, b: Combatant) {
  return x instanceof SmallBattle ? x.getActionOptions(a.id).find((o) => o.id === a.abilities[0]!.id)!.targets![0]!.preview! : x.orderPreview({ unitId: a.id, type: 'ability', abilityId: a.abilities[0]!.id, targetId: b.id }).preview!;
}
function cast(x: SmallBattle | MassBattle, a: Combatant, b: Combatant) {
  if (x instanceof SmallBattle) { const result = x.useAbility(a.id, a.abilities[0]!.id, b.id); expect(result.ok).toBe(true); return result.resolutions[0]!; }
  expect(x.useAbility(a.id, a.abilities[0]!.id, b.id).ok).toBe(true);
  x.issue({ unitId: b.id, type: 'hold' }); x.resolveRound(); return x.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!;
}
describe('物理技法的实际装备基准', () => {
  it('高阶技法不能借主枪或技能P绕过弱副剑，强副剑/附魔真实影响两模式并共享展开与毒击', () => {
    for (const mode of ['small', 'mass']) for (const kind of ['weak', 'strong', 'enchanted']) {
      const a = unit('a', { sidearmClass: 'sword', sidearmName: '真实副剑', sidearmLevel: kind === 'weak' ? 1 : 8, ...(kind === 'enchanted' ? { sidearmEnchantment: 'arcane' as const } : {}), traits: ['poison-strike'], abilityBlueprints: [{ id: 'bp-crushing-blow', level: 10 }] });
      const b = unit('b', { armorTier: 3, armorLevel: 7 }), x = battle(mode, a, b), shown = preview(x, a, b);
      expect(shown.weaponName).toBe('真实副剑'); expect(shown.expectedDamage === 0).toBe(kind === 'weak');
      const result = cast(x, a, b); expect(result.penetration).toBe(a.sidearm!.penetration); expect(result.channel).toBe(a.sidearm!.channel); expect(result.participants).toBe(8); expect(result.finalDamage === 0).toBe(kind === 'weak');
      expect(b.conditions.some((c) => c.id === 'poisoned')).toBe(kind === 'strong');
    }
  });
  it('魔法攻击的投送性质不跟随未使用的刀枪改变，也不偷用近战或射击专长', () => {
    for (const mode of ['small', 'mass']) {
      const chances: number[] = [];
      for (const weaponClass of ['sword', 'rifle']) {
        const a = unit('a', { weaponClass, traits: ['melee-master', 'sharpshooter'], abilityBlueprints: ['bp-arcane-bolt'] }), b = unit('b'); a.tags.push('rank:rear');
        const x = battle(mode, a, b); if (x instanceof SmallBattle) b.pos = 31;
        chances.push(preview(x, a, b).hitChance!); expect(cast(x, a, b).netAtk).toBe(a.base.atk);
      }
      expect(chances[0]).toBe(chances[1]);
    }
  });
});
