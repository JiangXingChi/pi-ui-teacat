# 末轮审改与发布（v0.2.0）

目标：发布前的最后一次多轮复查——代码正确性、效率、发布卫生；零缺陷后上传。

## 第 1 轮（读全文 + 发布卫生）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 会话条目类型仍是旧项目名 `focus-thought`，与包名不一致 | 改为 `pi-ui-teacat-thought`（README/PLAN/测试同步；旧会话因此不再显示思考时长，属可接受取舍） |
| 2 | `.gitignore` 只忽略 `tmp/refs/`，整个 50MB 的 `tmp/` 会被提交 | 改为 `tmp/`，并忽略上游副本 `review/ref-pi-ui/` |
| 3 | `package.json` 缺 `author`/`repository`/`homepage`/`bugs` | 按 GitHub 账号补齐 |
| 4 | README 安装地址仍是占位符 `<you>` | 换成 `git:github.com/JiangXingChi/pi-ui-teacat` |
| 5 | LICENSE 的版权方是占位符 | 改为 `JiangXingChi` |
| 6 | AGENTS.md 描述的 `data/`、`output/` 目录并不存在 | 改成真实结构（入口、src、tests、review、tmp） |

## 第 2 轮（重读改动）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | README 没有“怎么跑测试”，别人克隆后无从下手 | 增加 Development 段（`tsc --noEmit`、`node tests/load-check.mjs`、无构建步骤） |
| 2 | 项目脱胎于 `prjct-app/pi-ui`（MIT），公开仓库里没有致谢 | 增加 Credits 段 |
| 3 | 文档里到处是 `/home/teacat/...` 绝对路径 | 统一换成 `~/...` |

## 第 3 轮（再读源码）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `THOUGHT_ENTRY` 在 `process/index.ts` 与 `state.ts` 各写一份字面量，漂移会静默破坏 resume | `state.ts` 导出，`index.ts` 导入 |

## 第 4 轮（环境与真机）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 本机没有配置 git 身份 | 仓库内 `user.name` / `user.email` 设为 GitHub 账号 |
| 2 | — | 真机（pty）复测：Process 块、思考预览、工具行展开/只收起本行、底栏右对齐，全部正常 |
| 3 | 无 TODO/FIXME/console.log 残留，`tsc --noUnusedLocals` 干净 | — |

## 第 5 轮（自包含性 → 发布）

- `git init -b main` → 提交 35 个文件（不含 `node_modules/`、`tmp/`、`review/ref-pi-ui/`）。
- 克隆到 `/tmp` 后只补 `node_modules` 软链：`tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过，
  `node tests/load-check.mjs` A–Y 全绿 —— 说明仓库自包含，不依赖未提交文件。
- `gh repo create pi-ui-teacat --public --source=. --remote=origin --push`；
  `gh api` 复核：public、默认分支 `main`、`package.json` 与 `README.md` 均在。

## 结论

第五轮零发现，收敛。仓库：https://github.com/JiangXingChi/pi-ui-teacat

安装：

```bash
pi install git:github.com/JiangXingChi/pi-ui-teacat
```
