# R1d：过程块子行默认一行、点开看内容（v0.1.5）

## 需求（PLAN「R1d 过程块子行」）

块展开后，思考与工具都只占一行；想看正文时再点开那一行。工具行原本就是这样
（一行摘要 → 点开交回 Pi 原生详情），这次补齐思考行。

## 实现

| 位置 | 改动 |
| --- | --- |
| `src/process/state.ts` | `Thought` 加 `open?: boolean` |
| `src/process/render.ts` | `thinkingLine` 在行首加 `▸/▾` 标记；只有真的有正文时才出标记 |
| `src/process/patch.ts` | 思考行包 `MouseRegion`：左键点一下切换 `thought.open` 并 `invalidateAll()`；只有 `open` 时才 `addChild(thinkingBody)`；`setBlockExpanded(false)` 同时复位所有 `thought.open` |
| `tests/load-check.mjs` | **D** 改为：块展开时思考行是 `↳ ▸ thinking 400ms`、正文不显示；点行出现 `▾` 与正文；再点收起。**D3** 新增：手点开的思考行在整块收起时一起收起。顺带把 J/L/O 里「展开就有正文」的旧断言改成「展开只有行，点了才有正文」 |

## 验证

- `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）通过。
- `node tests/load-check.mjs` A–R 全绿。
- 真机（pty，`先用 bash 运行 ls …`）：
  ```
  ▾ Process · 1 thought · 1 tool · 1.7s
    ↳ ▸ thinking 507ms          ← 块展开后，思考仍是一行
  ```
  左键点该行后：
  ```
  ▾ Process · 1 thought · 1 tool · 1.7s
    ↳ ▾ thinking 507ms
     The user wants me to run ls with bash and then reply only "完成". Let me do that.
     The instruction says reply only two characters: 完成. Let me run ls first, then reply with just that.
  ```
  再点一次回到 `↳ ▸ thinking 507ms`。
- Process 头行点击、Now 行点击此前验过，本次改动不涉及。

## 已知取舍

- 思考行没有正文时不出 `▸/▾`，点了不响应（避免空切）。
- 折叠块不会记住「开着哪几行」：整块收起即全部收起，与工具行同一套复位。
- 一处思考段在会话重建（`/resume`）后默认收起；正文来自会话里的 thinking 内容，不额外持久化 `open` 状态。