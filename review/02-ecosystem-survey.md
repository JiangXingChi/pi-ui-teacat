# 生态调研：别人做过没有（2026-11）

方法：GitHub API 检索 `topic:pi-package` / `topic:pi-extension` / 关键词，克隆 12 个仓库读源码。
副本在 `tmp/refs/`（`pi-*` 目录，已去 .git）。星数为调研时快照。

## 1. 一句话结论

两件事都有人做过，但**没人把两者合成我们要的样子**：

- 「思考 + 工具收进过程」：有 4 种路线，最接近的是 `pi-compact-transcript`（折叠成一行 + 汇总行）和
  `pi-cc-extensions`（真的用 Container 把工具包成一个 group 卡片）；`pi-split-view` 则把它们搬到上方独立面板。
- 「底栏 供应商·模型·思考·速度·上下文」：`pi-footer` 已有除"瞬时 tok/s"以外的全部片段；
  tok/s 的算法在 `pi-turn-metrics`、`pi-stamp-plus`、`pi-cc-extensions/token-rate.ts` 里都有现成实现。

## 2. 相关仓库

| 仓库 | ★ | 与我们相关的点 |
| --- | --- | --- |
| avhagedorn/pi-compact-transcript | 16 | 工具行折叠 + 同工具 burst 合并 + 每轮汇总行 + 隐藏 Thinking… 标签 |
| MasuRii/pi-tool-display | 303 | 7 个内置工具 + MCP 的紧凑渲染、diff、thinking 标签；patch 带 owner/version |
| minuque/pi-cc-extensions | 149 | Claude Code 风格；**工具真分组**（Container.addChild patch）、compact-thinking、footer 里的 token-rate |
| Hugo-W/pi-split-view | 20 | 顶部 thinking/tool 面板 + response-only 转录（真正的"过程/回答"分区） |
| aleclarson/pi-zen | 1 | 极简：隐藏 thinking + 工具历史，只留问答 |
| bertalanv/pi-berszi | 0 | "spotlight"：运行时全展开，结束瞬间折成一行；patch 4 个工具方法 |
| ClapEcho233/pi-smart-fold | 0 | thinking 折成 `Thought for 12.4s`，点击展开，持续时间持久化 |
| wobondar/pi-footer | 29 | 多行 footer 的片段系统：Provider / Model / Thinking / Context % / Context Bar / 速度 |
| leon-zym/pi-turn-metrics | 4 | TTFT + tok/s + LLM/工具耗时，宽度自适应 |
| sbsamarski/pi-stamp-plus | 1 | 每条回复的 stamp：TG(t/s) / PP(t/s) / Ctx 的完整算法 |
| imran-vz/pi-observability | 11 | footer engine 拆成 segments/layout/format，settings 面板 |
| 1993yihuan/pi-ui-extension | 1 | fullscreen 侧栏：CTX 面板（模型/上下文/性能）、VIEW 模式 |
| lmilojevicc/pi-zentui | 124 | 组件级换装库：editor / 消息 / thinking / statusline 可独立替换 |

## 3. R1「过程块」的四条路线

### 路线 1：折叠成一行（视觉分组，低风险）✅ 推荐先做
代表：`pi-compact-transcript`、`pi-berszi`、`pi-smart-fold`。

- patch `ToolExecutionComponent.prototype.updateDisplay / render / handleMouse`
  （`pi-compact-transcript` 742–840 行）：接管所有工具（含 MCP/自定义），展开时 `originalUpdateDisplay` 原样交回。
- patch `AssistantMessageComponent.prototype.updateContent`（915–970 行）：`hideThinkingBlock` 时丢掉 thinking 块，
  只渲染 text；thinking 标题被抓成一行"ticker"挂在最后一个工具行下面。
- 同工具连续调用合并成 `2× read src/x.ts {8 lines · 12s}`（`joinBurst` 580–610 行）。
- 每轮结束一行汇总：`Read 6 files, edited 2, ran 3 commands, 1 failed · 42s`。
- 点击/`ctrl+o` 展开；`__compactTranscriptHidden` 直接 `render` 返回 `[]` 来隐藏整行。
- 失效保护：拿不到 `updateDisplay` / `selfRenderContainer` 就整段让给原生。

### 路线 2：真的包成一个容器（风险高，效果最像"一个块"）
代表：`pi-cc-extensions/extensions/renderer/tool/grouping.ts`（880 行）。

- patch `Container.prototype.addChild / removeChild / clear`，把相邻的 `ToolExecutionComponent` 收进
  `ToolGroupComponent extends Container`（476 行）；`removeChild` 要还原到父容器。
- 处理了：`/reload` 后已挂载树重扫（`regroup`）、patch registry 组合（多扩展共存）、
  鼠标局部行命中测试（`childAtRow`）、并行工具的转圈动画、`edit/write` 不参与分组。
- 代价：所有 Container 都走这条路（性能/兼容面大），且分组边界只认"工具组件"；
  thinking 在 `AssistantMessageComponent` 里，仍要单独 patch 才能一起塞进组。

### 路线 3：搬到独立面板（真分区，重）
代表：`pi-split-view`（3079 行）：顶部条带 = Thinking 面板 + Tool Usage 面板，转录可切 "response-only"；
需要 fullscreen 模式，自己拥有一整层布局（band 高度、拖拽、缩放、文件 dock）。

### 路线 4：直接隐藏
代表：`pi-zen`（216 行）：`/zen` 打开后 thinking 与工具历史不渲染，只留问答。
思路最简单，但用户想看过程时要 `/zen` 再关一次，不是"可展开的块"。

### 派生的两个可复用点
- thinking 折叠成 `Thought for 12.4s`：`pi-smart-fold` 在 `AssistantMessageComponent` 的
  `thinkingVisibilityOverrides` 上做幂等 patch，并把时长写进 `smart-fold-thinking` 自定义条目（resume 后还在）。
- thinking 时长/活动态的读接口：`pi-cc-extensions/feature/compact-thinking.ts`
  （`getMessageThinkingDurationMs` / `isMessageThinkingActive`），`compact-mode.ts` 复用同一计时器出 `Thought for 8s`。

## 4. R2 底栏：现成片段与公式

`pi-footer` 的片段清单已经覆盖我们 5 项中的 4.5 项：
`Provider`、`Model`（可带 provider）、`Thinking Level`、`Context %`、`Context Bar`、`Input/Output Speed`（每分钟均值）。
缺的是"解码期瞬时 tok/s"。可用的公式（三处实现一致）：

```
t0      = message_start 的 message.timestamp
tFirst  = 第一个非空 text/thinking/toolcall delta 的时间
tEnd    = message_end 时间
TG(t/s) = usage.output / (tEnd - tFirst)        // 解码速度，不含首字等待
PP(t/s) = usage.input  / (tFirst - t0)          // 预填充速度
TTFT    = tFirst - t0
上下文   = ctx.getContextUsage().percent / tokens / contextWindow
```
（`pi-turn-metrics` 120–210 行；`pi-stamp-plus` 412–420、927–1010 行；`pi-cc-extensions/token-rate.ts` 顶部注释。）

`pi-cc-extensions/token-rate.ts` 还处理了两件我们迟早要碰的事：
- **工具执行期暂停采样**（`pauseTokenRate/resumeTokenRate`，并行工具引用计数），否则 t/s 被工具等待时间拉低；
- **两种口径**：`average`（一次用户指令的墙钟平均）与 `live`（最近 1s 瞬时，生成期暂停，结束后定格为整段平均）。

`pi-footer` 的架构也值得抄：`src/{render,metrics,presets,config}.ts` 分离，片段按行排列，
段与段之间统一分隔符，宽度不够时按优先级丢弃右侧片段（`layout.ts`）。

## 5. 借鉴清单（我们实际会用的）

| 要做的事 | 抄谁 | 具体 |
| --- | --- | --- |
| 工具行接管 | pi-compact-transcript | patch `ToolExecutionComponent.updateDisplay/render/handleMouse` + 展开交还原生 |
| 隐藏 thinking 正文 | pi-compact-transcript / pi-smart-fold | patch `AssistantMessageComponent.updateContent`，保留 `hideThinkingBlock` 语义 |
| thinking 折叠标题 | pi-smart-fold / cc-extensions | `Thought for …` / `思考 12.4s`，时长按内容 hash 存 `appendEntry` |
| 同工具合并 | pi-compact-transcript | burst：同名相邻合并 `N×`，失败另起一行 |
| 每轮汇总行 | pi-compact-transcript | 读/改/命令/失败计数 + 总时长 |
| 真分组（二期） | pi-cc-extensions/grouping.ts | patch `Container.addChild` + 分组组件 + 重新扫描已挂载树 |
| t/s 采样 | pi-turn-metrics / pi-stamp-plus | 见 §4 公式；工具期间暂停用 cc-extensions 的引用计数 |
| 底栏片段化 | pi-footer | segments + 布局/丢弃策略 + presets |
| 上下文条 | pi-footer / pi-ui | `Context Bar` 的 `[███░░] 50k/200k (25%)` 与 pi-ui 的 8 格 `⠿⠄` |

## 6. 仍未有人做的

1. 把 thinking 与工具**收进同一个带标题的块**（现有实现要么只折工具、要么只折思考、要么搬到面板）。
2. 底栏按 `供应商 → 模型 → 思考强度 → t/s → 上下文` 的固定顺序（pi-footer 可配置但默认不是这个顺序）。
3. 过程块与底栏**共用一套 run 统计**（耗时、tokens、t/s、工具计数）——现两个生态各算各的。

这意味着 R1/R2 的组合仍然值得做，且 80% 的技术风险已有先例可抄。
## 7. 追加：A 方案（视觉分组）有没有人做过

逐仓库核对（含 `spaceater/zpi-dense-display`、`ludoroo/pi-hush`）：

| 能力 | 谁做过 | 位置 |
| --- | --- | --- |
| 工具折成一行、点开看详情 | compact-transcript、zpi-dense-display、pi-berszi、pi-tool-display、cc-extensions | 各自主入口 |
| 同名工具合并 `N×` | compact-transcript | `joinBurst` |
| thinking 折成一行（带时长） | pi-smart-fold、pi-berszi、cc-extensions/compact-thinking | `AssistantMessageComponent.updateContent` patch |
| 一次 run 结束的汇总行 | compact-transcript | `SummaryData` |
| 缩进/左边线把若干行画成一块 | 无（只有 cc-extensions 用真容器做边框） | — |
| **共享“过程”头行 + 子行缩进 + 整块折叠** | **无** | — |

结论：A 的“组合”没人做，但 A 需要的**每一个零件**都有成熟实现，最大风险（patch 内部组件）已被
至少 4 个扩展趟过；我们只是把它们拼成一个共享状态的块。

## 8. 追加：「进行中」谁做过

- `pi-ui` 的 `ActiveToolsWidget`：`setWidget(..., { placement: "aboveEditor" })`，显示 `◆ Working · N active · M completed`
  + 最多 3 条运行中的工具（`verb + target + elapsed`），另配 `setWorkingMessage` 与 `setStatus`。最接近我们要的形态。
- `pi-hush`：不显示具体工具，只给活动标签（Working / Thinking / Responding / Running read +2）配动画。
- `pi-smart-fold`：把“正在思考”做成实时尾行 `Thinking… (8s)` + 最新一行思考，结束后变 `Thought for 12.4s`。
- `pi-berszi` 的 spotlight：运行中的行展开并实时输出，结束瞬间折成一行——是“同一行两种状态”，不是“两个区域”。
- `pi-split-view`：把进行中搬到顶部条带面板（thinking | tools），转录只留问答。

没有实现把「进行中」和「已完成过程块」当成同一套状态的两面（运行中只在 live 区，结束即转入过程块）。
