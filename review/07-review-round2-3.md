# 审改 第 2 / 3 轮（v0.1.3）

## 第 2 轮（重读改动过的文件）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `hideThinkingBlock: false` 时我们不再出 Process 头，但工具行仍被鼠标补丁接管：左键点第一行会先被我们吃掉（`handled: true`），Pi 自己那一行（`renderShell: "self"`）的点击失效 | `patchedMouse` 增加 `state.thinkingVisible` 前置判断，原生模式完全放行 |
| 2 | 助手组件的 `setExpanded` 在 reload 时把**我们自己的包装**当成 original 抓走，包装层层套（不会无限递归，但每 reload 加一层） | 与工具组件同法：只在首次抓 original，reload 复用 `previous.originalSetExpanded` |
| 3 | `invalidateAll` 的函数头被我早先的编辑和一个 tab 粘在了一行（`{	for`） | 恢复换行 |
| 4 | reload（`pi` 内 `/reload` 或重载扩展）后会重复 patch，没有任何用例守住 | 新增用例 **O**：连续两次 `installPatches()` 后一次点击只切换一次 |

## 第 3 轮（再读全文 + 真机验证）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 折叠入口不止 `Ctrl+O`：`/process` 和 `stop()`（`/ui` 关掉 Process）直接写标志，没有复位 `row.open`；块收起后，之前点开的行仍以 Pi 原生详情露在外面（与 v0.1.1 审改第 3 项同一类缺陷） | 把 `setBlockExpanded()` 提成 `patch.ts` 的导出，`/process`、`configurePatches.expand`、`stop()`、`session_start` 全部走它；用例 **P** 守住（去掉复位后 P 失败） |
| 2 | `review/05` 写着“未在真机点鼠标” | 补做真机点击（pty + SGR 鼠标序列），并把结果写回该文档 |
| 3 | `review/05` 说本机模型不返回 thinking | 改成“部分回答才返回”，附真机 176ms 的样本 |

## 验证

- `./node_modules/.bin/tsc --noEmit` 通过。
- `node tests/load-check.mjs` A–P 全绿（O、P 为新增；O/P 去掉对应修复后都会失败）。
- 真机（pty，`-t bash`，让它跑一次 `ls`）：折叠态 `▸ Process · 1 thought · 1 tool · 1.4s`；
  鼠标点 `Process` 后 `▾ Process` + `↳ thinking 176ms` + 思考正文 + `↳ bash ls · exit 0 · 18ms`。
- `Ctrl+O` 路径此前已验（`review/05`）。
