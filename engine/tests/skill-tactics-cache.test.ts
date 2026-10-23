import { describe, expect, it } from 'vitest';
import { SmallBattle, generateUnit, standardField, V29_OVERFLOW_D20, beginPreviewScope, endPreviewScope,
  compileGenericSkill, type Combatant } from '../src/index.js';
import { actionPotential, tacticalStateValue } from '../src/skill-tactics.js';
import { skillEffectValue } from '../src/skill-effects.js';

function fixture() {
  const combatants = ['ally', 'enemy'].map((side, i) => {
    const u = generateUnit({ name: `u${i}`, side: side as 'ally' | 'enemy', scale: 'company', hpMax: 8,
      rulesVersion: 'v2', level: 5, weaponClass: 'spear', weaponLevel: 4, armorTier: 0,
      traits: ['guardian'], traitLevels: { guardian: 1 } }, { seed: `tactics-cache:${i}`, noVariance: true }).unit;
    u.id = `u${i}`; return u;
  });
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants, battlefield: field, rules: V29_OVERFLOW_D20, seed: 'tactics-cache' }); b.start();
  combatants.forEach((u, i) => u.pos = 24 + i);
  return { b, actor: combatants[0]!, target: combatants[1]!, context: b.observationContext() };
}
function scoped<T>(read: () => T): T { beginPreviewScope(); try { return read(); } finally { endPreviewScope(); } }

describe('tactical valuation cache lifetime', () => {
  it('preserves buff, control and hypothetical-state values without modifying the battle', () => {
    const { b, actor, target, context } = fixture(), before = b.toSnapshot();
    const effects = ['buff:attack', 'buff:barrier', 'buff:trait-berserk', 'debuff:stun'].map(id =>
      compileGenericSkill('generic:' + id, 4, actor.id, undefined, 'wounds-v2', V29_OVERFLOW_D20.skillModel));
    const read = () => effects.map(a => skillEffectValue(context, actor, a.target === 'enemy' ? target : actor, a));
    const expected = read();
    expect(scoped(() => [read(), read()])).toEqual([expected, expected]);
    expect(b.toSnapshot()).toEqual(before);
  });

  it('refreshes the same context after a real change, both outside and between scopes', () => {
    const { actor, target, context } = fixture();
    const read = () => actionPotential(context, actor, target);
    const original = scoped(read);
    target.traitLevels!.guardian = 10;
    const protectedValue = read(); expect(protectedValue).toBeLessThan(original);
    expect(scoped(read)).toBe(protectedValue);
    target.traitLevels!.guardian = 1;
    expect(scoped(read)).toBe(original);
    actor.conditions.push({ id: 'stunned', dur: 1 });
    expect(read()).toBe(0);
    actor.conditions = [];
    expect(read()).toBe(original);
  });

  it('keeps different hypothetical targets and changed battlefield contexts isolated', () => {
    const { actor, target, context } = fixture();
    const stunned: Combatant = { ...target, conditions: [{ id: 'stunned', dur: 1 }] };
    const read = () => [tacticalStateValue(context, target), tacticalStateValue(context, stunned),
      actionPotential({ ...context, units: [actor] }, actor)];
    const expected = read(); expect(expected[0]).not.toBe(expected[1]);
    expect(scoped(read)).toEqual(expected);
    expect(scoped(() => actionPotential(context, actor, target))).toBeGreaterThan(0);
  });
});
