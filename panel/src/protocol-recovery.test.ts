import { describe, expect, it } from 'vitest';
import { parseProtocol, recoverProtocol } from './protocol.js';

describe('草稿字段恢复与错误定位', () => {
  it('保留整个单位和合法字段，只移除坏装备、坏技能及坏修正', () => {
    const text = '<tb>\n<spawn name="卫兵" side="ally" scale="company" hpMax="40" weapon="剑L5+99伤害+穿甲" weapon2="陌生武器L3" armor="重甲L4" skills="治疗L3,火花:魔法单体L4+99伤害+2精度" traits="快速,不存在的特质"/>\n</tb>';
    const repaired = recoverProtocol(text), parsed = parseProtocol(repaired.text);
    expect(parsed.errors).toEqual([]); expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ kind: 'spawn', name: '卫兵', hpMax: 40, weaponClass: 'sword', weaponLevel: 5,
      weaponBonuses: { penetration: 1 }, armorLevel: 4, skills: [{ level: 3 }, { level: 4, bonuses: { accuracy: 2 } }] });
    expect(parsed.events[0]).not.toHaveProperty('weapon2Class'); expect(repaired.text).not.toContain('99');
    expect(repaired.diagnostics.length).toBeGreaterThan(2);
    expect(repaired.diagnostics.map(d => d.start)).toEqual([...repaired.diagnostics.map(d => d.start)].sort((a, b) => a - b));
    expect(repaired.diagnostics.every(d => d.end <= text.length && d.start < d.end)).toBe(true);
  });
  it('未知属性在前也保留后续合法属性，JSON只删除未知键，缺必填值的单位仍留在草稿', () => {
    const text = '<unit_set id="u1" nonsense="1" name="新名字" hp="未知" data="{&quot;xp&quot;:12.5,&quot;unknown&quot;:3}"/>';
    const repaired = recoverProtocol(text);
    expect(parseProtocol(repaired.text).events[0]).toMatchObject({ kind: 'unit-set', data: { name: '新名字', xp: 12.5 } });
    expect(repaired.text).not.toContain('nonsense'); expect(repaired.text).not.toContain('unknown');
    const gear = parseProtocol(recoverProtocol('<give item="护甲" type="armor" spec="重甲L3" qty="未知" quality="4" protection="thermal"/>').text).events[0];
    expect(gear).toMatchObject({ kind: 'give', item: '护甲', spec: { kind: 'armor', power: 3, quality: 4, profile: 'thermal' } });
    const incomplete = recoverProtocol('<spawn name="军团" side="enemy" scale="company" hpMax="未知" armor="重甲L4"/>');
    expect(incomplete.text).toContain('<spawn'); expect(incomplete.text).toContain('name="军团"'); expect(incomplete.text).toContain('armor="重甲L4"');
    expect(incomplete.text).not.toContain('1000000000'); expect(parseProtocol(incomplete.text).errors.length).toBeGreaterThan(0);
  });
  it('错误位置对应原草稿，包括显示转义的标签与多条技能中的坏项', () => {
    const text = '<tb>\n<spawn name="甲" side="ally" scale="hero" weapon="未知L3"/>\n<spawn name="乙" side="enemy" scale="hero" skills="治疗L3,未知技能"/>\n</tb>';
    for (const source of [text, text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')]) {
      const errors = parseProtocol(source).diagnostics;
      expect(source.slice(errors[0]!.start, errors[0]!.end)).toContain('weapon=');
      expect(source.slice(errors.at(-1)!.start, errors.at(-1)!.end)).toBe('未知技能');
    }
  });
});
