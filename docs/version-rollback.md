# V6 统一规则回退点（v1.2.0）

- 升级前版本：v1.1.2，含手机定位、HTTP 浏览器兼容与页面恢复修复。
- 固定提交：`282fe4bed124bf62d4267a36686fdf6a28c8f3e3`。
- 留档分支：`rollback/v1.1.2-before-unified-v6`。
- 提交内含可安装的 manifest 和 dist，无需重新构建。

回退文件时先保留当前存档，再切到固定提交；恢复升级前导出的存档或升级预览保存的原档备份。v1.1.2 不认识 V6 规则、skill-v6.0 和 skill-zone-v2，不能把新标记删掉交给旧程序续战。共享主线需要撤销时，对本次合并提交创建 revert PR，保留后续历史，不强推覆盖。

V6 仍能继续旧版快照；数值升级仅在战外明确预览后确认。升级不会替用户操作实际聊天存档。

---

# 插件版本回退

本次重构通过单独 PR 合并，保留 Git 历史，不强推覆盖主分支。

## 固定旧版

- 重构前版本：**1.0.6**，包含 ST / TT 原生 LLM API 兼容修复。
- 完整提交：`3b276d8d46d8549e283aae38511735a5878e3d01`。
- GitHub 回退分支：[`rollback/v1.0.6-before-armor-v5`](https://github.com/smokycamera/sillytavern-general-battle-system/tree/rollback/v1.0.6-before-armor-v5)。这个分支用于留档，不继续开发。
- [固定提交源码和可安装文件](https://github.com/smokycamera/sillytavern-general-battle-system/tree/3b276d8d46d8549e283aae38511735a5878e3d01)。即使分支后来被误改，也可以按这个完整 SHA 定位。

旧版提交包含 `manifest.json` 和已构建的 `dist/`；回退不需要重新编译。GitHub Actions 临时构建产物可能到期，回退依赖的是仓库提交中的文件。

## 本机切换回旧版

先在插件里导出存档，保留升级前的备份。在扩展仓库目录中确认 `git status` 没有需要保留的本地改动，然后执行：

```bash
git fetch origin
git switch --detach 3b276d8d46d8549e283aae38511735a5878e3d01
```

重启酒馆或刷新扩展页面。恢复主线版本时：

```bash
git switch main
git pull --ff-only
```

若宿主的扩展安装/切换界面支持选择分支，也可选择上述回退分支。不同宿主界面有所差异，以实际支持为准。

## 让 GitHub 主分支撤销这次重构

在本次 PR 的合并记录处使用 GitHub **Revert** 创建撤销 PR，再检查并合并。这样会生成反向提交，不丢失中间历史。若后来有改动产生冲突，应在撤销 PR 中解决，不使用 `reset --hard` 加强推来覆盖共享主线。

本次使用 squash 合并，因此命令行可对本次 PR 显示的 squash 提交执行 `git revert <提交SHA>`，在新分支上提交 PR。不要把文档里的旧版 SHA 直接拿来 revert；那样撤销的是旧版自身的修复。

## 存档边界

1. V5 可以读取并继续原 V4 战斗，原伤害规则保留。
2. 1.0.6 不认识 V5 规则和 `skill-v5.0` 技能记录。不能保证把 V5 已保存的数据交给旧版后继续战斗。
3. 最稳妥的降级是“切回 1.0.6 + 恢复升级前导出的存档”。不要删除存档里的版本字段冒充旧版。
4. GitHub 回退只回退插件文件，不会自动撤销酒馆聊天、战斗进度或用户本地存档。若已在 V5 中推进进度，先单独保留当前存档；重新使用 V5 时仍可恢复它。

本次没有修改任何用户实际聊天存档。已有的导出、备份和恢复入口继续使用。
