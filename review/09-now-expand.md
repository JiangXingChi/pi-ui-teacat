# R1c：Now 展开（v0.1.4）

## 需求（PLAN「R1c Now 展开」）

- 收起仍是一行；左键点 `▸ Now` 展开、再点收起。
- 展开后：每个运行中的工具一行；流式思考先一行 `↳ thinking`，再显示最后 3 行正文。
- 只认头行（`y === 0`）、只认左键；不新增键位；最多 9 行；展开态是会话级。

## 实现

| 位置 | 改动 |
| --- | --- |
| `src/process/now.ts` | `nowExpanded` + `resetNow()`；`nowView()` 返回 `{ tools, thinking }`；`nowHeadline(view, now, expanded)`；`NowWidget.handleMouse`（左键 + `y === 0`）；`render` 按展开态出多行并截到 9 行 |
| `src/process/render.ts` | `nowLine` 改 `▸/▾`；新增 `nowToolLine`、`nowThinkingLine`、`nowThoughtBody` |
| `src/process/index.ts` | `refreshNow` 与 ticker 的「有无 Now」判断换成 `nowView()`；`session_start` / `session_shutdown` 调 `resetNow()` |
| `tests/load-check.mjs` | **Q**：2 个工具并行时收起 1 行（`2 tools · … +1`），点开 3 行（头行 + 两条工具行），点子行无效，再点收起；**R**：思考流式时展开为「头行 + thinking 行 + 最后 3 行」，空闲后 widget 消失 |

## 审查中改掉的一处

- 展开后头行原本仍写 `bash sleep 5 · 2s`，与下面的子行完全重复；改为展开时只报数量 `1 tool · 2s` / `2 tools · 5s`。
  收起时保持原来的详细信息（含 `+1` 与思考尾部），因为那时只有这一行。

## 验证

- 可行性的前提先做了探针：`tmp/probe/now-probe.ts` 在编辑器上方挂一个带 `handleMouse` 的 widget，真机点击后计数从 0 变 1
  —— Pi 的鼠标分发能到达 widget（`Container.handleMouse` 会向下派发）。
- `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）通过。
- `node tests/load-check.mjs` A–R 全绿。
- 真机（pty，`用 bash 运行 sleep 5`）：运行中屏幕为
  ```
  ▸ Process · 1 tool · 3.7s
  ▾ Now · 1 tool · 3s
    ↳ ◆ bash  sleep 5                                              3s
  ```
  即：点一次展开、子行带自己的秒数；Process 折叠态不受影响。
- 真机复测 Process 头行点击（`tmp/repro/click-tui.py`）仍正常，未被本次改动带坏。

## 已知取舍

- 展开态跨 run 保留（同一会话内），换会话复位；空闲时 widget 整个移除。
- 展开最多 9 行（Pi 的 widget 上限 10 行）；工具多于 8 个时末尾被 `slice` 截断——实际一次并行很少超过 3 个。
- 思考正文只显示最后 3 行非空文本，行内控制字符由 `oneLine` 清掉。