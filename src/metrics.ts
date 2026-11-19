import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Token speed sampling. `live` is an estimate from the characters that arrived so far
 * (~3.5 characters per token); the exact value is `usage.output / (message_end - first delta)`,
 * the decode speed without the wait for the first token. Both are shown plain, no marker.
 * Tool runs never sample, so their waiting time does not drag the number down; the last
 * value simply stays on screen.
 */
type Rate = {
	messageStart?: number;
	firstDelta?: number;
	chars: number;
	live?: number;
	exact?: number;
};

const rate: Rate = { chars: 0 };

/**
 * Prompt-cache accounting across the session. `read` is what the provider served from its
 * cache, `prompt` is every prompt token (fresh input + cache read + cache write). The rate
 * shown is the weighted ratio over the session, not the average of per-message ratios.
 */
const cache = { prompt: 0, read: 0, write: 0 };

let lastNotify = 0;
const NOTIFY_EVERY_MS = 250;

const CONTENT_DELTAS = new Set(["text_delta", "thinking_delta", "toolcall_delta", "toolcall_start"]);
const CHARS_PER_TOKEN = 3.5;

/** Providers disagree on which usage fields they send; anything absent or silly counts as 0. */
function tokens(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Add one message's prompt with its cache split. Messages without a prompt are ignored. */
function addPrompt(usage: unknown): void {
	if (!usage || typeof usage !== "object") return;
	const value = usage as Record<string, unknown>;
	const read = tokens(value.cacheRead);
	const write = tokens(value.cacheWrite);
	const prompt = tokens(value.input) + read + write;
	if (prompt <= 0) return;
	cache.read += read;
	cache.write += write;
	cache.prompt += prompt;
}

function deltaText(event: unknown): string {
	if (!event || typeof event !== "object") return "";
	const value = event as { type?: string; delta?: unknown; content?: unknown };
	if (typeof value.type !== "string" || !CONTENT_DELTAS.has(value.type)) return "";
	if (typeof value.delta === "string") return value.delta;
	return "";
}

export function attachMetrics(pi: ExtensionAPI, onChange: () => void = () => {}): void {
	const notify = (): void => {
		const now = Date.now();
		if (now - lastNotify < NOTIFY_EVERY_MS) return;
		lastNotify = now;
		onChange();
	};
	pi.on("message_start", (event) => {
		if (event.message.role !== "assistant") return;
		// Only the per-message sampling resets: the last speed stays on screen between turns,
		// so the footer never flickers empty while the API is thinking.
		rate.messageStart = Date.now();
		rate.firstDelta = undefined;
		rate.chars = 0;
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		if (rate.messageStart === undefined) return;
		const text = deltaText(event.assistantMessageEvent);
		if (!text) return;
		const now = Date.now();
		rate.firstDelta ??= now;
		rate.chars += text.length;
		const elapsed = (now - rate.firstDelta) / 1000;
		if (elapsed > 0.15) {
			rate.live = rate.chars / CHARS_PER_TOKEN / elapsed;
			notify();
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const now = Date.now();
		const usage = (event.message as { usage?: { output?: unknown } }).usage;
		const output = tokens(usage?.output);
		addPrompt(usage);
		if (rate.messageStart !== undefined && rate.firstDelta !== undefined) {
			const decodeMs = now - rate.firstDelta;
			if (output > 0 && decodeMs > 0) rate.exact = output / (decodeMs / 1000);
		}
		rate.live = undefined;
		lastNotify = 0;
		onChange();
	});
}

/**
 * Count the prompts already in the session (resume, fork), so the rate does not restart at zero.
 * Accepts raw session entries; anything that is not an assistant message is skipped.
 */
export function seedCache(entries: readonly unknown[] | undefined): void {
	for (const entry of entries ?? []) {
		if (!entry || typeof entry !== "object") continue;
		const value = entry as { type?: unknown; message?: { role?: unknown; usage?: unknown } | null };
		if (value.type !== "message" || value.message?.role !== "assistant") continue;
		addPrompt(value.message.usage);
	}
}

/** `Cache 92%`, or undefined while no provider has reported cache tokens. */
export function cacheText(): string | undefined {
	if (cache.prompt <= 0) return undefined;
	// A model that never reports caching would read as a broken `cache 0%`; show nothing instead.
	if (cache.read + cache.write <= 0) return undefined;
	return `Cache ${Math.round((cache.read / cache.prompt) * 100)}%`;
}

export function resetMetrics(): void {
	lastNotify = 0;
	cache.prompt = 0;
	cache.read = 0;
	cache.write = 0;
	rate.messageStart = undefined;
	rate.firstDelta = undefined;
	rate.chars = 0;
	rate.live = undefined;
	rate.exact = undefined;
}

/** `68 t/s` once measured — the streaming estimate and the exact figure read the same. */
export function rateText(): string | undefined {
	const value = rate.exact ?? rate.live;
	if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
	const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} t/s`;
}

