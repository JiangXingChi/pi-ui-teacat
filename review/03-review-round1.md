# 审改 第 1 轮 — 问题清单

只读通读 `index.ts`、`src/**`、`README.md`、`tmp/load-check.mjs` 后记录。按严重度排列。

## 致命（功能错误）

1. **每个回答都会生成一个假的“思考”**：`src/process/index.ts` 在 `message_start` 就 `beginRun` + `startThinking`，
   于是纯文字回答也会得到 `1 thought`，并在回答下多出 `▸ Process · 1 thought·0ms` 头行。
   `startThinking` 应只在第一个 `thinking_delta` 时发生，run 应只在真的出现思考/工具时建立。
2. **思考时长算错**：`startThinking(ts)` 用 `message_start` 时刻做起点，`finishThinking` 用 `message_end`，
   把“模型思考 + 生成正文”的整段时间算成思考时长。应取首个 `thinking_delta` → 最后一个内容增量。
3. **纯思考的消息可能拿不到头行**：`beginRun` 固定绑定第一条 assistant message，若第一条是纯文字、
   第二条才有思考，第二条永远不是 `headerTs`，其思考行被吞掉。
4. **`ensureRow` 把历史工具塞进当前 run**：`patch.ts` 里对没有现行 row 的组件会 `state.current.tools.set(...)`，
   resume 时重建旧 transcript 会污染当前 run 的计数。
5. **`rebuild` 用空 args 算 outcome**：`rebuild()` 调 `outcomeFromResult(row.name, {}, …)`，
   `edit` 的行会算成 `+0 −0`、`write` 算成 `0 lines`。应在 row 上保留 `args` 供结算使用。

## 中等（行为/一致性）

6. **`stopReason === "length"` 的截断提示丢失**：我们接管 `updateContent` 时没有照抄 Pi 的
   `Response was truncated before completion.`。
7. **`agent_settled` 后 `state.current` 未清空**：完成后仍指向旧 run，后续事件/历史渲染容易误挂。
8. **工具行 `open` 点击后没有交还鼠标**：`handleMouse` 里 `row.open` 的关闭路径没有 `invalidate` 之外的请求重绘
   （只 `this.invalidate()`，没有 `requestRender`），部分情况下要等下一次渲染才收起。
9. **`Now` 的思考计时在 `text_delta` 时被清掉**：`clearLiveThinking()` 丢了 `lastAt`，
   导致思考时长退化成 `message_end` 时刻。
10. **t/s 刷新过密**：`message_update` 每个增量都 `onChange()` → `footer.refresh()`，
    流式时每秒几十次 `requestRender`；应节流到 ~250ms。
11. **头行耗时只在事件到来时变**：运行中长时间单工具时 `42s` 会冻结（头行按宽度缓存）。
    本期先记录，改为“settled 才显示耗时”，避免给出会停滞的数字。

## 轻微（清理/健壮）

12. 死代码：`state.ts` 的 `currentRun`/`runOfTool`/`rowsFor`/`textOfContent`；
    `format.ts` 的 `outcomeOf`；`patch.ts` 的 `fit` 导出；`now.ts` 的 `nowLabel`。
13. 项目缺 `.gitignore`，`node_modules/` 与 `tmp/` 产物会进仓库。
14. `README.md` 写 `/process` 已实现（是），但没写“耗时仅在 settle 后显示”“思考时长取增量区间”等行为。
15. `tmp/load-check.mjs` 没有覆盖“纯文字回答不应产生 Process 头”这条回归用例（正好是最致命的 1 号缺陷）。
16. `state.ts` 的 `HISTORY_LIMIT` 裁剪只删 `rows`，`runs` 与 `components` 不设上限。
17. `patch.ts` 里 `ensureRow` 对 `tool.result` 已存在但没有 `durationMs` 的历史行不设状态（默认 running），
    折叠态下会画成 `◆`。
18. `/ui` 关闭 Process 后没有同步把 Pi 的 tools-expanded 复位，下一次打开时可能直接是展开态。
19. `footer.ts` 的降级只有 4 档，超窄（< 30 列）时会退到 `model · thinking` 仍可能越界（有 truncate 兜底，但会切在词中间）。
20. `settings.ts` 写入只做 rename，没有校验参数（可接受），但没有 `PI_FOCUS_HOME` 之类的测试覆盖入口。

## 处理方式

1–5、6–11 全部修；12–15、17–19 修；16 加裁剪；20 记录不改。