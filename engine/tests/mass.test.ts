import { describe, it, expect } from 'vitest';
import { MassBattle } from '../src/mass/battle';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { MASS_TW } from '../src/rules';

const reg = traitRegistry();

function army(seedPrefix: string) {
  const mk = (name: string, arch: 'infantry' | 'ranged' | 'mobile', side: 'ally' | 'enemy', level: number, traits: string[] = []) =>
    generateUnit(
      { name, scale: 'company', archetype: arch, level, traits, side },
      { seed: `${seedPrefix}-${name}`, noVariance: true, registry: reg },
    ).unit;
  return { mk };
}

describe('军团会战流程', () => {
  it('5v5 模拟战斗可全流程跑完并分出胜负', () => {
    const { mk } = army('sim');
    const units = [
      mk('王国步兵', 'infantry', 'ally', 3),
      mk('王国弓手', 'ranged', 'ally', 3),
      mk('王国骑士', 'mobile', 'ally', 4),
      mk('王国步兵二队', 'infantry', 'ally', 2),
      mk('王国弩手', 'ranged', 'ally', 2),
      mk('兽人战士', 'infantry', 'enemy', 3),
      mk('兽人弓手', 'ranged', 'enemy', 3),
      mk('狼骑兵', 'mobile', 'enemy', 4),
      mk('兽人战士二队', 'infantry', 'enemy', 2),
      mk('萨满卫队', 'infantry', 'enemy', 2),
    ];
    const b = new MassBattle({ combatants: units, seed: 'mass-sim', traitRegistry: reg });
    b.start();
    let guard = 0;
    while (!b.isOver() && guard++ < 45) {
      // 简单 AI：各自攻击最近的敌人（弓手齐射、骑士冲锋）
      for (const u of b.readyUnits('ally')) {
        const foes = b.readyUnits('enemy');
        if (!foes.length) break;
        const t = foes[0]!;
        const type = u.archetype === 'ranged' ? 'volley' : u.archetype === 'mobile' ? 'charge' : 'attack';
        const r = b.issue({ unitId: u.id, type, targetId: t.id });
        if (!r.ok) b.issue({ unitId: u.id, type: 'attack', targetId: t.id });
      }
      for (const u of b.readyUnits('enemy')) {
        const foes = b.readyUnits('ally');
        if (!foes.length) break;
        const t = foes[0]!;
        const type = u.archetype === 'ranged' ? 'volley' : u.archetype === 'mobile' ? 'charge' : 'attack';
        const r = b.issue({ unitId: u.id, type, targetId: t.id });
        if (!r.ok) b.issue({ unitId: u.id, type: 'attack', targetId: t.id });
      }
      b.resolveRound();
    }
    expect(guard).toBeLessThan(45); // 不能打满上限仍不分胜负
    expect(b.isOver()).toBe(true);
    expect(['ally', 'enemy', 'draw']).toContain(b.winner());
    expect(b.log.length).toBeGreaterThan(10);
  });

  it('指挥点限制与返还', () => {
    const { mk } = army('cp');
    const units = [mk('步一', 'infantry', 'ally', 1), mk('骑一', 'mobile', 'ally', 1), mk('敌', 'infantry', 'enemy', 1)];
    const b = new MassBattle({ combatants: units, seed: 'cp-test', traitRegistry: reg });
    b.start();
    const cp0 = b.cp.ally;
    expect(cp0).toBe(2 + 1); // 2 + floor(2/2) = 3
    expect(b.issue({ unitId: units[1]!.id, type: 'charge', targetId: units[2]!.id }).ok).toBe(true);
    expect(b.cp.ally).toBe(cp0 - 1);
    b.revoke(units[1]!.id);
    expect(b.cp.ally).toBe(cp0);
    // 指令去重
    b.issue({ unitId: units[0]!.id, type: 'attack', targetId: units[2]!.id });
    expect(b.issue({ unitId: units[0]!.id, type: 'hold' }).ok).toBe(false);
  });

  it('只有机动/冲锋特质单位可冲锋', () => {
    const { mk } = army('chg');
    const inf = mk('步兵队', 'infantry', 'ally', 2);
    const cav = mk('骑队', 'mobile', 'ally', 2);
    const foe = mk('敌队', 'infantry', 'enemy', 2);
    const b = new MassBattle({ combatants: [inf, cav, foe], seed: 'chg-test', traitRegistry: reg });
    b.start();
    expect(b.issue({ unitId: inf.id, type: 'charge', targetId: foe.id }).ok).toBe(false);
    expect(b.issue({ unitId: cav.id, type: 'charge', targetId: foe.id }).ok).toBe(true);
  });

  it('齐射被贴身后失效', () => {
    const { mk } = army('eng');
    const archers = mk('弓队', 'ranged', 'ally', 2);
    const inf = mk('步队', 'infantry', 'ally', 2);
    const foeInf = mk('敌步', 'infantry', 'enemy', 2);
    const b = new MassBattle({ combatants: [archers, inf, foeInf], seed: 'eng-test', traitRegistry: reg });
    b.start();
    // 步兵接敌 → 弓手仍在后方可齐射
    expect(b.issue({ unitId: inf.id, type: 'attack', targetId: foeInf.id }).ok).toBe(true);
    expect(b.issue({ unitId: archers.id, type: 'volley', targetId: foeInf.id }).ok).toBe(true);
    b.resolveRound();
    // 敌步兵攻击弓手 → 贴身
    b.issue({ unitId: foeInf.id, type: 'attack', targetId: archers.id });
    b.resolveRound();
    expect(archers.engagedWith).toContain(foeInf.id);
    expect(b.issue({ unitId: archers.id, type: 'volley', targetId: foeInf.id }).ok).toBe(false);
  });

  it('接战每回合积累疲劳，脱战恢复', () => {
    const { mk } = army('fat');
    const a = mk('步A', 'infantry', 'ally', 5);
    const c = mk('步B', 'infantry', 'enemy', 5);
    const b = new MassBattle({ combatants: [a, c], seed: 'fat-test', traitRegistry: reg });
    b.start();
    b.issue({ unitId: a.id, type: 'attack', targetId: c.id });
    b.resolveRound();
    expect(a.engagedWith.length).toBe(1);
    expect(a.fatigue).toBeGreaterThanOrEqual(1);
    // 撤退脱战 → 恢复
    b.issue({ unitId: a.id, type: 'retreat' });
    b.resolveRound();
    expect(a.engagedWith.length).toBe(0);
    expect(a.fatigue).toBe(0);
  });

  it('重伤亡触发士气检定，失败则溃逃且不溃特质免疫', () => {
    const { mk } = army('morale');
    const fragile = mk('民兵队', 'infantry', 'ally', 1); // 50 人
    const steady = mk('禁卫队', 'infantry', 'ally', 6, ['steadfast']);
    const killer = mk('屠夫团', 'infantry', 'enemy', 10);
    killer.base.atk = 40; // 必中重创
    const b = new MassBattle({ combatants: [fragile, steady, killer], seed: 'morale-fail', traitRegistry: reg });
    b.start();
    b.issue({ unitId: killer.id, type: 'attack', targetId: fragile.id });
    b.resolveRound();
    const taken = b.damageTaken.get(fragile.id);
    // L10 武器 4d6+6+1 对 50 人必超 15% 阈值 → 检定已发生
    expect(taken ?? 0).toBeGreaterThan(fragile.base.hpMax * 0.15 - 1);
    const moraleLogged = b.log.some((l) => (l.kind === 'morale' || l.kind === 'routing') && l.text.includes(fragile.name));
    expect(moraleLogged).toBe(true);
    // 不溃：检定被跳过且状态保持
    expect(steady.status).toBe('ready');
    b.issue({ unitId: killer.id, type: 'attack', targetId: steady.id });
    b.resolveRound();
    expect(steady.status).toBe('ready');
    expect(b.log.some((l) => l.text.includes('不溃'))).toBe(true);
  });

  it('溃逃连锁：邻近受损单位追加检定', () => {
    const { mk } = army('cascade');
    const weak1 = mk('农兵一', 'infantry', 'ally', 1);
    const weak2 = mk('农兵二', 'infantry', 'ally', 1);
    weak2.base.hpMax = 50; weak2.hp = 20; // 已损过半
    weak1.morale = 0; // 士气见底：重击之下必然崩溃
    weak2.morale = 0;
    const monster = mk('巨兽', 'infantry', 'enemy', 10, ['terror']);
    monster.base.atk = 50;
    const b = new MassBattle({ combatants: [weak1, weak2, monster], seed: 'cascade-test', traitRegistry: reg, zones: ['左翼', '中军', '右翼'] });
    weak1.tags.push('zone:中军');
    weak2.tags.push('zone:中军');
    monster.tags.push('zone:中军');
    b.start();
    b.issue({ unitId: monster.id, type: 'attack', targetId: weak1.id });
    b.resolveRound();
    // 新士气模型：累计伤亡使弱2直接进入主检定；若其挺住主检定，目睹弱1溃逃会追加连锁检定。
    // 恐怖光环(-15)与见底士气下两者必然发生士气事件——断言不依赖具体掷骰面。
    const cascadeLogged = b.log.some((l) => l.text.includes('目睹') && l.text.includes('溃逃'));
    const routedCount = [weak1, weak2].filter((u) => (b.routCounts.get(u.id) ?? 0) > 0).length;
    expect(cascadeLogged || routedCount >= 2).toBe(true);
  });

  it('击溃敌方入账经验', () => {
    const { mk } = army('xp');
    const a = mk('精锐', 'infantry', 'ally', 6);
    const e = mk('炮灰', 'infantry', 'enemy', 1);
    e.base.hpMax = 1; e.hp = 1;
    const b = new MassBattle({
      combatants: [a, e], seed: 'xp-test', traitRegistry: reg,
      rules: { ...MASS_TW, tw: { ...MASS_TW.tw, max: 1, min: 1 } }, // 测试用必中
    });
    b.start();
    b.issue({ unitId: a.id, type: 'attack', targetId: e.id });
    b.resolveRound();
    expect(e.status).toBe('dead');
    expect(b.xpGained).toBe(e.xpValue);
    expect(b.xpByUnit.get(a.id)).toBe(e.xpValue); // 击杀记名
    expect(b.isOver()).toBe(true);
    expect(b.winner()).toBe('ally');
  });

  it('齐射资格：无远程武器不能齐射，骑射连队可以', () => {
    const { mk } = army('vol');
    const inf = mk('步队', 'infantry', 'ally', 2);
    const foe = mk('敌弓', 'ranged', 'enemy', 2);
    const b = new MassBattle({ combatants: [inf, foe], seed: 'vol-test', traitRegistry: reg });
    b.start();
    expect(b.issue({ unitId: inf.id, type: 'volley', targetId: foe.id }).ok).toBe(false);

    const ha = generateUnit(
      { name: '弓骑', scale: 'company', archetype: 'mobile', level: 2, traits: [], side: 'ally', loadout: 'ranged' },
      { seed: 'ha-co', noVariance: true, registry: reg },
    ).unit;
    const b2 = new MassBattle({ combatants: [ha, foe], seed: 'vol-test2', traitRegistry: reg });
    b2.start();
    expect(b2.issue({ unitId: ha.id, type: 'volley', targetId: foe.id }).ok).toBe(true);
  });

  it('骑射反击：冲锋未接战的骑射连队先吃一轮箭', () => {
    const { mk } = army('ow');
    const ha = generateUnit(
      { name: '弓骑', scale: 'company', archetype: 'mobile', level: 2, traits: [], side: 'ally', loadout: 'ranged' },
      { seed: 'ha-ow', noVariance: true, registry: reg },
    ).unit;
    const cav = mk('敌骑', 'mobile', 'enemy', 2);
    const b = new MassBattle({ combatants: [ha, cav], seed: 'ow-test', traitRegistry: reg });
    b.start();
    b.issue({ unitId: cav.id, type: 'charge', targetId: ha.id });
    b.resolveRound();
    expect(b.log.some((l) => l.text.includes('骑射反击'))).toBe(true);
  });

  it('autoOrders 自动列阵：远程齐射、机动冲锋、近战攻击', () => {
    const { mk } = army('auto');
    const inf = mk('步一', 'infantry', 'ally', 2);
    const arch = mk('弓一', 'ranged', 'ally', 2);
    const cav = mk('骑一', 'mobile', 'ally', 2);
    const foe = mk('敌', 'infantry', 'enemy', 2);
    const b = new MassBattle({ combatants: [inf, arch, cav, foe], seed: 'auto-test', traitRegistry: reg });
    b.start();
    const n = b.autoOrders('ally');
    expect(n).toBe(3);
    expect(b.orders.get(inf.id)!.type).toBe('attack');
    expect(b.orders.get(arch.id)!.type).toBe('volley');
    expect(b.orders.get(cav.id)!.type).toBe('charge');
  });

  it('主指挥阵亡：指挥点减半且失去手动指挥资格', () => {
    const { mk } = army('cmd');
    const cmd = mk('主帅', 'infantry', 'ally', 1);
    const killer = mk('斩首者', 'infantry', 'enemy', 10);
    killer.base.atk = 60;
    cmd.base.hpMax = 1; cmd.hp = 1;
    const b = new MassBattle({
      combatants: [cmd, killer], seed: 'cmd-test', traitRegistry: reg, commanderId: cmd.id,
      rules: { ...MASS_TW, tw: { ...MASS_TW.tw, max: 1, min: 1 } }, // 测试用必中
    });
    b.start();
    expect(b.manualCommandAllowed).toBe(true);
    b.issue({ unitId: killer.id, type: 'attack', targetId: cmd.id });
    b.resolveRound();
    expect(cmd.status).toBe('dead');
    expect(b.commanderLost).toBe(true);
    expect(b.manualCommandAllowed).toBe(false);
    expect(b.log.some((l) => l.text.includes('主帅') && l.text.includes('失去统一指挥'))).toBe(true);
    expect(b.cp.ally).toBe(1); // 2+floor(0/2)=2 → 减半取整为 1
  });

  it('友方防御技能拒绝敌军目标，只给友军施加增益', () => {
    const { mk } = army('mass-ally-skill');
    const caster = mk('军阵祭司', 'infantry', 'ally', 3);
    const friend = mk('友军步阵', 'infantry', 'ally', 3);
    const enemy = mk('敌军步阵', 'infantry', 'enemy', 3);
    caster.abilities.push({
      id: 'mass-guard', name: '军阵守护', target: 'ally',
      effects: [{ op: 'condition', conditionId: 'encouraged', dur: 2 }],
    });
    caster.abilityState.push({ abilityId: 'mass-guard', cdLeft: 0, used: 0 });
    const b = new MassBattle({ combatants: [caster, friend, enemy], seed: 'mass-ally-target', traitRegistry: reg });
    b.start();

    expect(b.useAbility(caster.id, 'mass-guard', enemy.id).ok).toBe(false);
    expect(enemy.conditions.some((c) => c.id === 'encouraged')).toBe(false);
    expect(b.useAbility(caster.id, 'mass-guard', friend.id).ok).toBe(true);
    expect(friend.conditions.some((c) => c.id === 'encouraged')).toBe(true);
  });
});

describe('翼位门禁（军团）', () => {
  const zones = ['左翼', '中军', '右翼'];
  const setZone = (u: ReturnType<ReturnType<typeof army>['mk']>, z: string) => {
    u.tags = [...u.tags.filter((t) => !t.startsWith('zone:')), `zone:${z}`];
    return u;
  };

  it('近战/冲锋只能打同翼或相邻翼目标，异翼被拒', () => {
    const { mk } = army('wing');
    const attacker = setZone(mk('我右翼步兵', 'infantry', 'ally', 5), '右翼');
    const adjacent = setZone(mk('敌中军步兵', 'infantry', 'enemy', 5), '中军');
    const far = setZone(mk('敌左翼步兵', 'infantry', 'enemy', 5), '左翼');
    const b = new MassBattle({ combatants: [attacker, adjacent, far], seed: 'wing-test', traitRegistry: reg, zones });
    b.start();
    // 右翼打中军（相邻）→ 允许
    expect(b.issue({ unitId: attacker.id, type: 'attack', targetId: adjacent.id }).ok).toBe(true);
    b.revoke(attacker.id);
    // 右翼打左翼（不相邻：右翼仅邻中军）→ 拒绝
    const r = b.issue({ unitId: attacker.id, type: 'attack', targetId: far.id });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不在本机翼');
  });

  it('无 zones 时不受翼限制', () => {
    const { mk } = army('wing2');
    const attacker = mk('我步兵', 'infantry', 'ally', 5);
    const far = setZone(mk('敌步兵', 'infantry', 'enemy', 5), '左翼');
    const b = new MassBattle({ combatants: [attacker, far], seed: 'wing2-test', traitRegistry: reg });
    b.start();
    expect(b.issue({ unitId: attacker.id, type: 'attack', targetId: far.id }).ok).toBe(true);
  });

  it('前排会掩护同翼后排，前排离场后后排可被近战', () => {
    const { mk } = army('rank-cover');
    const attacker = setZone(mk('突击队', 'infantry', 'ally', 5), '中军');
    const front = setZone(mk('敌前排', 'infantry', 'enemy', 5), '中军');
    const rear = setZone(mk('敌后排', 'ranged', 'enemy', 5), '中军');
    attacker.tags.push('rank:front');
    front.tags.push('rank:front');
    rear.tags.push('rank:rear');
    const b = new MassBattle({ combatants: [attacker, front, rear], seed: 'rank-cover-test', traitRegistry: reg, zones });
    b.start();

    expect(b.issue({ unitId: attacker.id, type: 'attack', targetId: rear.id }).ok).toBe(false);
    front.status = 'dead';
    expect(b.issue({ unitId: attacker.id, type: 'attack', targetId: rear.id }).ok).toBe(true);
  });

  it('可在回合中横移翼位并调整前后排', () => {
    const { mk } = army('maneuver');
    const mover = setZone(mk('机动预备队', 'mobile', 'ally', 3), '中军');
    const enemy = setZone(mk('敌军', 'infantry', 'enemy', 3), '右翼');
    mover.tags.push('rank:rear');
    enemy.tags.push('rank:front');
    const b = new MassBattle({ combatants: [mover, enemy], seed: 'maneuver-test', traitRegistry: reg, zones });
    b.start();

    expect(b.issue({ unitId: mover.id, type: 'shift-left' }).ok).toBe(true);
    b.resolveRound();
    expect(b.zoneOf(mover)).toBe('左翼');
    expect(b.log.some((l) => l.kind === 'move' && l.text.includes('转移战区'))).toBe(true);

    expect(b.issue({ unitId: mover.id, type: 'rank-forward' }).ok).toBe(true);
    b.resolveRound();
    expect(b.rankOf(mover)).toBe('front');
    expect(b.log.some((l) => l.kind === 'move' && l.text.includes('变阵'))).toBe(true);
  });

  it('自动军令会让隔翼近战部队先横移接近', () => {
    const { mk } = army('auto-maneuver');
    const ally = setZone(mk('左翼步兵', 'infantry', 'ally', 3), '左翼');
    const enemy = setZone(mk('右翼敌军', 'infantry', 'enemy', 3), '右翼');
    ally.tags.push('rank:front');
    enemy.tags.push('rank:front');
    const b = new MassBattle({ combatants: [ally, enemy], seed: 'auto-maneuver-test', traitRegistry: reg, zones });
    b.start();

    expect(b.autoOrders('ally')).toBe(1);
    expect(b.orders.get(ally.id)?.type).toBe('shift-right');
    b.resolveRound();
    expect(b.zoneOf(ally)).toBe('中军');
  });
});
