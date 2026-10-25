import { describe, expect, it } from 'vitest';
import { SmallBattle, MassBattle, V36_OVERFLOW_D20, V37_OVERFLOW_D20, V37_OVERFLOW_TW, generateUnit, standardField, skillDefinitionId, createStructure, type RulePack } from '../src/index.js';
import { roundDigest } from '../src/inject/format.js';
import { narrativeEvents } from '../../panel/src/battle-reports.js';

function scene(definition = '魔法范围', rules: RulePack = V37_OVERFLOW_D20) {
  const units = ['a', 'e', 'e2'].map(id => {
    const unit = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', damageModel: 'wounds-v2',
      numericModel: 'graded-v1', scale: 'hero', level: 5, weaponClass: 'sword', armorTier: 0, traits: [],
      abilityBlueprints: id === 'a' ? [{ id: skillDefinitionId(definition)!, level: 5 }] : [] },
    { seed: id, noVariance: true, skillModel: 'skills-v4' }).unit;
    unit.id = id; return unit;
  });
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules, seed: 'area-targeting',
    rng: { seed: 'hit', next: () => 0, d: sides => sides === 20 ? 18 : sides } });
  b.start(); b.turnOrder = ['a', 'e', 'e2']; b.turnIndex = 0;
  const a = units[0]!, e = units[1]!, other = units[2]!;
  a.pos = 49; e.pos = 7; other.pos = 0;
  a.resources.SP = 100;
  return { b, a, e, other, skill: a.abilities[0]! };
}

describe('范围技能目标、结算和战报一致', () => {
  it('魔法范围在射程边缘命中相邻格的波及单位', () => {
    const { b, a, e, other, skill } = scene();
    const preview = b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!;
    expect(preview.enabled).toBe(true);
    expect(preview.preview!.areaTargetIds).toEqual(['e', 'e2']);
    const before = other.hp;
    const cast = b.useAbility(a.id, skill.id, e.id);
    expect(cast.ok).toBe(true);
    expect(cast.resolutions.map(r => r.defenderId)).toEqual(preview.preview!.areaTargetIds);
    expect(other.hp).toBeLessThan(before);
    expect(roundDigest(b)).toContain('a→e2');
    expect(narrativeEvents(b).some(event => event.text.includes('a→e2'))).toBe(true);
  });

  it.each([
    ['魔法范围扇形', 52, 24, 23], ['魔法范围直线', 52, 24, 31],
    ['魔法范围环形', 31, 24, 30], ['魔法范围连锁', 49, 7, 0],
    ['物理范围近战', 31, 24, 24], ['物理范围近战环形', 31, 24, 30],
    ['物理范围投射', 49, 28, 21],
  ])('%s的实际目标与逐个伤害预览一致', (definition, from, primary, secondary) => {
    const { b, a, e, other, skill } = scene(String(definition) + '+减速');
    a.pos = Number(from); e.pos = Number(primary); other.pos = Number(secondary);
    const frozen = b.toSnapshot();
    const preview = b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!;
    expect(preview.enabled).toBe(true);
    expect(preview.preview!.areaTargetIds).toEqual(['e', 'e2']);
    expect(preview.preview!.areaPreviews!.every(p => p.expectedDamage! > 0)).toBe(true);
    expect(b.toSnapshot()).toEqual(frozen);
    const before = other.hp, cast = b.useAbility(a.id, skill.id, e.id);
    expect(cast.resolutions.map(r => r.defenderId)).toEqual(preview.preview!.areaTargetIds);
    expect(other.hp).toBeLessThan(before);
    expect(cast.log).toContain(other.name + ' 抵抗减速');
  });

  it('普通近战范围保留主目标圆心，环形保留施术者圆心', () => {
    for (const definition of ['物理范围近战', '物理范围近战环形']) {
      const { b, a, e, other, skill } = scene(definition);
      a.pos = 31; e.pos = 24; other.pos = 30;
      const ids = b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!.preview!.areaTargetIds;
      expect(ids).toEqual(definition.endsWith('环形') ? ['e', 'e2'] : ['e']);
    }
  });

  it.each(['增益范围治疗', '增益范围防御', '增益范围屏障', '增益范围回能', '增益范围净化', '增益范围特质飞行', '减益范围减速'])('%s在射程边缘波及相邻目标', definition => {
    const { b, a, e, other, skill } = scene(definition);
    a.pos = 49; e.pos = 14; other.pos = 7;
    if (definition.startsWith('增益')) {
      const foe = structuredClone(other); foe.id = 'foe'; foe.pos = 6; b.combatants.push(foe);
      e.side = other.side = 'ally'; e.hp /= 2; other.hp /= 2;
    }
    if (definition.includes('回能')) { e.resources.SP = other.resources.SP = 0; }
    if (definition.includes('净化')) for (const unit of [e, other]) unit.conditions.push({ id: 'slowed', dur: 3 });
    const before = other.hp;
    const preview = b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!;
    expect(preview.enabled).toBe(true);
    expect(preview.preview!.areaTargetIds).toEqual(['e', 'e2']);
    const cast = b.useAbility(a.id, skill.id, e.id);
    expect(cast.ok).toBe(true);
    if (definition.includes('治疗')) expect(other.hp).toBeGreaterThan(before);
    else if (definition.includes('防御')) expect(other.conditions.some(c => c.id === 'encouraged')).toBe(true);
    else if (definition.includes('屏障')) expect(other.barrier!.remaining).toBeGreaterThan(0);
    else if (definition.includes('回能')) expect(other.resources.SP).toBeGreaterThan(0);
    else if (definition.includes('净化')) expect(other.conditions.some(c => c.id === 'slowed')).toBe(false);
    else if (definition.includes('飞行')) expect(other.traitSources!.some(source => source.traitIds.includes('flying'))).toBe(true);
    else expect(cast.log).toContain(other.name + ' 抵抗减速');
  });

  it('仅有area几何的冻结技能也显示并结算波及对象', () => {
    const { b, a, e, other, skill } = scene();
    skill.shape = 'single'; for (const effect of skill.effects) if ('shape' in effect) effect.shape = 'single';
    const before = other.hp;
    expect(b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!.preview!.areaTargetIds).toEqual(['e', 'e2']);
    expect(b.useAbility(a.id, skill.id, e.id).resolutions.map(r => r.defenderId)).toEqual(['e', 'e2']);
    expect(other.hp).toBeLessThan(before);
  });

  it('主目标仍受施法射程限制，波及仍受墙体、空地层与范围上限限制', () => {
    const { b, a, e, other, skill } = scene();
    expect(b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === other.id)!.enabled).toBe(false);
    skill.area!.shape = 'chain'; skill.area!.radius = 2;
    b.battlefield!.layerVersion = 1; b.battlefield!.structures = b.battlefield!.tiles.map(() => null);
    other.pos = 1; b.battlefield!.structures[0] = createStructure('wall', 5);
    const ids = () => b.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!.preview!.areaTargetIds;
    expect(ids()).toEqual(['e']);
    b.battlefield!.structures[0] = null; other.pos = 0; other.airborne = true;
    expect(ids()).toEqual(['e']);
    other.airborne = false; skill.area!.maxTargets = 1;
    expect(ids()).toEqual(['e']);
  });

  it('会战的范围魔法在射程边缘使用同一组预览和执行目标', () => {
    const { a, e, other } = scene();
    for (const unit of [a, e, other]) { unit.body = 'large'; delete unit.pos; }
    const b = new MassBattle({ combatants: [a, e, other], rules: V37_OVERFLOW_TW, seed: 'area-mass',
      rng: { seed: 'hit', next: () => 0, d: sides => sides === 20 ? 18 : sides } });
    b.start(); a.formationPosition = 'ally:中军:reserve'; e.formationPosition = 'enemy:中军:front'; other.formationPosition = 'enemy:中军:rear';
    const skill = a.abilities[0]!, order = { unitId: a.id, type: 'ability' as const, abilityId: skill.id, targetId: e.id };
    const preview = b.orderPreview(order), before = other.hp;
    expect(preview.areaTargetIds).toEqual(['e', 'e2']);
    expect(b.issue(order).ok).toBe(true);
    for (const unit of [e, other]) b.issue({ unitId: unit.id, type: 'hold' });
    b.resolveRound();
    expect(other.hp).toBeLessThan(before);
    expect(b.log.flatMap(entry => entry.resolution ? [entry.resolution.defenderId] : [])).toEqual(preview.areaTargetIds);
  });

  it('V36旧战斗保存读回保留原范围规则与冻结技能', () => {
    const { b, a, e, skill } = scene('魔法范围', V36_OVERFLOW_D20), snapshot = b.toSnapshot();
    const loaded = SmallBattle.fromSnapshot(structuredClone(snapshot));
    expect(loaded.toSnapshot()).toEqual(snapshot);
    expect(loaded.rules.areaTargetingModel).toBeUndefined();
    expect(loaded.byId(a.id).abilities[0]).toEqual(skill);
    expect(loaded.getActionOptions(a.id).find(o => o.id === skill.id)!.targets!.find(t => t.targetId === e.id)!.preview!.areaTargetIds).toEqual(['e']);
  });

  it('逐轮和增量战报省略指令通行反馈，保留真实状态事件与原始指挥记录', () => {
    const { b, a } = scene();
    const failure = { round: b.round, kind: 'condition' as const, participants: [a.id], observedBy: ['ally' as const],
      text: 'a 指令未完成：路线可通行，本轮剩余移动额度不足', intentFailure: { unitId: a.id, temporary: true } };
    b.log.push(failure, { round: b.round, kind: 'condition', text: 'e 获得减速', observedBy: ['ally'] });
    for (const text of [roundDigest(b), narrativeEvents(b).map(e => e.text).join('\n')]) {
      expect(text).not.toContain('指令未完成'); expect(text).toContain('e 获得减速');
    }
    expect(b.log).toContainEqual(failure);
  });
});
