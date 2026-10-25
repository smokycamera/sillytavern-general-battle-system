import { describe, it, expect } from 'vitest';
import { attachCarriedItems, compileItem, generateUnit, parseSkillMechanism, skillMechanismId, SmallBattle, standardField, traitRegistry, V34_OVERFLOW_D20 } from '../src/index.js';
import { createStructure } from '../src/small/layers.js';

const registry = traitRegistry();
function setup(quick = false) {
  const hero = (id: string, side: 'ally' | 'enemy') => {
    const u = generateUnit({ name: id, side, scale: 'hero', level: 3, rulesVersion: 'v2', traits: [], weaponClass: 'sword' }, { seed: id, registry, noVariance: true }).unit;
    u.id = id; return u;
  };
  const item = compileItem({ kind: 'item', form: 'single', power: 3,
    active: skillMechanismId(parseSkillMechanism(quick ? 'buff治疗' : '物理单体投射')!) }, { id: 'item', seed: 'item' });
  const a = attachCarriedItems(hero('a', 'ally'), [{ id: 'item', name: '测试道具', quantity: 2, revision: 1, mechanics: item }]);
  const t = hero('t', quick ? 'ally' : 'enemy'), e = hero('e', 'enemy'), f = standardField(8, 10);
  f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null);
  f.structures[36] = createStructure('wall', 3, { top: true });
  const b = new SmallBattle({ combatants: [a, t, e], battlefield: f, rules: V34_OVERFLOW_D20, seed: 'wall-item' });
  b.start(); b.turnOrder = ['a', 't', 'e']; b.turnIndex = 0;
  a.pos = 35; t.pos = 36; t.elevation = 1; t.hp = Math.max(1, t.hp - 10); e.pos = 79;
  return { a, t, b, ability: a.abilities.find(x => x.itemSourceId)! };
}
describe('携行道具与墙顶目标', () => {
  it('投掷道具在射程和视线内可选择墙顶，预览和实际消耗一致', () => {
    const { a, t, b, ability } = setup();
    const option = b.getActionOptions(a.id).find(o => o.id === ability.id)!;
    expect(option.targets!.find(x => x.targetId === t.id)?.reason).toBeUndefined();
    expect(b.useAbility(a.id, ability.id, t.id).ok).toBe(true);
    expect(a.resources['item:item']).toBe(1);
  });
  it('喝敷类仍需接触，空地隔层和距离、遮挡继续限制投掷', () => {
    const quick = setup(true), target = () => quick.b.getActionOptions('a').find(o => o.id === quick.ability.id)!.targets!.find(x => x.targetId === 't')!;
    expect(target().reason).toContain('同一空地层');
    const { a, t, b, ability } = setup(), reason = () => b.getActionOptions('a').find(o => o.id === ability.id)!.targets!.find(x => x.targetId === 't')!.reason;
    t.airborne = true; expect(reason()).toContain('同一空地层');
    t.airborne = false; t.pos = 4; b.battlefield!.structures![4] = createStructure('wall', 3, { top: true });
    expect(reason()).toContain('射程');
    t.pos = 37; b.battlefield!.structures![37] = createStructure('wall', 3, { top: true });
    b.battlefield!.structures![36]!.obstructionHeight = 10;
    expect(b.getActionOptions('a').find(o => o.id === ability.id)!.targets!.some(x => x.targetId === 't' && x.enabled)).toBe(false);
    expect(b.useAbility('a', ability.id, 't').ok).toBe(false); expect(a.resources['item:item']).toBe(2);
  });
});
