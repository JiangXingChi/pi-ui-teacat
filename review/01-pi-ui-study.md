# pi-ui 源码研读笔记（v2.0.1，GitHub main）

参考副本：`review/ref-pi-ui/`（已去掉 .git / tests / .github）
上游：https://github.com/prjct-app/pi-ui   依赖：`@prjct.app/pi-tui-kit` ≥0.3.1、`sharp`

## 1. 总体结构

```
index.ts                装配：读设置 → 注册 header/palette/transcript/activity/footer → /ui
src/settings.ts         5 个开关，~/.prjct/pi-ui/settings.json（原子写）
src/ui-command.ts       /ui 勾选面板（openChecklist）
src/header/             setHeader + 像素画 logo
src/transcript.ts       消息时间戳 u./p.（patch 组件 render）
src/statusline.ts       setFooter 自定义底栏
src/activity/           7 个内置工具换成紧凑行 + /activity + 摘要条目 + codemode 折叠
src/palette/            53 套配色：生成 theme 文件、写活跃色、备份、云同步、/palette 面板
```
约 4.2k 行 TS，无框架、无测试依赖（上游用 node:test + tsx）。

## 2. 关键设计（可直接借用的）

### 2.1 装配与开关
- 工厂里只做“注册”，副作用（文件监听、备份、网络）一律放 `session_start`，`session_shutdown` 关掉。这是 pi 文档明确要求。
- `settings.ts`：缺文件/缺键 = 全开；写成 `{"header":true,...}`，`writeSettings` 用 `pid.tmp` + rename 原子替换。
- `/ui` 只是同一个 `apply(ctx, settings)` 的入口；activity 因为要替换内置工具，只能在扩展加载时决定 → 提示“重启 Pi，/new 不够”。

### 2.2 Transcript 的时间戳（最巧的一处）
- Pi 没有这个开关，于是直接包 `UserMessageComponent.prototype.render` / `AssistantMessageComponent.prototype.render`；
  `Symbol.for("pi-ui.transcript")` 打标记防止重复 patch；形状不对就原样返回（防御式）。
- 时间来源：`ctx.sessionManager.getBranch()` 里 message 的 `timestamp`；用户消息按“文本 + 出现次序”建索引（`Map<string, number[]>`），
  助手消息直接用 `lastMessage.timestamp`。未见过的新消息用 `Date.now()`。
- 细节：判空行前先剥掉 OSC 133 shell 标记与 SGR、再判是否空白；`outputPad` 决定缩进；`WeakMap` 缓存每条 view 的时间。

### 2.3 Activity（7 个内置工具换外观）
- 用公开工厂重建工具：`createReadTool`/`createBashTool`/`createEditTool`/`createWriteTool`/`createFindTool`/`createGrepTool`/`createLsTool`，
  `registerTool({...initialTool, name, renderShell:"self", execute(...)})`；`execute` 里用第 5 个参数 `ctx`（运行时由 Pi 传入，类型未公开）。
- 状态是一整个不可变值 `ActivityState`，每次事件生成新值（`{...state}`），单个可变 cell 只换引用 → 渲染函数随时读最新值。
- 行组件 `ActivityRowComponent` 持有 `() => ActivityRecord`，所以不需要重建组件就能刷新；`context.lastComponent` 复用以保留展开状态。
- 事件链：`tool_execution_start / update / tool_result / tool_execution_end`，`agent_start / turn_start / agent_settled`，
  `ui_prompt_start/end`（等用户输入）。
- 运行中：`setWidget("pi-activity", …, {placement:"aboveEditor"})` + `setWorkingMessage` + `setStatus`。
- 每次 run 结束写一条不可见会话条目 `pi.appendEntry("activity-summary", data)`，用 `registerEntryRenderer` 折叠渲染（默认空 Container，Ctrl+O 才展开），并在 `session_tree`/`session_start` 用 `restoredFromBranch()` 还原。
- `format.ts` 是纯函数层：目标文本、分类（inspect/change/verify/execute）、结果摘要（行数/匹配数/+N −M/exit code/超时）、截断探测（`details.truncation` 等）、文件变更聚合。
- codemode：通过 `createCodemodeExtension()` 拿到官方工厂，用 `Proxy` 只拦截 `registerTool` 里的 `codemode`，换成折叠 renderer —— 不用 import 内部模块、不 patch 原型。

### 2.4 Header
- `ctx.ui.setHeader(undefined)` 恢复 Pi 原生；`setHeader((tui, theme) => Component)` 画自己的。
- logo 三种：`pi` / `prjct` / `custom`（图片或 SVG 经 sharp 转 512 PNG，base64 存 `~/.prjct/pi-ui/header.json`，4MiB 上限）。
- `pixel-art.ts`：sharp 转 raw RGBA → 按终端 cell 尺寸（`getCellDimensions()`）求每个字符格的面积加权平均色 → 用 `▀▄█` 半块字符画；
  内置 logo 单色（`theme.fg("text")`），自定义 logo 保留真彩色（24bit 前景/背景转义）。
- `/header logo` 后用 `pi.on("input")` 截获下一条输入里的图片/SVG，`return { action: "handled" }`；预览用 `ctx.ui.custom` + `SelectList`。

### 2.5 Footer
- `ctx.ui.setFooter((tui, theme, footerData) => ({render, invalidate, dispose}))`；`footerData.onBranchChange(() => tui.requestRender())`。
- 内容：项目名/会话名/git 分支/模型/思考等级 + 右侧 8 格上下文占用条（`⠿`/`⠄`），一律 `truncateToWidth` 保证不超宽。
- 会用 `footerData.getExtensionStatuses()` 读别人设的状态（如 fast mode）。

### 2.6 Palette（数据驱动主题）
- 配色是数据：`palettes.json`（bundled）+ 用户 `library.json`；每套含 `vars`（16 个基础色）+ `colors`（角色→变量映射，可缺省）+ `export`。
- **必须**把主题写成 `$PI_CODING_AGENT_DIR/themes/<id>.json`：Pi 在扩展运行前就按 settings 应用主题，`resources_discover` 太晚。
  用 `owned-themes.json` 记录自己写过的文件，只删自己的；用户同名主题保留并优先。
- 切换：`ctx.ui.setTheme(id)` → 写 `palette-sync.json`；`watchFile` 200ms 轮询让多个 Pi 窗口同步（对比 settings.json 的 mtime，25ms 容差）。
- 备份：每周最多一次，本地 10 版 + 云端 10 版，文件锁（`wx` + 10 分钟后视为僵尸锁）、`sha256(stableJSON)` 去重、恢复前自动存一版。
- 云同步：device-code 风格登录（POST /api/pi/link → 显示 code → 轮询 claim），token 只存本机 0600，强制 https，15s 超时，401 视为掉线。
- `/palette` 面板：纯手写 `Component + Focusable`，左边分类、右边详情，宽屏双栏 / 窄屏切 tab，`↑↓ j k / enter / esc / tab / f / a / b / r / s / l / i / e`，选中即时预览、取消还原。

## 3. 上游踩过的坑（我们别重复）

| 坑 | 结论 |
| --- | --- |
| 主题文件放晚 | 必须写进 Pi 的 themes 目录，启动前就要在 |
| activity 想热切换 | 替换内置工具只能在扩展加载时，提示重启 |
| 组件 patch 无防护 | 检查 `prototype.render` 存在 + Symbol 标记，形状不符原样返回 |
| 每条消息重建组件 | 用 `() => record` 读最新值 + 复用 `context.lastComponent` |
| 主题字符串被缓存 | 带颜色的字符串不存状态，渲染时再取 theme |
| 宽度溢出 | 全部出口走 `truncateToWidth` / `fit` / `wrapTextWithAnsi` |
| 非 tui 模式 | 每个 UI 入口先判 `ctx.mode !== "tui"`；写文件/网络用 `ctx.hasUI` 区分 |
| 备份撞车 | 文件锁 + 僵尸锁超时，多窗口/多进程安全 |
| 同步/网络卡启动 | 全部异步后台跑，失败只 notify，不阻塞 |

## 4. 依赖 pi-tui-kit 提供的公共件

`openPanel` / `openChecklist` / `createForm` / `openSecretPrompt` / `stamp` / `clock` / `ago` / `fit` / `spread` / `paint` / `setMode` / `setFact` / `brand` / `completer`。
它的规则：docked 不用浮层、列表+详情、每屏可操作、只用主题色、每个状态符号配一个词。

## 5. 我们要做的东西，可以怎么切

- 复用面：settings/原子写、transcript patch 思路、activity 状态机与 format 纯函数、palette 的 theme 文件生成、footer 布局。
- 可以不要：云同步/备份（重、涉及账号）、53 套配色、codemode 折叠、像素 logo。
- 待定：只做“壳”（header/transcript/footer）还是连 activity 一起；是否依赖 pi-tui-kit；是否保留 /ui 五开关模型。