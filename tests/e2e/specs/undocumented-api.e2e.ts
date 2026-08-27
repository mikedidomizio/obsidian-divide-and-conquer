import {browser, expect} from "@wdio/globals";
import {SETTINGS_SUB_PAGE_VERSION, isAtLeast} from "../obsidian-versions.mjs";

/**
 * This plugin is built almost entirely on Obsidian internals that carry no
 * compatibility promise. The only thing standing behind the `minAppVersion` in
 * `manifest.json` is that the oldest pin in `tests/e2e/obsidian-versions.mjs`
 * still has every member listed here. If this fails on that pin, the floor has
 * moved: find the release that introduced the missing member and raise
 * `minAppVersion` to it.
 *
 * So every entry has to be one `src/` genuinely calls - an unused member would
 * push the floor up over an API the plugin never touches.
 *
 * TODO these aren't all used by the plugin and could lead to false positives if
 * the commands disappear.  We should organize the commands and only check for
 * the ones we use.
 */
const REQUIRED = [
	// Turning plugins on and off in bulk, and making Obsidian pick the change up.
	["app.plugins.manifests", "object"],
	["app.plugins.enabledPlugins", "object"],
	["app.plugins.enablePluginAndSave", "function"],
	["app.plugins.disablePluginAndSave", "function"],
	["app.plugins.initialize", "function"],
	["app.plugins.loadManifests", "function"],

	// The same for CSS snippets, which Obsidian keeps in a separate registry.
	["app.customCss.snippets", "object"],
	["app.customCss.enabledSnippets", "object"],
	["app.customCss.setCssEnabledStatus", "function"],
	["app.customCss.loadSnippets", "function"],

	// Finding the settings tabs to hang the controls off - see `addControls`.
	["app.setting.settingTabs", "object"],

	// Running the plugin's own commands from its buttons.
	["app.commands.executeCommandById", "function"],
] as const;

describe("the undocumented Obsidian internals this plugin needs", function() {
	it("are all present in this version", async function() {
		const actual = await browser.executeObsidian(({app}, paths) => {
			const root = {app} as Record<string, unknown>;
			return paths.map((path) => {
				const value = path.split(".").reduce<unknown>(
					(node, key) => (node as Record<string, unknown> | undefined)?.[key],
					root,
				);
				return `${path}: ${value === null ? "null" : typeof value}`;
			});
		}, REQUIRED.map(([path]) => path));

		expect(actual).toEqual(REQUIRED.map(([path, type]) => `${path}: ${type}`));
	});

	/**
	 * `app.setting.openPage` is the page-stack navigation the plugin hooks to follow
	 * the user into the CSS snippets sub-page. `addControls` feature-detects it, so
	 * only `SETTINGS_SUB_PAGE_VERSION` claims to know which release added it - and
	 * this is what would catch that claim being wrong.
	 */
	it("gained openPage exactly where SETTINGS_SUB_PAGE_VERSION says it did", async function() {
		const version = await browser.getObsidianVersion();
		const hasOpenPage = await browser.executeObsidian(
			({app}) => typeof (app.setting as unknown as Record<string, unknown>).openPage === "function",
		);

		expect(hasOpenPage).toBe(isAtLeast(version, SETTINGS_SUB_PAGE_VERSION));
	});
});
