import { describe, expect, it } from 'vitest';
import { generateUnit, skillDefinitionId, SmallBattle, MassBattle, standardField, V37_OVERFLOW_D20, V38_OVERFLOW_D20, V38_OVERFLOW_TW,
  type RulePack } from '../src/index.js';
import { narrativeEvents } from '../../panel/src/battle-reports.js';
import { spCapacity } from '../src/resources.js';
import { grantBarrier } from '../src/barrier.js';

function fixture(definition: string, mass = false, friendly = false, level = 5, rules?: RulePack) {
  const units = ['a', 'z', 'b', 'x'].map(id => {
    const u = generateUnit({ name: id, side: id === 'a' || friendly && id !== 'x' ? 'ally' : 'enemy', rulesVersion: 'v2',
      damageModel: 'wounds-v2', numericModel: 'graded-v1', scale: 'hero', body: mass ? 'large' : 'human', level: 5,
      weaponClass: 'sword', armorTier: 0, traits: [], abilityBlueprints: id === 'a' ? [{ id: skillDefinitionId(definition)!, level }] :
        id === 'x' ? [{ id: skillDefinitionId('减益范围驱散')!, level: 5 }] : [] },
    { seed: id, noVariance: true, skillModel: 'skills-v4' }).unit;
    u.id = id; return u;
  });
  const opts = { combatants: units, seed: 'skill-review', rng: { seed: 'fixed', next: () => 0, d: (sides: number) => sides === 20 ? 18 : sides } };
  const field = standardField(); field.tiles.fill('open');
  const battle = mass ? new MassBattle({ ...opts, rules: rules ?? V38_OVERFLOW_TW }) : new SmallBattle({ ...opts, battlefield: field, rules: rules ?? V38_OVERFLOW_D20 });
  battle.start();
  const a = units[0]!, target = units[1]!, other = units[2]!, enemy = units[3]!;
  a.resources.SP = 100;
  if (battle instanceof SmallBattle) {
    battle.turnOrder = units.map(u => u.id); battle.turnIndex = 0;
    a.pos = 49; target.pos = 14; other.pos = 7; enemy.pos = 6;
  } else {
    a.formationPosition = 'ally:中军:reserve';
    target.formationPosition = (friendly ? 'ally' : 'enemy') + ':中军:front';
    other.formationPosition = (friendly ? 'ally' : 'enemy') + ':左翼:front';
    enemy.formationPosition = 'enemy:右翼:reserve';
  }
  const skill = a.abilities[0]!;
  const preview = () => {
    if (battle instanceof SmallBattle) return battle.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === target.id)!;
    const p = battle.orderPreview(order()); return { enabled: !p.reason, reason: p.reason, preview: p };
  };
  const order = () => ({ unitId: a.id, type: 'ability' as const, abilityId: skill.id, targetId: target.id });
  const cast = () => {
    const result = battle.useAbility(a.id, skill.id, target.id);
    if (battle instanceof MassBattle && result.ok) {
      for (const u of units) if (!battle.orders.has(u.id)) battle.issue({ unitId: u.id, type: 'hold' });
      battle.resolveRound();
    }
    return result;
  };
  return { battle, a, target, other, enemy, skill, preview, cast };
}

describe('现有技能目标复核', () => {
  it.each([false, true])('远程环形包含选定目标及目标周围的单位（会战=%s）', mass => {
    const { battle, target, other, preview, cast } = fixture('魔法范围环形', mass);
    const p = preview(); expect(p.enabled).toBe(true);
    expect(p.preview!.areaTargetIds).toEqual([target.id, other.id]);
    const before = target.hp, otherBefore = other.hp;
    expect(cast().ok).toBe(true);
    expect(target.hp).toBeLessThan(before); expect(other.hp).toBeLessThan(otherBefore);
    expect(narrativeEvents(battle).some(e => e.text.includes('a→z'))).toBe(true);
  });

  it.each([false, true])('范围治疗可落在满血友军身上并治疗相邻伤员（会战=%s）', mass => {
    const { target, other, preview, cast } = fixture('增益范围治疗', mass, true);
    other.hp /= 2; const before = other.hp;
    const p = preview(); expect(p.enabled, p.reason).toBe(true);
    expect(p.preview!.areaTargetIds).toEqual([other.id]);
    expect(p.preview!.healing).toBeGreaterThan(0);
    expect(p.preview!.effects!.join()).toContain(other.name + '：恢复生命约');
    expect(cast().ok).toBe(true); expect(other.hp).toBeGreaterThan(before); expect(target.hp).toBe(target.base.hpMax);
  });

  it.each([false, true])('范围治疗可以救起范围内的濒死友军（会战=%s）', mass => {
    const { other, preview, cast } = fixture('buff范围治疗', mass, true);
    other.hp = 0; other.status = 'dying';
    const p = preview(); expect(p.enabled, p.reason).toBe(true);
    expect(p.preview!.areaTargetIds).toEqual([other.id]);
    expect(cast().ok).toBe(true); expect(other.hp).toBeGreaterThan(0); expect(other.status).toBe('ready');
  });

  it.each([false, true])('范围buff以已有同效增益的友军为中心，给周围友军生效（会战=%s）', mass => {
    const { a, target, other, skill, preview, cast } = fixture('buff范围防御', mass, true);
    const effect = skill.effects.find(e => e.op === 'condition')!;
    if (effect.op !== 'condition') throw Error('Expected buff');
    target.conditions.push({ id: effect.conditionId, dur: 99, potency: effect.potency, magnitude: effect.magnitude, sourceId: a.id });
    const p = preview(); expect(p.enabled, p.reason).toBe(true);
    expect(p.preview!.areaTargetIds).toEqual([other.id]);
    expect(p.preview!.effects!.join()).toContain(other.name + '：');
    expect(cast().ok).toBe(true);
    expect(other.conditions.some(c => c.id === effect.conditionId && c.sourceId === a.id)).toBe(true);
    expect(target.conditions.filter(c => c.id === effect.conditionId)).toHaveLength(1);
  });

  it.each([false, true])('范围无人需要效果时不扣精力、冷却或行动（会战=%s）', mass => {
    const { battle, a, target, other, skill, preview, cast } = fixture('buff范围防御', mass, true);
    const effect = skill.effects.find(e => e.op === 'condition')!;
    if (effect.op !== 'condition') throw Error('Expected buff');
    for (const u of [target, other]) u.conditions.push({ id: effect.conditionId, dur: 99, potency: effect.potency, magnitude: effect.magnitude, sourceId: a.id });
    const before = structuredClone(battle.toSnapshot()), p = preview();
    expect(p.enabled).toBe(false); expect(p.reason).toContain('没有可生效');
    expect(cast().ok).toBe(false); expect(battle.toSnapshot()).toEqual(before);
  });

  it.each([false, true])('范围净化可选无负面状态的友军，清除周围友军的状态（会战=%s）', mass => {
    const { target, other, preview, cast } = fixture('buff范围净化', mass, true);
    other.conditions.push({ id: 'slowed', dur: 5 });
    expect(preview().preview!.areaTargetIds).toEqual([other.id]);
    expect(cast().ok).toBe(true);
    expect(target.conditions).toEqual([]); expect(other.conditions.some(c => c.id === 'slowed')).toBe(false);
  });

  it.each([false, true])('支付精力不会把原本无需支援的施术者临时加入范围目标（会战=%s）', mass => {
    const { battle, a, target, other, preview, cast } = fixture('buff范围屏障+回能', mass, true);
    if (battle instanceof SmallBattle) a.pos = target.pos;
    else a.formationPosition = target.formationPosition;
    a.resources.SP = spCapacity(a); target.resources.SP = spCapacity(target); other.resources.SP = 0;
    for (const u of [a, target]) grantBarrier(u, 1000, 99, 'existing', 10);
    const p = preview(); expect(p.enabled, p.reason).toBe(true); expect(p.preview!.areaTargetIds).toEqual([other.id]);
    expect(cast().ok).toBe(true);
    expect(battle.log.some(e => e.text.startsWith(a.name + ' 获得屏障'))).toBe(false);
    expect(other.barrier!.remaining).toBeGreaterThan(0); expect(other.resources.SP).toBeGreaterThan(0);
  });

  it.each([false, true])('范围buff的两个属性和通道效果实际施加，后续可驱散并自然到期（会战=%s）', mass => {
    const { battle, a, target, other, enemy, skill, preview, cast } = fixture('buff范围攻击+防御+热能伤害', mass, true);
    const snapshot = structuredClone(battle.toSnapshot()), p = preview();
    expect(p.preview!.areaTargetIds).toEqual([target.id, other.id]); expect(battle.toSnapshot()).toEqual(snapshot);
    const sp = a.resources.SP!; expect(cast().ok).toBe(true);
    expect(a.resources.SP).toBeLessThan(sp);
    const ids = skill.effects.flatMap(e => e.op === 'condition' ? [e.conditionId] : []);
    expect(ids).toHaveLength(3);
    for (const u of [target, other]) for (const id of ids) expect(u.conditions.some(c => c.id === id && c.dur > 0 && c.sourceId === a.id)).toBe(true);
    expect(enemy.conditions.some(c => ids.includes(c.id))).toBe(false);
    if (battle instanceof SmallBattle) {
      enemy.pos = 15;
      expect(battle.useAbility(enemy.id, enemy.abilities[0]!.id, target.id, { bypassTurn: true }).ok).toBe(true);
      expect(target.conditions.filter(c => ids.includes(c.id))).toHaveLength(2);
      for (let n = 0; n < 50 && other.conditions.some(c => ids.includes(c.id)); n++) battle.endTurn();
    } else {
      for (let n = 0; n < 10 && other.conditions.some(c => ids.includes(c.id)); n++) {
        for (const u of battle.combatants) battle.issue({ unitId: u.id, type: 'hold' });
        battle.resolveRound();
      }
    }
    expect(other.conditions.some(c => ids.includes(c.id))).toBe(false);
  });

  it('目标数达到上限且有同格单位时，主目标仍在实际受击名单中', () => {
    const { battle, a, target, other, enemy, skill, preview, cast } = fixture('魔法范围');
    if (!(battle instanceof SmallBattle)) throw Error('Expected small battle');
    a.pos = 31; target.pos = other.pos = enemy.pos = 24;
    const extra = structuredClone(other); extra.id = 'c'; extra.name = 'c'; battle.combatants.push(extra);
    const p = preview(); expect(p.preview!.areaTargetIds).toHaveLength(skill.area!.maxTargets);
    expect(p.preview!.areaTargetIds![0]).toBe(target.id);
    expect(cast().ok).toBe(true);
    expect(battle.log.flatMap(entry => entry.resolutions ?? []).map(r => r.defenderId)).toEqual(p.preview!.areaTargetIds);
  });

  it.each([false, true])('旧式burst范围也跳过满血中心，且全员满血时拒绝空放（会战=%s）', mass => {
    const { other, skill, preview, cast } = fixture('buff范围治疗', mass, true);
    delete skill.area;
    other.hp /= 2; const before = other.hp;
    expect(preview().preview!.areaTargetIds).toEqual([other.id]);
    expect(cast().ok).toBe(true); expect(other.hp).toBeGreaterThan(before);
    const empty = fixture('buff范围治疗', mass, true); delete empty.skill.area;
    expect(empty.preview().enabled).toBe(false); expect(empty.cast().ok).toBe(false);
  });

  it.each([false, true])('范围击退在所有目标都超出推力时拒绝执行（会战=%s）', mass => {
    const { battle, target, other, preview, cast } = fixture('减益范围击退', mass, false, 1);
    target.body = other.body = 'giant';
    const before = structuredClone(battle.toSnapshot());
    expect(preview().enabled).toBe(false); expect(cast().ok).toBe(false);
    expect(battle.toSnapshot()).toEqual(before);
  });

  it('近战环形包含同格主目标，远程环形不会扫到施术者身边的无关敌人', () => {
    for (const definition of ['物理范围近战环形', '魔法范围环形']) {
      const { battle, a, target, other, preview, cast } = fixture(definition);
      if (!(battle instanceof SmallBattle)) throw Error('Expected small battle');
      if (definition.startsWith('物理')) { a.pos = target.pos = 31; other.pos = 24; }
      else other.pos = 48;
      const p = preview(); expect(p.enabled, p.reason).toBe(true);
      expect(p.preview!.areaTargetIds).toContain(target.id);
      if (definition.startsWith('魔法')) expect(p.preview!.areaTargetIds).not.toContain(other.id);
      const before = target.hp; expect(cast().ok).toBe(true); expect(target.hp).toBeLessThan(before);
    }
  });

  it('V37旧环形与冻结技能保存读回仍保留原规则', () => {
    const { battle, a, skill, preview } = fixture('魔法范围环形', false, false, 5, V37_OVERFLOW_D20);
    const snapshot = structuredClone(battle.toSnapshot()), loaded = SmallBattle.fromSnapshot(snapshot);
    expect(loaded.rules.skillTargetModel).toBeUndefined(); expect(loaded.toSnapshot()).toEqual(snapshot);
    expect(loaded.byId(a.id).abilities[0]).toEqual(skill); expect(preview().preview!.areaTargetIds).toBeUndefined();
  });

  it.each([false, true])('范围伤害逐单位判定命中，附带控制也各自抵抗DC（会战=%s）', mass => {
    const { battle, a, target, other, preview, cast } = fixture('魔法范围减速', mass);
    a.base.atk = 100;
    const expected = mass ? [1, 20] : [18, 18, 1, 20], rolls = [...expected], used: number[] = [];
    battle.rng.d = sides => {
      if (sides !== 20) return sides;
      const roll = rolls.shift() ?? 18; used.push(roll); return roll;
    };
    const p = preview(); expect(p.enabled).toBe(true); expect(used).toEqual([]);
    const before = [target.hp, other.hp]; expect(cast().ok).toBe(true);
    expect(target.hp).toBeLessThan(before[0]!); expect(other.hp).toBeLessThan(before[1]!);
    expect(used).toEqual(expected);
    expect(target.conditions.some(c => c.id === 'slowed')).toBe(true);
    expect(other.conditions.some(c => c.id === 'slowed')).toBe(false);
    const events = narrativeEvents(battle).map(e => e.text).join('\n');
    expect(events).toContain(target.name + ' 获得减速'); expect(events).toContain(other.name + ' 抵抗减速');
  });

  it.each([false, true])('一个目标防御导致未中，不会跟随另一目标命中或追加控制（会战=%s）', mass => {
    const { battle, a, target, other, cast } = fixture('魔法范围减速', mass);
    a.base.atk = 30; target.base.def = 0; other.base.def = 1000;
    const rolls = mass ? [1] : [18, 18, 1]; battle.rng.d = sides => sides === 20 ? rolls.shift() ?? 18 : sides;
    if (mass) battle.rng.next = () => .5;
    const before = other.hp, result = cast(); expect(result.ok).toBe(true);
    const hits = battle.log.flatMap(entry => entry.resolutions?.length ? entry.resolutions : entry.resolution ? [entry.resolution] : []);
    expect(hits.find(r => r.defenderId === target.id)!.hit).toBe(true);
    expect(hits.find(r => r.defenderId === other.id)!.hit).toBe(false);
    expect(other.hp).toBe(before); expect(other.conditions.some(c => c.id === 'slowed')).toBe(false);
  });
});
