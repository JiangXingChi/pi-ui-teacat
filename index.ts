import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import registerFooter from "./src/footer.ts";
import { attachMetrics, resetMetrics } from "./src/metrics.ts";
import registerProcess from "./src/process/index.ts";
import { rememberTui } from "./src/process/now.ts";
import { readSettings, type Settings } from "./src/settings.ts";
import registerUi from "./src/ui.ts";

/**
 * pi-ui-teacat owns three things: the Process block that folds thinking and tool
 * calls under one line, the Now row that says what runs right now, and a footer
 * of provider, model, thinking level, token speed, and context.
 */
export default function piFocus(pi: ExtensionAPI): void {
	let settings: Settings = readSettings();
	const current = (): Settings => settings;
	const footer = registerFooter(pi, rememberTui);
	const process = registerProcess(pi, current);

	const apply = (ctx: ExtensionContext, next: Settings): void => {
		settings = next;
		footer.apply(ctx, next.footer);
		if (next.process) process.apply(ctx);
		else process.stop(ctx);
	};

	attachMetrics(pi, () => footer.refresh());

	pi.on("session_start", (_event, ctx) => {
		resetMetrics();
		apply(ctx, readSettings());
	});
	pi.on("turn_start", () => {
		footer.refresh();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
		footer.stop();
	});

	registerUi(pi, apply);
}
