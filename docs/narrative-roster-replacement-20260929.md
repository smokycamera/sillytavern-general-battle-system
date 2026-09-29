# 新战斗参战名单替换修复（v1.5.1）

## 问题和行为

基于 `e0ebad2e59e9fe832ab5749452c4d4884f34988b`（v1.5.0）。确认正文新出场批次时，原实现从上一次 `rosterIds` 开始，再追加 `spawn` / `deploy`；历史恢复也做集合并集。因此上一场 A、B 未手动移出时，新场 C、D 会成为 A、B、C、D，甚至误触发 32 卡上限。

本批含 `spawn` / `deploy` 时，以本批明确指定的单位替换本场参战名单。旧单位档案、装备、战果及历史记录不删除；继续出战的旧单位用 `deploy` 明确指定。纯治疗、换装、等级、环境、物品等没有出场指令的事务保留名单。手工从仓库逐个加入单位的操作保持原样。

新名单只在事务候选副本上构造，校验失败不改变原存档，宿主保存未确认时不替换当前事实，重试使用同一候选。单位更新、改造、学习仍先于部署执行；战内/未结算守卫不变。

恢复历史批次时只恢复该批仍可出战的档案，清理其他批次的残留；不重新生成单位、治疗或发放物品。同数量换人也增加事实版本，相同名单重复恢复保持幂等。恢复按钮也检测夹带旧单位的情况。人数校验只计算新批明确出场的单位，真正超过 32 卡仍整批拒绝。

## 验证

- 在旧源码上运行初始回归用例：17 项中 11 项失败，复现名单累加和恢复问题；修复后扩展到 20 项新增用例并全部通过。
- 定向测试：`npx vitest run panel/src/narrative-roster.test.ts panel/src/narrative-state.test.ts panel/src/narrative-controller.test.ts runtime/tests/narrative-roster.test.ts`，4 个文件，63/63 通过。
- `npm run typecheck`：通过。
- 全套测试：1544 项，1537 通过，7 项失败；与主分支 CI 工件逐项比较，失败项完全相同，无新增失败。
- `npm run build:extension`：通过。
- `npm run verify:dist`：通过，v1.5.1 的 38 个安装文件与源码一致。
- 容器浏览器冒烟尝试被运行环境阻止：Chromium 访问本机 HTTP 测试服务返回 `net::ERR_BLOCKED_BY_ADMINISTRATOR`，因此本地浏览器端到端测试不计为通过。原生宿主服务、保存/刷新/重试路径已由上述集成测试覆盖；真实酒馆环境未实测。

已有的 7 项失败：

1. `unified-replay.test.ts`：V5 human-four T1。
2. `unified-replay.test.ts`：V5 giant-four T10。
3. `unified-replay.test.ts`：V6-prototype giant-four T6。
4. `unified-replay.test.ts`：V6-prototype giant-unbreakable T1。
5. `unified-replay.test.ts`：V6-prototype human4-vehicle2 T10。
6. `life-limit-state.test.ts`：正文高生命自动截断并给出提示，编队人数保留原值。
7. `life-limit-state.test.ts`：正文事务不能在生成后用旧事件值覆盖生命上限。

本次没有修改这些失败测试，没有改动内置世界书、伤害公式或永久 CI 校验流程。
