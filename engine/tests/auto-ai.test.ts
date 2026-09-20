/**
 * utility 评分自动行动 / 重伤阈值 / 濒死补刀 / 快照掷骰回放 / 军团支援集火 回归。
 * 对应 2026-09 批次：autoAction 从固定优先级改为候选评分，治疗与增益不再是盲区。
 */
import { describe, it, expect } from 'vitest';
import { SmallBattle, makeCombatant } from '../src/small/battle';
import { MassBattle } from '../src/mass/battle';
import { traitRegistry } from '../src/data/traits';
import type { Combatant } from '../src/types';

const reg = traitRegistry();

const mk = (p: Partial<Combatant> & Pick<Combatant, 'id' | 'name' | 'side'>): Combatant =>
  makeCombatant({
    archetype: 'infantry',
    base: { atk: 6, def: 12, spd: 3, hpMax: 24 },
    weapon: { id: 'sword', name: '长剑', baseDice: '1d8+3' },
    pos: 2,
    ...p,
  });

const MUST_HIT = [{ source: 'temp' as const, name: '必中', kind: 'atk' as const, type: 'flat' as const, value: 30 }];

describe('autoAction utility 评分', () => {
  it('奶妈在友军重伤时优先治疗（修复“永不奶”）', () => {
    const healer = mk({
      id: 'h1', name: '牧师', side: 'ally', pos: 2,
      base: { atk: 5, def: 12, spd: 3, hpMax: 20 },
      weapon: { id: 'mace', name: '木杖', baseDice: '1d2' },
      abilities: [
        { id: 'heal-light', name: '圣光术', target: 'ally', cooldown: 3, effects: [{ op: 'heal', dice: '2d6+4' }] },
      ],
    });
    const hurt = mk({ id: 'a2', name: '伤兵', side: 'ally', pos: 2 });
    hurt.hp = 4; // 20% — 急救区间
    const gob = mk({
      id: 'g1', name: '哥布林', side: 'enemy', scale: 'mook', pos: 2,
      base: { atk: 3, def: 12, spd: 2, hpMax: 7 }, hp: 7,
      weapon: { id: 'spear', name: '短矛', baseDice: '1d6+1' },
    });
    const b = new SmallBattle({ combatants: [healer, hurt, gob], seed: 'heal-first', traitRegistry: reg });
    b.start();
    b.turnOrder = [healer.id, hurt.id, gob.id];
    b.turnIndex = 0;
    const before = hurt.hp;
    b.autoAction(healer.id);
    expect(hurt.hp).toBeGreaterThan(before); // 治疗了伤兵
    expect(gob.hp).toBe(7); // 没有去敲哥布林
    expect(healer.abilityState.some((s) => s.abilityId === 'heal-light' && s.used === 1)).toBe(true);
  });

  it('斩杀优先：可击杀的残血敌人优先于高威胁满血敌', () => {
    const striker = mk({
      id: 's1', name: '刺客', side: 'ally', pos: 2,
      base: { atk: 20, def: 12, spd: 3, hpMax: 24 },
    });
    const weak = mk({
      id: 'w1', name: '残血匪徒', side: 'enemy', scale: 'mook', pos: 2,
      base: { atk: 2, def: 10, spd: 2, hpMax: 7 }, hp: 2,
      weapon: { id: 'dagger', name: '匕首', baseDice: '1d4' },
    });
    const brute = mk({
      id: 'b1', name: '兽人战将', side: 'enemy', pos: 2,
      base: { atk: 12, def: 14, spd: 2, hpMax: 40 }, hp: 40,
      weapon: { id: 'greataxe', name: '巨斧', baseDice: '3d6+6' },
    });
    const b = new SmallBattle({ combatants: [striker, weak, brute], seed: 'kill-first', traitRegistry: reg });
    b.start();
    b.turnOrder = [striker.id, weak.id, brute.id];
    b.turnIndex = 0;
    b.autoAction(striker.id);
    expect(weak.status).toBe('dead'); // 斩杀残血，而不是去啃满血高威胁
  });

  it('濒死僵局：无 ready 敌时自动补刀终结战斗', () => {
    const ally = mk({ id: 'a1', name: '哨兵', side: 'ally', pos: 2, base: { atk: 25, def: 12, spd: 3, hpMax: 24 } });
    const foe = mk({ id: 'f1', name: '敌将', side: 'enemy', pos: 2 });
    foe.hp = 0;
    foe.status = 'dying';
    const b = new SmallBattle({ combatants: [ally, foe], seed: 'finish-off', traitRegistry: reg });
    b.start();
    b.turnOrder = [ally.id, foe.id];
    b.turnIndex = 0;
    // 注意：濒死敌在场时 isOver 本就为真（该侧无 ready），补刀循环不能以它为门
    for (let i = 0; i < 10 && foe.status === 'dying'; i++) {
      if (!b.isTurnOf(ally.id)) break;
      b.autoAction(ally.id);
    }
    expect(foe.status).toBe('dead');
    expect(b.winner()).toBe('ally');
  });
});

describe('重伤阈值', () => {
  it('单击伤害 ≥ maxHP×40% 挂【重伤】，重复重击不叠加', () => {
    const striker = mk({
      id: 'a1', name: '重锤手', side: 'ally', pos: 2,
      base: { atk: 30, def: 12, spd: 3, hpMax: 24 },
      weapon: { id: 'maul', name: '战锤', baseDice: '4d6+6' },
    });
    const target = mk({ id: 'f1', name: '靶子', side: 'enemy', pos: 2, base: { atk: 3, def: 10, spd: 2, hpMax: 30 } });
    target.hp = 30;
    const b = new SmallBattle({ combatants: [striker, target], seed: 'wound-2', traitRegistry: reg });
    b.start();
    b.attack(striker.id, target.id, { bypassTurn: true, extraMods: MUST_HIT });
    expect(target.hp).toBeLessThan(30);
    expect(target.conditions.filter((c) => c.id === 'wounded')).toHaveLength(1);
    if (target.status === 'ready') {
      b.attack(striker.id, target.id, { bypassTurn: true, extraMods: MUST_HIT });
      expect(target.conditions.filter((c) => c.id === 'wounded')).toHaveLength(1); // 已挂不重复
    }
  });
});

describe('快照掷骰回放', () => {
  it('快照含种子随机状态：恢复后的行动与原战斗完全一致', () => {
    const a = mk({ id: 'a1', name: '甲', side: 'ally', pos: 2, base: { atk: 8, def: 12, spd: 3, hpMax: 40 } });
    const e = mk({ id: 'e1', name: '乙', side: 'enemy', pos: 2, base: { atk: 8, def: 12, spd: 2, hpMax: 100 } });
    e.hp = 100;
    const b = new SmallBattle({ combatants: [a, e], seed: 'replay-det', traitRegistry: reg });
    b.start();
    const mods = [{ source: 'temp' as const, name: '测试', kind: 'atk' as const, type: 'flat' as const, value: 2 }];
    b.attack('a1', 'e1', { bypassTurn: true, extraMods: mods });

    const snap = JSON.parse(JSON.stringify(b.toSnapshot())) as Record<string, unknown>;
    expect(snap.seed).toBe('replay-det');
    expect(typeof snap.rngState).toBe('number');

    const b2 = SmallBattle.fromSnapshot(snap, { traitRegistry: reg });
    b.attack('a1', 'e1', { bypassTurn: true, extraMods: mods });
    b2.attack('a1', 'e1', { bypassTurn: true, extraMods: mods });
    expect(b2.byId('e1').hp).toBe(b.byId('e1').hp);
    expect(JSON.stringify(b2.log)).toBe(JSON.stringify(b.log)); // 战报逐字一致
  });
});

describe('军团支援阶段', () => {
  it('进攻技能集火血量比最低的敌军', () => {
    const mkc = (id: string, name: string, side: 'ally' | 'enemy', over: Partial<Combatant> = {}) =>
      makeCombatant({
        id, name, side, scale: 'company', archetype: 'infantry',
        base: { atk: 30, def: 12, spd: 2, hpMax: 80, moraleMax: 90 }, hp: 80, morale: 90,
        weapon: { id: 'pike', name: '长枪', baseDice: '2d6+4' },
        ...over,
      });
    const striker = mkc('a1', '炮兵连', 'ally', {
      abilities: [
        { id: 'barrage', name: '炮火急袭', target: 'enemy', cooldown: 1, effects: [{ op: 'damage', baseDice: '3d6+8' }] },
      ],
    });
    const e1 = mkc('e1', '残敌连', 'enemy');
    e1.hp = 20; // 25%
    const e2 = mkc('e2', '满编敌连', 'enemy'); // 100%
    const b = new MassBattle({ combatants: [striker, e1, e2], seed: 'support-focus-2', traitRegistry: reg });
    b.start();
    (b as unknown as { autoSupport: () => void }).autoSupport();
    // 目标必须是残敌连：命中则掉血，未命中也不允许误伤满编连
    expect(e2.hp).toBe(80);
    const targeted = b.log.some((l) => l.kind === 'attack' && l.text.includes('→ 残敌连'));
    if (targeted) expect(e1.hp).toBeLessThan(20);
  });

  it('治疗技能自动支援最重伤员（血量比<50%）', () => {
    const mkc = (id: string, name: string, side: 'ally' | 'enemy', over: Partial<Combatant> = {}) =>
      makeCombatant({
        id, name, side, scale: 'company', archetype: 'infantry',
        base: { atk: 30, def: 12, spd: 2, hpMax: 80, moraleMax: 90 }, hp: 80, morale: 90,
        weapon: { id: 'pike', name: '长枪', baseDice: '2d6+4' },
        ...over,
      });
    const medic = mkc('a1', '医疗连', 'ally', {
      abilities: [
        { id: 'field-medic', name: '战地医疗', target: 'ally', cooldown: 1, effects: [{ op: 'heal', dice: '2d6+10' }] },
      ],
    });
    const hurt = mkc('a2', '伤兵连', 'ally');
    hurt.hp = 30; // 37.5%
    const foe = mkc('e1', '敌军', 'enemy');
    const b = new MassBattle({ combatants: [medic, hurt, foe], seed: 'support-heal', traitRegistry: reg });
    b.start();
    (b as unknown as { autoSupport: () => void }).autoSupport();
    expect(hurt.hp).toBeGreaterThan(30);
    expect(hurt.hp).toBeLessThanOrEqual(80);
  });
});
