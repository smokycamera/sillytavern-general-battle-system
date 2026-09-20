/**
 * 武器「任意名字＋种类＋等级」格式端到端：标签解析 → 生成输入映射（与 main.ts spawn 批准同构）→ generateUnit。
 * 契约：名字只进 weapon.name（面板显示）；种类+等级决定伤害骰与射程。
 */
import { describe, it, expect } from 'vitest';
import { parseSuggestionTags } from './tags.js';
import { generateUnit } from '../../engine/src/index.js';

type SpawnSug = Extract<ReturnType<typeof parseSuggestionTags>['suggestions'][number], { kind: 'spawn' }>;

/** 与 main.ts spawn 批准处同构的武器映射（显示名优先，种类+等级驱动数值） */
function weaponInput(s: SpawnSug, level: number) {
  const weaponLabel = s.weaponName ?? s.weapon;
  return s.weaponClass
    ? { weaponClass: s.weaponClass, weaponLevel: s.weaponLevel ?? level, weaponName: weaponLabel }
    : s.weapon
      ? { weaponName: s.weapon }
      : {};
}

/** 与 main.ts spawn 批准处同构的护甲映射（显式 档位+等级优先；库名匹配路径由面板查 ARMOR_LIBRARY，不在此覆盖） */
function armorInput(s: SpawnSug) {
  if (s.armorTier !== undefined) {
    return { armorTier: s.armorTier, ...(s.armorName ? { armorName: s.armorName } : {}), ...(s.armorLevel ? { armorLevel: s.armorLevel } : {}) };
  }
  return s.armor ? { armorName: s.armor } : {};
}

describe('weapon="名字:种类L等级" 端到端', () => {
  it('名字进 weapon.name（显示），斧L6 的骰面与射程来自斧分类 × L6 曲线', () => {
    const r = parseSuggestionTags(
      '<spawn name="黑铁亲卫" side="enemy" archetype="infantry" level="6" weapon="裂颅者:斧L6" armor="重甲"/>',
    );
    const s = r.suggestions[0] as SpawnSug;
    const { unit } = generateUnit({
      name: s.name, side: s.side ?? 'enemy', archetype: s.archetype, scale: 'hero',
      level: s.level, traits: [], era: 'medieval', ...weaponInput(s, s.level),
    }, { noVariance: true });
    // 显示：只出现名字，不出现「斧」分类或 L6 标记
    expect(unit.weapon!.name).toBe('裂颅者');
    // 数值：斧分类 dmgMult 1.15 → 非 L6 曲线直出（mult=1 才直出）
    expect(unit.genAudit!.weapon!.dmgMult).toBe(1.15);
    expect(unit.weapon!.range).toBe(0);
    // 生成审计里能查到武器等级来源
    expect(unit.genAudit!.input.weaponLevel).toBe(6);
  });

  it('远程分类：守护之弓:弓弩L4 → 射程 4，显示名 守护之弓', () => {
    const r = parseSuggestionTags(
      '<spawn name="侍女·樱" side="ally" archetype="ranged" level="2" weapon="守护之弓:弓弩L4" armor="轻甲"/>',
    );
    const s = r.suggestions[0] as SpawnSug;
    const { unit } = generateUnit({
      name: s.name, side: 'ally', archetype: s.archetype, scale: 'hero',
      level: s.level, traits: [], era: 'medieval', ...weaponInput(s, s.level),
    }, { noVariance: true });
    expect(unit.weapon!.name).toBe('守护之弓');
    expect(unit.weapon!.range).toBe(4);
    expect(unit.weapon!.tags).toContain('ranged');
  });

  it('旧格式回退：纯名字「双手巨斧」→ 关键词猜斧分类、等级随单位；「剑L5」→ 显示名用原文', () => {
    const r = parseSuggestionTags(
      [
        '<spawn name="A" side="enemy" archetype="infantry" level="4" weapon="双手巨斧"/>',
        '<spawn name="B" side="enemy" archetype="infantry" level="4" weapon="剑L5"/>',
      ].join('\n'),
    );
    const a = generateUnit({
      name: 'A', side: 'enemy', archetype: 'infantry', scale: 'hero', level: 4, traits: [], era: 'medieval',
      ...weaponInput(r.suggestions[0] as SpawnSug, 4),
    }, { noVariance: true }).unit;
    expect(a.weapon!.name).toBe('双手巨斧');
    expect(a.genAudit!.input.weaponClass).toBe('axe');
    expect(a.genAudit!.input.weaponLevel).toBe(4); // 未给等级 → 单位等级

    const b = generateUnit({
      name: 'B', side: 'enemy', archetype: 'infantry', scale: 'hero', level: 4, traits: [], era: 'medieval',
      ...weaponInput(r.suggestions[1] as SpawnSug, 4),
    }, { noVariance: true }).unit;
    expect(b.weapon!.name).toBe('剑L5'); // 旧格式无名字段：显示名=原文
    expect(b.genAudit!.input.weaponLevel).toBe(5);
  });
});

describe('weapon2="名字:种类L等级" 端到端（近战副武器）', () => {
  /** 与 main.ts spawn 批准处同构的副武器映射 */
  function sidearmInput(s: SpawnSug, level: number) {
    if (!s.weapon2) return {};
    const label = s.weapon2Name ?? s.weapon2;
    return s.weapon2Class
      ? { sidearmClass: s.weapon2Class, sidearmLevel: s.weapon2Level ?? level, sidearmName: label }
      : { sidearmName: label };
  }

  it('短剑:剑L3 → 副武器按剑分类 × L3 曲线生成，range 0、不带 ranged 标签；主武器不变', () => {
    const r = parseSuggestionTags(
      '<spawn name="游侠" side="ally" archetype="ranged" level="4" weapon="守护之弓:弓弩L4" weapon2="短剑:剑L3"/>',
    );
    const s = r.suggestions[0] as SpawnSug;
    const { unit } = generateUnit({
      name: s.name, side: 'ally', archetype: s.archetype, scale: 'hero',
      level: s.level, traits: [], era: 'medieval',
      ...weaponInput(s, s.level), ...sidearmInput(s, s.level),
    }, { noVariance: true });
    expect(unit.weapon!.name).toBe('守护之弓'); // 主武器不受影响
    expect(unit.weapon!.tags).toContain('ranged');
    expect(unit.sidearm).toBeTruthy();
    expect(unit.sidearm!.name).toBe('短剑');
    expect(unit.sidearm!.range).toBe(0);
    expect(unit.sidearm!.tags).not.toContain('ranged');
    expect(unit.sidearm!.level).toBe(3);
    // 数值与近战主武器同源：同为 剑L3（近战步兵 dmgFlat）的骰面一致
    const swordsman = generateUnit({
      name: '剑士', side: 'ally', archetype: 'infantry', scale: 'hero',
      level: 4, traits: [], era: 'medieval',
      weaponClass: 'sword', weaponLevel: 3,
    }, { noVariance: true }).unit;
    // 原型 dmgFlat 随原型不同（射手 vs 步兵），只断言骰型一致（同为 1d8 系）
    expect(unit.sidearm!.baseDice).toMatch(/^1d8/);
    expect(swordsman.weapon!.baseDice).toMatch(/^1d8/);
  });

  it('裸名字「副手弩」猜不中近战分类 → 按皮肤默认近战位兜底（数值=长剑位，显示名保留）', () => {
    const r = parseSuggestionTags(
      '<spawn name="弩手" side="enemy" archetype="ranged" level="3" weapon="军用弩:弓弩L3" weapon2="副手短匕"/>',
    );
    const s = r.suggestions[0] as SpawnSug;
    const { unit } = generateUnit({
      name: s.name, side: 'enemy', archetype: s.archetype, scale: 'hero',
      level: s.level, traits: [], era: 'medieval',
      ...weaponInput(s, s.level), ...sidearmInput(s, s.level),
    }, { noVariance: true });
    // 「匕」不在关键词表 → 无 weapon2Class → 生成器回退皮肤 sidearmId（长剑，mult=1 曲线直出）
    expect(s.weapon2Class).toBeUndefined();
    expect(unit.sidearm!.name).toBe('副手短匕');
    expect(unit.sidearm!.range).toBe(0);
  });
});

describe('armor="名字:种类L等级" 端到端', () => {
  it('龙鳞宝铠:重甲L6 → 显示名龙鳞宝铠、档位 3、品质 L6 放大减伤效率', () => {
    const r = parseSuggestionTags(
      '<spawn name="A" side="enemy" archetype="infantry" level="3" armor="龙鳞宝铠:重甲L6"/>',
    );
    const s = r.suggestions[0] as SpawnSug;
    const { unit } = generateUnit({
      name: s.name, side: 'enemy', archetype: s.archetype, scale: 'hero',
      level: s.level, traits: [], era: 'medieval', ...weaponInput(s, s.level), ...armorInput(s),
    }, { noVariance: true });
    expect(unit.armor!.name).toBe('龙鳞宝铠');
    expect(unit.armor!.tier).toBe(3);
    // medieval 默认位 drScale=1.0，L6 品质乘数 0.8+0.04×6=1.04
    expect(unit.armor!.drScale).toBe(1.04);
    expect(unit.genAudit!.input.armorLevel).toBe(6);
  });

  it('纯档位名 "重甲" → 档位 3、无品质等级（drScale 保持基准）', () => {
    const r = parseSuggestionTags('<spawn name="B" side="enemy" archetype="infantry" level="3" armor="重甲"/>');
    const s = r.suggestions[0] as SpawnSug;
    const { unit } = generateUnit({
      name: s.name, side: 'enemy', archetype: s.archetype, scale: 'hero',
      level: s.level, traits: [], era: 'medieval', ...armorInput(s),
    }, { noVariance: true });
    expect(unit.armor!.name).toBe('重甲');
    expect(unit.armor!.tier).toBe(3);
    expect(unit.armor!.drScale ?? 1).toBe(1);
  });
});

describe('skills="名字:蓝图L等级" 端到端', () => {
  it('焚天:烈焰风暴L6 → 技能名 焚天，威力按 L6 曲线（强于 L2）', () => {
    const r = parseSuggestionTags(
      '<spawn name="焰法师" side="enemy" archetype="ranged" level="2" skills="焚天:烈焰风暴L6"/>',
    );
    const s = r.suggestions[0] as SpawnSug;
    const input = {
      name: s.name, side: 'enemy' as const, archetype: s.archetype as 'ranged', scale: 'hero' as const,
      level: s.level, traits: [], era: 'medieval',
      abilityBlueprints: s.skills!.map((k) => ({ id: k.blueprintId, ...(k.level ? { level: k.level } : {}), ...(k.name ? { name: k.name } : {}) })),
    };
    const { unit } = generateUnit(input, { noVariance: true });
    const ability = unit.abilities.find((a) => a.id === 'bp-firestorm')!;
    expect(ability.name).toBe('焚天');
    // 对照：不带等级（按单位 L2）生成的同名蓝图骰面更小
    const { unit: baseline } = generateUnit({ ...input, abilityBlueprints: ['bp-firestorm'] }, { noVariance: true });
    const bAbility = baseline.abilities.find((a) => a.id === 'bp-firestorm')!;
    const apOf = (a: { effects: { op: string; apDice?: string }[] }) =>
      a.effects.find((e) => e.op === 'damage')?.apDice ?? '';
    const diceSum = (expr: string) => expr.split(/[d+]/).reduce((sum, x) => sum + (parseInt(x, 10) || 0), 0);
    expect(diceSum(apOf(ability))).toBeGreaterThan(diceSum(apOf(bAbility)));
  });
});
