import { describe, it, expect } from 'vitest';
import { generateUnit, traitRegistry, standardConditionMap, prepareCombatModel, previewAttack, prepareArmsModel, compileSkill, fallbackAbilityRange,
  SmallBattle, MassBattle, standardField, gridWeaponRange, resolveWeaponClass, rulesById, memberHealth,
  V11_OVERFLOW_D20, V11_OVERFLOW_TW, V12_OVERFLOW_D20, V12_OVERFLOW_TW, ARMS_MODEL, type Combatant, type RulePack } from '../src/index.js';
import { compileArmor, compileWeapon } from '../src/gen/equipment.js';
import { anchoredProtection, armorTransmission, protectionPower } from '../src/power-anchors.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';
import { parseArmorSpec, parseWeaponSpec } from '../../panel/src/tags.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
type Spec = { weapon?: string; scale?: 'hero' | 'company'; body?: Combatant['body']; tier?: 0 | 1 | 2 | 3 | 4; members?: number; level?: number };
function unit(id: string, spec: Spec = {}): Combatant {
  const power = spec.level ?? 5;
  const u = generateUnit({ name: id, side: id.startsWith('a') ? 'ally' : 'enemy', scale: spec.scale ?? 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2',
    level: 5, weaponClass: spec.weapon ?? 'sword', weaponLevel: power, armorTier: spec.tier ?? 0, armorLevel: power, body: spec.body,
    ...(spec.scale === 'company' ? { hpMax: spec.members ?? 20 } : {}), traits: [] }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
function prepared(rules: RulePack, ...units: Combatant[]): Combatant[] {
  for (const u of units) { prepareCombatModel(u, rules); prepareArmsModel(u, rules); }
  return units;
}
function preview(rules: RulePack, a: Combatant, d: Combatant, distance: number, ranged = !!a.weapon?.tags?.includes('ranged')) {
  const [x, y] = prepared(rules, structuredClone(a), structuredClone(d));
  return previewAttack({ attacker: x!, defender: y!, rules, distance, ranged, conditionDefs, traitRegistry: registry });
}

describe('V12 武器与护甲校准只进入新战斗', () => {
  it('新规则可按编号恢复；旧规则没有标记，读档与重复准备幂等', () => {
    expect(rulesById('v12-overflow-d20')).toBe(V12_OVERFLOW_D20);
    expect(rulesById('v12-overflow-tw')).toBe(V12_OVERFLOW_TW);
    expect(V12_OVERFLOW_D20.armsModel).toBe(ARMS_MODEL);
    expect(V11_OVERFLOW_D20.armsModel).toBeUndefined();
    expect({ ...V12_OVERFLOW_D20, id: V11_OVERFLOW_D20.id, name: V11_OVERFLOW_D20.name, armsModel: undefined }).toEqual({ ...V11_OVERFLOW_D20, armsModel: undefined });
    const u = unit('a1');
    prepareArmsModel(u, V12_OVERFLOW_D20); prepareArmsModel(u, V12_OVERFLOW_D20); expect(u.armsModel).toBe(ARMS_MODEL);
    prepareArmsModel(u, V11_OVERFLOW_D20); expect(u.armsModel).toBeUndefined();
    expect(() => combatantFromUnknown({ ...structuredClone(u), armsModel: 'arms-v9' })).toThrow('武器护甲规则版本');
  });
  it.each(['small', 'mass'] as const)('%s 战斗按自身规则投影，快照恢复保持原版本', mode => {
    for (const rules of mode === 'small' ? [V11_OVERFLOW_D20, V12_OVERFLOW_D20] : [V11_OVERFLOW_TW, V12_OVERFLOW_TW]) {
      const a = unit('a1', { scale: mode === 'small' ? 'hero' : 'company' }), e = unit('e1', { scale: mode === 'small' ? 'hero' : 'company' });
      const field = standardField(); field.tiles.fill('open');
      const b = mode === 'small' ? new SmallBattle({ combatants: [a, e], battlefield: field, rules, seed: 'arms' }) : new MassBattle({ combatants: [a, e], rules, seed: 'arms' });
      b.start();
      expect(b.combatants.every(u => u.armsModel === rules.armsModel)).toBe(true);
      const restored = mode === 'small' ? SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())) : MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));
      expect(restored.rules.id).toBe(rules.id);
      expect(restored.combatants.every(u => u.armsModel === rules.armsModel)).toBe(true);
    }
  });
});

describe('V12 护甲：同级轻甲有实际作用，中甲及以上不变', () => {
  it.each([1, 3, 5, 8, 10])('L%i 轻甲比旧规则高0.5防护，规格换算仍等于L', power => {
    for (const tier of [1, 2, 3, 4] as const) {
      const armor = compileArmor({ tier, power }, { id: 'armor', seed: 'armor', noVariance: true, damageModel: 'wounds-v2' });
      const legacy = { armor, damageModel: 'wounds-v2' as const }, arms = { ...legacy, armsModel: ARMS_MODEL };
      for (const channel of ['kinetic', 'thermal', 'arcane'] as const) {
        const before = anchoredProtection(legacy, channel), after = anchoredProtection(arms, channel);
        if (tier === 1) expect(after - before).toBeLessThanOrEqual(0.5);
        else expect(after).toBe(before);
        if (before > 0) expect(protectionPower(arms, channel)).toBeCloseTo(protectionPower(legacy, channel), 9);
      }
      if (tier === 1) expect(anchoredProtection(arms, 'kinetic')).toBe(2 * power - 0.5);
    }
  });
  it('同级普通刀剑、弓、手枪对轻甲由全额穿透变为约78%；斧、步枪等穿透更强的武器仍全额', () => {
    for (const power of [2, 5, 9]) {
      const armor = compileArmor({ tier: 1, power }, { id: 'armor', seed: 'armor', noVariance: true, damageModel: 'wounds-v2' });
      const legacy = { armor, damageModel: 'wounds-v2' as const }, arms = { ...legacy, armsModel: ARMS_MODEL };
      expect(armorTransmission(legacy, 'kinetic', 2 * power)).toBe(1);
      expect(armorTransmission(arms, 'kinetic', 2 * power)).toBeCloseTo(0.775, 9);
      expect(armorTransmission(arms, 'kinetic', 2 * power + 1)).toBe(1);
    }
    const sword = unit('a1'), target = unit('e1', { tier: 1, weapon: 'sword' });
    const before = preview(V11_OVERFLOW_D20, sword, target, 1), after = preview(V12_OVERFLOW_D20, sword, target, 1);
    expect(before.penetrationFactor).toBe(1); expect(after.penetrationFactor).toBeCloseTo(0.775, 9);
    expect(after.expectedDamage).toBeLessThan(before.expectedDamage);
  });
});

describe('V12 重武器：人形个体与编队的操作限制', () => {
  it('人形个体单人操作机炮只保留三分之二火力；大型身体与载具不受影响', () => {
    const target = unit('e1', { tier: 0 });
    for (const [body, share] of [['human', 2 / 3], ['large', 1], ['vehicle', 1]] as const) {
      const gunner = unit('a1', { weapon: 'autocannon', body });
      const before = preview(V11_OVERFLOW_D20, gunner, { ...target, base: { ...target.base, hpMax: 100000 }, hp: 100000 }, 3);
      const after = preview(V12_OVERFLOW_D20, gunner, { ...target, base: { ...target.base, hpMax: 100000 }, hp: 100000 }, 3);
      expect(after.hitChance).toBeCloseTo(before.hitChance, 9);
      expect(after.expectedDamage / before.expectedDamage).toBeCloseTo(share, 1);
    }
  });
  it('火炮对单个人形目标命中−3；对编队、大型、骑乘与载具目标不变', () => {
    const gun = unit('a1', { weapon: 'cannon', body: 'vehicle' });
    const lone = unit('e1'), squad = unit('e2', { scale: 'company' }), large = unit('e3', { body: 'large' }), tank = unit('e4', { body: 'vehicle' });
    const mounted = { ...unit('e5'), mount: true };
    expect(preview(V12_OVERFLOW_D20, gun, lone, 4).attackModifiers).toContain('火炮瞄准单兵 -3');
    expect(preview(V11_OVERFLOW_D20, gun, lone, 4).attackModifiers ?? '').not.toContain('火炮瞄准单兵');
    for (const target of [squad, large, tank, mounted]) expect(preview(V12_OVERFLOW_D20, gun, target, 4).attackModifiers ?? '').not.toContain('火炮瞄准单兵');
    const mortar = unit('a2', { weapon: 'indirect-cannon', body: 'vehicle' });
    expect(preview(V12_OVERFLOW_D20, mortar, lone, 4).attackModifiers).toContain('火炮瞄准单兵 -3');
    const before = preview(V11_OVERFLOW_D20, gun, lone, 4), after = preview(V12_OVERFLOW_D20, gun, lone, 4);
    expect(after.hitChance).toBeLessThan(before.hitChance);
  });
  it('人形编队机炮两人一门，参与份数是旧规则的1.5倍；火炮仍四人一门', () => {
    const target = unit('e1', { scale: 'company', members: 200 });
    for (const [weapon, ratio] of [['autocannon', 1.5], ['cannon', 1], ['rifle', 1]] as const) {
      const crew = unit('a1', { weapon, scale: 'company', members: 20 });
      const before = preview(V11_OVERFLOW_TW, crew, target, 3), after = preview(V12_OVERFLOW_TW, crew, target, 3);
      expect(after.participants! / before.participants!).toBeCloseTo(ratio, 9);
    }
  });
  it('编队爆破每3名参战人员一份；英雄仍一份，旧规则不变', () => {
    const target = unit('e1', { scale: 'company', members: 200 });
    const sappers = unit('a1', { weapon: 'demolition', scale: 'company', members: 21 }), hero = unit('a2', { weapon: 'demolition' });
    const before = preview(V11_OVERFLOW_TW, sappers, target, 1), after = preview(V12_OVERFLOW_TW, sappers, target, 1);
    expect(before.participants).toBe(20); expect(after.participants).toBeCloseTo(20 / 3, 9);
    expect(after.expectedDamage).toBeLessThan(before.expectedDamage / 2);
    expect(preview(V12_OVERFLOW_TW, hero, target, 1).participants).toBe(1);
    const small = unit('a3', { weapon: 'demolition', scale: 'company', members: 2 });
    expect(preview(V12_OVERFLOW_TW, small, target, 1).participants).toBe(1);
  });
});

describe('V12 长兵器与轻型投射', () => {
  it('长兵器贴身命中−1（旧战斗−2），距离2无惩罚', () => {
    const spear = unit('a1', { weapon: 'spear' }), foe = unit('e1');
    expect(preview(V12_OVERFLOW_D20, spear, foe, 1).attackModifiers).toContain('长柄贴身受限 -1');
    expect(preview(V11_OVERFLOW_D20, spear, foe, 1).attackModifiers).toContain('长柄贴身受限 -2');
    expect(preview(V12_OVERFLOW_D20, spear, foe, 2).attackModifiers ?? '').not.toContain('长柄贴身受限');
  });
  it('手枪、投石索等轻型投射格子射程4，旧战斗保持2；射程修正照常叠加', () => {
    const pistol = compileWeapon({ mechanism: 'light-ranged', power: 3 }, { id: 'p', seed: 'p', noVariance: true });
    const longer = compileWeapon({ mechanism: 'light-ranged', power: 3, bonuses: { range: 5 } }, { id: 'q', seed: 'q', noVariance: true });
    expect(gridWeaponRange(pistol)).toBe(2); expect(gridWeaponRange(pistol, true, ARMS_MODEL)).toBe(4);
    expect(gridWeaponRange(longer, true, ARMS_MODEL)).toBe(5); expect(pistol.range).toBe(2);
    const javelin = compileWeapon({ mechanism: 'throwing', power: 3 }, { id: 't', seed: 't', noVariance: true });
    expect(gridWeaponRange(javelin, true, ARMS_MODEL)).toBe(gridWeaponRange(javelin));
  });
  it('V12小战按4格判定轻型投射射程', () => {
    const field = standardField(); field.tiles.fill('open');
    for (const [rules, legal] of [[V11_OVERFLOW_D20, false], [V12_OVERFLOW_D20, true]] as const) {
      const a = unit('a1', { weapon: 'light-ranged' }), e = unit('e1');
      const b = new SmallBattle({ combatants: [a, e], battlefield: field, rules, seed: 'pistol' }); b.start();
      b.turnOrder = ['a1', 'e1']; b.turnIndex = 0; a.pos = 3 * 7 + 3; e.pos = 6 * 7 + 3;
      const option = b.getActionOptions('a1').find(o => o.id === 'weapon');
      expect(option?.targets?.find(t => t.targetId === 'e1')?.enabled).toBe(legal);
      if (legal) { const before = memberHealth(e); b.attack('a1', 'e1'); expect(b.log.some(l => l.kind === 'attack')).toBe(true); expect(memberHealth(e)).toBeLessThanOrEqual(before); }
    }
  });
});

describe('V12 远程武器技法', () => {
  it('射击武技射程等于所用武器的实际射程（小战格子、会战阵距），近战武技与旧战斗不变', () => {
    const field = standardField(7, 13); field.tiles.fill('open');
    for (const [rules, reach] of [[V11_OVERFLOW_D20, 3], [V12_OVERFLOW_D20, 7]] as const) {
      const a = unit('a1', { weapon: 'bow' }), e = unit('e1');
      const skill = compileSkill('generic:physical-single:ranged', 5, 'a1'); a.abilities = [skill]; a.preparedAbilityIds = [skill.id];
      const b = new SmallBattle({ combatants: [a, e], battlefield: field, rules, seed: 'technique' }); b.start(); b.turnOrder = ['a1', 'e1']; b.turnIndex = 0;
      for (const d of [3, 4, 7, 8]) {
        a.pos = 7 + 3; e.pos = (1 + d) * 7 + 3;
        const option = b.getActionOptions('a1').find(o => o.kind === 'ability');
        expect(option?.targets?.find(t => t.targetId === 'e1')?.enabled).toBe(d <= reach);
        expect(b.getActionOptions('a1').find(o => o.id === 'weapon')?.targets?.find(t => t.targetId === 'e1')?.enabled).toBe(d <= 7);
      }
      const holder = prepared(rules, unit('a2', { weapon: 'bow' }))[0]!; holder.abilities = [skill];
      expect(fallbackAbilityRange(holder, skill).max).toBe(rules.armsModel ? 4 : 3);
      const swordsman = prepared(rules, unit('a3', { weapon: 'spear' }))[0]!;
      const melee = compileSkill('generic:physical-single:melee', 5, 'a3'); swordsman.abilities = [melee];
      expect(fallbackAbilityRange(swordsman, melee, true).max).toBe(2);
    }
  });
});

describe('名称识别', () => {
  it('狙击枪、反器材步枪归为单发重步枪；投掷与投石索优先于刀剑和枪械关键词', () => {
    for (const [name, id] of [['狙击枪', 'heavy-rifle'], ['狙击步枪', 'heavy-rifle'], ['反器材步枪', 'heavy-rifle'], ['机枪', 'rifle'], ['投石索', 'light-ranged']] as const) expect(resolveWeaponClass(name)).toBe(id);
    expect(parseWeaponSpec('猎鹰:狙击枪L6')).toMatchObject({ classKey: 'heavy-rifle', level: 6 });
    expect(parseWeaponSpec('精钢飞刀L3')).toMatchObject({ classKey: 'throwing', level: 3 });
    expect(parseWeaponSpec('重型标枪L3')).toMatchObject({ classKey: 'throwing', level: 3 });
    expect(parseWeaponSpec('巴雷特反器材狙击枪L6')).toMatchObject({ classKey: 'heavy-rifle', level: 6 });
    expect(parseWeaponSpec('突击步枪L5')).toMatchObject({ classKey: 'rifle', level: 5 });
  });
  it('链甲与锁子甲按中甲识别，皮甲仍为轻甲', () => {
    expect(parseArmorSpec('精钢链甲:链甲L3')).toMatchObject({ tier: 2, level: 3 });
    expect(parseArmorSpec('锁子甲L3')).toMatchObject({ tier: 2, level: 3 });
    expect(parseArmorSpec('旅人皮甲：轻甲L3')).toMatchObject({ tier: 1, level: 3 });
    expect(parseArmorSpec('皮甲L2')).toMatchObject({ tier: 1, level: 2 });
  });
});
