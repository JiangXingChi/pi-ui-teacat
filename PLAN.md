# PLAN — 自研 Pi UI 插件（基于 pi-ui 二次开发）

状态：**v0.6.0 已实现**（底栏加缓存命中率；0.5.0 的点内容即收见 `review/17-review-v0.5.0.md`）
基线：`@prjct.app/pi-ui` v2.0.1（副本 `review/ref-pi-ui/`，研读笔记 `review/01-pi-ui-study.md`）
做法：直接在本项目 `src/` 里 fork 上游代码，按下面的改动清单改造；不重写。

## 改动清单

### R1 内容区：过程块（已完成）+ 进行中（当前动作）

| 项 | 内容 |
| --- | --- |
| 目的 | 问题和回答要能一眼看到；思考、工具是过程，过程里再分“已完成”和“正在做” |
| 结构 | ① 过程块：本轮已完成的思考与工具，折叠成一列；② 进行中：当下正在调用的工具或正在流出的思考 |
| 现状 | thinking 已由 Pi 折成一行；工具行是 pi-ui 的紧凑行，但与正文平级，且没有“正在做”的独立位置 |
| 参考 | `pi-compact-transcript`（折叠行/汇总）、`pi-smart-fold`（思考尾行）、`pi-berszi`（运行展开→结束折叠）、`pi-ui ActiveToolsWidget`（编辑器上方活动面板）、`pi-hush`（活动标签） |

目标样子：

```
u. 10:31
why does this bug happen

▾ Process · 1 thought · 3 tools · 42s     ← done, collapsed
  ↳ thinking 12s
  ↳ read  src/a.ts          184 lines
  ↳ bash  npm test          exit 1

p. 10:33
Fixed: a.ts was missing an await.

┌ Now (above the editor, live, gone when idle) ───────────────┐
│ ◆ Now · read src/a.ts · 3s                                  │
└─────────────────────────────────────────────────────────────┘
```

`Now` **同一时刻只有一行**，内容随状态替换（下面是三种可能，不会同时出现）：

```
◆ Now · thinking · 8s …「comparing both diffs」…     ← 思考流式中
◆ Now · read src/a.ts · 3s                          ← 单个工具在跑
◆ Now · 3 tools · read src/a.ts +2                  ← 并行工具，一行概括
```

实现：
1. **过程块（R1a）**：一次 run 一条 `▸/▾ Process · N thoughts · M tools · 42s` 头行；
   已完成的思考折成 `thinking 12s`，已完成的工具折成一行（含结果摘要），子行缩进 2 格、`dim`。
   共享折叠状态，收起时子行 `render()` 返回空、不占高度；点击/`Ctrl+O` 整块开关。
2. **进行中（R1b）**：放在编辑器上方的一条 widget（`ctx.ui.setWidget(..., { placement: "aboveEditor" })`），
   只显示“当前”：
   - 有工具在跑 → `◆ Now · 名字 目标 · 已用时`（并行时 `◆ Now · 3 tools · read src/a.ts +2`）；
   - 在流式思考 → `◆ Now · thinking · 8s …<最新一句>…`（取 `thinking_delta` 的尾部）；
   - 在生成回答 → 可以不显示（正文本身就是进度）或 `◆ 生成中`；
   - 空闲 → 直接移除 widget。
3. **交接**：进行中的项目**完成后才**出现在过程块里 —— 运行期间它的转录行渲染为空，
   只活在 widget；`tool_execution_end` / thinking 段结束 → 解除隐藏，折进过程块。
   避免同一个工具在两处同时出现。
4. **思考文本来源**：`message_update` 的 `assistantMessageEvent`（`thinking_delta`）拿尾部一行/N 行；
   结束后把该段折叠成 `thinking 12.4s`，时长按内容 hash 存 `appendEntry`，resume 后仍在。
5. **归并**：同名相邻工具合并 `N×`；失败另起一行；`edit/write` 不合并（diff 是重点）。
6. **展开**：`Ctrl+O`（`app.tools.expand`）或点击头行，一次展开全部子行；再按收起。
7. 关掉 R1 时全部回退原生渲染（widget 一起移除）。

补充要求（同样算基本需求）：
- **恢复会话要一致**：`/resume`、`/fork`、`/new` 后重建出来的历史，折叠形态与当初一致；
  思考时长从 `appendEntry` 读回，不重算。
- **展开 = 原生**：子行展开后交回 Pi 自己的渲染（diff/语法高亮/图片/截断提示都在），我们不重画细节。
- **非 TUI 模式不受影响**：`ctx.mode !== "tui"` 时 patch 空转，print/json/rpc 输出与原生一致。
- **渲染成本**：一行文本按宽度缓存，宽度不变就不重复 `truncateToWidth` / 拼接。
- **可关**：`/ui` 里 `Process`、`Now` 两项独立开关，关掉后与原生完全一致。

待定：
- 进行中放哪：编辑器上方 widget（推荐）/ Pi 原生 working 行（`setWorkingMessage`）/ 顶部条带（`pi-split-view` 那种）。
- 思考流式显示多少：只最后一行（推荐）/ 最后 3 行 / 全文尾部若干行。
- 回答正文要不要区分：最终回答正常显示；“带工具调用的中间回答”（commentary）是否压暗/加左边线（`pi-compact-transcript` 的做法）。

### R1c Now 展开（点开，v0.1.4）

| 项 | 内容 |
| --- | --- |
| 目的 | 并行工具、流式思考不该只挤在一行 `+2` 里；要看得清时有地方可看全 |
| 默认 | 收起，仍是一行（内容与 R1b 一致） |
| 符号 | `▸ Now`（收起）/ `▾ Now`（展开）；`◆` 不再用于头行——要让人看出这行可点 |
| 展开 | 点 `▸ Now` 这一行：头行下面是**每个运行中的工具一行** `  ↳ ◆ bash  ls            3s`；有流式思考时先 `  ↳ thinking 8s`，再显示最后 3 行正文（每行截断） |
| 收起 | 再点一次回到一行；点击只认头行（`y === 0`）、只认左键，子行点不动 |
| 上限 | 展开最多 9 行（Pi 的 widget 上限 10 行） |
| 状态 | 展开态是会话级的：`session_start` / `session_shutdown` 复位成收起；空闲时 widget 照旧整个消失 |
| 跟随 | 不新增键位；ticker 已每秒重绘，展开时正文与秒数自动跟随 |

实现：`src/process/now.ts` 加 `nowExpanded` / `resetNow()` / `nowView()` / `nowHeadline()`，`NowWidget` 实现 `handleMouse`（左键、`y === 0`）与多行 `render`；`src/process/render.ts` 加 `nowToolLine` / `nowThinkingLine` / `nowThoughtBody`，`nowLine` 改 `▸/▾`；`refreshNow`、ticker 的"有无 Now"判断从 `nowBody()` 换成 `nowView()`。鼠标能否到达编辑器上方 widget 已用探针实测（能）。

### R1d 过程块子行：默认一行，点开看内容（v0.1.5）

| 项 | 内容 |
| --- | --- |
| 目的 | 块展开后，每个子行（思考 / 工具）都只占一行；正文想看的时侯再点开，不要把整段思考直接铺在转录里 |
| 思考行 | 一行 `↳ ▸ thinking 12s`；左键点这一行 → `↳ ▾ thinking 12s` + 下方显示完整思考正文；再点收起 |
| 工具行 | 不变：已经是一行摘要，左键点开交回 Pi 原生详情（diff / 高亮 / 图片），再点收起 |
| 无正文 | 思考段没有文本时不出 `▸/▾` 标记，点了也不响应 |
| 复位 | 整块收起（`Ctrl+O` / 点头行 / `/process` / `/ui` 关掉）时，所有点开的思考和工具行一起收起 |
| 鼠标范围 | 只认左键、只认该行（`y === 0`）；块收起时子行本来就不渲染，点不到 |

实现：`Thought` 加 `open?: boolean`；`thinkingLine` 加 `▸/▾` 标记；`patchedUpdateContent` 把思考行包进 `MouseRegion`（点击切换 `thought.open` 并 `invalidateAll()`）；`setBlockExpanded(false)` 同时复位 `thought.open`。

### R1e 思考行带预览（v0.1.7）

| 项 | 内容 |
| --- | --- |
| 目的 | 收起时只写 `thinking 12s` 看不出它在想什么；行内给一段预览，仍然只占一行 |
| 形式 | `↳ ▸ thinking 12s · The user wants me to run ls…`（预览 `dim`，宽度不够先截预览，不截标题） |
| 预览取哪段 | 思考文本里最后一行非空内容；过长时保留**尾部**（最新的话），前面用 `…` 补 |
| 点开 | 不变：`▾ thinking 12s` + 完整正文（正文不受预览影响） |
| 空思考 | 没有正文就不出预览、也不出 `▸/▾`，回到单纯 `thinking 12s` |
| 宽度 | 剩余宽度不足 12 列时不出预览，避免只剩几个字符的噪声 |

实现：`render.ts` 的 `thinkingLine` 拼「标题 + ` · ` + 预览」，预览复用既有的 `tailLine`/`oneLine`；不需要新状态。

### 命名：两个块叫什么（已定）

**决定：`Process`（已完成块）与 `Now`（进行中块）。**

| 位置 | 文案 |
| --- | --- |
| 过程块头（收起） | `▸ Process · 1 thought · 3 tools · 42s` |
| 过程块头（展开） | `▾ Process · 1 thought · 3 tools · 42s` |
| 过程块头（run 结束、无失败） | `✓ Process · 3 steps · 42s` |
| 过程块头（有失败） | `! Process · 3 steps · 1 issue · 42s` |
| 过程块子行 | `↳ thinking 12s` / `↳ read  src/a.ts · 184 lines` / `↳ bash  npm test · exit 1` |
| 进行中（工具） | `◆ Now · read src/a.ts · 3s` |
| 进行中（思考） | `◆ Now · thinking · 8s …「comparing both diffs」…` |
| 进行中（并行工具） | `◆ Now · 3 tools · read src/a.ts +2` |
| 空闲 | 整行移除 |

规则：
- 两词首字母大写，单独成词；`Now` 后面一律跟 ` · `，再接动作。
- 子行动词小写、定宽 6 格（`thinking` / `read` / `bash` / `edit` / `write` / `grep` / `find` / `list`），便于对齐。
- 计数用英文单复数（`1 thought` / `2 thoughts` / `1 tool` / `3 tools`）。
- 可配置：`labels.process`、`labels.live`，默认 `Process` / `Now`；填中文即切成 `过程` / `正在`。

### R2 底栏：供应商 · 模型 · 思考强度 · token速度 · 上下文占比

| 项 | 内容 |
| --- | --- |
| 顺序 | 从左到右：供应商 → 模型 → 思考强度 → token 速度 → 上下文占比 |
| 去掉 | 项目名、会话名、git 分支（现 pi-ui 有） |
| 供应商 | `ctx.model.provider`（如 `qwen-token-plan-2`），经映射表转展示名，未命中则原样 |
| 模型 | `ctx.model.name ?? ctx.model.id`（如 `DeepSeek V4.1 Flash`） |
| 思考强度 | `pi.getThinkingLevel()` |
| token 速度 | `TG = usage.output ÷ (message_end − 首个 delta)`，单位 t/s |
| 上下文 | `ctx.getContextUsage()` → `12.3% 123k/1M` + 8 格条 |
| 参考 | `pi-footer`（片段系统、Context Bar、丢弃策略）、`pi-turn-metrics`（TTFT/TPS）、`pi-stamp-plus`（TG/PP/暂停逻辑） |

实现：
1. 抄 `pi-footer` 的结构：`segments → layout → render`，每段一个纯函数 `(state) → string`，
   宽度不够时从右往左丢段（先丢上下文条，再丢供应商）。
2. 采样（`src/metrics/`）：
   - `message_start` 记 `t0`；首个 `text_delta/thinking_delta/toolcall_delta` 记 `tFirst`；
   - `message_end` 结算 `TG = output / (end − tFirst)`、`TTFT = tFirst − t0`；
   - 工具执行期间暂停瞬时采样（并行工具引用计数），结束后恢复；
   - 状态变更后 `tui.requestRender()`。
3. 底栏工厂是纯渲染函数，不接事件：速率与上下文由扩展写入自己的 cell，渲染时读。
4. 供应商映射表放配置文件（`qwen-token-plan-2 → Qwen Token Plan 2` 之类），未命中回退原 id。
5. 关掉 R2 时回退 Pi 原生底栏。

### R2a 上下文段靠右（v0.1.10）

| 项 | 内容 |
| --- | --- |
| 形式 | 左边 `供应商 · 模型 · 思考 · t/s` 靠左，`⠿⠿⠄⠄… 196.5k/1M` 贴到终端最右边缘 |
| 理由 | 上下文是"预算还剩多少"，贴在右边不用在长模型名后面找 |
| 百分比 | 不出数字（只看条） |
| 宽度不够 | 先掉供应商，再只掉进度条（token 数保留），再放不下就不拼右侧段，退回 `模型 · 思考` |
| 行宽 | 任何时候不超过终端宽度（复用 `format.ts` 的 `joinColumns`） |

实现：`footer.ts` 的 `line()` 改成「左组拼串 + 右组拼串 + 自行补空格」；阶梯判断是「左组 + 2 + 右组是否放得下」。
（v0.2.0 起不再借用 `joinColumns`：它在左组短于 `minimumLeft` 时会走“太窄”分支，把右组挤成左对齐。）

### R3 效率（v0.2.0）

| 项 | 原状 | 现在 |
| --- | --- | --- |
| 秒表重绘 | ticker 失效**消息组件**，等于每秒把每条带块的消息（含 Markdown）重建一次 | 失效**头行**本身（`lineComponent`），消息组件不动；每条消息只保留一个头行引用 |
| 增量重绘 | 任何工具事件都 `invalidateAll()`，整条转录的每条消息全部重建 | `invalidateRun(run)`：组件按 run 绑定，只有该 run 的组件重画；整块折叠/切换开关才全量 |
| 流式重绘 | 每个 `thinking_delta` / `tool_execution_update` 都请求重绘 | 合并到 100ms 窗口（`paintStream`），widget 的挂载/移除仍然立即执行 |
| 预览文本 | 每次渲染都 `split("\n")` 整段思考找最后一行 | `notifyThinking` 增量维护 `lastLine`，渲染直接读 |
| 截断 | `tailLine` 从尾往前逐字符量宽度（最坏 400 次 `visibleWidth`） | 二分查找最长可用后缀 |
| 头行元信息 | `headerLine` 与 `runMeta` 各扫一遍工具表统计 issue | 只扫一遍，结果传下去 |

同时修掉：
- Process 关掉、Now 开着时，ticker 直接 `return`，Now 的秒数不走。
- 底栏右侧段用 `joinColumns` 时，左组短于 `minimumLeft` 会走进“太窄”分支，右组不再贴右——改成自己算空格。

### R1 附注：两种“分组”的差别

**A 视觉分组**（推荐一期）：组件还是 Pi 原来的那些（思考一个、每个工具一个），只是都改由我们画：
一条 `▸ 过程 · 思考 1 · 工具 3 · 42s` 头行 + 子行缩进 2 格、`dim`。
看着像一个块，实际是“排得整齐的一串行”。

**A 也能整块折叠**：一次 run 的折叠状态存一份共享值，头行由它画（`▸` 收起 / `▾` 展开），
每个子行渲染前读同一个值，收起时 `render()` 返回空数组即不占高度；展开时各子行再各管自己的细节。
点/键命中整块时遍历本次 run 已挂载的子组件逐个 `invalidate()`（`pi-compact-transcript` 已有这套组件登记）。
差别只在于：没有统一外框/左边线，头行必须挂在某一行上（一般是本 run 的第一条过程行），
以及“全展开”与“单行展开”是两层状态，要定谁优先。

```
why does this bug happen
▸ Process · 1 thought · 3 tools · 42s
  ↳ thinking 12s
  ↳ read  src/a.ts          184 lines
  ↳ bash  npm test          exit 1
Fixed: a.ts was missing an await.
```

**B 真容器**（二期可选）：patch `Container.addChild`，把相邻工具真的挪进一个 `ToolGroupComponent`，
它成为子组件的父节点。可以画统一左边线/外框，点头行一次收起/展开整块，子行不渲染就不占高度。
看着和一个块没差别，差别在“行为”：整块一个开关、一个对象。

```
why does this bug happen
▸ Process · 3 steps · 42s     ← click to fold/unfold the whole block
  │ thinking 12s
  │ read  src/a.ts          184 lines
  │ bash  npm test          exit 1
Fixed: a.ts was missing an await.
```

代价：所有 `Container` 的增删子组件都会经过我们的 patch（性能与兼容面变大），reload 后要把已挂载的
树重扫一遍，鼠标点击要自己算行号（`pi-cc-extensions/grouping.ts` 880 行就是在处理这些）。

## 实现状态（v0.1.0）

| 需求 | 状态 | 位置 |
| --- | --- | --- |
| Process 块（头行、计数、耗时、thinking 折叠、工具折叠、整块折叠、同名合并未做） | 已实现 | `src/process/{state,patch,render}.ts` |
| Now 行（工具 / 思考 / 并行概括 / 空闲消失 / 秒级刷新） | 已实现 | `src/process/now.ts` |
| 底栏（供应商·模型·思考·t/s·上下文 + 窄屏降级） | 已实现 | `src/footer.ts`、`src/metrics.ts` |
| `/ui` 三项开关、`/process` 手动折叠 | 已实现 | `src/ui.ts`、`src/process/index.ts` |
| 恢复会话形态一致、思考时长持久化 | 已实现 | `src/process/state.ts`（`rebuild` + `pi-ui-teacat-thought` 条目） |
| 非 TUI 空转 | 已实现 | `patch.ts` 的 `control.enabled()` |

验证：
- `npx tsc --noEmit` 通过。
- `tests/load-check.mjs`：假 Pi API + 真实组件，覆盖折叠头、思考展开、工具行、Now、底栏窄屏降级（全绿）。
- `pi -p "…" --no-tools -e .` 打印模式无异常；`pi --list-models` 加载无报错。
- 真机视觉效果待人工确认。

### 与计划的偏差（记录在案）

1. **头行位置**：由 run 的第一条 assistant message 绘制，所以“思考 + 回答”的消息里，头行落在回答文字下方（符合“过程在回答后面”）。同一 message 内工具调用之后的文字仍显示在工具行之上 —— 这是 Pi 的原生顺序，A 方案改不了。
2. **展开有两级**：`Ctrl+O`/`/process` 展开整块（每行一条）；点某条工具行才交还 Pi 的原生详情（diff/高亮/图片）。原计划是“整块展开即原生细节”，实现时拆成两级更稳。
3. **头行点击**（v0.1.2 已接）：`AssistantMessageComponent` 没有 `handleMouse`，头行改用 pi-tui 的 `MouseRegion` 包一层，点一次开、再点一次收；键盘仍是 `Ctrl+O` 或 `/process`。
4. **thinking 正文**（v0.5.0 起已接 Pi 的 markdown transformers；此前是裸 Markdown，Mermaid 会退化成代码块）。
5. **`hideThinkingBlock: false`** 时该消息回退 Pi 原生思考渲染，不出 Process 头；v0.1.3 起工具行也跟着回退原生，不再出现“折起来又没有头行可展开”的隐形。
6. **同名工具合并 `N×`** 本期未做（默认里没提，留到下一轮）。
7. 新增 `/process` 命令（计划外的小增量），用于不占用 `Ctrl+O` 时手动折叠。
8. 嵌套工具调用（工具里再调工具）不单独成行，计入父行；避免 codemode/子代理把计数撑大。

## 已知技术约束（读源码确认）

1. `AssistantMessageComponent`（pi 内部类）持有 `hideThinkingBlock`、`thinkingVisibilityOverrides`、`hiddenThinkingLabel`，thinking 的展开/折叠在它内部决定；`setHiddenThinkingLabel()` 是 interactive-mode 私有方法，扩展只能 patch。
2. 会话渲染是往 `chatContainer` 按顺序 `addChild`（user → assistant → tool execution），没有公开的“分组”入口；真分组只能 patch `Container.addChild`（`pi-cc-extensions` 已趟过）。
3. 主题必须写进 `$PI_CODING_AGENT_DIR/themes/`，Pi 在扩展加载前应用主题（palette 相关）。
4. `ctx.ui.setTheme` 只对已注册主题有效；`ctx.ui.theme.name` 用于判断当前色板。
5. `ToolExecutionComponent`、`AssistantMessageComponent` 是 Pi 导出的类，可以幂等 patch（社区三个扩展都在用）；patch 要带 owner/版本标记并能在 reload 时还原。
6. pi-ui 现在用 `registerTool` 替换 7 个内置工具，只能覆盖内置工具；R1 改成 patch 后要删掉这套注册，否则新渲渲染不生效。

## 里程碑（等 R1/R2 细节定稿后展开）

- M1 基线跑通：把 pi-ui 源码搬进 `src/`，`pi -e ./` 能加载，`/ui` 可用。
- M2 R2 底栏改造 + token 速度采样。
- M3 R1 过程块。
- M4 复核：窄终端、宽字符、resume、`/new`、关开关回退。

## 已定（按默认，2026-11-02）

1. **Now 位置**：编辑器上方一条 widget（`placement: "aboveEditor"`）。
2. **思考流式显示**：只显最后一行（超宽截断）。
3. **t/s**：实时口径 —— 生成期按增量估算并显示 `~`，`message_end` 用 `usage.output ÷ (end − 首 delta)` 定格为精确值；工具期不采样，保留上一个值。
4. **分组方式**：视觉分组（缩进 + 头行 + 共享折叠状态），不 patch `Container.addChild`。
5. **底栏**：去掉项目、会话、git 分支。
6. **头行**：带计数与耗时。
7. **粒度**：一个用户 prompt 一个过程块（run = `agent_start` → `agent_settled`）。
8. **pi-ui**：已卸载（`pi remove npm:@prjct.app/pi-ui`，2026-11-02）。
9. **中间回答**：不压暗、不加左边线（保持 Pi 原生）；本期只做折叠，不改正文样式。

## 本期范围

做：`Process`、`Now`、底栏、`/ui`（三项开关）、`/process`（手动开关块）。
不做（留待后续）：header/logo、palette/配色生成、transcript 的 `u./p.` 时间戳、activity 检查器、云同步备份、真容器分组。

## 实现核对

- 包名 `pi-ui-teacat`，入口 `index.ts`，数据目录 `~/.pi/agent/pi-ui-teacat/`。
- 本地调试：`pi -e ~/Agent/Temp/pi-ui-teacat`。

---

# v0.3.0 — Now 展开内容加量

## 先对准 Now 的定位

`Now` 是「此刻在做什么」的那一条，不是历史：

- 位置固定在编辑器上方，折叠时永远只占一行；run 一结束整个 widget 消失。
- 只讲**进行中**：正在跑的工具、正在流的思考。已结束的东西归 `Process` 块管。
- 展开只做一件事：把"此刻"摊开看清 —— 每个运行中的工具一行，加上正在流出的思考尾部。

所以这一版只动两处：**能给多少行**、**思考给几行**。不往里塞已完成的东西（那是另一块的活）。

## 问题

| 常量 | 现值 | 效果 |
| --- | --- | --- |
| `MAX_LINES` | 9 | 含标题最多 9 行，明细只有 8 行 |
| `THOUGHT_LINES` | 3 | 流式思考只露最后 3 行 |

而且思考块拼在最后、再被 `slice(0, MAX_LINES)` 硬裁：工具一多，思考整块消失；展开常常只有两三行有效信息。

## 目标

```
2 tools · 5s                                    ← 标题（不变，仍是第 0 行）
  ↳ ◆ bash  npm test                    4s      ← 运行中工具，一行一条
  ↳ ◆ read  src/a.ts                    2s
  ↳ thinking 4s                                 ← 思考标题
      comparing both diffs …                    ← 正文：预算决定，最多 6 行
      the await is missing in a.ts
```

## 改动清单

### N1 高度随终端（改 `MAX_LINES`）

- 写死的 9 → 每次渲染算：`cap = clamp(tui.terminal.rows - 14, 9, 14)`
- 上限仍压在 14：Now 是贴在编辑器上的一条速览，不是面板；再高就抢正文了。`rows` 取不到时回落 9（现状）。
- 顺带纠正 v0.1.x 的旧结论：`InteractiveMode.MAX_WIDGET_LINES = 10` 只截 `string[]` 形式的 widget；
  `NowWidget` 是组件工厂，不受该上限约束，真正的约束是 viewport 里 `widgetsAbove` 的 `shrink: 1`（会挤正文），
  所以 9 原本只是自设的保守值。
- `NowWidget` 本来就由 Pi 以 `(tui, theme)` 构造：构造函数多收一个 `TUI`，从 `tui.terminal.rows` 取行数，不动 `state` 的类型。

### N2 先留思考的行，再给工具（替换"拼完再 slice"）

实测：`tool_execution_start` 与第一次 `text_delta`／`toolcall_start` 都会 `clearLiveThinking()`，
所以**思考与工具在 Now 里不会同时出现**（同一帧竞态除外）。预留仍按这个顺序算，纯属防御：

渲染顺序保持「标题 → 运行中工具 → 思考」，但行数**先按思考扣**，工具用剩下的：

1. 标题 1 行（不变）
2. 有流式思考时先扣：标题 1 行 + 正文 `clamp(cap - 6, 2, 6)` 行
3. 运行中工具：一行一条，吃剩下的行；放不下时补一行 `+N more tools`（dim）
4. 没有思考时，工具可用满 `cap - 1` 行

### N3 思考正文加量（改 `THOUGHT_LINES`）

- 常量 3 删除，改由 N2 预算给出（2~6 行）；仍是"一行一条、超宽截断"，不折行，高度可控。

## 不做

- 不加已结束的工具 / 不显示历史（那是 `Process` 的职责）
- 不加键盘展开收起（仍是点标题行）、不改 `Process`、底栏、`/ui`
- 不做思考折行、不做工具输出预览（两样都要另加数据源）

## 验收标准

1. `./node_modules/.bin/tsc --noEmit` 通过；`node tests/load-check.mjs` 通过（含 Q/R 两条 Now 用例）。
2. 24 行终端：`cap = 10`，展开不超 10 行，正文没被压没。
3. 40 行终端 + 1 工具 + 长思考：思考正文 6 行（原为 3）。
4. 40 行终端 + 20 个并行工具：整块仍 14 行，最后一行 `+7 more tools`。
5. 无工具只有思考（40 行终端）：标题 + 6 行正文（原为 3 行）；24 行终端仍为 3 行（cap 10）。
6. 点标题行开/关仍有效（第 0 行命中区域不变）。

---

# v0.4.0 — Now 默认展开、展开更高

状态：**已实现**（2026-11-02），tsc 与无头回归全绿。

## 定位不变

`Now` 仍是「此刻在做什么」：只讲进行中的工具与流式思考，run 结束整个 widget 消失；已结束的归 `Process`。

## 问题

- `nowExpanded` 初始为 `false`：每次会话都要手点一下才看得到明细。
- `cap = clamp(rows - 14, 9, 14)`：40 行终端也只有 14 行，思考正文封顶 6 行；并行工具稍多就被 `+N more` 收走。

## 目标

- 会话一开始（以及 `resetNow()` 后）Now 就是展开态；点标题行仍可收起，选择在本会话内保持。
- 高度随终端抬升：24 行终端 12 行，40 行终端 24 行；思考正文最多 12 行。

## 改动清单

### N4 默认展开

- `src/process/now.ts`：`nowExpanded` 初值 `true`；`resetNow()` 复位为 `true`。
- 点击标题行（`y === 0`、左键）仍是唯一开关；收起后与 0.3.0 完全一致（单行、`▸`）。
- 不写盘：展开/收起只在当前会话记住，重启回到默认展开。

### N5 高度与思考行数

- `RESERVED_ROWS` 14 → 12；`MAX_LINES` 14 → 24；`MIN_LINES` 9 不变。
  `cap = clamp(rows - 12, 9, 24)`；`rows` 缺失时回落 9。
- `THOUGHT_MAX` 6 → 12；`thoughtLines(cap) = max(2, min(12, cap - 6))`。
- 预算顺序不变：标题 → 思考预留 → 工具 → `+N more`。

| 终端行数 | 现 cap | 新 cap | 现思考正文 | 新思考正文 |
| --- | --- | --- | --- | --- |
| 24 | 10 | 12 | 4 | 6 |
| 40 | 14 | 24 | 6 | 12 |
| 60 | 14 | 24 | 6 | 12 |
| 未知 | 9 | 9 | 3 | 3 |

### N6 测试与文档

- `tests/load-check.mjs`：E/Q/R 用例按「默认展开」改写（先断言 `▾` 与明细，再点一次断言收起）；R2 把思考文本加长到 14 行，断言正文 12 行；新增「新 widget 默认展开」用例。
- `README.md`：Now 描述改为默认展开、点标题收起；行数说明改为最多 24 行、思考 12 行。
- `package.json` 0.3.0 → 0.4.0。

## 不做

- 不改 `Process`、底栏、`/ui`、鼠标命中区域。
- 不加工具输出预览、思考折行、历史条目（仍只讲此刻）。
- 不把展开状态持久化到磁盘。

## 验收标准

1. `./node_modules/.bin/tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 新会话工具一启动就是 `▾ Now` + 明细；点标题变 `▸ Now` 单行；再点回展开。
3. 40 行终端 + 长思考：标题 1 + 思考标题 1 + 正文 12 = 14 行；24 行终端为 8 行。
4. 40 行终端 + 40 个并行工具：整块 24 行封顶，末行 `+17 more tools`。
5. 终端行数取不到：9 行封顶，与 0.3.0 一致。
6. 真机 TUI 里展开态不挤掉输入行，编辑器仍可用。

## 实现结果

- `src/process/now.ts`：`nowExpanded` 初值与 `resetNow()` 均为 `true`；`RESERVED_ROWS` 12、`MAX_LINES` 24、`THOUGHT_MAX` 12。
- `tests/load-check.mjs`：E/Q/R 改为「默认展开、点击收起」；R2 覆盖 40 行终端 12 行正文，R2b 覆盖 24 行终端 6 行正文；R3 改为 40 个并行工具，24 行封顶 + `+17 more tools`。
- 结果：`tsc --noEmit` 通过；`node tests/load-check.mjs` A–Y 全过（含新增 R2b）。
- `README.md` 与 `package.json`（0.4.0）已同步。
- 验收第 6 条待在真机 TUI 里看一眼；Pi 的 dock 给编辑器 `minSize: 3`、正文 `minSize: 1`，布局上不会挤掉输入行。

---

# v0.4.1 — 没工具时思考吃满卡片

状态：**已实现**。

## 问题

21 行终端（用户实测）下：`cap = max(9, min(24, 21-12)) = 9`，`thoughtLines = max(2, min(12, 9-6)) = 3`。
卡片内部按「标题 1 + thinking 行 1 + 思考 3 + 工具预留 4」分账：**没有工具运行时那 4 行空着**，思考正文只有 3 行，看着像永远卡在 3 行。
24 行终端为 6 行、40 行终端为 12 行，所以问题只在浅窗口（21 行）放大到 3 行。

## 目标

- 只有流式思考、没有运行中工具时：思考正文吃满卡片，`cap - 2`（标题 + thinking 行各占 1）。
- 有工具在跑时：预算顺序不变（思考仍 `cap - 6`，工具吃剩余，末行 `+N more`）。
- 卡片总高度、`RESERVED_ROWS`、`MAX_LINES`、`THOUGHT_MAX` 都不动；对话区一行不少。

| 终端行数 | cap | 现正文（无工具） | 新正文（无工具） | 新卡片总行 | 有工具时正文 |
| --- | --- | --- | --- | --- | --- |
| 21 | 9 | 3 | 7 | 9 | 3 |
| 24 | 12 | 6 | 10 | 12 | 6 |
| 40 | 24 | 12 | 12（`THOUGHT_MAX`） | 14 | 12 |
| 未知 | 9 | 3 | 7 | 9 | 3 |

## 改动清单

### O1 预算

- `src/process/now.ts`：`thoughtLines(cap)` → `thoughtLines(cap, tools)`；额度 `cap - (tools > 0 ? 6 : 2)`，仍 `max(2, min(THOUGHT_MAX, …))`。
- `NowWidget.render()` 把 `view.tools.length` 传进去；工具、`+N more`、标题、点击、卡片上限一律不动。
- 没有工具时 `toolBudget` 自然为 0，不会画出多余的空行。

### O2 测试与文档

- `tests/load-check.mjs`：
  - R：思考文本加长到 9 行，无终端（cap 9）→ 卡片 9 行，正文 7 行（three…nine），two 被丢弃。
  - R2b：24 行终端 → 卡片 12 行，正文 10 行（five…fourteen），four 被丢弃。
  - 新增 R2c：21 行终端 → 卡片 9 行，正文 7 行（eight…fourteen），seven 被丢弃。
  - 新增 R2d：21 行终端、思考与 2 个工具同帧 → 标题 1 + 工具 2 + thinking 行 1 + 正文 3 = 7 行。
  - R2（40 行 12 行正文）与 R3（40 工具、24 行封顶）不变。
- `README.md`：说明「无工具时思考吃满卡片（21 行 7 行、24 行 10 行）；有工具时给工具留 4 行」。
- `package.json` 0.4.0 → 0.4.1。

## 不做

- 不改 `RESERVED_ROWS` / `MAX_LINES`（不拿对话区换行数）。
- 不加手动行数设置，不改思考折行、工具输出预览。

## 验收标准

1. `./node_modules/.bin/tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 21 行终端 + 长思考、无工具：卡片 9 行 = 标题 1 + thinking 行 1 + 正文 7。
3. 21 行终端 + 思考 + 2 个工具：正文仍 3 行，两条工具行各一行（与 0.4.0 一致）。
4. 40 行终端正文仍 12 行封顶；未知行数仍 9 行封顶（正文 7）。
5. 21 行终端卡片 9 行时，对话区、输入框、页脚仍在（dock 布局不超屏）。

## 实现结果

- `src/process/now.ts`：`thoughtLines(cap, tools)`，无工具 `cap - 2`、有工具 `cap - 6`。
- `tests/load-check.mjs`：R 改 9 行思考（9 行卡片）、R2b 改 10 行正文、新增 R2c（21 行终端 9 行卡片）与 R2d（思考 + 2 工具：7 行）。
- `README.md` 行数与 `/ui` 说明、`package.json`（0.4.1）已同步。

---

# v0.5.0 — 点内容即收（就近折叠）

状态：**已实现**。

## 问题

折叠只有“头行”一个开关，展开以后反而不好收：

- `Now` 卡片展开后，点卡片里的工具行、思考正文都没反应，必须回去点标题行。
- 思考正文展开后，点正文也没反应，必须点回那一行（`▸` 已变成 `▾`）。
- 工具详情的“点任意处收该行”已经成立，只是没有回归测试盯着。

## 目标

一条规则：**点哪个展开块的内容，就收哪个**。

| 点到的东西 | 现在 | 改成 |
| --- | --- | --- |
| 展开的 `Now` 卡片任意一行 | 不动 | 收起成一行 `▸ Now` |
| 收起的 `Now` 卡片标题行 | 展开 | 不变 |
| 展开的思考正文 | 不动 | 收这条思考，`Process` 块不动 |
| 展开的工具详情任意一行 | 收这条工具 | 不变（补测试） |
| `Process` 头行 / `Ctrl+O` / `/process` | 整块开关 | 不变 |

不引入双击、右键、修饰键；也不用瞄准 `▸` 那两个字。命中规则取代 R1c「子行点不动」与 R1d「只认该行」的旧规则（其余不变）。

## 改动清单

### P1 Now 整卡命中

`src/process/now.ts` 的 `handleMouse`：

- 展开态：任意 `y` 的左键点击都收起（原来是 `y === 0` 才响应）；
- 收起态：仍只认 `y === 0`（这时卡片只有一行，别处本来也点不到）。

### P2 思考正文命中

`src/process/patch.ts`：`thinkingBody()` 外面包一层 `MouseRegion`，左键点正文 → `thought.open = false` +
`invalidateRun(run)`，返回 `{ handled: true }`。`MouseRegion` 先把事件交给 `Markdown`，链接点击不受影响。

### P3 测试与文档

- `tests/load-check.mjs`：
  - D：思考行点开后，再点**正文**那一行，断言正文收起、块仍展开。
  - Q：展开时点第 1 行 → 收成一行；收起时点第 1 行 → 不动；点标题行 → 再展开。
  - S：工具详情已在 `y > 0` 处点击收行，保留。
- `README.md`：`Now` 与思考正文的行文改成“点内容即收”。
- `package.json` 0.4.1 → 0.5.0。

## 不做

- 不加新键位，不改 `Ctrl+O` / `/process` / 头行点击。
- 不改“点收起的子行 = 展开它”的既有语义（要能点开，才谈得上点收）。
- 不把鼠标热度铺到回答正文上：正文选中、复制仍归终端 / Pi 自己。

## 验收标准

1. `./node_modules/.bin/tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. `Now` 展开时点任意一行 → 一行 `▸ Now`；收起时点标题 → 展开。
3. 思考正文开着时点正文任意一行 → 该思考收起，`Process` 仍展开、其他子行状态不变。
4. 工具详情开着时点详情任意一行 → 该行收起，`Process` 仍展开（S 已覆盖）。
5. 上述点击都不改动回答正文的渲染与选择行为。

## 实现结果

- `src/process/now.ts`：`handleMouse` 展开态任意 `y` 的左键点击都收起；收起态仍只认 `y === 0`。
- `src/process/patch.ts`：`thinkingBody()` 外包 `MouseRegion`，左键点正文 → `thought.open = false` + `invalidateRun(run)`；
  `Markdown` 仍先收事件，链接点击不受影响。
- `tests/load-check.mjs`：D2b 断言「点正文收该思考、块仍展开」；Q 断言「展开态点工具行收起」「收起态点第 1 行不响应」。
- `README.md`、`package.json`（0.5.0）已同步。

### 审改（`review/17-review-v0.5.0.md`）

第一轮通读全项目，记 11 项，逐项修完：

- `state.ts` `rebuild()`：只有真正有思考的消息才建 `Thought`（工具消息不再冒出幽灵 `thinking` 行、头行计数不再虚高）；
  工具行取 `toolResult.durationMs`；run 结束时间取「消息 ts + durationMs / 工具结果 ts」的最大值；
  没有结果的调用补 `interrupted`，与实时 `settleRun()` 一致。
- `patch.ts`：错误/中断提示按 Pi 原文（`Error: Unknown error`、abort 保留 `errorMessage`）；
  回答正文与思考正文都接回 Pi 的 markdown transformers（公开类型重写接线，宽度与 streaming 状态按 render 时读）。
- `footer.ts`：`refresh()` 丢掉快照缓存（精确 t/s 下一帧就出现）；关掉底栏时停掉 1s 心跳；
  `opencode-go` 显示为 `OpenCode Go`。
- `tests/load-check.mjs`：新增 G2（resume 工具块）、Y2（refresh 清缓存）、Z1（transformer）、Z2（错误提示）；A–Z 全过。
- `README.md`：补「点击依赖 fullscreen（`tuiMode` 默认值）」，resume 时长来源写准，删掉 transformer 限制；
  `PLAN.md` 顶部状态与本条记录同步。

结果：`tsc --noEmit` 通过；`node tests/load-check.mjs` A–Z 全过。真机 TUI 待确认：点 `Now` 明细行、点思考正文都能收。

---

# v0.6.0 — 底栏加缓存命中率

状态：**已实现**（2026-11-16）。英文标签，不用中文「缓存」。

## 问题

底栏现在只有 `provider · model · thinking · t/s` 和右侧上下文条，看不出这一轮的提示词有多少是从 prompt cache 读回来的。
命中率低通常意味着钱花多了（缓存 5 分钟过期、模型换了、上下文被改写），现在只能去 `/session` 里翻数字。

## 数据来源（已核实）

- `pi-ai` 的 `Usage` 有 `input` / `output` / `cacheRead` / `cacheWrite` / `cacheWrite1h?`（`dist/types.d.ts:292`）。
- `message_end` 事件里带 `message.usage`，`attachMetrics` 已经在读 `usage.output`，不用新数据源。
- 实测 `opencode-go`（deepseek-v4.1-flash）确实上报 `cacheRead`：`{"input": 228, "output": 186, "cacheRead": 24192, "cacheWrite": 0}`，
  即提示词 24420 token 里 24192 走缓存。`cacheWrite` 目前恒为 0（deepseek 无写缓存计费），Anthropic 会非零。
- 累积**不扫 `getEntries()`**：`message_end` 逐条累加即可（和 t/s 同一个事件）。只在 `session_start` 扫一次，
  把 resume / fork 之前的历史补进累计，避免“恢复会话后从 0 开始”。

## 口径

```
prompt = input + cacheRead + cacheWrite        // 一条消息的全部提示词 token
hit    = cacheRead
命中率  = Σhit ÷ Σprompt                        // 整个 session 加权，不是逐条平均
```

- 显示整数百分比（四舍五入），不显示小数：底栏是速览。
- 分母为 0 的消息（无 usage）跳过。
- **模型完全不报缓存**（`ΣcacheRead + ΣcacheWrite === 0`）时整段不出现，底栏与 v0.5.0 完全一致：
  `cache 0%` 会让人以为是缓存坏了，实际是这家不报。

## 形式

```
OpenCode Go · DeepSeek V4.1 Flash · max · 68 t/s          cache 92%  ⠿⠿⠿⠿⠄⠄⠄⠄ 196.5k/1M
```

- 位置：**上下文段的正前方**，和上下文一起靠右。左组（provider·model·thinking·t/s）仍在左边，
  中间的空档把两组分开；`cache` 紧贴上下文条，读作“这块提示词的命中率和占用”。
- 文案：`cache 92%`，小写 `cache`，与 `t/s`、`thinking` 的小写风格一致；不加冒号、不加括号。
- 颜色：不额外上色（和 `thinking`、`t/s` 一样走默认前景），只用 `borderMuted` 的分隔符分组。
  理由：命中率高低不等于好坏结论（首轮必然 0%），染色会误导。
- 不新增 `/ui` 开关：数据在就出现、不在就消失；`PARTS` 仍是三项。

## 改动清单

### C1 采样（`src/metrics.ts`）

- `Rate` 旁边加 `cache: { prompt: number; hit: number }`。
- `message_end`：读 `usage.input / cacheRead / cacheWrite`（缺字段当 0），`prompt > 0` 才累加。
- `resetMetrics()` 一并清零。
- 新导出 `cacheText(): string | undefined`：无数据或无缓存上报时返回 `undefined`，否则 `cache 92%`。
- 新导出 `seedCache(entries)`：`session_start` 时按当前分支的 assistant 消息回填一次（只在 `prompt > 0` 时累加）。

### C2 首屏回填（`index.ts`）

`session_start` 里 `resetMetrics()` 之后调 `seedCache(ctx.sessionManager.getEntries())`，
放在 `apply(ctx, …)` 之前，这样底栏第一帧就带着历史命中率。

### C3 底栏布局（`src/footer.ts`）

- `FooterState` 加 `cache?: string`；`snapshot()` 里取 `cacheText()`。
- 左组不变（`provider · model · thinking · rate`）。
- `context()` 改成返回**右组**：`cache 92%` + 两空格 + `⠿⠿⠄⠄ 196.5k/1M`；`cache` 缺失时右组与现状逐字一致。
  命中率与上下文同属“提示词账目”，放一起比塞在 `t/s` 后面更好读。
- 降级阶梯加一级，**最先掉的就是 cache**（它是新增的，优先级最低），再按原顺序：

| 顺序 | bar | cache | provider |
| --- | --- | --- | --- |
| 1 | ✓ | ✓ | ✓ |
| 2 | ✓ | ✗ | ✓ |
| 3 | ✗ | ✗ | ✓ |
| 4 | ✗ | ✗ | ✗ |

- 末尾兜底（只剩 `model · thinking`）不变。缓存命中率是锦上添花，宽度一紧就该先让位给上下文条和 provider。

### C4 测试与文档（`tests/load-check.mjs`、`README.md`）

- 新增用例：
  - **CA1** 两条消息（`input 1000/cacheRead 9000`、`input 1000/cacheRead 0`）→ `cache 82%`（= 9000/11000）。
  - **CA2** 全部 `cacheRead = 0` 且 `cacheWrite = 0` → 左组里没有 `cache`。
  - **CA3** 宽度阶梯：放得下时 `cache` 紧挨上下文条且靠右；窄一档先掉 `cache`、上下文条仍在；
    再窄才掉上下文条；再窄掉 provider。
  - **CA4** `resetMetrics()` 后回到 `undefined`（`/new` 不继承旧数字）。
  - **CA5** `seedCache()` 用假 entries 回填 → 首帧即为历史命中率。
- `README.md`：底栏一行改成 `provider · model · thinking · t/s · cache`，补一句“命中率按整个会话加权，模型不报缓存则不显示”。
- `package.json` 0.5.0 → 0.6.0。

## 不做

- 不做每轮/最新一条的命中率，也不做本会话省下多少钱（要单价表，另开一期）。
- 不加 `/ui` 开关、不加新键位、不加点击/悬浮提示。
- 不扫 `getEntries()` 求实时值（每帧扫全量会话太贵，且 `snapshot` 只有 200ms 缓存）。
- 不改 `Process`、`Now`、`/process`。

## 验收标准

1. `./node_modules/.bin/tsc --noEmit` 与 `node tests/load-check.mjs` 全绿（含 CA1–CA5）。
2. 真机一条对话后底栏出现 `cache NN%`，且与 `/session` 里 cacheRead 占比一致（±1% 四舍五入）。
3. 在不报缓存的 provider 上（如本地 ollama）底栏不出现 `cache`，宽度与 v0.5.0 逐字一致。
4. `/new` 之后命中率从 0 起算；`/resume` 之后继承该分支历史。
5. 24 列宽终端：`cache` 先消失、上下文条仍贴右；再窄才轮到上下文条，底栏始终不超宽、不换行。

## 实现结果

- `src/metrics.ts`：`cache = { prompt, read, write }`，`message_end` 走 `addPrompt(usage)`（`input + cacheRead + cacheWrite`，缺字段当 0）；
  新导出 `cacheText()`（`cache 92%`，无缓存上报时 `undefined`）与 `seedCache(entries)`；`resetMetrics()` 一并清零。
- `index.ts`：`session_start` 里 `resetMetrics()` → `seedCache(sessionEntries(ctx))` → `apply(...)`；
  `sessionEntries()` 优先 `getBranch()`（活动分支才是下一次提示词的内容），回退 `getEntries()`，都没有就空数组。
- `src/footer.ts`：`FooterState.cache`；`context()` 改名 `right()`，右组 = `cache` + 两空格 + 上下文；
  阶梯改成 `cache → bar → provider` 三级降级，`cache` 最先掉。
- `tests/load-check.mjs`：CA1（82% = 9000/11000）、CA2（无缓存 token 不显示）、CA3（逐宽度扫描，断言「cache 先掉、bar 次之、provider 最后」且不超宽）、
  CA4（`resetMetrics()` 后消失）、CA5（`seedCache` 首帧即带历史），A–Z 全过。
- `README.md` 新增「The cache rate」小节；`package.json` 0.5.0 → 0.6.0。

## 待办

- 真机确认：`pi -e ~/Agent/Temp/pi-ui-teacat`，一段长对话后底栏出现 `cache NN%`，与 `/session` 的 cacheRead 占比一致；窄终端先掉 `cache`。

# v0.7.0 — 底栏分段配色、Cache 与档位大写

## 问题

- v0.6.0 底栏全段走默认前景色，只有 `borderMuted` 分隔符分组，长行里段落边界不醒目，用户要求各部分用不同颜色。
- `cache 92%`、`max` 全小写；用户要求文案句首大写：`Cache 92%`、`Max`。

## 目标

- 底栏各段按语义着色，渲染时现取 theme（带色字符串不进状态，沿用既有约定）。
- `cacheText()` 返回 `Cache NN%`；thinking 档位首字母大写（`off`→`Off`…`max`→`Max`）。

## 改动清单

- `src/metrics.ts`：`cacheText()` 的 `cache` 改为 `Cache`，仅首字母大写，其余不变。
- `src/footer.ts`：
  - `line()` 每栏一个固定颜色：provider→`accent`，model→`mdLink`，thinking→`thinkingText`，t/s→`success`，
    Cache→`warning`；分隔符仍 `borderMuted`；上下文条 `muted`、token 数 `dim` 不变。栏目颜色固定，
    与具体内容无关（换任何模型，模型栏都是同一个颜色）。
  - thinking 档位读取时首字母大写（`high`→`High`，`xhigh`→`Xhigh`）。
- 降级阶梯（cache→bar→provider）、两列间距、右组贴右逻辑逐字不变。
- `tests/load-check.mjs`：F/CA 段断言随文案更新（`Cache`、`Max`，`includes("cache")` 改 `includes("Cache")`）。
- `README.md` 底栏描述更新；`package.json` 0.6.0 → 0.7.0。

## 不做

- 不改 Process / Now / /process / /ui。
- 不新增主题 token、不改主题文件；不在状态里存带色字符串。
- 上下文条与 token 数配色不变。

## 验收标准

1. `./node_modules/.bin/tsc --noEmit` 与 `node tests/load-check.mjs` 全绿（含 F、CA1–CA5）。
2. 真机底栏出现 `Cache NN%`，provider/model/thinking/t/s/Cache 五段颜色各不相同且与栏目固定绑定
   （换模型、换档位，各栏颜色不变）。
3. thinking 档位显示 `Off/Minimal/Low/Medium/High/Xhigh/Max`。
4. 窄终端降级顺序与 v0.6.0 一致：先掉 Cache、再掉上下文条、最后掉 provider；全程不超宽不换行。

## 实现结果

- `src/metrics.ts`：`cacheText()` 返回 `Cache NN%`（仅首字母大写，百分数与舍入不变）。
- `src/footer.ts`：`levelLabel()` 在读 `getThinkingLevel()` 时首字母大写（`xhigh`→`Xhigh`）；
  `line()` 里 provider→`accent`、model→`mdLink`、thinking→`thinkingText`、t/s→`success`，右组 Cache→`warning`，
  分隔符仍 `borderMuted`，上下文条 `muted`、token 数 `dim` 逐字不变；
  降级阶梯、两列间距、右组贴右逻辑未动。带色字符串全部在渲染时现取 theme，不进状态。
- `tests/load-check.mjs`：F 段 `max`→`Max`，CA1–CA5 的 `cache NN%`→`Cache NN%`、`includes("cache")`→`includes("Cache")`。
- `README.md`：Footer 条目补配色说明，「The cache rate」小节改 `Cache 92%` 并更新大小写说明；
  `package.json` 0.6.0 → 0.7.0。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿（A–Z、CA1–CA5）；
  `tmp/check-colors.mjs`、`tmp/check-rate.mjs` 用标记主题确认五段分别取 accent/thinkingText/success/warning 四个 token。

## 待办

- 真机确认配色与大小写在深浅主题下都可读。

# v0.7.1 — 底栏配色定稿：星夜两点

## 问题

- v0.7.0 的五栏五彩（紫/蓝/紫罗兰/绿/琥珀）像圣诞树，缺主次，用户要求重设计。

## 目标

- 整条栏只保留两个彩色焦点，其余退为灰紫，深色底上靠「少」出设计感。

## 改动清单

- `src/footer.ts` `line()` 配色改为：provider→`dim`，model→`accent`，thinking→`dim`，t/s→`success`，
  Cache→`dim`；分隔符仍 `borderMuted`，上下文条 `muted`、token 数 `dim` 逐字不变。
- 设计逻辑：model 穿主题签名色（全栏唯一身份焦点，换模型颜色不变）；t/s 是唯一活信号（引擎在转）；
  provider/thinking/Cache 是次要信息，退到 `dim`。
- `README.md` Footer 条目的配色描述同步；`package.json` 0.7.0 → 0.7.1。
- 降级阶梯、间距、文案（`Cache NN%`、档位大写）不变。

## 不做

- 不动 Process / Now / /process / /ui，不改主题文件，不新增 token。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机底栏：只有 model 与 t/s 两处彩色，其余灰紫；宽度降级行为与 v0.6.0 一致。

## 实现结果

- `src/footer.ts`：provider/thinking/Cache 改为 `dim`，model 改为 `accent`，t/s 仍为 `success`；
  分隔符、上下文条、token 数与降级阶梯未动。
- `README.md` Footer 条目改为「两点焦点」描述；`package.json` 0.7.0 → 0.7.1。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿（A–Z、CA1–CA5）。

## 待办

- 真机确认两个焦点色在深浅主题下都清晰。

# v0.7.2 — 底栏配色：相邻色渐变 + 冷暖点缀

## 问题

- v0.7.1「星夜两点」颜色太少、发灰，用户要求多内容块配色「搭配美观」即可，不要复杂方案。

## 目标

- 五个内容块都上色，但用相邻色渐变保证和谐：紫罗兰→淡紫→蓝同属一族自然过渡，
  两个动态数字用一冷一暖点缀。

## 改动清单

- `src/footer.ts` `line()` 配色：provider→`borderAccent`（紫罗兰），model→`accent`（淡紫），
  thinking→`mdLink`（蓝），t/s→`success`（绿），Cache→`mdHeading`（暖金）；
  分隔符仍 `borderMuted`，上下文条 `muted`、token 数 `dim` 逐字不变。每栏固定一色，与内容无关。
- `README.md` Footer 条目配色描述同步；`package.json` 0.7.1 → 0.7.2。
- 降级阶梯、间距、文案（`Cache NN%`、档位大写）不变。

## 不做

- 不动 Process / Now / /process / /ui，不改主题文件，不新增 token，不用背景色块。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机底栏五段颜色相邻和谐（紫罗兰/淡紫/蓝/绿/金），无刺眼撞色。

## 实现结果

- `src/footer.ts`：provider→`borderAccent`、model→`accent`、thinking→`mdLink`、t/s→`success`、
  Cache→`mdHeading`；分隔符、上下文条、token 数与降级阶梯未动。
- `README.md` Footer 条目改为渐变+点缀描述；`package.json` 0.7.1 → 0.7.2。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿（A–Z、CA1–CA5）。

## 待办

- 真机确认五段配色整体观感。

# v0.7.3 — Cache 换青色

## 问题

- v0.7.2 的 Cache 暖金用户不喜欢。

## 目标

- 整条栏统一为冷色系：紫罗兰→淡紫→蓝→青→绿，Cache 用青色夹在蓝与绿之间过渡。

## 改动清单

- `src/footer.ts`：Cache 的 token `mdHeading`（金）改为 `syntaxVariable`（青），其余逐字不变。
- `README.md` 描述同步；`package.json` 0.7.2 → 0.7.3。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机底栏无金色，Cache 为青色且与蓝/绿协调。

## 实现结果

- `src/footer.ts`：Cache token `mdHeading`→`syntaxVariable`，两处注释同步为「全冷色一族」。
- `README.md` 配色描述同步；`package.json` 0.7.2 → 0.7.3。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿。

# v0.7.4 — 右组整体青色：Cache 与上下文条同色

## 问题

- v0.7.3 的 Cache 青色用户喜欢，但右侧「Cache + 上下文条 + token 数」灰青搭配不协调：
  右组是一个整体（提示词的命中率与占用），两种颜色显得割裂。

## 目标

- 右组三段统一青色：命中率、占用条、token 数连成一块；左组仍是紫罗兰系身份渐变，
  左右两组按色系分区。

## 改动清单

- `src/footer.ts` `right()`：上下文条 `muted`→`syntaxVariable`，token 数 `dim`→`syntaxVariable`，
  与 Cache 同色；左组与降级阶梯逐字不变。
- `README.md` 描述同步；`package.json` 0.7.3 → 0.7.4。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机右组「Cache 90% ⠿⠄⠄⠄⠄⠄⠄⠄ 118.2k/1M」一色连成整体。

## 实现结果

- `src/footer.ts` `right()`：上下文条与 token 数改为 `syntaxVariable`，与 Cache 同青色；左组未动。
- `README.md` 改为「分区配色」描述；`package.json` 0.7.3 → 0.7.4。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿。

# v0.7.5 — 右组柔青：饱和度减半

## 问题

- v0.7.4 右组整体青色用户认可搭配，但 `#4DD0E1` 太鲜艳，想要灰调一点的青。

## 目标

- 右组保持同色系，把青的饱和度降到约一半（ziye 下 `#4DD0E1`→`#90C7CF`），沉稳不跳。

## 改动清单

- `src/footer.ts`：新增 `softTeal()`——取 `theme.colors.syntaxVariable` 的 OKHSL 饱和度 ×0.5
  经 `theme.style` 渲染；右组三段（Cache/上下文条/token 数）统一走它；`theme.colors` 不可用时
  回退普通 `theme.fg("syntaxVariable")`。左组与降级阶梯逐字不变。
- `tests/load-check.mjs`：mock theme 补 `colors` 与 `style`。
- `README.md` 描述同步；`package.json` 0.7.4 → 0.7.5。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机右组为灰调青，不再刺眼，与深色底协调。

## 实现结果

- `src/footer.ts`：新增 `softTeal()`，`theme.colors.syntaxVariable` 经 OKHSL 饱和度 ×0.5 柔化后渲染
  （ziye `#4DD0E1`→`#90C7CF`），右组三段统一走它；`theme.colors` 缺失时回退普通 `fg`。
- `tests/load-check.mjs`：mock theme 补 `colors` 与 `style`，覆盖柔青路径。
- `README.md` 描述同步；`package.json` 0.7.4 → 0.7.5。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿；真色预览确认右组为 `#90C7CF`。

# v0.7.6 — 右组青色退晕：一族三调

## 问题

- v0.7.5 右组三段同一柔青，用户觉得三部分颜色全一样、没有层次。

## 目标

- 同族青色按角色做三级退晕：Cache 最实（主角数字）、占用条中调、token 数最灰（细目）。

## 改动清单

- `src/footer.ts`：`softTeal(text, fade)` 加饱和度系数参数；Cache=0.65、条=0.5、token 数=0.35
  （ziye 下 `#80CAD4` / `#90C7CF` / `#9EC3C9`）。左组与降级阶梯逐字不变。
- `README.md` 描述同步；`package.json` 0.7.5 → 0.7.6。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机右组三段同族青色但有明暗层次，不再一坨。

## 实现结果

- `src/footer.ts`：`softTeal(text, fade)` 参数化，Cache=0.65/条=0.5/token 数=0.35（ziye `#80CAD4`/`#90C7CF`/`#9EC3C9`）。
- `README.md` 描述同步；`package.json` 0.7.5 → 0.7.6。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿。

# v0.7.7 — 左组紫罗兰退晕：与右组同一思路

## 问题

- 右组退晕用户认可，要求左组 provider · model · thinking 也用同样思路。

## 目标

- 左组以主题签名色（accent 淡紫）为同族基底按角色退晕：provider 前缀最淡 0.35、
  model 主角最实 0.65、thinking 中调 0.5；t/s 绿色活信号不动。

## 改动清单

- `src/footer.ts`：`softTeal(text, fade)` 泛化为 `faded(token, text, fade)`（任意主题色
  OKHSL 降饱和）；左组三段走 `faded("accent", …, 0.35/0.65/0.5)`，ziye 下
  `#AE9CC4`/`#B692DF`/`#B297D1`。右组改为同一 helper，色值不变。
- `README.md` 描述同步；`package.json` 0.7.6 → 0.7.7。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机左组三段同族紫罗兰有层次，model 最醒目。

## 实现结果

- `src/footer.ts`：`softTeal` 泛化为 `faded(token, text, fade)`；左组 provider=0.35、model=0.65、
  thinking=0.5（ziye `#AE9CC4`/`#B692DF`/`#B297D1`），t/s 绿不变；右组走同一 helper，色值不变。
- `README.md` 描述同步；`package.json` 0.7.6 → 0.7.7。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿；真色预览确认两组退晕协调。

# v0.7.8 — 左组改用主题自带紫罗兰梯度

## 问题

- v0.7.7 对淡紫做 OKHSL 降饱和，紫色被洗灰，用户觉得太淡。

## 目标

- 左组直接用主题自带的饱和紫罗兰色阶：provider=`thinkingLow`（深沉）、model=`accent`
  （全饱和主角）、thinking=`thinkingText`（中调），保持退晕层次但全是正色。

## 改动清单

- `src/footer.ts` 左组：`faded("accent", …)` 三处改回 `theme.fg`（`thinkingLow`/`accent`/`thinkingText`），
  右组青族退晕不变。ziye 下 `#8F80C8`/`#C084FC`/`#A78BFA`。
- `README.md` 描述同步；`package.json` 0.7.7 → 0.7.8。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机左组紫色饱和不发灰，三段层次仍在。

## 实现结果

- `src/footer.ts` 左组改回 `theme.fg`：`thinkingLow`/`accent`/`thinkingText`（ziye `#8F80C8`/`#C084FC`/`#A78BFA`），
  右组 `faded()` 青族退晕不变。
- `README.md` 描述同步；`package.json` 0.7.7 → 0.7.8。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿；真色预览确认紫色饱和。

# v0.7.9 — t/s 移入右组

## 问题

- 用户要求 token 速度从左侧移到右侧，与 Cache 同族的动态数字归在一起。

## 目标

- 左组只剩身份三栏：provider · model · thinking。
- 右组变为「运行状态」组：`Cache NN%`  `39 t/s`  占用条  token 数；t/s 保持 success 绿点缀。
- 宽度降级：cache 最先掉，再 rate，再占用条，最后 provider（阶梯多一级）。

## 改动清单

- `src/footer.ts`：`rate` 从 `left()` 移到 `right()`（cache 与占用条之间，两段两空格分隔）；
  阶梯改 `{provider,bar,rate,cache}` 五级。左组注释与 README 同步。
- `src/metrics.ts`：`rateText()` 去掉估算值的 `~` 前缀（用户不需要），流式估算与精确值同式样。
- `src/ui.ts`：/ui 面板 Footer 条目描述同步。
- `package.json` 0.7.8 → 0.7.9。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机底栏右侧为 `Cache NN%  39 t/s  ⠿…  used/window`，窄终端按 cache→rate→bar→provider 依次丢弃。

## 实现结果

- `src/footer.ts`：`rate` 移入 `right()`（cache 与占用条之间）；阶梯五级，降级顺序
  cache→rate→bar→provider。
- `src/metrics.ts`：`rateText()` 去掉 `~` 前缀。
- `src/ui.ts` /ui 描述、README 同步。（注：版本号当时漏 bump，package.json 实际仍为 0.7.8，至 v0.7.10 一并订正。）
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿；真色预览确认右组顺序。

# v0.7.10 — 速度跨轮常驻

## 问题

- 每轮 message_start 会清空上一轮的速度值，轮与轮之间的等待期底栏速度消失、
  流式开始又跳出，用户要求速度一直显示。

## 目标

- `message_start` 只重置本轮采样（messageStart/firstDelta/chars），保留上一轮 exact/live，
  新测量出现后自然覆盖。

## 改动清单

- `src/metrics.ts` `message_start`：不再清空 `rate.live`/`rate.exact`。
- `tests/load-check.mjs`：新增 F2（速度跨 message_start 仍在，usage 只给 output 不污染缓存
  断言）；CA1 断言更新为 Cache→速度→占用条顺序。
- `package.json` 0.7.8 → 0.7.10（一并订正 v0.7.9 漏 bump 的版本号）。

## 验收标准

1. `tsc --noEmit` 与 `node tests/load-check.mjs` 全绿。
2. 真机轮与轮之间速度常驻，新轮流式开始后刷新为新值。

## 实现结果

- `src/metrics.ts` `message_start` 只重置本轮采样字段，`rate.live`/`rate.exact` 保留。
- `tests/load-check.mjs`：新增 F2 跨轮速度断言；CA1 断言更新为 Cache→速度→占用条顺序。
- `package.json` 0.7.8 → 0.7.10。
- 验证：`tsc --noEmit` 通过；`node tests/load-check.mjs` 全绿。
