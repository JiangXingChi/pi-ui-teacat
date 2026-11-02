import { outcomeFromResult, targetOf } from "../format.ts";

export type ToolStatus = "running" | "success" | "error" | "cancelled";

export type ToolRow = {
	id: string;
	name: string;
	args?: Record<string, unknown>;
	target: string;
	status: ToolStatus;
	startedAt?: number;
	durationMs?: number;
	outcome?: string;
	/** A single row opened by a click: render Pi's own detail for it. */
	open?: boolean;
	/** The run this row was started in; components bind to it so only live rows redraw. */
	run?: Run;
};

export type Thought = {
	/** Assistant message timestamp this run of thinking belongs to. */
	ts: number;
	text: string;
	startedAt?: number;
	/** Last delta seen, so a thought that ended before the message does is not overstated. */
	lastDeltaAt?: number;
	durationMs?: number;
	/** A single row opened by a click: draw its text under the row. */
	open?: boolean;
	/** Newest non-empty line, kept up to date as deltas arrive (the row previews it). */
	lastLine?: string;
};

export type Run = {
	/** The assistant message that owns the Process header. */
	headerTs: number;
	startedAt: number;
	endedAt?: number;
	thoughts: Thought[];
	tools: Map<string, ToolRow>;
	settled?: boolean;
};

export type UiState = {
	runs: Map<number, Run>;
	/** Tool id → row, across runs, so a component can always find its data. */
	rows: Map<string, ToolRow>;
	current?: Run;
	/** Thinking text streaming right now, shown in the Now row. */
	liveThinking?: { text: string; startedAt: number; lastAt: number; lastLine: string };
	theme?: unknown;
	tui?: { requestRender(): void };
	/** Pi draws thinking itself (hideThinkingBlock off): there is no Process header, so rows stay native. */
	thinkingVisible?: boolean;
	components: Set<{ invalidate(): void }>;
	/** Header lines, repainted once a second so a long run keeps a live duration. */
	headers: Set<{ invalidate(): void }>;
	/** Assistant message timestamp → the run (its header timestamp) it belongs to. */
	messageRun: Map<number, number>;
	/** When each assistant message started, so a run's clock starts at its first message. */
	messageStarted: Map<number, number>;
};

export const state: UiState = {
	runs: new Map(),
	rows: new Map(),
	components: new Set(),
	headers: new Set(),
	messageRun: new Map(),
	messageStarted: new Map(),
};

/** Session entry holding a finished thought's duration; read back on resume. */
export const THOUGHT_ENTRY = "pi-ui-teacat-thought";
const ROW_LIMIT = 400;
const RUN_LIMIT = 60;
const COMPONENT_LIMIT = 1000;

type BranchEntry = { type?: string; customType?: string; data?: unknown; message?: any };
type BranchMessage = { role?: string; timestamp?: number; content?: unknown; toolCallId?: string; isError?: boolean; details?: unknown };

/** The newest non-empty line of a thought; the row shows it as a preview. */
export function lastLineOf(text: string): string {
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]!;
		if (line.trim()) return line;
	}
	return "";
}

/** Thinking of a message, if any; used both live and while rebuilding history. */
function thinkingOf(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((part: any) => part?.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim())
		.map((part: any) => part.thinking as string);
}

function callsOf(content: unknown): any[] {
	if (!Array.isArray(content)) return [];
	return content.filter((part: any) => part?.type === "toolCall");
}

/**
 * Rebuild the process blocks of the session so a resumed transcript looks like the live one.
 * Counts come from the messages themselves; thinking durations come from the entries this
 * extension wrote when each thought ended.
 */
export function rebuild(entries: readonly BranchEntry[]): void {
	state.runs.clear();
	state.rows.clear();
	state.messageRun.clear();
	state.messageStarted.clear();
	state.headers.clear();
	state.components.clear();
	state.thinkingVisible = undefined;
	state.current = undefined;
	state.liveThinking = undefined;

	const durations = new Map<number, number>();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === THOUGHT_ENTRY) {
			const data = entry.data as { ts?: unknown; ms?: unknown } | undefined;
			if (typeof data?.ts === "number" && typeof data.ms === "number") durations.set(data.ts, data.ms);
		}
	}

	let run: Run | undefined;
	const close = (): void => {
		if (!run) return;
		run.settled = true;
		const toolEnd = [...run.tools.values()].reduce(
			(max, row) => Math.max(max, (row.startedAt ?? 0) + (row.durationMs ?? 0)),
			run.startedAt,
		);
		const thoughtEnd = run.thoughts.reduce((max, thought) => Math.max(max, thought.ts + (thought.durationMs ?? 0)), run.startedAt);
		run.endedAt = Math.max(toolEnd, thoughtEnd, run.startedAt);
		run = undefined;
	};

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const message = entry.message as BranchMessage;
		if (message.role === "user") {
			close();
			continue;
		}
		if (message.role === "assistant") {
			const thoughts = thinkingOf(message.content);
			const calls = callsOf(message.content);
			if (!thoughts.length && !calls.length) continue;
			const ts = message.timestamp;
			if (typeof ts !== "number") continue;
			if (!run) {
				run = { headerTs: ts, startedAt: ts, thoughts: [], tools: new Map() };
				state.runs.set(ts, run);
			}
			state.messageRun.set(ts, run.headerTs);
			const durationMs = durations.get(ts);
			const existing = run.thoughts.find((thought) => thought.ts === ts);
			const text = thoughts.join("\n\n");
			if (existing) {
				existing.text = `${existing.text}\n\n${text}`;
				existing.lastLine = lastLineOf(existing.text);
			} else {
				run.thoughts.push({ ts, text, lastLine: lastLineOf(text), ...(durationMs === undefined ? {} : { durationMs }) });
			}
			for (const call of calls) {
				const name = String(call.name ?? "tool");
				const args = (call.arguments ?? {}) as Record<string, unknown>;
				const row: ToolRow = { id: String(call.id ?? ""), name, args, target: targetOf(name, args), status: "cancelled", run };
				run.tools.set(row.id, row);
				state.rows.set(row.id, row);
			}
			continue;
		}
		if (message.role === "toolResult" && run) {
			const row = run.tools.get(String(message.toolCallId ?? ""));
			if (!row) continue;
			const result = { content: message.content, details: message.details };
			const outcome = outcomeFromResult(row.name, row.args ?? {}, result, Boolean(message.isError));
			row.status = outcome.failed ? "error" : "success";
			row.outcome = outcome.outcome;
		}
	}
	close();
	trimRuns();
	trimRows();
}

function trimRows(): void {
	while (state.rows.size > ROW_LIMIT) {
		const oldest = state.rows.keys().next().value;
		if (oldest === undefined) break;
		state.rows.delete(oldest);
	}
}

function trimRuns(): void {
	while (state.runs.size > RUN_LIMIT) {
		const oldest = state.runs.keys().next().value;
		if (oldest === undefined) break;
		state.runs.delete(oldest);
		for (const [ts, headerTs] of state.messageRun) if (headerTs === oldest) state.messageRun.delete(ts);
	}
}

/** Records when a message started; the run clock starts at its first message. */
export function noteMessageStart(ts: number, now = Date.now()): void {
	state.messageStarted.set(ts, now);
	while (state.messageStarted.size > 200) {
		const oldest = state.messageStarted.keys().next().value;
		if (oldest === undefined) break;
		state.messageStarted.delete(oldest);
	}
}

/**
 * The run an assistant message belongs to. One run covers every message between
 * `agent_start` and `agent_settled`; a run starts only once a message really has
 * thinking or a tool call, so a plain answer never grows a Process block.
 */
export function ensureRunForMessage(ts: number, now = Date.now()): Run {
	const mapped = state.messageRun.get(ts);
	if (mapped !== undefined) {
		const existing = state.runs.get(mapped);
		if (existing) {
			state.current = existing;
			return existing;
		}
	}
	const live = state.current;
	if (live && !live.settled) {
		state.messageRun.set(ts, live.headerTs);
		return live;
	}
	const startedAt = state.messageStarted.get(ts) ?? now;
	const run: Run = { headerTs: ts, startedAt, thoughts: [], tools: new Map() };
	state.runs.set(ts, run);
	state.messageRun.set(ts, ts);
	state.current = run;
	trimRuns();
	return run;
}

/** The run that renders this message, or undefined when it has no process content. */
export function runForMessage(ts: number | undefined): Run | undefined {
	if (ts === undefined) return undefined;
	const headerTs = state.messageRun.get(ts);
	return headerTs === undefined ? undefined : state.runs.get(headerTs);
}

/** A thinking delta: creates the run and the thought on its first token. */
export function noteThinking(ts: number, delta: string, now = Date.now()): void {
	const run = ensureRunForMessage(ts, now);
	let thought = run.thoughts.find((item) => item.ts === ts);
	if (!thought) {
		thought = { ts, text: "", startedAt: now };
		run.thoughts.push(thought);
	}
	thought.startedAt ??= now;
	thought.lastDeltaAt = now;
	thought.text += delta;
	// Only the tail of a delta can start a new line, so the preview is updated, not re-split.
	const cut = delta.lastIndexOf("\n");
	thought.lastLine = cut === -1 ? `${thought.lastLine ?? ""}${delta}` : delta.slice(cut + 1);
	state.liveThinking ??= { text: "", startedAt: thought.startedAt, lastAt: now, lastLine: "" };
	state.liveThinking.text += delta;
	state.liveThinking.lastAt = now;
	state.liveThinking.lastLine = thought.lastLine ?? "";
}

/** Closes the thought of this message; returns the duration to persist. */
export function finishThinking(ts: number, now = Date.now()): { ts: number; ms: number } | undefined {
	const run = runForMessage(ts);
	const thought = run?.thoughts.find((item) => item.ts === ts);
	state.liveThinking = undefined;
	if (!thought) return undefined;
	const end = thought.lastDeltaAt ?? now;
	if (thought.durationMs === undefined) {
		thought.durationMs = Math.max(0, end - (thought.startedAt ?? end));
	}
	return { ts, ms: thought.durationMs };
}

export function clearLiveThinking(): void {
	state.liveThinking = undefined;
}

export function startTool(
	id: string,
	name: string,
	args: Record<string, unknown>,
	messageTs: number | undefined,
	now = Date.now(),
): ToolRow {
	const row: ToolRow = { id, name, args, target: targetOf(name, args), status: "running", startedAt: now };
	const run = messageTs === undefined ? state.current : ensureRunForMessage(messageTs, now);
	row.run = run;
	if (run && !run.settled) run.tools.set(id, row);
	state.rows.set(id, row);
	trimRows();
	return row;
}

export function finishTool(
	id: string,
	name: string,
	args: Record<string, unknown> | undefined,
	result: unknown,
	isError: boolean,
	now = Date.now(),
): ToolRow | undefined {
	const row = state.rows.get(id);
	if (!row) return undefined;
	row.args = args ?? row.args;
	row.status = isError ? "error" : "success";
	const outcome = outcomeFromResult(name, row.args ?? {}, result, isError);
	row.outcome = outcome.outcome;
	row.durationMs = row.startedAt === undefined ? undefined : Math.max(0, now - row.startedAt);
	return row;
}

/** Closes the run: whatever still runs counts as interrupted. */
export function settleRun(now = Date.now()): void {
	const run = state.current;
	state.liveThinking = undefined;
	if (!run) return;
	run.settled = true;
	run.endedAt = now;
	for (const row of run.tools.values()) {
		if (row.status === "running") {
			row.status = "cancelled";
			row.outcome ??= "interrupted";
			row.durationMs = row.startedAt === undefined ? undefined : Math.max(0, now - row.startedAt);
		}
	}
	state.current = undefined;
}

/**
 * Redraw the components that belong to one run. A settled run's rows never change again
 * (only a block toggle redraws those, and that goes through `invalidateAll`), so a tool
 * starting must not rebuild every assistant message in the transcript.
 */
export function invalidateRun(run: Run | undefined): void {
	if (!run) {
		invalidateAll();
		return;
	}
	for (const component of state.components) {
		if (componentRun.get(component) !== run) continue;
		try {
			component.invalidate();
		} catch {
			state.components.delete(component);
		}
	}
	state.tui?.requestRender();
}

/** Redraw every mounted component that shows process content, plus the Now row. */
export function invalidateAll(): void {
	for (const component of state.components) {
		try {
			component.invalidate();
		} catch {
			state.components.delete(component);
		}
	}
	state.tui?.requestRender();
}

/** Which run a mounted component draws; unbound components are redrawn by `invalidateAll`. */
const componentRun = new WeakMap<object, Run>();

/** Binds a component to a run, so `invalidateRun` can find it later. */
export function bindComponent(component: object, run: Run | undefined): void {
	if (!run || componentRun.get(component) === run) return;
	componentRun.set(component, run);
}

export function registerComponent(component: { invalidate(): void }): void {
	state.components.add(component);
	while (state.components.size > COMPONENT_LIMIT) {
		const oldest = state.components.values().next().value;
		if (!oldest) break;
		state.components.delete(oldest);
	}
}

/** The header line each message component currently draws; rebuilding drops the old one. */
const headerLineOf = new WeakMap<object, { invalidate(): void }>();

/**
 * Registers one header line, not its owner: the ticker only has to reset that line's width
 * cache, instead of rebuilding every message component (markdown and all) once a second.
 */
export function registerHeader(owner: object, line: { invalidate(): void }): void {
	const previous = headerLineOf.get(owner);
	if (previous && previous !== line) state.headers.delete(previous);
	headerLineOf.set(owner, line);
	state.headers.add(line);
	while (state.headers.size > COMPONENT_LIMIT) {
		const oldest = state.headers.values().next().value;
		if (!oldest) break;
		state.headers.delete(oldest);
	}
}

/** Repaint only the header lines; cheap enough to run once a second. */
export function tickHeaders(): void {
	for (const header of state.headers) {
		try {
			header.invalidate();
		} catch {
			state.headers.delete(header);
		}
	}
	state.tui?.requestRender();
}