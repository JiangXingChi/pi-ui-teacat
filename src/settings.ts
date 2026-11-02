import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Parts of the interface this extension owns. Each is on unless switched off in /ui. */
export const PARTS = ["process", "now", "footer"] as const;
export type Part = (typeof PARTS)[number];
export type Settings = Record<Part, boolean>;

export const DEFAULTS: Settings = { process: true, now: true, footer: true };

export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
export const DATA_DIR = join(AGENT_DIR, "pi-ui-teacat");

export const settingsPath = (): string => join(DATA_DIR, "settings.json");

/** Missing file or missing key means on: an update never silently switches something off. */
export function readSettings(path = settingsPath()): Settings {
	try {
		const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<Record<Part, unknown>>;
		return Object.fromEntries(
			PARTS.map((part) => [part, typeof saved[part] === "boolean" ? saved[part] : DEFAULTS[part]]),
		) as Settings;
	} catch {
		return { ...DEFAULTS };
	}
}

export function writeSettings(settings: Settings, path = settingsPath()): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}