import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { cacheText, rateText } from "./metrics.ts";

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

/** `high` → `High`, `xhigh` → `Xhigh`: the level reads as a label, not a flag. */
function levelLabel(level: string): string {
	return level ? level[0]!.toUpperCase() + level.slice(1) : level;
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
	cache?: string;
	context: { percent: number | null; tokens: number | null; window: number } | undefined;
};

export type Footer = {
	apply(ctx: ExtensionContext, on: boolean): void;
	refresh(): void;
	stop(): void;
};

/**
 * Left to right: provider · model · thinking · token speed, then the cache rate and the
 * context bar pinned to the right. When the terminal is too narrow the cache rate goes first,
 * then the bar, then the provider.
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
			thinking: levelLabel(pi.getThinkingLevel()),
			rate: rateText(),
			cache: cacheText(),
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
	// Five harmonious hues, applied at render time (colored text never enters the state) and
	// fixed per column whatever the content. All of them stay in one cool family: an analogous
	// violet → lilac → blue gradient for the identity trio, then teal Cache and green speed
	// continuing the cool arc, so the whole bar reads as a single spectrum.
	const left = (provider: boolean): string =>
		[
			provider && state.provider ? theme.fg("borderAccent", state.provider) : undefined,
			theme.fg("accent", state.model),
			state.thinking ? theme.fg("mdLink", state.thinking) : undefined,
			state.rate ? theme.fg("success", state.rate) : undefined,
		]
			.filter((value): value is string => Boolean(value))
			.join(divider);

	// The bar already carries the percentage, so the number next to it is left out: the bar
	// plus `used/window` says how full the context is and how much that is in tokens.
	// The cache rate rides in front of it: both are bookkeeping for the same prompt.
	const right = (options: { bar: boolean; cache: boolean }): string | undefined => {
		const parts: string[] = [];
		// Cache keeps the all-cool palette: teal, slotting between the blue thinking and green speed.
		if (options.cache && state.cache) parts.push(theme.fg("syntaxVariable", state.cache));
		const usage = state.context;
		if (usage) {
			const context: string[] = [];
			if (options.bar) context.push(theme.fg("muted", contextBar(usage.percent)));
			if (usage.tokens !== null && usage.tokens !== undefined) {
				context.push(theme.fg("dim", `${compactTokens(usage.tokens)}/${compactTokens(usage.window)}`));
			}
			if (context.length) parts.push(context.join(" "));
		}
		return parts.length ? parts.join("  ") : undefined;
	};

	// Drop the extras widest-first; `model · thinking` is the floor. The cache rate is the newest
	// and least load-bearing, so it goes before the bar, and the bar before the provider.
	const ladder = [
		{ provider: true, bar: true, cache: true },
		{ provider: true, bar: true, cache: false },
		{ provider: true, bar: false, cache: false },
		{ provider: false, bar: false, cache: false },
	];
	for (const options of ladder) {
		const leftSide = left(options.provider);
		const rightSide = right(options);
		if (!rightSide) return truncateToWidth(leftSide, width, "…");
		const room = width - visibleWidth(leftSide) - visibleWidth(rightSide);
		// Two columns of air; below that the two groups would read as one word.
		if (room >= 2) return `${leftSide}${" ".repeat(room)}${rightSide}`;
	}
	const floor = [state.model, state.thinking].filter(Boolean).join(divider);
	if (visibleWidth(floor) <= width) return truncateToWidth(floor, width, "");
	return truncateToWidth(state.model, width, "…");
}