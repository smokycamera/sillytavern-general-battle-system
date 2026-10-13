import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, formationNode, V13_OVERFLOW_D20, V14_OVERFLOW_D20, V14_OVERFLOW_TW, V15_OVERFLOW_D20,
  parseSkillMechanism, parseSkillMechanismParts, skillMechanismId, skillMechanismName, compileSkill, skillDefinitionId, upgradeCombatSkills, abilityCost, type Combatant, type GenerateInput } from '../src/index.js';
import { parseProtocol } from '../../panel/src/protocol.js';
import { parseAbilitySpec } from '../../panel/src/tags.js';
import { compactEvents } from '../src/inject/format.js';
const registry = traitRegistry();
const specs = (text: string) => parseAbilitySpec(text).map((s) => ({ id: s.blueprintId, name: s.name, level: s.level }));
function unit(id: string, side: 'ally' | 'enemy', skills = '', input: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 5, hpMax: 500, weaponClass: 'sword', armorTier: 0,
    traits: [], abilityBlueprints: specs(skills), ...input }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
/** 7×9 空地：a 在 (3,4)，e 默认在 (3,1)，相距3格。 */
function grid(skills: string, input: Partial<GenerateInput> = {}, ePos = 10, enemy: Partial<GenerateInput> = {}) {
  const a = unit('a', 'ally', skills, input), f = unit('f', 'ally'), e = unit('e', 'enemy', '', enemy);
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, f, e], battlefield: field, rules: V14_OVERFLOW_D20, traitRegistry: registry, seed: 'skill-move',
    rng: { seed: 'fixed', next: () => 0.5, d: (sides: number) => sides === 20 ? 15 : sides } as never });
  b.start(); b.turnOrder = ['a', 'f', 'e']; b.turnIndex = 0; a.pos = 31; f.pos = 34; e.pos = ePos;
  return { b, a, f, e, ability: a.abilities[0]! };
}
function mass(skills: string, rank = 'rear', input: Partial<GenerateInput> = {}) {
  const make = (id: string, side: 'ally' | 'enemy', text = '', extra: Partial<GenerateInput> = {}) => unit(id, side, text, { scale: 'company', hpMax: 100, ...extra });
  const a = make('a', 'ally', skills, input), f = make('f', 'ally'), e = make('e', 'enemy');
  a.tags.push('zone:中军', 'rank:' + rank); f.tags.push('zone:左翼', 'rank:front'); e.tags.push('zone:中军', 'rank:front');
  const b = new MassBattle({ combatants: [a, f, e], rules: V14_OVERFLOW_TW, traitRegistry: registry, seed: 'skill-move-mass' }); b.start();
  for (const u of b.combatants) if (u.id !== 'a') b.issue({ unitId: u.id, type: 'hold' });
  return { b, a: b.byId('a'), e: b.byId('e'), ability: b.byId('a').abilities[0]! };
}

describe('技能位移：突进（冲锋）、闪现、后撤', () => {
  it('纯突进加后撤在小战和会战都执行后撤，强化射程能延长会战闪现', () => {
    const small = grid('往返:突进+后撤L5');
    expect(small.b.useAbility('a', small.ability.id, 'cell:24').ok).toBe(true);
    expect(small.a.pos).not.toBe(24);
    expect(small.b.log.some(e => e.move?.skill === 'after')).toBe(true);
    const large = mass('往返:突进+后撤L5');
    expect(large.b.useAbility('a', large.ability.id, 'zone:ally:中军:front').ok).toBe(true);
    large.b.resolveRound();
    expect(formationNode(large.b.byId('a')).rank).not.toBe('front');
    expect(large.b.log.some(e => e.kind === 'move' && e.text.includes('后撤'))).toBe(true);
    const blink = mass('瞬身:闪现L5', 'front'); blink.ability.bonuses = { range: 5 };
    expect(blink.b.useAbility('a', blink.ability.id, 'zone:ally:中军:reserve').ok).toBe(true);
    blink.b.resolveRound();
    expect(formationNode(blink.b.byId('a')).rank).toBe('reserve');
  });
  it('写法：冲锋默认近战突进，单写位移词只移动自己；突进与闪现只取一个', () => {
    expect(skillMechanismName(parseSkillMechanism('冲锋')!)).toBe('物理单体近战+突进');
    expect(skillMechanismName(parseSkillMechanism('物理单体+冲锋+击退')!)).toBe('物理单体近战+击退+突进');
    expect(skillMechanismName(parseSkillMechanism('物理单体射击+撤步')!)).toBe('物理单体射击+后撤');
    for (const [text, mode] of [['突进', 'dash'], ['瞬移', 'blink'], ['传送', 'blink'], ['后撤', 'withdraw'], ['脱离', 'withdraw']] as const) {
      const skill = compileSkill({ id: skillDefinitionId(text)! }, 5, 'u');
      expect(skill.target).toBe('zone'); expect(skill.effects).toEqual([{ op: 'move', mode, reach: mode === 'blink' ? 2 : 3 }]);
    }
    expect(parseSkillMechanism('突进+闪现')!.modifiers).toEqual(['blink']);
    // 闪现默认是法术，突进、后撤是身体动作；战技闪现不受沉默限制。
    expect(compileSkill({ id: skillDefinitionId('闪现')! }, 5, 'u').delivery).toBe('magic');
    expect(compileSkill({ id: skillDefinitionId('突进')! }, 5, 'u').delivery).toBeUndefined();
    expect(compileSkill({ id: skillDefinitionId('buff+战技+闪现')! }, 5, 'u').delivery).toBeUndefined();
  });

  it('冲锋：从3格外沿路线接敌并按冲锋结算，冲锋强化生效；位移先于出手记入战报，不占移动点', () => {
    const { b, a, e, ability } = grid('冲锋:冲锋L5', { traits: ['charge-strong'] });
    const target = b.getActionOptions('a').find((o) => o.id === ability.id)!.targets!.find((t) => t.targetId === 'e')!;
    expect(target.enabled).toBe(true);
    expect(target.preview?.effects?.[0]).toBe('先突进至D3，以冲锋接敌');
    const result = b.useAbility('a', ability.id, 'e');
    expect(result.ok).toBe(true); expect(a.pos).toBe(17);
    expect(result.resolutions[0]!.atkDetail).toContain('冲锋强化');
    const moves = b.log.filter((l) => l.kind === 'move' && l.participants?.includes('a') && l.move);
    expect(moves.map((l) => l.move!.to)).toEqual([24, 17]);
    expect(b.log.indexOf(moves.at(-1)!)).toBeLessThan(b.log.findIndex((l) => l.kind === 'ability'));
    expect(b.movementLeft('a')).toBeGreaterThan(0);
    // 已经贴身时不移动、不算冲锋。
    const near = grid('冲锋:冲锋L5', { traits: ['charge-strong'] }, 24);
    const close = near.b.useAbility('a', near.ability.id, 'e');
    expect(near.a.pos).toBe(31); expect(close.resolutions[0]!.atkDetail).not.toContain('冲锋强化');
  });

  it('够不着或被定身时整次不扣费；定身只影响需要位移的出手', () => {
    const far = grid('冲锋:冲锋L1', {}, 3); // L1 突进2格，目标在 (3,0) 相距4格
    const sp = far.a.resources.SP;
    const option = far.b.getActionOptions('a').find((o) => o.id === far.ability.id)!.targets!.find((t) => t.targetId === 'e')!;
    expect(option.enabled).toBe(false); expect(option.reason).toContain('突进2格内没有能对目标出手的落点');
    expect(far.b.useAbility('a', far.ability.id, 'e').ok).toBe(false); expect(far.a.resources.SP).toBe(sp);
    const rooted = grid('冲锋:冲锋L5');
    rooted.a.conditions.push({ id: 'restrained', dur: 2 });
    expect(rooted.b.useAbility('a', rooted.ability.id, 'e').reason).toContain('定身或失能，不能位移');
    const adjacent = grid('冲锋:冲锋L5', {}, 24); adjacent.a.conditions.push({ id: 'restrained', dur: 2 });
    expect(adjacent.b.useAbility('a', adjacent.ability.id, 'e').ok).toBe(true);
  });

  it('闪现直接落位、不触发借机；突进离开接触照常吃借机；后撤不吃借机', () => {
    for (const [skill, provoked] of [['瞬身:闪现L6', false], ['疾行:突进L5', true], ['撤步:后撤L5', false]] as const) {
      const { b, a, ability } = grid(skill, {}, 24);
      const cells = b.getActionOptions('a').find((o) => o.id === ability.id)!.targets!.filter((t) => t.enabled).map((t) => t.targetId);
      expect(cells).toContain('cell:52');
      expect(b.useAbility('a', ability.id, 'cell:52').ok).toBe(true);
      expect(a.pos).toBe(52);
      expect(b.log.some((l) => l.text.startsWith('借机反应'))).toBe(provoked);
      expect(b.movementLeft('a')).toBe(b.movementLeft('f'));
    }
    const blink = grid('瞬身:闪现L1', {}, 24);
    expect(blink.b.useAbility('a', blink.ability.id, 'cell:45').reason).toContain('闪现只能落到1格内');
  });

  it('后撤：出手后拉开距离、朝本方后方撤，战报排在出手之后', () => {
    const { b, a, ability } = grid('回马箭:物理单体射击+后撤L5', { weaponClass: 'bow' }, 17);
    expect(b.useAbility('a', ability.id, 'e').ok).toBe(true);
    expect(a.pos).toBe(52);
    const abilityAt = b.log.findIndex((l) => l.kind === 'ability');
    expect(b.log.slice(abilityAt + 1).filter((l) => l.kind === 'move' && l.participants?.includes('a')).length).toBe(3);
  });

  it('战报：技能名先写，出手前的突进/闪现并在其后，途中反应插在中间；先走几步再冲锋分开写，后撤排在结果之后', () => {
    // a 在 D5，敌人 e 在 D2；g 默认远在 A1，需要借机时挪到 a 旁边。
    const scene = (skills: string, input: Partial<GenerateInput> = {}) => {
      const g = unit('g', 'enemy', '', { weaponClass: 'spear' }), { b, a, ability } = grid(skills, input), start = b.log.length;
      b.combatants.push(g); b.turnOrder.push('g'); g.pos = 0;
      return { b, a, g, ability, start, report: () => compactEvents(b.log.slice(start)) };
    };
    const charge = scene('冲锋:冲锋L5');
    expect(charge.b.useAbility('a', charge.ability.id, 'e').ok).toBe(true);
    expect(charge.report()).toEqual(['a 使用【冲锋】：突进 D5→D3，冲锋', expect.stringMatching(/^a→e 命中/)]);
    const walked = scene('冲锋:冲锋L5'); walked.a.pos = 45;
    walked.b.moveTo('a', 31); expect(walked.b.useAbility('a', walked.ability.id, 'e').ok).toBe(true);
    expect(walked.report().slice(0, 2)).toEqual(['a D7→D5', 'a 使用【冲锋】：突进 D5→D3，冲锋']);
    const provoked = scene('冲锋:冲锋L5'); provoked.g.pos = 32;
    expect(provoked.b.useAbility('a', provoked.ability.id, 'e').ok).toBe(true);
    expect(provoked.report()).toEqual(['a 使用【冲锋】：突进 D5→D4', expect.stringMatching(/^借机反应｜g→a 命中/), 'a 突进 D4→D3，冲锋', expect.stringMatching(/^a→e 命中/)]);
    // 途中被打倒：不写冲锋，结果行写明是谁的技能没有生效。
    const stopped = scene('冲锋:冲锋L5'); stopped.g.pos = 32; stopped.a.hp = 1;
    expect(stopped.b.useAbility('a', stopped.ability.id, 'e').ok).toBe(true);
    expect(stopped.report()[0]).toBe('a 使用【冲锋】：突进 D5→D4');
    expect(stopped.report().at(-1)).toBe('a的【冲锋】位移途中受阻或被反应打断，技能未生效');
    expect(stopped.b.log.find((l) => l.kind === 'ability')!.text).not.toContain('，冲锋');
    const shot = scene('回马箭:物理单体射击+后撤L5', { weaponClass: 'bow' }); shot.b.byId('e').pos = 17;
    expect(shot.b.useAbility('a', shot.ability.id, 'e').ok).toBe(true);
    expect(shot.report()).toEqual(['a 使用【回马箭】', expect.stringMatching(/^a→e 命中/), 'a 后撤 D5→D8']);
    for (const [skills, cell, line] of [['瞬身:闪现L6', 52, 'a 使用【瞬身】：闪现 D5→D8'], ['撤步:后撤L5', 52, 'a 使用【撤步】：后撤 D5→D8'], ['疾行:突进L5', 17, 'a 使用【疾行】：突进 D5→D3']] as const) {
      const only = scene(skills);
      expect(only.b.useAbility('a', only.ability.id, 'cell:' + cell).ok).toBe(true);
      expect(only.report()).toEqual([line]);
    }
    // 旧日志的移动没有技能标记：保持原来的写法。
    const legacy = charge.b.log.slice(charge.start).map((l) => l.move ? { ...l, move: { from: l.move.from, to: l.move.to }, text: l.text.replace(' 突进 ', ' ') } : l);
    expect(compactEvents(legacy).slice(0, 2)).toEqual(['a D5→D3', 'a 使用【冲锋】']);
  });

  it('AI：够不着时用冲锋技能接敌；只有位移技能时被贴身的远程单位闪现脱离', () => {
    const charge = grid('', {}, 24, { abilityBlueprints: specs('冲锋:冲锋L5') });
    charge.b.turnOrder = ['e', 'a', 'f']; charge.b.turnIndex = 0;
    const enemy = charge.b.byId('e'); enemy.pos = 3; charge.a.pos = 38;
    charge.b.autoAction('e');
    expect(charge.b.log.some((l) => l.kind === 'ability' && l.text.includes('使用【冲锋】'))).toBe(true);
    const archer = grid('瞬身:闪现L6', { weaponClass: 'bow' }, 24);
    archer.b.autoAction('a');
    expect(archer.b.log.some((l) => l.kind === 'ability' && l.text.includes('使用【瞬身】'))).toBe(true);
    expect(archer.b.log.some((l) => l.text.startsWith('借机反应'))).toBe(false);
  });

  it('AI：编队骑兵估算冲锋时途中被借机减员，落点受击估计不再因人数与成员生命不同源而报错', () => {
    // 骑兵连贴着枪兵连，冲锋向3格外的敌人要离开接触；落点在步枪连（每回合两段）射程内。
    const company = (id: string, side: 'ally' | 'enemy', skills: string, input: Partial<GenerateInput>) => unit(id, side, skills, { scale: 'company', hpMax: 20, ...input });
    const cavalry = company('a', 'ally', '冲锋:冲锋L5', { mount: true, archetype: 'mobile', speedTier: 4, weaponClass: 'spear' });
    const guard = company('g', 'enemy', '', { hpMax: 30, weaponClass: 'spear' }), target = company('t', 'enemy', '', {}), rifles = company('r', 'enemy', '', { weaponClass: 'rifle' });
    const field = standardField(); field.tiles.fill('open');
    const b = new SmallBattle({ combatants: [cavalry, guard, target, rifles], battlefield: field, rules: V15_OVERFLOW_D20, traitRegistry: registry, seed: 'skill-move-company' });
    b.start(); b.turnOrder = ['a', 'g', 't', 'r']; b.turnIndex = 0;
    b.byId('a').pos = 31; b.byId('g').pos = 38; b.byId('t').pos = 10; b.byId('r').pos = 14;
    expect(() => b.autoAction('a')).not.toThrow();
    expect(b.active?.id).not.toBe('a');
  }, 20000);

  it('会战：突进一个阵位接敌并冲锋，闪现可越两层，后撤出手后退一层，随队人物不能独立位移', () => {
    const charge = mass('冲锋:冲锋L5');
    const order = { unitId: 'a', type: 'ability' as const, abilityActorId: 'a', abilityId: charge.ability.id, targetId: 'e' };
    expect(charge.b.orderPreview(order).approach?.id).toBe('ally:中军:front');
    expect(charge.b.issue(order).ok).toBe(true); charge.b.resolveRound();
    expect(formationNode(charge.b.byId('a')).id).toBe('ally:中军:front');
    expect(charge.b.log.some((l) => l.text.includes('a → e'))).toBe(true);
    const blink = mass('瞬身:闪现L7', 'front');
    expect(blink.b.issue({ unitId: 'a', type: 'ability', abilityActorId: 'a', abilityId: blink.ability.id, targetId: 'zone:ally:中军:reserve' }).ok).toBe(true);
    blink.b.resolveRound(); expect(formationNode(blink.b.byId('a')).id).toBe('ally:中军:reserve');
    const dash = mass('疾行:突进L5', 'front');
    expect(dash.b.orderPreview({ unitId: 'a', type: 'ability', abilityActorId: 'a', abilityId: dash.ability.id, targetId: 'zone:ally:中军:reserve' }).reason).toContain('只能到1个阵位内');
    const shot = mass('回马箭:物理单体射击+后撤L5', 'rear', { weaponClass: 'bow' });
    expect(shot.b.issue({ unitId: 'a', type: 'ability', abilityActorId: 'a', abilityId: shot.ability.id, targetId: 'e' }).ok).toBe(true);
    shot.b.resolveRound(); expect(formationNode(shot.b.byId('a')).id).toBe('ally:中军:reserve');
  });

  it('严格解析拒绝作用方向相反的效果；正文容错剔除并说明原因，旧技能名换成通用机制', () => {
    expect(parseSkillMechanism('物理单体+治疗')).toBeUndefined();
    expect(parseSkillMechanism('buff+眩晕')).toBeUndefined();
    expect(parseSkillMechanism('魔法单体+单体召唤')).toBeDefined();
    expect(parseSkillMechanismParts('物理单体+飞行')).toMatchObject({ mechanism: { category: 'physical-single', modifiers: [] }, dropped: [{ name: '飞行', reason: 'enemy' }] });
    expect(parseSkillMechanismParts('buff+大守护')).toMatchObject({ mechanism: { category: 'buff', modifiers: ['ward'] }, replaced: [['大守护', '守护']] });
    const batch = parseProtocol('<tb><spawn name="甲" side="ally" scale="hero" level="5" weapon="剑L5" skills="吸血斩:物理单体+治疗L5,护体:防御L3,恐吓:士气伤害L4,先锋:buff+先锋部署L3,冲锋L4"/></tb>');
    const spawned = (batch.events[0] as { skills: { blueprintId: string }[] }).skills.map((s) => s.blueprintId);
    expect(spawned).toEqual([skillMechanismId(parseSkillMechanism('物理单体')!), skillMechanismId(parseSkillMechanism('增益防御')!),
      skillMechanismId(parseSkillMechanism('减益范围惊惧+士气')!), skillMechanismId(parseSkillMechanism('冲锋')!)]);
    expect(batch.warnings.join('\n')).toMatch(/已忽略「治疗」——写在攻击\/减益技能里会作用到敌人/);
    expect(batch.warnings.join('\n')).toMatch(/未采用「先锋部署」——只在开战部署时生效/);
    expect(batch.warnings.join('\n')).toMatch(/技能名「士气伤害」按减益范围惊惧\+士气理解/);
  });

  it('V14：同时改两项属性的状态按两项计价，与分别写两个单项一致；V13 与旧战斗数值不变', () => {
    const build = (text: string, model?: 'skills-v1') => {
      const carrier = { abilities: [compileSkill({ id: skillDefinitionId(text)! }, 5, 'u')], abilityState: [], combatModel: 'cohort-v2', damageModel: 'wounds-v2', ...(model ? { skillModel: model } : {}) } as unknown as Combatant;
      upgradeCombatSkills(carrier); return carrier.abilities[0]!;
    };
    const pair = build('debuff+攻击+防御', 'skills-v1'), curse = build('debuff+诅咒', 'skills-v1'), old = build('debuff+诅咒');
    const condition = (a: ReturnType<typeof build>) => a.effects.find((e) => e.op === 'condition') as { magnitude: number; saveDC: number };
    expect(curse.cost).toEqual(pair.cost); expect(condition(curse).magnitude).toBeCloseTo(condition(pair).magnitude); expect(condition(curse).saveDC).toBe(condition(pair).saveDC);
    expect(old.cost!.amount).toBe(3); expect(condition(old).magnitude).toBe(1); expect(old.effectVersion).toBe('skill-v6.1');
    expect(build('debuff+攻击', 'skills-v1').cost!.amount).toBe(3);
    // 耐力模型的实际报价同样按两项计：V14 战斗里诅咒与“攻击+防御”同价，V13 诅咒仍少1点。
    const both = grid('咒:debuff+诅咒L5,双:debuff+攻击+防御L5');
    expect(abilityCost(both.a, both.a.abilities[0]!)!.amount).toBe(abilityCost(both.a, both.a.abilities[1]!)!.amount);
    const legacy = { ...both.a, skillModel: undefined };
    expect(abilityCost(legacy, both.a.abilities[0]!)!.amount).toBe(abilityCost(legacy, both.a.abilities[1]!)!.amount - 1);
    // 规则投影：V13 战斗清除标记，V14 写入；重建只发生在新规则下。
    const v13 = grid('诅咒:debuff+诅咒L5'); const snapshot = structuredClone(v13.b.toSnapshot());
    snapshot.rulesId = V13_OVERFLOW_D20.id; for (const u of snapshot.combatants as Combatant[]) { delete u.skillModel; for (const a of u.abilities) if (a.effectVersion === 'skill-v7.0') { a.effectVersion = 'skill-v6.1'; } }
    const restored = SmallBattle.fromSnapshot(snapshot, { traitRegistry: registry });
    expect(restored.byId('a').skillModel).toBeUndefined();
    expect(v13.a.skillModel).toBe('skills-v1'); expect(v13.ability.effectVersion).toBe('skill-v7.0');
  });
});
