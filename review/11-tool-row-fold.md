# 修复：点开工具行后，第二次点击把整个 Process 折了（v0.1.6）

## 现象

块展开后点 `bash` 行 → 正常展开 Pi 的原生详情；再点一下 → 不是这一行收起，而是**整个 Process 块**折起来。

## 根因

工具行展开后不再是一行，而是 Pi 自己的真相（`$ ls` / 输出 / `Took 0.0s` 等若干行）。
第二次点击落在 `y=1`（详情里），不满足我们 `event.y !== 0` 的前置判断，于是被原样交给
`originalMouse` → Pi 的 `MouseRegion` → `this.setExpanded(!this.expanded)`。

而这个 `this.setExpanded` 已经是我们 patch 过的：`patchedSetExpanded` 对**已挂载**的工具组件
一律写"整块折叠标志"（那本是给 `Ctrl+O` 的全量扫动准备的）。于是单行的折叠被当成整块折叠。

即：同一份鼠标事件，我们只接管了第一行；第二行起交给了 Pi，而 Pi 的行内点击语义（只折这行）
在 patch 之后被放大成了整块折叠。

## 改动

`src/process/patch.ts` 的 `patchedMouse`：

- 收起态：只认 `y === 0`（这时整行就一条），点头行 = 展开整块 + 打开该行（原行为）。
- 已展开的工具行：**整行任何位置**的左键都由我们接管，只切 `row.open`，不再交给 Pi 的 MouseRegion，
  因此不会被误判成整块折叠。
- 未展开的行：仍只认 `y === 0` 才展开（避免点到别处）。
- 行的展开/收起一律用首次 patch 时捕获的 Pi 原生 `setExpanded`，跳过我们的钩子。

## 验证

- 回归用例 **S**：打开行 → 在详情里（`y=1`）点击 → 该行收起、`isExpanded()` 仍为 true、行回到一行摘要；
  再点又展开。把 `row.open` 分支去掉后用例失败（`the block itself stays open`），确认能抓住这个 bug。
- `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）通过；`node tests/load-check.mjs` A–S 全绿。
- 真机（pty，`用 bash 运行 ls`）：
  ```
  BLOCK OPENED             ▾ Process · 1 tool · 8.0s
                             ↳ bash  ls                    exit 0 · 30ms

  ROW OPENED               ▾ Process · 1 tool · 8.0s
                           $ ls
                           (no output)
                           Took 0.0s

  SECOND CLICK IN DETAIL   ▾ Process · 1 tool · 8.0s        ← 块仍是展开的
                             ↳ bash  ls                    exit 0 · 30ms
  ```

## 对比：thinking 行为什么没这个问题

思考行由我们自己包 `MouseRegion`，点击闭包里只切 `thought.open` 然后 `invalidateAll()`，
从不调用 `setExpanded`，所以不会被整块折叠的钩子吃进去。