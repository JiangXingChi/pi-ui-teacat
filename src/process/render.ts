import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

import { VERB_WIDTH, formatDuration, formatElapsed, joinColumns, oneLine, verbOf } from "../format.ts";
import { lastLineOf, type Run, type Thought, type ToolRow } from "./state.ts";

export const LABEL = "Process";
export const NOW_LABEL = "Now";
const INDENT = "  ";
const BRANCH = "↳ ";
/** Below this many columns a preview is noise rather than information. */
const PREVIEW_MIN = 12;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function isExpanded(): boolean {
	return expandedFlag.value;
}

const expandedFlag = { value: false };

export function setExpandedFlag(value: boolean): void {
	expandedFlag.value = value;
}

function issuesIn(run: Run): number {
	let issues = 0;
	for (const row of run.tools.values()) if (row.status === "error" || row.status === "cancelled") issues += 1;
	return issues;
}

function runMeta(run: Run, now: number, issues: number): string {
	const parts: string[] = [];
	const thoughts = run.thoughts.length;
	const tools = run.tools.size;
	if (thoughts) parts.push(plural(thoughts, "thought"));
	if (tools) parts.push(plural(tools, "tool"));
	const duration = formatDuration((run.endedAt ?? now) - run.startedAt);
	if (duration) parts.push(duration);
	if (run.settled && issues) parts.push(plural(issues, "issue"));
	return parts.join(" · ");
}

export function headerLine(run: Run, theme: Theme, width: number, now = Date.now()): string {
	const issues = issuesIn(run);
	// An open block always shows ▾, so the toggle is visible on a finished run too.
	const symbol = expandedFlag.value
		? theme.fg("accent", "▾")
		: run.settled
			? issues
				? theme.fg("warning", "!")
				: theme.fg("success", "✓")
			: theme.fg("accent", "▸");
	const label = theme.fg("text", theme.bold(LABEL));
	const meta = theme.fg("dim", runMeta(run, now, issues));
	const text = meta ? `${symbol} ${label} ${theme.fg("muted", "·")} ${meta}` : `${symbol} ${label}`;
	return truncateToWidth(text, Math.max(0, width), "…");
}

export function thinkingLine(thought: Thought, theme: Theme, width: number): string {
	const duration = formatDuration(thought.durationMs);
	const label = duration ? `thinking ${duration}` : "thinking";
	const text = thought.text.trim();
	// The marker only appears when there is text to open; an empty thought is just a row.
	const marker = text ? theme.fg("dim", thought.open ? "▾ " : "▸ ") : "";
	const head = `${theme.fg("dim", INDENT + BRANCH)}${marker}${theme.fg("thinkingText", label)}`;
	if (!text) return truncateToWidth(head, Math.max(0, width), "…");
	// A row that says only "thinking 12s" hides what it is thinking about: keep one line,
	// but let it carry the newest sentence as a preview (its tail, not its opening).
	const room = Math.max(0, width) - visibleWidth(head) - 3;
	// `lastLine` is maintained as deltas arrive; history rebuilds fill it in too. A delta that
	// is nothing but a newline leaves it empty, so fall back to reading the text.
	const newest = thought.lastLine || lastLineOf(text);
	const preview = room >= PREVIEW_MIN ? tailLine(newest, room) : "";
	if (!preview) return truncateToWidth(head, Math.max(0, width), "…");
	return truncateToWidth(`${head}${theme.fg("muted", " · ")}${theme.fg("dim", preview)}`, Math.max(0, width), "…");
}

export function toolLine(row: ToolRow, theme: Theme, width: number): string {
	const symbol = row.status === "error" ? "✕" : row.status === "cancelled" ? "◇" : row.status === "running" ? "◆" : "";
	const color = row.status === "error" ? "error" : row.status === "cancelled" ? "warning" : row.status === "running" ? "accent" : "dim";
	const verb = verbOf(row.name).padEnd(VERB_WIDTH);
	const prefix = symbol ? `${theme.fg(color, symbol)} ` : "";
	const left = `${theme.fg("dim", INDENT + BRANCH)}${prefix}${theme.fg("toolTitle", verb)}${theme.fg("dim", row.target)}`;
	const duration = formatDuration(row.status === "running" ? undefined : row.durationMs);
	const meta = [row.outcome, duration].filter(Boolean).join(" · ");
	const right = meta ? theme.fg(row.status === "error" ? "error" : "dim", meta) : "";
	return joinColumns(left, right, width, 24);
}

/** `▸ Now · read src/a.ts · 3s`, or `▾` once the row is opened. */
export function nowLine(theme: Theme, width: number, body: string, expanded = false): string {
	const label = theme.fg("accent", `${theme.bold(NOW_LABEL)}`);
	const line = `${theme.fg("accent", expanded ? "▾" : "▸")} ${label} ${theme.fg("muted", "·")} ${theme.fg("dim", body)}`;
	return truncateToWidth(line, Math.max(0, width), "…");
}

/** One running tool under an open Now row: `  ↳ ◆ bash  ls            3s`. */
export function nowToolLine(row: ToolRow, theme: Theme, width: number, now = Date.now()): string {
	const verb = verbOf(row.name).padEnd(VERB_WIDTH);
	const left = `${theme.fg("dim", INDENT + BRANCH)}${theme.fg("accent", "◆ ")}${theme.fg("toolTitle", verb)}${theme.fg("dim", row.target)}`;
	const elapsed = formatElapsed(now - (row.startedAt ?? now));
	return joinColumns(left, theme.fg("dim", elapsed), width, 24);
}

/** `  ↳ thinking 8s`, the heading above the streaming text. */
export function nowThinkingLine(theme: Theme, width: number, elapsed: string): string {
	const body = `thinking ${elapsed}`;
	return truncateToWidth(`${theme.fg("dim", INDENT + BRANCH)}${theme.fg("thinkingText", body)}`, Math.max(0, width), "…");
}

/** The last non-empty lines of a text, newest last; scans backwards instead of splitting all of it. */
export function lastLines(text: string, max: number): string[] {
	const lines: string[] = [];
	let end = text.length;
	while (end > 0 && lines.length < max) {
		const cut = text.lastIndexOf("\n", end - 1);
		const line = text.slice(cut + 1, end);
		if (line.trim()) lines.push(line);
		if (cut === -1) break;
		end = cut;
	}
	return lines.reverse();
}

/** The last lines of a streaming thought, indented under its heading. */
export function nowThoughtBody(text: string, theme: Theme, width: number, max: number): string[] {
	return lastLines(text, max).map((line) =>
		truncateToWidth(
			`${theme.fg("dim", INDENT + INDENT)}${theme.fg("thinkingText", oneLine(line))}`,
			Math.max(0, width),
			"…",
		),
	);
}

export function tailLine(text: string, max = 72): string {
	const one = text.slice(-400).replace(/\s+/g, " ").trim();
	if (visibleWidth(one) <= max) return one;
	// The suffix only grows, so the widest one that still fits can be found by halving:
	// the old loop measured a 400-char string up to 400 times per frame.
	const fits = (end: number): boolean => visibleWidth(`…${one.slice(-end)}`) <= max;
	let low = 0;
	let high = one.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (fits(middle)) low = middle;
		else high = middle - 1;
	}
	return `…${one.slice(-low)}`;
}