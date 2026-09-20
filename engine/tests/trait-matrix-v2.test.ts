import { expect, it } from 'vitest';
import { generateUnit, grantTraitSource, revokeTraitSource, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type GenerateInput } from '../src/index.js';
const registry = traitRegistry();
// 补集合核对缺少的基础消费者证据；复杂空间/状态行为沿用各专项，不重复展开。
it('基础攻击专长与场景专长在两模式实际结算，重复来源不叠加，撤销或前提失效消除收益', () => {
  const cases = [
    { id: 'ap-weapon', ranged: false, penetration: true },
    { id: 'ap-master', ranged: false, penetration: true },
    { id: 'armor-piercing-shot', ranged: true, penetration: true },
    { id: 'melee-master', ranged: false }, { id: 'sharpshooter', ranged: true },
    { id: 'berserk', ranged: false }, { id: 'veteran', ranged: false },
    { id: 'urban-fighter', ranged: false, field: 'urban' },
    { id: 'siege-breaker', ranged: false, field: 'siege' },
    { id: 'plains-runner', ranged: false, field: 'plains' },
  ];
  for (const mode of ['small', 'mass']) for (const spec of cases) {
    const run = (kind: 'base' | 'active' | 'duplicate' | 'revoked' | 'wrong' | 'wrong-base') => {
      const make = (id: string, extra: Partial<GenerateInput> = {}) => {
        const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'company', level: 3, hpMax: 500, weaponClass: spec.ranged ? 'rifle' : 'sword', weaponLevel: 10, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit; u.id = id; return u;
      };
      const a = make('a'), b = make('b'); a.morale = b.morale = a.base.moraleMax = b.base.moraleMax = 100;
      if (spec.penetration) { a.weapon!.penetration = 6; b.armor!.protection!.kinetic = 7; }
      if (kind !== 'base' && kind !== 'wrong-base') {
        grantTraitSource(a, { id: 'skill', name: '授予', kind: 'blessing', traitIds: [spec.id], duration: { kind: 'permanent' } });
        if (kind === 'duplicate') grantTraitSource(a, { id: 'same', name: '重复授予', kind: 'blessing', traitIds: [spec.id], duration: { kind: 'permanent' } });
        if (kind === 'revoked') revokeTraitSource(a, 'skill');
      }
      if (kind === 'wrong' && spec.penetration) a.weapon!.channel = 'arcane';
      const tags = [kind.startsWith('wrong') && spec.field ? 'forest' : spec.field ?? 'urban'];
      const rng = { seed: 'hit', next: () => 0, d: (n: number) => n }, field = standardField(); field.tiles.fill('open');
      a.tags = ['zone:中军', spec.ranged ? 'rank:rear' : 'rank:front'];
      const battle = mode === 'small' ? new SmallBattle({ combatants: [a, b], rules: V2_D20, rng, traitRegistry: registry, battlefield: field, field: { tags } }) : new MassBattle({ combatants: [a, b], rules: V2_TW, rng, traitRegistry: registry, field: { tags } });
      battle.start();
      if (battle instanceof SmallBattle) { battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 45; b.pos = spec.ranged ? 31 : 38; battle.attack('a', 'b'); }
      else { battle.issue({ unitId: 'a', type: spec.ranged ? 'volley' : 'attack', targetId: 'b' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1); }
      const hit = battle.log.find((l) => l.resolution?.attackerId === 'a')!.resolution!;
      return { damage: hit.finalDamage, attack: hit.netAtk, penetration: hit.penetration, multiplier: hit.dmgMult };
    };
    const base = run('base'), active = run('active');
    expect(run('duplicate'), mode + '/' + spec.id).toEqual(active); expect(run('revoked'), mode + '/' + spec.id).toEqual(base);
    if (spec.penetration) { expect(active.damage).toBeGreaterThan(base.damage); expect(run('wrong').penetration).toBe(6); }
    else expect(active.attack).toBeGreaterThan(base.attack);
    if (spec.field) expect(run('wrong').attack).toBe(run('wrong-base').attack);
    if (spec.id === 'melee-master') expect(active.multiplier).toBeGreaterThan(base.multiplier);
  }
});
