import {TEST_SNIPPETS, expectEnabledSnippets, resetDac, runDacCommand} from "./helpers.js";

describe("bulk enabling and disabling CSS snippets", function() {
	beforeEach(async function() {
		await resetDac();
	});

	it("disables every snippet except the excluded ones", async function() {
		await resetDac({snippets: ["dac-test-beta"]});

		await runDacCommand("snippet-disable-all-except-excluded");
		await expectEnabledSnippets(["dac-test-beta"]);
	});

	it("disables every snippet, excluded ones included", async function() {
		await resetDac({snippets: ["dac-test-beta"]});

		await runDacCommand("snippet-disable-all");
		await expectEnabledSnippets([]);
	});

	it("enables every snippet again", async function() {
		await runDacCommand("snippet-disable-all");
		await expectEnabledSnippets([]);

		await runDacCommand("snippet-enable-all");
		await expectEnabledSnippets([...TEST_SNIPPETS]);
	});

	it("leaves an excluded snippet off when enabling, until told to include excluded", async function() {
		await resetDac({snippets: ["dac-test-beta"]});

		await runDacCommand("snippet-disable-all");
		await expectEnabledSnippets([]);

		// Exclusions cut both ways: beta is not disabled for us, and not enabled for us either.
		await runDacCommand("snippet-enable-all-except-excluded");
		await expectEnabledSnippets(["dac-test-alpha", "dac-test-delta", "dac-test-gamma"]);

		await runDacCommand("snippet-enable-all");
		await expectEnabledSnippets([...TEST_SNIPPETS]);
	});
});
