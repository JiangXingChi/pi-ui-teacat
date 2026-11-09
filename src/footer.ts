import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { rateText } from "./metrics.ts";

const BAR_WIDTH = 8;
/** A footer frame should read the session once per this many milliseconds. */
const SNAPSHOT_MS = 200;
const USED = "⠿";
const FREE = "⠄";

const PROVIDER_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	groq: "Groq",
	mistral: "Mistral",
	xai: "xAI",
	deepseek: "DeepSeek",
	qwen: "Qwen",
	openrouter: "OpenRouter",
	"opencode-go": "OpenCode Go",
	ollama: "Ollama",
};

/** `qwen-token-plan-2` reads as `Qwen Token Plan 2`; unknown ids stay as they are. */
export function providerName(id: string | undefined): string | undefined {
	if (!id) return undefined;
	const known = PROVIDER_NAMES[id.toLowerCase()];
	if (known) return known;
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => (/^\d+$/.test(part) ? part : part[0]!.toUpperCase() + part.slice(1)))
		.join(" ");
}

function compactTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
	if (tokens >= 1000) return `${Math.round(tokens / 100) / 10}k`;
	return String(tokens);
}

function contextBar(percent: number | null | undefined): string {
	if (percent === null || percent === undefined) return FREE.repeat(BAR_WIDTH);
	const used = Math.round((Math.min(100, Math.max(0, percent)) / 100) * BAR_WIDTH);
	return USED.repeat(used) + FREE.repeat(BAR_WIDTH - used);
}

/** The footer's data, read fresh on every frame. */
type FooterState = {
	provider?: string;
	model: string;
	thinking: string;
	rate?: string;
	context: { percent: number | null; tokens: number | null; window: number } | undefined;
};

export type Footer = {
	apply(ctx: ExtensionContext, on: boolean): void;
	refresh(): void;
	stop(): void;
};

/**
 * Left to right: provider · model · thinking · token speed · context.
 * When the terminal is too narrow the bar goes first, then the provider.
 */
export default function registerFooter(pi: ExtensionAPI, onTui?: (tui: TUI) => void): Footer {
	const refs: { tui?: TUI; ctx?: ExtensionContext; signature?: string; pulse?: ReturnType<typeof setInterval> } = {};
	/** `getContextUsage()` walks the whole session, so a frame must not do it twice. */
	let cached: { at: number; value: FooterState } | undefined;

	/** What the footer shows, read from the session (re-read at most every SNAPSHOT_MS). */
	const snapshot = (ctx: ExtensionContext): FooterState => {
		const now = Date.now();
		if (cached && now - cached.at < SNAPSHOT_MS) return cached.value;
		const usage = ctx.getContextUsage();
		const value: FooterState = {
			provider: providerName(ctx.model?.provider),
			model: ctx.model?.name ?? ctx.model?.id ?? "no model",
			thinking: pi.getThinkingLevel(),
			rate: rateText(),
			context: usage ? { percent: usage.percent, tokens: usage.tokens, window: usage.contextWindow } : undefined,
		};
		cached = { at: now, value };
		return value;
	};

	/** A model switch, a thinking-level change or new token figures redraw without an event. */
	const pulse = (): void => {
		const ctx = refs.ctx;
		if (!ctx || ctx.mode !== "tui") return;
		const signature = JSON.stringify(snapshot(ctx));
		if (signature === refs.signature) return;
		refs.signature = signature;
		refs.tui?.requestRender();
	};

	return {
		stop(): void {
			cached = undefined;
			if (refs.pulse) clearInterval(refs.pulse);
			refs.pulse = undefined;
			refs.ctx = undefined;
			refs.tui = undefined;
		},
		apply(ctx: ExtensionContext, on: boolean): void {
			if (ctx.mode !== "tui") return;
			if (!on) {
				cached = undefined;
				ctx.ui.setFooter(undefined);
				if (refs.pulse) clearInterval(refs.pulse);
				refs.pulse = undefined;
				refs.tui = undefined;
				refs.ctx = undefined;
				return;
			}
			refs.ctx = ctx;
			refs.signature = undefined;
			cached = undefined;
			refs.pulse ??= setInterval(pulse, 1000);
			refs.pulse.unref?.();
			ctx.ui.setFooter((tui, theme): Component & { dispose?(): void } => {
				refs.tui = tui;
				// The footer is the only TUI handle that exists even when the Now row is off.
				onTui?.(tui);
				return {
					invalidate(): void {},
					render(width: number): string[] {
						return [line(snapshot(ctx), theme, width)];
					},
				};
			});
		},
		refresh(): void {
			// The exact rate is written on the same event as this call: a cached frame would hide it
			// until the next pulse, so drop the snapshot and read the session once more.
			cached = undefined;
			refs.tui?.requestRender();
		},
	};
}

function line(state: FooterState, theme: Theme, width: number): string {
	const divider = theme.fg("borderMuted", " · ");

	// The bar already carries the percentage, so the number next to it is left out: the bar
	// plus `used/window` says how full the context is and how much that is in tokens.
	const context = (withBar: boolean): string | undefined => {
		const usage = state.context;
		if (!usage) return undefined;
		const parts: string[] = [];
		if (withBar) parts.push(theme.fg("muted", contextBar(usage.percent)));
		if (usage.tokens !== null && usage.tokens !== undefined) {
			parts.push(theme.fg("dim", `${compactTokens(usage.tokens)}/${compactTokens(usage.window)}`));
		}
		return parts.length ? parts.join(" ") : undefined;
	};

	const build = (options: { provider: boolean }): string =>
		[options.provider ? state.provider : undefined, state.model, state.thinking, state.rate]
			.filter((value): value is string => Boolean(value))
			.join(divider);

	// Drop the widest extras first; `model · thinking` is the floor. The context segment is
	// pinned to the right edge, so it is measured against what the left side leaves over.
	const ladder = [{ bar: true, provider: true }, { bar: false, provider: true }, { bar: false, provider: false }];
	for (const options of ladder) {
		const left = build(options);
		const right = context(options.bar);
		if (!right) return truncateToWidth(left, width, "…");
		const room = width - visibleWidth(left) - visibleWidth(right);
		// Two columns of air; below that the two groups would read as one word.
		if (room >= 2) return `${left}${" ".repeat(room)}${right}`;
	}
	const floor = [state.model, state.thinking].filter(Boolean).join(divider);
	if (visibleWidth(floor) <= width) return truncateToWidth(floor, width, "");
	return truncateToWidth(state.model, width, "…");
}