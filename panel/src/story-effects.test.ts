import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, activeTraitIds, activeConditionIds, traitLevel, traitSourceActive, grantTraitSource, SmallBattle, V38_OVERFLOW_D20, V38_OVERFLOW_TW, MassBattle, standardField } from '../../engine/src/index.js';
import { expireTraitSources } from '../../engine/src/trait-sources.js';
import { collectMods, resolveStack } from '../../engine/src/bonus.js';
import { standardConditionMap } from '../../engine/src/conditions.js';
import { channelBuffDamage } from '../../engine/src/channel-buffs.js';
import { dispelCandidates, applyDispel, applySkillCondition } from '../../engine/src/skill-effects.js';
import { compileSkill } from '../../engine/src/skill-catalog.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type NarrativeSave, type MessageEnvelope } from './narrative-state.js';
import { parseProtocol } from './protocol.js';
import { parseAbilitySpec, parseEffectAttributes } from './tags.js';
import { grantStoryEffects } from './story-effects.js';
import { combatantFromUnknown, materializeUnitRecord, migratePanelUnits, unitRecordFromCombatant } from './unit-state.js';
import { reviewMigration } from './migration-review.js';
import { commitBattleOutcome } from './unit-state.js';
import { narrativeProjection } from './narrative-controller.js';
import { absorbBarrier, barrierAmount, barrierDefensePower, decayBarrier, grantBarrier } from '../../engine/src/barrier.js';
import { conditionDamageSources } from '../../engine/src/afflictions.js';

const registry = traitRegistry();
const wind = '风神赐福:buffL3+攻击L3+飞行L5';
const frost = '寒霜侵蚀:debuffL2+减速L2';
function unit(scale: 'hero' | 'company' = 'hero') {
  const value = generateUnit({ name: '战士', side: 'ally', scale, hpMax: scale === 'company' ? 20 : undefined, rulesVersion: 'v2', damageModel: 'wounds-v2', level: 3, weaponClass: 'sword', weaponLevel: 3, traits: ['regen'], traitLevels: { regen: 2 } }, { seed: 'story-effects', registry, skillModel: 'skills-v4' }).unit;
  value.id = 'u1'; return value;
}
function setup(): NarrativeSave { return { storage: [unitRecordFromCombatant(unit())], rosterIds: ['u1'], factRevision: 1, storySync: true }; }
function commit(save: NarrativeSave, text: string, mid = 'grant') {
  const source: MessageEnvelope = { characterId: 'c', chatId: 'chat', branchId: 'b', messageId: mid, swipeId: '0', generationId: mid, role: 'assistant', complete: true, text: `<tb>\n${text}\n</tb>` };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, mid); binding.complete = true;
  return prepareNarrativeTransaction(save, proposalFromMessage(source, binding)!, ns);
}
function restored(save: NarrativeSave, index = 0) { return materializeUnitRecord(JSON.parse(JSON.stringify(save.storage![index]!)), registry); }

describe('统一剧情效果', () => {
  it('按用户示例解析，spawn count各卡独立建档并携带状态和分级能力', () => {
    const text = `<spawn name="被祭司临时祝福的战士" side="ally" scale="hero" level="3" count="2" effects="${wind}" battles="2"/>`;
    expect(parseProtocol(text).errors).toEqual([]);
    const next = commit({ storage: [], factRevision: 1, storySync: true }, text);
    expect(next.storage).toHaveLength(2);
    const a = restored(next), b = restored(next, 1);
    for (const u of [a, b]) {
      expect(activeConditionIds(u)).toContain('inspired'); expect(traitLevel(u, 'flying')).toBe(5);
      expect(u.traitSources![0]).toMatchObject({ kind: 'effect', remaining: 2, duration: { kind: 'battles', count: 2 } });
    }
    expect(a.traitSources![0]!.id).not.toBe(b.traitSources![0]!.id);
    expireTraitSources(a, 'battles'); expect(a.traitSources![0]!.remaining).toBe(1); expect(b.traitSources![0]!.remaining).toBe(2);
  });

  it.each([true, false])('effects先于部署生效，deployFirst=%s；追加不覆盖其他来源', deployFirst => {
    const grant = `<effect id="u1" effects="${wind},${frost}" rounds="3"/>`;
    const next = commit(setup(), deployFirst ? `<deploy id="u1"/>${grant}` : `${grant}<deploy id="u1"/>`), u = restored(next);
    expect(next.rosterIds).toEqual(['u1']); expect(activeConditionIds(u)).toEqual(expect.arrayContaining(['inspired', 'slowed']));
    expect(activeTraitIds(u)).toContain('regen'); expect(traitLevel(u, 'flying')).toBe(5);
    const saved = JSON.parse(JSON.stringify(next)), before = structuredClone(saved);
    const loaded = migratePanelUnits({ ...saved, registry });
    expect(loaded.warnings).toEqual([]); expect(loaded.backup).toEqual([]);
    expect(loaded.records).toEqual(next.storage); expect(loaded.roster).toHaveLength(1);
    expect(loaded.roster[0]!.traitSources).toEqual(u.traitSources);
    expect(loaded.roster[0]!.conditions).toEqual(u.conditions);
    expect(reviewMigration(saved)).toBeUndefined(); expect(saved).toEqual(before);
  });

  it('同规格与真实技能编译共享效力、通道伤害及修正，不重复叠加固定来源状态', () => {
    const target = unit(), skillTarget = unit(), text = '烈焰战意:buffL4+攻击L4+热能伤害L7+2强度';
    const spec = parseAbilitySpec(text)[0]!;
    grantStoryEffects(target, [spec], { kind: 'permanent' }, 'compare');
    const ability = compileSkill({ id: spec.blueprintId, name: spec.name, bonuses: spec.bonuses }, spec.level!, 'caster', 'skills-v4');
    upgradeCombatSkills({ ...skillTarget, combatModel: 'cohort-v2', damageModel: 'wounds-v2', skillModel: 'skills-v4', abilities: [ability], abilityState: [] });
    for (const effect of ability.effects) if (effect.op === 'condition') applySkillCondition(skillTarget, { id: effect.conditionId, dur: 3, magnitude: effect.magnitude, potency: effect.potency });
    const attack = (u: ReturnType<typeof unit>) => resolveStack(collectMods(u, {}, standardConditionMap(), [], registry), 'atk', {}).flatTotal;
    expect(attack(target)).toBe(attack(skillTarget)); expect(channelBuffDamage(target, 'thermal')).toBe(channelBuffDamage(skillTarget, 'thermal'));
    expect(target.conditions.find(c => c.id === 'thermal-damage-up')!.magnitude).toBeGreaterThan(0);
  });

  it.each(['rounds="2"', 'battles="2"', 'permanent="true"'])('未部署的spawn效果也能读档，期限=%s', lifetime => {
    const next = commit({ storage: [], factRevision: 1, storySync: true }, `<spawn name="储备战士" side="ally" scale="hero" level="3" effects="${wind}" ${lifetime}/>`);
    // 未部署的单位同样必须通过整个档案的迁移校验。
    next.rosterIds = [];
    const saved = JSON.parse(JSON.stringify(next));
    const loaded = migratePanelUnits({ ...saved, registry });
    expect(loaded.warnings).toEqual([]); expect(loaded.records).toEqual(next.storage);
    expect(reviewMigration(saved)).toBeUndefined();
  });

  it('外层状态使用快照的来源与模型校验，高强度合法；真实损坏仍隔离并保留原件', () => {
    const original = commit(setup(), `<effect id="u1" effects="${wind}" rounds="3"/>`).storage![0]!;
    const strong = structuredClone(original);
    strong.conditions![0]!.magnitude = strong.snapshot!.conditions[0]!.magnitude = 3;
    const loaded = migratePanelUnits({ storage: [strong], registry });
    expect(loaded.warnings).toEqual([]); expect(loaded.records[0]!.conditions![0]!.magnitude).toBe(3);
    for (const damage of ['missing', 'revoked', 'expired', 'wrong-condition', 'duplicate', 'no-snapshot', 'bad-snapshot'] as const) {
      const record = structuredClone(original), source = record.snapshot!.traitSources![0]!;
      if (damage === 'missing') record.conditions![0]!.effectSourceId = 'missing';
      else if (damage === 'revoked') source.revoked = true;
      else if (damage === 'expired') source.remaining = 0;
      else if (damage === 'wrong-condition') record.conditions![0]!.id = 'slowed';
      else if (damage === 'duplicate') record.snapshot!.traitSources!.push(structuredClone(source));
      else if (damage === 'no-snapshot') delete record.snapshot;
      else record.snapshot!.conditions[0]!.effectSourceId = 'missing';
      const migrated = migratePanelUnits({ storage: [record], registry });
      expect(migrated.records, damage).toEqual([]); expect(migrated.backup, damage).toEqual([record]);
      expect(migrated.warnings, damage).toHaveLength(1);
    }
  });

  it.each(['inspired', 'slowed'])('普通技能与剧情的%s各自保留来源，剧情先到期不吞掉技能', id => {
    const u = restored(commit(setup(), `<effect id="u1" effects="${id === 'inspired' ? wind : frost}" rounds="1"/>`));
    const story = structuredClone(u.conditions[0]!);
    applySkillCondition(u, { id, dur: 3, potency: story.potency, magnitude: story.magnitude });
    expect(u.conditions.filter(c => c.id === id)).toHaveLength(2);
    expect(u.conditions.find(c => c.effectSourceId)).toEqual(story);
    expireTraitSources(u, 'rounds');
    const loaded = combatantFromUnknown(JSON.parse(JSON.stringify(u)));
    expect(loaded.conditions).toEqual([{ id, dur: 3, potency: story.potency, magnitude: story.magnitude }]);
  });

  it('同种持续伤害取强但分别保存来源和期限；强效到期后弱效继续，不影响其他通道或旧状态', () => {
    const u = unit();
    grantStoryEffects(u, parseAbilitySpec('短毒:debuffL8+中毒L8'), { kind: 'rounds', count: 1 }, 'strong');
    grantStoryEffects(u, parseAbilitySpec('长毒:debuffL2+中毒L2'), { kind: 'rounds', count: 3 }, 'weak');
    const strong = u.conditions[0]!, weak = u.conditions[1]!;
    expect(strong.magnitude).toBeGreaterThan(weak.magnitude!);
    expect(conditionDamageSources(u)).toEqual([strong]);
    expect(u.conditions).toHaveLength(2);
    expireTraitSources(u, 'rounds');
    expect(conditionDamageSources(u)).toEqual([weak]); expect(weak.dur).toBe(2);
    const ordinary = { id: 'poisoned', dur: 2, magnitude: 2 };
    u.conditions.push(ordinary, { ...ordinary, damageChannel: 'thermal' });
    expect(conditionDamageSources(u)).toEqual([ordinary, { ...ordinary, damageChannel: 'thermal' }]);
    const legacy = unit(); legacy.conditions = [ordinary, { ...ordinary }];
    expect(conditionDamageSources(legacy)).toEqual(legacy.conditions);
  });

  it.each(['small', 'mass'] as const)('%s的同种剧情持续伤害每次只结算一份，全部来源仍可保存', mode => {
    const a = unit(mode === 'mass' ? 'company' : 'hero'), b = unit(mode === 'mass' ? 'company' : 'hero');
    b.id = 'enemy'; b.side = 'enemy';
    grantStoryEffects(a, parseAbilitySpec('毒一:debuffL1+中毒L1,毒二:debuffL1+中毒L1'), { kind: 'rounds', count: 3 }, 'dots');
    let battle: SmallBattle | MassBattle;
    if (mode === 'small') {
      battle = new SmallBattle({ rules: V38_OVERFLOW_D20, battlefield: standardField(), combatants: [a, b], seed: 'dot-small' }); battle.start();
      for (let n = 0; !battle.log.some(l => l.damage?.cause === '毒伤') && n < 4; n++) battle.endTurn();
    } else {
      const mass = new MassBattle({ rules: V38_OVERFLOW_D20, combatants: [a, b], seed: 'dot-mass' }); battle = mass; mass.start();
      mass.issue({ unitId: 'u1', type: 'hold' }); mass.issue({ unitId: 'enemy', type: 'hold' }); mass.resolveRound();
    }
    expect(battle.log.filter(l => l.damage?.targetId === 'u1' && l.damage?.cause === '毒伤')).toHaveLength(1);
    expect(a.conditions.filter(c => c.id === 'poisoned')).toHaveLength(2);
    expect(combatantFromUnknown(JSON.parse(JSON.stringify(a))).traitSources).toEqual(a.traitSources);
  });

  it('部分解除保留原期限、链接与重放凭据，clear all保留固有traits', () => {
    const save = commit(setup(), `<effect id="u1" effects="${wind}" rounds="3"/>`), before = restored(save), original = structuredClone(before.traitSources![0]!);
    expireTraitSources(before, 'rounds');
    save.storage![0] = unitRecordFromCombatant(before, save.storage![0]);
    const next = commit(save, '<effect id="u1" clear="飞行"/>', 'clear'), u = restored(next);
    expect(activeTraitIds(u)).not.toContain('flying'); expect(activeConditionIds(u)).toContain('inspired');
    const source = u.traitSources!.find(s => traitSourceActive(u, s))!;
    expect(source.remaining).toBe(2); expect(u.conditions[0]!.effectSourceId).toBe(source.id);
    grantTraitSource(u, original); expect(u.traitSources!.filter(s => traitSourceActive(u, s))).toHaveLength(1);
    expect(activeTraitIds(u)).not.toContain('flying');
    const projection = narrativeProjection(next);
    expect(projection).toContain('effects="风神赐福:buffL3+攻击L3" rounds="2"');
    expect(projection).not.toContain('飞行L5'); expect(projection).not.toContain('99轮');
    const cleared = restored(commit(next, '<effect id="u1" clear="all"/>', 'all'));
    expect(activeConditionIds(cleared)).toEqual([]); expect(activeTraitIds(cleared)).toContain('regen');
  });

  it('正文效果沿用标准规格与真实期限，明确编辑请求也不发送扫描专用内部配方', () => {
    const save = commit(setup(), `<effect id="u1" effects="${wind}" battles="2"/><effect id="u1" effects="${frost}" rounds="3"/>`);
    for (const request of ['', '修改战士的档案属性']) {
      const projection = narrativeProjection(save, request);
      expect(projection).toContain(`id="u1" effects="${wind}" battles="2"`);
      expect(projection).toContain(`id="u1" effects="${frost}" rounds="3"`);
      expect(projection).not.toContain('99轮'); expect(projection).not.toContain('effectSourceId'); expect(projection).not.toContain('traitSources');
    }
  });

  it('净化与驱散按照具体效果处理；部分驱散后仍能保存并保留能力', () => {
    const u = restored(commit(setup(), `<effect id="u1" effects="${wind},${frost}" battles="2"/>`));
    applyDispel(u, dispelCandidates(u, { op: 'dispel', polarity: 'negative', count: 1 }));
    expect(activeConditionIds(u)).not.toContain('slowed'); expect(activeTraitIds(u)).toContain('flying');
    applyDispel(u, dispelCandidates(u, { op: 'dispel', polarity: 'positive', count: 1 }));
    const loaded = materializeUnitRecord(unitRecordFromCombatant(u), registry);
    expect(activeConditionIds(loaded)).not.toContain('inspired'); expect(activeTraitIds(loaded)).toContain('flying');
    applyDispel(loaded, dispelCandidates(loaded, { op: 'dispel', polarity: 'positive', count: 1 }));
    expect(activeTraitIds(loaded)).not.toContain('flying'); expect(activeTraitIds(loaded)).toContain('regen');
  });

  it('按场来源只在战果提交减少一次，重复提交不续期不多扣', () => {
    const save = commit(setup(), `<effect id="u1" effects="${wind}" battles="2"/>`), u = restored(save);
    const first = commitBattleOutcome({ battleId: 'one', committedIds: [], records: save.storage!, roster: [u], combatants: [u], awards: [], registry });
    const after = materializeUnitRecord(first.records[0]!, registry);
    expect(after.traitSources![0]!.remaining).toBe(1); expect(activeConditionIds(after)).toContain('inspired');
    const second = commitBattleOutcome({ battleId: 'two', committedIds: first.committedIds, records: first.records, roster: [after], combatants: [after], awards: [], registry });
    expect(activeConditionIds(materializeUnitRecord(second.records[0]!, registry))).not.toContain('inspired');
    expect(commitBattleOutcome({ battleId: 'two', committedIds: second.committedIds, records: second.records, roster: [after], combatants: [after], awards: [], registry }).records).toEqual(second.records);
  });

  it.each(['small', 'mass'] as const)('%s实际整轮与快照：普通状态时钟不提前消耗来源，第二轮末一起到期', mode => {
    const a = unit(mode === 'mass' ? 'company' : 'hero'), b = unit(mode === 'mass' ? 'company' : 'hero');
    b.id = 'enemy'; b.side = 'enemy';
    const effects = parseEffectAttributes({ effects: wind, rounds: '2' });
    grantStoryEffects(a, effects.effects!, effects.duration!, 'rounds');
    if (mode === 'small') {
      let battle = new SmallBattle({ rules: V38_OVERFLOW_D20, battlefield: standardField(), combatants: [a, b], seed: 'source-small-rounds' }); battle.start();
      for (let n = 0; battle.round === 1 && n < 8; n++) battle.endTurn();
      battle = SmallBattle.fromSnapshot(battle.toSnapshot());
      expect(battle.round).toBe(2); expect(battle.byId('u1').conditions.find(c => c.id === 'inspired')!.dur).toBe(1);
      for (let n = 0; battle.round === 2 && n < 8; n++) battle.endTurn();
      expect(activeConditionIds(battle.byId('u1'))).not.toContain('inspired'); expect(activeTraitIds(battle.byId('u1'))).not.toContain('flying');
    } else {
      let battle = new MassBattle({ rules: V38_OVERFLOW_TW, combatants: [a, b], seed: 'source-mass-rounds' }); battle.start();
      battle.issue({ unitId: a.id, type: 'hold' }); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound();
      battle = MassBattle.fromSnapshot(battle.toSnapshot());
      expect(battle.byId('u1').conditions.find(c => c.id === 'inspired')!.dur).toBe(1);
      battle.issue({ unitId: a.id, type: 'hold' }); battle.issue({ unitId: b.id, type: 'hold' }); battle.resolveRound();
      expect(activeConditionIds(battle.byId('u1'))).not.toContain('inspired'); expect(activeTraitIds(battle.byId('u1'))).not.toContain('flying');
    }
  });

  it('屏障随来源保存、部分解除和到期，不因再次读取已处理来源恢复容量', () => {
    const save = commit(setup(), '<effect id="u1" effects="结界:buffL4+屏障L4+飞行L3" battles="2"/>'), a = restored(save);
    expect(a.barrier?.remaining).toBeGreaterThan(0);
    const remaining = a.barrier!.remaining;
    a.barrier!.remaining--;
    grantStoryEffects(a, parseEffectAttributes({ effects: '结界:buffL4+屏障L4+飞行L3', battles: '2' }).effects!, { kind: 'battles', count: 2 }, a.traitSources![0]!.id.slice(7, -2));
    expect(a.barrier!.remaining).toBe(remaining - 1);
    const next = restored(commit(save, '<effect id="u1" clear="飞行"/>', 'barrier-clear'));
    expect(next.barrier?.remaining).toBe(remaining); expireTraitSources(next, 'battles'); expect(next.barrier).toBeDefined();
    expireTraitSources(next, 'battles'); expect(next.barrier).toBeUndefined();
  });

  it('短剧情屏障到期后只保留普通屏障尚未消耗的容量和规格', () => {
    const a = unit(), effect = parseEffectAttributes({ effects: '短结界:buffL4+屏障L4', rounds: '1' });
    grantStoryEffects(a, effect.effects!, effect.duration!, 'short-barrier');
    expect(barrierAmount(a)).toBeGreaterThan(20);
    grantBarrier(a, 20, 3, 'caster', 3); absorbBarrier(a, 2);
    expireTraitSources(a, 'rounds');
    expect(barrierAmount(a)).toBe(20); expect(barrierDefensePower(a)).toBe(3);
    decayBarrier(a); expect(a.barrier!.duration).toBe(2);
  });

  it('普通屏障到期/归档不吞掉按场来源，所有保护同步消耗而不相加或回满', () => {
    const a = unit(), effect = parseEffectAttributes({ effects: '长结界:buffL4+屏障L4', battles: '2' });
    grantStoryEffects(a, effect.effects!, effect.duration!, 'long-barrier');
    const storyAmount = barrierAmount(a);
    grantBarrier(a, 1000, 1, 'caster', 3); absorbBarrier(a, 2); decayBarrier(a);
    expect(barrierAmount(a)).toBe(storyAmount - 2);
    const loaded = materializeUnitRecord(unitRecordFromCombatant(a), registry);
    expect(barrierAmount(loaded)).toBe(storyAmount - 2);
    expireTraitSources(loaded, 'battles'); expect(barrierAmount(loaded)).toBe(storyAmount - 2);
    expireTraitSources(loaded, 'battles'); expect(barrierAmount(loaded)).toBe(0);
  });

  it('剧情屏障缺失或错误的来源不能被读档悄悄丢弃', () => {
    const u = unit();
    grantStoryEffects(u, parseAbilitySpec('结界:buffL3+屏障L3'), { kind: 'battles', count: 2 }, 'barrier-link');
    const record = unitRecordFromCombatant(u);
    expect(migratePanelUnits({ storage: [record], registry }).warnings).toEqual([]);
    for (const damage of ['missing', 'revoked', 'expired', 'wrong-content'] as const) {
      const bad = structuredClone(record), source = bad.snapshot!.traitSources![0]!;
      if (damage === 'missing') bad.snapshot!.barrier!.grants![0]!.effectSourceId = 'missing';
      else if (damage === 'revoked') source.revoked = true;
      else if (damage === 'expired') source.remaining = 0;
      else delete source.barrier;
      const result = migratePanelUnits({ storage: [bad], registry });
      expect(result.records, damage).toEqual([]); expect(result.backup, damage).toEqual([bad]);
    }
  });

  it('拒绝缺失/冲突期限、非法等级、未知效果及缺少战场上下文的操作，不静默漏掉其中一项', () => {
    for (const attrs of ['effects="x:buffL3+攻击L3"', 'effects="x:buffL3+攻击L3" rounds="2" battles="1"', 'effects="x:buffL11+攻击L3" rounds="2"', 'effects="x:buffL3+未知L3" rounds="2"', 'effects="x:buffL3+治疗L3+召唤L3" rounds="2"', 'rounds="2"', 'clear="不存在"']) {
      expect(parseProtocol(`<effect id="u1" ${attrs}/>`).errors.length, attrs).toBeGreaterThan(0);
    }
  });
});
