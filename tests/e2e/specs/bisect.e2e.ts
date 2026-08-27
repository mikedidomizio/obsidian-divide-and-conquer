import {expect} from "@wdio/globals";
import {
	TEST_PLUGINS,
	bisectCulprit,
	bisectIsRunning,
	expectEnabledPlugins,
	expectEnabledSnippets,
	resetDac,
	runDacCommand,
} from "./helpers.js";

/**
 * The plugin turns off half the user's plugins and asks whether the problem
 * they are chasing still happens. `plugin-answer-yes` means it does, so the
 * culprit is among the half still enabled; `plugin-answer-no` means it is among
 * the half just turned off. Either way half go, and it repeats until one is
 * left.
 */

/**
 * What is left enabled after the first step. Candidates are sorted in
 * reverse-name order and the front half kept, so alpha and beta go off - listed
 * alphabetically here, the order the helpers report enabled items in.
 */
const KEPT_AFTER_FIRST_STEP = ["dac-test-delta", "dac-test-gamma"];

describe("bisecting", function() {
	beforeEach(async function() {
		await resetDac();
	});

	it("halves the enabled plugins on each step until a culprit is left", async function() {
		await runDacCommand("plugin-start-bisect");
		expect(await bisectIsRunning("plugins")).toBe(true);
		await expectEnabledPlugins(KEPT_AFTER_FIRST_STEP);

		// "Still happens", so the culprit is one of the two still enabled.
		await runDacCommand("plugin-answer-yes");
		await expectEnabledPlugins(["dac-test-gamma"]);

		await runDacCommand("plugin-answer-yes");
		expect(await bisectIsRunning("plugins")).toBe(false);
		expect(await bisectCulprit("plugins")).toBe("dac-test-gamma");
	});

	it("narrows to the other half when the issue does not happen", async function() {
		await runDacCommand("plugin-start-bisect");
		await expectEnabledPlugins(KEPT_AFTER_FIRST_STEP);

		await runDacCommand("plugin-answer-no");
		await expectEnabledPlugins(["dac-test-beta"]);

		await runDacCommand("plugin-answer-no");
		await expectEnabledPlugins(["dac-test-alpha"]);
		expect(await bisectIsRunning("plugins")).toBe(false);
		expect(await bisectCulprit("plugins")).toBe("dac-test-alpha");
	});

	it("bisects in reverse, enabling half of what is disabled", async function() {
		await runDacCommand("plugin-disable-all-except-excluded");
		await expectEnabledPlugins([]);

		await runDacCommand("plugin-start-bisect-reverse");
		expect(await bisectIsRunning("plugins")).toBe(true);
		await expectEnabledPlugins(KEPT_AFTER_FIRST_STEP);
	});

	it("puts the plugins back the way they were when the bisect is reset", async function() {
		await runDacCommand("plugin-start-bisect");
		await expectEnabledPlugins(KEPT_AFTER_FIRST_STEP);

		await resetDac();
		await expectEnabledPlugins([...TEST_PLUGINS]);
		expect(await bisectIsRunning("plugins")).toBe(false);
	});

	it("bisects CSS snippets the same way", async function() {
		await runDacCommand("snippet-start-bisect");
		await expectEnabledSnippets(KEPT_AFTER_FIRST_STEP);

		await runDacCommand("snippet-answer-no");
		await expectEnabledSnippets(["dac-test-beta"]);

		await runDacCommand("snippet-answer-no");
		expect(await bisectCulprit("snippets")).toBe("dac-test-alpha");
	});

	it("narrows CSS snippets to the enabled half when the issue still happens", async function() {
		await runDacCommand("snippet-start-bisect");
		await expectEnabledSnippets(KEPT_AFTER_FIRST_STEP);

		await runDacCommand("snippet-answer-yes");
		await expectEnabledSnippets(["dac-test-gamma"]);

		await runDacCommand("snippet-answer-yes");
		expect(await bisectIsRunning("snippets")).toBe(false);
		expect(await bisectCulprit("snippets")).toBe("dac-test-gamma");
	});

	it("bisects CSS snippets in reverse too", async function() {
		await runDacCommand("snippet-disable-all-except-excluded");
		await expectEnabledSnippets([]);

		await runDacCommand("snippet-start-bisect-reverse");
		expect(await bisectIsRunning("snippets")).toBe(true);
		await expectEnabledSnippets(KEPT_AFTER_FIRST_STEP);
	});

	it("does not sweep excluded plugins into the bisect", async function() {
		await resetDac({plugins: ["dac-test-gamma", "dac-test-delta"]});

		// Only alpha and beta are candidates, so the first half is beta alone -
		// and the two excluded plugins are left enabled throughout.
		await runDacCommand("plugin-start-bisect");
		await expectEnabledPlugins(["dac-test-beta", "dac-test-delta", "dac-test-gamma"]);
	});
});
