import { describe, expect, it } from 'vitest';
import { parseProtocol, protocolExcerpt } from './protocol.js';
import { stripThinking, thinkingRanges } from './protocol-syntax.js';
import { simplifiedChinese, simplifiedSpecification } from './traditional-chinese.js';
import { battleDisplayBlocks } from '../../host/src/battle-message-format.js';
import { narrativeScanMessages } from './llm-narrative-scan.js';
import type { LlmSettings } from './llm-settings.js';

const settings: LlmSettings = { enabled: false, selectBattleScale: false, windowSize: 2, url: 'https://gateway.example/v1', token: 'key', model: 'scan-model', models: [] };
const block = [
  '<tb>',
  '<field env="plains" light="day"/>',
  '<spawn name="威灵顿公爵" side="ally" scale="hero" level="6" weapon="军官指挥刀:剑L3+3防御" armor="英军将官制服:轻甲L3+2防护" skills="步兵方阵战术:buff范围士气L4" traits="统率,不溃"/>',
  '<spawn name="冷溪近卫步兵连" side="ally" scale="company" hp="120" hpMax="120" level="4" weapon="布朗贝斯燧发枪:火枪L3+2伤害" weapon2="刺刀:长兵器L3" armor="近卫军呢制服:轻甲L3" skills="齐射交替掩护:物理范围射击L3" traits="守城工事,顽固,精锐"/>',
  '<spawn name="法国大炮兵连" side="enemy" scale="company" hp="12" hpMax="12" body="human" level="4" weapon="十二磅重型加农炮:直射火炮L3+8伤害" armor="野战炮兵护甲:轻甲L2" skills="饱和轰击:物理范围射击L4" traits="破甲,攻城工兵"/>',
  '</tb>',
].join('\n');
// 预设把 <konatan_planning~> 放在预填充里：正文以思考开头，只有闭合标签；思考复述规则时会提到 <tb>、<type> 等标签。
const izumi = [
  'Master，小此已经切换到日本語进行思考啦！我会严格按照konatan_planning~里的规定逐条思考的～',
  '- 列出在这次输出需要注意的所有规则及原因。',
  ' 1. 判定标签：无性内容，纯战场，输出<type>non</type>。',
  ' 6. 战斗前停止剧情，输出<tb>规格的交战双方建档与环境设置。',
  ' 7. 前端生成：查看作战地图与手令载体时触发<htmlcontent>。',
  '</konatan_planning~>',
  '', '<type>', 'non', '</type>', '',
  '<disclaimer>', '<Content_Target>', '└── <content> Tagged Sections', '</Content_Target>', '</disclaimer>', '',
  '<tucao>', '在战火点燃的第一秒戛然而止并完成tb建档。', '</tucao>', '',
  '六月的暴雨在清晨时分终于停歇。', '',
  '<htmlcontent>', '<style>', '  .field-order { background: #e8dcbe; }', '</style>',
  '<div class="field-order"><div class="order-title">Ordre de Bataille</div><p>地面湿滑。</p ><br/></div>', '</htmlcontent>',
  '<span style="display: none;">（法军野战参谋手令）</span>', '',
  '正午的日光刺破云层。', '',
  '<options>', '>选项一：[命令传令兵确认弹药储备]', '</options>', '',
  '<advice>', '检查前沿乌古蒙庄园的防守工事', '</advice>', '',
  block,
].join('\n');

describe('预设正文兼容', () => {
  it('只有闭合标签的思考、规则里提到的<tb>和包装标签都不进入事件块', () => {
    const result = parseProtocol(izumi), expected = parseProtocol(block);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
    expect(result.canonical).toBe(expected.canonical);
    expect(protocolExcerpt(izumi)).toBe(protocolExcerpt(block));
    const blocks = battleDisplayBlocks(izumi);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start: izumi.indexOf(block), end: izumi.length, text: block, count: 4 });
  });
  it('思考里的草稿事件和复述的开闭标签不重复入账', () => {
    const draft = '<tb>\n<spawn name="草稿" side="enemy" scale="hero" level="9"/>\n</tb>';
    const echoed = '思考需用<konatan_planning~> </konatan_planning~>包裹，先写草稿：\n' + draft + '\n</konatan_planning~>\n正文。\n' + block;
    expect(parseProtocol(echoed).canonical).toBe(parseProtocol(block).canonical);
    for (const text of ['<thinking>' + draft + '</thinking>正文\n' + block, '<cot>' + draft + '</cot>正文\n' + block,
      '<思考>' + draft + '</思考>正文\n' + block, draft + '\n</think>\n正文\n' + block, '<thinking>' + draft + '</think>正文\n' + block]) {
      expect(parseProtocol(text).canonical, text).toBe(parseProtocol(block).canonical);
    }
    expect(parseProtocol('<think>还在思考' + block).events).toEqual([]);
    expect(stripThinking('推理……</konatan_planning~>\n正文<thought>心声</thought>结尾')).toBe('\n正文结尾');
    expect(thinkingRanges('<think/>正文')).toEqual([]);
  });
  it('块内只报告形似事件的未知标签；规则里提到的已知标签不算事件', () => {
    const unclosed = block.replace('\n</tb>', '') + '\n<options>\n>选项一：[继续]\n</options>\n<advice>\n建议\n</advice>\n<div class="status"><font color="red">状态栏</font></div>';
    expect(parseProtocol(unclosed).errors).toEqual([]);
    expect(parseProtocol(unclosed).canonical).toBe(parseProtocol(block).canonical);
    expect(parseProtocol('<tb><unsupported/></tb>').errors[0]).toContain('暂不支持事件 unsupported');
    expect(parseProtocol('<tb><heal id="u1" hp="5"/></tb>').errors[0]).toContain('暂不支持事件 heal');
    expect(parseProtocol('新单位用<spawn>建档，已有单位用<deploy>调取。\n' + block).errors).toEqual([]);
    expect(parseProtocol('<tb>\n<spawn>\n</tb>').errors[0]).toContain('新单位需要 name、side、scale');
  });
  it('AI扫描只把正文交给副API', () => {
    const messages = narrativeScanMessages({ save: {}, messages: [{ id: 'm', role: 'assistant', text: izumi, completed: true }] }, settings);
    const sent = JSON.parse(messages[1]!.content).正文[0].text as string;
    expect(sent).not.toContain('小此已经切换'); expect(sent.startsWith('<type>')).toBe(true);
  });
});

describe('繁体中文正文', () => {
  it('繁体规格、特质、枚举和单位换成简体识别，名称保留繁体', () => {
    const traditional = [
      '<tb>',
      '<field env="平原野戰" light="白天"/>',
      '<spawn name="威靈頓公爵" side="我方" scale="個體" level="6級" weapon="軍官指揮刀:劍L3+3防禦" armor="英軍將官制服:輕甲L3+2防護" skills="步兵方陣戰術:buff範圍士氣L4" traits="統率,不潰"/>',
      '<spawn name="冷溪近衛步兵連" side="我方" scale="編隊" hp="120人" hpMax="120人" level="4" weapon="布朗貝斯燧發槍:火槍L3+2傷害" weapon2="刺刀:長兵器L3" armor="近衛軍呢制服:輕甲L3" skills="齊射交替掩護:物理範圍射擊L3" traits="守城工事,頑固,精銳"/>',
      '<spawn name="法國大砲兵連" side="敵方" scale="編隊" hp="12" hpMax="12" body="人形" level="4" weapon="十二磅重型加農砲:直射火砲L3+8傷害" armor="野戰砲兵護甲:輕甲L2" skills="飽和轟擊:物理範圍射擊L4" traits="破甲,攻城工兵"/>',
      '</tb>',
    ].join('\n');
    const simplified = parseProtocol(block), result = parseProtocol(traditional);
    expect(result.errors).toEqual([]);
    const mechanics = (event: object) => JSON.stringify(event, (key, value) => ['raw', 'name', 'weaponName', 'weapon2Name', 'armorName', 'weapon', 'weapon2', 'armor'].includes(key) ? undefined : value);
    expect(result.events.map(mechanics)).toEqual(simplified.events.map(mechanics));
    expect(result.events[1]).toMatchObject({ name: '威靈頓公爵', weaponName: '軍官指揮刀', armorName: '英軍將官制服', skills: [{ name: '步兵方陣戰術' }] });
    expect(result.events[3]).toMatchObject({ name: '法國大砲兵連', weaponClass: 'cannon', scale: 'company', body: 'human' });
    expect(result.events[3]!.raw).toContain('side="enemy"');
  });
  it('只换写规格段与词表文字，简体和名称不变', () => {
    expect(simplifiedChinese('長兵器範圍射擊衝鋒強化機砲')).toBe('长兵器范围射击冲锋强化机炮');
    expect(simplifiedSpecification('雙手劍:劍L5+2傷害,鐵衛:物理單體近戰L4')).toBe('雙手劍:剑L5+2伤害,鐵衛:物理单体近战L4');
    expect(simplifiedChinese('捍卫著名瞭望塔的士兵')).toBe('捍卫著名瞭望塔的士兵');
  });
});
