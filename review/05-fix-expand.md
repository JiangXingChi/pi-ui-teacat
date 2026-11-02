# 修复：Process 块无法展开（v0.1.2）

## 现象

按下 `Ctrl+O` 或点过程块，thinking 展开不出来；无工具的 run 尤其明显。

## 根因（读 Pi 1.4.0 源码确认）

1. `interactive-mode.ts` 的 `setToolsExpanded()` 只遍历 `chatContainer` 的子组件，对
   `isExpandable()`（有 `setExpanded` 方法）的逐个调 `setExpanded(value)`。
   `AssistantMessageComponent` 没有 `setExpanded`，工具组件才有。所以：
   **一次 run 如果没有任何工具，`Ctrl+O` 找不到可切换的对象，整块永远展不开**；
   `/process` 能用，是因为它自己先写折叠标志。
2. Pi 每建一个工具组件都会在挂载前调 `component.setExpanded(this.toolOutputExpanded)`
   （`message_update` / `tool_execution_start` / 历史渲染三处）。旧实现在这个方法里写共享标志，
   于是**展开后只要有新工具进来，整块立刻被折回**。
3. 头行符号对已结束的 run 恒为 `✓`/`!`，展开了也看不出来。

## 改动

| 位置 | 改动 |
| --- | --- |
| `src/process/patch.ts` | 给 `AssistantMessageComponent.prototype` 加幂等 `setExpanded`（只在缺失时定义），落点 `setBlockExpanded()`；`/process` 与工具组件共用同一函数，折叠时统一复位 `row.open` |
| `src/process/patch.ts` | `mountedTools`（`WeakSet`）：只有**渲染过**的工具组件才能改共享标志，挂载前 Pi 的那次 `setExpanded` 不再影响折叠状态 |
| `src/process/render.ts` | 头行符号：展开恒 `▾`，收起的已结束 run 才是 `✓`/`!`，进行中 `▸` |
| `src/process/patch.ts` | 头行包一层 pi-tui `MouseRegion`：左键点头行 = 整块折叠/展开（`toggleBlock()` 同时同步 Pi 自己的 `toolOutputExpanded`，之后 `Ctrl+O` 方向不发散） |

## 验证

- `./node_modules/.bin/tsc --noEmit` 通过。
- `node tests/load-check.mjs` A–K 全绿。新增：
  - **J**：无工具的 thinking-only run，模拟 Pi 的 `setToolsExpanded` 遍历 → 出 `▾ Process`、`↳ thinking`、思考正文；再切回收起。把第 1 项改动关掉后该用例失败（`Ctrl+O marks the block open`），证明测试真的抓得住这个 bug。
  - **K**：展开态下新建工具组件（挂载前 `setExpanded(false)`）→ 块保持展开，行照样出现；再次 `Ctrl+O` 一起折回。
- 用例 **L**：在渲染出的行号上调 `Container.handleMouse`（真实事件分发链路），头行左键一次展开、再一次收起；渲染结果含 `▾ Process`、`↳ thinking`、正文。
- 真 TUI（pty，`pi --no-extensions -e . -t bash`，让它跑一次 `ls`）：折叠时只见 `✓ Process · 1 tool · 1.2s`，
  `Ctrl+O` 后出现 `↳ bash ls` / `exit 0 · 33ms`，头行变 `▾ Process`，与状态栏 `Tool output: expanded` 一致。
- 真机点鼠标（v0.1.3 补测）：pty + 简易屏幕解析，找到 `▸ Process` 所在行后发 SGR 左键按/放，屏幕变为
  `▾ Process · 1 thought · 1 tool · 1.4s`、`↳ thinking 176ms` + 思考正文、`↳ bash ls · exit 0 · 18ms`，与状态栏 `Tool output: expanded` 一致。
- 本机模型（deepseek-v4.1-flash）只在部分回答里返回 thinking：真机跑出过一次（176ms，见上），没跑出时该路径由用例 J/L 覆盖。