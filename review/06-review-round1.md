# 审改 第 1 轮（v0.1.3）

范围：全文通读 `index.ts`、`src/**/*.ts`、`tests/load-check.mjs`、`README.md`、`PLAN.md`，
对照 v0.1.2 的三处修复找新问题。

## 发现与处理

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `hideThinkingBlock: false` 时没有 Process 头，但工具行仍按折叠渲染（`render()` 返回空）——工具整个消失，又没有头行可点开 | `patchedUpdateContent` 记 `state.thinkingVisible`；`patchedRender` 在该状态下一律回退 Pi 原生行（`src/process/state.ts`、`patch.ts`） |
| 2 | `state.tui` 只由 Now 组件的工厂写入；关掉 Now 后 ticker 无法 `requestRender`，头行秒表停住，`invalidateAll()` 也只失效不重绘 | 底栏工厂把同一个 TUI 交给 `rememberTui`（`footer.ts` 加 `onTui` 回调，`index.ts` 接线） |
| 3 | `session_shutdown` 没清 `state.tui`，会话切换后可能拿旧 TUI 实例 `requestRender` | shutdown 清空 |
| 4 | `tool_execution_update` 里 `row.target = row.target || …`：启动时参数还空、`target` 已是 `.`，之后参数到了也永远补不上 | 改成合并参数后重算，只在当前是占位符 `.` 时替换 |
| 5 | 助手组件的 `setExpanded` 用 `if (typeof proto.setExpanded !== "function")` 幂等：将来 Pi 自己加了同名方法，我们的钩子就静默失效，无工具 run 又展不开 | 按工具组件同一套写法：先存 `originalSetExpanded`，有就调用，钩子始终装 |
| 6 | README「Limits」里关于 `hideThinkingBlock: false` 的说法与 #1 的新行为不符 | 改写该条，并补「Now 与 Footer 都关时秒表只在重绘时动」 |

不动但记录在案的既有取舍：

- 折叠标志全局共享，一个块的展开会带动所有块；折叠时统一复位 `row.open`（`row.open` 只在展开态有意义）。
- `state.rows` 超过 400 条会淘汰最旧的行；被淘汰的工具组件再渲染时会新建一条 `running` 行（只有超长会话才到得了）。
- `rebuild` 不清 `state.components`（有 1000 上限兜底）。

## 验证

- `./node_modules/.bin/tsc --noEmit` 通过。
- `node tests/load-check.mjs` A–N 全绿。新增：
  - **M**：`hideThinkingBlock: false` 下折叠行仍可见；换回隐藏思考后重新折起。把 #1 的回退判断关掉后该用例失败。
  - **N**：参数后到的工具，`. ` 占位被真实路径替换。