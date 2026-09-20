import { describe, expect, it } from 'vitest';
import { generateUnit, battleXpAwards, applyXp, resolveAttack, traitRegistry, V2_D20, SmallBattle, MassBattle, V2_TW, standardField, grantTraitSource, type GenerateInput } from '../src/index.js';
const registry = traitRegistry();
function make(extra: Partial<GenerateInput> = {}, seed = 'scale') {
  return generateUnit({ rulesVersion: 'v2', name: '编队成员', side: 'ally', scale: 'company', level: 3, hpMax: 20, hp: 13, traits: [], weaponClass: 'sword', ...extra }, { seed, registry, noVariance: true }).unit;
}
describe('V2个体与编队，不以杂兵称呼划分能力', () => {
  it('mook只作为旧别名，生成相同编队和冻结装备，人数与训练明确且可成长', () => {
    const oldName = make({ scale: 'mook' }), formation = make({ scale: 'company' });
    expect(oldName.scale).toBe('company'); expect(oldName.base).toEqual(formation.base); expect(oldName.weapon).toEqual(formation.weapon);
    const awards = battleXpAwards([oldName], new Map([[oldName.id, 999]]), { won: true });
    expect(awards[0]!.total).toBe(999);
    const beforeWeapon = structuredClone(oldName.weapon); applyXp(oldName, 9999, registry);
    expect(oldName.level).toBeGreaterThan(3); expect(oldName.hp).toBe(13); expect(oldName.base.hpMax).toBe(20); expect(oldName.weapon).toEqual(beforeWeapon);
  });
  it('旧V2 mook也按正常编队取得战果经验；legacy读取保持原行为', () => {
    const old = make(); old.scale = 'mook';
    expect(battleXpAwards([old], new Map([[old.id, 99]]), { won: true })[0]!.total).toBe(99);
    delete old.rulesVersion;
    expect(battleXpAwards([old], new Map([[old.id, 99]]), { won: true })).toEqual([]);
  });
  it('践踏依据真实较大体型和冲击，普通攻击/同体型不因mook标签翻倍', () => {
    const a = make({ scale: 'hero', body: 'large', archetype: 'mobile', traits: ['trample'], hpMax: 400, hp: 400 }), b = make({ side: 'enemy', hpMax: 400, hp: 400 }, 'enemy');
    const opts = { attacker: a, defender: b, rules: V2_D20, conditionDefs: new Map(), traitRegistry: registry, ranged: false, rng: { seed: 'hit', next: () => 0, d: (n: number) => n } };
    b.scale = 'mook'; b.tags.push('mook');
    expect(resolveAttack(opts).dmgMult).toBe(1);
    expect(resolveAttack({ ...opts, charge: true }).dmgMult).toBe(1.25);
    b.body = 'large'; expect(resolveAttack({ ...opts, charge: true }).dmgMult).toBe(1);
  });
  it('两种实际战斗的合法冲锋执行践踏，不制造额外行动', () => {
    for (const mode of ['small', 'mass']) {
      const a = make({ scale: 'hero', body: 'large', archetype: 'mobile', traits: [], hpMax: 400, hp: 400 }), b = make({ side: 'enemy', hpMax: 400, hp: 400 }, 'enemy'); a.id = 'a'; b.id = 'b';
      grantTraitSource(a, { id: 'impact-gift', name: '冲击赐福', kind: 'blessing', traitIds: ['trample'], duration: { kind: 'rounds', count: 1 } });
      const rng = { seed: 'hit', next: () => 0, d: (n: number) => n };
      if (mode === 'small') {
        const battle = new SmallBattle({ rules: V2_D20, battlefield: standardField(), combatants: [a, b], rng, traitRegistry: registry }); battle.start();
        while (battle.active?.id !== 'a') battle.endTurn(); a.pos = 35; b.pos = 37;
        battle.attack('a', 'b', { charge: true }); expect(battle.log.find((l) => l.resolution)?.resolution?.dmgMult).toBe(1.25); expect(battle.actedThisTurn.has('a')).toBe(true);
      } else {
        a.tags.push('zone:中军', 'rank:rear'); b.tags.push('zone:中军', 'rank:front');
        const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], rng, traitRegistry: registry }); battle.start();
        expect(battle.issue({ unitId: 'a', type: 'charge', targetId: 'b' }).ok).toBe(true); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === 'a')?.resolution?.dmgMult).toBe(1.25);
      }
    }
  });
});
