import { describe, expect, it } from 'vitest';
import { parseProtocol, protocolExcerpt } from './protocol.js';
import { TRAITS, generateUnit } from '../../engine/src/index.js';
import { CORE_PROTOCOL, PROMPT_CARDS } from './narrative-prompt.js';

it('accepts English mechanics and mixed-language specs without changing item or unit names', () => {
  const result = parseProtocol(`<tb>
    <spawn name="Pilot" side="ally" scale="hero" traits="Space Mobility,飞行L2" armor="Flight Suit:Light Armour L2" shield="Screen:Energy Shield L3" skills="First Aid:Buff L3+Heal L4"/>
    <reforge id="a1" name="Field Armor" spec="Medium Armor L4+2defense"/>
  </tb>`);
  expect(result.errors).toEqual([]);
  expect(result.events).toMatchObject([
    { kind: 'spawn', name: 'Pilot', traits: ['space-adapted', 'flyingL2'], armorTier: 1, shieldName: 'Screen', shieldClass: 'energy-shield',
      skills: [{ name: 'First Aid', level: 3, blueprintId: 'generic:buff:heal@4' }] },
    { kind: 'reforge', name: 'Field Armor', spec: { kind: 'armor', tier: 2, power: 4, bonuses: { defense: 2 } } },
  ]);
});

it('spawn neutral retains third-party ownership through parsing and generation', () => {
  const parsed = parseProtocol('<tb><spawn name="第三军" side="neutral" scale="hero"/></tb>');
  expect(parsed.errors).toEqual([]);
  const event = parsed.events[0]!;
  if (event.kind !== 'spawn') throw Error('expected spawn');
  const unit = generateUnit({ name: event.name, side: event.side!, scale: 'hero', level: 3, rulesVersion: 'v2', traits: [] }, { seed: 'third-party-spawn' }).unit;
  expect([event.side, unit.side]).toEqual(['neutral', 'neutral']);
});

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
  expect(parseProtocol("<tb><spawn name='双刃' side='ally' scale='hero' weapon='战刃:剑L7,鞭剑:剑L6'/></tb>").events[0]).toMatchObject({ weaponClass: 'sword', equipmentIssues: {primary:[{name:'战刃', qty:1, spec:{mechanism:'sword', power:7}}, {name:'鞭剑', qty:1, spec:{mechanism:'sword', power:6}}]} });
  expect(parseProtocol('<tb><spawn name="卫兵" side="enemy" scale="hero" weapon="激光枪L3"/></tb>').events[0]).toMatchObject({ weaponClass: 'energy', weaponLevel: 3 });
});

it('spawn盾牌读取名称、独立规格和修正，名称大小写及繁体保留，旧布尔写法兼容', () => {
  for (const shield of ['AEGIS塔盾:盾L5+2防御-3热能防护', 'AEGIS塔盾：盾牌Ｌ５＋２防禦－３熱能防護']) {
    const parsed = parseProtocol(`<spawn name="卫兵" side="ally" scale="hero" level="1" shield="${shield}"/>`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ kind: 'spawn', level: 1, shield: true, shieldName: 'AEGIS塔盾', shieldLevel: 5, shieldBonuses: { defense: 2, thermalProtection: -3 } });
    expect(parseProtocol(parsed.canonical).events).toEqual(parsed.events);
  }
  expect(parseProtocol('<spawn name="卫兵" side="ally" scale="hero" shield="盾L7"/>').events[0]).toMatchObject({ shield: true, shieldLevel: 7 });
  for (const [value, shield] of [['true', true], ['false', false], ['是', true], ['无', false]] as const) {
    expect(parseProtocol(`<spawn name="旧卫兵" side="ally" scale="hero" shield="${value}"/>`).events[0]).toMatchObject({ shield });
  }
  expect(parseProtocol('<spawn name="轻兵" side="ally" scale="hero"/>').events[0]).toMatchObject({ shield: false });
});

it('错误盾牌规格定位到shield，不把武器、护甲或道具误当盾牌', () => {
  for (const spec of ['塔盾', '塔盾:盾L0', '塔盾:盾L11', '塔盾:盾L5+11防御', '塔盾:盾L5+2伤害', '塔盾:剑L5', '塔盾:重甲L5', '塔盾:buff屏障L5', '']) {
    const text = `<spawn name="卫兵" side="ally" scale="hero" shield="${spec}"/>`;
    const parsed = parseProtocol(text);
    expect(parsed.errors.length, spec).toBeGreaterThan(0);
    expect(parsed.events, spec).toEqual([]);
    expect(parsed.diagnostics[0]?.field, spec).toBe('shield');
    expect(text.slice(parsed.diagnostics[0]!.start, parsed.diagnostics[0]!.end), spec).toContain('shield=');
  }
});

it('80人可建为一支编队或80张卡；单次count和单批事件数各自校验', () => {
  expect(parseProtocol('<tb><spawn name="守备连" side="enemy" scale="company" hpMax="80"/></tb>').events[0]).toMatchObject({ count: 1, hpMax: 80 });
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `<spawn name="士兵${i}" side="enemy" scale="hero"/>`).join('');
  const many = parseProtocol('<tb>' + cards(80) + '</tb>');
  expect(many.errors).toEqual([]); expect(many.events).toHaveLength(80);
  expect(parseProtocol('<tb>' + cards(161) + '</tb>').errors.join('')).toMatch(/160/);
  expect(parseProtocol('<tb><spawn name="士兵" side="enemy" scale="hero" count="80"/></tb>').errors.join('')).toMatch(/count|卡/);
  const examples = [CORE_PROTOCOL, ...PROMPT_CARDS.map((c) => c.content)].flatMap((text) => text.match(/<tb>(?:\s*<[a-z_]+\s[^<>]*\/>\s*)+<\/tb>/g) ?? []);
  expect(examples).toHaveLength(11);
  for (const text of examples) expect(parseProtocol(text).errors, text).toEqual([]);
  const effectSection = PROMPT_CARDS.map(c=>c.content).join('\n').match(/## 获得与解除效果\n([\s\S]*?)\n## 特质traits/)![1]!;
  const effectExample = effectSection.slice(effectSection.indexOf('示例：') + '示例：'.length);
  expect(parseProtocol(effectExample).errors).toEqual([]); expect(parseProtocol(effectExample).events).toHaveLength(5);
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

it('正文特质名称使用纯文字，改名前的正文仍映射同一机制，克制机动并入拒马', () => {
  expect(TRAITS.every((t) => /^[\p{Script=Han}]+$/u.test(t.name))).toBe(true);
  for (const names of ['克制步兵,克制大型,克制机动', '克制·步兵,克制·大型,克制·机动']) {
    const result = parseProtocol(`<tb><bless id="a" traits="${names}" battles="1"/></tb>`);
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ traitIds: ['anti-infantry', 'anti-large', 'pike-wall'] });
  }
});

it('停用特质不建档：老练/精锐改按训练等级、快速改按速度档，写了的不覆盖；重甲由护甲决定', () => {
  const spawn = parseProtocol('<tb><spawn name="游骑" side="ally" scale="hero" traits="老练,快速,射击专家,重甲"/></tb>');
  expect(spawn.errors).toEqual([]);
  expect(spawn.events[0]).toMatchObject({ kind: 'spawn', traits: ['sharpshooter'], level: 3, speedTier: 4 });
  expect(spawn.warnings.join(' ')).toMatch(/「老练」训练程度由level表达，不再作为特质，已按level=3/);
  expect(spawn.warnings.join(' ')).toMatch(/「快速」移动快慢由speed表达，不再作为特质，已按speed=4/);
  expect(spawn.warnings.join(' ')).toMatch(/「重甲」由护甲决定/);
  const explicit = parseProtocol('<tb><spawn name="禁军" side="ally" scale="hero" level="6" speed="2" traits="精锐,快速"/></tb>');
  expect(explicit.events[0]).toMatchObject({ level: 6, speedTier: 2 }); expect((explicit.events[0] as { traits?: string[] }).traits ?? []).toEqual([]);
  expect(parseProtocol('<tb><bless id="a" traits="老练" battles="1"/></tb>').events).toEqual([]);
  const set = parseProtocol('<tb><unit_set id="u1" traits="精锐,工事,御剑"/></tb>');
  expect(set.errors).toEqual([]); expect(JSON.stringify(set.events[0])).toContain('fortification'); expect(JSON.stringify(set.events[0])).toContain('flying');
});

it('天生护甲写进armor时按所写或按身体补出种类并加上特质，改已有单位不知身体时保留原护甲', () => {
  const dragon = parseProtocol('<tb><spawn name="红龙" side="enemy" scale="hero" body="giant" weapon="利爪:天生武器L6" armor="远古龙鳞:天生护甲L8+6防护" traits="飞行"/></tb>');
  expect(dragon.errors).toEqual([]);
  expect(dragon.events[0]).toMatchObject({ kind: 'spawn', armor: '远古龙鳞:重甲L8+6防护', armorTier: 3, armorLevel: 8, traits: ['flying', 'natural-armor'] });
  expect(dragon.warnings.join(' ')).toMatch(/「天生护甲」不是护甲种类，已按重甲处理并加上天生护甲特质/);
  expect(parseProtocol('<tb><spawn name="巨魔" side="enemy" scale="hero" body="large" armor="厚皮:天生护甲L5"/></tb>').events[0]).toMatchObject({ armorTier: 2, traits: ['natural-armor'] });
  expect(parseProtocol('<tb><spawn name="体修" side="ally" scale="hero" armor="肉身:天生护甲L6+4防护"/></tb>').events[0]).toMatchObject({ armorTier: 1 });
  expect(parseProtocol('<tb><spawn name="龙" side="enemy" scale="hero" body="giant" armor="龙鳞:天生中甲L6"/></tb>').events[0]).toMatchObject({ armorTier: 2, traits: ['natural-armor'] });
  const set = parseProtocol('<tb><unit_set id="u4" armor="龙鳞:天生护甲L7" traits="飞行"/></tb>');
  expect(set.errors).toEqual([]); expect(JSON.stringify(set.events[0])).not.toContain('armor');
  expect(set.warnings.join(' ')).toMatch(/保留原护甲/);
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
    const parsed = parseProtocol('<tb><add item="炮弹投送器" type="weapon" spec="火炮L7" qty="2"/><add item="急救" type="consumable" spec="治疗L3"/><reforge id="gear-a" spec="火炮L8" enchant="arcane" name="附魔大炮"/></tb>');
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({ kind: 'add', spec: { kind: 'weapon', mechanism: 'cannon', power: 7 } });
    expect(parsed.events[2]).toMatchObject({ kind: 'reforge', id: 'gear-a', spec: { kind: 'weapon', mechanism: 'cannon', power: 8, enchantment: 'arcane' } });
    expect(parseProtocol('<tb><add item="附魔圣炮" type="weapon"/></tb>').events[0]).not.toHaveProperty('spec');
    for (const text of [
      '<tb><add item="新剑" type="weapon" spec="剑L99"/></tb>',
      '<tb><add item="新剑" type="armor" spec="剑L5"/></tb>',
      '<tb><add item="新剑" enchant="arcane"/></tb>',
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
