import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Token speed sampling. `live` is an estimate from the characters that arrived so far
 * (~3.5 characters per token) and is shown with a leading `~`. The exact value is
 * `usage.output / (message_end - first delta)`, the decode speed without the wait for
 * the first token. Tool runs never sample, so their waiting time does not drag the number
 * down; the last value simply stays on screen.
 */
type Rate = {
	messageStart?: number;
	firstDelta?: number;
	chars: number;
	live?: number;
	exact?: number;
};

const rate: Rate = { chars: 0 };
let lastNotify = 0;
const NOTIFY_EVERY_MS = 250;

const CONTENT_DELTAS = new Set(["text_delta", "thinking_delta", "toolcall_delta", "toolcall_start"]);
const CHARS_PER_TOKEN = 3.5;

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
		rate.messageStart = Date.now();
		rate.firstDelta = undefined;
		rate.chars = 0;
		rate.live = undefined;
		rate.exact = undefined;
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
		const output = typeof usage?.output === "number" && Number.isFinite(usage.output) ? usage.output : 0;
		if (rate.messageStart !== undefined && rate.firstDelta !== undefined) {
			const decodeMs = now - rate.firstDelta;
			if (output > 0 && decodeMs > 0) rate.exact = output / (decodeMs / 1000);
		}
		rate.live = undefined;
		lastNotify = 0;
		onChange();
	});
}

export function resetMetrics(): void {
	lastNotify = 0;
	rate.messageStart = undefined;
	rate.firstDelta = undefined;
	rate.chars = 0;
	rate.live = undefined;
	rate.exact = undefined;
}

/** `68 t/s`, `~52 t/s` while streaming, or undefined before the first measurement. */
export function rateText(): string | undefined {
	const value = rate.exact ?? rate.live;
	if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
	const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rate.exact === undefined ? "~" : ""}${rounded} t/s`;
}

