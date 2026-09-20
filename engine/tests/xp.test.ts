import { describe, it, expect } from 'vitest';
import { battleXpAwards, applyXp, xpProgress } from '../src/xp';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { CURVES, XP_THRESHOLDS } from '../src/data/curves';

const reg = traitRegistry();

function hero(id: string, side: 'ally' | 'enemy' = 'ally') {
  const { unit } = generateUnit(
    { name: id, scale: 'hero', archetype: 'infantry', level: 1, traits: [], side },
    { seed: `xp-${id}`, noVariance: true, registry: reg },
  );
  unit.id = id;
  return unit;
}

function company(id: string, side: 'ally' | 'enemy' = 'ally') {
  const { unit } = generateUnit(
    { name: id, scale: 'company', archetype: 'infantry', level: 1, traits: [], side },
    { seed: `xp-${id}`, noVariance: true, registry: reg },
  );
  unit.id = id;
  return unit;
}

describe('战后经验分配', () => {
  it('击杀归击杀者，参战份额均分，主指挥胜利加成 25%', () => {
    const a1 = hero('甲');
    const a2 = hero('乙');
    const e1 = hero('丙', 'enemy');
    e1.status = 'dead';
    e1.xpValue = 100;
    const xpByUnit = new Map<string, number>([['甲', 100]]);
    const awards = battleXpAwards([a1, a2, e1], xpByUnit, { won: true, commanderId: '甲' });
    // pool = round(100×0.15)=15 → 每人 7；甲 = 100+7 = 107 → 指挥 +27 = 134；乙 = 7
    const byId = new Map(awards.map((a) => [a.unitId, a]));
    expect(byId.get('甲')!.kills).toBe(100);
    expect(byId.get('甲')!.participation).toBe(7);
    expect(byId.get('甲')!.command).toBe(27);
    expect(byId.get('甲')!.total).toBe(134);
    expect(byId.get('乙')!.total).toBe(7);
  });

  it('战败：幸存者拿安慰份额（5%），无指挥加成，杀敌经验照常入账', () => {
    const a1 = hero('甲');
    const e1 = hero('丙', 'enemy');
    e1.status = 'dead';
    e1.xpValue = 100;
    const awards = battleXpAwards([a1, e1], new Map([['甲', 100]]), { won: false, commanderId: '甲' });
    expect(awards).toHaveLength(1);
    // pool = round(100×0.05) = 5；击杀 100 + 参战 5 = 105
    expect(awards[0]!.kills).toBe(100);
    expect(awards[0]!.participation).toBe(5);
    expect(awards[0]!.command).toBe(0);
    expect(awards[0]!.total).toBe(105);
  });

  it('杀敌后阵亡：击杀经验保留（只无参战/指挥），杀敌后战败不再颗粒无收', () => {
    const dead = hero('甲');
    dead.status = 'dead'; // 杀过敌但战死
    const fled = hero('乙');
    fled.status = 'fled';
    const e1 = hero('丙', 'enemy');
    e1.status = 'dead';
    e1.xpValue = 200;
    const awards = battleXpAwards([dead, fled, e1], new Map([['甲', 80]]), { won: false });
    const byId = new Map(awards.map((a) => [a.unitId, a]));
    // pool = round(200×0.05)=10 → 幸存者乙拿 10；甲保留击杀 80
    expect(byId.get('甲')!.kills).toBe(80);
    expect(byId.get('甲')!.participation).toBe(0);
    expect(byId.get('甲')!.total).toBe(80);
    expect(byId.get('乙')!.total).toBe(10);
  });

  it('连队与英雄同样成长；杂兵群不参与', () => {
    const comp = company('连');
    const mook = { ...hero('杂'), scale: 'mook' as const };
    const e1 = hero('丙', 'enemy');
    e1.status = 'dead';
    e1.xpValue = 200;
    const awards = battleXpAwards([comp, mook, e1], new Map([['连', 50]]), { won: true });
    expect(awards.map((a) => a.unitId)).toEqual(['连']);
    // pool = round(200×0.15)=30 → 唯一幸存者连队拿 30，加击杀 50
    expect(awards[0]!.total).toBe(80);
  });

  it('濒死/溃逃且零击杀的单位不入账，撤离者算参战', () => {
    const a1 = hero('甲');
    a1.status = 'dying';
    const a2 = hero('乙');
    a2.status = 'fled';
    const e1 = hero('丙', 'enemy');
    e1.status = 'dead';
    e1.xpValue = 200;
    const awards = battleXpAwards([a1, a2, e1], new Map(), { won: true });
    expect(awards.map((a) => a.unitId)).toEqual(['乙']);
    expect(awards[0]!.participation).toBe(Math.floor(Math.round(200 * 0.15) / 1));
  });
});

describe('经验入账与升级', () => {
  it('跨过阈值升级并按曲线重算属性（保留浮动与特质）', () => {
    const u = hero('丁');
    const elite = generateUnit(
      { name: '戊', scale: 'hero', archetype: 'infantry', level: 1, traits: ['elite'], side: 'ally' },
      { seed: 'xp-elite', noVariance: true, registry: reg },
    ).unit; // 特质在建档时应用，升级只增长曲线差值
    const r = applyXp(u, XP_THRESHOLDS[1]!, reg); // 300 → Lv2
    expect(r.levelsGained).toBe(1);
    expect(u.level).toBe(2);
    const c2 = CURVES[1]!;
    expect(u.base.atk).toBe(c2.atk); // infantry atk 修正 0、无浮动
    expect(u.base.def).toBe(c2.def + 2); // infantry def +2
    expect(u.base.hpMax).toBe(c2.hp + 4); // infantry hp +4
    expect(u.xpValue).toBe(c2.xp);

    const r2 = applyXp(elite, XP_THRESHOLDS[1]!, reg);
    expect(r2.levelsGained).toBe(1);
    expect(elite.base.atk).toBe(c2.atk + 2); // 精锐特质保留
    expect(elite.base.hpMax).toBe(c2.hp + 4 + 8);
  });

  it('等级封顶 10，XP 继续累计', () => {
    const u = hero('己');
    const r = applyXp(u, 99_999_999, reg);
    expect(u.level).toBe(10);
    expect(r.levelsGained).toBe(9);
    expect(u.xp).toBe(99_999_999);
    expect(xpProgress(u)).toBeNull();
  });

  it('xpProgress 返回当前与下一级阈值', () => {
    const u = hero('庚');
    applyXp(u, 120, reg);
    const p = xpProgress(u)!;
    expect(p.current).toBe(120);
    expect(p.next).toBe(XP_THRESHOLDS[1]!);
  });

  it('连队入账经验同样自动升级：训练不增加编制或兵员', () => {
    const u = company('连');
    const hpMax = u.base.hpMax;
    const hp = u.hp;
    const r = applyXp(u, XP_THRESHOLDS[1]!, reg);
    expect(r.levelsGained).toBe(1);
    expect(u.level).toBe(2);
    expect(u.base.hpMax).toBe(hpMax);
    expect(u.hp).toBe(hp);
    expect(xpProgress(u)).not.toBeNull();
  });

  it('C05：L4 军团 70/560 升到 L5 后保持 70/560 和原装备', () => {
    const u = generateUnit(
      { name: 'A军团', scale: 'company', side: 'ally', level: 4, traits: [], weaponClass: 'rifle', weaponLevel: 9 },
      { seed: 'c05', noVariance: true, registry: reg },
    ).unit;
    u.base.hpMax = 560;
    u.hp = 70;
    const equipment = structuredClone({ weapon: u.weapon, sidearm: u.sidearm, armor: u.armor, abilities: u.abilities });
    applyXp(u, XP_THRESHOLDS[4]!, reg);
    expect(u.level).toBe(5);
    expect([u.hp, u.base.hpMax]).toEqual([70, 560]);
    expect({ weapon: u.weapon, sidearm: u.sidearm, armor: u.armor, abilities: u.abilities }).toEqual(equipment);
  });

  it('英雄生命成长保留自定义生命上限偏移且不会治疗；升级不重写武器', () => {
    const u = hero('受伤英雄');
    const originalMax = u.base.hpMax;
    u.base.hpMax = 40;
    u.hp = 18;
    const weapon = structuredClone(u.weapon);
    applyXp(u, XP_THRESHOLDS[1]!, reg);
    expect(u.hp).toBe(18);
    expect(u.base.hpMax).toBe(40 + CURVES[1]!.hp - (originalMax - 4));
    expect(u.weapon).toEqual(weapon);
  });
});
