# 底栏上下文：去掉百分比，留进度条与 token 数（v0.1.8 → v0.1.9）

> 更正：v0.1.8 误删了 token 数（`196.5k/1M`），实际要删的是百分比。下面是最终形态。

## 需求

`⠿⠿⠄⠄⠄⠄⠄⠄ 19.7% 196.5k/1M` 里的 **`19.7%`** 不需要了，只保留进度条和 `196.5k/1M`。

## 改动

`src/footer.ts`：

- `context()` 不再拼 `${percent}%`；`percent` 只留给进度条算填充格数，`compactTokens()` 保留。
- 降级阶梯仍是 3 档：`bar+provider` → `provider` → 都不带。

`src/ui.ts` 与 `README.md` 里的底栏说明改成 `context bar + tokens`。

## 验证

- `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）通过（未用变量会直接报错，`dim` 就是这样发现的）。
- `node tests/load-check.mjs` A–T 全绿。用例 **F**：宽屏断言含 `123k/1M`、且**不含** `%`；窄屏（36 列）断言
  token 数仍在、模型仍在、provider 先掉、行宽不超。
  ```
  F ok:      Qwen Token Plan 2 · DeepSeek V4.1 Flash · max · ⠿⠄⠄⠄⠄⠄⠄⠄ 123k/1M
  F narrow:  DeepSeek V4.1 Flash · max · 123k/1M
  ```
- 真机（pty）：底栏实际输出 `Opencode Go · DeepSeek V4.1 Flash · max · 3000 t/s · ⠄⠄⠄⠄⠄⠄⠄⠄ 15.5k/1M`。

## 取舍

- 具体用了多少 token 看 `196.5k/1M`；百分比只能从进度条的格数估（8 格 = 每格 12.5%）。
- 36 列时刚好还能放下 `模型 · 思考 · token 数`（正好 36 格），再窄就只剩 `模型 · 思考`。