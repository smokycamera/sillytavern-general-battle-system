# 小战三方混战实现结果

日期：2026-10-18。

## 行为结果

| 项目 | 状态 | 结果与证据 |
| --- | --- | --- |
| 阵营入口 | 已完成并验证 | spawn neutral 保留第三方归属；表单、编辑与生成支持 neutral。`panel/src/protocol.test.ts`。 |
| 歼灭终局 | 已完成并验证 | 任一阵营先退场后余两方继续；唯一存续阵营获胜，全灭平局；routing 沿用原有效状态；两方终局回归通过。`engine/tests/small-three-way.test.ts`。 |
| 本地行动 | 已完成并验证 | 我方离场后第三方仍能通过现有本地 AI 击败敌方并获胜；按真实 side 取独立指挥资料，视野及敌情沿用既有三方独立记录。`engine/tests/small-three-way.test.ts`。 |
| 据点争夺 | 已完成并验证 | 我方或敌方进入争夺范围均中断第三方累计；第三方重新独占两个完整回合后获胜。`engine/tests/small-three-way.test.ts`。 |
| 布局 | 已完成并验证 | 原准备请求包含第三方名单、neutral 指挥字段和东侧布局示例；解析后各方部署合法且第三方区域独立，原两方布局通过。`panel/src/llm-layout.test.ts`。 |
| 32张卡独立布阵 | 已完成并验证 | 两方和三方均可为全部32张卡分别指定位置，生成后保存恢复仍保留全部独立部署。单独部署32项，部署列表35项，部署区生成与存档统一预算59项。`panel/src/llm-layout.test.ts`。 |
| 其他小战模式 | 已完成并验证 | 护送夹具加入第三方后成功开战、执行本地行动，VIP 抵达后仍按原护送规则结算。`panel/src/battle-setup.test.ts`。 |
| 保存恢复 | 已完成并验证 | 生成三方部署后保存，第三方占领、指挥资料、部署、胜者及随机状态保留；恢复后的下一步行动与连续执行快照一致。`engine/tests/small-three-way.test.ts`。 |
| 战果与经验 | 已完成并验证 | 战报及战术面板明确显示“第三方获胜，我方失败”；我方击败第三方和第三方击败敌方均计奖，恢复后重复击倒不重复计奖。`panel/src/battle-settlement.integration.test.ts`。 |
| 提示词与契约 | 已完成并验证 | 应用本聊天逐项批准的世界书、扫描、准备、布局及手动/MCP契约差异；单独部署统一最多32项，仍只在正文明确独立行动时填写。模拟请求验证沿用原两步调用。 |
| test统帅逻辑 | 已完成并验证 | 合并test现有V20规则，第三方独立取指挥资料、协同对象与本地行动记录；两方统帅回归通过。`engine/tests/command-v2.test.ts`及使用V20的三方测试。 |

## 验证命令

```text
npx vitest run engine/tests/small-three-way.test.ts panel/src/llm-layout.test.ts panel/src/battle-setup.test.ts panel/src/protocol.test.ts panel/src/battle-settlement.integration.test.ts
npm run typecheck
```

初次相关测试：协议入口、护送通过；新增引擎与结算夹具使用了不受支持的9×13地图，布局旧断言仍匹配“双方”。夹具改用9×15，旧断言同步获批的“各方”文案。

初次类型检查：`engine/tests/scenarios.test.ts:278` 的胜者接收类型未包含 neutral；新增结算测试缺少战术视图参数。修正接收类型和调用参数后，`npm run typecheck` 通过。

修复及后续改动只复跑受影响项，最终均通过：

```text
npx vitest run engine/tests/small-three-way.test.ts panel/src/llm-layout.test.ts panel/src/battle-settlement.integration.test.ts
npx vitest run engine/tests/small-three-way.test.ts panel/src/llm-layout.test.ts panel/src/battle-setup.test.ts
npx vitest run panel/src/llm-layout.test.ts
```

最终相关测试文件全部通过，类型检查通过，无剩余已知失败。未使用真实副API。

32项布局与最新test合并后的验证：

```text
npx vitest run engine/tests/small-three-way.test.ts panel/src/llm-layout.test.ts panel/src/battle-setup.test.ts panel/src/protocol.test.ts panel/src/battle-settlement.integration.test.ts engine/tests/command-v2.test.ts
npx vitest run panel/src/siege-objectives.test.ts
npm run typecheck
npm run build:extension
node scripts/package-extension.mjs
npm run verify:dist
```

新增32项布局用例及最新test整合验证无失败。据点旧断言改为只匹配其验证的两方计数，允许新增neutral计数。安装包首次校验因构建后更新该面板测试文件导致源码指纹变化而失败；运行原封装脚本刷新封装后校验通过。

## 交付范围

生产改动限于小战及其输入、准备、结算链路；共享函数的默认两方会战行为保留。未修改会战引擎或JEV文件，未在本地运行全量套件。基于最新origin/test（0ebf908）的独立工作区合并，保留远端已有功能及D:\gbs未提交修改；源码与安装包一并更新test。

## 未覆盖情况

未增加方案之外的机制、场景矩阵或测试文件；本次唯一新增测试文件为 `engine/tests/small-three-way.test.ts`。
