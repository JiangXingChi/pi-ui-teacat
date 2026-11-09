import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Settings } from "../settings.ts";
import { targetOf } from "../format.ts";
import { NowWidget, nowView, rememberTui, resetNow } from "./now.ts";
import { configurePatches, installPatches, setBlockExpanded } from "./patch.ts";
import { isExpanded } from "./render.ts";
import { THOUGHT_ENTRY, type Run } from "./state.ts";
import {
	clearLiveThinking,
	finishThinking,
	finishTool,
	invalidateAll,
	invalidateRun,
	noteMessageStart,
	noteThinking,
	rebuild,
	runForMessage,
	settleRun,
	startTool,
	state,
	tickHeaders,
} from "./state.ts";

const NOW_WIDGET = "pi-ui-teacat-now";
/** Tokens arrive faster than a terminal can redraw; ten frames a second is plenty. */
const STREAM_PAINT_MS = 100;

export type ProcessPart = {
	apply(ctx: ExtensionContext): void;
	stop(ctx: ExtensionContext): void;
};

/**
 * Process folding. Patches are installed once, at load; they only act while the
 * Process switch is on and the session is interactive.
 */
export default function registerProcess(pi: ExtensionAPI, getSettings: () => Settings): ProcessPart {
	installPatches();
	let widget: NowWidget | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let context: ExtensionContext | undefined;
	/** Last time a streaming delta was painted; deltas arrive many times per second. */
	let streamPaintedAt = 0;
	/** The assistant message whose tools are still running; tools attach to its run. */
	let activeMessageTs: number | undefined;

	configurePatches({
		enabled: () => Boolean(context && context.mode === "tui" && getSettings().process),
		expand: (value: boolean) => {
			// `setBlockExpanded` schedules one redraw of everything; Pi's own sweep only
			// repeats the same value back to us, so nothing else has to happen here.
			setBlockExpanded(value);
			context?.ui.setToolsExpanded(value);
		},
	});

	/** Mounts or removes the Now widget; a delta must never be what keeps it off screen. */
	const ensureNow = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		const view = getSettings().now ? nowView() : undefined;
		if (!view) {
			if (widget) {
				ctx.ui.setWidget(NOW_WIDGET, undefined);
				widget = undefined;
			}
			return;
		}
		if (widget) return;
		ctx.ui.setWidget(
			NOW_WIDGET,
			(tui, theme) => {
				rememberTui(tui);
				widget = new NowWidget(theme, tui);
				return widget;
			},
			{ placement: "aboveEditor" },
		);
	};

	const refreshNow = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		ensureNow(ctx);
		state.tui?.requestRender();
	};

	/** Streaming text arrives per token: redraw the row at most once per frame window. */
	const paintStream = (ctx: ExtensionContext, run: Run | undefined): void => {
		if (ctx.mode !== "tui") return;
		ensureNow(ctx);
		const now = Date.now();
		if (now - streamPaintedAt < STREAM_PAINT_MS) return;
		streamPaintedAt = now;
		if (run) invalidateRun(run);
		else state.tui?.requestRender();
	};

	pi.registerCommand("process", {
		description: "Fold or unfold the Process block.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (!getSettings().process) {
				ctx.ui.notify("Process is off. Turn it on in /ui.", "info");
				return;
			}
			setBlockExpanded(!isExpanded(), false);
			ctx.ui.setToolsExpanded(isExpanded());
			invalidateAll();
			ctx.ui.notify(isExpanded() ? "Process unfolded." : "Process folded.", "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		activeMessageTs = undefined;
		state.theme = ctx.ui.theme;
		rebuild(ctx.sessionManager.getBranch() as never);
		if (ctx.mode !== "tui") return;
		ctx.ui.setToolsExpanded(false);
		setBlockExpanded(false, false);
		resetNow();
		widget = undefined;
		streamPaintedAt = 0;
		ticker ??= setInterval(() => {
			// A theme switch has no event; pick it up on the next tick.
			if (context) state.theme = context.ui.theme;
			// The block's clock and the Now row's seconds are independent switches.
			if (getSettings().process && state.current) {
				tickHeaders();
				return;
			}
			if (getSettings().now && state.tui && nowView()) state.tui.requestRender();
		}, 1000);
		ticker.unref?.();
	});

	pi.on("session_tree", (_event, ctx) => {
		context = ctx;
		activeMessageTs = undefined;
		rebuild(ctx.sessionManager.getBranch() as never);
		invalidateAll();
		refreshNow(ctx);
	});

	pi.on("message_start", (event) => {
		if (event.message.role !== "assistant") return;
		const ts = (event.message as { timestamp?: number }).timestamp;
		activeMessageTs = typeof ts === "number" ? ts : undefined;
		if (activeMessageTs !== undefined) noteMessageStart(activeMessageTs);
		clearLiveThinking();
	});

	pi.on("message_update", (event, ctx) => {
		const stream = (event as { assistantMessageEvent?: any }).assistantMessageEvent;
		if (!stream) return;
		const ts = (event.message as { timestamp?: number }).timestamp;
		if (typeof ts !== "number") return;
		if (stream.type === "thinking_delta" && typeof stream.delta === "string" && stream.delta) {
			noteThinking(ts, stream.delta);
			// The row's preview and duration belong to this run alone.
			paintStream(ctx, runForMessage(ts));
			return;
		}
		if (stream.type === "text_delta" || stream.type === "toolcall_start") {
			if (state.liveThinking) {
				clearLiveThinking();
				refreshNow(ctx);
			}
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const ts = (event.message as { timestamp?: number }).timestamp;
		if (typeof ts !== "number") return;
		const finished = finishThinking(ts);
		if (finished?.ms !== undefined) pi.appendEntry(THOUGHT_ENTRY, finished);
		// A plain answer has no block: nothing it draws depends on a run.
		const run = runForMessage(ts);
		if (run) invalidateRun(run);
		refreshNow(ctx);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		// Nested calls (a tool calling tools) are part of their parent row, not rows of their own.
		if ((event as { parentToolCallId?: string }).parentToolCallId) return;
		const row = startTool(event.toolCallId, event.toolName, (event.args ?? {}) as Record<string, unknown>, activeMessageTs);
		clearLiveThinking();
		invalidateRun(row.run);
		refreshNow(ctx);
	});

	pi.on("tool_execution_update", (event, ctx) => {
		const args = (event as { args?: Record<string, unknown> }).args;
		const row = state.rows.get(event.toolCallId);
		if (row && args) {
			row.args = { ...row.args, ...args };
			// A tool whose arguments were still empty at start settles for `.`; take the
			// subject once the arguments reach it, and leave a real subject alone.
			if (row.target === ".") row.target = targetOf(row.name, row.args ?? {});
		}
		// Partial output arrives in bursts; the Now row only needs a few frames a second.
		paintStream(ctx, row?.run);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if ((event as { parentToolCallId?: string }).parentToolCallId) return;
		const row = finishTool(event.toolCallId, event.toolName, undefined, event.result, event.isError);
		invalidateRun(row?.run);
		refreshNow(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const run = state.current;
		settleRun();
		activeMessageTs = undefined;
		// The run just closed: its header turns ✓/! and interrupted rows change status.
		if (run) invalidateRun(run);
		refreshNow(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ticker) clearInterval(ticker);
		ticker = undefined;
		state.headers.clear();
		state.tui = undefined;
		widget = undefined;
		setBlockExpanded(false);
		resetNow();
		if (ctx.mode === "tui") {
			ctx.ui.setWidget(NOW_WIDGET, undefined);
			ctx.ui.setToolsExpanded(false);
		}
		context = undefined;
	});

	return {
		apply(ctx: ExtensionContext): void {
			context = ctx;
			state.theme = ctx.ui.theme;
			invalidateAll();
			refreshNow(ctx);
		},
		stop(ctx: ExtensionContext): void {
			setBlockExpanded(false, false);
			if (ctx.mode === "tui") {
				ctx.ui.setWidget(NOW_WIDGET, undefined);
				ctx.ui.setToolsExpanded(false);
			}
			widget = undefined;
			invalidateAll();
		},
	};
}