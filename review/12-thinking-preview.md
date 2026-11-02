# 思考行带预览（v0.1.7）

## 需求

`Process` 里收起的思考行只写 `thinking 12s`，看不出在想什么；希望默认仍是一行，但带上一点内容。

## 实现

`src/process/render.ts` 的 `thinkingLine`：

```
↳ ▸ thinking 12.4s · <思考文本最后一行的尾部>
```

- 预览取**最后一行非空内容**，过长时保留尾部、前面补 `…`（复用 `tailLine`）。
- 剩余宽度 `< 12` 列时不出预览，连分隔符一起去掉，只留 `↳ ▸ thinking 12s`。
- 标题（`thinking` + 时长）永远优先，截断只发生在预览上。
- 没有正文的思考不出预览、也不出 `▸/▾`。
- 点开仍是 `▾ thinking 12s · …` + 完整正文，正文不受预览影响。

新增常量 `PREVIEW_MIN = 12`；没有新状态、没有新事件。

## 验证

- `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）通过。
- `node tests/load-check.mjs` A–T 全绿。新增用例 **T**：三段式思考文本 → 收起时只有 1 行、含最新一句、不含更早内容、
  不超过终端宽度；宽度 26 列时预览连同 ` · ` 一起消失、标题保留。D/J/K/L 里「展开才有文本」的旧断言改成
  「文本出现次数」：收起 1 次（预览）、点开 2 次（预览 + 正文）、整块折叠 0 次。
- 真机（pty，`--thinking max`，让它跑一次 `ls -a`）：
  ```
  ↳ ▸ thinking 34ms · The user wants me to run `ls -a` and count files. Let me think first, then run.
  ```
  点该行后同一行变 `↳ ▾ thinking 34ms · …`，正文在下方展开（正文渲染此前已在 review/10 验过）。

## 取舍

- 预览是「最后一行」而不是「第一行」：流式思考时最有信息量的是最新一句；代价是长思考的中段看不到，要看全就点开。
- 行里同时有「时长 + 预览」，窄终端优先保时长（它是这个块的核心信息）。