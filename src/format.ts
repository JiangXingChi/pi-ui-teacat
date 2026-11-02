import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Verbs are padded to this width so child rows line up. */
export const VERB_WIDTH = 6;

export const VERBS: Record<string, string> = {
	bash: "bash",
	read: "read",
	edit: "edit",
	write: "write",
	find: "find",
	grep: "grep",
	ls: "list",
};

export function verbOf(name: string): string {
	const short = name.split(".").pop() ?? name;
	return (VERBS[short] ?? short).slice(0, VERB_WIDTH);
}

/** One line, no control codes or newlines, safe to style and truncate. */
export function oneLine(value: string): string {
	return stripVTControlCharacters(value)
		.replace(/\r?\n/g, " ↵ ")
		.replace(/\t/g, " ")
		.replace(/[\x00-\x1f\x7f]/g, "")
		.trim();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The tool's subject: the command, the pattern and path, or the file path. */
export function targetOf(name: string, args: Record<string, unknown>): string {
	const short = name.split(".").pop() ?? name;
	const raw =
		short === "bash"
			? firstLine(args.command)
			: short === "grep" || short === "find"
				? `${String(args.pattern ?? "")}${args.path ? ` · ${String(args.path)}` : ""}`
				: short === "agent" || short === "task"
					? firstLine(args.description ?? args.prompt ?? args.name)
					: (args.path ?? args.file_path ?? args.url ?? args.query ?? args.name);
	const text = typeof raw === "string" ? oneLine(raw) : "";
	if (!text) return ".";
	const home = homedir();
	return text.startsWith(`${home}/`) ? `~/${text.slice(home.length + 1)}` : text;
}

function firstLine(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.split(/\r?\n/).find((line) => line.trim()) ?? "";
}

/** Text content of a tool result, the shape every Pi tool returns. */
export function resultText(result: unknown): string {
	if (!isPlainObject(result)) return "";
	const content = result.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(item): item is { type: "text"; text: string } =>
				isPlainObject(item) && item.type === "text" && typeof item.text === "string",
		)
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function hasImage(result: unknown): boolean {
	if (!isPlainObject(result) || !Array.isArray(result.content)) return false;
	return result.content.some((item) => isPlainObject(item) && item.type === "image" && typeof item.data === "string");
}

function detailsOf(result: unknown): Record<string, unknown> | undefined {
	return isPlainObject(result) && isPlainObject(result.details) ? result.details : undefined;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatDuration(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "";
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** `0:34`-style clock for the Now row. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return minutes ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

function countLines(text: string): number {
	return text ? text.replace(/\n$/, "").split("\n").length : 0;
}

function diffStats(diff: string | undefined): { additions: number; deletions: number } {
	if (!diff) return { additions: 0, deletions: 0 };
	const lines = diff.split("\n");
	return {
		additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
		deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
	};
}

function errorSummary(text: string): string {
	const exit = text.match(/exited with code\s+(\d+)/i)?.[1];
	if (exit) return `exit ${exit}`;
	if (/timed out/i.test(text)) return "timed out";
	if (/\b(?:aborted|cancelled|canceled|interrupted)\b/i.test(text)) return "cancelled";
	const lines = text.split("\n").map((line) => oneLine(line)).filter(Boolean);
	return lines.length ? truncateToWidth(lines[lines.length - 1]!, 48, "…") : "failed";
}

export function outcomeFromResult(
	name: string,
	args: Record<string, unknown>,
	result: unknown,
	isError: boolean,
): { outcome: string; failed: boolean } {
	const short = name.split(".").pop() ?? name;
	const text = resultText(result);
	if (isError) return { outcome: errorSummary(text), failed: true };
	const details = detailsOf(result);
	switch (short) {
		case "read": {
			if (!text && hasImage(result)) return { outcome: "image", failed: false };
			const truncation = details?.truncation as { outputLines?: number } | undefined;
			const lines = truncation?.outputLines ?? countLines(text);
			return { outcome: lines ? plural(lines, "line") : "empty", failed: false };
		}
		case "grep": {
			if (/^no matches found$/i.test(text)) return { outcome: "no matches", failed: false };
			const matches = text.split("\n").filter((line) => line.trim() && line.trim() !== "--").length;
			return { outcome: matches ? plural(matches, "match", "matches") : "no matches", failed: false };
		}
		case "find":
		case "ls": {
			if (/^no files found/i.test(text) || /^\(?empty directory\)?$/i.test(text)) {
				return { outcome: short === "find" ? "no results" : "empty", failed: false };
			}
			const entries = text.split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("[")).length;
			const noun = short === "find" ? "result" : "entry";
			return { outcome: entries ? plural(entries, noun, `${noun === "entry" ? "entries" : "results"}`) : "empty", failed: false };
		}
		case "edit": {
			const stats = diffStats(typeof details?.diff === "string" ? details.diff : undefined);
			const blocks = Array.isArray(args.edits) ? args.edits.length : 1;
			const delta = stats.additions || stats.deletions ? ` · +${stats.additions} −${stats.deletions}` : "";
			return { outcome: `${plural(blocks, "block")}${delta}`, failed: false };
		}
		case "write": {
			const content = typeof args.content === "string" ? args.content : "";
			return { outcome: plural(countLines(content), "line"), failed: false };
		}
		case "bash": {
			return { outcome: "exit 0", failed: false };
		}
		default: {
			const first = oneLine(text.split("\n").find((line) => line.trim()) ?? "");
			return { outcome: first ? truncateToWidth(first, 40, "…") : "done", failed: false };
		}
	}
}

/** Left text with right meta, right-aligned; both always fit in width. */
export function joinColumns(left: string, right: string, width: number, minimumLeft = 18): string {
	if (width <= 0) return "";
	if (!right) return truncateToWidth(left, width, "…");
	const rightWidth = visibleWidth(right);
	if (width < minimumLeft + rightWidth + 2) return truncateToWidth(`${left} ${right}`, width, "…");
	const leftWidth = Math.max(minimumLeft, width - rightWidth - 2);
	const clipped = truncateToWidth(left, leftWidth, "…");
	const padding = " ".repeat(Math.max(2, width - visibleWidth(clipped) - rightWidth));
	return truncateToWidth(`${clipped}${padding}${right}`, width, "");
}
