# 审改 第 4–6 轮（v0.1.3，收敛）

## 第 4 轮（全文再读 + 静态检查）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | `metrics.ts` 的 `ttftMs` 只写不读（v0.1.1 审改第 10 项同一类残留） | 删字段、两处复位和一处赋值 |
| 2 | `Run.order` 只 push 不读（行由组件顺序决定，不靠它排序） | 删字段与四处写入 |
| 3 | `patch.ts` 的本地 `Theme` 类型没人用（`theme()` 返回 `any`） | 删除；`tsc --noUnusedLocals --noUnusedParameters` 从这条错误变全绿 |
| 4 | README「How folding works」说头行「end as `✓ Process`」，展开后其实是 `▾` | 改成「折叠时 ✓/!，展开时 ▾」 |

## 第 5 轮（查覆盖与文档）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 第 1 轮「底栏把 TUI 交给 `rememberTui`」这条修复没有任何用例守住 | 用例 **F** 增加 `assert.ok(state.tui, …)` |
| 2 | `tests/load-check.mjs` 头部注释仍写「Covers … review/03-review-round1.md」 | 改为覆盖 `review/03` 与 `review/05..07` |

## 第 6 轮（复读，找新问题）

- 逐文件复读 `index.ts`、`src/*.ts`、`src/process/*.ts`、`tests/load-check.mjs`、`README.md`、`PLAN.md`。
- 复核第 4、5 轮 6 项：全部落地，无回归；无新增发现。
- 刻意复查过的点，均无问题：`/ui` 关/开三项开关的时序、`footer.onTui` 在关底栏后仍保留 `state.tui`、
  `session_start` 里 Pi 处理器与扩展处理器的先后、`patchedRender` 五个分支的判定顺序、
  `thinkingVisible` 在 Process 关→开时由下一次 `updateContent` 自纠、聚焦（鼠标点击不会把焦点从编辑器挪走，
  `dispatchMouseEvent` 只有 `focus: true` 才换焦点）、点击合成的 press→click 链路（与 Pi 自己的思考行同一套）。

### 接受不修（记录在案）

- 部分文件结尾没有换行（`footer.ts`、`ui.ts`、`process/*.ts`、README 等 9 个），全项目一致的既有风格，改动只会制造无关 diff。
- `LABEL`/`NOW_LABEL`/`VERBS`/`isPlainObject` 等导出只在模块内使用；属于模块表面，删除无收益。
- `state.components` 在 `rebuild` 时不清空（有 1000 上限兜底）。
- 被 `trimRows` 淘汰后又被渲染的工具组件会重建为 `running` 行（仅超长会话）。
- 折叠标志全局共享，一个块展开会带动所有块（PLAN「共享一份折叠值」的设计）。

## 验证（收敛）

- `./node_modules/.bin/tsc --noEmit` 通过；加 `--noUnusedLocals --noUnusedParameters` 也通过。
- `node tests/load-check.mjs` A–P 全绿。
- 真机（pty）：`▸ Process · 1 thought · 1 tool · 1.4s` → 左键点头行 → `▾ Process`、`↳ thinking 302ms` + 正文、
  `↳ bash ls · exit 0 · 19ms`；`Ctrl+O` 路径见 `review/05`。
- 结论：第 6 轮零发现，收敛。版本记为 v0.1.3。