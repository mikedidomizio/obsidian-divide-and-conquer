import {browser, expect} from "@wdio/globals";
import {TEST_PLUGINS, expectEnabledPlugins, resetDac, runDacCommand} from "./helpers.js";

describe("bulk enabling and disabling plugins", function() {
	beforeEach(async function() {
		await resetDac();
	});

	// Everything below assumes the plugin survived loading on this Obsidian
	// version; if it did not, the rest of the failures would be noise.
	it("is loaded and running to begin with", async function() {
		const loaded = await browser.executeObsidian(
			({app}) => app.plugins.enabledPlugins.has("obsidian-divide-and-conquer"),
		);
		expect(loaded).toBe(true);
	});

	it("disables every plugin except the excluded ones", async function() {
		await runDacCommand("plugin-disable-all-except-excluded");
		await expectEnabledPlugins([]);

		// The exclusions themselves are untouched.
		const harnessStillOn = await browser.executeObsidian(
			({app}) => app.plugins.enabledPlugins.has("wdio-obsidian-service-plugin"),
		);
		expect(harnessStillOn).toBe(true);
	});

	it("leaves an excluded plugin enabled, then disables it when told to include excluded", async function() {
		await resetDac({plugins: ["dac-test-gamma"]});

		await runDacCommand("plugin-disable-all-except-excluded");
		await expectEnabledPlugins(["dac-test-gamma"]);

		await runDacCommand("plugin-disable-all");
		await expectEnabledPlugins([]);
	});

	it("enables every plugin again", async function() {
		await runDacCommand("plugin-disable-all-except-excluded");
		await expectEnabledPlugins([]);

		await runDacCommand("plugin-enable-all-except-excluded");
		await expectEnabledPlugins([...TEST_PLUGINS]);
	});

	it("leaves an excluded plugin off when enabling, until told to include excluded", async function() {
		await resetDac({plugins: ["dac-test-gamma"]});

		await runDacCommand("plugin-disable-all");
		await expectEnabledPlugins([]);

		// Exclusions cut both ways: gamma is not disabled for us, and not enabled for us either.
		await runDacCommand("plugin-enable-all-except-excluded");
		await expectEnabledPlugins(["dac-test-alpha", "dac-test-beta", "dac-test-delta"]);

		await runDacCommand("plugin-enable-all");
		await expectEnabledPlugins([...TEST_PLUGINS]);
	});
});
