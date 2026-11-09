// Headless wiring and regression check: fake Pi API, real Pi components, fake clock.
// Covers the bug lists in review/03-review-round1.md, review/05..07, 15 and 17.
import assert from "node:assert/strict";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, ToolExecutionComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";

import factory from "../index.ts";
import { resetNow } from "../src/process/now.ts";
import { headerLine } from "../src/process/render.ts";
import { rebuild, state, tickHeaders } from "../src/process/state.ts";

initTheme("dark", "ziye");

let clock = 1_000_000;
Date.now = () => clock;
const tick = (ms) => {
	clock += ms;
};

const handlers = new Map();
const commands = new Map();
const entries = [];

const pi = {
	on(event, handler) {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
		return () => {};
	},
	registerCommand(name, options) {
		commands.set(name, options);
	},
	appendEntry(type, data) {
		entries.push({ type, data });
	},
	getThinkingLevel() {
		return "max";
	},
	registerEntryRenderer() {},
};

const footerFactories = [];
const widgets = new Map();
const theme = { name: "ziye", fg: (_c, text) => text, bold: (text) => text };

let branch = [];
const ctx = {
	mode: "tui",
	hasUI: true,
	cwd: "/tmp/project",
	sessionManager: { getBranch: () => branch },
	model: { provider: "qwen-token-plan-2", id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
	getContextUsage: () => ({ percent: 12.3, tokens: 123000, contextWindow: 1_000_000 }),
	ui: {
		theme,
		notify() {},
		setFooter(factory) {
			footerFactories.push(factory);
		},
		setWidget(key, value) {
			widgets.set(key, value);
		},
		setToolsExpanded(value) {
			ctx.expanded = value;
		},
	},
};

const emit = (event, payload = {}) => {
	for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
};
const assistant = (timestamp, content, extra = {}) => ({
	role: "assistant",
	timestamp,
	content,
	stopReason: "stop",
	...extra,
});
const newAssistant = () => {
	const component = new AssistantMessageComponent();
	component.hideThinkingBlock = true;
	component.markdownTheme = getMarkdownTheme();
	component.outputPad = 1;
	return component;
};
const newTool = (id, name, args) =>
	new ToolExecutionComponent(name, id, args, undefined, undefined, { requestRender() {} }, "/tmp/project");

factory(pi);
assert.ok(commands.has("ui"), "registers /ui");
assert.ok(commands.has("process"), "registers /process");
assert.ok(Object.getOwnPropertySymbols(AssistantMessageComponent.prototype).length > 0, "assistant patched");
assert.ok(Object.getOwnPropertySymbols(ToolExecutionComponent.prototype).length > 0, "tool patched");

emit("session_start");
assert.ok(footerFactories.some(Boolean), "footer installed");

// A. A pure text answer must not create a run, and must not grow a Process header.
const plain = assistant(1000, [{ type: "text", text: "All set." }]);
emit("message_start", { message: plain });
tick(400);
emit("message_end", { message: plain });
assert.equal(state.runs.size, 0, "no run for a text-only answer");
const plainComponent = newAssistant();
plainComponent.updateContent(plain);
const plainLines = plainComponent.render(80).filter((line) => line.trim());
assert.ok(!plainLines.some((line) => line.includes("Process")), "no Process header for a text-only answer");
console.log("A ok:", plainLines.map((line) => line.trim()));

// B. Thinking: duration is first delta → last delta, not the whole message.
const thoughtMessage = assistant(2000, [
	{ type: "thinking", thinking: "comparing both diffs" },
	{ type: "text", text: "Fixed: a.ts was missing an await." },
]);
emit("message_start", { message: thoughtMessage });
tick(200); // message_start → first delta: must not count
emit("message_update", { message: thoughtMessage, assistantMessageEvent: { type: "thinking_delta", delta: "comparing " } });
tick(400);
emit("message_update", { message: thoughtMessage, assistantMessageEvent: { type: "thinking_delta", delta: "both diffs" } });
tick(400); // message keeps going after the thought
emit("message_end", { message: thoughtMessage });
const thought = entries.find((entry) => entry.type === "pi-ui-teacat-thought");
assert.deepEqual(thought?.data, { ts: 2000, ms: 400 }, "thinking duration covers the deltas only");
const thoughtComponent = newAssistant();
thoughtComponent.updateContent(thoughtMessage);
const collapsed = thoughtComponent.render(80).filter((line) => line.trim());
assert.ok(collapsed.some((line) => line.includes("1 thought")), "header counts the thought");
assert.ok(!collapsed.some((line) => line.includes("comparing")), "thinking hidden while folded");
console.log("B ok:", collapsed.map((line) => line.trim()));

// B ends: a settled run is closed, so the next message starts a fresh block.
emit("agent_settled", {});
assert.equal(state.current, undefined, "settled run is not current");

// C. Tool-only message: header drawn by that message, row folded, expanded row keeps args.
const toolMessage = assistant(3000, [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/tmp/project/src/a.ts" } }]);
emit("message_start", { message: toolMessage });
emit("message_end", { message: toolMessage });
emit("tool_execution_start", { toolCallId: "call-1", toolName: "read", args: { path: "/tmp/project/src/a.ts" } });
tick(500);
emit("tool_execution_end", {
	toolCallId: "call-1",
	toolName: "read",
	result: { content: [{ type: "text", text: "line1\nline2\nline3" }] },
	isError: false,
});
const toolMessageComponent = newAssistant();
toolMessageComponent.updateContent(toolMessage);
const toolHeader = toolMessageComponent.render(80).filter((line) => line.trim());
assert.ok(toolHeader.some((line) => line.includes("1 tool")), "tool-only message owns the header");
const tool = newTool("call-1", "read", { path: "/tmp/project/src/a.ts" });
tool.updateResult({ content: [{ type: "text", text: "line1\nline2\nline3" }], isError: false });
assert.deepEqual(tool.render(80), [], "folded row takes no rows");
tool.setExpanded(true);
const rows = tool.render(80);
assert.equal(rows.length, 1, "one row when unfolded");
assert.ok(rows[0].includes("3 lines"), "row shows the outcome");
console.log("C ok:", rows[0].trim());

const clickLine = async (component, match) => {
	const lines = component.render(80);
	const y = lines.findIndex((line) => match(line));
	assert.ok(y >= 0, "the row is on screen");
	const result = component.handleMouse({ y, x: 0, width: 80, height: lines.length, type: "click", button: "left" });
	assert.equal(result?.handled, true, "the click is handled");
	await Promise.resolve();
};

// D. Expanded assistant: the thinking row is one line until a click opens its text.
await Promise.resolve();
thoughtComponent.invalidate();
const expandedAssistant = thoughtComponent.render(80).filter((line) => line.trim());
console.log("D ok:", expandedAssistant.map((line) => line.trim()));
assert.ok(expandedAssistant.some((line) => line.includes("thinking 400ms")), "thinking row carries the duration");
assert.ok(expandedAssistant.some((line) => line.includes("▸ thinking")), "the closed row says it can be opened");
const textLines = (component, text) => component.render(80).filter((line) => line.includes(text)).length;
const closedRow = expandedAssistant.filter((line) => line.includes("thinking 400ms"));
assert.equal(closedRow.length, 1, "a closed thought is exactly one row");
assert.ok(closedRow[0].includes("comparing both diffs"), "the closed row previews its text inline");
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 1, "the text appears once, in the row");
await clickLine(thoughtComponent, (line) => line.includes("thinking 400ms"));
const openThought = thoughtComponent.render(80).filter((line) => line.trim());
assert.ok(openThought.some((line) => line.includes("▾ thinking")), "a click opens the row");
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 2, "and draws the text under it");
console.log("D2 ok:", openThought.map((line) => line.trim()));
// D2b. The open text is a target of its own: no need to aim at the row's `▾`.
const openLines = thoughtComponent.render(80);
const bodyIndex = openLines.findLastIndex((line) => line.includes("comparing both diffs"));
assert.ok(bodyIndex > 0, "the text is drawn below its row");
const bodyClick = thoughtComponent.handleMouse({ y: bodyIndex, x: 0, width: 80, height: openLines.length, type: "click", button: "left" });
assert.equal(bodyClick?.handled, true, "a click on the text is handled");
await Promise.resolve();
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 1, "clicking the text closes it");
const afterBody = thoughtComponent.render(80).filter((line) => line.trim());
assert.ok(afterBody.some((line) => line.includes("▾ Process")), "the block itself stays open");
await clickLine(thoughtComponent, (line) => line.includes("thinking 400ms"));
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 2, "the row still opens the body");
await clickLine(thoughtComponent, (line) => line.includes("thinking 400ms"));
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 1, "a second click closes the body");

// D3. Folding the whole block also closes a thinking row opened by hand.
await clickLine(thoughtComponent, (line) => line.includes("thinking 400ms"));
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 2, "open again");
await commands.get("process").handler(undefined, ctx);
await commands.get("process").handler(undefined, ctx);
assert.equal(textLines(thoughtComponent, "comparing both diffs"), 1, "folding closes the row");

// E. Now row while a tool runs; gone after settle.
emit("message_start", { message: assistant(3100, []) });
tick(50);
emit("tool_execution_start", { toolCallId: "call-2", toolName: "bash", args: { command: "npm test" } });
const widgetFactory = widgets.get("pi-ui-teacat-now");
assert.ok(widgetFactory, "Now widget mounted while a tool runs");
const widget = widgetFactory({ requestRender() {} }, theme);
const nowLines = widget.render(80);
assert.equal(nowLines.length, 2, "the default open row lists the running tool");
assert.ok(nowLines[0]?.includes("Now") && nowLines[0].includes("1 tool"), "the heading counts the running tool");
assert.ok(nowLines[1].includes("bash") && nowLines[1].includes("npm test"), "and its row names it");
console.log("E ok:", nowLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim()));
emit("agent_settled", {});
assert.deepEqual(widget.render(80), [], "Now disappears when idle");
assert.equal(state.rows.get("call-2").status, "cancelled", "interrupted tool closes as cancelled");

// F. Footer: provider · model · thinking · speed · context bar + tokens, provider drops first.
const footerFactory = footerFactories.filter(Boolean).at(-1);
const footer = footerFactory({ requestRender() {} }, theme);
assert.ok(state.tui, "the footer hands its TUI to the process layer");
const wide = footer.render(120)[0];
console.log("F ok:", wide);
for (const part of ["Qwen Token Plan 2", "DeepSeek V4.1 Flash", "max", "123k/1M"]) {
	assert.ok(wide.includes(part), `footer shows ${part}`);
}
assert.ok(!wide.includes("%"), "the bar carries the percentage, the number is not repeated");
assert.equal(visibleWidth(wide), 120, "the context segment is pinned to the right edge");
assert.ok(wide.endsWith("123k/1M"), "and it is the last thing on the line");
const narrow = footer.render(36)[0];
console.log("F narrow:", narrow);
assert.ok(!narrow.includes("Qwen Token Plan 2"), "provider drops first");
assert.ok(narrow.includes("DeepSeek V4.1 Flash"), "model stays");
assert.ok(narrow.includes("123k/1M"), "the token counts survive");
assert.ok(narrow.length <= 36, "no line wider than the terminal");

// G. Rebuild: history keeps counts, args, outcomes and persisted durations.
branch = [
	{ type: "message", message: { role: "user", timestamp: 5000, content: [{ type: "text", text: "hi" }] } },
	{
		type: "message",
		message: assistant(5100, [
			{ type: "thinking", thinking: "hmm" },
			{ type: "toolCall", id: "call-3", name: "edit", arguments: { path: "/tmp/project/src/b.ts", edits: [{ oldText: "a", newText: "b" }] } },
		]),
	},
	{ type: "message", message: { role: "toolResult", toolCallId: "call-3", content: [{ type: "text", text: "ok" }], details: { diff: "+1\n-1" } } },
	{ type: "custom", customType: "pi-ui-teacat-thought", data: { ts: 5100, ms: 2500 } },
];
emit("session_start");
const rebuilt = state.runs.get(5100);
assert.ok(rebuilt, "run rebuilt from the branch");
assert.equal(rebuilt.thoughts.length, 1, "one thought rebuilt");
assert.equal(rebuilt.thoughts[0].durationMs, 2500, "persisted duration used");
const rebuiltRow = rebuilt.tools.get("call-3");
assert.equal(rebuiltRow.status, "success", "tool result applied");
assert.ok(rebuiltRow.outcome.includes("+1 −1"), `edit outcome uses real args: ${rebuiltRow.outcome}`);
const rebuiltHeader = newAssistant();
rebuiltHeader.updateContent(assistant(5100, [{ type: "thinking", thinking: "hmm" }]));
const rebuiltLines = rebuiltHeader.render(80).filter((line) => line.trim());
assert.ok(rebuiltLines.some((line) => line.includes("1 thought") && line.includes("1 tool")), "rebuilt header counts both");
console.log("G ok:", rebuiltLines.map((line) => line.trim()));

// G2. A resumed tool-only message is no thought, and its rows keep duration and end.
const toolOnly = [
	{ type: "message", message: { role: "user", timestamp: 5200, content: [{ type: "text", text: "go" }] } },
	{ type: "message", message: assistant(5300, [{ type: "toolCall", id: "call-g2a", name: "bash", arguments: { command: "ls" } }], { durationMs: 600, stopReason: "toolUse" }) },
	{ type: "message", message: { role: "toolResult", toolCallId: "call-g2a", toolName: "bash", timestamp: 5900, durationMs: 120, content: [{ type: "text", text: "ok" }] } },
	{ type: "message", message: assistant(6000, [{ type: "toolCall", id: "call-g2b", name: "bash", arguments: { command: "pwd" } }], { durationMs: 500, stopReason: "toolUse" }) },
	{ type: "message", message: assistant(6700, [{ type: "text", text: "done" }], { durationMs: 300, stopReason: "stop" }) },
];
rebuild(toolOnly);
const toolOnlyRun = state.runs.get(5300);
assert.ok(toolOnlyRun, "the tool-only run is rebuilt");
assert.equal(toolOnlyRun.thoughts.length, 0, "a tool-only message adds no thought");
assert.equal(toolOnlyRun.tools.get("call-g2a").durationMs, 120, "the tool result carries its runtime");
assert.equal(toolOnlyRun.tools.get("call-g2b").outcome, "interrupted", "a call without a result is interrupted");
assert.equal(toolOnlyRun.endedAt - toolOnlyRun.startedAt, 1700, "the run ends with the answer that closed it");
const toolOnlyHeader = headerLine(toolOnlyRun, theme, 80);
assert.ok(toolOnlyHeader.includes("2 tools") && !toolOnlyHeader.includes("thought"), `tool-only header counts tools: ${toolOnlyHeader}`);
assert.ok(toolOnlyHeader.includes("1.7s"), "and keeps the resumed duration");
console.log("G2 ok:", toolOnlyHeader);
rebuild(branch);

// H. Clicking a row hands that row back to Pi, and headers do not pile up.
const clickable = newTool("call-1", "read", { path: "/tmp/project/src/a.ts" });
clickable.updateResult({ content: [{ type: "text", text: "line1\nline2" }], isError: false });
clickable.setExpanded(true);
const handled = clickable.handleMouse({ y: 0, type: "click", button: "left" });
assert.deepEqual(handled, { handled: true }, "click handled");
const opened = state.rows.get("call-1");
assert.equal(opened.open, true, "row opened");
assert.ok(clickable.render(80).length > 1, "opened row uses Pi's own detail");
clickable.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(state.rows.get("call-1").open, false, "second click folds the row");
for (let index = 0; index < 30; index++) thoughtComponent.updateContent(thoughtMessage);
assert.ok(state.headers.size <= 5, `headers stay bounded (${state.headers.size})`);
console.log("H ok");

// J. Ctrl+O reaches a run that has no tool at all: Pi toggles every child it can expand,
// so an assistant message has to answer `setExpanded` itself. A fresh session starts folded.
emit("session_start");
const chat = new Container();
const soloMessage = assistant(4000, [{ type: "thinking", thinking: "a lone thought" }]);
emit("message_start", { message: soloMessage });
tick(100);
emit("message_update", { message: soloMessage, assistantMessageEvent: { type: "thinking_delta", delta: "a lone thought" } });
emit("message_end", { message: soloMessage });
emit("agent_settled", {});
const solo = newAssistant();
solo.updateContent(soloMessage);
chat.addChild(solo);
const piToggle = (value) => {
	for (const child of chat.children) if (typeof child.setExpanded === "function") child.setExpanded(value);
};
piToggle(true);
await Promise.resolve();
const soloExpanded = solo.render(80).filter((line) => line.trim());
assert.ok(soloExpanded.some((line) => line.includes("▾ Process")), "Ctrl+O marks the block open");
assert.ok(soloExpanded.some((line) => line.includes("▸ thinking")), "Ctrl+O unfolds a run with no tool");
assert.equal(textLines(solo, "a lone thought"), 1, "its text stays closed until clicked");
await clickLine(solo, (line) => line.includes("thinking"));
assert.equal(textLines(solo, "a lone thought"), 2, "a click on the row shows the text");
console.log("J ok:", soloExpanded.map((line) => line.trim()));

// K. A tool mounting while the block is open must not fold it: Pi calls setExpanded on the
// new component before adding it, and that is not a toggle.
const late = newTool("call-late", "bash", { command: "ls" });
late.setExpanded(false);
chat.addChild(late);
assert.equal(late.render(80).length, 1, "a tool mounted later keeps the block open");
piToggle(false);
await Promise.resolve();
assert.equal(textLines(solo, "a lone thought"), 0, "Ctrl+O folds the whole block back");
assert.deepEqual(late.render(80), [], "the row folds with the block");
console.log("K ok");

// L. A click on the header line toggles the block, exactly like Ctrl+O.
const clickHeader = (component) => clickLine(component, (line) => line.includes("Process"));
await clickHeader(solo);
const clicked = solo.render(80).filter((line) => line.trim());
assert.ok(clicked.some((line) => line.includes("▾ Process")), "a header click opens the block");
assert.ok(clicked.some((line) => line.includes("▸ thinking")), "and shows the thinking row");
await clickHeader(solo);
assert.equal(textLines(solo, "a lone thought"), 0, "a second click closes the block");
console.log("L ok");

// M. With Pi drawing thinking itself there is no Process header, so rows must stay native.
const visibleThinking = new AssistantMessageComponent(thoughtMessage, false, getMarkdownTheme(), "Thinking...", 1, []);
visibleThinking.updateContent(thoughtMessage);
const nativeRow = newTool("call-1", "read", { path: "/tmp/project/src/a.ts" });
assert.ok(nativeRow.render(80).length > 0, "a folded row stays visible when Pi draws thinking itself");
const hiddenAgain = newAssistant();
hiddenAgain.updateContent(thoughtMessage);
assert.deepEqual(nativeRow.render(80), [], "and it folds again once thinking is hidden");
console.log("M ok");

// N. A tool that starts with no arguments takes its subject from the arguments that follow.
const lateArgsMessage = assistant(4200, [{ type: "toolCall", id: "call-late-args", name: "read", arguments: {} }]);
emit("message_start", { message: lateArgsMessage });
emit("tool_execution_start", { toolCallId: "call-late-args", toolName: "read", args: {} });
assert.equal(state.rows.get("call-late-args").target, ".", "no subject yet");
emit("tool_execution_update", { toolCallId: "call-late-args", args: { path: "/tmp/project/src/c.ts" }, partialResult: { content: [] } });
assert.equal(state.rows.get("call-late-args").target, "/tmp/project/src/c.ts", "the subject arrives with the arguments");
emit("agent_settled", {});
console.log("N ok");

// O. Re-patching on reload must not stack wrappers: one more install, one click, one toggle.
const { installPatches } = await import("../src/process/patch.ts");
installPatches();
installPatches();
const reloaded = newAssistant();
reloaded.updateContent(soloMessage);
await clickHeader(reloaded);
assert.ok(reloaded.render(80).some((line) => line.includes("▾ Process")), "a click after re-patching opens once");
await clickHeader(reloaded);
assert.ok(!reloaded.render(80).some((line) => line.includes("▾ Process")), "and closes once");
console.log("O ok");

// P. Every fold path closes a row the person opened by hand: /process uses the same helper.
const manualRow = newTool("call-1", "read", { path: "/tmp/project/src/a.ts" });
manualRow.render(80);
manualRow.setExpanded(true);
await Promise.resolve();
manualRow.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(state.rows.get("call-1").open, true, "clicking a row opens it");
await commands.get("process").handler(undefined, ctx);
assert.ok(!state.rows.get("call-1").open, "/process closes the row again");
assert.deepEqual(manualRow.render(80), [], "and the folded row takes no rows");
console.log("P ok");

// Q. Now opens by default; a click folds it to one line, a second click opens it again.
const nowMessage = assistant(5000, [{ type: "toolCall", id: "call-q1", name: "bash", arguments: { command: "ls" } }]);
emit("message_start", { message: nowMessage });
emit("tool_execution_start", { toolCallId: "call-q1", toolName: "bash", args: { command: "ls" } });
emit("tool_execution_start", { toolCallId: "call-q2", toolName: "read", args: { path: "/tmp/project/src/a.ts" } });
const now = widgets.get("pi-ui-teacat-now")({ requestRender() {} }, theme);
const openNow = now.render(90);
assert.equal(openNow.length, 3, "Now opens by default, one row per running tool");
assert.ok(openNow[0].includes("▾ Now"), "the default row has an open marker");
assert.ok(openNow[0].includes("2 tools"), "the open heading only counts them");
assert.ok(openNow[1].includes("bash") && openNow[1].includes("ls"), "first tool named");
assert.ok(openNow[2].includes("read") && openNow[2].includes("src/a.ts"), "second tool named");
now.handleMouse({ y: 0, type: "click", button: "left" });
const foldedNow = now.render(90);
assert.equal(foldedNow.length, 1, "a click folds it to one line");
assert.ok(foldedNow[0].includes("▸ Now"), "the folded row has a closed marker");
assert.ok(foldedNow[0].includes("2 tools") && foldedNow[0].includes("+1"), "the line counts the running tools");
now.handleMouse({ y: 1, type: "click", button: "left" });
assert.equal(now.render(90).length, 1, "folded, a click below the head row does nothing");
now.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(now.render(90).length, 3, "a second click opens it again");
now.handleMouse({ y: 2, type: "click", button: "left" });
const foldedByBody = now.render(90);
assert.equal(foldedByBody.length, 1, "open, a click on a tool row folds the card");
assert.ok(foldedByBody[0].includes("▸ Now"), "and it folds to the one-line form");
now.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(now.render(90).length, 3, "the head row still opens it");
emit("agent_settled", {});
console.log("Q ok:", foldedNow[0], "→", openNow.length, "lines");

// R. Now opens by default on a streaming thought: with no tool beside it the text fills the card.
resetNow();
const nineThought = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].join("\n");
const thoughtNow = assistant(6000, [{ type: "thinking", thinking: nineThought }]);
emit("message_start", { message: thoughtNow });
emit("message_update", { message: thoughtNow, assistantMessageEvent: { type: "thinking_delta", delta: nineThought } });
const thinkingNow = widgets.get("pi-ui-teacat-now")({ requestRender() {} }, theme);
const thoughtLines = thinkingNow.render(90);
assert.equal(thoughtLines.length, 9, "heading, thinking row and seven lines of text");
assert.ok(thoughtLines[0].includes("▾ Now"), "the thought row opens by default");
assert.ok(thoughtLines[1].includes("thinking"), "the heading names the thought");
assert.ok(thoughtLines.some((line) => line.includes("nine")), "the newest line is shown");
assert.ok(!thoughtLines.some((line) => line.includes("two")), "older lines beyond seven are dropped");
thinkingNow.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(thinkingNow.render(90).length, 1, "a click folds the thought back to one line");
console.log("R ok:", thoughtLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim()));
emit("agent_settled", {});
assert.deepEqual(thinkingNow.render(90), [], "Now disappears when idle");
resetNow();

// R2. A taller window gives the open row more lines: the thought grows to twelve.
const tallTui = { requestRender() {}, terminal: { rows: 40 } };
const tallThought = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"].join("\n");
const tallMessage = assistant(6600, [{ type: "thinking", thinking: tallThought }]);
emit("message_start", { message: tallMessage });
emit("message_update", { message: tallMessage, assistantMessageEvent: { type: "thinking_delta", delta: tallThought } });
const tallNow = widgets.get("pi-ui-teacat-now")(tallTui, theme);
const tallLines = tallNow.render(90);
assert.equal(tallLines.length, 14, "heading, thinking row and twelve lines of text");
assert.ok(tallLines.some((line) => line.includes("three")), "twelve lines reach back to three");
assert.ok(!tallLines.some((line) => line.includes("two")), "older lines beyond twelve are dropped");
console.log("R2 ok:", tallLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim()));
// R2b. A 24-row window keeps two heading rows plus ten thought rows.
const shortTui = { requestRender() {}, terminal: { rows: 24 } };
const shortNow = widgets.get("pi-ui-teacat-now")(shortTui, theme);
const shortLines = shortNow.render(90);
assert.equal(shortLines.length, 12, "heading, thinking row and ten lines of text in 24 rows");
const shortWords = shortLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim());
assert.ok(shortWords.includes("five"), "ten lines reach back to five");
assert.ok(!shortWords.includes("four"), "older lines beyond ten are dropped");
console.log("R2b ok:", shortLines.length, "lines");
// R2c. A 21-row window still spends its whole card on the thought: seven text rows.
const shallowTui = { requestRender() {}, terminal: { rows: 21 } };
const shallowNow = widgets.get("pi-ui-teacat-now")(shallowTui, theme);
const shallowLines = shallowNow.render(90);
assert.equal(shallowLines.length, 9, "heading, thinking row and seven lines of text in 21 rows");
const shallowWords = shallowLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim());
assert.ok(shallowWords.includes("eight"), "seven lines reach back to eight");
assert.ok(!shallowWords.includes("seven"), "older lines beyond seven are dropped");
console.log("R2c ok:", shallowLines.length, "lines");
// R2d. A thought streaming beside two tools keeps three rows and leaves them one each.
emit("tool_execution_start", { toolCallId: "call-r2d-1", toolName: "bash", args: { command: "ls 1" } });
emit("tool_execution_start", { toolCallId: "call-r2d-2", toolName: "bash", args: { command: "ls 2" } });
emit("message_update", { message: tallMessage, assistantMessageEvent: { type: "thinking_delta", delta: "e\nf\ng\nh" } });
const besideNow = widgets.get("pi-ui-teacat-now")(shallowTui, theme);
const besideLines = besideNow.render(90);
assert.equal(besideLines.length, 7, "heading, two tool rows, thinking row and three text rows in 21 rows");
const besideWords = besideLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim());
assert.ok(besideWords.includes("f") && besideWords.includes("h"), "three text rows behind the tools");
assert.ok(!besideWords.includes("e"), "the text still stops at three rows beside tools");
console.log("R2d ok:", besideLines.length, "lines");
emit("agent_settled", {});
resetNow();

// R3. Their own cap holds a burst of parallel tools; the ones that do not fit are counted.
const burstMessage = assistant(6750, [{ type: "toolCall", id: "call-r0", name: "bash", arguments: { command: "ls 0" } }]);
emit("message_start", { message: burstMessage });
for (let index = 0; index < 40; index += 1)
	emit("tool_execution_start", { toolCallId: `call-r${index}`, toolName: "bash", args: { command: `ls ${index}` } });
const manyNow = widgets.get("pi-ui-teacat-now")(tallTui, theme);
const manyLines = manyNow.render(90);
assert.equal(manyLines.length, 24, "the cap keeps the open row to twenty-four lines");
assert.ok(manyLines[23].includes("+17 more tools"), "tools that do not fit are counted on the last row");
assert.ok(manyLines.some((line) => line.includes("ls 21")), "the tools that fit are listed");
console.log("R3 ok:", manyLines[1], "→", manyLines[23], "(", manyLines.length, "lines )");

// S. Folding one open tool row must not fold the block: Pi's own region jumps at the click.
const rowMessage = assistant(7000, [{ type: "toolCall", id: "call-s", name: "bash", arguments: { command: "ls" } }]);
emit("message_start", { message: rowMessage });
emit("tool_execution_start", { toolCallId: "call-s", toolName: "bash", args: { command: "ls" } });
emit("tool_execution_end", { toolCallId: "call-s", toolName: "bash", result: { content: [{ type: "text", text: "a\nb" }] }, isError: false });
const { isExpanded } = await import("../src/process/render.ts");
const rowComponent = newTool("call-s", "bash", { command: "ls" });
rowComponent.updateResult({ content: [{ type: "text", text: "a\nb" }], isError: false });
rowComponent.setExpanded(false);
await Promise.resolve();
rowComponent.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(state.rows.get("call-s").open, true, "a click opens the row");
assert.ok(rowComponent.render(80).length > 1, "the row shows Pi's own detail");
// The second click lands in the detail, not on line 0.
rowComponent.handleMouse({ y: 1, type: "click", button: "left" });
assert.equal(state.rows.get("call-s").open, false, "a click in the detail closes that row");
assert.equal(isExpanded(), true, "the block itself stays open");
assert.equal(rowComponent.render(80).length, 1, "the row is a single summary line again");
rowComponent.handleMouse({ y: 0, type: "click", button: "left" });
assert.equal(state.rows.get("call-s").open, true, "and it opens again");
emit("agent_settled", {});
console.log("S ok");

// T. The closed thinking row carries a preview: one line, tail of the text, dropped when narrow.
const longThought = [
	"first I open the file and look at the imports",
	"then I check whether the await is missing",
	"finally I write the fix into a.ts",
].join("\n");
const previewMessage = assistant(8000, [
	{ type: "thinking", thinking: longThought },
	{ type: "text", text: "Done." },
]);
emit("message_start", { message: previewMessage });
emit("message_update", { message: previewMessage, assistantMessageEvent: { type: "thinking_delta", delta: longThought } });
emit("message_end", { message: previewMessage });
emit("agent_settled", {});
const previewAssistant = newAssistant();
previewAssistant.updateContent(previewMessage);
const previewLines = previewAssistant.render(90).filter((line) => line.trim());
const previewRow = previewLines.filter((line) => line.includes("thinking"));
assert.equal(previewRow.length, 1, "one row, preview or not");
assert.ok(previewRow[0].includes("finally I write the fix"), "the preview shows the newest line");
assert.ok(!previewRow[0].includes("first I open the file"), "older text stays out of the row");
assert.ok(visibleWidth(previewRow[0]) <= 90, "the row fits the terminal");
const narrowLines = previewAssistant.render(26).filter((line) => line.trim());
const narrowRow = narrowLines.find((line) => line.includes("thinking"));
assert.ok(narrowRow.includes("thinking"), "the title survives a narrow terminal");
assert.ok(!narrowRow.includes(" · "), "so narrow that the preview is dropped, separator and all");
assert.ok(visibleWidth(narrowRow) <= 26, "no line wider than the terminal");
console.log("T ok:", previewRow[0].trim(), "|", narrowRow.trim());

// U. Only the run that changed is redrawn: a settled block keeps its cache, a live one does not.
const counts = new Map();
const spy = (component, key) => {
	const real = component.invalidate.bind(component);
	component.invalidate = () => {
		counts.set(key, (counts.get(key) ?? 0) + 1);
		real();
	};
};
const liveMessage = assistant(9000, [{ type: "toolCall", id: "call-u1", name: "bash", arguments: { command: "ls" } }]);
emit("message_start", { message: liveMessage });
emit("tool_execution_start", { toolCallId: "call-u1", toolName: "bash", args: { command: "ls" } });
const liveComponent = newAssistant();
liveComponent.updateContent(liveMessage);
spy(liveComponent, "live");
const liveHeader = liveComponent.render(90).filter((line) => line.trim());
assert.ok(liveHeader.some((line) => line.includes("1 tool")), "the header counts the first tool");
// Second tool in the same run: the reused component must redraw without help.
emit("tool_execution_start", { toolCallId: "call-u2", toolName: "read", args: { path: "/tmp/project/src/a.ts" } });
assert.ok((counts.get("live") ?? 0) >= 1, "the live run's component is invalidated");
await new Promise((resolve) => setTimeout(resolve, 5));
const afterSecond = liveComponent.render(90).filter((line) => line.trim());
assert.ok(afterSecond.some((line) => line.includes("2 tools")), "and the header picks the second tool up");
emit("agent_settled", {});
counts.set("live", 0);
// Events of a later run must leave the settled block alone (its rows cannot change any more).
const nextMessage = assistant(9100, [{ type: "toolCall", id: "call-u3", name: "bash", arguments: { command: "pwd" } }]);
emit("message_start", { message: nextMessage });
emit("tool_execution_start", { toolCallId: "call-u3", toolName: "bash", args: { command: "pwd" } });
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(counts.get("live"), 0, "a settled block is not rebuilt by a later run");
emit("agent_settled", {});
console.log("U ok:", afterSecond.map((line) => line.trim()));

// V. Thinking deltas repaint at most once per STREAM_PAINT_MS, not per token.
const paint = { count: 0, requestRender() { this.count += 1; } };
footerFactory(paint, theme);
const before = paint.count;
const busy = assistant(9500, [{ type: "thinking", thinking: "x" }]);
emit("message_start", { message: busy });
for (let index = 0; index < 40; index++) {
	emit("message_update", { message: busy, assistantMessageEvent: { type: "thinking_delta", delta: `t${index} ` } });
}
assert.ok(paint.count - before <= 2, `forty deltas cause at most two repaints (${paint.count - before})`);
tick(150);
emit("message_update", { message: busy, assistantMessageEvent: { type: "thinking_delta", delta: "later" } });
assert.ok(paint.count - before >= 1, "a delta after the window repaints again");
emit("agent_settled", {});
console.log("V ok:", paint.count - before, "repaints for 41 deltas");

// W. The context segment stays pinned to the right edge even when the left side is short.
const { default: registerFooterPart } = await import("../src/footer.ts");
const footerPi = { getThinkingLevel: () => "max" };
const shortFooter = registerFooterPart(footerPi);
const shortCtx = {
	mode: "tui",
	model: { provider: "ollama", name: "m" },
	getContextUsage: () => ({ percent: 50, tokens: 500, contextWindow: 1000 }),
	ui: { setFooter(factory) { shortCtx.factory = factory; } },
};
shortFooter.apply(shortCtx, true);
const shortLine = shortCtx.factory({ requestRender() {} }, theme).render(40)[0];
console.log("W ok:", JSON.stringify(shortLine));
assert.equal(visibleWidth(shortLine), 40, "the line fills the width");
assert.ok(shortLine.endsWith("500/1k"), "the context segment sits on the right edge");
assert.ok(shortLine.startsWith("Ollama"), "the left group starts at the left edge");
shortFooter.stop();

// X. The ticker repaints the header line only: the duration stays live, nothing else rebuilds.
const tickMessage = assistant(9200, [{ type: "toolCall", id: "call-x", name: "bash", arguments: { command: "ls" } }]);
emit("message_start", { message: tickMessage });
emit("tool_execution_start", { toolCallId: "call-x", toolName: "bash", args: { command: "ls" } });
const tickComponent = newAssistant();
tickComponent.updateContent(tickMessage);
const headerOf = (component) => component.render(90).find((line) => line.includes("Process"));
const firstHeader = headerOf(tickComponent);
spy(tickComponent, "ticker");
tick(1500);
tickHeaders();
assert.equal(counts.get("ticker") ?? 0, 0, "the ticker does not rebuild the message component");
const secondHeader = headerOf(tickComponent);
assert.notEqual(secondHeader, firstHeader, "but the header line is redrawn");
assert.ok(secondHeader.includes("1.5s"), `the duration moved on (${secondHeader.trim()})`);
emit("agent_settled", {});
console.log("X ok:", firstHeader.trim(), "→", secondHeader.trim());

// Y. A footer frame must not re-read the whole session: the snapshot is cached briefly.
let usageCalls = 0;
const cacheFooter = (await import("../src/footer.ts")).default({ getThinkingLevel: () => "max" });
const countedCtx = {
	mode: "tui",
	model: { provider: "ollama", name: "m" },
	getContextUsage: () => {
		usageCalls += 1;
		return { percent: 10, tokens: 100, contextWindow: 1000 };
	},
	ui: {
		setFooter(factory) {
			countedCtx.factory = factory;
		},
	},
};
cacheFooter.apply(countedCtx, true);
const cachedLine = countedCtx.factory({ requestRender() {} }, theme);
for (let index = 0; index < 20; index++) cachedLine.render(60);
assert.equal(usageCalls, 1, `twenty frames read the session once (${usageCalls})`);
tick(250);
cachedLine.render(60);
assert.equal(usageCalls, 2, "after the window it reads again");
cacheFooter.stop();
console.log("Y ok:", usageCalls, "reads for 21 frames");

// Y2. A refresh (message_end) drops the snapshot so the exact rate is on the next frame.
let refreshCalls = 0;
const refreshFooter = (await import("../src/footer.ts")).default({ getThinkingLevel: () => "max" });
const refreshCtx = {
	mode: "tui",
	model: { provider: "ollama", name: "m" },
	getContextUsage: () => {
		refreshCalls += 1;
		return { percent: 10, tokens: 100, contextWindow: 1000 };
	},
	ui: { setFooter(factory) { refreshCtx.footer = factory; } },
};
refreshFooter.apply(refreshCtx, true);
const refreshedLine = refreshCtx.footer({ requestRender() {} }, theme);
refreshedLine.render(60);
assert.equal(refreshCalls, 1, "the first frame reads the session");
refreshFooter.refresh();
refreshedLine.render(60);
assert.equal(refreshCalls, 2, "a refresh reads it again on the next frame");
refreshFooter.apply(refreshCtx, false);
assert.equal(refreshCtx.footer, undefined, "turning the footer off clears it");
refreshFooter.stop();
console.log("Y2 ok:", refreshCalls, "reads across a refresh");

// Z1. Registered markdown transformers still run on the answer and on the thinking text.
const transformed = assistant(7000, [
	{ type: "thinking", thinking: "hidden reasoning" },
	{ type: "text", text: "transformed answer" },
]);
emit("message_start", { message: transformed });
emit("message_update", { message: transformed, assistantMessageEvent: { type: "thinking_delta", delta: "hidden reasoning" } });
emit("message_end", { message: transformed });
emit("agent_settled", {});
const { setBlockExpanded } = await import("../src/process/patch.ts");
setBlockExpanded(true, false);
const transformedComponent = newAssistant();
transformedComponent.markdownTransformers = [(markdown) => `[T]${markdown}`];
transformedComponent.updateContent(transformed);
const transformedLines = transformedComponent.render(90).filter((line) => line.trim());
assert.ok(transformedLines.some((line) => line.includes("[T]transformed answer")), "the answer text keeps its transformer");
await clickLine(transformedComponent, (line) => line.includes("thinking"));
const transformedOpen = transformedComponent.render(90).filter((line) => line.trim());
assert.ok(transformedOpen.some((line) => line.includes("[T]hidden reasoning")), "the thinking text keeps its transformer");
setBlockExpanded(false, false);
console.log("Z1 ok:", transformedOpen.map((line) => line.trim()));

// Z2. Pi's own end notices survive: unknown errors say so, aborts keep their message.
const errorComponent = newAssistant();
errorComponent.updateContent(assistant(7100, [{ type: "text", text: "partial" }], { stopReason: "error" }));
assert.ok(errorComponent.render(90).some((line) => line.includes("Error: Unknown error")), "an error without a message still shows one");
const abortComponent = newAssistant();
abortComponent.updateContent(assistant(7200, [{ type: "text", text: "partial" }], { stopReason: "aborted", errorMessage: "model refused" }));
assert.ok(abortComponent.render(90).some((line) => line.includes("model refused")), "an abort keeps its own message");
console.log("Z2 ok");

// I. Non-interactive modes never take the patched path.
ctx.mode = "print";
const nativeTool = newTool("call-1", "read", { path: "/tmp/project/src/a.ts" });
assert.ok(nativeTool.render(80).length > 0, "print mode falls back to Pi's own rendering");
ctx.mode = "tui";

console.log("\nOK: A–Z checks passed");