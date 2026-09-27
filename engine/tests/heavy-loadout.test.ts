import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V6_D20, V6_TW,
  equipmentLoad, equipmentReason, humanEncumbered, movementPoints, formationMarchSteps,
  collectMods, resolveStack, standardConditionMap, compileItem, type GenerateInput } from '../src/index.js';

const registry = traitRegistry();
function unit(id: string, extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id, side: id === 'target' ? 'enemy' : 'ally', scale: 'hero', level: 5,
    rulesVersion: 'v2', damageModel: 'wounds-v2', body: 'human', weaponClass: 'autocannon', armorTier: 4,
    traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
const initiativeMod = (u: ReturnType<typeof unit>) => resolveStack(collectMods(u, {}, standardConditionMap(), [], registry), 'spd', {}).flatTotal;

describe('人形重武器与满载边界', () => {
  it('动力甲机炮11负重，副武器达到12触发减益；读档不叠加，卸装立即解除', () => {
    const light = unit('actor'), loaded = unit('actor', { sidearmClass: 'sword' });
    expect(equipmentLoad(light)).toBe(11); expect(equipmentLoad(loaded)).toBe(12);
    expect(equipmentReason(loaded)).toBeUndefined();
    const before = structuredClone(loaded.base);
    expect(movementPoints(loaded)).toBe(movementPoints(light) - 1);
    expect(initiativeMod(loaded)).toBe(initiativeMod(light) - 2);
    function battle(u: ReturnType<typeof unit>) {
      const b = new SmallBattle({ combatants: [u, unit('target', { weaponClass: 'sword' })], rules: V6_D20,
        traitRegistry: registry, battlefield: standardField(), seed: 'load-initiative' });
      b.start(); return b;
    }
    const a = battle(light), b = battle(loaded);
    const initiative = (x: SmallBattle) => Number(x.log.find(e => e.kind === 'initiative')!.text.match(/actor (-?\d+)/)![1]);
    expect(initiative(b)).toBe(initiative(a) - 2);
    expect(b.movementBudget('actor')).toBe(1);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(restored.movementBudget('actor')).toBe(b.movementBudget('actor'));
    expect(initiativeMod(restored.byId('actor'))).toBe(initiativeMod(loaded));
    delete restored.byId('actor').sidearm;
    expect(restored.movementBudget('actor')).toBe(a.movementBudget('actor'));
    expect(loaded.base).toEqual(before);
  });

  it('人形允许14但拒绝15，大型允许18但拒绝19，两个配件均计入负重', () => {
    const u = unit('actor', { sidearmClass: 'sword', shield: true }); // 6+5+1+2
    expect(equipmentLoad(u)).toBe(14); expect(equipmentReason(u)).toBeUndefined();
    const accessory = (id: string, mechanism: 'night' | 'woodland') => {
      const item = compileItem({ kind: 'accessory', mechanism, power: 1 }, { id, seed: id });
      if (item.kind !== 'accessory') throw Error('fixture'); return item.value;
    };
    u.accessories = { accessory1: accessory('a1', 'night') };
    expect(equipmentReason(u)).toMatch(/负重 15.*容量 14/);
    u.body = 'large'; u.sidearm = unit('spare').weapon; delete u.shield; // 6+6+5+1
    expect(equipmentLoad(u)).toBe(18); expect(equipmentReason(u)).toBeUndefined();
    expect(humanEncumbered(u)).toBe(false);
    u.accessories.accessory2 = accessory('a2', 'woodland');
    expect(equipmentReason(u)).toMatch(/负重 19.*容量 18/);
    for (const body of ['giant', 'vehicle'] as const) { u.body = body; expect(equipmentReason(u)).toBeUndefined(); expect(humanEncumbered(u)).toBe(false); }
  });

  it('人形编队在会战使用同一移动减益，身体/旧规则切换不残留', () => {
    const u = unit('actor', { scale: 'company', armorTier: 0, sidearmClass: 'cannon', speedTier: 4 });
    expect(formationMarchSteps(u)).toBe(1);
    delete u.sidearm; expect(formationMarchSteps(u)).toBe(2);
    u.sidearm = unit('spare').weapon;
    u.body = 'large'; expect(formationMarchSteps(u)).toBe(2);
    delete u.body; expect(humanEncumbered(u)).toBe(true);
    delete u.rulesVersion; expect(humanEncumbered(u)).toBe(false);
  });

  it.each(['cannon', 'indirect-cannon', 'autocannon'])('人形个体实际发射%s，保存恢复后仍可用', weaponClass => {
    const actor = unit('actor', { weaponClass, sidearmClass: 'sword' }), target = unit('target', { weaponClass: 'sword' });
    const field = standardField(); field.tiles.fill('open');
    const b = new SmallBattle({ combatants: [actor, target], rules: V6_D20, traitRegistry: registry, battlefield: field, seed: 'human-cannon' });
    b.start(); actor.pos = 10; target.pos = 31; b.turnOrder = [actor.id, target.id]; b.turnIndex = 0;
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(restored.getActionOptions(actor.id).find(a => a.id === 'weapon')!.targets!.find(t => t.targetId === target.id)!.enabled).toBe(true);
    restored.attack(actor.id, target.id);
    expect(restored.log.some(e => e.resolution?.attackerId === actor.id)).toBe(true);
  });

  it.each(['cannon', 'indirect-cannon', 'autocannon'])('人形编队在会战实际发射%s', weaponClass => {
    const actor = unit('actor', { scale: 'company', hpMax: 10, weaponClass }), target = unit('target', { scale: 'company', hpMax: 10, weaponClass: 'sword' });
    actor.tags.push('rank:front'); target.tags.push('rank:rear');
    const b = new MassBattle({ combatants: [actor, target], rules: V6_TW, traitRegistry: registry, seed: 'human-mass-cannon' }); b.start();
    const order = { unitId: actor.id, type: 'volley' as const, targetId: target.id };
    expect(b.orderPreview(order).reason).toBeUndefined();
    expect(b.issue(order).ok).toBe(true); b.issue({ unitId: target.id, type: 'hold' }); b.resolveRound();
    expect(b.log.some(e => e.resolution?.attackerId === actor.id)).toBe(true);
  });
});
