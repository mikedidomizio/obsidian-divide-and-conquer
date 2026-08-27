import {browser, expect, $, $$} from "@wdio/globals";
import {SETTINGS_SUB_PAGE_VERSION, isAtLeast} from "../obsidian-versions.mjs";
import {
	SETTINGS_MODAL,
	buttonLabels,
	closeSettings,
	openCssSnippets,
	openSettings,
	openSettingsTab,
	resetDac,
} from "./helpers.js";

const CONTROLS = `${SETTINGS_MODAL} .dac-controls-root`;

/** Every control the plugin adds; the bisect-only ones are hidden until a bisect starts. */
const BUTTONS = [
	"Enable Included",
	"Enable All",
	"Disable Included",
	"Disable All",
	"Start (disable half)",
	"Start (enable half)",
	"Reset",
	"Yes",
	"No",
];

describe("bulk controls on Obsidian's own settings pages", function() {
	beforeEach(async function() {
		await resetDac();
		await openSettings();
	});

	afterEach(async function() {
		await closeSettings();
	});

	it("adds controls to the Community plugins page", async function() {
		await openSettingsTab("Community plugins");

		await expect($(CONTROLS)).toExist();
		await expect($(`${CONTROLS} .dac-status-text`)).toExist();

		expect(await buttonLabels(CONTROLS)).toEqual(BUTTONS);
	});

	it("adds controls wherever this version keeps the CSS snippets", async function() {
		const usedSubPage = await openCssSnippets();

		// 1.13 moved the snippets onto their own sub-page; every version before it
		// lists them on the Appearance page itself. Either way the controls
		// follow them.
		const version = await browser.getObsidianVersion();
		expect(usedSubPage).toBe(isAtLeast(version, SETTINGS_SUB_PAGE_VERSION));

		await expect($(CONTROLS)).toExist();
		expect(await buttonLabels(CONTROLS)).toEqual(BUTTONS);
	});

	it("does not leave a second copy of the controls behind when you navigate back", async function() {
		await openSettingsTab("Community plugins");
		await expect($$(CONTROLS)).toBeElementsArrayOfSize(1);

		await openSettingsTab("Appearance");
		await openSettingsTab("Community plugins");

		await expect($$(CONTROLS)).toBeElementsArrayOfSize(1);
	});

	it("never reports that it had nowhere to put its controls", async function() {
		await openSettingsTab("Community plugins");
		await openCssSnippets();
		await closeSettings();

		const warnedAbout = await browser.executeObsidian(({plugins}) => [
			...(plugins.obsidianDivideAndConquer as unknown as {
				warnedAboutMissingHost: Set<string>
			}).warnedAboutMissingHost,
		]);
		expect(warnedAbout).toEqual([]);
	});
});
