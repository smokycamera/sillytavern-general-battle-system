import { describe, expect, it } from 'vitest';
import {
  generateUnit, traitRegistry, standardConditionMap, V14_OVERFLOW_D20, V15_OVERFLOW_D20, V16_OVERFLOW_D20, V16_OVERFLOW_TW,
  prepareTraitModel, prepareItemModel, prepareTraitLevelModel, prepareCombatModel, activeTraitIds, traitLevel, traitLevelSources,
  grantTraitSource, expireTraitSources, revokeTraitSource, traitPenetrationBonus, traitStatAdjustments, normalizeBakedTraitStats,
  collectMods, resolveStack, fatigueAfter, defensivePostureMods, bracePose, lifestealRecovery, applyHealthLoss, situationalTraitMods,
  moraleProfile, traitLadderSummary, compileItem, gearItem, validateItemValue, traitPoints, narrativeTraitList, narrativeTraitLevel,
  applySkillTrait, skillTraitReason, skillTraitGrant, skillEffectValue, skillEffectLines, entrench, SmallBattle, MassBattle, standardField,
  previewAttack, resolveAttack, SeededRng, applyXp, traitLevelToken, type Combatant, type GenerateInput, type Ability, type RulePack, type ObservationContext,
} from '../src/index.js';
import { actionPotential } from '../src/skill-tactics.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';

const registry = traitRegistry(), defs = standardConditionMap();
function unit(id: string, extra: Partial<GenerateInput> = {}, rules = V16_OVERFLOW_D20): Combatant {
  const u = generateUnit({ name: id, side: id.startsWith('e') ? 'enemy' : 'ally', scale: 'hero', level: 4, rulesVersion: 'v2', damageModel: 'wounds-v2',
    weaponClass: 'sword', weaponLevel: 5, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, rules); prepareTraitModel(u, rules); prepareItemModel(u, rules); prepareTraitLevelModel(u, rules); return u;
}
const source = (u: Combatant, id: string, trait: string, level: number | undefined, rounds: number) => grantTraitSource(u, {
  id, name: id, kind: 'blessing', traitIds: [trait], ...(level === undefined ? {} : { traitLevels: { [trait]: level } }), duration: { kind: 'rounds', count: rounds },
});
const stack = (u: Combatant, kind: 'atk' | 'dmg' | 'ward', ctx: Parameters<typeof collectMods>[1] = {}) => resolveStack(collectMods(u, ctx, defs, [], registry), kind, ctx);
const ability = (power: number): Ability => ({ id: 'grant', name: '授予', power, target: 'ally', effects: [{ op: 'trait', traitId: 'guardian', dur: 3 }] });
const effect = { op: 'trait' as const, traitId: 'guardian', dur: 3 };

describe('V16 来源、门控、持久化和临时授予', () => {
  it('按有效来源取最高；撤装备/撤祝福/到期回退，旧强别名不重复且保留期限', () => {
    const u = unit('a', { traits: ['guardian'], traitLevels: { guardian: 3 } });
    source(u, 'strong', 'guardian-greater', undefined, 1); source(u, 'long', 'guardian', 6, 3);
    expect(activeTraitIds(u).filter(id => id.startsWith('guardian'))).toEqual(['guardian']);
    expect(traitLevel(u, 'guardian')).toBe(8); expect(stack(u, 'ward').multTotal).toBeCloseTo(.6);
    expireTraitSources(u, 'rounds'); expect(traitLevel(u, 'guardian')).toBe(6);
    const value = compileItem({ kind: 'item', form: 'worn', power: 10, traits: [{ id: 'guardian', level: 10 }] }, { id: 'g', seed: 'g' });
    if (value.kind !== 'item') throw Error('fixture'); u.gear = [gearItem('g', '守护戒', value.value)];
    expect(traitLevel(u, 'guardian')).toBe(10); u.gear = []; revokeTraitSource(u, 'long'); expect(traitLevel(u, 'guardian')).toBe(3);
    expect(traitLevelSources(u, 'guardian')).toMatchObject([{ name: '本体', level: 3 }]);
  });
  it('装备来源失配不生效；自动步枪散兵仍为L5且不会被本体L1覆盖', () => {
    const u = unit('a', { scale: 'company', hpMax: 40, weaponClass: 'rifle', traits: ['loose-formation'] });
    u.traitLevels = { 'loose-formation': 1 }; // 预留解析能力，不开放 P2 的输入等级。
    expect(traitLevel(u, 'loose-formation')).toBe(5);
    grantTraitSource(u, { id: 'eq', name: '武器祝福', kind: 'equipment', equipmentId: u.weapon!.id, traitIds: ['guardian'], traitLevels: { guardian: 8 }, duration: { kind: 'permanent' } });
    expect(traitLevel(u, 'guardian')).toBe(8); delete u.weapon; expect(traitLevel(u, 'guardian')).toBe(0);
  });
  it('本体L3可获L8，短高长低可接续，同来源重放不续期', () => {
    const u = unit('a', { traits: ['guardian'], traitLevels: { guardian: 3 } }), a = ability(8);
    expect(skillTraitReason(u, effect, a)).toBeUndefined(); applySkillTrait(u, u, a, { ...effect, dur: 1 }, 'cast');
    expect(traitLevel(u, 'guardian')).toBe(8); expect(skillTraitReason(u, effect, ability(6))).toBeUndefined();
    applySkillTrait(u, u, ability(6), effect, 'long'); expireTraitSources(u, 'rounds');
    expect(traitLevel(u, 'guardian')).toBe(6); applySkillTrait(u, u, ability(8), { ...effect, dur: 1 }, 'cast');
    expect(u.traitSources!.find(s => s.id.includes('cast'))!.remaining).toBe(0);
    expireTraitSources(u, 'rounds'); expireTraitSources(u, 'rounds'); expect(traitLevel(u, 'guardian')).toBe(3);
    expect(u.traitLevels).toEqual({ guardian: 3 });
  });
  it('工事重建独立于等级去重，但相同施放id不能重复重建', () => {
    const u = unit('a', { traits: ['fortification'] }); u.pos = 20; entrench(u, 'small'); u.pos = 21;
    const e = { op: 'trait' as const, traitId: 'fortification', dur: 3 };
    expect(skillTraitReason(u, e, ability(5))).toBeUndefined(); applySkillTrait(u, u, ability(5), e, 'works'); expect(u.entrenchedAt).toBe(21);
    u.pos = 22; applySkillTrait(u, u, ability(5), e, 'works'); expect(u.entrenchedAt).toBe(21);
    applySkillTrait(u, u, ability(5), e, 'new-works'); expect(u.entrenchedAt).toBe(22);
  });
  it('AI按实际L8估值；短L8结束后的L6有正收益，查询不改变来源或随机数', () => {
    const u = unit('a', { traits: ['guardian'], traitLevels: { guardian: 3 } }), enemy = unit('e'); u.pos = 30; enemy.pos = 31;
    const field = standardField(); field.tiles.fill('open');
    const context: ObservationContext = { mode: 'small', fieldTags: [], units: [u, enemy], battlefield: field, rules: V16_OVERFLOW_D20, traitRegistry: registry, conditions: defs };
    source(u, 'short', 'guardian', 8, 1);
    const before = JSON.stringify(u); expect(skillTraitGrant(u, ability(6), effect)).toEqual({ id: 'guardian', level: 6 });
    expect(skillEffectValue(context, u, u, ability(6))).toBeGreaterThan(0);
    expect(skillEffectLines(context, u, u, ability(6)).join('')).toContain('守护L6'); expect(JSON.stringify(u)).toBe(before);
  });
  it.each(['small', 'mass'] as const)('%s快照和单位档案往返保留规则、来源及回退，旧快照清除V16门控', mode => {
    const u = unit('a', { traits: ['guardian'], traitLevels: { guardian: 3 } }), enemy = unit('e'); source(u, 's', 'guardian-greater', undefined, 2);
    const battle = mode === 'small' ? new SmallBattle({ combatants: [u, enemy], rules: V16_OVERFLOW_D20, seed: 'snap', traitRegistry: registry })
      : new MassBattle({ combatants: [u, enemy], rules: V16_OVERFLOW_TW, seed: 'snap', traitRegistry: registry });
    const snap = JSON.parse(JSON.stringify(battle.toSnapshot()));
    const restored = mode === 'small' ? SmallBattle.fromSnapshot(snap, { traitRegistry: registry }) : MassBattle.fromSnapshot(snap, { traitRegistry: registry });
    const saved = materializeUnitRecord(JSON.parse(JSON.stringify(unitRecordFromCombatant(restored.byId('a')))), registry);
    expect(traitLevel(saved, 'guardian')).toBe(8); expireTraitSources(saved, 'rounds'); expireTraitSources(saved, 'rounds'); expect(traitLevel(saved, 'guardian')).toBe(3);
    snap.rulesId = mode === 'small' ? 'v15-overflow-d20' : 'v15-overflow-tw';
    const old = mode === 'small' ? SmallBattle.fromSnapshot(snap, { traitRegistry: registry }) : MassBattle.fromSnapshot(snap, { traitRegistry: registry });
    expect(old.byId('a').traitLevelModel).toBeUndefined(); expect(activeTraitIds(old.byId('a'))).toContain('guardian-greater'); expect(stack(old.byId('a'), 'ward').multTotal).toBeCloseTo(.6);
  });
  it('旧规则忽略P1等级，五项专精仍只受V15门控；正文默认L1/别名合并/未完成分级均正确', () => {
    const old = unit('a', { traits: ['guardian', 'forest-lore'], traitLevels: { guardian: 10, 'forest-lore': 9 } }, V15_OVERFLOW_D20);
    expect(traitLevel(old, 'guardian')).toBe(5); expect(stack(old, 'ward').multTotal).toBeCloseTo(.75); expect(traitLevel(old, 'forest-lore')).toBe(9);
    prepareItemModel(old, V14_OVERFLOW_D20); expect(traitLevel(old, 'forest-lore')).toBe(5);
    expect(narrativeTraitList(['守护L3', '守护', '大守护', '守护L6'])).toEqual({ traits: ['guardian'], traitLevels: { guardian: 8 } });
    expect(narrativeTraitList(['守护L3', '守护'])).toEqual({ traits: ['guardian'], traitLevels: { guardian: 3 } });
    expect(narrativeTraitList(['守护'])).toEqual({ traits: ['guardian'], traitLevels: { guardian: 1 } });
    expect(narrativeTraitLevel('再生L10')).toMatchObject({ id: 'regen', level: 10 });
  });
  it('新生成/新祝福未标等级为L1，明确L5保留；历史缺省L5及同id重放不漂移', () => {
    const u = unit('a', { traits: ['guardian', 'forest-lore'] });
    expect(traitLevel(u, 'guardian')).toBe(1); expect(traitLevel(u, 'forest-lore')).toBe(1);
    source(u, 'new', 'lifesteal', undefined, 2); expect(traitLevel(u, 'lifesteal')).toBe(1);
    delete u.traitLevels; expect(traitLevel(u, 'guardian')).toBe(5); expect(traitLevel(u, 'forest-lore')).toBe(5);
    u.traitSources!.push({ id: 'old', name: 'old', kind: 'blessing', traitIds: ['stubborn'], duration: { kind: 'rounds', count: 3 }, remaining: 1 });
    source(u, 'old', 'stubborn', undefined, 3); expect(traitLevel(u, 'stubborn')).toBe(5); expect(u.traitSources!.find(s => s.id === 'old')!.remaining).toBe(1);
    expect(narrativeTraitList(['守护L5'])).toEqual({ traits: ['guardian'], traitLevels: { guardian: 5 } });
    expect(traitLevelToken('guardian')).toBe('guardianL5');
    expect(narrativeTraitLevel(traitLevelToken('guardian'))).toMatchObject({ level: 5 });
  });
});

describe('P1 执行器与旧锚点', () => {
  it('守护/克制的真实结算、预览和AI随等级变化，旧强名称与L8等价', () => {
    const a = unit('a', { traits: ['anti-infantry'], traitLevels: { 'anti-infantry': 10 } }), e = unit('e', { traits: ['guardian'], traitLevels: { guardian: 1 } });
    a.pos = 20; e.pos = 21;
    const opts = { attacker: a, defender: e, rules: V16_OVERFLOW_D20, conditionDefs: defs, traitRegistry: registry, distance: 1, ranged: false };
    const low = previewAttack(opts).expectedDamage;
    e.traitLevels!.guardian = 10; const high = previewAttack(opts).expectedDamage; expect(high).toBeLessThan(low);
    const context: ObservationContext = { mode: 'small', fieldTags: [], units: [a, e], rules: V16_OVERFLOW_D20, traitRegistry: registry, conditions: defs };
    const aiHigh = actionPotential(context, a, e); e.traitLevels!.guardian = 1;
    expect(actionPotential(context, a, e)).toBeGreaterThan(aiHigh); // 同一上下文也不能复用旧等级缓存。
    const resolve = (level: number) => { const d = structuredClone(e); d.traitLevels!.guardian = level; return resolveAttack({ ...opts, defender: d, rng: new SeededRng('p1-hit') }); };
    expect(resolve(10).finalDamage).toBeLessThanOrEqual(resolve(1).finalDamage);
    for (const [alias, id] of [['guardian-greater', 'guardian'], ['monster-hunter', 'anti-large'], ['ap-master', 'ap-weapon']]) {
      const x = unit('x', { traits: [alias!] }), y = unit('y', { traits: [id!], traitLevels: { [id!]: 8 } });
      expect(stack(x, 'ward').multTotal).toBeCloseTo(stack(y, 'ward').multTotal);
      expect(stack(x, 'dmg', { defender: unit('e-large', { body: 'large' }) }).multTotal).toBeCloseTo(stack(y, 'dmg', { defender: unit('e-large', { body: 'large' }) }).multTotal);
      expect(traitPenetrationBonus(x, x.weapon, false, 12)).toBe(traitPenetrationBonus(y, y.weapon, false, 12));
    }
  });
  it('破甲保留动能/整数武器上限，克制按真实目标取强且不会叠加旧新名称', () => {
    const u = unit('a', { traits: ['ap-weapon', 'anti-large', 'monster-hunter'], traitLevels: { 'ap-weapon': 10, 'anti-large': 3 } });
    expect(traitPenetrationBonus(u, u.weapon, false, 3)).toBe(1); expect(traitPenetrationBonus(u, u.weapon, false, 12)).toBe(2.5);
    expect(traitPenetrationBonus(u, { ...u.weapon!, channel: 'arcane' }, false, 12)).toBe(0);
    const large = unit('e', { body: 'large' }), foot = unit('e-foot');
    expect(stack(u, 'atk', { defender: large }).flatTotal).toBe(3); expect(stack(u, 'dmg', { defender: large }).multTotal).toBe(1.4);
    expect(stack(u, 'dmg', { defender: foot }).multTotal).toBe(1);
  });
  it('盾墙等级只影响实际持盾、正面固守远程，践踏只影响冲锋更小身体', () => {
    const u = unit('a', { traits: ['shield-wall'], traitLevels: { 'shield-wall': 10 }, shield: true }), enemy = unit('e');
    u.pos = 30; enemy.pos = 23; u.tacticalPose = bracePose(u, enemy, 'small', 7);
    expect(defensivePostureMods(u, { defender: enemy, ranged: true }, defs).find(m => m.kind === 'ward')?.value).toBeCloseTo(.45);
    expect(defensivePostureMods(u, { defender: enemy, ranged: false }, defs).some(m => m.kind === 'ward')).toBe(false);
    delete u.shield; expect(defensivePostureMods(u, { defender: enemy, ranged: true }, defs).some(m => m.kind === 'ward')).toBe(false);
    const big = unit('big', { body: 'large', traits: ['trample'], traitLevels: { trample: 10 } });
    expect(stack(big, 'dmg', { defender: enemy, charge: true }).multTotal).toBe(1.4);
    expect(stack(big, 'dmg', { defender: enemy }).multTotal).toBe(1);
    expect(stack(big, 'dmg', { defender: big, charge: true }).multTotal).toBe(1);
  });
  it('偷袭魔法例外、疲劳只改获得、吸血受实际伤口/伤兵和目标限制', () => {
    const u = unit('a', { traits: ['sneak-attack', 'fatigue-trained', 'lifesteal'], traitLevels: { 'sneak-attack': 10, 'fatigue-trained': 10, lifesteal: 10 } }), e = unit('e');
    const context: ObservationContext = { mode: 'small', fieldTags: [], units: [u, e] }, input = { ambush: true, flanked: () => false, ranged: false, magic: false };
    expect(situationalTraitMods(context, u, e, input)[0]!.value).toBe(1.75); expect(situationalTraitMods(context, u, e, { ...input, magic: true })).toEqual([]);
    u.fatigue = 2; expect(fatigueAfter(u, 2)).toBeCloseTo(2.35); expect(fatigueAfter(u, 0)).toBe(1);
    applyHealthLoss(u, 20); expect(lifestealRecovery(u, e, 20)).toBe(8); expect(lifestealRecovery(u, e, 10000)).toBe(12);
    applyHealthLoss(u, 10); e.traits.push('inorganic'); expect(lifestealRecovery(u, e, 100)).toBe(0);
  });
  it('顽固净修正不双烘焙、不烘焙临时高等级；统率仍受半径、视线、同组取强', () => {
    const u = unit('a', { scale: 'company', hpMax: 30, traits: ['stubborn'], traitLevels: { stubborn: 3 } }), c = unit('commander', { traits: ['commander'], traitLevels: { commander: 10 } });
    const oldMax = u.base.moraleMax!; expect(traitStatAdjustments(u).morale).toBe(-6);
    source(u, 'high', 'stubborn', 10, 1); expect(traitStatAdjustments(u).morale).toBe(10);
    normalizeBakedTraitStats(u); expect(u.base.moraleMax).toBe(oldMax - 6); expect(traitStatAdjustments(u).morale).toBe(16);
    normalizeBakedTraitStats(u); expect(u.base.moraleMax).toBe(oldMax - 6);
    applyXp(u, 100000, registry); expect(u.bakedTraitStats?.morale).toBe(9); expect(traitStatAdjustments(u).morale).toBe(16);
    expireTraitSources(u, 'rounds'); expect(traitStatAdjustments(u)).toEqual({});
    u.pos = 20; c.pos = 21;
    const context: ObservationContext = { mode: 'small', fieldTags: [], units: [u, c] };
    expect(moraleProfile(context, u).command).toBe(20); expect(moraleProfile(context, u).resilience).toBe(9);
    c.pos = 25; expect(moraleProfile({ ...context }, u).command).toBe(0);
    expect(traitLadderSummary('guardian', 9)).toContain('42.5%');
  });
  it('新价格保留L5/L8锚点；旧配方按历史预算和布尔授予校验，不读档重编译', () => {
    expect(traitPoints({ id: 'guardian', level: 5 }, 5)).toBe(3); expect(traitPoints({ id: 'guardian', level: 8 }, 8)).toBe(6);
    expect(traitPoints({ id: 'ap-weapon', level: 8 }, 8)).toBe(6); expect(traitPoints({ id: 'anti-large', level: 8 }, 8)).toBe(3);
    expect(traitPoints({ id: 'regen' }, 5)).toBe(6); expect(traitPoints({ id: 'forest-lore', level: 8 }, 8)).toBe(4);
    const frozen = { recipe: { version: 'items-v1', form: 'worn', power: 3, seed: 'old', traits: [{ id: 'guardian-greater' }] }, passive: { traits: [{ id: 'guardian-greater' }] } };
    // 合法旧强版本预算是6，普通守护旧预算3且不能自动获得道具L3。
    frozen.recipe.power = 6; expect(() => validateItemValue(frozen)).not.toThrow();
    const old = { recipe: { version: 'items-v1', form: 'worn', power: 3, seed: 'old', traits: [{ id: 'guardian' }] }, passive: { traits: [{ id: 'guardian' }] } };
    expect(() => validateItemValue(old)).not.toThrow();
    const u = unit('a'); u.gear = [gearItem('old', '旧守护', old as Parameters<typeof gearItem>[2])]; expect(traitLevel(u, 'guardian')).toBe(5);
  });
});
