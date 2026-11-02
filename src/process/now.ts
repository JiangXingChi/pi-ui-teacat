import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { formatElapsed, verbOf } from "../format.ts";
import { nowLine, nowMoreLine, nowThinkingLine, nowThoughtBody, nowToolLine, tailLine } from "./render.ts";
import { lastLineOf, state, type ToolRow } from "./state.ts";

/** Smallest open row, and what an unknown terminal size falls back to. */
const MIN_LINES = 9;
/** Rows left to the header, the editor, the status line, the footer and the transcript. */
const RESERVED_ROWS = 12;
/** The ceiling: a 40-row window opens to 24 rows, a 24-row one to 12. */
const MAX_LINES = 24;
/** Most lines of the streaming thought ever shown; the rest of the budget belongs to the tools. */
const THOUGHT_MAX = 12;

/** How tall an open row may get in this window. */
function lineCap(rows: number | undefined): number {
	if (!rows) return MIN_LINES;
	return Math.max(MIN_LINES, Math.min(MAX_LINES, rows - RESERVED_ROWS));
}

/** Lines of thought text for a cap: three at the minimum height, twelve once the window is tall. */
function thoughtLines(cap: number): number {
	return Math.max(2, Math.min(THOUGHT_MAX, cap - 6));
}

/** Open by default: the detail is the point. A click folds it, and the choice holds for the session. */
let nowExpanded = true;

export function resetNow(): void {
	nowExpanded = true;
}

export type NowView = {
	/** Tools running right now, in start order. */
	tools: ToolRow[];
	thinking?: { text: string; startedAt: number; lastAt: number; lastLine: string };
};

/** What the Now row shows, or undefined when nothing runs and nothing streams. */
export function nowView(): NowView | undefined {
	const run = state.current;
	const tools = run ? [...run.tools.values()].filter((row) => row.status === "running") : [];
	const thinking = state.liveThinking;
	if (!tools.length && !thinking) return undefined;
	return { tools, thinking };
}

/** `bash ls · 3s`, `3 tools · bash ls +2 · 5s`, or — open — `2 tools · 5s` over their rows. */
export function nowHeadline(view: NowView, now = Date.now(), expanded = true): string {
	if (view.tools.length) {
		const row = view.tools[0]!;
		const since = Math.min(...view.tools.map((tool) => tool.startedAt ?? now));
		const elapsed = formatElapsed(now - since);
		const count = view.tools.length;
		// Open, the rows below say which tool and how long: the heading only counts them.
		if (expanded) return `${count} ${count === 1 ? "tool" : "tools"} · ${elapsed}`;
		return count === 1
			? `${verbOf(row.name)} ${row.target} · ${elapsed}`
			: `${count} tools · ${verbOf(row.name)} ${row.target} +${count - 1} · ${elapsed}`;
	}
	const thinking = view.thinking!;
	const elapsed = formatElapsed(now - thinking.startedAt);
	if (expanded) return `thinking · ${elapsed}`;
	const tail = tailLine(thinking.lastLine || lastLineOf(thinking.text), 60);
	return tail ? `thinking · ${elapsed} …${tail}…` : `thinking · ${elapsed}`;
}

export class NowWidget implements Component {
	private theme: Theme;
	private tui: TUI | undefined;

	constructor(theme: Theme, tui?: TUI) {
		this.theme = theme;
		this.tui = tui;
	}

	/** A left click on the head row opens the list; a second click closes it. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event?.type !== "click" || event?.button !== "left" || event?.y !== 0) return undefined;
		nowExpanded = !nowExpanded;
		state.tui?.requestRender();
		return { handled: true };
	}

	render(width: number): string[] {
		const view = nowView();
		if (!view) return [];
		const theme = (state.theme as Theme | undefined) ?? this.theme;
		const now = Date.now();
		const cap = lineCap(this.tui?.terminal?.rows);
		const lines = [nowLine(theme, width, nowHeadline(view, now, nowExpanded), nowExpanded)];
		if (!nowExpanded) return lines;
		// The thought keeps its rows whatever runs beside it; the tools take what is left. Otherwise
		// a burst of parallel calls would push the thought out of the row it is opened for.
		const body = view.thinking ? nowThoughtBody(view.thinking.text, theme, width, thoughtLines(cap)) : [];
		const thoughtRows = view.thinking ? 1 + body.length : 0;
		const toolBudget = Math.max(0, cap - 1 - thoughtRows);
		const hidden = Math.max(0, view.tools.length - toolBudget);
		// A hidden tool is worth one row of its own saying how many: the count is the information.
		const shown = view.tools.slice(0, hidden ? Math.max(0, toolBudget - 1) : view.tools.length);
		for (const row of shown) lines.push(nowToolLine(row, theme, width, now));
		if (hidden && toolBudget > 0) lines.push(nowMoreLine(hidden, theme, width));
		if (view.thinking) {
			lines.push(nowThinkingLine(theme, width, formatElapsed(now - view.thinking.startedAt)));
			lines.push(...body);
		}
		return lines;
	}

	invalidate(): void {}
}

/** A TUI reference is enough to repaint the widget without rebuilding it. */
export function rememberTui(next: TUI | undefined): void {
	state.tui = next;
}