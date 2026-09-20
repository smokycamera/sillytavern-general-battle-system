import { describe, expect, it, vi } from 'vitest';
import { generateUnit, generatedField, SmallBattle, MassBattle, V2_D20, V2_TW, traitRegistry, previewAttack, formationNode, type Combatant } from '../src/index.js';
import { prepareMassRoster } from '../../panel/src/battle-setup.js';
const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', skill = 'bp-arcane-bolt'): Combatant {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'company', hpMax: 100, level: 5, weaponClass: 'rifle',
    weaponLevel: 5, armorTier: 0, traits: [], abilityBlueprints: [skill] }, { seed: id, noVariance: true, registry }).unit;
  u.id = id; return u;
}
function grid(skill?: string) {
  const field = generatedField('audit-regression'); field.tiles.fill('open');
  const a = make('a', 'ally', skill), b = make('b', 'enemy');
  const battle = new SmallBattle({ combatants: [a, b], battlefield: field, rules: V2_D20, seed: 'regression', rng: { seed: 'certain-hit', next: () => 0.9, d: (n) => n }, traitRegistry: registry });
  battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 73; b.pos = 59;
  return { battle, a, b };
}
describe('全机制审计发现的衔接问题', () => {
  it('预览已包含整轮速射，AI不会再次翻倍而压掉更有效的技能', () => {
    const a = make('a', 'ally'), b = make('b', 'enemy');
    for (const rules of [V2_D20, V2_TW]) {
      const opts = { attacker: a, defender: b, rules, ranged: true, traitRegistry: registry, conditionDefs: new Map() };
      expect(previewAttack(opts).expectedDamage).toBeCloseTo(previewAttack({ ...opts, weaponOverride: { ...a.weapon!, attacks: 1 } }).expectedDamage * 2);
    }
    for (const mode of ['small', 'mass']) {
      const local = grid(), battle = mode === 'small' ? local.battle : new MassBattle({ combatants: [make('a', 'ally'), make('b', 'enemy')], rules: V2_TW, seed: 'score-audit', traitRegistry: registry });
      if (battle instanceof SmallBattle) battle.movementSpent.set('a', battle.movementBudget('a')); else battle.start();
      // 控制公开预览收益：武器整轮6、法术9。复测选择行为，不改变真实攻击公式。
      const spy = vi.spyOn(battle as any, 'previewAttackWithEnvironment').mockImplementation((opts: any) => ({ expectedDamage: opts.abilityDamage ? 9 : 6, hitChance: 0.5, conditionValue: 0 }));
      if (battle instanceof SmallBattle) { battle.autoAction('a'); expect(battle.log.some((e) => e.kind === 'ability' && e.text.includes('奥术箭'))).toBe(true); }
      else expect(battle.recommendedOrder('a')?.type).toBe('ability');
      spy.mockRestore();
    }
  });
  it('困难地形中普通齐射和射击技法的实际展开一致，统一减少两人', () => {
    const ordinary = grid(); ordinary.battle.battlefield!.tiles[ordinary.a.pos!] = 'forest';
    const result = ordinary.battle.attack('a', 'b'); expect(result.participants).toBe(8);
    const skill = grid('generic:physical-single:ranged'); skill.battle.battlefield!.tiles[skill.a.pos!] = 'forest';
    expect(skill.battle.useAbility('a', skill.a.abilities[0]!.id, 'b').ok).toBe(true);
    expect(skill.battle.log.find((e) => e.kind === 'ability')?.resolution?.participants).toBe(8);
  });
  it('会战按实物武器安排远程后排，明确的前线部署仍保留', () => {
    const gunner = make('a', 'ally'); expect(gunner.archetype).toBe('infantry');
    expect(formationNode(prepareMassRoster([gunner])[0]!).rank).toBe('rear');
    gunner.tags.push('zone:中军', 'rank:front');
    expect(formationNode(prepareMassRoster([gunner])[0]!).rank).toBe('front');
  });
});
