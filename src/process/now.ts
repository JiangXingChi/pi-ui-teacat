import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { formatElapsed, verbOf } from "../format.ts";
import { nowLine, nowThinkingLine, nowThoughtBody, nowToolLine, tailLine } from "./render.ts";
import { lastLineOf, state, type ToolRow } from "./state.ts";

/** Pi draws at most ten widget lines; leave one spare rather than let Pi truncate us. */
const MAX_LINES = 9;
/** How much of the streaming thought an open row shows. */
const THOUGHT_LINES = 3;

/** Open or closed is one decision for the session, so a finished run keeps what was chosen. */
let nowExpanded = false;

export function resetNow(): void {
	nowExpanded = false;
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
export function nowHeadline(view: NowView, now = Date.now(), expanded = false): string {
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

	constructor(theme: Theme) {
		this.theme = theme;
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
		const lines = [nowLine(theme, width, nowHeadline(view, now, nowExpanded), nowExpanded)];
		if (!nowExpanded) return lines;
		for (const row of view.tools) lines.push(nowToolLine(row, theme, width, now));
		if (view.thinking) {
			lines.push(nowThinkingLine(theme, width, formatElapsed(now - view.thinking.startedAt)));
			lines.push(...nowThoughtBody(view.thinking.text, theme, width, THOUGHT_LINES));
		}
		return lines.slice(0, MAX_LINES);
	}

	invalidate(): void {}
}

/** A TUI reference is enough to repaint the widget without rebuilding it. */
export function rememberTui(tui: TUI | undefined): void {
	state.tui = tui;
}