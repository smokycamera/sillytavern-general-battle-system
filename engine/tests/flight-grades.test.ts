import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, V34_OVERFLOW_D20, V35_OVERFLOW_D20, V35_OVERFLOW_TW,
  flightDefense, traitLevel, grantTraitSource, revokeTraitSource, compileSkill, skillMechanismId, parseSkillMechanism, type Combatant, type RulePack } from '../src/index.js';

function unit(id: string, flying = 0, company = false): Combatant {
  const result = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: company ? 'company' : 'hero', rulesVersion: 'v2',
    level: 3, hpMax: 500, weaponClass: 'bow', weaponLevel: 5, armorTier: 0,
    traits: flying ? ['flying'] : [], traitLevels: flying ? { flying } : {} }, { seed: id, noVariance: true }).unit;
  result.id = id; return result;
}
function small(rules: RulePack = V35_OVERFLOW_D20, grade = 5) {
  const a = unit('a'), d = unit('d', grade), field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: [a, d], battlefield: field, rules, seed: 'flight-grades' });
  battle.start(); battle.turnOrder = ['a', 'd']; battle.turnIndex = 0; a.pos = 31; d.pos = 17;
  const preview = () => battle.getActionOptions('a').find(o => o.id === 'weapon')!.targets!.find(t => t.targetId === 'd')!.preview!;
  return { a, d, battle, preview };
}

describe('V35 flight maneuver and anti-air grades', () => {
  it('gives each flight grade its exact defense in real weapon previews and resolution', () => {
    const { a, d, battle, preview } = small(); d.airborne = false; const ground = preview(); d.airborne = true;
    for (const [i, defense] of [3,4,5,6,7,8,9,11,13,15].entries()) {
      d.traitLevels = { flying: i + 1 };
      expect(preview().defenseScore).toBe(ground.defenseScore! + defense);
    }
    const predicted = preview(); expect(predicted.hitChance).toBeLessThan(ground.hitChance!);
    expect(battle.attack(a.id, d.id).targetDef).toBe(predicted.defenseScore);
  });

  it('uses the same table for AA attack, so equal grades cancel and unequal grades leave only their difference', () => {
    const { a, d, preview } = small(); a.traits.push('anti-air'); a.traitLevels = { 'anti-air': 3 };
    d.airborne = false; const ground = preview(); d.airborne = true;
    const weaker = preview();
    expect(weaker.defenseScore).toBe(ground.defenseScore! + 7);
    expect(weaker.attackScore).toBe(ground.attackScore! + 5);
    a.traitLevels['anti-air'] = 5; const equal = preview();
    expect(equal.attackScore! - equal.defenseScore!).toBe(ground.attackScore! - ground.defenseScore!);
    a.traitLevels['anti-air'] = 8; const surplus = preview();
    expect(surplus.attackScore).toBe(ground.attackScore! + 11);
    expect(surplus.attackScore! - surplus.defenseScore!).toBe(ground.attackScore! - ground.defenseScore! + 4);
    d.airborne = false; expect(preview().attackScore).toBe(ground.attackScore);
    d.airborne = true;
    for (let level = 1; level <= 10; level++) {
      a.traitLevels['anti-air'] = level; d.traitLevels = { flying: level };
      const paired = preview();
      expect(paired.attackScore! - paired.defenseScore!).toBe(ground.attackScore! - ground.defenseScore!);
    }
  });

  it('removes flight defense after landing and never grants it in air-to-air combat', () => {
    const { a, d, battle } = small(); a.airborne = true;
    expect(flightDefense(a, d)).toBe(0); a.airborne = false;
    battle.turnOrder = ['d', 'a']; battle.turnIndex = 0; battle.changeFlight(d.id, false);
    expect(flightDefense(a, d)).toBe(0);
  });

  it('takes the strongest active source and falls back when that source ends', () => {
    const { a, d } = small();
    grantTraitSource(d, { id: 'flight8', name: '飞行术', kind: 'blessing', traitIds: ['flying'], traitLevels: { flying: 8 }, duration: { kind: 'rounds', count: 2 } });
    expect(traitLevel(d, 'flying')).toBe(8); expect(flightDefense(a, d)).toBe(11);
    revokeTraitSource(d, 'flight8'); expect(traitLevel(d, 'flying')).toBe(5); expect(flightDefense(a, d)).toBe(7);
  });

  it('casts buff flight with its explicit grade, permits takeoff and preserves it through save/reload', () => {
    const { a, d, battle } = small(V35_OVERFLOW_D20, 0);
    const skill = compileSkill({ id: skillMechanismId(parseSkillMechanism('buff+飞行L7')!), name: '飞行术' }, 3, a.id, 'skills-v4');
    skill.target = 'self'; a.abilities = [skill]; a.preparedAbilityIds = [skill.id]; a.resources.SP = 100;
    expect(battle.useAbility(a.id, skill.id, a.id).ok).toBe(true);
    expect(a.traits).not.toContain('flying');
    expect(traitLevel(a, 'flying')).toBe(7); expect(a.airborne).not.toBe(true);
    battle.changeFlight(a.id, true); expect(a.airborne).toBe(true);
    expect(flightDefense(d, a)).toBe(9);
    const saved = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    expect(traitLevel(saved.byId(a.id), 'flying')).toBe(7); expect(flightDefense(saved.byId(d.id), saved.byId(a.id))).toBe(9);
  });

  it('preserves old flight rules and removes a new unit marker when entering an old battle', () => {
    const { a, d, battle, preview } = small(V34_OVERFLOW_D20, 10);
    expect(d.flightModel).toBeUndefined(); expect(flightDefense(a, d)).toBe(0);
    const air = preview(); d.airborne = false; expect(preview().defenseScore).toBe(air.defenseScore); d.airborne = true;
    const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    expect(restored.rules.id).toBe(V34_OVERFLOW_D20.id); expect(restored.byId(d.id).flightModel).toBeUndefined();
  });

  it('uses the same flight defense in mass-battle previews and executed volleys', () => {
    const a = unit('a', 0, true), d = unit('d', 10, true);
    const battle = new MassBattle({ combatants: [a,d], rules: V35_OVERFLOW_TW, seed: 'flight-mass-grades' }); battle.start();
    a.formationPosition = 'ally:中军:front'; d.formationPosition = 'enemy:中军:front';
    const order = { unitId: a.id, type: 'volley' as const, targetId: d.id };
    delete d.flightModel; const ground = battle.orderPreview(order); d.flightModel = 'maneuver-v1';
    expect(ground.reason).toBeUndefined();
    const airborne = battle.orderPreview(order); expect(airborne.reason).toBeUndefined();
    expect(airborne.preview!.defenseScore).toBe(ground.preview!.defenseScore! + 15);
    expect(battle.issue(order).ok).toBe(true); battle.issue({ unitId: d.id, type: 'hold' }); battle.resolveRound();
    expect(battle.log.find(e => e.resolution?.attackerId === a.id)!.resolution!.targetDef).toBe(airborne.preview!.defenseScore);
  });
});
