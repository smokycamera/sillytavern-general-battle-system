import { describe, expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, standardField, V34_OVERFLOW_D20 } from '../src/index.js';

function fixture(weaponClass: 'sword' | 'bow' = 'sword') {
  const field = standardField(); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null);
  const units = (['ally', 'enemy'] as const).map((side, i) => {
    const unit = generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', level: 3, hpMax: 500,
      weaponClass: i ? 'sword' : weaponClass, weaponLevel: 3, armorTier: 0, traits: [] }, { seed: side, noVariance: true }).unit;
    unit.id = side; return unit;
  });
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V34_OVERFLOW_D20, seed: 'hold-overwatch' });
  battle.start(); battle.turnOrder = ['ally', 'enemy']; battle.turnIndex = 0;
  const actor = units[0]!, foe = units[1]!; actor.pos = 45; foe.pos = 47;
  return { battle, actor, foe, field: battle.battlefield! };
}

describe('hold overwatch', () => {
  it('guards the assigned cell and attacks once when a visible enemy approaches', () => {
    const { battle, actor, foe } = fixture();
    expect(battle.overwatchReason(actor.id)).toBeUndefined();
    battle.autoAction(actor.id, { mode: 'hold', cell: actor.pos });
    expect(actor.pos).toBe(45); expect(battle.overwatch.has(actor.id)).toBe(true);
    const resumed = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    resumed.moveTo(foe.id, 46);
    expect(resumed.log.filter(e => e.text.startsWith('警戒反应'))).toHaveLength(1);
    expect(resumed.reactionSpent.has(actor.id)).toBe(true); expect(resumed.overwatch.has(actor.id)).toBe(false);
    resumed.moveTo(foe.id, 47);
    expect(resumed.log.filter(e => e.resolution?.attackerId === actor.id)).toHaveLength(1);
  });

  it('takes an effective immediate attack before reserving a reaction', () => {
    const { battle, actor, foe } = fixture(); foe.pos = 46;
    battle.autoAction(actor.id, { mode: 'hold', cell: actor.pos });
    expect(actor.pos).toBe(45); expect(battle.log.some(e => e.resolution?.attackerId === actor.id)).toBe(true);
    expect(battle.overwatch.has(actor.id)).toBe(false);
  });

  it('can guard a firing lane while its current target is out of range', () => {
    const { battle, actor, foe } = fixture('bow'); actor.pos = 56; foe.pos = 0;
    expect(battle.getActionOptions(actor.id).find(o => o.id === 'weapon')?.targets?.some(t => t.targetId === foe.id && t.enabled), JSON.stringify(actor.weapon)).toBeFalsy();
    battle.autoAction(actor.id, { mode: 'hold', cell: actor.pos });
    expect(actor.pos).toBe(56); expect(battle.overwatch.has(actor.id)).toBe(true);
  });

  it.each(['spent', 'suppressed'] as const)('respects the %s reaction restriction', restriction => {
    const { battle, actor } = fixture();
    if (restriction === 'spent') battle.reactionSpent.add(actor.id); else actor.suppression = 2;
    battle.autoAction(actor.id, { mode: 'hold', cell: actor.pos });
    expect(battle.overwatch.has(actor.id)).toBe(false); expect(battle.log.some(e => e.text.includes('警戒：'))).toBe(false);
  });

  it('rests and rebuilds fortifications when enemies cannot reach its weapon range', () => {
    const { battle, actor, foe } = fixture(); foe.pos = 0; actor.traits.push('fortification');
    delete actor.entrenchedAt; actor.resources.SP = 0; actor.fatigue = 2;
    battle.autoAction(actor.id, { mode: 'hold', cell: actor.pos });
    expect(battle.overwatch.has(actor.id)).toBe(false); expect(actor.entrenchedAt).toBe(actor.pos);
    expect(actor.resources.SP).toBeGreaterThan(0); expect(actor.fatigue).toBeLessThan(2);
  });

  it('does not credit a shot through an impassable wall even with a known enemy', () => {
    const { battle, actor, field } = fixture();
    for (let cell = 4; cell < field.tiles.length; cell += field.width) field.tiles[cell] = 'wall';
    vi.spyOn(battle, 'visibleCombatants').mockImplementation(() => battle.combatants);
    battle.autoAction(actor.id, { mode: 'hold', cell: actor.pos });
    expect(battle.overwatch.has(actor.id)).toBe(false); expect(actor.pos).toBe(45);
  });
});
