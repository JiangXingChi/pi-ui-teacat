# 审改记录 — v0.7.13 缺陷修复（不动功能与 UI）

日期：2026-11-19。范围：全项目源码 + 回归测试。约束：只修缺陷，不改功能与 UI 设计。

## 第一轮（发现 3 项）

1. **`src/format.ts` `targetOf`**：grep/find 在 `pattern` 为空、仅有 `path` 时渲染出前导悬空
   分隔符（`" · /tmp/x"`，trim 后仍留 `· `）。修为 `filter(Boolean).join(" · ")`。
2. **`src/metrics.ts` `message_end`**：provider 不报 `usage.output` 时，旧代码无条件丢弃本轮
   `live` 估算、保留上一轮 `exact`，底栏把旧速度当本轮的。修为：output>0 时照常写 exact；
   否则把本轮估算提升为 exact，无估算才保留旧值。
3. **`src/footer.ts`**：`right()` 上方残留 v0.7.9 之前的旧设计注释（“cache rate rides in
   front of it”），与现实现（speed 在最前）矛盾。合并改写为现状描述。

### 排除的疑似项（查证后非缺陷）

- `patch.ts` assistant 补丁的 `setExpanded` 无 mounted 守卫：上游 `interactive-mode.js`
  证实 assistant 组件构造后**不会**被调 `setExpanded`（仅 ToolExecutionComponent 构造时
  会被调 `component.setExpanded(this.toolOutputExpanded)`，故 tool 侧才有守卫）。排除。
- `now.ts` `lineCap` 在极小终端（<9 行）仍返回 9：原设计预留值，TUI 布局自行裁剪。不动。
- `state.thinkingVisible` 为全局量：hideThinkingBlock 是会话级设置，混合场景实践中不出现。不动。
- `pi.appendEntry(THOUGHT_ENTRY, …)` 条目形状：上游 `appendCustomEntry` 生成
  `{type:"custom", customType, data}`，与 `rebuild()` 的读取一致。排除。

## 第二轮（发现 0 项）

- 复检三个修复 hunk、全量源码快扫、`tsc --noEmit --noUnusedLocals --noUnusedParameters`
  严格检查、`node tests/load-check.mjs` 全绿（新增 FMT / F3 两组断言）。

## 新增回归

- **FMT**：`targetOf` 三种 grep/find 参数组合（仅 path、pattern+path、皆空）。
- **F3**：provider 不报 output 时，本轮估算（4.8 t/s）替换上一轮 exact（100 t/s），
  且不复现旧值。注意 F3 消息不带 usage，避免污染 CA 系列的缓存断言。

## 结论

两轮收敛（第二轮零发现）。功能与 UI 未变：右组顺序、配色阶梯、宽度阶梯、文案保持 v0.7.13。
