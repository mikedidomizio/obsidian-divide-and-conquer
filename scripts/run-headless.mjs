#!/usr/bin/env node
/**
 * Runs an end-to-end npm script with no windows on screen.
 *
 * Obsidian is an Electron app, and Electron has no headless mode - Chromium's
 * `--headless` switch is a browser-process feature that Electron ignores, and
 * hiding the window instead makes Chromium throttle the renderer until the
 * plugin's timers stall and tests fail. What does work is a virtual display:
 * the app renders normally, into a framebuffer nobody is looking at.
 *
 * That means Linux with Xvfb, which is what CI uses. On macOS and Windows there
 * is no equivalent, so this says so rather than quietly running headful.
 *
 *   node scripts/run-headless.mjs [npm-script] [...args]
 */
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

/**
 * Works out how to run `script` headlessly, or why it cannot be done here.
 * Pure, so it can be checked without a virtual display to hand.
 *
 * @param {{platform: string, hasXvfb: boolean, script: string, args?: string[]}} env
 * @returns {{command: string, args: string[]} | {error: string}}
 */
export function plan({platform, hasXvfb, script, args = []}) {
	const forward = args.length > 0 ? ["--", ...args] : [];

	if (platform !== "linux") {
		return {
			error: `Cannot run headless on ${platform}: Electron has no headless mode, and a ` +
				"virtual display (Xvfb) is Linux-only. Obsidian's windows have to render " +
				"somewhere.\n\n" +
				`  - to run with windows on screen:  npm run ${script}\n` +
				"  - to run with no windows at all:  push the branch and let CI do it, or run\n" +
				"    the suite inside a Linux container",
		};
	}
	if (!hasXvfb) {
		return {
			error: "Cannot run headless: xvfb-run is not on PATH. Install it, e.g.\n\n" +
				"  sudo apt-get install -y xvfb",
		};
	}

	// --auto-servernum picks a free display number, so parallel runs do not collide.
	return {command: "xvfb-run", args: ["--auto-servernum", "npm", "run", script, ...forward]};
}

// Importable without running, so `plan` can be exercised on any platform.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	const [script = "test:e2e", ...args] = process.argv.slice(2);

	const hasXvfb = spawnSync("which", ["xvfb-run"], {stdio: "ignore"}).status === 0;
	const resolved = plan({platform: process.platform, hasXvfb, script, args});

	if ("error" in resolved) {
		console.error(resolved.error);
		process.exit(1);
	}

	console.log(`Running ${script} on a virtual display.`);
	const result = spawnSync(resolved.command, resolved.args, {stdio: "inherit"});
	process.exit(result.status ?? 1);
}
