import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, compileGenericSkill, compileSkill, type Combatant, type EffectOp } from '../src/index.js';
import { placeZone, settleZones, smokeBlocks, validateAreas } from '../src/area-effects.js';
import { upgradeCombatSkills } from '../src/skill-upgrade.js';
import { zoneEffectDescription, zoneAmount } from '../src/zone-skills.js';
import { skillEffectLines } from '../src/skill-effects.js';
import { gridAbility } from '../src/small/skill-range.js';
import { applyCombatDamage } from '../src/recovery.js';
import { memberHealth } from '../src/member-health.js';
import { combatantFromUnknown } from '../../panel/src/unit-state.js';
import { parseProtocol } from '../../panel/src/protocol.js';
import type { Enhancements } from '../src/enhancements.js';

const ids = { fire: 'generic:magic-area:zone-fire', poison: 'generic:magic-area:zone-poison', smoke: 'generic:buff:zone-smoke', healing: 'generic:buff:zone-healing', trap: 'generic:debuff:zone-trap' };
type Kind = keyof typeof ids;
const kinds = Object.keys(ids) as Kind[];
const spell = (kind: Kind, bonuses?: Enhancements) => compileSkill({ id: ids[kind], bonuses }, 3, 'a');
function effect(kind: Kind, bonuses?: Enhancements) { return spell(kind, bonuses).effects[0] as Extract<EffectOp, { op: 'zone' }>; }
function unit(id: string, side: 'ally' | 'enemy' = 'ally', company = false): Combatant {
  const u = generateUnit({ name: id, side, scale: company ? 'company' : 'hero', rulesVersion: 'v2', level: 5, hpMax: 100, weaponClass: 'sword', weaponLevel: 2, armorTier: 0, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id; u.tags.push('zone:中军', 'rank:front'); return u;
}
function battle(mode: 'small' | 'mass', units: Combatant[]) {
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = mode === 'small' ? new SmallBattle({ combatants: units, battlefield: field, rules: V4_OVERFLOW_D20, seed: 'zone-bonus' })
    : new MassBattle({ combatants: units, rules: V4_OVERFLOW_TW, seed: 'zone-bonus' });
  b.start();
  if (b instanceof SmallBattle) { b.turnOrder = units.map(u => u.id); b.turnIndex = 0; units.forEach((u, i) => u.pos = i ? 31 : 45); }
  return b;
}

describe('持续区域的有符号技能修正', () => {
  it('五类区域各自使用合适的修正，保留等级与覆盖半径', () => {
    for (const kind of kinds) {
      const base = effect(kind), plus = effect(kind, { power: 5, damage: 5, healing: 5, duration: 5, range: 5 });
      const minus = effect(kind, { power: -10, damage: -10, healing: -10, duration: -10, range: -10 });
      expect(plus.power).toBe(3); expect(plus.radius).toBe(base.radius);
      expect(plus.dur).toBe(kind === 'smoke' ? 5 : 4); expect(minus.dur).toBe(1);
      if (kind !== 'smoke') { expect(plus.amount).toBe(20); expect(minus.amount).toBe(7); }
      expect(spell(kind, { range: 5 }).range!.max).toBe(4);
      expect(spell(kind, { range: -10 }).range!.max).toBe(1);
    }
    expect(effect('smoke', { power: 10, duration: 10 }).dur).toBe(7);
    expect(effect('smoke', { power: 5, duration: -5 }).dur).toBe(3);
    expect(effect('smoke', { damage: 10, healing: 10, accuracy: 10, penetration: 10 })).toEqual(effect('smoke'));
    expect(effect('healing', { damage: 10 })).toEqual(effect('healing'));
    for (const kind of ['fire', 'poison', 'trap'] as const) expect(effect(kind, { healing: 10, accuracy: 10 })).toEqual(effect(kind));
  });
  it('热能只增强火墙，动能只增强陷阱，毒雾不凭穿透突破免疫', () => {
    expect(effect('fire', { thermalDamage: 10, thermalPenetration: 5 })).toMatchObject({ amount: 20, penetration: 7 });
    expect(effect('trap', { kineticDamage: 10, kineticPenetration: -5 })).toMatchObject({ amount: 20, penetration: 5 });
    expect(effect('fire', { kineticDamage: 10, kineticPenetration: 10 })).toEqual(effect('fire'));
    expect(effect('trap', { thermalDamage: 10, thermalPenetration: 10 })).toEqual(effect('trap'));
    expect(effect('poison', { thermalDamage: 10, arcaneDamage: 10, penetration: 10 })).toEqual(effect('poison'));
    expect(effect('fire', { power: 10, damage: 10, thermalDamage: 10, penetration: 10, thermalPenetration: 10 })).toMatchObject({ amount: 26, penetration: 8 });
    for (const kind of ['fire', 'poison'] as const) {
      expect(gridAbility(spell(kind, { range: 5 })).range!.max).toBe(7);
      expect(gridAbility(spell(kind, { range: -5 })).range!.max).toBe(5);
    }
  });
  for (const mode of ['small', 'mass'] as const) {
    it(`${mode}：实际施放保存修正后的区域，读档不重复结算`, () => {
      for (const kind of kinds) {
        const a = unit('a', 'ally', mode === 'mass'), e = unit('e', 'enemy', mode === 'mass'), ability = spell(kind, { damage: 10, healing: 10, duration: 5, penetration: 5 });
        a.abilities = [ability]; a.preparedAbilityIds = [ability.id];
        const b = battle(mode, [a, e]);
        if (kind === 'healing') applyCombatDamage(a, 40);
        const before = memberHealth(kind === 'healing' ? a : e), sp = a.resources.SP!;
        const target = b instanceof SmallBattle ? 'cell:' + (kind === 'healing' ? a.pos : e.pos) : 'zone:' + (kind === 'healing' ? 'ally' : 'enemy') + ':中军:front';
        expect(b.useAbility(a.id, ability.id, target).ok, kind).toBe(true);
        if (b instanceof MassBattle) { b.issue({ unitId: e.id, type: 'hold' }); b.resolveRound(); }
        expect(a.resources.SP, kind).toBe(sp - 3);
        if (kind === 'healing') expect(memberHealth(a) - before).toBe(20);
        else if (kind !== 'smoke') expect(before - memberHealth(e), kind).toBe(mode === 'small' ? 20 : 80);
        if (kind === 'trap') expect(a.battleZones).toBeUndefined();
        else expect(a.battleZones![0]).toMatchObject({ amount: kind === 'smoke' ? 13 : 20, remaining: 4 });
        const restored = b instanceof SmallBattle ? SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot()))) : MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
        expect(restored.byId(a.id).battleZones).toEqual(a.battleZones);
        const hp = memberHealth(restored.byId(kind === 'healing' ? a.id : e.id));
        // 会战 resolveRound 已把计数推进到下一轮；重放的是区域刚结算的那一轮。
        settleZones(restored.observationContext(), a.battleZones?.[0]?.lastRound ?? b.round);
        expect(memberHealth(restored.byId(kind === 'healing' ? a.id : e.id))).toBe(hp);
      }
    });
  }
  it('伤害、穿透与治疗实际生效，友军伤害、免疫和容量仍限制结果', () => {
    const a = unit('a'), e = unit('e', 'enemy'), context = { units: [a, e], mode: 'small' as const, fieldTags: [] };
    a.pos = 0; e.pos = 1;
    e.armor = { id: 'armor', name: '测试护甲', tier: 1, protectionOverride: true, protection: { thermal: 7, kinetic: 7, arcane: 7 } };
    for (const kind of ['fire', 'trap'] as const) for (const [points, expected] of [[-5, 2], [0, 4], [5, 7]] as const) {
      e.hp = 100; a.battleZones = [];
      placeZone(context, a, e, effect(kind, { penetration: points }), 1, 'test'); settleZones(context, 1);
      expect(100 - e.hp, kind + points).toBe(expected);
    }
    e.body = 'vehicle'; e.hp = 100; a.hp = 100; a.battleZones = [];
    placeZone(context, a, e, effect('poison', { power: 10, damage: 10, penetration: 10 }), 1, 'poison'); settleZones(context, 1);
    expect(e.hp).toBe(100); expect(a.hp).toBe(74); // 区域内友军仍会中毒。
    a.battleZones = []; a.hp = 95;
    placeZone(context, a, a, effect('healing', { healing: 10 }), 1, 'heal'); settleZones(context, 1); expect(a.hp).toBe(100);
  });
  it('强度延长烟幕实际存在时间，不改变遮蔽规则与覆盖面积', () => {
    const a = unit('a'), e = unit('e', 'enemy'); a.pos = 0; e.pos = 6;
    const context = { units: [a, e], mode: 'small' as const, fieldTags: [] };
    placeZone(context, a, { ...e, pos: 3 }, effect('smoke', { power: 5, duration: 5 }), 1, 'smoke');
    expect(smokeBlocks(context, a, e)).toBe(true);
    for (let round = 2; round <= 5; round++) settleZones(context, round, true);
    expect(smokeBlocks(context, a, e)).toBe(true);
    settleZones(context, 6, true); expect(smokeBlocks(context, a, e)).toBe(false);
  });
  it('旧技能升级一次；不刷新冷却资源、不追溯修改已经布置的区域', () => {
    const a = unit('a'), old = compileGenericSkill(ids.fire, 3, a.id); old.bonuses = { damage: 10, duration: 5, range: -5 };
    a.abilities = [old]; a.preparedAbilityIds = [old.id]; a.abilityState = [{ abilityId: old.cooldownGroup!, cdLeft: 2, used: 1 }];
    const context = { units: [a], mode: 'small' as const, fieldTags: [] };
    placeZone(context, a, a, old.effects[0] as Extract<EffectOp, { op: 'zone' }>, 1, old.id);
    delete a.battleZones![0]!.amount; delete a.battleZones![0]!.penetration;
    const deployed = structuredClone(a.battleZones), resources = structuredClone(a.resources), ledger = structuredClone(a.abilityState);
    upgradeCombatSkills(a); expect(old.effects[0]).toMatchObject({ amount: 20, dur: 4 });
    expect(a.battleZones).toEqual(deployed); expect(zoneAmount(a.battleZones![0]!)).toBe(13);
    expect(a.resources).toEqual(resources); expect(a.abilityState).toEqual(ledger);
    const once = JSON.stringify(a); upgradeCombatSkills(a); expect(JSON.stringify(a)).toBe(once);
    const restored = combatantFromUnknown(JSON.parse(once)); upgradeCombatSkills(restored); expect(JSON.stringify(restored.abilities)).toBe(JSON.stringify(a.abilities));
    const custom = compileGenericSkill(ids.fire, 3, a.id); (custom.effects[0] as Extract<EffectOp, { op: 'zone' }>).dur = 7;
    a.abilities = [custom]; const frozen = structuredClone(custom); upgradeCombatSkills(a); expect(custom).toEqual(frozen);
  });
  it('具体数值进入详情与预览，并拒绝损坏的区域存档', () => {
    const a = unit('a'), e = unit('e', 'enemy'), ability = spell('fire', { damage: 10, penetration: 5, duration: 5 });
    const op = ability.effects[0] as Extract<EffectOp, { op: 'zone' }>;
    const description = zoneEffectDescription(op);
    expect(description).toContain('基础伤害20'); expect(description).toContain('热能穿透7'); expect(description).toContain('持续4轮');
    const context = { units: [a, e], mode: 'small' as const, fieldTags: [] };
    expect(skillEffectLines(context, a, e, ability)).toEqual([description]);
    a.abilities = [ability]; placeZone(context, a, e, op, 1, ability.id);
    expect(() => combatantFromUnknown(JSON.parse(JSON.stringify(a)))).not.toThrow();
    for (const amount of [0, -1, 1.5, Infinity, NaN]) { a.battleZones![0]!.amount = amount; expect(() => validateAreas(a)).toThrow(); }
    a.battleZones = []; op.penetration = -1; expect(() => combatantFromUnknown(a)).toThrow();
  });
  it('正文仍使用既有 L 等级修正语法，五种新机制都能识别', () => {
    const result = parseProtocol('<tb><learn id="a" skills="烈焰:火墙L3+5伤害+5热能穿透,瘴气:毒雾L3+5伤害,掩护:烟幕L3+5+5持续,泉水:治疗区域L3+5治疗,机关:陷阱L3+5动能伤害-5持续"/></tb>');
    expect(result.errors).toEqual([]); expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result.events)).toContain('thermalPenetration');
    expect(JSON.stringify(result.events)).toContain('kineticDamage');
  });
});
