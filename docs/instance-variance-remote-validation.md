# v1.3.19 远端复核

在 GitHub Actions 的 Ubuntu / Node 22 / Chromium 环境，运行 36452665296 成功完成：

- 源补丁 SHA-256 校验与应用。
- npm ci、类型检查、5个专项文件60项测试。
- 原生安装包构建与 verify:dist 一致性校验。
- 面板构建及默认 localhost 浏览器流程，未使用 --offline。
- 320/390/690/1280px 布局、可见物品全选、已装备保护、单次确认与写入、保存失败重试、读档及固定浮动展示。

验证运行：https://github.com/smokycamera/sillytavern-general-battle-system/actions/runs/36452665296

运行产出的源码与 dist 提交：f641527adc225e2a82faa036ef95ceb1a99960f8。浏览器截图和 results.json 位于该运行的 frozen-rng-browser-validation artifact（保留14天）。浏览器使用真实构建页面与模拟宿主API，不代称真实ST/TT安装验收。

临时打包工作流与补丁分片已从最终分支移除，未修改常驻CI、未合并main。清理提交只删除临时工作流并添加本记录，不改变已验证源码或dist。

全量本地测试仍保留主分支已有的7项失败：1359项中1352通过；基线1319项中1312通过；新增40项全部通过，失败用例名称集合与基线完全一致。详细设计、1200场新旧对照和复现命令见 instance-variance-and-bulk-delete.md。
