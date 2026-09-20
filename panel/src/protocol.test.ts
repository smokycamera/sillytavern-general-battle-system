import { describe, expect, it } from 'vitest';
import { parseProtocol, protocolExcerpt } from './protocol.js';
import { TRAITS } from '../../engine/src/index.js';
import { CORE_PROTOCOL, PROMPT_CARDS } from './narrative-prompt.js';

it('新建装备的显式等级越界时保留诊断，不钳制等级或退回默认装备', () => {
  for (const [key, mechanism] of [['weapon', '剑'], ['weapon2', '剑'], ['armor', '重甲']]) {
    for (const level of ['0', '11', '99', '100', '-1', '1.5']) {
      const result = parseProtocol(`<tb><unit_update id="a" hp="500"/><spawn name="卫兵" side="enemy" scale="hero" ${key}="自定义:${mechanism}L${level}"/></tb>`);
      expect(result.events, `${key} L${level}`).toMatchObject([{ kind: 'unit-update', hp: 500 }]);
      expect(result.errors.length, `${key} L${level}`).toBeGreaterThan(0);
    }
    for (const level of [1, 10]) {
      const result = parseProtocol(`<tb><spawn name="卫兵" side="enemy" scale="hero" ${key}="自定义:${mechanism}L${level}"/></tb>`);
      expect(result.errors).toEqual([]);
      expect(result.events[0]).toHaveProperty(key === 'armor' ? 'armorLevel' : key === 'weapon2' ? 'weapon2Level' : 'weaponLevel', level);
    }
  }
});

it('思考区示例不计入正文块，支持标签显示转义和缩进，原样保存的仅有事件块', () => {
  const block = '<tb>\n    <deploy id="d1"/>\n    <spawn name="军团" side="enemy" scale="company" hpMax="60" weapon="激光枪:能量武器L6" armor="中甲L5"/>\n</tb>';
  const text = '<think>考虑示例<tb><deploy id="错误示例"/></tb></think>\n实际正文。\n' + block;
  const parsed = parseProtocol(text); expect(parsed.errors).toEqual([]); expect(parsed.events).toHaveLength(2);
  expect(protocolExcerpt(text)).toBe(protocolExcerpt(block));
  for (const encoded of [text.replaceAll('<', '&lt;').replaceAll('>', '&gt;'), text.replaceAll('<', '\\&lt;').replaceAll('>', '\\&gt;')]) {
    expect(parseProtocol(encoded).canonical).toBe(parsed.canonical); expect(protocolExcerpt(encoded)).toBe(protocolExcerpt(block));
  }
  expect(parseProtocol('```xml\n' + block.replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '\n```').canonical).toBe(parsed.canonical);
  expect(parseProtocol('<think>' + block).events).toEqual([]);
  expect(parseProtocol(block + block).canonical).toBe(parsed.canonical);
  expect(parseProtocol('<tb><deploy id="d1"/>').events[0]).toMatchObject({ kind: 'deploy', id: 'd1' });
  expect(parseProtocol("<tb><spawn name='双刃' side='ally' scale='hero' weapon='战刃:剑L7,鞭剑:剑L6'/></tb>").events[0]).toMatchObject({ weaponClass: 'sword', weapon2Class: 'sword', weapon2Level: 6 });
  expect(parseProtocol('<tb><spawn name="卫兵" side="enemy" scale="hero" weapon="激光枪L3"/></tb>').events[0]).toMatchObject({ weaponClass: 'energy', weaponLevel: 3 });
});

it('80人按一支编队表达；大量单位、错误count和超长事件整批拒绝，规范短例均可解析', () => {
  expect(parseProtocol('<tb><spawn name="守备连" side="enemy" scale="company" hpMax="80"/></tb>').events[0]).toMatchObject({ count: 1, hpMax: 80 });
  for (const body of [
    Array.from({ length: 80 }, (_, n) => `<spawn name="士兵${n}" side="enemy" scale="hero"/>`).join(''),
    '<spawn name="士兵" side="enemy" scale="hero" count="80"/>',
    '<spawn name="士兵" side="enemy" scale="hero" count="20"/>'.repeat(4),
  ]) {
    const result = parseProtocol('<tb><unit_update id="a" hp="500"/>' + body + '</tb>');
    expect(result.errors.join('')).toMatch(/编队|人数|单位|事件/);
  }
  const examples = [CORE_PROTOCOL, ...PROMPT_CARDS.map((c) => c.content)].flatMap((text) => text.match(/<tb>(?:\s*<[a-z_]+\s[^<>]*\/>\s*)+<\/tb>/g) ?? []);
  expect(examples).toHaveLength(6);
  for (const text of examples) expect(parseProtocol(text).errors, text).toEqual([]);
});

it('环境和昼夜可用一个短事件组合，矛盾或未知昼夜整批拒绝', () => {
  expect(parseProtocol('<tb><field env="forest" light="night"/></tb>').events[0]).toMatchObject({ kind: 'field', env: 'forest', light: 'night' });
  expect(parseProtocol('<tb><field env="mountain"/></tb>').events[0]).toMatchObject({ kind: 'field', env: 'mountain' });
  for (const attrs of ['env="night" light="day"', 'env="forest" light="eclipse"']) expect(parseProtocol(`<tb><field ${attrs}/></tb>`).errors.length).toBeGreaterThan(0);
});

it('通用增减益只收支持的纯文字效果和唯一时效，禁止正文自造数值', () => {
  expect(parseProtocol('<tb><affect id="a" effects="加速,减速" rounds="2"/></tb>').events[0]).toMatchObject({ kind: 'affect', conditionIds: ['hasted', 'slowed'] });
  expect(parseProtocol('<tb><affect id="a" name="失去庇护" effects="诅咒,士气低下" battles="2"/><unaffect id="a" source="known"/></tb>').events).toMatchObject([
    { kind: 'affect', conditionIds: ['cursed', 'demoralized'], duration: { kind: 'battles', count: 2 } }, { kind: 'unaffect', sourceId: 'known' },
  ]);
  const extra = parseProtocol('<tb><affect id="a" effects="诅咒" atk="-99" rounds="2"/></tb>');
  expect(extra.events[0]).toMatchObject({ kind: 'affect', conditionIds: ['cursed'] }); expect(extra.warnings.join('')).toContain('未使用');
  for (const attrs of ['effects="灭世" rounds="1"', 'effects="诅咒"', 'effects="眩晕" rounds="2"', 'effects="诅咒" rounds="2" battles="1"']) expect(parseProtocol(`<tb><affect id="a" ${attrs}/></tb>`).errors.length).toBeGreaterThan(0);
});

it('正文特质名称使用纯文字，改名前的正文仍映射同一机制', () => {
  expect(TRAITS.every((t) => /^[\p{Script=Han}]+$/u.test(t.name))).toBe(true);
  for (const names of ['克制步兵,克制大型,克制机动', '克制·步兵,克制·大型,克制·机动']) {
    const result = parseProtocol(`<tb><bless id="a" traits="${names}" battles="1"/></tb>`);
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ traitIds: ['anti-infantry', 'anti-large', 'anti-mobile'] });
  }
});

it('祝福必须给出明确特质与唯一期限，不能按神名猜效果或引入未执行的能力', () => {
  expect(parseProtocol('<tb><bless id="a" name="军神庇佑" traits="守护,射击专家" battles="2"/></tb>').events[0]).toMatchObject({ kind: 'bless', id: 'a', traitIds: ['guardian', 'sharpshooter'], duration: { kind: 'battles', count: 2 } });
  expect(parseProtocol('<tb><unbless id="a" source="known-source"/></tb>').events[0]).toMatchObject({ kind: 'unbless', sourceId: 'known-source' });
  const flying = parseProtocol('<tb><bless id="a" traits="飞行" rounds="3"/></tb>');
  expect(flying.errors).toEqual([]); expect(flying.events[0]).toMatchObject({ kind: 'bless', traitIds: ['flying'], duration: { kind: 'rounds', count: 3 } });
  expect(parseProtocol('<tb><bless id="a" traits="散兵" rounds="3"/></tb>').errors).toEqual([]);
  for (const traits of ['未知神威', '泰坦巨兽']) {
    const unsupported = parseProtocol(`<tb><bless id="a" traits="${traits}" rounds="3"/></tb>`);
    expect(unsupported.events).toEqual([]); expect(unsupported.warnings.length + unsupported.errors.length).toBeGreaterThan(0);
  }
  for (const attrs of ['traits="守护"', 'traits="守护" rounds="2" battles="1"', 'traits="守护" rounds="-1"', 'traits="守护" permanent="false"']) {
    expect(parseProtocol(`<tb><bless id="a" ${attrs}/></tb>`).errors.length).toBeGreaterThan(0);
  }
});
it('旧正文mook是编队别名，仍须明确人数，不产生禁止成长或弱化分类', () => {
  const parsed = parseProtocol('<tb><spawn name="地方民兵" side="ally" scale="mook" hpMax="20" hp="7" level="2"/></tb>');
  expect(parsed.errors).toEqual([]); expect(parsed.events[0]).toMatchObject({ kind: 'spawn', scale: 'company', hp: 7, hpMax: 20, level: 2 });
  expect(parseProtocol('<tb><spawn name="民兵" side="ally" scale="mook"/></tb>').errors.length).toBeGreaterThan(0);
});
describe('V2 正文协议作用域与整批校验', () => {
  it('机械物品与装备重铸使用短规格，陌生名字不推断能力，越界等级整批拒绝', () => {
    const parsed = parseProtocol('<tb><give item="炮弹投送器" type="weapon" spec="火炮L7" qty="2"/><give item="急救" type="consumable" spec="治疗L3"/><reforge id="gear-a" spec="火炮L8" enchant="arcane" name="附魔大炮"/></tb>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ kind: 'give', spec: { kind: 'weapon', mechanism: 'cannon', power: 7 } });
    expect(parsed.events[2]).toMatchObject({ kind: 'reforge', id: 'gear-a', spec: { kind: 'weapon', mechanism: 'cannon', power: 8, enchantment: 'arcane' } });
    expect(parseProtocol('<tb><give item="附魔圣炮" type="weapon"/></tb>').events[0]).not.toHaveProperty('spec');
    for (const text of [
      '<tb><give item="新剑" type="weapon" spec="剑L99"/></tb>',
      '<tb><give item="新剑" type="armor" spec="剑L5"/></tb>',
      '<tb><give item="新剑" enchant="arcane"/></tb>',
      '<tb><reforge id="g" spec="未知神器L8"/></tb>',
      '<tb><reforge id="g" spec="重甲L5" enchant="arcane"/></tb>',
    ]) expect(parseProtocol(text).errors.length).toBeGreaterThan(0);
  });
  it.each([
    '<unit_update id="a" hp="500"/>',
    '```xml\n<tb><unit_update id="a" hp="500"/></tb>\n```',
    '> <tb><unit_update id="a" hp="500"/></tb>',
    '`<tb><unit_update id="a" hp="500"/></tb>`',
    '<!-- <tb><unit_update id="a" hp="500"/></tb> -->',
  ])('正文中的容器/格式包裹不阻止识别：%s', (text) => { expect(parseProtocol(text).events[0]).toMatchObject({ kind: 'unit-update', hp: 500 }); });
  it.each([
    '<tb><deploy id="a" id="b"/></tb>', '<tb><unit_update id="a" hp="-1"/></tb>',
    '<tb><deploy id="a"/><xp amount="500"/></tb>',
    '<tb><spawn name="军团" side="ally" scale="company" count="560"/></tb>',
    '<tb><spawn name="军团" side="ally" scale="company" count="1"/></tb>',
  ])('无法确定的事件保留可见诊断：%s', (text) => {
    const r = parseProtocol(text); expect(r.errors.length).toBeGreaterThan(0);
  });
  it('缺省 hp 首次满编，count 与人数分离，规范化属性顺序和无语义空白', () => {
    const r = parseProtocol('军团抵达。\n<tb>\n<spawn name="A军团" side="ally" scale="company" hpMax="560" count="2"/>\n</tb>');
    expect(r.events[0]).toMatchObject({ kind: 'spawn', count: 2, hpMax: 560 });
    expect(parseProtocol('<tb><unit_update id="a" hp="500"/></tb>').canonical).toBe(parseProtocol('<tb>\n<unit_update hp = "500" id="a" />\n</tb>').canonical);
  });
});
