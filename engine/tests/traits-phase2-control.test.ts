import { describe, expect, it } from 'vitest';
import { generateUnit, V17_OVERFLOW_D20, V17_OVERFLOW_TW, prepareTraitLevelModel, prepareTraitModel, prepareCombatModel,
  prepareItemModel, SmallBattle, MassBattle, standardField, canSpot, SeededRng, prepareCondition, applySkillCondition,
  beginControlActivation, finishControlActivation, controlActionReason, combatHostile, attackHostile, combatSide, breakCharmOnDamage,
  reconcileBattleControls, controlReactionAllowed, skillEffectValue, compileSkill, skillMechanismId, parseSkillMechanism, conditionChance, collectMods, resolveStack,
  type Combatant, type ObservationContext, type Rng,
} from '../src/index.js';

function unit(id: string, side: 'ally' | 'enemy' = 'ally', company = false): Combatant {
  const u = generateUnit({ name: id, side, scale: company ? 'company' : 'hero', level: 5, hpMax: company ? 50 : 1000, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [], weaponClass: 'sword', weaponLevel: 3, armorTier: 0 }, { seed: id, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, V17_OVERFLOW_D20); prepareItemModel(u, V17_OVERFLOW_D20); prepareTraitModel(u, V17_OVERFLOW_D20); prepareTraitLevelModel(u, V17_OVERFLOW_D20); return u;
}
const rng = () => new SeededRng('controls');
const forced = { d: () => 1 } as unknown as Rng;

describe('P2-D/E 控制生命周期与临时战斗关系', () => {
  it.each(['群体魅惑', '范围+魅惑', 'debuff范围+魅惑', '群体魔法+魅惑', '魔法范围+魅惑', '魔法单体+扇形+魅惑'])('范围魅惑合法且与单体使用相同DC：%s', (text) => {
    const mechanism = parseSkillMechanism(text);
    expect(mechanism).toBeDefined();
    const ability = compileSkill({ id: skillMechanismId(mechanism!) }, 5, 'caster', 'skills-v2');
    expect(ability.area?.maxTargets).toBe(3);
    expect(ability.effects.find(e => e.op === 'condition')).toMatchObject({ conditionId: 'charmed', saveDC: 13, dur: 1, shape: 'burst' });
    if (mechanism!.category.startsWith('magic')) {
      expect(ability.effects.some(e => e.op === 'damage')).toBe(true);
      expect(ability.effects.find(e => e.op === 'condition')).toMatchObject({ onHit: true });
    }
  });
  it('范围与单体魅惑逐目标使用相同的一次抵抗判定', () => {
    const caster = unit('caster'), target = unit('target', 'enemy');
    const single = compileSkill({ id: skillMechanismId(parseSkillMechanism('debuff+魅惑')!) }, 5, caster.id, 'skills-v2').effects.find(e => e.op === 'condition')!;
    const area = compileSkill({ id: skillMechanismId(parseSkillMechanism('群体魅惑')!) }, 5, caster.id, 'skills-v2').effects.find(e => e.op === 'condition')!;
    expect(conditionChance(target, area)).toBe(conditionChance(target, single));
    for (const [roll, succeeds] of [[1, true], [20, false]] as const) {
      for (const effect of [single, JSON.parse(JSON.stringify(area)) as typeof area]) {
        let calls = 0;
        const random = { d: () => { calls++; return roll; } } as unknown as Rng;
        expect(!!prepareCondition(caster, target, effect, random).condition).toBe(succeeds);
        expect(calls).toBe(1);
      }
    }
  });
  it('控制AI按实际行动变化估值，魅惑与混乱查询不修改状态或重掷决定', () => {
    const a=unit('a'), friend=unit('friend'), caster=unit('e','enemy');a.pos=30;friend.pos=31;caster.pos=23;
    const field=standardField();field.tiles.fill('open');
    const ctx:ObservationContext={mode:'small',units:[a,friend,caster],battlefield:field,fieldTags:[],rules:V17_OVERFLOW_D20};
    const before=JSON.stringify(ctx.units);
    for(const word of ['魅惑','混乱']) {
      const ability=compileSkill({id:skillMechanismId(parseSkillMechanism('debuff+'+word)!)},8,caster.id,'skills-v2');
      const value=skillEffectValue(ctx,caster,a,ability);expect(value).toBeGreaterThan(0);
      expect(skillEffectValue(ctx,caster,a,ability)).toBe(value);
    }
    expect(JSON.stringify(ctx.units)).toBe(before);
  });
  it.each(['small','mass'] as const)('%s嘲讽允许实际覆盖施加者的范围技能，范围外施放被拒绝', mode => {
    const a=unit('a'), caster=unit('caster','enemy'), other=unit('other','enemy');
    const ability=compileSkill({id:skillMechanismId(parseSkillMechanism('debuff+虚弱')!)},3,a.id,'skills-v2');
    ability.area={shape:'circle',radius:1,maxTargets:3}; ability.shape='burst';
    a.abilities=[ability]; a.preparedAbilityIds=[ability.id]; a.resources.SP=20;
    const field=standardField(); field.tiles.fill('open');
    const b=mode==='small'?new SmallBattle({combatants:[a,caster,other],battlefield:field,rules:V17_OVERFLOW_D20,seed:'area-control'}):new MassBattle({combatants:[a,caster,other],rules:V17_OVERFLOW_TW,formationSlots:3,seed:'area-control'});
    b.start(); a.conditions=[{id:'taunted',dur:1,sourceId:caster.id}];
    if(b instanceof SmallBattle) {
      a.pos=30;other.pos=23;caster.pos=60;
      expect(b.useAbility(a.id,ability.id,other.id,{bypassTurn:true}).reason).toContain('必须指向');
      caster.pos=24;expect(b.useAbility(a.id,ability.id,other.id,{bypassTurn:true}).reason).toBeUndefined();
    } else {
      a.formationPosition='ally:中军:front';other.formationPosition='enemy:中军:front';caster.formationPosition='enemy:左翼:front';
      expect(b.issue({unitId:a.id,type:'ability',abilityId:ability.id,targetId:other.id}).reason).toBeUndefined();
      b.orders.delete(a.id);caster.formationPosition='enemy:右翼:reserve';
      expect(b.issue({unitId:a.id,type:'ability',abilityId:ability.id,targetId:other.id}).reason).toContain('必须指向');
    }
  });
  it('反应攻击遵守嘲讽和本次混乱决定，待激活魅惑也能因施术方伤害解除', () => {
    const a=unit('a'), caster=unit('e','enemy'), other=unit('other','enemy');
    a.conditions=[{id:'taunted',dur:1,sourceId:caster.id}];
    expect(controlReactionAllowed(a,other,[a,caster,other],1)).toBe(false);
    expect(controlReactionAllowed(a,caster,[a,caster,other],1)).toBe(true);
    a.conditions=[{id:'confused',dur:1}];a.controlActivation={sequence:1,targetId:caster.id};
    expect(controlReactionAllowed(a,other,[a,caster,other],1)).toBe(false);
    a.conditions=[{id:'charmed',dur:1,sourceId:caster.id,controlPending:true,controlSide:'enemy'}];
    breakCharmOnDamage([a,caster,other],a,other,1);expect(a.conditions).toEqual([]);
  });
  it('会战魅惑AI按临时关系选择原友军，混乱也可执行原友军普通攻击', () => {
    const a=unit('a'), friend=unit('friend'), caster=unit('e','enemy');
    const b=new MassBattle({combatants:[a,friend,caster],rules:V17_OVERFLOW_TW,formationSlots:3,seed:'relations'});b.start();
    a.conditions=[{id:'charmed',dur:1,sourceId:caster.id,controlSide:'enemy'}];
    expect(b.recommendedOrder(a.id)?.targetId).toBe(friend.id);
    a.conditions=[{id:'confused',dur:1}];a.controlActivation={sequence:1,targetId:friend.id};
    expect(b.issue({unitId:a.id,type:'attack',targetId:friend.id}).ok).toBe(true);
    expect(a.side).toBe('ally');
  });
  it('四类控制每级提高实际抵抗失败概率，固定正常激活次数和独立预算', () => {
    const u = unit('a');
    for (const [word, id, duration, sp, cd] of [['嘲讽','taunted',1,3,2], ['致盲','blinded',2,4,3], ['混乱','confused',1,5,3], ['魅惑','charmed',1,6,4]] as const) {
      let chance = -1;
      for (let L = 1; L <= 10; L++) {
        const a = compileSkill({ id: skillMechanismId(parseSkillMechanism('debuff+' + word)!) }, L, 'caster', 'skills-v2');
        expect(a.cost!.amount).toBe(sp); expect(a.cooldown).toBe(cd);
        const effect = a.effects[0]!; if (effect.op !== 'condition') throw Error('fixture');
        expect(effect).toMatchObject({ conditionId: id, dur: duration, saveDC: 8 + L, magnitude: 1 });
        const current = conditionChance(u, effect); expect(current).toBeGreaterThan(chance); chance = current;
      }
    }
  });
  it('待激活控制不在会战当前轮消耗；加速不消费第二次；压过的控制照常到期', () => {
    const u = unit('a'), caster = unit('e', 'enemy');
    for (const id of ['taunted','confused','blinded']) applySkillCondition(u, prepareCondition(caster, u, { op: 'condition', conditionId: id, dur: id === 'blinded' ? 2 : 1, saveDC: 18 }, forced).condition);
    finishControlActivation(u); expect(u.conditions.map(c => c.dur)).toEqual([1,1,2]);
    let calls = 0; const random = { d: () => { calls++; return 1; } } as unknown as Rng;
    beginControlActivation(u, random, () => ['friend','enemy']); expect(calls).toBe(1);
    expect(u.controlActivation?.targetId).toBe('enemy'); const saved = JSON.stringify(u);
    controlActionReason(u, caster, [u, caster], 'weapon'); expect(JSON.stringify(u)).toBe(saved); expect(calls).toBe(1);
    finishControlActivation(u); expect(u.conditions.map(c => c.id)).toEqual(['blinded']); expect(u.conditions[0]!.dur).toBe(1);
  });
  it('致盲优先于夜视、共享视野和反隐，属性负面同组取强', () => {
    const u = unit('a'), foe = unit('e','enemy'); u.pos = 0; foe.pos = 2; u.traits = ['recon','night-fighter']; u.traitLevels = { recon: 10, 'night-fighter': 10 };
    u.conditions = [{ id: 'blinded', dur: 2 }, { id: 'inaccurate', dur: 2 }, { id: 'exposed', dur: 2 }];
    const ctx: ObservationContext = { mode: 'small', units: [u,foe], fieldTags: ['night'], rules: V17_OVERFLOW_D20 };
    expect(canSpot(ctx,u,foe)).toBe(false); foe.pos = 1; expect(canSpot(ctx,u,foe)).toBe(true);
    foe.traits = ['stalk']; expect(canSpot(ctx,u,foe)).toBe(false);
    const mods = collectMods(u, {}, new Map((awaitlessConditions())), []);
    expect(resolveStack(mods, 'atk', {}).flatTotal).toBe(-4); expect(resolveStack(mods, 'def', {}).flatTotal).toBe(-2);
  });
  it('嘲讽允许自救；施加者隐藏不泄漏位置、不允许换人进攻；来源死亡解除', () => {
    const u = unit('a'), caster = unit('e','enemy'), other = unit('other','enemy'); u.conditions = [{ id:'taunted',dur:1,sourceId:caster.id }];
    expect(controlActionReason(u,other,[u,other], 'weapon')).toContain('必须指向');
    expect(controlActionReason(u,u,[u,caster], 'skill',true)).toBeUndefined();
    caster.status = 'dead'; reconcileBattleControls([u,caster,other]); expect(u.conditions).toEqual([]);
  });
  it('两个混乱单位可互攻，真实side与结束判定保留；决定跨快照不重掷', () => {
    const a = unit('a'), b = unit('b'), e = unit('e','enemy'); a.conditions = [{ id:'confused',dur:1 }]; b.conditions = [{ id:'confused',dur:1 }];
    const field = standardField(); field.tiles.fill('open'); const battle = new SmallBattle({ combatants:[a,b,e], battlefield:field, rules:V17_OVERFLOW_D20, seed:'chaos' }); battle.start();
    a.pos = 30; b.pos = 31; e.pos = 60; beginControlActivation(a, forced, () => ['b']);
    expect(attackHostile(a,b,[a,b,e])).toBe(true); expect(combatHostile(a,b,[a,b,e])).toBe(false); expect(a.side).toBe('ally');
    const before = JSON.stringify(battle.toSnapshot()), restored = SmallBattle.fromSnapshot(JSON.parse(before));
    expect(restored.getActionOptions(a.id).find(o=>o.kind==='weapon')?.targets?.some(t=>t.targetId==='b')).toBe(true); expect(restored.byId('a').controlActivation).toEqual(a.controlActivation);
    expect(restored.isOver()).toBe(false);
    while (battle.active?.id !== 'a') battle.endTurn();
    beginControlActivation(a, forced, () => ['b']); const hp = b.hp; battle.autoAction('a'); expect(b.hp).toBeLessThan(hp);
  });
  it('魅惑不改原side/位置/归属，同盟生命伤害才解除，非生物无扩大免疫', () => {
    const u = unit('a'), caster = unit('e','enemy'), originalFriend = unit('f'); u.pos = 4;
    u.conditions = [{ id:'charmed',dur:1,sourceId:caster.id,controlSide:'enemy' }]; const all = [u,caster,originalFriend];
    expect(combatSide(u,all)).toBe('enemy'); expect(combatHostile(u,originalFriend,all)).toBe(true); expect(combatHostile(u,caster,all)).toBe(false);
    breakCharmOnDamage(all,u,originalFriend,10); expect(combatSide(u,all)).toBe('enemy'); breakCharmOnDamage(all,u,caster,0); expect(combatSide(u,all)).toBe('enemy');
    breakCharmOnDamage(all,u,caster,1); expect(combatSide(u,all)).toBe('ally'); expect(u.side).toBe('ally'); expect(u.pos).toBe(4);
    expect(prepareCondition(caster,unit('company','ally',true),{op:'condition',conditionId:'charmed',dur:1,saveDC:18},forced).text).toContain('独立个体');
  });
  it('会战控制不会因最后一名敌人受控而结束，旧军令重新验证并保留真实归属', () => {
    const a = unit('a', 'ally', true), e = unit('e','enemy',true);
    const battle = new MassBattle({ combatants:[a,e], rules:V17_OVERFLOW_TW, seed:'mass-chaos' }); battle.start();
    e.conditions = [{id:'confused',dur:1,controlPending:true}]; expect(battle.isOver()).toBe(false);
    battle.orders.set('a',{unitId:'a',type:'hold',automatic:true}); battle.resolveRound();
    expect(e.side).toBe('enemy'); expect(e.conditions.some(c => c.id === 'confused')).toBe(false);
  });
});

import { standardConditionMap } from '../src/index.js';
function awaitlessConditions() { return standardConditionMap(); }
