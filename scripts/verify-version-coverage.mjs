#!/usr/bin/env node
/**
 * Proves the end-to-end suite really runs against both pinned Obsidian versions,
 * and that each one exercises its own code path.
 *
 * A suite that boots two Obsidians but only ever touches version-agnostic code
 * would pass just as happily with one of them switched off. So instead of
 * trusting the reporter's version banner, this deliberately breaks a
 * version-specific path in src/main.ts and checks that exactly the expected
 * version fails:
 *
 *   - the openPage hook is 1.13-only: it follows the CSS snippets sub-page
 *   - the display hook is 1.12-only: 1.13 renders its own tabs via renderTab
 *
 * src/main.ts is restored and dist rebuilt afterwards, including on failure.
 */
import {spawnSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

import {
	SETTINGS_SUB_PAGE_VERSION,
	isAtLeast,
	obsidianVersions,
} from "../tests/e2e/obsidian-versions.mjs";

const SOURCE = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const SPEC = "tests/e2e/specs/settings-ui.e2e.ts";

// The same versions wdio.conf.mts runs, OBSIDIAN_VERSIONS override included.
const VERSIONS = obsidianVersions().map(({appVersion}) => appVersion);

/** Which side of the settings-UI rewrite each version falls on. */
let subPageVersions;
try {
	subPageVersions = new Set(VERSIONS.filter((v) => isAtLeast(v, SETTINGS_SUB_PAGE_VERSION)));
} catch (e) {
	console.error(`${e.message}\nPin concrete versions to run this check.`);
	process.exit(1);
}

const olderVersions = VERSIONS.filter((v) => !subPageVersions.has(v));
if (subPageVersions.size === 0 || olderVersions.length === 0) {
	console.error(
		"This check needs at least one version on each side of the " +
		`${SETTINGS_SUB_PAGE_VERSION} settings-UI rewrite, but got: ${VERSIONS.join(", ") || "(none)"}.`,
	);
	process.exit(1);
}

/** Each break belongs to one side of the rewrite: only that side should fail. */
const MUTATIONS = [
	{
		name: `break the sub-page hook (${SETTINGS_SUB_PAGE_VERSION}+ only)`,
		find: 'if (typeof settingModal.openPage === "function") {',
		replace: 'if (false && typeof settingModal.openPage === "function") {',
		fails: (version) => subPageVersions.has(version),
	},
	{
		name: `break the display() hook (pre-${SETTINGS_SUB_PAGE_VERSION} only)`,
		find: "\t\t\tthis.register(around(tab, {display: this.overrideRender.bind(this, mode, tab)}));\n",
		replace: "",
		fails: (version) => !subPageVersions.has(version),
	},
];

const original = readFileSync(SOURCE, "utf8");

function run(command, args, env = {}) {
	return spawnSync(command, args, {
		encoding: "utf8",
		env: {...process.env, ...env},
		shell: process.platform === "win32",
	});
}

/** Builds the current source and runs the spec against one version. */
function suiteResult(version) {
	const build = run("npm", ["run", "build:production"]);
	if (build.status !== 0) {
		throw new Error(`build failed:\n${build.stderr || build.stdout}`);
	}
	const wdio = run("npx", ["wdio", "run", "./wdio.conf.mts", "--spec", SPEC], {
		OBSIDIAN_VERSIONS: version,
	});
	return wdio.status === 0 ? "pass" : "fail";
}

const rows = [];
let ok = true;

try {
	console.log(`Baseline: ${SPEC} should pass on every pinned version.`);
	for (const version of VERSIONS) {
		const actual = suiteResult(version);
		const good = actual === "pass";
		ok &&= good;
		rows.push({mutation: "none (baseline)", version, expected: "pass", actual, good});
		console.log(`  ${good ? "ok  " : "FAIL"} ${version}: ${actual}`);
	}

	for (const mutation of MUTATIONS) {
		if (!original.includes(mutation.find)) {
			throw new Error(
				`Could not apply "${mutation.name}": src/main.ts no longer contains the code it patches. ` +
				"Update MUTATIONS in this script to match.",
			);
		}
		console.log(`\nMutation: ${mutation.name}`);
		writeFileSync(SOURCE, original.replace(mutation.find, mutation.replace));

		for (const version of VERSIONS) {
			const expected = mutation.fails(version) ? "fail" : "pass";
			const actual = suiteResult(version);
			const good = actual === expected;
			ok &&= good;
			rows.push({mutation: mutation.name, version, expected, actual, good});
			console.log(`  ${good ? "ok  " : "FAIL"} ${version}: expected ${expected}, got ${actual}`);
		}

		writeFileSync(SOURCE, original);
	}
} finally {
	writeFileSync(SOURCE, original);
	run("npm", ["run", "build:production"]);
}

console.log("\n" + rows.map((r) =>
	`${r.good ? "ok  " : "FAIL"} ${r.version}  ${r.expected.padEnd(4)} ${r.mutation}`
).join("\n"));

if (!ok) {
	console.error(
		"\nVersion coverage NOT proven: a version-specific break did not fail the version it belongs to.",
	);
	process.exit(1);
}
console.log(
	`\nVersion coverage proven: ${VERSIONS.join(", ")} each fail only on their own ` +
	"code path, so all of them are genuinely under test.",
);
