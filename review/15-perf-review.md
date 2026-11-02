# 多轮审改：效率与缺陷（v0.2.0）

范围：`index.ts`、`src/**/*.ts`、`tests/load-check.mjs`、`README.md`、`PLAN.md`。
每轮都是「读全文 → 记问题 → 一次改完 → 重读」，直到一整轮零发现。

## 第 1 轮（读全文）

| # | 类别 | 问题 | 处理 |
| --- | --- | --- | --- |
| 1 | 效率 | ticker 每秒 `invalidate()` **消息组件**，等于每秒把每条带 Process 的消息（含全部 Markdown）重建一次 | 头行注册改成注册 `lineComponent` 本身，ticker 只重置那一行的宽度缓存；每条消息只保留一个头行引用（`registerHeader(owner, line)` + `WeakMap` 回收旧行） |
| 2 | 效率 | 任何工具事件都 `invalidateAll()`，整条转录的每条消息全部 `updateContent` | 组件按 run 绑定（`bindComponent`），事件走 `invalidateRun(run)`；只有整块折叠/开关切换才全量 |
| 3 | 效率 | 每个 `thinking_delta`、每个 `tool_execution_update` 都请求重绘（按 token 计） | `paintStream()` 合并到 100ms 窗口；widget 的挂载/移除仍立即执行 |
| 4 | 效率 | 渲染时 `split("\n")` 整段思考找最后一行（Process 行与 Now 行各一次） | `noteThinking` 增量维护 `lastLine`，渲染直接读 |
| 5 | 效率 | `tailLine` 从尾往前逐字符量宽度，最坏 400 次 `visibleWidth` | 改二分查找（后缀宽度单调） |
| 6 | 缺陷 | `Process` 关掉、`Now` 开着时 ticker 直接 `return`，Now 的秒数不走 | ticker 拆成两件事：块在跑就 tick 头行，否则有 Now 就重绘 |
| 7 | 缺陷 | 底栏右组借用 `joinColumns`，左组短于 `minimumLeft` 时走“太窄”分支，右组不再贴右 | 自己算空格：`room = width - 左 - 右`，`room >= 2` 才拼接 |
| 8 | 效率 | `headerLine` 与 `runMeta` 各扫一遍工具表统计 issue | 只扫一遍，结果传下去 |

## 第 2 轮（重读改动）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `configurePatches.expand` 里 `setBlockExpanded` 排了微任务重绘，紧接着又 `invalidateAll()`，一次切换做两遍全量 | 去掉 `expand` 里的立即全量，交给 `setBlockExpanded` 的合并重绘 |
| 2 | `paintStream` 的 `Parameters<typeof invalidateRun>[0]` 写法难读 | 改成 `Run \| undefined` |
| 3 | `bindComponent` 每帧都 `WeakMap.set` 一次 | 已绑定同一个 run 就直接返回 |
| 4 | 新的思考段以 `\n` 开头时 `liveThinking.lastLine` 会沿用上一段文本 | 改为无条件取本段的值 |

## 第 3 轮（再读全文）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `getContextUsage()` 会遍历整个会话（`buildSessionProjection` + `getBranch`），而底栏**每帧**都调用它，`pulse` 每秒再调一次 | `snapshot()` 加 200ms 缓存，`apply`/`stop` 时失效；用例 **Y** 守住（21 帧只读 2 次） |
| 2 | 点开思考行时 `invalidateAll()`，把整条转录重建 | 改为 `invalidateRun(run)` |
| 3 | README 的 `src/footer.ts` 说明仍写“先丢 token 数” | 改成“先丢进度条、再丢供应商” |
| 4 | PLAN 顶部状态停在 v0.1.1 | 改成 v0.2.0 |

## 第 4 轮（再读全文）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | delta 恰好是换行时 `lastLine` 变空，Process 行预览瞬间消失（文本其实还在） | `thinkingLine` / `nowHeadline` 在 `lastLine` 为空时回退到 `lastLineOf(text)` |
| 2 | 展开的 Now 行每次重绘都 `split` 整段思考取末 3 行 | 新增 `lastLines()`，从尾部向前扫描，不再整段切分 |
| 3 | 用例 Y 排在 W 前面 | 挪到 X 之后 |

## 第 5 轮（再读全文）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 原生模式下（Process 关 / Pi 自己画思考）`handleMouse` 也会 `ensureRow()`，给不该管的组件造行 | 先判开关与 `thinkingVisible`，再取行 |
| 2 | `/process`、`session_start`、`stop()` 里 `setBlockExpanded` 的合并重绘和随后的 `invalidateAll()` 重复 | `setBlockExpanded(value, redraw)`，这三处传 `false` |
| 3 | 用例里残留一句 `liveComponent.invalidate = liveComponent.invalidate;` | 删除 |

## 第 6 轮（复读 + 验证，收敛）

- 逐文件复读全部源码、测试、README、PLAN；复核第 1–5 轮 19 项，全部落地，无回归。
- 无新发现。

## 验证

- `tsc --noEmit` 通过；加 `--noUnusedLocals --noUnusedParameters` 也通过。
- `node tests/load-check.mjs` A–Y 全绿。本轮新增：
  - **U**：同一个消息组件在第二个工具启动后自动重画（`2 tools`）；settled 的块不被后续 run 的事件重建。
  - **V**：40 个 thinking delta 最多触发 2 次重绘；跨窗口后恢复。
  - **W**：左组很短时右组仍贴右边缘（40 列正好填满）。
  - **X**：ticker 不重建消息组件，但头行时长从 `0ms` 走到 `1.5s`。
  - **Y**：21 帧只读会话 2 次。
- 反向验证（逐个还原修复，确认用例会失败）：
  - 头行注册回退成注册消息组件 → X 失败；
  - `STREAM_PAINT_MS = 0` → V 失败（40 次重绘）；
  - `invalidateRun` 换回 `invalidateAll` → U 失败；
  - 去掉 `setBlockExpanded` 的 `row.open` 复位 → P 失败（上一轮已验）。
- 真机（pty，`必须先调用 bash 工具运行 ls -a`）：
  ```
  ▾ Process · 1 thought · 1 tool · 2.9s
    ↳ ▸ thinking 160ms · Let me do that.
    ↳ bash  ls -a                                        exit 0 · 25ms
  ```
  点工具行 → `$ ls -a` / `.` / `..`（Pi 原生详情）；再点详情 → 只收起该行，块仍 `▾`。
  底栏 `Opencode Go · DeepSeek V4.1 Flash · max · 786 t/s` + 右侧 `⠄⠄⠄⠄⠄⠄⠄⠄ 15.5k/1M`。

## 接受不修（记录在案）

- `state.headers` / `state.components` 里被卸载组件的条目要等上限（1000）或 `rebuild()` 才清；失效它们是常数级操作。
- `trimRows` 淘汰的 row 仍被 `run.tools` 引用（run 上限 60，随会话自然回收）。
- 底栏 `pulse` 与 Process 的 ticker 各有一个 1s 定时器；职责不同，合并收益低于复杂度。
- `nowView()` 每次调用都会重新过滤运行中的工具（数量是个位数）。