import type { BattlefieldScene } from '../engine/src/index.js';
import type { CompoundPattern, TrenchPattern } from '../engine/src/small/position-plan.js';
export const positionScenarios: { id: string; scene: BattlefieldScene; text: string; compound?: CompoundPattern; trench?: TrenchPattern; gates?: number; gateStates?: string[] }[] = [
  { id: 'compound-courtyard', scene: 'building_siege', compound: 'courtyard', gates: 1, gateStates: ['closed'], text: '围攻一座独立仓院，不是城市。单院布局：院墙围着一个开阔院子，北面有可进入的仓房。南面只有一座关闭院门，没有破口。我方四人在院外南边进攻，敌方四人在院内守仓。目标夺取北面仓房。' },
  { id: 'compound-forecourt', scene: 'building_siege', compound: 'forecourt', gates: 1, gateStates: ['open'], text: '独立庄园攻防，战区包含院外和院内，采用前后院布局。南边前院与北边后院有横向院墙分隔，通过错位的内门连通，北端是主屋。外院只有一座敞开的南门，其他外墙完整。我方四人在院外南面，敌方四人在院内。任务夺取主屋。' },
  { id: 'compound-wings', scene: 'building_siege', compound: 'wings', gates: 2, gateStates: ['closed', 'open'], text: '这是独立宅院的围攻，双翼夹院布局：东西厢房围着中间院子，北端主屋与厢房有门相通。外院墙有关闭的南门与敞开的东侧门，无破口。我方四人在院外，敌方四人在院内，我方要夺取主屋。不是城墙攻城，也不是所有人都在室内。' },
  { id: 'compound-dogleg', scene: 'building_siege', compound: 'dogleg', gates: 1, gateStates: ['closed'], text: '独立据点采用曲折院落布局：前后两部分向不同侧错开，院墙轮廓转折，穿过院落时须拐弯才能到北部主屋。外墙完整，只有一座关闭的南门。我方四人在院外南侧，敌方四人在院内，目标夺取主屋。战区没有城市。' },
  { id: 'compound-bailey', scene: 'building_siege', compound: 'bailey', gates: 1, gateStates: ['closed'], text: '一座独立小堡的内外院布局。完整外围墙围住外院，北部另有围住主屋的内院墙，内门可通行。外围只有一座关闭的南门。我方四人在院外南方进攻，敌方四人在院内防守，要夺取北部主屋。这不是大城市，也不是室内遭遇。' },
  { id: 'compound-ruined', scene: 'building_siege', compound: 'ruined', gates: 2, gateStates: ['closed', 'destroyed'], text: '围攻独立废弃庄院，采用破损院落布局。院内隔墙残缺，多处宽缺口和瓦砾，北部主屋残存。外院墙没有额外破口；南正门关闭，西侧门已毁。四名我方人员在院外南边，四名敌人在院内，目标夺取主屋。' },
  { id: 'trench-opposed', scene: 'trenches', trench: 'opposed', text: '相对前沿布局的堑壕战。北方敌军四人守折线前沿壕，南方我军四人守另一条前沿壕，两边各有交通壕向后延伸，中央无人地有弹坑。没有第二线壕、前伸支壕和建筑院墙。本场目标击败敌人。' },
  { id: 'trench-depth', scene: 'trenches', trench: 'depth', text: '双方在纵深防线布局中交战：各自的前沿壕后面还有第二线壕，折线交通壕连通前后两线。北边四名敌人在北部战壕，南边四名我方在南部战壕，中央为弹坑无人地，不涉及建筑或城墙。目标击败敌军。' },
  { id: 'trench-echelon', scene: 'trenches', trench: 'echelon', text: '堑壕战采用梯次斜线布局。南北双方的前沿段逐段斜向错开呈阶梯形，各自有交通壕通往后方，阵地不是两条齐平横线。北边四名敌军，南边四名我军，双方都在壕内，中央是开阔无人地。目标击败对方。' },
  { id: 'trench-salient', scene: 'trenches', trench: 'salient', text: '突出部布局的战壕阵地：双方前沿各有一处向无人地凸出的折角，形成突出部的正面和两侧翼，后面有交通壕。敌方四人在北部壕内，我方四人在南部壕内，中间弹坑散布，没有城市。双方就地交战，击败敌人即可。' },
  { id: 'trench-strongpoints', scene: 'trenches', trench: 'strongpoints', text: '分散支撑点布局的壕沟阵地：前沿不是连续长横壕，而是数个分散的短壕支撑点，各支撑点通过向后的交通壕连到同一条后方壕。北边四名敌军与南边四名我军分别在自己的壕系内，中间是无人地。没有城市建筑，目标击败对方。' },
  { id: 'trench-saps', scene: 'trenches', trench: 'saps', text: '前伸支壕布局的战壕战：南北双方前沿壕都有窄支壕向中央无人地伸出，支壕带拐角，与前沿壕、后方交通壕保持连通。敌方四人在北边壕内，我方四人在南边壕内，中央有弹坑，无城市与院墙，目标击败对方。' },
];
export const objectiveScenarios = (['building_siege', 'interior', 'trenches'] as const).flatMap(scene => (['escort', 'control'] as const).map(objectiveMode => ({
  id: `objective-${scene}-${objectiveMode}`, scene, objectiveMode, thirdParty: objectiveMode === 'control',
  text: (scene === 'building_siege' ? '独立院落攻防，单院布局，北面主屋，中部院子，关闭南院门。我方四人在院外南方，敌方四人在院内。'
    : scene === 'interior' ? '所有单位已在建筑同一层内部，环形回廊连接房间，所有房门可通行。我方四人在南，敌方四人在北。'
      : '纵深防线堑壕战，前沿壕、后方壕和交通壕互通，中央有无人地。我方四人在南侧壕内，敌方四人在北侧壕内。')
    + (objectiveMode === 'escort' ? '本场任务是护送我方1从地图最北边缘的撤离点离开，敌人负责拦截，不是歼灭战，也不是夺点。'
      : '另有独立第三方两人在东侧，与我方和敌方均敌对。本场是三方中立夺点，各方争夺中央的争夺空地，任何一方独占两个完整回合都能获胜，没有指定进攻方或防守方，不是歼灭战。'),
})));
