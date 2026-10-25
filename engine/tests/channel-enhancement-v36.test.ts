import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, prepareSkillModel, prepareTraitLevelModel, upgradeCombatSkills,
  compileItem, gearItem, traitRegistry, standardConditionMap, skillAttack, previewAttack, resolveAttack, grantBarrier,
  V35_OVERFLOW_D20, V36_OVERFLOW_D20, type Combatant, type AttackOpts, type GenerateInput } from '../src/index.js';
import { parseSkillMechanism, skillMechanismId } from '../src/data/skill-mechanisms.js';
import { prepareCondition, applySkillCondition, dispelCandidates, applyDispel, skillConditionDescription } from '../src/skill-effects.js';
import { additionalChannelBudgets } from '../src/additional-channels.js';
import { trainingDamage } from '../src/enhancements.js';

const registry = traitRegistry(), rules = V36_OVERFLOW_D20;
function actor(id: string, extra: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', level: 5, hpMax: 500,
    rulesVersion: 'v2', damageModel: 'wounds-v2', numericModel: 'graded-v1', weaponClass: 'sword', weaponLevel: 5,
    armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true, skillModel: 'skills-v4' }).unit;
  u.id = id; prepareCombatModel(u, rules); prepareArmsModel(u, rules); prepareSkillModel(u, rules); prepareTraitLevelModel(u, rules); upgradeCombatSkills(u); return u;
}
function options(a: Combatant, d: Combatant): Omit<AttackOpts, 'rng'> {
  const ability = a.abilities[0], effect = ability?.effects.find(e => e.op === 'damage');
  return { attacker: a, defender: d, rules, traitRegistry: registry, conditionDefs: standardConditionMap(), distance: 1,
    ...(effect?.op === 'damage' ? skillAttack({ mode: 'small', units: [a, d], fieldTags: [] }, a, d, ability!, effect, rules) : {}) };
}
const dice = () => { const rolls: number[] = []; return { rolls, rng: { seed: 'channels', next: () => .5, d: (sides: number) => { rolls.push(sides); return sides === 20 ? 18 : Math.max(1, Math.floor((sides + 1) / 2)); } } }; };

describe('V36 additional damage channels', () => {
  it.each(['unit', 'weapon', 'skill', 'worn'] as const)('%s channel damage adds actual damage without extra attack or damage rolls', source => {
    const a = actor('a', source === 'unit' ? { bonuses: { thermalDamage: 5 } } : source === 'weapon' ? { weaponBonuses: { thermalDamage: 5 } }
      : source === 'skill' ? { abilityBlueprints: [{ id: 'generic:physical-single:melee', level: 5, bonuses: { thermalDamage: 5 } }] } : {}), d = actor('d');
    if (source === 'worn') { const m = compileItem({ kind: 'item', form: 'worn', power: 5, bonuses: { thermalDamage: 5 } }, { id: 'heat', seed: 'heat' }); if (m.kind !== 'item') throw Error('fixture'); a.gear = [gearItem('heat', '火焰戒指', m.value)]; }
    const opts = options(a, d), before = structuredClone(a), preview = previewAttack(opts), old = previewAttack({ ...opts, rules: V35_OVERFLOW_D20 });
    expect(preview.expectedDamage).toBeGreaterThan(old.expectedDamage); expect(a).toEqual(before);
    const current = dice(), legacy = dice();
    const result = resolveAttack({ ...opts, defender: structuredClone(d), rng: current.rng });
    resolveAttack({ ...opts, rules: V35_OVERFLOW_D20, defender: structuredClone(d), rng: legacy.rng });
    expect(current.rolls).toEqual(legacy.rolls);
    expect(result.damageChannels?.find(p => p.channel === 'thermal')?.damage).toBeGreaterThan(0);
    expect(result.damageChannels!.reduce((sum,p) => sum + p.damage,0)).toBe(result.finalDamage);
  });

  it('applies each channel protection separately even when the original channel cannot penetrate', () => {
    const a = actor('a', { bonuses: { thermalDamage: 10, arcaneDamage: 10 } }), d = actor('d');
    d.armor = { ...d.armor!, tier: 3, protectionOverride: true, protection: { kinetic: 100, thermal: 0, arcane: 100 } };
    const opts = options(a,d), result = resolveAttack({ ...opts, rng: dice().rng });
    expect(result.damageChannels?.find(p => p.channel === 'kinetic')?.damage).toBe(0);
    expect(result.damageChannels?.find(p => p.channel === 'thermal')?.damage).toBeGreaterThan(0);
    expect(previewAttack(options(a,actor('d'))).expectedDamage).toBeGreaterThan(0);
  });

  it('does not add a second copy of the primary channel, and negative off-channel bonuses add no damage', () => {
    const a = actor('a', { abilityBlueprints: [{ id: 'generic:magic-single:thermal', level: 5, bonuses: { thermalDamage: 5 } }] }), d = actor('d');
    const opts = options(a,d);
    expect(previewAttack(opts)).toEqual(previewAttack({ ...opts, rules: V35_OVERFLOW_D20 }));
    a.abilities = []; a.bonuses = { thermalDamage: -5 };
    expect(resolveAttack({ ...options(a,d), rng: dice().rng }).damageChannels).toBeUndefined();
    a.bonuses=undefined;
    const m=compileItem({kind:'item',form:'worn',power:5,bonuses:{damage:5}},{id:'general',seed:'general'});if(m.kind!=='item')throw Error('fixture');
    a.gear=[gearItem('general','强攻戒指',m.value)];
    expect(additionalChannelBudgets(options(a,d),a.weapon)).toEqual([]);
    a.bonuses={thermalDamage:5};const equipped=additionalChannelBudgets(options(a,d),a.weapon)[0]!.scale;
    a.gear=[];expect(equipped/additionalChannelBudgets(options(a,d),a.weapon)[0]!.scale).toBeCloseTo(1.335);
  });

  it('shares a barrier across all components and keeps preview read-only', () => {
    const a = actor('a', { bonuses: { thermalDamage: 10, arcaneDamage: 10 } }), d = actor('d'); grantBarrier(d, 200, 3);
    const opts = options(a,d), before = structuredClone(d); previewAttack(opts); expect(d).toEqual(before);
    const result = resolveAttack({ ...opts, rng: dice().rng });
    expect(result.finalDamage).toBe(0); expect(result.barrierAbsorbed).toBeGreaterThan(0);
    expect(result.damageChannels!.every(p => p.damage === 0)).toBe(true);
  });
  it('non-overflow components stay on the same exposed members instead of selecting a new victim', () => {
    const a=actor('a',{abilityBlueprints:[{id:'generic:magic-single:arcane',level:5,bonuses:{thermalDamage:10}}]}),d=actor('d',{scale:'company',hpMax:3});
    d.formation!.memberHp=10;d.formation!.health=[{hp:10,count:3}];
    const opts={...options(a,d),rules:{...rules,weaponOverflow:false}};
    const result=resolveAttack({...opts,rng:dice().rng});
    expect(d.hp).toBe(2);expect(result.finalDamage).toBe(10);
    expect(result.damageChannels!.reduce((sum,p)=>sum+p.damage,0)).toBe(10);
  });
  it.each(['动能','热能','奥术'] as const)('%s buff matches existing buff strength and applies only to its damage channel', name => {
    const channel = {动能:'kinetic',热能:'thermal',奥术:'arcane'}[name] as 'kinetic'|'thermal'|'arcane';
    const caster=actor('a',{abilityBlueprints:[{id:skillMechanismId(parseSkillMechanism('buff'+name+'伤害')!),level:5}]}), a=actor('a'), d=actor('d');
    const effect=caster.abilities[0]!.effects[0]!; if(effect.op!=='condition')throw Error('fixture');
    const baseline=previewAttack(options(a,d));
    applySkillCondition(a,prepareCondition(caster,a,effect,dice().rng).condition);
    const result=resolveAttack({...options(a,d),rng:dice().rng});
    expect(previewAttack(options(a,d)).expectedDamage).toBeGreaterThan(baseline.expectedDamage);
    expect(channel==='kinetic'?result.dmgMult:result.damageChannels!.find(p=>p.channel===channel)!.damage).toBeGreaterThan(channel==='kinetic'?1:0);
    expect(skillConditionDescription(effect,a)).toContain(name);
    const frozen=JSON.parse(JSON.stringify(a)); expect(previewAttack(options(frozen,d))).toEqual(previewAttack(options(a,d)));
    const chosen=dispelCandidates(a,{op:'dispel',polarity:'positive',count:1});expect(chosen).toHaveLength(1);applyDispel(a,chosen);
    expect(previewAttack(options(a,d))).toEqual(baseline);
    applySkillCondition(d,{id:channel+'-defense-up',dur:3,magnitude:1});
    const defended=previewAttack({...options(a,d),abilityDamage:{baseDice:'1d6',channel,penetration:12}});
    d.conditions=[];const unbuffed=previewAttack({...options(a,d),abilityDamage:{baseDice:'1d6',channel,penetration:12}});
    expect(defended.hitChance).toBeLessThan(unbuffed.hitChance);
    const other=channel==='arcane'?'thermal':'arcane';
    const without=previewAttack({...options(a,d),abilityDamage:{baseDice:'1d6',channel:other,penetration:12}});
    applySkillCondition(d,{id:channel+'-defense-up',dur:3,magnitude:1});
    expect(previewAttack({...options(a,d),abilityDamage:{baseDice:'1d6',channel:other,penetration:12}})).toEqual(without);
    a.conditions=[{id:channel+'-damage-up',dur:0,magnitude:2}];expect(previewAttack(options(a,actor('d')))).toEqual(previewAttack(options(actor('a'),actor('d'))));
  });
  it('channel buff aliases, per-effect levels and high-grade channel modifiers retain the existing anchors and caps', () => {
    expect(skillMechanismId(parseSkillMechanism('buff物理防御+奥数伤害')!)).toBe(skillMechanismId(parseSkillMechanism('buff动能防御+奥术伤害')!));
    const b=actor('a',{abilityBlueprints:[{id:skillMechanismId(parseSkillMechanism('buff热能防御L3+热能伤害L8')!),level:5}]});
    expect(b.abilities[0]!.effects).toEqual(expect.arrayContaining([expect.objectContaining({conditionId:'thermal-defense-up',dur:3}),expect.objectContaining({conditionId:'thermal-damage-up',dur:8})]));
    const a=actor('a',{level:10,bonuses:{thermalDamage:10}}),d=actor('d');
    const base=actor('a',{level:10});
    const budget=additionalChannelBudgets(options(a,d),a.weapon)[0]!;
    const r=resolveAttack({...options(base,d),rng:dice().rng});
    expect(budget.scale).toBeCloseTo((a.weapon!.damageScale??1)*trainingDamage(10,rules)*.95);
    expect(r.finalDamage).toBeGreaterThan(0);
  });
});
