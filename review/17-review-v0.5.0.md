# v0.5.0 审改（点内容即收 + 全项目复审）

范围：整个插件（`index.ts`、`src/**`、`tests/`、`README.md`、`PLAN.md`、`package.json`）。

## 第 1 轮（只读通读）

读法：入口 → 设置 → UI → 格式化 → 度量 → 底栏 → 过程块（state / render / patch / now / index）→ 测试全文；
再用真实会话文件与真实 Pi 组件跑探针，确认可疑行为。

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | **resume 后多出幽灵 `thinking` 行**：`rebuild()` 对「只有工具调用、没有思考」的 assistant 消息也 push 一个 `text: ""` 的 Thought | 真实会话 `rebuild` 后一条 run 出现 8 行 `↳ thinking`（无时长、无正文），头行写成 `30 thoughts` |
| 2 | **resume 后工具行丢掉耗时**：`toolResult` 消息自带 `durationMs`，`rebuild()` 没读 | 真实会话每行 `bash exit 0` 都没有 `· 120ms`，与实时视图不一致 |
| 3 | **resume 后 run 耗时不完整**：`endedAt` 只由「思考 ts + 时长」推，工具结尾不算 | 只有工具调用的 run 头行显示 `0ms`；思考后还有工具的 run 少算尾部时间 |
| 4 | **resume 后被打断的工具行没有 `interrupted`**：`close()` 没像 `settleRun()` 那样补 outcome | 真实会话最后一行 `bash cancelled`，摘要为空 |
| 5 | **回答正文与思考正文都绕过 Pi 的 markdown transformers**（原生会应用；README 只承认思考正文） | 探针：注册 `[T]` 前缀 transformer，原生输出 `[T]partial`，插件输出 `partial` |
| 6 | **错误/中断提示与 Pi 不一致**：`error` 且无 `errorMessage` 时什么都不显示（原生 `Error: Unknown error`）；`aborted` 忽略自定义 `errorMessage`（原生显示它） | 探针对照原生组件 |
| 7 | **底栏 `refresh()` 不清快照缓存**：`message_end` 后的精确 t/s 最多晚 1s 才出现 | 探针：`refresh()` 前后 `getContextUsage()` 都只读 1 次 |
| 8 | **底栏关掉后 1s 心跳没停**：`apply(ctx,false)` 只清引用，interval 继续跑 | 读代码（`refs.pulse` 只在 `stop()` 清） |
| 9 | **resume / transformer / 提示语没有回归测试**：`rebuild()` 只有一条「有思考」的用例 | `grep rebuild tests/` 仅 G 一处 |
| 10 | **文档**：`PLAN.md` 顶部状态仍是 v0.4.0；v0.5.0 没写「取代 R1c/R1d 的命中规则」；README 的 transformer 限制少写了回答正文；没写「点击依赖 fullscreen 模式」 | 全文检索 |
| 11 | **`opencode-go` 显示成 `Opencode Go`**（底栏品牌名映射缺一项） | `providerName("opencode-go")` |

不记为缺陷的既有取舍（复核后保留）：

- 头行落在同一条消息的回答文字下方（PLAN「与计划的偏差」已记录，A 方案的必然结果）。
- 折叠只在 fullscreen（Pi 默认）下有点击事件；regular 模式仍可用 `Ctrl+O` / `/process`（补文档，不改代码）。
- 展开的思考正文点击后不进入选择态：与工具行一致的取舍。

## 第 2 轮（重读改动 + 实机数据）

复查第 1 轮每一条是否真修好，并把 `rebuild()` 拆开重读：

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `rebuild()` 计算 run 结束时漏掉「纯文字回答」：一轮以回答收尾时，resume 后的耗时少算最后一段 | 对 run 打开期间的纯文字 assistant 消息也更新 `runEnd`（`ts + durationMs`）；G2 追加尾消息，断言 1.7s |
| 2 | Now 关掉后 1s 心跳仍请求整屏重绘（`nowView()` 不看开关） | ticker 条件加 `getSettings().now`（`src/process/index.ts`） |

复核第 1 轮 11 项：逐条在代码里对应到改动，并跑探针复验：

- 真实会话（`~/.pi/agent/sessions/…jsonl`）`rebuild` 后：一条 76 工具的 run 无空 `thinking` 行，工具行带 `durationMs`，头行 `2m 55s` 量级正确。
- 原生 vs 插件对照：`[T]` transformer、`Error: Unknown error`、abort 自定义文案，三者输出一致。
- 底栏探针：`refresh()` 后下一帧重新读 session；`apply(false)` 清掉 interval。
- `Now` 点击：Q 覆盖「展开态点工具行收整卡」「收起态点第 1 行不动」。

## 第 3 轮（全文再读 + 发布卫生）

- 逐行重读 `patch.ts` / `state.ts` / `footer.ts` / `process/index.ts` 改动区，检查事件顺序、`invalidateRun` 递归、`runEnd` 边界（纯回答、只有工具、被打断）。
- 重新确认鼠标链路：`tui-alt-screen` 的 release→click 合成、drag 不触发 click，所以展开的思考正文仍可拖选，点击才折叠。
- 新建 clone（`/tmp/clonetest`，只补 `node_modules` 软链）跑 `tsc --noEmit --noUnusedLocals --noUnusedParameters` 与 `node tests/load-check.mjs`：全绿，A–Z。
- `git diff --check` 无空白错误；`npm pack --dry-run` 35 个文件、版本 0.5.0，无 `tmp/`、无 `node_modules/`。

零发现，收敛。

## 保留的既有取舍

- 头行仍落在同一条消息的回答文字下方（PLAN 已记录，A 方案限制）。
- 只开 `Process`、关掉底栏与 `Now` 时，`state.tui` 没有来源：live 耗时靠 Pi 自己的重绘（工作中动画）跟上，不做空 widget 换取 TUI 句柄（会多一行空白）。
- 展开的 thinking 正文点击只收行，不开始文本选择；拖选不受影响（click 只在未拖动时合成）。
