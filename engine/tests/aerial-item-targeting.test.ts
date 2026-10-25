import { describe, expect, it } from 'vitest';
import { attachCarriedItems, compileItem, gearItem, syncGearAbilities, generateUnit, parseSkillMechanism, skillMechanismId, SmallBattle, MassBattle,
  standardField, V35_OVERFLOW_D20, V35_OVERFLOW_TW, abilityTargetReason, fallbackAbilityRange, groundToAirRangePenalty } from '../src/index.js';
import { abilityUsed } from '../src/ability-state.js';

const cases = [
  ['single', '物理单体投射'], ['single', '物理范围投射'], ['single', '魔法单体奥术'],
  ['single', '物理单体射击'], ['charged', '魔法单体奥术'],
] as const;
function setup(mode: 'small' | 'mass', form: 'single' | 'charged', mechanism: string) {
  const unit = (id: string, flying = false) => {
    const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: mode === 'mass' ? 'company' : 'hero', level: 5,
      rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'rifle', weaponLevel: 5, armorTier: 0,
      hpMax: mode === 'mass' ? 1 : 500, traits: flying ? ['flying'] : [], traitLevels: flying ? { flying: 5 } : {} }, { seed: id, noVariance: true }).unit;
    u.id = id; return u;
  };
  const mechanics = compileItem({ kind: 'item', form, power: 5, active: skillMechanismId(parseSkillMechanism(mechanism)!) }, { id: 'attack-item', seed: 'aerial-item' });
  let a = unit('a'); const d = unit('d', true);
  if (form === 'single') a = attachCarriedItems(a, [{ id: 'attack-item', name: '测试道具', quantity: 2, revision: 1, mechanics }]);
  else {
    if (mechanics.kind !== 'item') throw Error('fixture');
    a.gear = [gearItem('attack-item', '测试道具', mechanics.value)]; syncGearAbilities(a);
  }
  const field = standardField(); field.tiles.fill('open');
  const rng = { seed: 'aerial-item', next: () => 0, d: (sides: number) => sides === 20 ? 20 : Math.ceil(sides / 2) };
  const battle = mode === 'small' ? new SmallBattle({ combatants: [a, d], battlefield: field, rules: V35_OVERFLOW_D20, rng })
    : new MassBattle({ combatants: [a, d], rules: V35_OVERFLOW_TW, rng });
  battle.start();
  if (battle instanceof SmallBattle) { a.pos = 31; d.pos = 24; battle.turnOrder = ['a', 'd']; battle.turnIndex = 0; }
  else { a.formationPosition = 'ally:中军:front'; d.formationPosition = 'enemy:中军:front'; }
  const ability = a.abilities.find(x => x.itemSourceId || x.equipmentSourceId)!;
  return { a, d, battle, ability };
}

describe.each(['small', 'mass'] as const)('%s ranged items against airborne targets', mode => {
  it.each(cases)('%s %s allows selection, preview and actual use while retaining the aerial range cost', (form, mechanism) => {
    const { a, d, battle, ability } = setup(mode, form, mechanism);
    expect(d.airborne).toBe(true);
    const preview = battle instanceof SmallBattle
      ? battle.getActionOptions(a.id).find(o => o.id === ability.id)!.targets!.find(t => t.targetId === d.id)!
      : battle.orderPreview({ unitId: a.id, type: 'ability', abilityId: ability.id, targetId: d.id });
    expect(preview.reason).toBeUndefined(); expect(preview.preview).toBeDefined();
    const range = fallbackAbilityRange(a, ability, battle instanceof SmallBattle);
    const outside = range.max - groundToAirRangePenalty(a, d, mode) + 1;
    expect(abilityTargetReason({ actor: a, ability, target: d, distance: outside, space: mode,
      ...(battle instanceof SmallBattle ? { field: battle.battlefield } : {}) })).toContain('射程');
    const resource = ability.cost?.resource, before = resource ? a.resources[resource]! : 0;
    expect(battle.useAbility(a.id, ability.id, d.id).ok).toBe(true);
    if (battle instanceof MassBattle) { battle.issue({ unitId: d.id, type: 'hold' }); battle.resolveRound(); }
    expect(battle.log.some(e => e.resolution?.attackerId === a.id && e.resolution.defenderId === d.id && e.resolution.hit)).toBe(true);
    if (form === 'single') expect(a.resources[resource!]).toBe(before - 1);
    else expect(abilityUsed(a, ability)).toBe(1);
  });
});
