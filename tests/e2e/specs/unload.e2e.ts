import {browser, expect, $} from "@wdio/globals";
import {
	SETTINGS_MODAL,
	closeSettings,
	fromMainWindow,
	openCssSnippets,
	openSettings,
	openSettingsTab,
	resetDac,
} from "./helpers.js";

const CONTROLS = `${SETTINGS_MODAL} .dac-controls-root`;
const PLUGIN_ID = "obsidian-divide-and-conquer";

/**
 * Turns Divide and Conquer off while the user is looking at a settings page.
 *
 * Through the API rather than by clicking the toggle, which is off screen in the
 * CSS snippets case - both tests should disable it the same way. `fromMainWindow`
 * because on 1.13 the settings are in a window `executeObsidian` cannot reach.
 */
async function disableSelf(): Promise<void> {
	await fromMainWindow(async () => {
		await browser.executeObsidian(async ({app}, id) => {
			await app.plugins.disablePluginAndSave(id);
		}, PLUGIN_ID);
	});
}

describe("disabling the plugin while its settings page is open", function() {
	beforeEach(async function() {
		await resetDac();
		await openSettings();
	});

	// Each test switches the plugin under test off, so put it back before the
	// next spec file runs against this same Obsidian instance.
	afterEach(async function() {
		await closeSettings();
		await browser.executeObsidian(async ({app}, id) => {
			if (!app.plugins.enabledPlugins.has(id)) {
				await app.plugins.enablePluginAndSave(id);
			}
		}, PLUGIN_ID);
	});

	it("takes its controls off the Community plugins page", async function() {
		await openSettingsTab("Community plugins");
		await expect($(CONTROLS)).toExist();

		await disableSelf();

		await expect($(CONTROLS)).not.toExist();
	});

	it("takes its controls off the CSS snippets page", async function() {
		await openCssSnippets();
		await expect($(CONTROLS)).toExist();

		await disableSelf();

		await expect($(CONTROLS)).not.toExist();
	});
});
