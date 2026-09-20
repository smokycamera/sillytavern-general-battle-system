import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, formationNode, grantTraitSource, applyXp, type Combatant, type GenerateInput } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, skills: string[] = [], extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'company', level: 3, hpMax: 500, weaponClass: 'rifle', armorTier: 0, traits: [], abilityBlueprints: skills.map((id) => ({ id, level: 10 })), ...extra }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
function battle(mode: string, units: Combatant[], roll = 20) {
  const rng = { seed: 'fixed', next: () => 0, d: (n: number) => n === 20 ? roll : n };
  if (mode === 'mass') { const b = new MassBattle({ combatants: units, rules: V2_TW, rng, traitRegistry: registry }); b.start(); return b; }
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V2_D20, rng, traitRegistry: registry }); b.start(); b.turnOrder = units.map((u) => u.id); b.turnIndex = 0; units[0]!.pos = 52; units[1]!.pos = 31; if (units[2]) units[2].pos = 24; return b;
}
function cast(b: SmallBattle | MassBattle, actor: Combatant, target: Combatant) {
  const result = b.useAbility(actor.id, actor.abilities[0]!.id, target.id); expect(result.ok).toBe(true);
  if (b instanceof MassBattle) { for (const u of b.combatants) if (!b.orders.has(u.id)) b.issue({ unitId: u.id, type: 'hold' }); b.resolveRound(); }
  return result;
}
describe('有界技能控制与位移', () => {
  it('定身抵抗不改预览RNG，成功限制实际移动而非所有行动，两模式支付一次资源并按时结束', () => {
    for (const mode of ['small', 'mass']) for (const roll of [1, 20]) {
      const a = unit('a', ['bp-binding']), b = unit('b'), combat = battle(mode, [a, b], roll), sp = a.resources.SP!, before = structuredClone(combat.toSnapshot());
      const preview = combat instanceof SmallBattle ? combat.getActionOptions(a.id).find((o) => o.id === a.abilities[0]!.id)!.targets![0]!.preview : combat.orderPreview({ unitId: a.id, type: 'ability', abilityId: a.abilities[0]!.id, targetId: b.id });
      expect(preview?.effects?.join()).toContain('生效机会'); expect(combat.toSnapshot()).toEqual(before);
      if (combat instanceof MassBattle) combat.issue({ unitId: b.id, type: 'rank-back' });
      cast(combat, a, b); expect(a.resources.SP).toBe(sp - a.abilities[0]!.cost!.amount);
      if (combat instanceof SmallBattle) {
        combat.endTurn(); expect(combat.movementLeft(b.id) === 0).toBe(roll === 1);
        expect(combat.getActionOptions(b.id).find((o) => o.id === 'weapon')!.enabled).toBe(true);
        combat.endTurn(); expect(b.conditions.some((c) => c.id === 'restrained')).toBe(false);
      } else { expect(formationNode(b).rank).toBe(roll === 1 ? 'front' : 'rear'); expect(b.conditions.some((c) => c.id === 'restrained')).toBe(false); }
    }
  });
  it('控制有成功概率，抵抗后继续飞行；实际控制迫降造成击败时归功施法者', () => {
    for (const mode of ['small', 'mass']) for (const roll of [1, 20]) {
      const a = unit('a', ['bp-binding']), b = unit('b', [], { traits: ['flying'], hp: 1 }), combat = battle(mode, [a, b], roll);
      const preview = combat instanceof SmallBattle ? combat.getActionOptions(a.id).find((o) => o.id === a.abilities[0]!.id)!.targets![0]!.preview : combat.orderPreview({ unitId: a.id, type: 'ability', abilityId: a.abilities[0]!.id, targetId: b.id });
      expect(preview!.fallChance).toBeGreaterThan(0); expect(preview!.fallChance).toBeLessThan(1);
      cast(combat, a, b); expect(!!b.airborne).toBe(roll === 20);
      if (roll === 1) expect(combat.xpByUnit.get(a.id)).toBe(b.xpValue);
    }
  });
  it('推动真实改位置，墙体或满位阻挡不产生额外碰撞伤害，主行动与资源照常支付', () => {
    for (const mode of ['small', 'mass']) {
      const damage: number[] = [];
      for (const blocked of [false, true]) {
        const a = unit('a', ['bp-force-wave']), b = unit('b');
        const blockers = mode === 'mass' && blocked ? ['c', 'd', 'e'].map((id) => { const u = unit(id); u.tags = ['zone:中军', 'rank:rear']; return u; }) : [];
        const combat = battle(mode, [a, b, ...blockers]);
        if (combat instanceof SmallBattle) { a.pos = 45; if (blocked) combat.battlefield!.tiles[24] = 'wall'; }
        cast(combat, a, b); damage.push(500 - b.hp);
        expect(combat instanceof SmallBattle ? b.pos : formationNode(b).rank).toBe(mode === 'small' ? blocked ? 31 : 24 : blocked ? 'front' : 'rear');
      }
      expect(damage[0]).toBe(damage[1]);
    }
  });
  it('净化只解除负面、驱散不拆装备或永久知识，无可解除目标时不扣费', () => {
    for (const mode of ['small', 'mass']) {
      const a = unit('a', ['bp-purify']), ally = unit('b', [], { side: 'ally' }), enemy = unit('c'), combat = battle(mode, [a, ally, enemy]), sp = a.resources.SP;
      expect(combat.useAbility(a.id, a.abilities[0]!.id, ally.id).ok).toBe(false); expect(a.resources.SP).toBe(sp);
      ally.conditions.push({ id: 'cursed', dur: 3 });
      grantTraitSource(ally, { id: 'weakness', kind: 'effect', name: '虚弱来源', traitIds: [], conditionIds: ['weakened'], duration: { kind: 'permanent' } });
      cast(combat, a, ally); expect(ally.conditions.some((c) => c.id === 'cursed')).toBe(false); expect(ally.traitSources![0]!.revoked).toBe(true); expect(ally.hp).toBe(500);
      const caster = unit('a', ['bp-unravel']), target = unit('b', [], { traits: ['veteran'] });
      grantTraitSource(target, { id: 'magic', kind: 'blessing', name: '魔法守护', traitIds: ['guardian'], duration: { kind: 'permanent' } });
      grantTraitSource(target, { id: 'equipment', kind: 'equipment', equipmentId: target.weapon!.id, name: '装备守护', traitIds: ['guardian'], duration: { kind: 'permanent' } });
      const weapon = structuredClone(target.weapon); cast(battle(mode, [caster, target]), caster, target);
      expect(target.traitSources!.find((s) => s.id === 'magic')!.revoked).toBe(true); expect(target.traitSources!.find((s) => s.id === 'equipment')!.revoked).toBeUndefined(); expect(target.traits).toContain('veteran'); expect(target.weapon).toEqual(weapon);
    }
  });
  it('支援等级有实际强度差异，控制预算扣减伤害，升级不改冻结技能；预备召唤明确为固定来源', () => {
    const low = unit('a', [], { abilityBlueprints: [{ id: 'bp-aegis-shield', level: 1 }] }), high = unit('a', ['bp-aegis-shield']);
    expect(low.abilities[0]!.effects[0]).toMatchObject({ potency: 1 }); expect(high.abilities[0]!.effects[0]).toMatchObject({ potency: 3 });
    for (const mode of ['small', 'mass']) for (const level of [1, 10]) {
      const caster = unit('a', [], { abilityBlueprints: [{ id: 'bp-aegis-shield', level }] }), ally = unit('b', [], { side: 'ally' }), enemy = unit('c');
      const combat = battle(mode, [caster, ally, enemy]), defense = ally.base.def;
      if (combat instanceof MassBattle) combat.issue({ unitId: enemy.id, type: 'volley', targetId: ally.id });
      cast(combat, caster, ally);
      const result = combat instanceof SmallBattle ? (() => { combat.endTurn(); combat.endTurn(); return combat.attack(enemy.id, ally.id); })() : combat.log.find((l) => l.resolution?.attackerId === enemy.id)!.resolution!;
      expect(result.targetDef - defense).toBe(level === 1 ? 1 : 3);
    }
    const frost = unit('a', ['bp-frost-nova']); expect(frost.abilities[0]!.effects.some((e) => e.op === 'condition' && e.onHit && e.saveDC)).toBe(true); expect(frost.abilities[0]!.cost!.amount).toBe(4);
    const frozen = structuredClone(frost.abilities); applyXp(frost, 9999, registry); expect(frost.abilities).toEqual(frozen);
    const summon = unit('a', ['bp-call-reinforce'], { reserves: 1 }); expect(summon.abilities[0]).toMatchObject({ power: 1, fixedPower: true, cost: { resource: 'reserve', amount: 1 }, usesPerBattle: 1 });
  });
});
