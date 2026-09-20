import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, abilityUsabilityReason, collectMods, resolveStack, standardConditionMap,
  resolveAttack, previewAttack, V2_D20, SYSTEM_PACKS, type GenerateInput } from '../src/index.js';
import { SmallBattle, LITE_D20 } from '../src/index.js';
const registry = traitRegistry();
function make(overrides: Partial<GenerateInput> = {}, seed = 'same-alpha') {
  const input = { name: '自定义单位', side: 'ally' as const, scale: 'hero' as const, level: 4, traits: [], rulesVersion: 'v2' as const,
    weaponClass: 'rifle', weaponLevel: 8, armorTier: 2 as const, armorLevel: 4, ...overrides };
  return generateUnit(input, { registry, seed, noVariance: true }).unit;
}
describe('V2 机制生成回归', () => {
  it('V2 无显式种子开战仍可恢复 RNG，预览不改实战随机；legacy 快照规则保留', () => {
    const a = make(); const b = make({ side: 'enemy' }, 'target');
    const battle = new SmallBattle({ combatants: [a, b], rules: V2_D20, traitRegistry: registry });
    battle.start();
    const before = JSON.stringify(battle.toSnapshot());
    battle.getActionOptions(battle.active!.id);
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    const restored = SmallBattle.fromSnapshot(JSON.parse(before), { traitRegistry: registry });
    expect(restored.rules.id).toBe('v2-d20'); expect(restored.rng.next()).toBe(battle.rng.next());
    const legacy = new SmallBattle({ combatants: [], rules: LITE_D20, seed: 'legacy' });
    expect(SmallBattle.fromSnapshot(legacy.toSnapshot()).rules.id).toBe('lite-d20');
  });
  it('静态特质只计算一次，attackStyle 同时保留命中和伤害来源', () => {
    const a = make(); const b = make({ traits: ['veteran'] });
    const opts = { rules: V2_D20, conditionDefs: standardConditionMap(), traitRegistry: registry, rng: { seed: 'max', next: () => 0.99, d: (n: number) => n } };
    const target = make({ side: 'enemy' });
    const plain = resolveAttack({ ...opts, attacker: a, defender: structuredClone(target) });
    const veteran = resolveAttack({ ...opts, attacker: b, defender: structuredClone(target) });
    expect(veteran.netAtk - plain.netAtk).toBe(1);
    const custom = new Map(registry); custom.set('test-style', { id: 'test-style', name: '双效果', desc: '测试来源', effects: [{ kind: 'attackStyle', style: 'ranged', atk: 2, dmgMult: 1.2 }] });
    // 此处只检验新增attackStyle的双效果；永久特质删除的净修正在trait-state回归中单独覆盖。
    b.traits.push('test-style');
    const mods = collectMods(b, { ranged: true }, standardConditionMap(), [], custom);
    expect(resolveStack(mods, 'atk', { ranged: true }).flatTotal).toBe(2);
    expect(resolveStack(mods, 'dmg', { ranged: true }).multTotal).toBe(1.2);
  });
  it('已学不等于准备；无盾/无召唤来源不可用，共享冷却不受改名影响', () => {
    const unit = make({ weaponClass: 'sword', abilityBlueprints: ['bp-iron-guard', 'bp-mending', 'bp-call-reinforce'] });
    expect(unit.abilities).toHaveLength(3);
    expect(unit.preparedAbilityIds).toHaveLength(2);
    expect(abilityUsabilityReason(unit, unit.abilities[0]!)).toContain('盾牌');
    expect(abilityUsabilityReason(unit, unit.abilities[2]!)).toContain('尚未准备');
    const heal = unit.abilities[1]!;
    unit.abilityState = [{ abilityId: heal.cooldownGroup!, cdLeft: 2, used: 1 }];
    expect(abilityUsabilityReason(unit, { ...heal, name: '另一个中文名' })).toContain('冷却');
    expect(make({ shield: true }).shield).toBeDefined();
  });
  it('未穿透可为零，即使暴击也不绕过，专门反制有作用且不读题材护甲表', () => {
    const target = make({ side: 'enemy', armorTier: 4, armorLevel: 10 });
    const weak = make({ weaponClass: 'sword', weaponLevel: 1 });
    const opts = { attacker: weak, defender: target, rules: V2_D20, conditionDefs: standardConditionMap(), traitRegistry: registry };
    const preview = previewAttack(opts);
    expect(preview.expectedDamage).toBe(0);
    const hit = resolveAttack({ ...opts, rng: { seed: 'max', next: () => 0.99, d: (n) => n } });
    expect(hit.crit).toBe(true); expect(hit.finalDamage).toBe(0);
    expect(target.hp).toBe(target.base.hpMax);
    const counter = make({ weaponClass: 'cannon', weaponLevel: 10, body: 'vehicle' });
    expect(previewAttack({ ...opts, attacker: counter }).expectedDamage).toBeGreaterThan(0);
    expect(previewAttack({ ...opts, attacker: counter, rules: { ...SYSTEM_PACKS.modern!.small, resolutionVersion: 'v2' } }).expectedDamage)
      .toBe(previewAttack({ ...opts, attacker: counter, rules: { ...SYSTEM_PACKS.w40k!.small, resolutionVersion: 'v2' } }).expectedDamage);
  });
  it('同配方不受 era 影响，默认装备也独立于训练', () => {
    const a = make({ era: 'medieval', weaponClass: undefined, weaponLevel: undefined, armorLevel: undefined });
    const b = make({ era: 'modern', level: 9, weaponClass: undefined, weaponLevel: undefined, armorLevel: undefined });
    expect(a.weapon).toEqual(b.weapon); expect(a.armor).toEqual(b.armor);
  });
  it('明确库 id 的武器规格与 class 路径一致，错误组合不能默默回退', () => {
    const a = make({ weaponId: 'wpn-ar', weaponClass: undefined });
    const b = make({ weaponId: 'wpn-ar', weaponClass: 'rifle' });
    expect(a.weapon?.baseDice).toBe(b.weapon?.baseDice);
    expect(a.weapon?.apDice).toBe(b.weapon?.apDice);
    expect(() => make({ weaponId: 'wpn-ar', weaponClass: 'sword' })).toThrow();
    expect(() => make({ weaponClass: 'unknown' })).toThrow();
  });
  it('明确护甲构型不因兵种或训练改变，缺省品质与明确默认相同', () => {
    const a = make({ armorId: 'arm-terminator', armorTier: undefined, archetype: 'ranged' });
    const b = make({ armorId: 'arm-terminator', armorTier: undefined, archetype: 'infantry', level: 8 });
    expect(a.armor?.tier).toBe(4); expect(a.armor).toEqual(b.armor);
    const implicit = make({ armorLevel: undefined });
    const explicit = make({ armorLevel: 5 });
    expect(implicit.armor).toEqual(explicit.armor);
  });
  it('同前缀种子不冲突，改名不改变实体与装备 id', () => {
    const a = make(); const b = make({}, 'same-beta'); const renamed = make({ name: '改名' });
    expect(a.id).not.toBe(b.id); expect(a.weapon?.id).not.toBe(b.weapon?.id);
    expect(a.id).toBe(renamed.id); expect(a.weapon).toEqual(renamed.weapon);
  });
  it('护甲品质仅作有界可靠性修正，品质不绕过穿透档或改变人数', () => {
    const low = make({ quality: 1 }); const high = make({ quality: 5 }); const attacker = make();
    const opts = { attacker, rules: V2_D20, conditionDefs: new Map(), traitRegistry: registry };
    expect(low.armor?.protection).toEqual(high.armor?.protection);
    expect(high.base.hpMax).toBe(low.base.hpMax);
    const a = previewAttack({ ...opts, defender: low }), b = previewAttack({ ...opts, defender: high });
    expect(b.hitChance).toBeLessThan(a.hitChance); expect(a.hitChance - b.hitChance).toBeLessThanOrEqual(0.11);
  });
  it('同源不同等级技能必须显式纠正，不能静默丢弃后项', () => {
    expect(() => make({ abilityBlueprints: [{ id: 'bp-crushing-blow', level: 2 }, { id: 'bp-crushing-blow', level: 8 }] })).toThrow();
  });
});
