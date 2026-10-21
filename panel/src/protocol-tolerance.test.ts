import { describe, expect, it } from 'vitest';
import { parseProtocol, protocolExcerpt } from './protocol.js';

describe('正文格式容错', () => {
  it('give和take兼容裸短编号及qty紧写，保留数量校验和原文定位', () => {
    const text = '<give u1，u2 c4 qty2/><give c4 to=u1 qt=1/><take id=c4 qty1/>';
    const parsed = parseProtocol(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.events).toMatchObject([{ kind: 'give', id: 'c4', to: ['u1', 'u2'], qty: 2 }, { kind: 'give', id: 'c4', to: ['u1'], qty: 1 }, { kind: 'take', id: 'c4', qty: 1 }]);
    expect(parseProtocol(parsed.canonical).events).toEqual(parsed.events);
    for (const attrs of ['c4 c5 qty1', 'c4 qty1 qty2', 'c4 qty0', 'c4 qty-1', 'c4 qty1.5', 'c4 qty9007199254740992']) expect(parseProtocol(`<take ${attrs}/>`).errors.length, attrs).toBeGreaterThan(0);
    const invalid = '<take c4 qty-1/>', bad = parseProtocol(invalid);
    expect(bad.diagnostics.some(issue => invalid.slice(issue.start, issue.end).includes('-1'))).toBe(true);
  });
  it('中英文引号、分隔符及全角标签生成相同事件，名称和说明中的标点保留', () => {
    const sources = [
      '<tb><add item="药，瓶；甲" spec="buff治疗L3+2治疗" qty="2" to="u1"/><give id="c1" to="u2,u3" qty="1"/><reforge id="c1" spec="buff治疗L4" name="新药"/></tb>',
      '＜tb＞＜add item＝＂药，瓶；甲＂、spec：‘buff治疗Ｌ３＋２治疗’；qty＝＇２＇，u1／＞＜give id＝「c1」，to＝『u2｜u3』；qty＝＂１＂／＞＜reforge id＝“c1”、spec＝＇buff治疗Ｌ４＇，name＝「新药」／＞＜／tb＞',
      '<tb><add u1｜item=「药，瓶；甲」、spec=buff治疗L3+2治疗；qty=2/><give u2｜u3；id:c1、qty=1/><reforge id=c1，spec:buff治疗L4；name=新药/></tb>',
    ];
    const expected = parseProtocol(sources[0]!).canonical;
    for (const source of sources) {
      const parsed = parseProtocol(source);
      expect(parsed.errors, source).toEqual([]);
      expect(parsed.canonical).toBe(expected);
      expect(parseProtocol(parsed.canonical).events).toEqual(parsed.events);
    }
  });
  it('随身道具兼容全角等级、数量及乘号，错误数量仍定位到原文', () => {
    const parsed = parseProtocol('＜spawn name＝“补给兵” side＝“ally” scale＝“hero” items＝“药水：buff治疗Ｌ３＊２，夜视镜：夜战专精Ｌ３ｘ１”／＞');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ items: [{ name: '药水', qty: 2, spec: { power: 3 } }, { name: '夜视镜', qty: 1, spec: { power: 3 } }] });
    const text = '前文＜add item＝＂药水＂、qty＝＇－２＇／＞';
    const bad = parseProtocol(text);
    expect(bad.events).toEqual([]);
    expect(bad.diagnostics.some(issue => text.slice(issue.start, issue.end).includes('－２'))).toBe(true);
  });
  it('空数值、隐式进制和未知显式护甲不变成另一种有效配置', () => {
    for (const attr of ['hp=""', 'xp=""', 'xp="0x10"', 'atk="Infinity"']) {
      const result = parseProtocol(`<unit_set id="u1" ${attr}/>`);
      expect(result.events, attr).toEqual([]); expect(result.errors.length, attr).toBeGreaterThan(0);
    }
    expect(parseProtocol('<unit_set id="u1" xpProgress="１２．５点" def="－２"/>').events[0]).toMatchObject({ data: { xpProgress: 12.5, def: -2 } });
    expect(parseProtocol('<spawn name="甲" side="ally" scale="hero" armor="陌生护甲L5"/>').errors.length).toBeGreaterThan(0);
  });
  it('扫描全文和常见包裹，缺tb收尾或自闭合斜杠仍识别，记录仅保留事件', () => {
    const tag = '<unit_update id="a" hp="500"/>';
    const expected = parseProtocol('<tb>' + tag + '</tb>').canonical;
    for (const text of [
      '<tb>' + tag + '</tb>后续正文', '前文<details><tb>' + tag + '</tb></details>后文',
      '```xml\n<tb>' + tag + '</tb>\n```', '> <tb>' + tag + '</tb>',
      '<!-- <tb>' + tag + '</tb> -->', '`' + tag + '`',
      '<tb>' + tag, '<TB><UNIT_UPDATE id="a" hp="500"></UNIT_UPDATE></TB>',
    ]) {
      const result = parseProtocol(text);
      expect(result.errors, text).toEqual([]); expect(result.canonical, text).toBe(expected);
      expect(protocolExcerpt(text)).not.toMatch(/前文|后文|后续正文|details|```/);
      expect(parseProtocol(protocolExcerpt(text)).canonical).toBe(expected);
    }
    expect(parseProtocol('<think>构思<tb>' + tag + '</tb></think>正文').events).toEqual([]);
  });
  it('字段别名、全角字符、中文枚举、无引号值与人数写法规范化，不改变实际值', () => {
    const result = parseProtocol('正文 <TB><UNIT-UPDATE REF＝“a” HP＝５００.０人 HP_MAX="１，０００人" extra="备注" >说明</TB>后文');
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ kind: 'unit-update', id: 'a', hp: 500, hpMax: 1000 });
    const spawn = parseProtocol('<spawn name="R&amp;D &quot;卫队&quot;" side=我方 scale=编队 hp_max=80人 level=3 weapon="战刃:剑Lv.5" mount=否>');
    expect(spawn.errors).toEqual([]);
    expect(spawn.events[0]).toMatchObject({ name: 'R&D "卫队"', side: 'ally', scale: 'company', hpMax: 80, weaponLevel: 5, mount: false });
    expect(parseProtocol('<unit_update id=a hp="70 / 560"/>').events[0]).toMatchObject({ hp: 70, hpMax: 560 });
    expect(parseProtocol('<take item_id="w1"/><unaffect unit_id="u1" source_id="s1"/>').events).toMatchObject([
      { kind: 'take', id: 'w1', qty: 1 }, { kind: 'unaffect', id: 'u1', sourceId: 's1' },
    ]);
  });
  it('跨块重复展示去重，同单位互补更新合并，冲突保留待补全', () => {
    const result = parseProtocol('<tb><unit_update id=a hp=500/><deploy id=a/></tb>正文<tb><unit_update id=a hp_max=1000/><deploy id=a/></tb>');
    expect(result.errors).toEqual([]); expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ kind: 'unit-update', hp: 500, hpMax: 1000 });
    const repeated = '<tb><add item="药剂" qty=2/></tb>';
    expect(parseProtocol(repeated + '说明' + repeated).events).toHaveLength(1);
    expect(parseProtocol(repeated.repeat(40)).errors).toEqual([]);
    expect(parseProtocol(protocolExcerpt(repeated + '说明' + repeated)).events).toHaveLength(1);
    const escaped = '&lt;UNIT_UPDATE REF=&quot;a&quot; HP=&quot;500人&quot; /&gt;';
    expect(parseProtocol(escaped).events[0]).toMatchObject({ kind: 'unit-update', id: 'a', hp: 500 });
    const conflict = parseProtocol('<tb><unit_update id=a hp=500/></tb><tb><unit_update id=a hp=560/></tb>');
    expect(conflict.errors.join('')).toMatch(/冲突/);
  });
  it('坏事件保留明确诊断和可识别部分，截断属性与非法数值不猜执行', () => {
    const result = parseProtocol('<tb><field env=forest/><unit_update id=a hp="未知"/><unsupported value=1/></tb>');
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ kind: 'field', env: 'forest' });
    expect(result.errors.length).toBeGreaterThan(0);
    for (const text of ['<unit_update id=a hp="50', '<unit_update id=a hp=-1/>', '<unit_update id=a hp="1 2"/>', '<unit_update id=a hp="20~30"/>']) {
      const parsed = parseProtocol(text); expect(parsed.events, text).toEqual([]); expect(parsed.errors.length, text).toBeGreaterThan(0);
    }
  });
  it('正文长度不占事件预算；卡片与人数上限仍按实际事件检查', () => {
    expect(parseProtocol('很长的正文'.repeat(5000) + '<unit_update id=a hp=500/>继续正文').errors).toEqual([]);
    expect(parseProtocol('<spawn name="士兵" side=enemy scale=hero count=80/>').errors.join('')).toMatch(/count|卡/);
    expect(parseProtocol('<tb>' + '<spawn name="士兵" side=enemy scale=hero count=20/>'.repeat(4) + '</tb>').errors.join('')).toMatch(/64/);
  });
});
