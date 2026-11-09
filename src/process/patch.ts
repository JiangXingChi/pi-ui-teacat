import { AssistantMessageComponent, ToolExecutionComponent, type MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";

import { outcomeFromResult, targetOf } from "../format.ts";
import { headerLine, isExpanded, setExpandedFlag, thinkingLine, toolLine } from "./render.ts";
import {
	bindComponent,
	invalidateAll,
	invalidateRun,
	registerComponent,
	registerHeader,
	runForMessage,
	state,
	type Run,
	type ToolRow,
} from "./state.ts";

const ASSISTANT_KEY = Symbol.for("pi-ui-teacat.assistant.patch");
const TOOL_KEY = Symbol.for("pi-ui-teacat.tool.patch");

/** Tool components that have drawn at least once: only those may move the block flag. */
const mountedTools = new WeakSet<object>();

const control = {
	enabled: () => false,
	expand: (_value: boolean) => {},
};

let invalidateScheduled = false;

/** One redraw per change that touches many components (Pi expands every tool at once). */
function scheduleInvalidate(): void {
	if (invalidateScheduled) return;
	invalidateScheduled = true;
	queueMicrotask(() => {
		invalidateScheduled = false;
		invalidateAll();
	});
}

/**
 * One shared flag for the whole block. Pi reports a toggle by calling `setExpanded` on
 * every child it can expand, so the first call moves the block and the rest agree with it.
 */
export function setBlockExpanded(value: boolean, redraw = true): void {
	const changed = isExpanded() !== value;
	setExpandedFlag(value);
	if (!value) {
		for (const row of state.rows.values()) row.open = false;
		for (const run of state.runs.values()) for (const thought of run.thoughts) thought.open = false;
	}
	// Callers that redraw everything themselves pass `false` rather than invalidate twice.
	if (changed && redraw) scheduleInvalidate();
}

export function configurePatches(options: { enabled: () => boolean; expand: (value: boolean) => void }): void {
	control.enabled = options.enabled;
	control.expand = options.expand;
}

function theme(): any {
	return state.theme ?? {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

/** A line whose text depends on the width it is finally drawn at. */
function lineComponent(build: (width: number) => string): { render(width: number): string[]; invalidate(): void } {
	let cachedWidth = -1;
	let cached = "";
	return {
		render(width: number): string[] {
			if (width !== cachedWidth) {
				cachedWidth = width;
				cached = build(width);
			}
			return [cached];
		},
		invalidate(): void {
			cachedWidth = -1;
		},
	};
}

/** Click or key: the block folds as a whole, so Pi's own flag moves with it. */
function toggleBlock(): void {
	const next = !isExpanded();
	setBlockExpanded(next);
	control.expand(next);
}

function headerComponent(run: Run, owner: { invalidate(): void }): MouseRegion {
	const line = lineComponent((width) => headerLine(run, theme(), width));
	// The duration has to keep moving while a long tool runs, even with no events: the
	// ticker resets this line's width cache, which is all that has to redraw.
	registerHeader(owner, line);
	// The header is the only thing on screen that names the block, so it is also the
	// thing to click: `▸ Process` opens it, `▾ Process` closes it.
	return new MouseRegion(line, (event) => {
		if (event?.type !== "click" || event?.button !== "left") return undefined;
		toggleBlock();
		return { handled: true };
	});
}

type Transform = (markdown: string, availableWidth: number) => string;

/** The thinking body, shown only while the Process block is expanded. */
function thinkingBody(text: string, markdownTheme: unknown, outputPad: number, transform?: Transform): Markdown {
	return new Markdown(
		text,
		outputPad,
		0,
		markdownTheme as never,
		{
			color: (value: string) => theme().fg("thinkingText", value),
			italic: true,
		},
		transform ? { transform } : undefined,
	);
}

/**
 * Pi applies the registered markdown transformers at render time, with the width and the streaming
 * state read then. Drawing the message ourselves means wiring that again, from public types only,
 * so Mermaid blocks and other transformed markdown keep working in the answer and its thinking.
 */
function markdownTransform(
	messageType: "assistant" | "assistant-thinking",
	owner: { isStreaming?: boolean; messageId?: string; timestamp?: string; markdownTransformers?: readonly MarkdownTransformer[] },
): Transform | undefined {
	const transformers = owner.markdownTransformers;
	if (!Array.isArray(transformers) || !transformers.length) return undefined;
	return (markdown, availableWidth) => {
		let text = markdown;
		for (const transformer of transformers) {
			try {
				const next = transformer(text, {
					messageType,
					isStreaming: Boolean(owner.isStreaming),
					availableWidth,
					messageId: owner.messageId,
					timestamp: owner.timestamp,
				});
				if (typeof next === "string") text = next;
			} catch {
				// One broken transformer must not take the message down with it.
			}
		}
		return text;
	};
}

function patchAssistant(): void {
	const proto = (AssistantMessageComponent as unknown as { prototype: any }).prototype;
	if (typeof proto?.updateContent !== "function") return;
	const previous = proto[ASSISTANT_KEY] as
		| { original: (...args: any[]) => any; originalSetExpanded?: (...args: any[]) => unknown }
		| undefined;
	const original = previous?.original ?? proto.updateContent;
	// Reuse what the first patch captured: on reload `proto.setExpanded` is our own wrapper.
	const originalSetExpanded = previous
		? previous.originalSetExpanded
		: typeof proto.setExpanded === "function"
			? proto.setExpanded
			: undefined;

	// Pi can only reach the block through the children it finds expandable. An assistant
	// message is one of them only once it answers here: without this a run with no tool
	// component has nothing for Ctrl+O to grab, so its thinking can never be unfolded.
	proto.setExpanded = function patchedAssistantSetExpanded(this: any, value: boolean): unknown {
		setBlockExpanded(Boolean(value));
		return typeof originalSetExpanded === "function" ? originalSetExpanded.call(this, value) : undefined;
	};

	proto.updateContent = function patchedUpdateContent(this: any, message: any, isStreaming = this.isStreaming): any {
		registerComponent(this);
		const thinkingHidden = this.hideThinkingBlock !== false;
		state.thinkingVisible = !thinkingHidden;
		if (!control.enabled() || !thinkingHidden || !Array.isArray(message?.content)) {
			return original.call(this, message, isStreaming);
		}
		const container = this.contentContainer;
		if (!container || typeof container.clear !== "function") return original.call(this, message, isStreaming);

		this.lastMessage = message;
		this.isStreaming = isStreaming;
		container.clear();

		const texts = message.content.filter((part: any) => part?.type === "text" && part.text?.trim());
		const hasToolCalls = message.content.some((part: any) => part?.type === "toolCall");
		this.hasToolCalls = hasToolCalls;

		if (texts.length) {
			container.addChild(new Spacer(1));
			const transform = markdownTransform("assistant", this);
			for (const part of texts) {
				container.addChild(
					new Markdown(part.text.trim(), this.outputPad ?? 1, 0, this.markdownTheme, undefined, transform ? { transform } : undefined),
				);
			}
		}

		// Pi's own end-of-message notices, word for word, so a failure is never silent.
		if (message.stopReason === "length") {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme().fg("error", "Response was truncated before completion."), this.outputPad ?? 1, 0));
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const notice =
					message.errorMessage && message.errorMessage !== "Request was aborted" ? message.errorMessage : "Operation aborted";
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme().fg("error", notice), this.outputPad ?? 1, 0));
			} else if (message.stopReason === "error") {
				const notice = message.errorMessage || "Unknown error";
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme().fg("error", `Error: ${notice}`), this.outputPad ?? 1, 0));
			}
		}

		const run = runForMessage(message.timestamp as number);
		// Counts, durations and rows all come from this run, so only it can make this stale.
		bindComponent(this, run);
		const thoughts = run?.thoughts.filter((thought) => thought.ts === message.timestamp) ?? [];
		if (run && run.headerTs === message.timestamp) {
			if (texts.length) container.addChild(new Spacer(1));
			container.addChild(headerComponent(run, this));
		}
		if (isExpanded() && thoughts.length) {
			container.addChild(new Spacer(texts.length || run?.headerTs === message.timestamp ? 0 : 1));
			for (const thought of thoughts) {
				const row = lineComponent((width) => thinkingLine(thought, theme(), width));
				if (!thought.text.trim()) {
					container.addChild(row);
					continue;
				}
				// One row until it is clicked open, the same bargain a tool row offers.
				container.addChild(
					new MouseRegion(row, (event) => {
						if (event?.type !== "click" || event?.button !== "left") return undefined;
						thought.open = !thought.open;
						// Only this run's rows change; the rest of the transcript stays cached.
						invalidateRun(run);
						return { handled: true };
					}),
				);
				if (thought.open) {
					// The open text is a target too: once it is showing, a click on it is a click to
					// close it, so nobody has to aim at the small `▾` that replaced the `▸`.
					container.addChild(
						new MouseRegion(
							thinkingBody(thought.text.trim(), this.markdownTheme, this.outputPad ?? 1, markdownTransform("assistant-thinking", this)),
							(event) => {
								if (event?.type !== "click" || event?.button !== "left") return undefined;
								thought.open = false;
								invalidateRun(run);
								return { handled: true };
							},
						),
					);
				}
			}
		}
	};

	proto[ASSISTANT_KEY] = { original, originalSetExpanded };
}

/** Build a row for a component that has none yet: a resumed transcript renders before any event fires. */
function ensureRow(tool: any): ToolRow | undefined {
	const id = typeof tool.toolCallId === "string" ? tool.toolCallId : undefined;
	if (!id) return undefined;
	const existing = state.rows.get(id);
	if (existing) return existing;
	const name = String(tool.toolName ?? "tool");
	const args = (tool.args ?? {}) as Record<string, unknown>;
	const row: ToolRow = { id, name, target: targetOf(name, args), status: "running" };
	if (tool.result) {
		const isError = Boolean(tool.result.isError);
		const outcome = outcomeFromResult(name, args, tool.result, isError);
		row.status = outcome.failed ? "error" : "success";
		row.outcome = outcome.outcome;
		if (typeof tool.result.durationMs === "number") row.durationMs = tool.result.durationMs;
	}
	state.rows.set(id, row);
	return row;
}

function patchTool(): void {
	const proto = (ToolExecutionComponent as unknown as { prototype: any }).prototype;
	if (typeof proto?.render !== "function") return;
	const previous = proto[TOOL_KEY] as
		| { originalRender: (...args: any[]) => string[]; originalMouse?: (...args: any[]) => unknown; originalSetExpanded?: (...args: any[]) => unknown }
		| undefined;
	const originalRender = previous?.originalRender ?? proto.render;
	const originalMouse = previous?.originalMouse ?? proto.handleMouse;
	const originalSetExpanded = previous?.originalSetExpanded ?? proto.setExpanded;

	proto.render = function patchedRender(this: any, width: number): string[] {
		registerComponent(this);
		mountedTools.add(this);
		if (!control.enabled()) return originalRender.call(this, width);
		const row = ensureRow(this);
		bindComponent(this, row?.run);
		if (!row || this.hideComponent) return originalRender.call(this, width);
		// A row the person clicked open keeps Pi's own rendering, detail and all.
		if (row.open) return originalRender.call(this, width);
		// Pi's own thinking means no Process header, so its rows must not vanish.
		if (state.thinkingVisible) return originalRender.call(this, width);
		if (!isExpanded()) return [];
		return [toolLine(row, theme(), width)];
	};

	if (typeof originalMouse === "function") {
		proto.handleMouse = function patchedMouse(this: any, event: any): unknown {
			if (
				!control.enabled() ||
				// Pi draws the thinking and its rows itself here: leave its own clicks alone.
				state.thinkingVisible ||
				event?.type !== "click" ||
				event?.button !== "left"
			) {
				return originalMouse.call(this, event);
			}
			const row = ensureRow(this);
			if (!row) return originalMouse.call(this, event);
			const head = event?.y === 0;
			if (!isExpanded()) {
				if (!head) return originalMouse.call(this, event);
				control.expand(true);
				row.open = true;
			} else if (row.open) {
				// An open row is Pi's own detail, several lines tall: a click anywhere on it
				// folds this row only. Letting it reach Pi's own region would call
				// `setExpanded(false)`, which is also how Ctrl+O reports a block toggle.
				row.open = false;
			} else if (head) {
				row.open = true;
			} else {
				return originalMouse.call(this, event);
			}
			// The row's own detail is Pi's; use its expansion without touching the block flag.
			originalSetExpanded?.call(this, Boolean(row.open));
			this.invalidate?.();
			state.tui?.requestRender();
			return { handled: true };
		};
	}

	if (typeof originalSetExpanded === "function") {
		proto.setExpanded = function patchedSetExpanded(this: any, value: boolean): unknown {
			// Pi also calls this on a component it has just built, before mounting it, with
			// its own flag. That is not a toggle: honouring it would fold the block again
			// every time a tool starts after the person opened it.
			if (mountedTools.has(this)) setBlockExpanded(Boolean(value));
			return originalSetExpanded.call(this, value);
		};
	}

	proto[TOOL_KEY] = { originalRender, originalMouse, originalSetExpanded };
}

export function installPatches(): void {
	patchAssistant();
	patchTool();
}
