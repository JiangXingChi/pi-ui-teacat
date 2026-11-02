# 底栏上下文段靠右（v0.1.10）

## 需求

`⠿⠿⠄⠄⠄⠄⠄⠄ 19.7% 196.5k/1M` 这一段的最终形态是「进度条 + token 数」（v0.1.9 已改），
这次把它**挪到终端最右边**，不要跟在 `t/s` 后面。

## 改动

`src/footer.ts` 的 `line()` 从「一段一段拼成一整行」改成「左组 + 右组」：

- 左组：`供应商 · 模型 · 思考 · t/s`（靠左）
- 右组：`⠿⠿⠄⠄⠄⠄⠄⠄ 15.5k/1M`（靠右，贴终端最后一个字符）
- 用 `format.ts` 里已有的 `joinColumns(left, right, width, 12)` 拼接：左组按剩余宽度截断，
  中间补空格把右组推到右边缘，整行保证不超过终端宽度。

配对阶梯（原来按「整行放不放得下」判，现在按「左组 + 2 + 右组」判，因为 `joinColumns` 自己会截断，
它的输出宽度不能再当判据）：

1. `供应商 · 模型 · 思考 · t/s` + `条 + token`
2. `模型 · 思考 · t/s` + `条 + token`（先掉供应商）
3. `模型 · 思考 · t/s` + `token`（再掉进度条，保留数字）
4. 仍放不下：右侧段整段不画，退回 `模型 · 思考`，再不行只剩模型

`src/ui.ts` 与 `README.md` 的底栏说明同步成「左：provider · model · thinking · t/s；右：context bar + tokens」。

## 验证

- `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）通过。
- `node tests/load-check.mjs` A–T 全绿。用例 **F** 增加两条断言：
  ```
  F ok:      Qwen Token Plan 2 · DeepSeek V4.1 Flash · max                     ⠿⠄⠄⠄⠄⠄⠄⠄ 123k/1M
  F narrow:  DeepSeek V4.1 Flash · max    123k/1M
  ```
  - `visibleWidth(wide) === 120`：右组确实被推到第 120 列；
  - 行尾就是 `123k/1M`；
  - 窄屏 36 列时仍然是「先掉供应商、再掉进度条」，行宽不超 36。
- 真机（pty，120 列）：底栏为
  `Opencode Go · DeepSeek V4.1 Flash · max · 49 t/s` + 空白 + `⠄⠄⠄⠄⠄⠄⠄⠄ 15.5k/1M`，右边缘对齐。

## 取舍

- 右组宽度固定后，左组在中宽终端会被截断（`…`）而不是把右组推走——优先级给了上下文数字。
- 极窄终端（左组 + 右组都放不下）会直接丢掉右组，表现为「底栏回到 v0.1.7 的样子」。