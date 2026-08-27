/**
 * The Obsidian versions the E2E tests run against - the source of truth for
 * both `wdio.conf.mts` and `scripts/verify-version-coverage.mjs`. Plain
 * JavaScript so the verification script, on bare node, can import it without a
 * TypeScript loader.
 */

/**
 * Obsidian ships as two separately-versioned parts: the auto-updating "app"
 * bundle and the "installer" Electron binary. A spec is `appVersion` or
 * `appVersion/installerVersion`, and must be exact - "1.13" is not resolvable.
 *
 * Two things decide this list. One version has to sit either side of the
 * settings-UI rewrite (see `SETTINGS_SUB_PAGE_VERSION`), since the eras take
 * different paths through `addControls`; `npm run test:e2e:verify` proves both
 * stay covered. And the oldest entry guards `minAppVersion` - it is as low as
 * this suite can go, because wdio-obsidian-service hard-codes
 * `minSupportedObsidianVersion` and throws before launching anything older.
 * The plugin may well work further back; we simply cannot show it.
 *
 * Nothing here pins the newest Obsidian. `.github/workflows/e2e-latest.yml`
 * runs the suite against `latest` on a schedule instead, so a release landing
 * mid-review cannot fail a PR that changed nothing.
 *
 * @type {readonly string[]}
 */
export const DEFAULT_OBSIDIAN_VERSIONS = ["1.0.3", "1.13.7"];

/**
 * Where the settings UI changed: CSS snippets moved onto their own sub-page and
 * tabs started rendering from definitions instead of through `display()`.
 *
 * The exact release is a guess - 1.12.7 has been observed on the old side and
 * 1.13.7 on the new one, with nothing pinning down what happened in between.
 * Only the tests depend on it: `addControls` feature-detects `openPage` and
 * `renderTab` rather than comparing versions, so it takes the right path
 * wherever the line really falls. To narrow it, add a candidate release to
 * `DEFAULT_OBSIDIAN_VERSIONS` and run `npm run test:e2e:verify`.
 */
export const SETTINGS_SUB_PAGE_VERSION = "1.13.0";

/**
 * Compares concrete dotted versions: `isAtLeast("1.2.8", "1.13.0")` is false.
 * Throws on anything that is not a real version number ("latest").
 *
 * @param {string} version
 * @param {string} minimum
 * @returns {boolean}
 */
export function isAtLeast(version, minimum) {
	const parse = (value) => {
		const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
		if (!match) {
			throw new Error(`Not a concrete Obsidian version: "${value}"`);
		}
		return match.slice(1, 4).map(Number);
	};

	const actual = parse(version);
	const floor = parse(minimum);
	for (let i = 0; i < 3; i++) {
		if (actual[i] !== floor[i]) {
			return actual[i] > floor[i];
		}
	}
	return true;
}

/**
 * The versions to test, honouring the OBSIDIAN_VERSIONS override, e.g.
 *   OBSIDIAN_VERSIONS="latest" npm run test:e2e
 *   OBSIDIAN_VERSIONS="1.13.7/1.13.7 latest" npm run test:e2e
 *
 * @returns {{appVersion: string, installerVersion: string}[]}
 */
export function obsidianVersions() {
	const specs = process.env.OBSIDIAN_VERSIONS ?? DEFAULT_OBSIDIAN_VERSIONS.join(" ");
	return specs
		.split(/\s+/)
		.filter(Boolean)
		.map((spec) => {
			const [appVersion, installerVersion = "latest"] = spec.split("/");
			return {appVersion, installerVersion};
		});
}
