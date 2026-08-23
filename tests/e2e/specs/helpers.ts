import {$, $$, browser} from "@wdio/globals";
import type divideAndConquer from "../../../src/main";

declare module "wdio-obsidian-service" {
	interface InstalledPlugins {
		obsidianDivideAndConquer: divideAndConquer;
	}
}

/** The inert fixture plugins in `tests/e2e/vaults/simpleFakeVault`, in sort order. */
export const TEST_PLUGINS = [
	"dac-test-alpha",
	"dac-test-beta",
	"dac-test-delta",
	"dac-test-gamma",
] as const;

/** The fixture CSS snippets, in sort order. */
export const TEST_SNIPPETS = [
	"dac-test-alpha",
	"dac-test-beta",
	"dac-test-delta",
	"dac-test-gamma",
] as const;

/**
 * wdio-obsidian-service installs its own plugins into the vault to drive the
 * tests. They are real plugins as far as Divide and Conquer is concerned, so
 * every test excludes them — otherwise a bulk operation would sweep the test
 * harness up along with the fixtures.
 */
const HARNESS_PLUGINS = ["wdio-obsidian-service-plugin", "obsidian-launcher"];

/**
 * Puts the vault back to its starting point: every fixture plugin and snippet
 * enabled, no bisect in progress, and only the given extra exclusions in place.
 */
export async function resetDac(exclude: {plugins?: string[], snippets?: string[]} = {}) {
	await browser.executeObsidian(
		async ({app, plugins}, testPlugins, testSnippets, harness, excludePlugins, excludeSnippets) => {
			const dac = plugins.obsidianDivideAndConquer;

			dac.mode2Session.clear();
			dac.settings.bisectSessions = {};
			dac.settings.pluginFilterRegexes = [
				"hot-reload",
				"obsidian-divide-and-conquer",
				...harness,
				...excludePlugins,
			];
			dac.settings.snippetFilterRegexes = [...excludeSnippets];
			await dac.saveData();

			for (const id of [...testPlugins, ...harness]) {
				if (!app.plugins.enabledPlugins.has(id)) {
					await app.plugins.enablePluginAndSave(id);
				}
			}
			for (const snippet of testSnippets) {
				if (!app.customCss.enabledSnippets.has(snippet)) {
					app.customCss.setCssEnabledStatus(snippet, true);
				}
			}
		},
		[...TEST_PLUGINS],
		[...TEST_SNIPPETS],
		HARNESS_PLUGINS,
		exclude.plugins ?? [],
		exclude.snippets ?? [],
	);
}

/** Which fixture plugins are currently enabled, in sort order. */
async function enabledPlugins(): Promise<string[]> {
	return await browser.executeObsidian(
		({app}, testPlugins) => testPlugins.filter((id) => app.plugins.enabledPlugins.has(id)),
		[...TEST_PLUGINS],
	);
}

/** Which fixture snippets are currently enabled, in sort order. */
async function enabledSnippets(): Promise<string[]> {
	return await browser.executeObsidian(
		({app}, testSnippets) => testSnippets.filter((s) => app.customCss.enabledSnippets.has(s)),
		[...TEST_SNIPPETS],
	);
}

/**
 * Runs one of this plugin's commands and waits for it to finish.
 *
 * Obsidian fires command callbacks without awaiting them, so
 * `browser.executeObsidianCommand` returns while the bulk enable/disable work is
 * still in flight - and the next command would then start on top of it. The
 * callback does return a promise, so invoke it through the command registry and
 * await that instead.
 */
export async function runDacCommand(id: string): Promise<void> {
	await browser.executeObsidian(async ({app}, commandId) => {
		const registry = (app.commands as unknown as {
			commands: Record<string, {callback?: () => unknown} | undefined>
		}).commands;

		const command = registry[commandId];
		if (!command?.callback) {
			throw new Error(`No such command: ${commandId}`);
		}
		await command.callback();
	}, `obsidian-divide-and-conquer:${id}`);
}

/**
 * Polls instead of sampling once. `runDacCommand` awaits the command's promise,
 * but snippets are toggled one at a time with a delay, and Obsidian's own
 * bookkeeping can settle a tick later still.
 */
async function waitForEnabled(
	what: string,
	read: () => Promise<string[]>,
	expected: readonly string[],
): Promise<void> {
	let seen: string[] = [];
	const sampleMatches = async () => {
		seen = await read();
		return seen.length === expected.length && seen.every((id, i) => id === expected[i]);
	};

	await browser.waitUntil(sampleMatches, {
		timeout: 15_000,
		interval: 200,
		timeoutMsg: `expected ${what} [${expected.join(", ")}] to be enabled, but found [${seen.join(", ")}]`,
	});
}

/** Waits until exactly these fixture plugins are enabled. */
export async function expectEnabledPlugins(expected: readonly string[]): Promise<void> {
	await waitForEnabled("plugins", enabledPlugins, expected);
}

/** Waits until exactly these fixture snippets are enabled. */
export async function expectEnabledSnippets(expected: readonly string[]): Promise<void> {
	await waitForEnabled("snippets", enabledSnippets, expected);
}

/** The culprit the given mode's bisect has settled on, if it has settled. */
export async function bisectCulprit(mode: "plugins" | "snippets"): Promise<string | undefined> {
	return await browser.executeObsidian(
		({plugins}, mode) => plugins.obsidianDivideAndConquer.mode2Session.get(mode)?.culpritId,
		mode,
	);
}

/** Whether the given mode's bisect is still running. */
export async function bisectIsRunning(mode: "plugins" | "snippets"): Promise<boolean> {
	return await browser.executeObsidian(
		({plugins}, mode) => plugins.obsidianDivideAndConquer.mode2Session.get(mode)?.isRunning ?? false,
		mode,
	);
}

/**
 * Obsidian 1.13 opens Settings in its own Electron window; older versions open
 * it as a modal in the main window. These helpers hide that difference - they
 * leave you looking at whichever window the settings UI is in, and
 * `closeSettings` puts you back on the main one.
 *
 * `browser.executeObsidian` only works from the main window, so run any
 * Obsidian-API call before opening settings or after closing them.
 */
export const SETTINGS_MODAL = ".modal.mod-settings";

let mainWindow: string | undefined;

/** Opens Settings and switches to whichever window it landed in. */
export async function openSettings(): Promise<void> {
	mainWindow ??= await browser.getWindowHandle();
	await browser.switchToWindow(mainWindow);

	const before = await browser.getWindowHandles();
	await browser.executeObsidian(({app}) => {
		app.commands.executeCommandById("app:open-settings");
	});

	await browser.waitUntil(
		async () => (await browser.getWindowHandles()).length > before.length
			|| await $(SETTINGS_MODAL).isExisting(),
		{timeout: 10_000, interval: 200, timeoutMsg: "settings never opened"},
	);

	const opened = (await browser.getWindowHandles()).find((h) => !before.includes(h));
	if (opened) {
		await browser.switchToWindow(opened);
	}
	await $(SETTINGS_MODAL).waitForDisplayed();
}

/** Clicks a page in the settings sidebar, e.g. "Community plugins". */
export async function openSettingsTab(name: string): Promise<void> {
	for (const item of await $$(".vertical-tab-nav-item")) {
		if ((await item.getText()).trim() === name) {
			await item.click();
			await browser.waitUntil(async () => await $(".vertical-tab-content").isExisting(), {timeout: 5_000});
			return;
		}
	}
	throw new Error(`No "${name}" page in the settings sidebar`);
}

/**
 * Navigates to wherever this Obsidian keeps the CSS snippets. On 1.13 they live
 * on a sub-page you click into from Appearance; before that they were a section
 * of the Appearance page itself.
 *
 * @returns whether a sub-page was opened.
 */
export async function openCssSnippets(): Promise<boolean> {
	await openSettingsTab("Appearance");

	for (const item of await $$(".setting-item.mod-navigable")) {
		const name = await item.$(".setting-item-name");
		if (await name.isExisting() && (await name.getText()).trim() === "CSS snippets") {
			await item.click();
			await browser.pause(300);
			return true;
		}
	}
	return false;
}

/**
 * Runs `action` from the main Obsidian window, then switches back to wherever
 * you were. `browser.executeObsidian` only works from the main window, and on
 * 1.13 the settings live in a separate one.
 */
export async function fromMainWindow<T>(action: () => Promise<T>): Promise<T> {
	const current = await browser.getWindowHandle();
	if (!mainWindow || current === mainWindow) {
		return await action();
	}

	await browser.switchToWindow(mainWindow);
	try {
		return await action();
	} finally {
		await browser.switchToWindow(current);
	}
}

/** Closes Settings and returns to the main Obsidian window. */
export async function closeSettings(): Promise<void> {
	const current = await browser.getWindowHandle();

	// 1.13 puts Settings in its own Electron window, which does not answer to
	// Escape; close the window itself and go back to the main one.
	if (mainWindow && current !== mainWindow) {
		await browser.closeWindow();
		await browser.switchToWindow(mainWindow);
		return;
	}

	await browser.keys("Escape");
	await $(SETTINGS_MODAL).waitForExist({reverse: true, timeout: 5_000});
}

/**
 * The text of every button under `selector`, hidden ones included. WebDriver's
 * getText() reports "" for anything not visible, and the bisect controls stay
 * hidden until a bisect is running.
 */
export async function buttonLabels(selector: string): Promise<string[]> {
	const labels: string[] = [];
	for (const button of await $$(`${selector} button`)) {
		labels.push(((await button.getProperty("textContent")) ?? "").toString().trim());
	}
	return labels;
}
