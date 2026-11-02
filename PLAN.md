# PLAN — 自研 Pi UI 插件（基于 pi-ui 二次开发）

状态：**v0.2.0 审改完成**，等人工看效果
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
4. **thinking 正文**用裸 Markdown 渲染，没接 Pi 的 markdown transformers（Mermaid 会退化成代码块）。
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
