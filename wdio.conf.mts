import * as path from "node:path";
import {obsidianVersions} from "./tests/e2e/obsidian-versions.mjs";

/**
 * End-to-end tests run the real Obsidian app against a throwaway vault (see
 * `tests/e2e/vaults/simpleFakeVault`) with this plugin installed from `dist/`,
 * so run `npm run build:production` first.
 *
 * `browserVersion` picks Obsidian's app version and `installerVersion` its
 * Electron binary; both live in `tests/e2e/obsidian-versions.mjs`.
 * See https://jesse-r-s-hines.github.io/wdio-obsidian-service/
 */

const cacheDir = path.resolve(".obsidian-cache");

const versions = obsidianVersions();

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./tests/e2e/specs/**/*.e2e.ts"],

	// One Obsidian instance per version, in parallel.
	maxInstances: versions.length,

	capabilities: versions.map(({appVersion, installerVersion}) => ({
		browserName: "obsidian",
		browserVersion: appVersion,
		"wdio:obsidianOptions": {
			installerVersion,
			// The built plugin, not the repo root — esbuild writes main.js and
			// `copy-over` puts manifest.json and styles.css alongside it.
			plugins: ["./dist"],
			vault: "./tests/e2e/vaults/simpleFakeVault",
		},
	})),

	services: ["obsidian"],
	reporters: ["obsidian"],

	// Downloaded Obsidian versions live here so CI can cache them.
	cacheDir,

	mochaOpts: {
		ui: "bdd",
		timeout: 90_000,
	},

	// Booting two Obsidians at once on a loaded machine can leave a command
	// waiting well past WebdriverIO's default 120s.
	connectionRetryTimeout: 240_000,

	// Quiet locally, where the reporter output is right there on screen. CI has
	// only the artifact below to go on after the fact, and at "warn" wdio writes
	// no runner log at all - just chromedriver's.
	logLevel: process.env.CI ? "info" : "warn",

	// wdio only writes log files when it has an outputDir; without this the CI
	// job's failure artifact has nothing to collect.
	outputDir: "logs",
};
