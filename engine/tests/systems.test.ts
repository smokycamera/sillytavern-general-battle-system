/**
 * 体系化改动单元测试：武器公式生成 / 远程近战惩罚 / 军团士气累计与重整 / 自动军令分散。
 */
import { describe, it, expect } from 'vitest';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { resolveAttack, armorDR } from '../src/damage';
import { MassBattle } from '../src/mass/battle';
import { SmallBattle } from '../src/small/battle';
import { SeededRng } from '../src/rng';
import { LITE_D20, SYSTEM_PACKS, getSystemPack } from '../src/rules';
import { WEAPON_LIBRARY, getWeaponProfile } from '../src/data/weapons';
import { getAbilityTemplate } from '../src/data/abilities';

const reg = traitRegistry();

const gen = (over: Partial<Parameters<typeof generateUnit>[0]> & Pick<Parameters<typeof generateUnit>[0], 'name' | 'side' | 'scale'>) =>
  generateUnit({ level: 3, traits: [], era: 'medieval', ...over } as Parameters<typeof generateUnit>[0], { seed: 'sys-t', noVariance: true, registry: reg }).unit;

describe('武器公式生成', () => {
  it('默认武器（mult=1）保持曲线直出，与旧行为一致', () => {
    const u = gen({ name: '剑士', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    expect(u.weapon!.name).toBe('长剑');
    expect(u.weapon!.baseDice).toBe('1d8+3'); // L3 曲线 1d8+2 + 步兵 dmgFlat+1
    expect(u.weapon!.range).toBe(0);
  });

  it('火器武器按 dmgMult 重建骰子表达式', () => {
    const u = gen({ name: '燧发枪兵', scale: 'hero', archetype: 'ranged', side: 'enemy', era: 'gunpowder' });
    // L5 曲线 2d6+3(均值10)；野战炮 ×1.3 → 13 → 3d6+3
    const u5 = gen({ name: '燧发枪兵', scale: 'hero', archetype: 'ranged', side: 'enemy', era: 'gunpowder', level: 5 });
    expect(u.weapon!.name).toBe('野战炮');
    expect(u5.weapon!.baseDice).toBe('3d6+3');
    expect(u5.genAudit!.weapon!.profileId).toBe('wpn-fieldgun');
    expect(u5.genAudit!.weapon!.dmgMult).toBe(1.3);
  });

  it('weaponId 显式指定：术语与数值同源（激光枪 vs 爆弹枪）', () => {
    const las = gen({ name: '卫兵', scale: 'mook', archetype: 'infantry', side: 'enemy', era: 'scifi', level: 1, loadout: 'ranged', weaponId: 'wpn-lasgun' });
    const bolter = gen({ name: '星际战士', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'scifi', level: 5, loadout: 'ranged', weaponId: 'wpn-bolter' });
    expect(las.weapon!.name).toBe('激光枪');
    expect(bolter.weapon!.name).toBe('爆弹枪');
    // 均值：卫兵 L1 1d6+1(4.5)+步兵dmgFlat1=5.5 ×0.95≈5.2 → 1d6+2
    expect(las.weapon!.baseDice).toBe('1d6+2');
    // 爆弹 L5 2d6+3(10)+步兵dmgFlat1=11 ×1.45≈16 → 4d6+2
    expect(bolter.weapon!.baseDice).toBe('4d6+2');
  });

  it('轨道炮 apShare 1.3 重建破甲段', () => {
    const u = gen({ name: '炮台', scale: 'hero', archetype: 'ranged', side: 'enemy', era: 'scifi', level: 5 });
    // L5 dmgAp 1d6(3.5)×1.3=4.55 → d4 重建 floor(4.55/2.5)=1 flat=2 → 1d4+2
    expect(u.weapon!.name).toBe('轨道炮');
    expect(u.weapon!.apDice).toBe('1d4+2');
    expect(u.weapon!.range).toBe(5);
  });

  it('武器库 id 唯一且可查询', () => {
    const ids = Object.keys(WEAPON_LIBRARY);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getWeaponProfile('wpn-musket')!.dmgMult).toBeGreaterThan(1);
    expect(getWeaponProfile('nope')).toBeUndefined();
  });
});

describe('远程武器近战惩罚', () => {
  it('射击单位被迫近战时攻击 -2，射击不受影响', () => {
    const shooter = gen({ name: '弓手', scale: 'hero', archetype: 'ranged', side: 'ally' });
    const target = gen({ name: '步敌', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    const melee = resolveAttack({
      attacker: shooter, defender: target, rng: new SeededRng('m1'),
      rules: LITE_D20, conditionDefs: new Map(), traitRegistry: reg, ranged: false,
    });
    expect(melee.atkDetail).toContain('武器不善近战');
    expect(melee.netAtk).toBe(shooter.base.atk - 2);
    const shot = resolveAttack({
      attacker: shooter, defender: target, rng: new SeededRng('m2'),
      rules: LITE_D20, conditionDefs: new Map(), traitRegistry: reg, ranged: true,
    });
    expect(shot.atkDetail).not.toContain('武器不善近战');
    expect(shot.netAtk).toBe(shooter.base.atk);
  });
});

describe('副武器（weapon2 显式声明）', () => {
  it('不声明则无副武器；声明后按公式生成且不带 ranged 标签', () => {
    const plain = gen({ name: '弓手', scale: 'hero', archetype: 'ranged', side: 'ally' });
    expect(plain.sidearm).toBeUndefined();
    const dual = gen({
      name: '双持弓手', scale: 'hero', archetype: 'ranged', side: 'ally',
      sidearmClass: 'sword', sidearmLevel: 3, sidearmName: '短剑',
    });
    expect(dual.sidearm).toBeTruthy();
    expect(dual.sidearm!.name).toBe('短剑');
    expect(dual.sidearm!.range).toBe(0);
    expect(dual.sidearm!.tags).not.toContain('ranged');
    expect(dual.sidearm!.level).toBe(3);
  });

  it('副武器允许显式远程原型，不再强制回退近战位', () => {
    const u = gen({
      name: '奇怪的射手', scale: 'hero', archetype: 'ranged', side: 'ally',
      sidearmClass: 'bow', sidearmLevel: 3, sidearmName: '副手弩',
    });
    // 显式副手弓弩保留其真实远程规格；副槽不再强制限定近战武器。
    expect(u.sidearm!.name).toBe('副手弩');
    expect(u.sidearm!.range).toBe(4);
    expect(u.sidearm!.tags).toContain('ranged');
  });

  it('weaponOverride 让结算用副武器骰子与等级（免近战罚）', () => {
    const shooter = gen({ name: '弓手', scale: 'hero', archetype: 'ranged', side: 'ally' });
    shooter.sidearm = { id: 'w2-test', name: '短剑', baseDice: '2d4+9', range: 0, level: 6 };
    const target = gen({ name: '靶子', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    shooter.base.atk += 30; // 抬命中保证结算出伤害段（nat=1 除外）
    const res = resolveAttack({
      attacker: shooter, defender: target, rng: new SeededRng('ov1'),
      rules: LITE_D20, conditionDefs: new Map(), traitRegistry: reg,
      ranged: false, weaponOverride: shooter.sidearm,
    });
    expect(res.atkDetail).not.toContain('武器不善近战');
    if (res.hit) {
      // 骰面来自副武器 2d4：单骰必然 ≤4（主武器长弓 1d6 会掷出 5/6）
      expect(res.baseRoll!.rolls.every((r) => r <= 4)).toBe(true);
    }
  });
});

describe('军团近战副武器切换', () => {
  it('远程单位下 attack 指令：有副武器按「近战·副武器」免罚结算，无副武器吃 -2', () => {
    const mk = (name: string, side: 'ally' | 'enemy') =>
      gen({ name, scale: 'company', archetype: 'ranged', side, level: 3 });
    const withSide = mk('弓连一', 'ally');
    withSide.sidearm = { id: 'w2-t', name: '短剑', baseDice: '1d8+2', range: 0 };
    const noSide = mk('弓连二', 'ally');
    const foe = gen({ name: '敌步', scale: 'company', archetype: 'infantry', side: 'enemy', level: 3 });
    const mb = new MassBattle({ combatants: [withSide, noSide, foe], seed: 'mass-side', traitRegistry: reg });
    mb.start();
    expect(mb.issue({ unitId: withSide.id, type: 'attack', targetId: foe.id }).ok).toBe(true);
    expect(mb.issue({ unitId: noSide.id, type: 'attack', targetId: foe.id }).ok).toBe(true);
    mb.resolveRound();
    const sideEntry = mb.log.find((l) => l.resolution?.attackerId === withSide.id && l.text.includes('近战·短剑'));
    expect(sideEntry).toBeTruthy();
    expect(sideEntry!.resolution!.atkDetail).not.toContain('武器不善近战');
    // 无副武器的弓连近战吃罚（日志里同回合另一条 attack）
    const plainEntry = mb.log.find((l) => l.resolution && l.text.includes('弓连二'));
    expect(plainEntry).toBeTruthy();
    expect(plainEntry!.resolution!.atkDetail).toContain('武器不善近战');
  });
});

describe('军团 autoSupport 召唤', () => {
  it('无消耗召唤技能冷却好掷半概率释放（呼叫援军落地）', () => {
    const a = gen({ name: '传令连', scale: 'company', archetype: 'infantry', side: 'ally', level: 3, abilityBlueprints: [{ id: 'bp-call-reinforce' }] });
    const b = gen({ name: '敌连', scale: 'company', archetype: 'infantry', side: 'enemy', level: 3 });
    let summoned = 0;
    const mb = new MassBattle({
      combatants: [a, b], traitRegistry: reg,
      rng: { next: () => 0, d: () => 1, seed: 'mock' }, // 半概率掷骰必过（d20 全 1 → 攻击全落空，不干扰断言）
      summonUnit: (tmpl, side) => {
        summoned += 1;
        expect(tmpl).toBe('reinforcement');
        return gen({ name: `援军${summoned}`, scale: 'company', archetype: 'infantry', side, level: 2 });
      },
    });
    mb.start();
    mb.resolveRound();
    expect(summoned).toBe(1);
    expect(mb.log.some((l) => l.text.includes('【召唤】'))).toBe(true);
    expect(mb.combatants.length).toBe(3);
    // 冷却 4：本回合内不会连放
    mb.resolveRound();
    expect(summoned).toBe(1);
  });
});

describe('军团士气：累计伤亡与重整限制', () => {
  it('累计伤亡过三成触发士气检定', () => {
    const a = gen({ name: '步一', scale: 'company', archetype: 'infantry', side: 'ally' });
    const b = gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy' });
    a.hp = Math.floor(a.base.hpMax * 0.6); // 损四成
    const mb = new MassBattle({ combatants: [a, b], seed: 'cum', traitRegistry: reg });
    mb.start();
    mb.resolveRound();
    expect(mb.log.some((l) => l.text.includes('累计伤亡'))).toBe(true);
  });

  it('溃逃折损一成兵员，第三次溃散永久离场', () => {
    const a = gen({ name: '步一', scale: 'company', archetype: 'infantry', side: 'ally' });
    const b = gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy' });
    const mb = new MassBattle({ combatants: [a, b], seed: 'rout', traitRegistry: reg });
    mb.start();
    const hpBefore = a.hp;
    // 直接驱动士气检定失败路径：置零士气并塞高 DC
    const routed = mb.moraleCheck(a, 99, '测试');
    expect(routed).toBe(true);
    expect(a.status).toBe('routing');
    expect(a.hp).toBe(Math.max(1, Math.round(hpBefore * 0.9)));
    expect(mb.routCounts.get(a.id)).toBe(1);
    mb.routCounts.set(a.id, 3);
    mb.resolveRound();
    expect(a.status).toBe('fled');
    expect(mb.log.some((l) => l.text.includes('彻底溃散'))).toBe(true);
  });

  it('重整 DC 随溃逃次数递增', () => {
    const a = gen({ name: '步一', scale: 'company', archetype: 'infantry', side: 'ally' });
    const b = gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy' });
    const mb = new MassBattle({ combatants: [a, b], seed: 'rally', traitRegistry: reg });
    mb.start();
    a.status = 'routing';
    mb.routCounts.set(a.id, 2);
    mb.resolveRound();
    // 第二次重整 DC=15：d20 + morale/6 ≥ 15 才归队——日志出现"仍在溃逃"或"重整旗鼓"其一
    expect(mb.log.some((l) => l.text.includes('仍在溃逃') || l.text.includes('重整旗鼓'))).toBe(true);
  });
});

describe('自动军令目标分散', () => {
  it('未接战单位按序轮转选择目标，不再全军集火', () => {
    const units = [
      gen({ name: '步一', scale: 'company', archetype: 'infantry', side: 'ally' }),
      gen({ name: '步二', scale: 'company', archetype: 'infantry', side: 'ally' }),
      gen({ name: '步三', scale: 'company', archetype: 'infantry', side: 'ally' }),
      gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy' }),
      gen({ name: '敌二', scale: 'company', archetype: 'infantry', side: 'enemy' }),
      gen({ name: '敌三', scale: 'company', archetype: 'infantry', side: 'enemy' }),
    ];
    const mb = new MassBattle({ combatants: units, seed: 'spread', traitRegistry: reg });
    mb.start();
    const n = mb.autoOrders('ally');
    expect(n).toBe(3);
    const targets = new Set(
      units.slice(0, 3).map((u) => mb.orders.get(u.id)!.targetId),
    );
    expect(targets.size).toBeGreaterThan(1);
  });
});

describe('预置体系规则包', () => {
  it('六套体系包齐备且数值梯度正确', () => {
    const ids = ['dnd', 'medieval', 'gunpowder', 'modern', 'w40k', 'cyber'];
    for (const id of ids) expect(SYSTEM_PACKS[id]).toBeDefined();
    const armor = (id: string) => SYSTEM_PACKS[id]!.small.armorDR[3]!;
    expect(armor('w40k')).toBeGreaterThan(armor('medieval'));
    expect(armor('medieval')).toBeGreaterThan(armor('gunpowder'));
    expect(armor('gunpowder')).toBeGreaterThan(armor('modern'));
    expect(SYSTEM_PACKS.cyber!.mass.tw.perDiff).toBeGreaterThan(SYSTEM_PACKS.dnd!.mass.tw.perDiff);
    expect(getSystemPack('gunpowder').small.rangedMeleePenalty).toBe(-2);
    expect(getSystemPack(undefined!).id).toBe('medieval');
  });
});

describe('速射与装填', () => {
  it('速射武器 attacks=2，重炮 reload=1 并透传到单位', () => {
    const ar = gen({ name: '步枪手', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'modern', level: 3, loadout: 'ranged', weaponId: 'wpn-ar' });
    expect(ar.weapon!.attacks).toBe(2);
    expect(ar.weapon!.reload).toBeUndefined();
    const gun = gen({ name: '炮组', scale: 'hero', archetype: 'ranged', side: 'enemy', era: 'gunpowder', level: 5 });
    expect(gun.weapon!.name).toBe('野战炮');
    expect(gun.weapon!.reload).toBe(1);
  });

  it('速射武器一次攻击结算两段（日志带 1/2、2/2 前缀）', () => {
    const a = gen({ name: '枪手A', scale: 'hero', archetype: 'infantry', side: 'ally', era: 'modern', level: 3, loadout: 'ranged', weaponId: 'wpn-ar' });
    const b = gen({ name: '枪手B', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'modern', level: 3, loadout: 'ranged', weaponId: 'wpn-ar' });
    const sb = new SmallBattle({ combatants: [a, b], seed: 'burst', rules: SYSTEM_PACKS.modern!.small, traitRegistry: reg });
    sb.start();
    sb.attack(a.id, b.id, { bypassTurn: true });
    expect(sb.log.some((l) => l.text.includes('·1/2］'))).toBe(true);
    expect(sb.log.some((l) => l.text.includes('·2/2］'))).toBe(true);
  });

  it('重炮发射后进入装填，装填中不能攻击', () => {
    const a = gen({ name: '炮组', scale: 'hero', archetype: 'ranged', side: 'ally', era: 'gunpowder', level: 5 });
    const b = gen({ name: '敌阵', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'gunpowder', level: 5 });
    const sb = new SmallBattle({ combatants: [a, b], seed: 'reload', rules: SYSTEM_PACKS.gunpowder!.small, traitRegistry: reg });
    sb.start();
    sb.attack(a.id, b.id, { bypassTurn: true });
    expect(sb.reloadCd.get(a.id)).toBe(2); // reload 1 + 递减缓冲
    expect(() => sb.attack(a.id, b.id, { bypassTurn: true })).toThrow('装填中');
  });

  it('军团齐射受装填约束：重炮隔回合开火', () => {
    const a = gen({ name: '炮营', scale: 'company', archetype: 'ranged', side: 'ally', era: 'gunpowder', level: 4 });
    const b = gen({ name: '敌炮营', scale: 'company', archetype: 'ranged', side: 'enemy', era: 'gunpowder', level: 4 });
    const mb = new MassBattle({ combatants: [a, b], seed: 'mass-reload', rules: SYSTEM_PACKS.gunpowder!.mass, traitRegistry: reg });
    mb.start();
    for (let i = 0; i < 3; i++) {
      mb.autoOrders('ally');
      mb.autoOrders('enemy');
      mb.resolveRound();
    }
    expect(mb.log.some((l) => l.text.includes('装填中'))).toBe(true);
  });
});

describe('战场环境标签', () => {
  it('fieldMod 特质在对应环境注入攻防修正，无关环境不注入', () => {
    const run = (tags: string[]) => {
      const a = gen({ name: '游骑', scale: 'hero', archetype: 'infantry', side: 'ally', era: 'medieval', level: 3, loadout: 'ranged', traits: ['plains-runner'] });
      const d = gen({ name: '守军', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'medieval', level: 3, traits: ['fortification'] });
      const sb = new SmallBattle({
        combatants: [a, d], seed: `field-${tags.join('-') || 'none'}`,
        rules: LITE_D20, traitRegistry: reg, field: { tags },
      });
      sb.start();
      return { res: sb.attack(a.id, d.id, { bypassTurn: true }), defBase: d.base.def, atkBase: a.base.atk };
    };
    // 野战：攻方「原野游骑」生效（atk +1），守方「守城工事」不生效
    const plains = run(['plains']);
    expect(plains.res.atkDetail).toContain('原野游骑·plains');
    expect(plains.res.netAtk).toBe(plains.atkBase + 1);
    expect(plains.res.targetDef).toBe(plains.defBase);
    // 攻城：守方「守城工事」生效（def +3），攻方特质不触发
    const siege = run(['siege']);
    expect(siege.res.atkDetail).not.toContain('原野游骑');
    expect(siege.res.targetDef).toBe(siege.defBase + 3);
    // 无环境标签：双方修正都不注入
    const none = run([]);
    expect(none.res.netAtk).toBe(none.atkBase);
    expect(none.res.targetDef).toBe(none.defBase);
  });
});

describe('跨刻度技能（军团支援阶段）', () => {
  it('连队可挂载轨道打击模板并在支援阶段自动释放', () => {
    const a = gen({ name: '炮台连', scale: 'company', archetype: 'ranged', side: 'ally', level: 4, abilityIds: ['orbital-strike'] });
    const b = gen({ name: '敌连', scale: 'company', archetype: 'infantry', side: 'enemy', level: 4 });
    expect(a.abilities).toHaveLength(1); // 仅 AI 声明的模板，不自动加签名技能
    expect(a.abilities.some((x) => x.id === 'orbital-strike')).toBe(true);
    const mb = new MassBattle({ combatants: [a, b], seed: 'support', rules: SYSTEM_PACKS.w40k!.mass, traitRegistry: reg });
    mb.start();
    const hp0 = b.hp;
    const morale0 = b.morale;
    mb.autoOrders('ally');
    mb.autoOrders('enemy');
    mb.resolveRound();
    expect(mb.log.some((l) => l.text.includes('轨道打击'))).toBe(true);
    expect(b.hp).toBeLessThanOrEqual(hp0); // tw 概率命中，允许未命中
    expect(b.morale!).toBeLessThan(morale0!);
  });

  it('支援技能受冷却约束：冷却 2 的技能三回合最多释放两次', () => {
    const a = gen({ name: '炮台连', scale: 'company', archetype: 'ranged', side: 'ally', level: 4, abilityIds: ['orbital-strike'] });
    const b = gen({ name: '敌连', scale: 'company', archetype: 'infantry', side: 'enemy', level: 10, traits: ['steadfast'] });
    b.base.hpMax = 500; b.hp = 500; // 打不死，只看释放次数
    const mb = new MassBattle({ combatants: [a, b], seed: 'support-cd', rules: SYSTEM_PACKS.w40k!.mass, traitRegistry: reg });
    mb.start();
    for (let i = 0; i < 3; i++) {
      mb.autoOrders('ally');
      mb.autoOrders('enemy');
      mb.resolveRound();
    }
    const casts = mb.log.filter((l) => l.text.includes('轨道打击')).length;
    expect(casts).toBeLessThanOrEqual(2);
    expect(getAbilityTemplate('orbital-strike')!.cooldown).toBe(2);
  });

  it('治疗/士气类技能不自动释放（留给面板手动）', () => {
    const a = gen({ name: '歌者连', scale: 'company', archetype: 'infantry', side: 'ally', level: 4, abilityIds: ['battle-hymn'] });
    const b = gen({ name: '敌连', scale: 'company', archetype: 'infantry', side: 'enemy', level: 4 });
    const mb = new MassBattle({ combatants: [a, b], seed: 'hymn', rules: SYSTEM_PACKS.dnd!.mass, traitRegistry: reg });
    mb.start();
    mb.autoOrders('ally');
    mb.autoOrders('enemy');
    mb.resolveRound();
    expect(mb.log.some((l) => l.text.includes('战歌'))).toBe(false);
    // 手动释放有效
    expect(mb.useAbility(a.id, 'battle-hymn', a.id).ok).toBe(true);
    expect(mb.log.some((l) => l.text.includes('战歌'))).toBe(true);
  });
});

describe('风格与巨兽特质', () => {
  it('远近双全豁免近战惩罚，近战特化加成近战攻击', () => {
    const shooter = gen({ name: '枪手', scale: 'hero', archetype: 'infantry', side: 'ally', era: 'modern', level: 3, loadout: 'ranged', traits: ['versatile'] });
    const duelist = gen({ name: '剑圣', scale: 'hero', archetype: 'infantry', side: 'ally', era: 'medieval', level: 3, traits: ['melee-master'] });
    const target = gen({ name: '靶子', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'medieval', level: 3 });
    const melee = resolveAttack({
      attacker: shooter, defender: target, rng: new SeededRng('v1'),
      rules: LITE_D20, conditionDefs: new Map(), traitRegistry: reg, ranged: false,
    });
    expect(melee.atkDetail).not.toContain('武器不善近战');
    const master = resolveAttack({
      attacker: duelist, defender: target, rng: new SeededRng('v2'),
      rules: LITE_D20, conditionDefs: new Map(), traitRegistry: reg, ranged: false,
    });
    expect(master.atkDetail).toContain('近战特化');
    expect(master.netAtk).toBe(duelist.base.atk + 2);
  });

  it('机械化与泰坦巨兽的静态加成', () => {
    const plain = gen({ name: '步兵', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    const mech = gen({ name: '机步', scale: 'hero', archetype: 'infantry', side: 'enemy', traits: ['mechanized'] });
    expect(mech.base.spd - plain.base.spd).toBe(2);
    const titan = gen({ name: '巨龙', scale: 'hero', archetype: 'infantry', side: 'enemy', traits: ['titan'] });
    expect(titan.base.hpMax - plain.base.hpMax).toBe(25);
    expect(titan.tags).toContain('large');
    expect(titan.tags).toContain('titan');
  });
});

describe('技能蓝图生成（类别驱动，无 persona）', () => {
  it('显式类别蓝图按公式生成威力（含审计）', () => {
    const mage = gen({ name: '焰法师', scale: 'hero', archetype: 'ranged', side: 'enemy', level: 5, abilityBlueprints: ['bp-firestorm'] });
    const bpAbilities = mage.abilities.filter((a) => a.id.startsWith('bp-'));
    expect(bpAbilities.length).toBeGreaterThan(0);
    expect(bpAbilities.length).toBeLessThanOrEqual(2);
    expect(mage.genAudit!.abilities).toBeDefined();
    expect(mage.genAudit!.abilities!.length).toBe(bpAbilities.length);
    // 威力公式：L5 曲线 2d6+3 均值 10 × power(0.85±5%) ≈ 8.1 → 2d6+1 / 3d6 量级
    const firestorm = mage.abilities.find((a) => a.id === 'bp-firestorm');
    if (firestorm) {
      const dmg = firestorm.effects.find((e) => e.op === 'damage')!;
      if (dmg.op === 'damage') {
        expect(dmg.shape).toBe('burst');
        // 魔法系普通段极小 + 主威力全段破甲
        expect(dmg.baseDice).toBe('1d2');
        expect(dmg.apDice).toMatch(/^\d+d6(\+\d+)?$/);
      }
    }
  });

  it('显式蓝图：治疗技能骰随等级曲线走', () => {
    const medic = gen({ name: '军医', scale: 'hero', archetype: 'ranged', side: 'enemy', level: 5, abilityBlueprints: ['bp-mending'] });
    const heal = medic.abilities.find((a) => a.id === 'bp-mending')!;
    const eff = heal.effects[0]!;
    expect(eff.op).toBe('heal');
    if (eff.op === 'heal') {
      // L5 hp 42 × 0.25 ≈ 10.5 → 3d6
      expect(eff.dice).toBe('3d6');
    }
    expect(heal.target).toBe('ally');
  });

  it('杂兵不生成蓝图技能', () => {
    const mook = gen({ name: '鼠群', scale: 'mook', archetype: 'infantry', side: 'enemy', level: 1, abilityBlueprints: ['bp-firestorm'] });
    expect(mook.abilities.filter((a) => a.id.startsWith('bp-'))).toHaveLength(0);
  });

  it('覆盖形态：小规模对同目标两段结算', () => {
    const mage = gen({ name: '焰法师', scale: 'hero', archetype: 'ranged', side: 'ally', level: 5, abilityBlueprints: ['bp-firestorm'] });
    const foe = gen({ name: '靶子', scale: 'hero', archetype: 'infantry', side: 'enemy', level: 5 });
    foe.base.hpMax = 200; foe.hp = 200; // 确保两段都能观测
    const sb = new SmallBattle({ combatants: [mage, foe], seed: 'burst-t', rules: LITE_D20, traitRegistry: reg });
    sb.start();
    const r = sb.useAbility(mage.id, 'bp-firestorm', foe.id, { bypassTurn: true });
    expect(r.ok).toBe(true);
    expect(sb.log.some((l) => l.text.includes('（覆盖）'))).toBe(true);
  });

  it('覆盖形态：军团支援蔓延到第二支敌军', () => {
    const a = gen({ name: '焰法连', scale: 'company', archetype: 'ranged', side: 'ally', level: 4, abilityBlueprints: ['bp-firestorm'] });
    const e1 = gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy', level: 4, traits: ['steadfast'] });
    const e2 = gen({ name: '敌二', scale: 'company', archetype: 'infantry', side: 'enemy', level: 4, traits: ['steadfast'] });
    e1.base.hpMax = 500; e1.hp = 500;
    e2.base.hpMax = 500; e2.hp = 500;
    const mb = new MassBattle({ combatants: [a, e1, e2], seed: 'burst-m', rules: SYSTEM_PACKS.dnd!.mass, traitRegistry: reg });
    mb.start();
    const hp1 = e1.hp;
    const hp2 = e2.hp;
    mb.resolveRound();
    expect(mb.log.some((l) => l.text.includes('支援·覆盖'))).toBe(true);
    expect(e1.hp).toBeLessThanOrEqual(hp1);
    expect(e2.hp).toBeLessThanOrEqual(hp2); // tw 概率命中，允许未命中
  });
});

describe('护甲公式生成', () => {
  it('自由文本装备名（正文对应）：术语随正文，数值走公式', () => {
    const u = gen({ name: '黑铁亲王', scale: 'hero', archetype: 'infantry', side: 'enemy', level: 6, weaponName: '双手巨斧', armorName: '黑铁全身甲' });
    expect(u.weapon!.name).toBe('双手巨斧');
    // 数值仍按曲线基准（L6 2d8+3 + 步兵1 → 2d8+4），不因正文名而失控
    expect(u.weapon!.baseDice).toBe('2d8+4');
    expect(u.armor!.name).toBe('黑铁全身甲');
    expect(u.armor!.drScale ?? 1).toBe(1);
  });  it('armorId 指定原型：术语与减伤效率同源', () => {
    const u = gen({ name: '特警', scale: 'hero', archetype: 'infantry', side: 'enemy', era: 'modern', level: 3, armorId: 'arm-vest' });
    expect(u.armor!.name).toBe('防弹衣');
    expect(u.armor!.drScale).toBeGreaterThanOrEqual(0.65);
    expect(u.armor!.drScale).toBeLessThanOrEqual(0.75);
    // 实际 DR = LITE 表 tier1 20% × drScale≈0.7 ≈ 14%（drScale 与规则包表两层相乘）
    const dr = resolveAttack({
      attacker: gen({ name: '打', scale: 'hero', archetype: 'infantry', side: 'ally', level: 3 }),
      defender: u, rng: new SeededRng('dr1'),
      rules: LITE_D20, conditionDefs: new Map(), traitRegistry: reg, ranged: false,
    });
    expect(dr.drPercent).toBeGreaterThan(10);
    expect(dr.drPercent).toBeLessThan(18);
  });

  it('drScale 浮动 ±0.05 且写入审计', () => {
    const scales = new Set<number>();
    for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10']) {
      const { unit, audit } = generateUnit(
        { name: '兵', scale: 'hero', archetype: 'infantry', level: 3, traits: [], side: 'enemy', era: 'modern', armorId: 'arm-vest' },
        { seed, registry: reg },
      );
      expect(unit.armor!.drScale!).toBeGreaterThanOrEqual(0.65);
      expect(unit.armor!.drScale!).toBeLessThanOrEqual(0.75);
      scales.add(unit.armor!.drScale!);
      void audit;
    }
    expect(scales.size).toBeGreaterThan(1);
  });

  it('默认位保持兼容：medieval 软甲 drScale=1，减伤与规则包表值一致', () => {
    const { unit } = generateUnit(
      { name: '剑士', scale: 'hero', archetype: 'infantry', level: 3, traits: [], side: 'enemy' },
      { seed: 'compat-dr', noVariance: true, registry: reg },
    );
    expect(unit.armor!.drScale ?? 1).toBe(1);
    expect(armorDR(unit, LITE_D20, reg)).toBeCloseTo(0.2); // tier1 软甲 = 表值 20% × 1.0
  });

  it('武器威力浮动：参数化武器 mult ±5% 并记审计', () => {
    const seen = new Set<number>();
    for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12']) {
      const { unit } = generateUnit(
        { name: '终结者', scale: 'hero', archetype: 'infantry', level: 5, traits: [], side: 'enemy', era: 'scifi', loadout: 'ranged', weaponId: 'wpn-bolter' },
        { seed, registry: reg },
      );
      const mult = unit.genAudit!.weapon!.dmgMult;
      expect(mult).toBeGreaterThanOrEqual(1.38); // 1.45 × 0.95
      expect(mult).toBeLessThanOrEqual(1.52); // 1.45 × 1.05
      seen.add(mult);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
