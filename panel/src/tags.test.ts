import { describe, it, expect } from 'vitest';
import { parseSuggestionTags } from './tags';
import { parseProtocol } from './protocol';
import wbJson from '../../assets/worldbook/!通用战斗系统约束.json';


describe('AI 建议标签解析', () => {
  it('<tb> 包裹块（世界书 v0.6 输出契约）正常解析，包裹行本身被忽略', () => {
    const text = [
      '正文叙述……',
      '<tb>',
      '<give item="生锈的军刀" note="敌兵遗落"/>',
      '<spawn name="黑铁亲卫" archetype="infantry" level="6" weapon="双手巨斧" armor="重甲" traits="重甲,狂暴"/>',
      '</tb>',
    ].join('\n');
    const r = parseSuggestionTags(text);
    expect(r.invalid).toHaveLength(0);
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[0]).toMatchObject({ kind: 'give', item: '生锈的军刀' });
    expect(r.suggestions[1]).toMatchObject({ kind: 'spawn', level: 6, traits: ['重甲', '狂暴'] });
  });

  it('解析四类合法标签', () => {
    const text = [
      '正文……',
      '<give item="秘银锁甲" note="矮人锻造"/>',
      '<status target="艾莉" id="中毒" dur="3"/>',
      '<xp amount="50" reason="救下商队"/>',
      '<spawn name="兽人猎手" archetype="mobile" level="3" count="2"/>',
    ].join('\n');
    const r = parseSuggestionTags(text);
    expect(r.invalid).toHaveLength(0);
    expect(r.suggestions).toHaveLength(4);
    expect(r.suggestions[0]).toMatchObject({ kind: 'give', item: '秘银锁甲', note: '矮人锻造' });
    expect(r.suggestions[1]).toMatchObject({ kind: 'status', target: '艾莉', conditionId: '中毒', dur: 3 });
    expect(r.suggestions[2]).toMatchObject({ kind: 'xp', amount: 50, reason: '救下商队' });
    expect(r.suggestions[3]).toMatchObject({ kind: 'spawn', archetype: 'mobile', level: 3, count: 2 });
  });

  it('非法标签降级为 invalid：缺属性/坏原型/坏经验', () => {
    const text = [
      '<give note="没有物品名"/>',
      '<xp amount="abc"/>',
      '<spawn name="怪" archetype="dragon" level="3"/>',
      '<status target=""/>',
      '<made-up-tag foo="1"/>', // 不认识的标签直接被正则忽略
    ].join('\n');
    const r = parseSuggestionTags(text);
    expect(r.suggestions).toHaveLength(0);
    expect(r.invalid).toHaveLength(4); // 前四个解析失败，第五个根本不匹配
    expect(r.invalid[0]).toContain('give');
  });

  it('数值钳制：dur/level/count 越界取边界，xp 上限', () => {
    const r = parseSuggestionTags(
      '<status target="A" id="晕" dur="-5"/><xp amount="99999999"/><spawn name="B" archetype="ranged" level="99" count="0"/>',
    );
    expect(r.suggestions[0]).toMatchObject({ dur: 1 });
    expect(r.suggestions[1]).toMatchObject({ amount: 100000 });
    expect(r.suggestions[2]).toMatchObject({ level: 10, count: 1 });
  });

  it('大小写不敏感、容错空白与垃圾文本不抛错', () => {
    const r = parseSuggestionTags('随便什么乱码 <<<>>> <XP   amount="10"   /> <<x>>');
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ kind: 'xp', amount: 10 });
  });

  it('同一标签多次出现全部入队（去重由面板负责）', () => {
    const r = parseSuggestionTags('<xp amount="10"/><xp amount="20"/>');
    expect(r.suggestions).toHaveLength(2);
  });

  it('spawn 扩展属性：武器/护甲/特质/首领（无 persona）', () => {
    const r = parseSuggestionTags(
      '<spawn name="黑铁亲王" archetype="infantry" level="6" count="1" weapon="双手巨斧" armor="重甲" traits="破甲,恐惧" leader="true"/>',
    );
    const s = r.suggestions[0]!;
    expect(s).toMatchObject({
      kind: 'spawn',
      name: '黑铁亲王',
      weapon: '双手巨斧',
      armor: '重甲',
      traits: ['破甲', '恐惧'],
      leader: true,
    });
  });

  it('spawn 扩展属性缺省时保持旧行为', () => {
    const r = parseSuggestionTags('<spawn name="狼骑兵" archetype="mobile" level="3" count="2"/>');
    const s = r.suggestions[0]! as Extract<(typeof r.suggestions)[number], { kind: 'spawn' }>;
    expect(s.weapon).toBeUndefined();
    expect(s.armor).toBeUndefined();
    expect(s.traits).toBeUndefined();
    expect(s.leader).toBeUndefined();
  });

  it('中文逗号/顿号分隔的特质列表也能解析', () => {
    const r = parseSuggestionTags('<spawn name="刺客" archetype="infantry" level="4" count="1" traits="破甲、潜行，快速"/>');
    const s = r.suggestions[0]! as Extract<(typeof r.suggestions)[number], { kind: 'spawn' }>;
    expect(s.traits).toEqual(['破甲', '潜行', '快速']);
  });

  it('spawn 的 scale 属性：company/mook/hero 解析，非法值与缺省不落入 scale', () => {
    const r = parseSuggestionTags(
      [
        '<spawn name="第3步兵连" archetype="infantry" scale="company" level="4" count="2"/>',
        '<spawn name="喽啰" archetype="infantry" scale="mook" level="1" count="10"/>',
        '<spawn name="游侠" archetype="ranged" scale="battalion" level="3"/>',
        '<spawn name="佣兵" archetype="ranged" level="3"/>',
      ].join('\n'),
    );
    expect(r.invalid).toHaveLength(0);
    expect(r.suggestions[0]).toMatchObject({ kind: 'spawn', scale: 'company' });
    expect(r.suggestions[1]).toMatchObject({ kind: 'spawn', scale: 'mook' });
    expect((r.suggestions[2] as { scale?: string }).scale).toBeUndefined(); // 非法刻度忽略，交给面板默认
    expect((r.suggestions[3] as { scale?: string }).scale).toBeUndefined(); // 缺省不带 scale
  });

  it('weapon="名字:种类L等级"：名字入 weaponName，种类+等级入 weaponClass/weaponLevel', () => {
    const r = parseSuggestionTags(
      '<spawn name="黑铁亲卫" archetype="infantry" level="6" weapon="裂颅者:斧L6" armor="重甲"/>',
    );
    const s = r.suggestions[0]!;
    expect(s).toMatchObject({
      kind: 'spawn',
      weapon: '裂颅者:斧L6',
      weaponName: '裂颅者',
      weaponClass: 'axe',
      weaponLevel: 6,
    });
  });

  it('武器分隔符容错：全角冒号/竖线/斜杠/无等级/纯名字', () => {
    const r = parseSuggestionTags(
      [
        '<spawn name="A" archetype="ranged" level="4" weapon="守护之弓：弓弩L4"/>',
        '<spawn name="B" archetype="ranged" level="4" weapon="老伙计|步枪L7"/>',
        '<spawn name="C" archetype="infantry" level="4" weapon="银月长剑/剑L5"/>',
        '<spawn name="D" archetype="infantry" level="4" weapon="银月长剑:剑"/>',
        '<spawn name="E" archetype="infantry" level="4" weapon="银月长剑"/>',
      ].join('\n'),
    );
    expect(r.suggestions[0]).toMatchObject({ weaponName: '守护之弓', weaponClass: 'bow', weaponLevel: 4 });
    expect(r.suggestions[1]).toMatchObject({ weaponName: '老伙计', weaponClass: 'rifle', weaponLevel: 7 });
    expect(r.suggestions[2]).toMatchObject({ weaponName: '银月长剑', weaponClass: 'sword', weaponLevel: 5 });
    expect(r.suggestions[3]).toMatchObject({ weaponName: '银月长剑', weaponClass: 'sword' });
    expect((r.suggestions[3] as { weaponLevel?: number }).weaponLevel).toBeUndefined();
    // 纯名字（旧写法）：无显式名字段 → weaponName 不落键，种类靠关键词推断
    expect((r.suggestions[4] as { weaponName?: string }).weaponName).toBeUndefined();
    expect(r.suggestions[4]).toMatchObject({ weaponClass: 'sword' });
  });

  it('weapon2="名字:种类L等级"：近战副武器解析；不声明不落键', () => {
    const r = parseSuggestionTags(
      [
        '<spawn name="游侠" side="ally" archetype="ranged" level="4" weapon="守护之弓:弓弩L4" weapon2="短剑:剑L3"/>',
        '<spawn name="老兵" side="ally" archetype="infantry" level="4" weapon="制式长剑:剑L5"/>',
      ].join('\n'),
    );
    expect(r.suggestions[0]).toMatchObject({
      weapon2: '短剑:剑L3',
      weapon2Name: '短剑',
      weapon2Class: 'sword',
      weapon2Level: 3,
    });
    // 无 weapon2 → 副武器字段全部缺省
    const plain = r.suggestions[1]! as { weapon2?: string; weapon2Name?: string };
    expect(plain.weapon2).toBeUndefined();
    expect(plain.weapon2Name).toBeUndefined();
  });

  it('世界书格式与战报演出常驻，七个完整短例均通过正式解析，80人不展开为80张卡', () => {
    const entries = Object.values(wbJson.entries);
    expect(entries.filter((e) => e.constant).map((e) => e.uid)).toEqual([0, 1, 5, 8]);
    const blocks = entries.flatMap((e) => e.content.match(/<tb>(?:\s*<[a-z_]+\s[^<>]*\/>\s*)+<\/tb>/g) ?? []);
    expect(blocks).toHaveLength(7);
    const events = blocks.flatMap((block) => { const result = parseProtocol(block); expect(result.errors).toEqual([]); return result.events; });
    expect(events.find((e) => e.kind === 'unit-update')).toMatchObject({ hp: 500 });
    expect(events.find((e) => e.kind === 'spawn')).toMatchObject({ scale: 'company', hpMax: 80, count: 1, weaponClass: 'rifle', weaponLevel: 5 });
  });

  it('武器种类段无效时整串按纯名字处理；旧格式 "剑L5" 仍解析', () => {
    const r = parseSuggestionTags(
      [
        '<spawn name="A" archetype="infantry" level="3" weapon="神秘武器:量子谐振刃L3"/>',
        '<spawn name="B" archetype="infantry" level="3" weapon="剑L5"/>',
      ].join('\n'),
    );
    const a = r.suggestions[0]!;
    expect((a as { weaponName?: string }).weaponName).toBeUndefined();
    expect((a as { weaponClass?: string }).weaponClass).toBeUndefined();
    expect(r.suggestions[1]).toMatchObject({ weapon: '剑L5', weaponClass: 'sword', weaponLevel: 5 });
    expect((r.suggestions[1] as { weaponName?: string }).weaponName).toBeUndefined();
  });

  it('armor="名字:种类L等级"：名字入 armorName，档位+等级入 armorTier/armorLevel', () => {
    const r = parseSuggestionTags(
      [
        '<spawn name="A" archetype="infantry" level="5" armor="龙鳞宝铠:重甲L6"/>',
        '<spawn name="B" archetype="infantry" level="5" armor="旅人皮甲：轻甲L3"/>',
        '<spawn name="C" archetype="infantry" level="5" armor="重甲L6"/>',
        '<spawn name="D" archetype="infantry" level="5" armor="重甲"/>',
        '<spawn name="E" archetype="infantry" level="5" armor="板甲"/>',
      ].join('\n'),
    );
    const s = (i: number) => r.suggestions[i] as Extract<(typeof r.suggestions)[number], { kind: 'spawn' }>;
    expect(s(0)).toMatchObject({ armor: '龙鳞宝铠:重甲L6', armorName: '龙鳞宝铠', armorTier: 3, armorLevel: 6 });
    expect(s(1)).toMatchObject({ armorName: '旅人皮甲', armorTier: 1, armorLevel: 3 });
    // 纯种类段（无自定义名）：档位+等级照解析，armorName 不落键
    expect(s(2)).toMatchObject({ armorTier: 3, armorLevel: 6 });
    expect(s(2).armorName).toBeUndefined();
    expect(s(3)).toMatchObject({ armorTier: 3 });
    expect(s(3).armorLevel).toBeUndefined();
    // 护甲库名/自由文本：档位与等级都不落键（交由面板库名匹配/自由文本）
    expect(s(4).armorTier).toBeUndefined();
    expect(s(4).armorLevel).toBeUndefined();
  });

  it('skills="名字:蓝图L等级,…"：蓝图命中带等级与自定义名；未命中条目跳过', () => {
    const r = parseSuggestionTags(
      '<spawn name="焰法师" archetype="ranged" level="5" skills="焚天:烈焰风暴L6,铁壁,治愈之光L4,量子风暴"/>',
    );
    const s = r.suggestions[0] as Extract<(typeof r.suggestions)[number], { kind: 'spawn' }>;
    expect(s.skills).toEqual([
      { blueprintId: 'bp-firestorm', level: 6, name: '焚天' },
      { blueprintId: 'bp-iron-guard', name: undefined },
      { blueprintId: 'bp-mending', level: 4, name: undefined },
    ]);
    expect(r.invalid).toHaveLength(0); // 未命中的技能条目静默跳过，不算非法标签
  });

  it('skills 按「类别名」也能命中蓝图（类别驱动，无 persona）', () => {
    // 类别名：单体魔法 / 士气鼓舞 / 防御 —— 都应映射到对应蓝图
    const r = parseSuggestionTags(
      '<spawn name="法师" archetype="ranged" level="5" skills="单体魔法L4,士气鼓舞,防御"/>',
    );
    const s = r.suggestions[0] as Extract<(typeof r.suggestions)[number], { kind: 'spawn' }>;
    const ids = (s.skills ?? []).map((k) => k.blueprintId);
    expect(ids).toContain('generic:magic-single'); // 通用类别同义词直接进入六类公式；其余旧蓝图保留兼容。
    expect(ids).toContain('bp-battle-hymn'); // 士气鼓舞 → 战歌
    expect(ids).toContain('bp-iron-guard'); // 防御 → 铁壁
    expect(r.invalid).toHaveLength(0);
  });

  it('field 标签：环境关键词映射四类；识别不出进 invalid', () => {
    const r = parseSuggestionTags(
      ['<field env="巷战"/>', '<field env="夜晚遭遇战"/>', '<field env="太空"/>'].join('\n'),
    );
    expect(r.suggestions[0]).toMatchObject({ kind: 'field', env: 'urban' });
    expect(r.suggestions[1]).toMatchObject({ kind: 'field', env: 'night' });
    expect(r.suggestions).toHaveLength(2);
    expect(r.invalid).toEqual(['<field env="太空"/>']);
  });

  it('解析已有编制调取、补员扩编与结构化战利品', () => {
    const r = parseSuggestionTags([
      '<deploy id="corp-a" name="北境军团"/>',
      '<unit_update id="corp-a" hp="500" hpMax="560" morale="70" state="ready" clear="中毒,流血" reason="补员"/>',
      '<give item="精钢长枪" qty="3" type="weapon" note="缴获"/>',
    ].join('\n'));
    expect(r.invalid).toEqual([]);
    expect(r.suggestions[0]).toMatchObject({ kind: 'deploy', id: 'corp-a', name: '北境军团' });
    expect(r.suggestions[1]).toMatchObject({
      kind: 'unit-update', id: 'corp-a', hp: 500, hpMax: 560, morale: 70,
      state: 'ready', clear: ['中毒', '流血'], reason: '补员',
    });
    expect(r.suggestions[2]).toMatchObject({ kind: 'give', item: '精钢长枪', qty: 3, lootType: 'weapon' });
  });
});
