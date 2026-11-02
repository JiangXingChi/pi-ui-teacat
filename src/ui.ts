import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

import { PARTS, readSettings, writeSettings, type Part, type Settings } from "./settings.ts";

const LABELS: Record<Part, { label: string; meta: string }> = {
	process: { label: "Process — thinking and tool calls folded under one line", meta: "live" },
	now: { label: "Now — the running tool or the thought streaming in", meta: "live" },
	footer: { label: "Footer — left: provider · model · thinking · t/s; right: context bar + tokens", meta: "live" },
};

class Checklist implements Component {
	private index = 0;
	private checked: Set<Part>;
	private readonly theme: Theme;
	private readonly done: (value: Settings | undefined) => void;
	private readonly requestRender: () => void;

	constructor(theme: Theme, current: Settings, done: (value: Settings | undefined) => void, requestRender: () => void) {
		this.theme = theme;
		this.checked = new Set(PARTS.filter((part) => current[part]));
		this.done = done;
		this.requestRender = requestRender;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up) || data === "k") {
			this.index = Math.max(0, this.index - 1);
		} else if (matchesKey(data, Key.down) || data === "j") {
			this.index = Math.min(PARTS.length - 1, this.index + 1);
		} else if (matchesKey(data, Key.space)) {
			const part = PARTS[this.index]!;
			if (this.checked.has(part)) this.checked.delete(part);
			else this.checked.add(part);
		} else if (matchesKey(data, Key.enter)) {
			this.done(Object.fromEntries(PARTS.map((part) => [part, this.checked.has(part)])) as Settings);
			return;
		} else if (matchesKey(data, Key.escape) || data === "q") {
			this.done(undefined);
			return;
		} else {
			return;
		}
		this.requestRender();
	}

	render(width: number): string[] {
		const theme = this.theme;
		const lines: string[] = [];
		lines.push(truncateToWidth(theme.fg("accent", theme.bold("Interface")), width));
		lines.push(truncateToWidth(theme.fg("dim", "space toggles · enter saves · esc closes"), width));
		lines.push("");
		PARTS.forEach((part, position) => {
			const cursor = position === this.index ? theme.fg("accent", "›") : " ";
			const box = this.checked.has(part) ? theme.fg("accent", "●") : theme.fg("dim", "○");
			const label = position === this.index ? theme.bold(LABELS[part].label) : LABELS[part].label;
			lines.push(truncateToWidth(`${cursor} ${box} ${label}  ${theme.fg("dim", LABELS[part].meta)}`, width, "…"));
		});
		lines.push("");
		lines.push(truncateToWidth(theme.fg("dim", `${this.checked.size}/${PARTS.length} on`), width));
		return lines;
	}

	invalidate(): void {}
}

export type Apply = (ctx: ExtensionContext, settings: Settings) => void;

export default function registerUi(pi: ExtensionAPI, apply: Apply): void {
	pi.registerCommand("ui", {
		description: "Turn the Process block, the Now row, and the footer on or off.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("/ui needs the interactive TUI.", "error");
				return;
			}
			const current = readSettings();
			const next = await ctx.ui.custom<Settings | undefined>((tui: TUI, theme: Theme, _keys: KeybindingsManager, done) =>
				new Checklist(theme, current, done, () => tui.requestRender()),
			);
			if (!next) return;
			writeSettings(next);
			apply(ctx, next);
			ctx.ui.notify("Interface updated.", "info");
		},
	});
}