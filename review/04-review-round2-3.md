# 审改 第 2 / 3 轮

## 第 2 轮（读全文，找缺陷）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `rebuild` 把同一消息里多个 thinking 块压成一条记录，但时长只取第一块 | 按 `ts` 合并成一条，文本用空行连接 |
| 2 | 点工具行想“看原生详情”时只改了 `row.open`，组件自身的 `expanded` 仍是 false，详情停在摘要 | 点击时用原生 `setExpanded` 展开该行，同时不动整块的折叠标志 |
| 3 | 块折叠后，之前点开的行仍以展开态存在 | 折叠时把所有 `row.open` 复位 |
| 4 | 每次 `updateContent` 都新建一个 header 组件并登记，ticker 会去失效上千个死对象 | 改为登记消息组件本身（ticker 失效 → `updateContent` 重建头行），集合不再增长 |
| 5 | `Process` 关掉后 `/process` 仍会切换并提示“已折叠”，误导 | 先判断开关，关掉时提示去 `/ui` 打开 |
| 6 | `Process` 关掉后 ticker 仍每秒失效头行 | ticker 先判开关 |
| 7 | footer 的一秒脉冲没有停止入口，会话切换后仍在跑 | `Footer.stop()`，`session_shutdown` 调用 |
| 8 | 嵌套工具（codemode / 子代理）也被计入 Process 行，计数翻倍 | `parentToolCallId` 存在的 start/end 直接忽略 |
| 9 | 读空文件 / 图 / 空目录时 outcome 显示成 `0 lines`、`1 result` | 图片 → `image`，空文件 → `empty`，`No files found` / `(empty directory)` 显式识别 |
| 10 | `ui.ts` 多了一个无意义的 key 包装；`format.ts` 的 `cachedLine`、`metrics.ts` 的 `ttftText`/`streaming`、`now.ts` 的 `setTheme` 无人使用 | 删除 |
| 11 | `headers` 集合在会话切换后不清 | `rebuild` 里清空，`session_shutdown` 里也清 |
| 12 | Now 组件缓存了旧主题，换主题后颜色不跟随 | 渲染时读 `state.theme`（ticker 每秒同步一次 ctx 的主题） |
| 13 | `tailLine` 对超长思考串逐字符测量 | 输入先切到最后 400 字符 |

## 第 3 轮（再读全文，查是否修干净、是否引入新问题）

- 逐文件重读 `index.ts`、`src/*.ts`、`src/process/*.ts`、`tests/load-check.mjs`、`README.md`、`PLAN.md`。
- 复核第 2 轮 13 项：全部落地，无回归。
- 新发现：无。
- 验证：
  - `./node_modules/.bin/tsc --noEmit` 通过。
  - `node tests/load-check.mjs` A–I 全绿（含“纯文字回答不出 Process 头”“思考时长=增量区间”“resume 重建计数与 diff 统计”“点击交还原生渲染”“header 数量有界”“非 TUI 回退”）。
  - `pi -p … --no-extensions -e .` 打印模式正常。
  - 真 TUI（pty）冒烟：`Process` 未出现（该次回答没有 thinking，符合规则），footer 显示
    `Qwen Token Plan 2 · DeepSeek V4.1 Flash · max · 333 t/s · ⠄⠄⠄⠄⠄⠄⠄⠄ 0.2% 2k/1M`，无异常输出。

结论：一轮完整复查零缺陷，收敛。版本记为 v0.1.1。