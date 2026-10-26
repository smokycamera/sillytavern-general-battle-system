# 统一剧情效果与正文资料复核（2026-10-26）

版本：3.0.21；实现分支：codex/unified-story-effects。战斗规则仍为V38。发布按test→main流程进行，本次按用户明确授权不查询或等待远端CI；本地验证结果如下。

## 最终入口

- 新单位：spawn的effects属性与rounds、battles或permanent；count创建的每张卡独立授予。
- 已有单位：effect的effects属性；追加来源，不替换固有traits或其他来源。
- 解除：effect clear按名称或all；unit_set clear及旧bless、affect、unbless、unaffect继续兼容。
- 世界书“获得与解除效果”按用户最终原文替换，没有另加说明或改写措辞。备份与批准原文在docs/prompt-backups/。

## 共用与期限

新效果复用技能规格解析、compileSkill、upgradeCombatSkills以及状态/特质/屏障结算。保存编译后的效果，不在读档、部署或回放时重新编译；实际状态保存在原conditions管线，通过effectSourceId关联期限来源。

rounds按完整战斗轮递减；battles仅在战果提交递减；permanent不自动到期。来源管理的状态不额外消耗普通状态或控制激活时钟。部分解除保留旧来源作为重放凭据，剩余内容转入同期限的子来源，不重新授予、续期或补满容量。

持续状态、授予traits及屏障可用；即时治疗、士气/资源变化、位移、区域与召唤不作为持续来源执行。嘲讽与魅惑需要施术者，仍由战斗技能施加。非法规格和不支持的效果会明确报错，不能悄悄漏掉复合规格中的某一项。

## 复核修正

1. 旧effects列表将+当分隔符，会把复合效果拆成多份。新spawn/effect保留规格中的+；旧affect的状态列表规则不变。
2. 新状态若又走普通递减，会早于来源到期；若同时走旧来源修正收集，还会重复计入。新来源走现有状态结算，旧来源保留原路径。
3. 正文摘要原先会把按场/永久来源的内部状态时长显示为99轮。经用户确认，新效果改为标准effects属性行，显示真实剩余期限，普通conditions摘要排除这些来源。
4. 部分解除后正文只展示仍有效的效果；等级、数值修正和剩余期限保留。普通正文不展开内部配方；scan专用资料继续有详细编辑字段。
5. 剧情屏障与普通技能屏障混用时，原来的单份屏障记录会覆盖来源期限。仅对含新剧情屏障的记录保存各份保护的容量与期限，容量仍取最大值，吸收时各份同步消耗。普通屏障及旧快照保留原结构和行为；归档只留下仍有效的剧情屏障。

## 验证

- TypeScript检查通过。
- 原生扩展标准测试：36个文件、300项通过。
- 最后一次引擎及正文定向验证：8个文件、153项通过，其中统一效果14项，覆盖count、部署、效力对照、部分解除、驱散、重放、两种战斗整轮/快照、按场提交、屏障混用与正文资料。
- 另已通过正文协议、旧事件、新单位引用、装备/部署同批事务及渲染相关回归。
- 原生扩展构建、verify:dist与本机Chrome的浏览器冒烟验证通过。Playwright默认浏览器未安装，使用脚本已有的TB_BROWSER入口指定本机Chrome，不修改或跳过断言。
- 两条历史兼容脚本未通过，未记作通过，也未修改其断言或允许列表。使用origin/test 52e38ce的独立导出副本对照，复现了相同失败：verify-recovered-scenarios仍要求准备技能数为5，实际为6；verify-native-compatibility比较旧快照时存在activationStarts、aiRevision、haste/intel等元数据差异。这些失败在本次修改前已经存在。

## 正文AI实际资料样例

运行`scripts/inspect-story-ai-context.ts`，通过真实剧情事务创建再生赤翼骑兵连，调用当前narrativeProjection导出资料。示例包含主副武器、护甲、盾牌、三项技能、固有traits、佩戴/消耗道具、普通流血和两份不同期限的剧情效果。

- docs/examples/unified-effects-20261026/story-context.txt：普通正文的完整插件上下文。
- docs/examples/unified-effects-20261026/story-edit-request-context.txt：明确修改档案时的普通正文上下文。
- docs/examples/unified-effects-20261026/secondary-scan-context.txt：副API扫描专用资料，用于对照。
- docs/examples/unified-effects-20261026/unit-record.json：完整存档，便于核对哪些字段没有投影给正文。

这些文件展示插件追加的资料，不包含宿主另行拼接的人设、聊天记录和其他世界书。示例单位由脚本构造，不是从用户聊天存档读取。

临时清理：自动审批拒绝删除.tmp-effects-baseline/、.tmp-effects-baseline.zip及release/native-candidate/的命令，返回blocked by policy；这些对照/生成文件保留在本地。临时编辑脚本和对照日志已移除。
