# 32单位小规模战斗性能检查

2026-10-19。基线为本次开始时的工作区代码，包含已有未提交改动，不是 Git HEAD。

## 改动

- `engine/src/damage.ts`：伤害抽样副本先复制单位，再逐个替换可变分支，去掉条件对象展开。生命基数、状态列表、编队生命分组、屏障和士气仍隔离复制。
- `engine/src/member-health.ts`：已有序的成员生命分组用线性合并，跳过 Map 和排序；乱序输入保留原算法。返回全新分组对象，避免副本污染输入。
- 不改变96次伤害抽样、AI候选、战斗规则或随机数调用顺序。

## 测试口径与结果

Node v24.16.0，本机引擎计算。每场总计32个单位：双边16/16，三方11/11/10。V17规则，13×19开阔分层地图，每个单位为20人编队、等级4、无技能特质。纯步兵使用长矛；混编交替使用弓兵、骑兵、长矛步兵。固定接战位置，每种组合热身3次行动，再测3个种子的接战首轮，每轮32次行动，三方各自行动全部覆盖。

下表为3个种子的首轮总耗时平均值；生成单位、初始化、快照序列化和哈希不计入计时。不含浏览器渲染、Worker通信、存档，也不是整场战斗耗时。

| 场景 | 修改前 | 修改后 | 耗时降低 | 修改后每行动平均 |
| --- | ---: | ---: | ---: | ---: |
| 16对16，纯步兵 | 4.251 s | 3.982 s | 6.3% | 124 ms |
| 16对16，混编 | 5.664 s | 5.229 s | 7.7% | 163 ms |
| 11对11对10，纯步兵 | 7.500 s | 6.549 s | 12.7% | 205 ms |
| 11对11对10，混编 | 9.547 s | 8.998 s | 5.7% | 281 ms |

最初基线与类型检查有短暂重叠，未采用其性能数字。表中基线来自保存的旧代码副本单独复测；优化版测量期间也未运行本次测试/类型检查。属于本机小样本测量，未进行统计显著性检验，百分比不应视作所有场景的固定收益。

12组共384个行动后完整快照SHA-256逐一一致，实际伤害抽样计算次数也逐组一致。单次行动仍可能较慢：优化后的三方混编最长约743 ms。无技能开阔地图不能代表复杂技能、城区障碍或战斗后期。

## 验证与复现

新增 `scripts/benchmark-small32.ts`，默认每种组合3次，可用环境变量 `BENCH_TRIALS` 调整：

```powershell
node node_modules/vite-node/vite-node.mjs scripts/benchmark-small32.ts .diagnostics/small32-after.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run engine/tests/member-health-merge.test.ts engine/tests/barrier-preview-cache.test.ts engine/tests/damage.test.ts engine/tests/grid-battle.test.ts engine/tests/small-three-way.test.ts
```

类型检查通过；上述5个文件73项测试通过。新增生命分组合并测试覆盖空组、单组、有序重复、乱序重复、无效组过滤和结果不引用输入对象。

本地原始记录：`.diagnostics/small32-before-isolated.json`、`.diagnostics/small32-after.json`、`.diagnostics/small32-comparison.json`。CPU采样见 `.diagnostics/small32.cpuprofile`；热点主要为伤害抽样副本、成员生命合并和攻击包结算，路径反应攻击模拟也有开销。本轮仅处理前两处明确的小改动。
