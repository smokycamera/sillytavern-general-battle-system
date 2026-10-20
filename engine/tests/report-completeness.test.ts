import { describe, expect, it } from 'vitest';
import { SmallBattle, MassBattle, V11_OVERFLOW_D20, V2_TW, generateUnit, standardField, createStructure, damageStructure, grantBarrier, placeZone, grantTraitSource,
  type Ability, type BattleLogEntry, type Combatant } from '../src/index.js';
import { compactEvents, fieldFacts, roundDigest, smallStateSummary } from '../src/inject/format.js';
import { prepareCondition } from '../src/skill-effects.js';
import { STRUCTURE_NAMES } from '../src/small/layers.js';
import type { AttackResolution } from '../src/damage.js';
import { battleEpilogue, narrativeEvents } from '../../panel/src/battle-reports.js';

function scene(thirdParty = false) {
  const make = (id: string, side: Combatant['side']) => {
    const u = generateUnit({ name: id, side, scale: 'hero', level: 3, rulesVersion: 'v2', weaponClass: 'blunt', weaponLevel: 5, armorTier: 0, traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; u.morale = u.base.moraleMax = 100; return u;
  };
  const a = make('甲', 'ally'), e = make('乙', 'enemy');
  const field = standardField(); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null); field.overlays = {}; field.landmarks = [];
  const b = new SmallBattle({ combatants: [a, e, ...(thirdParty ? [make('丙', 'neutral')] : [])], battlefield: field, rules: V11_OVERFLOW_D20, seed: 'report-completeness' });
  b.start(); b.turnOrder = b.combatants.map(u => u.id); b.turnIndex = 0; a.pos = 31; e.pos = 24;
  return { b, a, e, field: b.battlefield! };
}
function cast(b: SmallBattle, a: Combatant, effects: Ability['effects'], target: Ability['target'] = 'enemy') {
  const ability: Ability = { id: 'skill', name: '试验技能', target, delivery: 'magic', power: 3, range: { min: 0, max: 7, metric: 'grid' }, effects };
  a.abilities = [ability]; a.preparedAbilityIds = [ability.id]; a.abilityState = [{ abilityId: ability.id, cdLeft: 0, used: 0 }]; a.resources.SP = 20;
  expect(b.useAbility(a.id, ability.id, target === 'self' ? undefined : '乙', { bypassTurn: true }).ok).toBe(true);
  return compactEvents(b.log.filter(e => e.kind === 'ability')).join('\n');
}
function shot(extra: Partial<AttackResolution> = {}): BattleLogEntry {
  const resolution: AttackResolution = { attackerId: 'a', defenderId: 'e', attackerName: '甲', defenderName: '乙', hit: true, crit: false,
    damageModel: 'member-health', defenderScale: 'hero', defenderStatus: 'ready', finalDamage: 0, hpBefore: 100, hpAfter: 100,
    netAtk: 0, targetDef: 0, atkDetail: '', drPercent: 0, baseAfterDR: 0, apTotal: 0, dmgMult: 1, wardMult: 1, text: '原始结算', ...extra };
  return { round: 1, kind: 'attack', text: resolution.text, resolution };
}

describe('逐轮战报保留已结算的关键事实', () => {
  it.each(Object.keys(STRUCTURE_NAMES) as (keyof typeof STRUCTURE_NAMES)[])('%s 的普通破坏、突破口及旧文本日志都保留', kind => {
    const { b, a, e, field } = scene(); e.pos = 3; field.structures![24] = createStructure(kind, 1);
    b.attackStructure(a.id, 24);
    const entry = b.log.find(e => e.structure)!;
    expect(entry.structure).toMatchObject({ kind, cell: 24, hpAfter: 0, destroyed: true });
    expect(roundDigest(b)).toContain(entry.text); expect(entry.text).toContain('形成突破口');
    expect(narrativeEvents(b).some(e => e.text === entry.text)).toBe(true);
    const { structure: _structure, ...legacy } = entry;
    expect(compactEvents([legacy])).toEqual([entry.text]);
  });

  it('控制生效、抵抗与免疫保留，同类效果未追加静默省略', () => {
    const { b, a, e } = scene();
    const success = cast(b, a, [{ op: 'condition', conditionId: 'stunned', dur: 2 }]);
    expect(success).toContain('乙 获得眩晕'); expect(success).not.toMatch(/持续|状态结算/);
    const effect = { op: 'condition' as const, conditionId: 'stunned', dur: 2, saveDC: 12 };
    const repeated = prepareCondition(a, e, effect, { seed: 'fixed', next: () => 1, d: () => 20 });
    expect(compactEvents([{ round: 1, kind: 'condition', text: repeated.text }])).toEqual([]);
    e.conditions = [];
    const resisted = prepareCondition(a, e, effect, { seed: 'fixed', next: () => 1, d: () => 20 });
    expect(compactEvents([{ round: 1, kind: 'ability', text: '甲 使用【控制】\n' + resisted.text }])).toEqual(['甲 使用【控制】', '乙 抵抗眩晕']);
    e.body = 'vehicle';
    const immune = prepareCondition(a, e, { op: 'condition', conditionId: 'poisoned', dur: 2 }, { seed: 'fixed', next: () => 0, d: () => 1 });
    expect(compactEvents([{ round: 1, kind: 'condition', text: immune.text }])).toEqual(['乙 免疫中毒']);
    expect(compactEvents([{ round: 1, kind: 'ability', text: '甲 使用【重推】\n乙：坚韧，不受击退或拉拽' }])).toEqual(['甲 使用【重推】', '乙 免疫击退或拉拽']);
  });

  it('屏障、击退、驱散、精力与区域的实际效果保留', () => {
    const cases: { effects: Ability['effects']; target?: Ability['target']; expected: string; prepare?: (u: Combatant) => void }[] = [
      { effects: [{ op: 'barrier', amount: 30, dur: 3 }], target: 'self', expected: '甲 获得屏障，可吸收30点伤害' },
      { effects: [{ op: 'push', force: 10, steps: 1, direction: 'away' }], expected: '乙：推至D3' },
      { effects: [{ op: 'dispel', polarity: 'positive', count: 1 }], expected: '乙 解除祝福', prepare: e => { e.conditions = [{ id: 'blessed', dur: 3 }]; } },
      { effects: [{ op: 'resource', resource: 'SP', amount: 2 }], target: 'self', expected: '甲 SP+2' },
      { effects: [{ op: 'zone', kind: 'smoke', power: 3, radius: 1, dur: 3 }], target: 'self', expected: '在D5布置烟幕' },
    ];
    for (const c of cases) {
      const { b, a, e } = scene(); c.prepare?.(e); const text = cast(b, a, c.effects, c.target);
      expect(text).toContain(c.expected); expect(text).not.toMatch(/持续\d|至多\d/);
    }
    expect(compactEvents([{ round: 1, kind: 'ability', text: '甲 使用【道具】\n消耗3件，剩余2件\n治疗20' }])).toEqual(['甲 使用【道具】', '消耗3件', '治疗20']);
    expect(compactEvents([{ round: 1, kind: 'ability', text: '甲 使用【道具】：消耗3件，剩余2件' }])).toEqual(['甲 使用【道具】：消耗3件']);
  });

  it('单次和技能伤害保留防护结果，合并速射累计耗盾且区分部分未穿透', () => {
    const first = shot({ energyAbsorbed: 10.4, energySpent: .9, barrierAbsorbed: 20, penetrationFactor: 0, shieldBroken: true, ammunition: 'he' });
    const line = compactEvents([first])[0]!;
    for (const text of ['能量盾吸收10.4（耗盾0.9）', '屏障吸收20', '未穿透', '盾牌碎裂']) expect(line).toContain(text);
    expect(line).not.toMatch(/榴弹|穿甲弹/);
    const skill = { ...first, kind: 'ability' as const, text: '甲 使用【打击】\n' + first.text };
    expect(compactEvents([skill]).at(-1)).toContain('屏障吸收20，未穿透，盾牌碎裂');
    const volley = compactEvents([first, shot({ energyAbsorbed: 2, energySpent: .3, barrierAbsorbed: 3, energyOverloaded: 1 })])[0]!;
    for (const text of ['2段/2中', '能量盾吸收12.4（耗盾1.2）', '屏障吸收23', '其中1段未穿透', '能量盾过载', '盾牌碎裂']) expect(volley).toContain(text);
  });

  it('结束状态包含第三方；城防只简报受损、摧毁和门状态，完整墙段省略', () => {
    const { b, field } = scene(true);
    field.structures![0] = createStructure('wall', 1); field.structures![1] = createStructure('wall', 1);
    field.structures![2] = createStructure('wall', 1); damageStructure(field, 2, 20);
    field.structures![3] = createStructure('gate', 1, { gateState: 'open' });
    field.structures![4] = createStructure('building', 1); damageStructure(field, 4, 999);
    b.finishBattle('ceasefire');
    const facts = fieldFacts(b).join('\n');
    for (const text of ['城墙受损1处（C1）', '城门打开1处（D1）', '建筑已毁1处（E1）']) expect(facts).toContain(text);
    expect(facts).not.toMatch(/完好|A1|B1|耐久/);
    expect(smallStateSummary(b)).toContain('第三方：丙'); expect(roundDigest(b)).toContain('第三方：丙');
    expect(battleEpilogue(b)).toContain(facts);
  });

  it.each(['small', 'mass'] as const)('%s状态、临时能力、屏障和区域消失时记录一次，状态摘要不列时长', mode => {
    const { b: small, a, e } = scene();
    const b = mode === 'small' ? small : new MassBattle({ combatants: [a, e], rules: V2_TW, formationSlots: 3, seed: 'report-expiry' });
    if (b instanceof MassBattle) b.start();
    a.conditions.push({ id: 'empowered', dur: 1 }); grantBarrier(a, 30, 1);
    grantTraitSource(a, { id: 'temporary', name: '临时再生', kind: 'blessing', traitIds: ['regen'], duration: { kind: 'rounds', count: 1 } });
    placeZone(b.observationContext(), a, a, { op: 'zone', kind: 'smoke', power: 3, radius: 1, dur: 1 }, b.round, 'smoke');
    for (let i = 0; i < 3; i++) {
      if (b instanceof SmallBattle) { b.endTurn(); b.endTurn(); }
      else { b.issue({ unitId: a.id, type: 'hold' }); b.issue({ unitId: e.id, type: 'hold' }); b.resolveRound(); }
    }
    const events = compactEvents(b.log);
    for (const text of ['甲 状态结束：强击', '甲 状态结束：再生', '甲 屏障消失']) expect(events.filter(e => e === text)).toHaveLength(1);
    expect(events.filter(e => e.endsWith('烟幕消失'))).toHaveLength(1);
    a.conditions.push({ id: 'empowered', dur: 7 });
    if (b instanceof SmallBattle) expect(smallStateSummary(b, undefined, undefined, { includeRecent: false })).not.toContain('7轮');
    expect(battleEpilogue(b)).not.toContain('7轮');
  });

  it('逐轮战报继续省略规则切换、未定位受击和装填攻击行', () => {
    const { b } = scene(); b.setNonLethal(true);
    b.log.push({ round: 1, kind: 'attack', observedBy: ['ally'], text: '甲 受到未定位攻击，损失20' },
      { round: 1, kind: 'attack', observedBy: ['ally'], text: '甲 装填中' });
    const text = roundDigest(b);
    expect(text).not.toMatch(/改为非致命|受到未定位攻击|甲 装填中/);
  });
});
