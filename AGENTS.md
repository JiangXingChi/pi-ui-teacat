# AGENTS.md — pi-ui-teacat

自研 Pi 界面层插件。计划见 `PLAN.md`，上游研读笔记见 `review/01-pi-ui-study.md`。

## 目录

```
index.ts      扩展入口（Pi 用 jiti 直接跑 TS，无构建步骤）
src/          扩展源码
tests/        无头回归测试（假 Pi API + 真组件）
review/       研读笔记与每轮审改记录（ref-pi-ui/ 是上游副本，不入库）
tmp/          临时产物、克隆、日志（不入库）
```

## 工作流

1. 改动前先读 `PLAN.md`；`PLAN.md` 未定稿不开工，不擅自加功能。
2. 实现严格对齐 `PLAN.md` 的里程碑，完成后按“验收标准”逐条核验。
3. 本地调试：`pi -e ~/Agent/Temp/pi-ui-teacat`（单次加载，不写 settings）；上游参考副本放在 `review/ref-pi-ui/`，需要时重新 clone。
4. 类型检查：`./node_modules/.bin/tsc --noEmit`；无头回归：`node tests/load-check.mjs`；不引入构建步骤（Pi 用 jiti 直接跑 TS）。
5. 参考上游时看 `review/ref-pi-ui/`，不要直接拷贝上游文件进来。

## 约定

- 只碰 Pi 公开 API；要 patch 内部组件必须带形状检查和重复标记。
- 渲染出口统一走 `truncateToWidth` / `fit` / `wrapTextWithAnsi`，禁止裸拼宽度。
- 带主题颜色的字符串不进状态，渲染时现取 theme。
- UI 入口先判 `ctx.mode !== "tui"`；副作用放 `session_start`，清理放 `session_shutdown`。
- 临时文件写 `tmp/`，不写 `~` 根目录。